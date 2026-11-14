// 설치본 브라우저 QA: npm pack tarball을 새 서비스 A/B에 설치·init하고, 생성된
// `npm run workbench`로 띄운 실제 웹을 Chromium으로 조작한다. 서비스·포트는 모두 임시다.
//
//   npm run qa:browser
//
// playwright-core가 고정한 Chromium(revision 1234)을 쓴다. 이 WSL 호스트에서는 NSS/ALSA
// 라이브러리가 ~/.local/chrome-libs에 있어 있으면 LD_LIBRARY_PATH에 더한다. WebGL은 SwiftShader다.
// 결과: .cache/browser-qa/browser-qa.json 과 화면 PNG.
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { chromium } from 'playwright-core';
import { FIXTURES, REPO_ROOT } from '../helpers.js';
import { assignPort, installService, npx, packTarball, startWorkbench, stopWorkbench, tempRoot } from '../installed.js';

const REPORT_DIR = path.join(REPO_ROOT, '.cache', 'browser-qa');
const CHROME_LIBS = path.join(os.homedir(), '.local', 'chrome-libs', 'usr', 'lib', 'x86_64-linux-gnu');
const results = [];
const problems = [];
const expected = [];
let expectingCatalogError = false;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function record(id, tags, ok, details) {
  results.push({ id, tags, ok, details });
  process.stdout.write(`${ok ? 'PASS' : 'FAIL'} ${id} ${tags.join(' ')}\n`);
  if (!ok) process.stdout.write(`  ${JSON.stringify(details)}\n`);
}

function check(id, tags, condition, details) {
  record(id, tags, Boolean(condition), details);
  if (!condition) throw new Error(`QA step failed: ${id}`);
}

/** 콘솔 오류·HTTP 오류를 모은다. 정의를 일부러 깨뜨린 동안의 503 polling만 예상된 오류로 따로 센다. */
function watch(page, label) {
  page.on('console', (message) => {
    if (message.type() !== 'error' && message.type() !== 'warning') return;
    const entry = { page: label, type: message.type(), text: message.text() };
    if (expectingCatalogError && /status of 503/.test(entry.text)) expected.push(entry);
    else problems.push(entry);
  });
  page.on('response', (response) => {
    if (response.status() < 400) return;
    const entry = { page: label, method: response.request().method(), path: new URL(response.url()).pathname, status: response.status() };
    if (expectingCatalogError && entry.status === 503 && entry.path.startsWith('/api/')) expected.push(entry);
    else problems.push({ ...entry, type: 'http-error' });
  });
  page.on('pageerror', (error) => problems.push({ page: label, type: 'pageerror', text: error.message }));
}

const boxState = (page) => page.$eval('#box-host', (node) => ({ ...node.dataset }));

async function waitBox(page, component, variant) {
  await page.waitForFunction(
    ([c, v]) => {
      const data = document.querySelector('#box-host')?.dataset;
      return data?.renderedComponent === c && data?.renderedVariant === v;
    },
    [component, variant],
  );
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
}

const waitHtml = (page, src) => page.waitForSelector(`#html-host[data-loaded-src="${src}"]`, { state: 'attached' });

const waitSaved = (page, component, variant) =>
  page.waitForFunction(
    ([c, v]) => {
      const data = document.querySelector('#current-selection')?.dataset;
      return data?.savedComponent === c && data?.savedVariant === v;
    },
    [component, variant],
    { timeout: 15000 },
  );

/** WebGL canvas의 축소 RGB(preserveDrawingBuffer로 마지막 프레임을 읽는다). */
async function canvasPixels(page) {
  return page.evaluate(() => {
    const source = document.querySelector('#box-host canvas');
    const width = 240;
    const height = Math.round((source.height / source.width) * width);
    const scratch = Object.assign(document.createElement('canvas'), { width, height });
    const context = scratch.getContext('2d', { willReadFrequently: true });
    context.drawImage(source, 0, 0, width, height);
    return Array.from(context.getImageData(0, 0, width, height).data);
  });
}

function differing(a, b, threshold = 30) {
  let count = 0;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > threshold) count += 1;
  return count;
}

