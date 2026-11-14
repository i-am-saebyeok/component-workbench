// 서비스 컴포넌트를 고르고 preview로 확인한 뒤 저장한다. 화면에 보이는 것(inspected)과
// MCP와 공유하는 저장 선택은 분리되어 있다. 둘러보기는 저장하지 않고, 선택 버튼은 둘이 다를
// 때만 켜진다. 저장에는 이 페이지가 마지막으로 읽은 selection revision과 source fingerprint를
// 함께 보낸다. 용도/BDD는 기본 닫힌 문서 패널에 둔다.
import type { BoxPreview } from './adapters/box.js';
import { createHtmlPreview } from './adapters/html.js';
import type { CatalogResponse, Component, ErrorBody, SelectionState, Variant } from './api.js';

const POLL_MS = 2000;

/** index.html에 있는 요소. 없거나 다른 종류면 화면 구성이 깨진 것이므로 바로 실패한다. */
function $(id: string): HTMLElement;
function $<T extends HTMLElement>(id: string, type: new () => T): T;
function $(id: string, type: new () => HTMLElement = HTMLElement): HTMLElement {
  const node = document.getElementById(id);
  if (!(node instanceof type)) throw new Error(`#${id} 요소가 없다.`);
  return node;
}

const state: {
  catalog: CatalogResponse | null;
  selection: SelectionState | null;
  selectionEtag: string | null;
  inspected: { componentId: string | null; variantId: string | null };
  saving: boolean;
  broken: boolean;
} = { catalog: null, selection: null, selectionEtag: null, inspected: { componentId: null, variantId: null }, saving: false, broken: false };
const htmlPreview = createHtmlPreview($('html-host', HTMLIFrameElement));
let boxPreview: Promise<BoxPreview> | null = null;

type Props = Record<string, string | Record<string, string> | ((event: Event) => void)>;

/** `class`·`text`·`dataset`·`on<event>`과 그 밖의 속성을 받는 요소 생성. */
function el(tag: string, props: Props = {}, children: Node | null | (Node | null)[] = []): HTMLElement {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (typeof value === 'function') node.addEventListener(key.slice(2), value);
    else if (typeof value === 'object') Object.assign(node.dataset, value);
    else if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else node.setAttribute(key, value);
  }
  for (const child of [children].flat()) if (child !== null) node.append(child);
  return node;
}

const componentById = (id: string | null | undefined) => state.catalog?.components.find((component) => component.id === id) ?? null;
const variantOf = (component: Component | null, id: string | null | undefined) => component?.variants.find((variant) => variant.id === id) ?? null;
const inspectedPair = () => {
  const component = componentById(state.inspected.componentId);
  return { component, variant: variantOf(component, state.inspected.variantId) };
};
const savedSelection = () => state.selection?.selection ?? null;

type ApiResult<T> = { status: number; ok: true; body: T; etag: string | null } | { status: number; ok: false; body: ErrorBody | null; etag: string | null };

