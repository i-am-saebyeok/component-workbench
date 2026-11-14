// 웹 API·HTTP MCP·stdio MCP가 함께 쓰는 단일 서비스. 서비스 정의는 읽기 전용이고
// 쓰는 파일은 config의 selection 하나다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { PATH_STATE_KO, absolutePath, inspectServicePath } from './config.js';
import type { LoadedConfig } from './config.js';
import { WorkbenchError } from './errors.js';
import { scenarioIds } from './gherkin.js';
import { readSelection, withSelectionLock, writeSelectionAtomic } from './selection-store.js';
import type { StoredSelection } from './selection-store.js';
import { ComponentSchema, Id, SHA256_PATTERN, z, zodProblems } from './schemas.js';
import type { Catalog, Component, Preview, Variant } from './schemas.js';
import { HASH_METHOD, checkCatalog, loadSource } from './source.js';
import type { SourceBundle, SourceDocument } from './source.js';

export const DOC_URI_PREFIX = 'workbench://docs/';

export const ComponentQuery = z
  .object({
    component_id: Id.describe('컴포넌트 ID'),
    variant_id: Id.optional().describe('variant ID. 생략하면 모든 variant를 돌려준다.'),
  })
  .strict();

export const ValidateInput = z
  .object({
    component_id: Id.optional().describe('선택 가능 여부를 검사할 컴포넌트 ID'),
    variant_id: Id.nullable().optional().describe('함께 검사할 variant ID. variant가 없는 컴포넌트는 null 또는 생략'),
    definition: z
      .record(z.string(), z.unknown())
      .optional()
      .describe('catalog에 넣기 전에 검사할 컴포넌트 정의 후보. 같은 ID가 있으면 그 정의를 대신한다.'),
  })
  .strict();

export const SelectInput = z
  .object({
    component_id: Id.describe('저장할 컴포넌트 ID'),
    variant_id: Id.nullable().optional().describe('저장할 variant ID. variant가 없는 컴포넌트는 null 또는 생략'),
    expected_selection_revision: z.int().nonnegative().describe('호출자가 마지막으로 읽은 selection revision. 선택이 없으면 0'),
    expected_source_sha256: z.string().regex(SHA256_PATTERN, 'sha256 hex 64자').describe('호출자가 마지막으로 읽은 source.source_sha256'),
  })
  .strict();

/** 선택할 수 없는 이유 또는 저장 선택과 현재 원본의 차이. */
type Reason = { code: 'unknown_component' | 'variant_required' | 'unknown_variant' | 'variant_not_available' | 'source_changed'; message_ko: string };

/** 웹·MCP가 보는 문서 항목. `path`는 docs_root 기준이다. */
export type DocumentEntry = { path: string; uri: string; sha256: string; scenario_ids: string[] };
export type DocumentText = DocumentEntry & { text: string };

function parse<S extends z.ZodType>(schema: S, input: unknown): z.output<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    throw new WorkbenchError('invalid_request', '요청 형식이 계약과 다르다. 정의되지 않은 필드나 잘못된 값은 받지 않는다.', {
      problems: zodProblems(result.error),
    });
  }
  return result.data;
}

const effectivePreview = (component: Component, variant: Variant | null | undefined): Preview | null => variant?.preview ?? component.preview ?? null;

/** 컴포넌트·variant 조합이 선택 가능한지 검사한다. variant가 없는 컴포넌트의 variant는 null이다. */
function checkPair(catalog: Catalog, componentId: string, variantId: string | null | undefined) {
  const reasons: Reason[] = [];
  const component = catalog.components.find((item) => item.id === componentId) ?? null;
  let variant: Variant | null = null;
  if (!component) {
    const known = catalog.components.map((item) => item.id);
    reasons.push({
      code: 'unknown_component',
      message_ko: known.length > 0 ? `컴포넌트 ID ${componentId}는 catalog에 없다. 등록된 ID: ${known.join(', ')}.` : `컴포넌트 ID ${componentId}는 catalog에 없다. 등록된 컴포넌트가 없다.`,
    });
  } else if (component.variants.length > 0) {
    const known = component.variants.map((item) => item.id).join(', ');
    if (variantId === null || variantId === undefined) {
      reasons.push({ code: 'variant_required', message_ko: `${component.id}는 variant를 골라야 한다. 가능한 variant: ${known}.` });
    } else {
      variant = component.variants.find((item) => item.id === variantId) ?? null;
      if (!variant) reasons.push({ code: 'unknown_variant', message_ko: `${component.id}에 variant ${variantId}가 없다. 가능한 variant: ${known}.` });
    }
  } else if (variantId !== null && variantId !== undefined) {
    reasons.push({ code: 'variant_not_available', message_ko: `${component.id}에는 variant가 없다. variant_id는 null이거나 생략해야 한다.` });
  }
  return { component, variant, reasons };
}