/** 파란 본체 픽셀(배경·격자·라벨은 거의 무채색이다)과 그 경계 상자. */
function bluePixels(pixels, width = 240) {
  let count = 0;
  const box = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 2] - pixels[i] > 40 && pixels[i + 2] > 80) {
      count += 1;
      const p = i / 4;
      const x = p % width;
      const y = Math.floor(p / width);
      Object.assign(box, { minX: Math.min(box.minX, x), maxX: Math.max(box.maxX, x), minY: Math.min(box.minY, y), maxY: Math.max(box.maxY, y) });
    }
  }
  return { count, width: box.maxX - box.minX + 1, height: box.maxY - box.minY + 1 };
}

/** 본체(파란 픽셀)가 canvas 가장자리에서 떨어진 정도와 치수 라벨이 preview 안에 있는지. */
async function framing(page) {
  const pixels = await canvasPixels(page);
  const width = 240;
  const height = pixels.length / 4 / width;
  let count = 0;
  let margin = Infinity;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 2] - pixels[i] > 40 && pixels[i + 2] > 80) {
      count += 1;
      const x = (i / 4) % width;
      const y = Math.floor(i / 4 / width);
      margin = Math.min(margin, x, y, width - 1 - x, height - 1 - y);
    }
  }
  const labels = await page.evaluate(() => {
    const host = document.querySelector('#box-host').getBoundingClientRect();
    return [...document.querySelectorAll('#box-host .dim-label')].map((node) => {
      const box = node.getBoundingClientRect();
      return { text: node.textContent, inside: box.left >= host.left && box.right <= host.right && box.top >= host.top && box.bottom <= host.bottom };
    });
  });
  return { body: { count, margin: count > 0 ? margin : null }, labels };
}

const readSelection = async (service) => JSON.parse(await fs.readFile(path.join(service, 'workbench', 'selection.json'), 'utf8'));
const selectionExists = (service) => fs.stat(path.join(service, 'workbench', 'selection.json')).then(() => true, () => false);

/** 컨트롤이 화면 안에 있고 크기가 있으며 가운데를 실제로 누를 수 있는지. */
async function reach(page, selector) {
  await page.$eval(selector, (node) => node.scrollIntoView({ block: 'center', inline: 'nearest' }));
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));
  return page.$eval(selector, (node) => {
    const box = node.getBoundingClientRect();
    const inViewport = box.width > 0 && box.height > 0 && box.top >= 0 && box.bottom <= window.innerHeight && box.left >= 0 && box.right <= window.innerWidth;
    const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    return { inViewport, unobstructed: hit === node || node.contains(hit) };
  });
}

/** 머리글의 글자가 줄바꿈되지 않았는지(각 텍스트 요소가 한 줄). */
async function headerSingleLine(page) {
  return page.evaluate(() =>
    ['#title', '#connection-text', '#docs-toggle'].map((selector) => {
      const node = document.querySelector(selector);
      if (!node || node.hidden) return { selector, hidden: true, singleLine: true };
      const range = document.createRange();
      range.selectNodeContents(node);
      const lines = new Set([...range.getClientRects()].map((rect) => Math.round(rect.top)));
      return { selector, lines: lines.size, singleLine: lines.size <= 1 };
    }),
  );
}

async function mcpClient(url) {
  const client = new Client({ name: 'component-workbench-browser-qa', version: '0' }, { versionNegotiation: { mode: 'legacy' } });
  await client.connect(new StreamableHTTPClientTransport(new URL('mcp', url)));
  return client;
}