/** 같은 origin JSON API. 성공 본문은 서버가 web/api.d.ts 형식으로 보낸다(서버 쪽에서 타입 검사). */
async function api<T>(path: string, options: { method?: string; body?: string; headers?: Record<string, string> } = {}): Promise<ApiResult<T>> {
  const response = await fetch(path, {
    ...options,
    headers: { Accept: 'application/json', ...(options.body ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
  });
  if (response.status === 304) return { status: 304, ok: false, body: null, etag: null };
  const body: unknown = await response.json().catch(() => null);
  const etag = response.headers.get('ETag');
  return response.ok ? { status: response.status, ok: true, body: body as T, etag } : { status: response.status, ok: false, body: body as ErrorBody | null, etag };
}

/** 성공하지 않은 API 응답. */
class HttpFailure extends Error {
  readonly status: number;
  readonly body: ErrorBody | null;

  constructor(status: number, body: ErrorBody | null) {
    super(body?.error?.message_ko ?? `HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function setConnection(kind: 'online' | 'offline' | 'error') {
  $('connection').dataset.state = kind;
  $('connection-text').textContent = { online: '연결됨', offline: '연결 끊김', error: '정의 오류' }[kind];
}

type Notice = { message_ko?: string | undefined; details?: { problems?: { at?: string; message_ko: string }[] } | undefined };

/** 정의 오류(문제 목록 포함)를 표시한다. null이면 숨긴다. */
function showNotice(error: Notice | null) {
  const notice = $('notice');
  notice.hidden = !error;
  if (!error) return notice.replaceChildren();
  const problems = error.details?.problems ?? [];
  const title = el('p', { class: 'notice-title', text: error.message_ko ?? String(error) });
  if (problems.length === 0) return notice.replaceChildren(title);
  notice.replaceChildren(title, el('ul', {}, problems.slice(0, 20).map((item) => el('li', { text: item.at ? `${item.at}: ${item.message_ko}` : item.message_ko }))));
}

function renderComponents(catalog: CatalogResponse) {
  $('component-list').replaceChildren(
    ...catalog.components.map((component) =>
      el('li', {}, [
        el('button', {
          type: 'button',
          class: 'component-item',
          'aria-current': String(component.id === state.inspected.componentId),
          dataset: { componentId: component.id },
          text: component.name,
          onclick: () => inspect(component.id, variantOf(component, state.inspected.variantId)?.id ?? component.variants[0]?.id ?? null),
        }),
      ]),
    ),
  );
}

function renderVariants(component: Component) {
  $('variant-area').hidden = component.variants.length === 0;
  $('variant-group').replaceChildren(
    ...component.variants.map((variant) => {
      const checked = variant.id === state.inspected.variantId;
      let swatch = null;
      if (variant.material) {
        swatch = el('span', { class: 'swatch' });
        // CSP가 inline style 속성을 막으므로 CSSOM으로 지정한다.
        swatch.style.background = variant.material.base_color_srgb_hex;
      }
      return el(
        'button',
        {
          type: 'button',
          role: 'radio',
          class: 'variant',
          'aria-checked': String(checked),
          tabindex: checked ? '0' : '-1',
          dataset: { variantId: variant.id },
          onclick: () => inspect(component.id, variant.id),
          onkeydown: (event) => {
            if (event instanceof KeyboardEvent) moveRadio(event, component, variant.id);
          },
        },
        [swatch, el('span', { text: variant.name })],
      );
    }),
  );
}

function moveRadio(event: KeyboardEvent, component: Component, currentId: string) {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
  event.preventDefault();
  const ids = component.variants.map((variant) => variant.id);
  const step = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
  const next = ids[(ids.indexOf(currentId) + step + ids.length) % ids.length];
  if (next === undefined) return;
  inspect(component.id, next);
  const target = $('variant-group').querySelector(`[data-variant-id="${CSS.escape(next)}"]`);
  if (target instanceof HTMLElement) target.focus();
}

function selectionText(selection: SelectionState | null) {
  if (!selection?.selection) return '현재 선택: 없음';
  const saved = selection.selection;
  const component = componentById(saved.component_id);
  const variant = variantOf(component, saved.variant_id);
  if (!component || (saved.variant_id !== null && !variant)) return '현재 선택: 정의에 없는 항목 (다시 선택 필요)';
  const name = variant ? `${component.name} · ${variant.name}` : component.name;
  return selection.status === 'current' ? `현재 선택: ${name}` : `현재 선택: ${name} (정의가 바뀌어 다시 선택 필요)`;
}

function renderAction() {
  const { selection } = state;
  const saved = savedSelection();
  const current = selection?.status === 'current';
  const same = current && selection.selection.component_id === state.inspected.componentId && selection.selection.variant_id === state.inspected.variantId;
  const button = $('select-button', HTMLButtonElement);
  button.disabled = state.saving || same || !selection || state.broken;
  button.textContent = state.saving ? '저장 중…' : '이 컴포넌트 선택';
  const line = $('current-selection');
  line.dataset.savedComponent = saved?.component_id ?? '';
  line.dataset.savedVariant = saved?.variant_id ?? '';
  line.dataset.status = !saved || current ? 'ok' : 'stale';
  line.textContent = selectionText(selection);
}

async function renderPreview(component: Component, variant: Variant | null, version: string) {
  const preview = variant?.preview ?? component.preview ?? null;
  const type = preview?.type ?? 'none';
  $('box-host').hidden = type !== 'box';
  $('html-host').hidden = type !== 'html';
  $('no-preview').hidden = type !== 'none';
  $('reset-view').hidden = type !== 'box';
  if (preview?.type === 'html') {
    htmlPreview.show({ src: preview.src, title: component.name, componentId: component.id, variantId: variant?.id ?? null, version });
  } else if (preview?.type === 'box') {
    // three.js는 box preview가 처음 필요할 때만 불러온다.
    boxPreview ??= import('./adapters/box.js').then(({ createBoxPreview }) => createBoxPreview($('box-host')));
    const box = await boxPreview;
    // 불러오는 동안 다른 항목으로 바뀌었으면 그 항목의 렌더가 이어서 처리한다.
    if (inspectedPair().component !== component || inspectedPair().variant !== variant) return;
    box.show({ componentId: component.id, variantId: variant?.id ?? null, dimensions: preview.dimensions_m, material: variant?.material });
  }
}

const bulletList = (items: string[]) => el('ul', {}, items.map((text) => el('li', { text })));

function renderUsage(component: Component, variant: Variant | null) {
  $('panel-usage').replaceChildren(
    el('section', { class: 'doc-section' }, [
      el('h3', { text: variant ? `${component.name} · ${variant.name}` : component.name }),
      el('p', { text: component.description }),
      component.intended_uses.length > 0 ? el('p', { class: 'doc-label', text: '의도된 용도' }) : null,
      component.intended_uses.length > 0 ? bulletList(component.intended_uses) : null,
      component.avoid_uses.length > 0 ? el('p', { class: 'doc-label', text: '피해야 할 사용' }) : null,
      component.avoid_uses.length > 0 ? bulletList(component.avoid_uses) : null,
    ]),
  );
}

function gherkinLine(line: string) {
  const span = el('span');
  const trimmed = line.trim();
  const keyword = /^(\s*)(Feature|Rule|Background|Scenario Outline|Scenario Template|Scenario|Example|Examples|Scenarios|Given|When|Then|And|But)(:?)(.*)$/.exec(line);
  if (trimmed.startsWith('@')) span.append(el('span', { class: 'tag', text: line }));
  else if (trimmed.startsWith('|')) span.append(el('span', { class: 'table', text: line }));
  else if (keyword) {
    // 네 group은 정규식에서 항상 참여한다.
    const [, indent = '', word = '', colon = '', rest = ''] = keyword;
    span.append(indent, el('span', { class: 'kw', text: word + colon }), rest);
  } else span.append(line);
  span.append('\n');
  return span;
}

function renderBdd(catalog: CatalogResponse, component: Component) {
  if (component.bdd.length === 0) return $('panel-bdd').replaceChildren(el('p', { class: 'doc-empty', text: '연결된 BDD 문서가 없습니다.' }));
  $('panel-bdd').replaceChildren(
    ...component.bdd.map((path) => {
      // 서버가 연결 문서를 모두 원본 묶음에 넣었는지 검사한 뒤 보낸다.
      const text = catalog.documents.find((item) => item.path === path)?.text ?? '';
      return el('article', { class: 'feature', dataset: { docPath: path } }, [
        el('div', { class: 'feature-path', text: path }),
        el('pre', { class: 'doc-text gherkin' }, text.split(/\r?\n/).map(gherkinLine)),
      ]);
    }),
  );
}

function renderAll() {
  const { catalog } = state;
  const { component, variant } = inspectedPair();
  if (!catalog || !component) return;
  renderComponents(catalog);
  renderVariants(component);
  renderAction();
  renderUsage(component, variant);
  renderBdd(catalog, component);
  renderPreview(component, variant, catalog.source.source_sha256);
}

function inspect(componentId: string, variantId: string | null) {
  state.inspected = { componentId, variantId };
  renderAll();
}

function showCatalog(catalog: CatalogResponse) {
  document.title = `${catalog.workbench.title} · Component Workbench`;
  $('title').textContent = catalog.workbench.title;
  const first = catalog.components[0];
  const empty = first === undefined;
  $('empty').hidden = !empty;
  $('workspace').hidden = empty;
  $('docs-toggle').hidden = empty;
  if (empty) {
    $('empty-catalog').textContent = catalog.workbench.catalog;
    if (!$('docs-drawer').hidden) setDrawer(false);
    return;
  }
  // 보던 항목이 남아 있으면 유지하고, 아니면 저장 선택 또는 첫 항목을 보여 준다(저장하지 않는다).
  let { component, variant } = inspectedPair();
  if (!component) {
    const saved = savedSelection();
    component = componentById(saved?.component_id) ?? first;
    variant = variantOf(component, saved?.component_id === component.id ? saved.variant_id : null);
  }
  inspect(component.id, (variant ?? variantOf(component, state.inspected.variantId) ?? component.variants[0])?.id ?? null);
}

async function loadCatalog() {
  const result = await api<CatalogResponse>('/api/catalog');
  if (!result.ok) throw new HttpFailure(result.status, result.body);
  state.catalog = result.body;
  state.selection = result.body.selection;
  state.selectionEtag = null;
  state.broken = false;
  showNotice(null);
  showCatalog(result.body);
}

function showBroken(error: { status?: number; body?: ErrorBody | null; message: string }) {
  state.broken = true;
  // 원본을 정확히 원래 바이트로 되돌리면 같은 ETag의 304가 오므로, 복구를 알아채도록 ETag를 버린다.
  state.selectionEtag = null;
  setConnection(error.status ? 'error' : 'offline');
  showNotice(error.body?.error ?? { message_ko: `서비스에 연결할 수 없습니다. ${error.message}` });
  if (state.catalog && state.catalog.components.length > 0) renderAction();
}

async function poll() {
  try {
    const result = await api<SelectionState>('/api/selection', { headers: state.selectionEtag ? { 'If-None-Match': state.selectionEtag } : {} });
    if (result.status === 304) return setConnection('online');
    if (!result.ok) return showBroken({ status: result.status, body: result.body, message: `HTTP ${result.status}` });
    setConnection('online');
    const { catalog } = state;
    if (state.broken || !catalog || result.body.source.source_sha256 !== catalog.source.source_sha256) {
      await loadCatalog(); // 정의·문서·preview가 바뀌었다. 보던 항목은 남아 있으면 유지한다.
      return;
    }
    state.selection = result.body;
    state.selectionEtag = result.etag;
    if (catalog.components.length > 0) renderAction();
  } catch (error) {
    if (error instanceof HttpFailure) showBroken(error);
    else setConnection('offline');
  }
}

async function saveSelection() {
  const { componentId, variantId } = state.inspected;
  const current = state.selection;
  // 선택 버튼은 읽은 선택이 있을 때만 켜진다.
  if (!current) return;
  state.saving = true;
  $('select-message').textContent = '';
  renderAction();
  try {
    const result = await api<SelectionState>('/api/selection', {
      method: 'POST',
      body: JSON.stringify({
        component_id: componentId,
        variant_id: variantId,
        expected_selection_revision: current.revision,
        expected_source_sha256: current.source.source_sha256,
      }),
    });
    if (result.ok) {
      state.selection = result.body;
      state.selectionEtag = null;
    } else {
      const error = result.body?.error;
      if (error?.details?.current) state.selection = error.details.current;
      $('select-message').textContent =
        error?.code === 'selection_conflict'
          ? '다른 곳에서 선택이 먼저 바뀌어 저장하지 않았습니다. 현재 선택을 확인한 뒤 다시 선택하세요.'
          : error?.code === 'source_conflict'
            ? '정의나 문서가 바뀌어 저장하지 않았습니다. 바뀐 내용을 확인한 뒤 다시 선택하세요.'
            : `저장하지 못했습니다. ${error?.message_ko ?? ''}`.trim();
      if (error?.code === 'source_conflict') await loadCatalog();
    }
  } catch {
    setConnection('offline');
    $('select-message').textContent = '서비스에 연결할 수 없어 저장하지 못했습니다.';
  } finally {
    state.saving = false;
    renderAction();
  }
}

function selectTab(name: 'usage' | 'bdd') {
  for (const tab of ['usage', 'bdd']) {
    const selected = tab === name;
    $(`tab-${tab}`).setAttribute('aria-selected', String(selected));
    $(`tab-${tab}`).tabIndex = selected ? 0 : -1;
    $(`panel-${tab}`).hidden = !selected;
  }
}

function setDrawer(open: boolean) {
  $('docs-drawer').hidden = !open;
  $('docs-toggle').setAttribute('aria-expanded', String(open));
  if (open) $('docs-title').focus();
  else $('docs-toggle').focus();
}

function bindControls() {
  $('select-button').addEventListener('click', saveSelection);
  $('reset-view').addEventListener('click', async () => (await boxPreview)?.resetView());
  $('docs-toggle').addEventListener('click', () => setDrawer(Boolean($('docs-drawer').hidden)));
  $('docs-close').addEventListener('click', () => setDrawer(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !$('docs-drawer').hidden) setDrawer(false);
  });
  $('tab-usage').addEventListener('click', () => selectTab('usage'));
  $('tab-bdd').addEventListener('click', () => selectTab('bdd'));
  const tabs = document.querySelector('.tabs');
  if (!(tabs instanceof HTMLElement)) throw new Error('.tabs 요소가 없다.');
  tabs.addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const next = $('tab-usage').getAttribute('aria-selected') === 'true' ? 'bdd' : 'usage';
    selectTab(next);
    $(`tab-${next}`).focus();
  });
}

async function start() {
  bindControls();
  try {
    await loadCatalog();
    setConnection('online');
  } catch (error) {
    showBroken(error instanceof HttpFailure ? error : { message: error instanceof Error ? error.message : String(error) });
  }
  setInterval(poll, POLL_MS);
}

start();