const documentEntry = (doc: SourceDocument): DocumentEntry => ({ path: doc.path, uri: DOC_URI_PREFIX + doc.path, sha256: doc.sha256, scenario_ids: doc.scenario_ids });
const documentText = (doc: SourceDocument): DocumentText => ({ ...documentEntry(doc), text: doc.text });

/** 컴포넌트가 연결한 문서(bdd 순서). loadSource가 모든 참조 문서를 읽었는지 이미 검사했다. */
function componentDocuments(bundle: SourceBundle, component: Component): SourceDocument[] {
  return component.bdd.map((reference) => {
    const doc = bundle.documents.find((item) => item.path === reference);
    if (!doc) throw new Error(`${reference}가 검증한 원본 묶음에 없다.`);
    return doc;
  });
}

export function createWorkbenchService(config: LoadedConfig, { lockWaitMs }: { lockWaitMs?: number } = {}) {
  const selectionFile = absolutePath(config, config.selection);
  const workbench = { name: config.name, title: config.title, catalog: config.catalog };

  const identity = (bundle: SourceBundle) => ({
    catalog_path: config.catalog,
    catalog_revision: bundle.catalog.revision,
    catalog_sha256: bundle.catalogSha256,
    source_sha256: bundle.sourceSha256,
  });

  async function checkSelectionPath() {
    const info = await inspectServicePath(config, config.selection);
    if (info.state === 'missing' || info.state === 'file') return;
    throw new WorkbenchError('selection_unreadable', `${config.selection}: ${PATH_STATE_KO[info.state]}.`);
  }

  async function storedSelection() {
    await checkSelectionPath();
    return readSelection(selectionFile, config.selection);
  }

  function describeSelection(bundle: SourceBundle, stored: StoredSelection) {
    const base = { path: config.selection, source: identity(bundle) };
    if (!stored.selection) return { ...base, status: 'none' as const, revision: 0, sha256: null, selection: null, component: null, variant: null, issues: [] };
    const { selection } = stored;
    const { component, variant, reasons } = checkPair(bundle.catalog, selection.component_id, selection.variant_id);
    const issues = [...reasons];
    if (selection.source_sha256 !== bundle.sourceSha256) {
      issues.push({
        code: 'source_changed',
        message_ko: `선택은 원본 ${selection.source_sha256.slice(0, 12)}…(catalog revision ${selection.catalog_revision})에서 저장됐고 현재 원본은 ${bundle.sourceSha256.slice(0, 12)}…(revision ${bundle.catalog.revision})이다. 다시 선택해야 현재 정의에 고정된다.`,
      });
    }
    const status: 'unresolvable' | 'stale_source' | 'current' = reasons.length > 0 ? 'unresolvable' : issues.length > 0 ? 'stale_source' : 'current';
    return { ...base, status, revision: selection.revision, sha256: stored.sha256, selection, component, variant, issues };
  }

  /** 정의·문서·fingerprint·선택 해석을 한 번 읽은 원본에서 만든다. */
  async function catalogView<D>(toDocument: (doc: SourceDocument) => D) {
    const bundle = await loadSource(config);
    return {
      workbench,
      source: identity(bundle),
      components: bundle.catalog.components,
      documents: bundle.documents.map(toDocument),
      selection: describeSelection(bundle, await storedSelection()),
    };
  }

  /** withText는 웹 문서 패널용이다(문서 원문 포함). */
  function listComponents(options?: { withText?: false }): ReturnType<typeof catalogView<DocumentEntry>>;
  function listComponents(options: { withText: true }): ReturnType<typeof catalogView<DocumentText>>;
  function listComponents({ withText = false }: { withText?: boolean } = {}) {
    return withText ? catalogView(documentText) : catalogView(documentEntry);
  }

  return {
    config,
    listComponents,

    async getComponent(input: unknown) {
      const request = parse(ComponentQuery, input);
      const bundle = await loadSource(config);
      const component = bundle.catalog.components.find((item) => item.id === request.component_id);
      if (!component) {
        throw new WorkbenchError('not_found', `컴포넌트 ID ${request.component_id}는 catalog에 없다.`, {
          component_ids: bundle.catalog.components.map((item) => item.id),
        });
      }
      const variants = request.variant_id === undefined ? component.variants : component.variants.filter((item) => item.id === request.variant_id);
      if (variants.length === 0 && request.variant_id !== undefined) {
        throw new WorkbenchError('not_found', `${component.id}에 variant ${request.variant_id}가 없다.`, { variant_ids: component.variants.map((item) => item.id) });
      }
      return {
        workbench,
        source: identity(bundle),
        component,
        variants,
        preview: effectivePreview(component, request.variant_id === undefined ? null : variants[0]),
        documents: componentDocuments(bundle, component).map(documentText),
        selection: describeSelection(bundle, await storedSelection()),
      };
    },

    async validateComponent(input: unknown) {
      const { component_id: componentId, variant_id: variantId, definition } = parse(ValidateInput, input);
      if ((definition !== undefined) === (componentId !== undefined) || (definition !== undefined && variantId !== undefined)) {
        throw new WorkbenchError('invalid_request', 'component_id(+variant_id) 또는 definition 중 하나만 준다.');
      }
      const bundle = await loadSource(config);
      const base = { source: identity(bundle), writes: false, scenarios_executed: false };
      if (componentId !== undefined) {
        const { component, variant, reasons } = checkPair(bundle.catalog, componentId, variantId);
        return {
          ...base,
          valid: reasons.length === 0,
          component_id: componentId,
          variant_id: variant?.id ?? null,
          preview: component && reasons.length === 0 ? effectivePreview(component, variant) : null,
          reasons,
          documents: component ? componentDocuments(bundle, component).map(documentEntry) : [],
        };
      }
      // 위 검사로 여기서는 definition만 주어졌다.
      const parsed = ComponentSchema.safeParse(definition);
      if (!parsed.success) {
        return { ...base, valid: false, component_id: definition?.id ?? null, reasons: zodProblems(parsed.error, 'definition'), documents: [] };
      }
      const candidate = parsed.data;
      const components = bundle.catalog.components.some((item) => item.id === candidate.id)
        ? bundle.catalog.components.map((item) => (item.id === candidate.id ? candidate : item))
        : [...bundle.catalog.components, candidate];
      const checked = await checkCatalog(config, { ...bundle.catalog, components });
      const index = components.indexOf(candidate);
      const reasons = checked.problems.map((item) => ({ ...item, at: item.at.replace(`components[${index}]`, 'definition') }));
      return {
        ...base,
        valid: reasons.length === 0,
        component_id: candidate.id,
        reasons,
        documents: checked.documents
          .filter((doc) => candidate.bdd.includes(doc.path))
          .map((doc) => ({ path: doc.path, scenario_ids: scenarioIds(doc.scenarios) })),
      };
    },

    async getSelection() {
      const bundle = await loadSource(config);
      return describeSelection(bundle, await storedSelection());
    },

    async selectComponent(input: unknown) {
      const request = parse(SelectInput, input);
      const variantId = request.variant_id ?? null;
      await checkSelectionPath();
      const directory = path.posix.dirname(config.selection);
      if (directory !== '.') {
        await fs.mkdir(absolutePath(config, directory), { recursive: true });
        const info = await inspectServicePath(config, directory);
        if (info.state !== 'directory') throw new WorkbenchError('selection_unreadable', `${directory}: ${info.state === 'file' ? '디렉토리가 아니다' : PATH_STATE_KO[info.state]}.`);
      }
      return withSelectionLock(
        selectionFile,
        async (lock) => {
          // 비교와 쓰기가 같은 순간을 가리키도록 원본과 선택을 모두 잠금 안에서 읽는다.
          const bundle = await loadSource(config);
          const { reasons } = checkPair(bundle.catalog, request.component_id, variantId);
          if (reasons.length > 0) throw new WorkbenchError('invalid_selection', '선택할 수 있는 컴포넌트·variant 조합이 아니다. 기존 선택을 유지한다.', { reasons });

          const stored = await storedSelection();
          const current = describeSelection(bundle, stored);
          if (request.expected_source_sha256 !== bundle.sourceSha256) {
            throw new WorkbenchError('source_conflict', '호출자가 읽은 원본 fingerprint가 현재 원본과 다르다. 최신 정의·문서와 선택을 다시 읽은 뒤 선택한다.', {
              expected_source_sha256: request.expected_source_sha256,
              current,
            });
          }
          if (request.expected_selection_revision !== current.revision) {
            throw new WorkbenchError('selection_conflict', `selection revision이 ${request.expected_selection_revision}이 아니라 ${current.revision}이다. 먼저 저장된 선택을 덮어쓰지 않는다.`, {
              expected_selection_revision: request.expected_selection_revision,
              current,
            });
          }
          const unchanged =
            stored.selection &&
            stored.selection.component_id === request.component_id &&
            stored.selection.variant_id === variantId &&
            stored.selection.source_sha256 === bundle.sourceSha256 &&
            stored.selection.catalog_revision === bundle.catalog.revision;
          if (unchanged) return { changed: false, ...current };

          await writeSelectionAtomic(
            selectionFile,
            {
              schema_version: 1,
              revision: current.revision + 1,
              component_id: request.component_id,
              variant_id: variantId,
              catalog_revision: bundle.catalog.revision,
              source_sha256: bundle.sourceSha256,
            },
            lock,
          );
          return { changed: true, ...describeSelection(bundle, await storedSelection()) };
        },
        { waitMs: lockWaitMs },
      );
    },

    /** 읽은 원본 파일에 고정한 제작 입력. 아무것도 쓰지 않는다. */
    async getRecipe() {
      const bundle = await loadSource(config);
      const current = describeSelection(bundle, await storedSelection());
      if (current.status === 'none') throw new WorkbenchError('selection_missing', '저장된 선택이 없다. select_component로 먼저 선택한다.');
      // current 상태는 선택한 컴포넌트가 정의에 있다는 뜻이다.
      const { component, variant } = current;
      if (current.status !== 'current' || !component) throw new WorkbenchError('selection_stale', '저장된 선택이 현재 원본과 맞지 않아 제작 입력으로 쓸 수 없다.', { issues: current.issues });
      return {
        schema_version: 1,
        kind: 'component-workbench/selection-recipe',
        workbench: { name: config.name, title: config.title },
        source: { ...identity(bundle), files: bundle.files, hash_method: HASH_METHOD },
        selection: { path: config.selection, revision: current.revision, sha256: current.sha256 },
        component,
        variant,
        preview: effectivePreview(component, variant),
        // recipe의 모든 경로는 서비스 루트 기준이다(웹·MCP 문서 경로는 docs_root 기준).
        documents: componentDocuments(bundle, component).map(({ path: docPath, sha256, scenario_ids }) => ({
          path: `${config.docs_root}/${docPath}`,
          sha256,
          scenario_ids,
        })),
      };
    },

    /** 현재 원본 묶음에 속한 문서만 읽는다(docs_root 기준 경로). */
    async readDocument(docPath: string) {
      const bundle = await loadSource(config);
      const doc = bundle.documents.find((item) => item.path === docPath);
      if (!doc) throw new WorkbenchError('not_found', `문서 ${docPath}는 원본 묶음에 없다.`, { documents: bundle.documents.map((item) => item.path) });
      return documentText(doc);
    },
  };
}

export type WorkbenchService = ReturnType<typeof createWorkbenchService>;