async function main() {
  const work = await tempRoot('cw qa ');
  await fs.rm(REPORT_DIR, { recursive: true, force: true });
  await fs.mkdir(REPORT_DIR, { recursive: true });
  const screenshots = [];
  const shot = async (page, name, options = {}) => {
    await page.screenshot({ path: path.join(REPORT_DIR, `${name}.png`), ...options });
    screenshots.push(`.cache/browser-qa/${name}.png`);
  };
  const servers = [];
  let browser;
  let environment = {};
  try {
    const { tarball } = await packTarball(work);
    const A = path.join(work, 'service a');
    const B = path.join(work, 'service b');
    for (const [dir, name, title] of [[A, 'service-a', 'Service A'], [B, 'service-b', 'Service B']]) {
      await installService(dir, tarball, { name });
      const init = await npx(dir, ['init', '--title', title]);
      if (init.code !== 0) throw new Error(init.stderr);
      await assignPort(dir);
    }
    const webA = await startWorkbench(A);
    const webB = await startWorkbench(B);
    servers.push(webA, webB);

    const libraryPath = existsSync(CHROME_LIBS) ? [CHROME_LIBS, process.env.LD_LIBRARY_PATH].filter(Boolean).join(':') : process.env.LD_LIBRARY_PATH;
    browser = await chromium.launch({ env: { ...process.env, ...(libraryPath ? { LD_LIBRARY_PATH: libraryPath } : {}) }, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
    environment = { node: process.version, chromium: browser.version(), renderer: 'headless Chromium, WebGL via SwiftShader' };

    // 1. 빈 서비스: 안내만 보이고 예제·선택이 없다.
    const desktop = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(desktop, 'desktop-a');
    await desktop.goto(webA.url);
    await desktop.waitForSelector('#empty:not([hidden])');
    const empty = await desktop.evaluate(() => ({
      text: document.querySelector('#empty').textContent.replace(/\s+/g, ' ').trim(),
      workspaceHidden: document.querySelector('#workspace').hidden,
      docsHidden: document.querySelector('#docs-toggle').hidden,
      title: document.querySelector('#title').textContent,
      connection: document.querySelector('#connection').dataset.state,
    }));
    await shot(desktop, 'a-empty-desktop');
    check('empty-service-ui', [], empty.text.includes('등록된 컴포넌트가 없습니다') && empty.text.includes('workbench/catalog.json') && empty.workspaceHidden && empty.docsHidden && empty.title === 'Service A' && empty.connection === 'online' && !(await selectionExists(A)), empty);
    const narrowEmpty = await browser.newPage({ viewport: { width: 390, height: 844 } });
    watch(narrowEmpty, 'narrow-empty');
    await narrowEmpty.goto(webB.url);
    await narrowEmpty.waitForSelector('#empty:not([hidden])');
    const emptyOverflow = await narrowEmpty.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await shot(narrowEmpty, 'b-empty-390');
    check('empty-service-390', [], emptyOverflow <= 1 && (await headerSingleLine(narrowEmpty)).every((item) => item.singleLine), { horizontal_overflow_px: emptyOverflow });
    await narrowEmpty.close();

    // 2. A에 box 컴포넌트를 등록하면 열린 페이지가 polling으로 새 정의를 읽는다.
    await fs.cp(path.join(FIXTURES, 'service-a', 'workbench'), path.join(A, 'workbench'), { recursive: true });
    await waitBox(desktop, 'storage-panel', 'metal-blue');
    const box = await boxState(desktop);
    const labels = await desktop.$$eval('.dim-label', (nodes) => nodes.map((node) => node.textContent));
    const frame = await canvasPixels(desktop);
    const blue = bluePixels(frame);
    await shot(desktop, 'a-box-desktop');
    check(
      'a-box-renders-service-dimensions-and-material',
      ['@storage-panel-view-does-not-select'],
      box.renderedDimensions === '3,1,1.5' &&
        box.renderedColor === '#4f7aa8' &&
        Number(box.renderedRoughness) === 0.4 &&
        Number(box.renderedMetallic) === 0.7 &&
        ['X 3 m', 'Y 1 m', 'Z 1.5 m'].every((text) => labels.includes(text)) &&
        blue.count > 1500 &&
        blue.width > blue.height,
      { rendered: box, labels, blue_body_pixels: blue },
    );

    // 보기 조작은 그림만 바꾸고 선택을 만들지 않는다.
    const canvas = await desktop.locator('#box-host canvas').boundingBox();
    await desktop.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2);
    await desktop.mouse.down();
    await desktop.mouse.move(canvas.x + canvas.width / 2 + 220, canvas.y + canvas.height / 2 + 40, { steps: 12 });
    await desktop.mouse.up();
    await desktop.mouse.wheel(0, -400);
    await sleep(600);
    const rotated = await canvasPixels(desktop);
    await shot(desktop, 'a-box-rotated-zoomed');
    await desktop.click('#reset-view');
    await sleep(600);
    const reset = await canvasPixels(desktop);
    check('a-view-operations-do-not-select', ['@storage-panel-view-does-not-select'], differing(frame, rotated) > 500 && differing(frame, reset) < differing(frame, rotated) / 4 && !(await selectionExists(A)), {
      rotated_changed_pixels: differing(frame, rotated),
      reset_changed_pixels: differing(frame, reset),
      selection_file_exists: await selectionExists(A),
    });

    // 문서 패널: 기본 닫힘, 용도와 실제 BDD 본문.
    const closedByDefault = await desktop.$eval('#docs-drawer', (node) => node.hidden);
    await desktop.click('#docs-toggle');
    const usage = await desktop.$eval('#panel-usage', (node) => node.textContent);
    await shot(desktop, 'a-docs-usage');
    await desktop.click('#tab-bdd');
    const bdd = await desktop.$$eval('#panel-bdd article', (nodes) => nodes.map((node) => ({ path: node.dataset.docPath, text: node.querySelector('pre').textContent })));
    await shot(desktop, 'a-docs-bdd');
    await desktop.keyboard.press('Escape');
    const closedAfter = await desktop.$eval('#docs-drawer', (node) => node.hidden);
    const catalogA = JSON.parse(await fs.readFile(path.join(A, 'workbench', 'catalog.json'), 'utf8'));
    const featureA = await fs.readFile(path.join(A, 'workbench', 'behaviors', 'storage-panel.feature'), 'utf8');
    check(
      'a-docs-drawer-shows-real-usage-and-bdd',
      [],
      closedByDefault && closedAfter && [...catalogA.components[0].intended_uses, ...catalogA.components[0].avoid_uses].every((text) => usage.includes(text)) && bdd.length === 1 && bdd[0].path === 'behaviors/storage-panel.feature' && bdd[0].text.trimEnd() === featureA.trimEnd(),
      { closed_by_default: closedByDefault, closed_after_escape: closedAfter, bdd_documents: bdd.map((doc) => doc.path) },
    );

    // 일반 치수: 같은 서비스 A box를 임시로 100 m·0.1 m 규모로 바꿔도 처음·시점 초기화 화면에
    // 본체와 치수선이 잘리지 않고 들어온다. 확인 뒤 원래 바이트로 되돌린다.
    const catalogFile = path.join(A, 'workbench', 'catalog.json');
    const original = await fs.readFile(catalogFile);
    for (const [name, dimensions] of [['100m', [100, 25, 50]], ['0.1m', [0.1, 0.025, 0.05]]]) {
      const scaled = JSON.parse(original.toString('utf8'));
      scaled.components[0].preview.dimensions_m = dimensions;
      await fs.writeFile(catalogFile, `${JSON.stringify(scaled, null, 2)}\n`);
      await desktop.waitForFunction((value) => document.querySelector('#box-host')?.dataset.renderedDimensions === value, dimensions.join(','));
      await sleep(400);
      const initialFrame = await framing(desktop);
      await shot(desktop, `a-box-scaled-${name}`);
      const area = await desktop.locator('#box-host canvas').boundingBox();
      await desktop.mouse.move(area.x + area.width / 2, area.y + area.height / 2);
      await desktop.mouse.down();
      await desktop.mouse.move(area.x + area.width / 2 - 260, area.y + area.height / 2 + 60, { steps: 12 });
      await desktop.mouse.up();
      await desktop.mouse.wheel(0, 600);
      await sleep(600);
      const orbited = await framing(desktop);
      await shot(desktop, `a-box-scaled-${name}-orbited`);
      await desktop.click('#reset-view');
      await sleep(600);
      const resetFrame = await framing(desktop);
      const expectedLabels = ['X', 'Y', 'Z'].map((axis, index) => `${axis} ${dimensions[index]} m`);
      const inFrame = (frame) => frame.body.count > 1500 && frame.body.margin >= 2 && expectedLabels.every((text) => frame.labels.some((item) => item.text === text && item.inside));
      check(`a-box-generic-scale-${name}`, [], inFrame(initialFrame) && inFrame(resetFrame) && orbited.body.count > 500 && !(await selectionExists(A)), {
        dimensions,
        initial: initialFrame,
        orbited_body_pixels: orbited.body.count,
        reset: resetFrame,
      });
    }
    await fs.writeFile(catalogFile, original);
    await desktop.waitForFunction(() => document.querySelector('#box-host')?.dataset.renderedDimensions === '3,1,1.5');

    // 정의를 깨뜨렸다가 정확히 원래 바이트로 되돌리면 자동으로 회복하고 선택할 수 있다.
    expectingCatalogError = true;
    await fs.writeFile(catalogFile, '{"schema_version": 1, "revision": 2, "components": [{"id": "storage-panel"}]}\n');
    await desktop.waitForSelector('#notice:not([hidden])');
    await desktop.waitForFunction(() => document.querySelector('#connection').dataset.state === 'error');
    const brokenState = await desktop.evaluate(() => ({ notice: document.querySelector('#notice').textContent, ctaDisabled: document.querySelector('#select-button').disabled }));
    await shot(desktop, 'a-invalid-catalog');
    await fs.writeFile(catalogFile, original);
    await desktop.waitForSelector('#notice', { state: 'hidden' });
    await desktop.waitForFunction(() => document.querySelector('#connection').dataset.state === 'online' && !document.querySelector('#select-button').disabled);
    expectingCatalogError = false;
    await desktop.click('#select-button');
    await waitSaved(desktop, 'storage-panel', 'metal-blue');
    const savedA = await readSelection(A);
    await shot(desktop, 'a-recovered-and-selected');
    check(
      'a-invalid-catalog-then-exact-restore-recovers-and-selects',
      [],
      brokenState.ctaDisabled && /components\[0\]/.test(brokenState.notice) && savedA.component_id === 'storage-panel' && savedA.variant_id === 'metal-blue' && savedA.revision === 1 && expected.length > 0,
      { broken: brokenState, saved: savedA, expected_errors_while_broken: expected.length },
    );

    // 다시 읽어도 저장 선택이 유지되고 MCP도 같은 fingerprint·revision을 본다.
    await desktop.reload();
    await waitBox(desktop, 'storage-panel', 'metal-blue');
    const afterReload = await desktop.$eval('#current-selection', (node) => ({ ...node.dataset, text: node.textContent }));
    const webSelection = await (await fetch(new URL('api/selection', webA.url))).json();
    const client = await mcpClient(webA.url);
    const viaMcp = JSON.parse((await client.callTool({ name: 'get_selection', arguments: {} })).content[0].text);
    await client.close();
    check(
      'a-selection-persists-across-reload-and-mcp',
      ['@storage-panel-selection-persists'],
      afterReload.savedComponent === 'storage-panel' && afterReload.savedVariant === 'metal-blue' && afterReload.text.includes('보관 설비 패널 · 파란 금속') && viaMcp.revision === webSelection.revision && viaMcp.source.source_sha256 === webSelection.source.source_sha256 && viaMcp.status === 'current',
      { web: afterReload, mcp_revision: viaMcp.revision, web_revision: webSelection.revision },
    );

    // 3. B: 서비스 HTML preview, 내부 클릭 반응, variant 전환, 선택 저장.
    const selectionABytes = await fs.readFile(path.join(A, 'workbench', 'selection.json'));
    await fs.cp(path.join(FIXTURES, 'service-b', 'workbench'), path.join(B, 'workbench'), { recursive: true });
    const pageB = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    watch(pageB, 'desktop-b');
    await pageB.goto(webB.url);
    await waitHtml(pageB, 'button/primary.html');
    const preview = pageB.frameLocator('#html-host');
    const before = await preview.locator('#count').textContent();
    await preview.locator('#action').click();
    const afterClick = await preview.locator('#count').textContent();
    await shot(pageB, 'b-html-primary-clicked');
    check('b-html-preview-click-counter', ['@html-button-click-counter'], before === '클릭 0회' && afterClick === '클릭 1회' && (await preview.locator('#action').textContent()) === '저장 확정' && !(await selectionExists(B)), { before, after: afterClick });

    await pageB.click('[data-variant-id="secondary"]');
    await waitHtml(pageB, 'button/secondary.html');
    const secondaryLabel = await preview.locator('#action').textContent();
    const secondaryClass = await preview.locator('#action').getAttribute('class');
    await preview.locator('#action').click();
    await preview.locator('#action').click();
    const secondaryCount = await preview.locator('#count').textContent();
    await shot(pageB, 'b-html-secondary');
    check('b-html-variant-preview-override', ['@html-button-variant-preview'], secondaryLabel === '취소' && secondaryClass.includes('btn-secondary') && secondaryCount === '클릭 2회' && !(await selectionExists(B)), { label: secondaryLabel, class: secondaryClass, count: secondaryCount });

    await pageB.click('#select-button');
    await waitSaved(pageB, 'button', 'secondary');
    await pageB.reload();
    await waitHtml(pageB, 'button/secondary.html');
    const savedB = await readSelection(B);
    const lineB = await pageB.$eval('#current-selection', (node) => node.textContent);
    await shot(pageB, 'b-selected-after-reload');
    check(
      'b-selection-persists-and-a-is-untouched',
      ['@html-button-selection-persists'],
      savedB.component_id === 'button' && savedB.variant_id === 'secondary' && lineB.includes('HTML 버튼 · Secondary') && selectionABytes.equals(await fs.readFile(path.join(A, 'workbench', 'selection.json'))),
      { saved_b: savedB, line: lineB },
    );

    // 4. 390px: 가로 넘침 없음, 머리글 글자 줄바꿈 없음, 모든 컨트롤 접근·조작 가능.
    for (const [name, web, service, target] of [
      ['a-390', webA, A, null],
      ['b-390', webB, B, { component: 'button', variant: 'primary' }],
    ]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
      watch(page, name);
      await page.goto(web.url);
      if (service === A) await waitBox(page, 'storage-panel', 'metal-blue');
      else await waitHtml(page, 'button/secondary.html');
      await shot(page, `${name}-top`);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      const header = await headerSingleLine(page);
      const previewHeight = (await page.locator('.viewport').boundingBox()).height;
      const controls = {};
      for (const selector of ['#docs-toggle', ...(await page.$$eval('[data-component-id], [data-variant-id]', (nodes) => nodes.map((node) => (node.dataset.variantId ? `[data-variant-id="${node.dataset.variantId}"]` : `[data-component-id="${node.dataset.componentId}"]`)))), '#select-button']) {
        controls[selector] = await reach(page, selector);
      }
      if (service === A) controls['#reset-view'] = await reach(page, '#reset-view');
      let saved = null;
      if (target) {
        await page.click(`[data-variant-id="${target.variant}"]`);
        await waitHtml(page, 'button/primary.html');
        controls['#select-button'] = await reach(page, '#select-button');
        await shot(page, `${name}-variant-and-action`);
        await page.click('#select-button');
        await waitSaved(page, target.component, target.variant);
        saved = await readSelection(service);
      } else {
        await reach(page, '#select-button');
        await shot(page, `${name}-action`);
      }
      await page.click('#docs-toggle');
      const drawer = await page.$eval('#docs-drawer', (node) => {
        const box = node.getBoundingClientRect();
        return { width: Math.round(box.width), close: document.querySelector('#docs-close').getBoundingClientRect().right <= window.innerWidth };
      });
      await shot(page, `${name}-docs`);
      await page.keyboard.press('Escape');
      check(
        `layout-${name}`,
        [],
        overflow <= 1 && header.every((item) => item.singleLine) && previewHeight >= 300 && Object.values(controls).every((item) => item.inViewport && item.unobstructed) && drawer.close && (!target || (saved.variant_id === target.variant && saved.revision === 2)),
        { horizontal_overflow_px: overflow, header, preview_height: previewHeight, controls, drawer, saved },
      );
      await page.close();
    }

    check('no-unexpected-console-or-http-errors', [], problems.length === 0, { unexpected: problems, expected_while_catalog_broken: expected.length });
  } finally {
    await browser?.close();
    for (const server of servers) await stopWorkbench(server).catch(() => {});
    await fs.rm(work, { recursive: true, force: true });
    const report = {
      kind: 'component-workbench-browser-qa',
      services: 'npm pack tarball installed into two fresh temporary services; `npx component-workbench init`, `npm run workbench` on free ports; fixtures copied only into those services',
      environment: { ...environment, fonts_note: 'Linux host fonts; Korean glyphs differ from Windows/macOS browsers.' },
      passed: results.length > 0 && results.every((item) => item.ok),
      results,
      screenshots,
    };
    await fs.writeFile(path.join(REPORT_DIR, 'browser-qa.json'), `${JSON.stringify(report, null, 2)}\n`);
    process.stdout.write(`report: .cache/browser-qa/browser-qa.json\n`);
    if (!report.passed) process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
