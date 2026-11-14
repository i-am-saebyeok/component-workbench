// 서비스 원본(catalog, docs_root/README.md, 연결된 .feature, preview_root 파일)을 호출마다
// 디스크에서 새로 읽어, 해시가 실제로 읽은 바이트를 가리키게 한다. 이 모듈은 쓰지 않는다.
import { createHash } from 'node:crypto';
import type { BinaryLike } from 'node:crypto';
import fs from 'node:fs/promises';
import { PATH_STATE_KO, absolutePath, inspectServicePath } from './config.js';
import type { LoadedConfig } from './config.js';
import { WorkbenchError, messageOf } from './errors.js';
import { parseFeature, scenarioIds } from './gherkin.js';
import type { Scenario } from './gherkin.js';
import { CatalogSchema, zodProblems } from './schemas.js';
import type { Catalog, Preview, Problem } from './schemas.js';

export const DOCS_README = 'README.md';
export const HASH_METHOD = 'sha256 of "<file sha256>  <path>\\n" lines sorted by path (UTF-8 byte order); paths are relative to the service root';

/** 원본 파일 하나의 서비스 루트 기준 경로와 sha256. */
export type SourceFile = { path: string; sha256: string };
/** checkCatalog가 읽은 문서. `path`는 docs_root 기준, `file`은 서비스 루트 기준이다. */
type ReadDocument = { path: string; file: string; bytes: Buffer; scenarios: Scenario[] };
/** 원본 묶음의 문서. `path`는 docs_root 기준이다. */
export type SourceDocument = { path: string; sha256: string; text: string; scenarios: Scenario[]; scenario_ids: string[] };
export type SourceBundle = { catalog: Catalog; catalogSha256: string; sourceSha256: string; files: SourceFile[]; documents: SourceDocument[] };

export const sha256 = (data: BinaryLike): string => createHash('sha256').update(data).digest('hex');

export function sourceFingerprint(files: SourceFile[]): string {
  return sha256(files.map((file) => `${file.sha256}  ${file.path}\n`).join(''));
}

const byPath = (a: SourceFile, b: SourceFile) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path));

function invalid(message: string, problems?: Problem[]) {
  return new WorkbenchError('catalog_invalid', `서비스 정의를 사용할 수 없다: ${message}`, problems ? { problems } : undefined);
}

/** 서비스 파일 하나를 읽는다. 없으면 null, 링크·디렉토리 등은 문제로 보고한다. */
async function readServiceFile(config: LoadedConfig, relative: string, at: string, problems: Problem[]): Promise<Buffer | null> {
  const info = await inspectServicePath(config, relative);
  if (info.state === 'missing') return null;
  if (info.state !== 'file') {
    problems.push({ at, message_ko: `${relative}: ${PATH_STATE_KO[info.state]}.` });
    return null;
  }
  return fs.readFile(info.absolute);
}

/** preview_root 아래 모든 일반 파일(서비스 기준 경로·바이트). 심볼릭 링크는 문제로 보고한다. */
async function previewFiles(config: LoadedConfig, problems: Problem[]): Promise<{ path: string; bytes: Buffer }[]> {
  const root = await inspectServicePath(config, config.preview_root);
  if (root.state === 'missing') return [];
  if (root.state !== 'directory') {
    problems.push({ at: 'preview_root', message_ko: `${config.preview_root}: ${root.state === 'file' ? '디렉토리가 아니다' : PATH_STATE_KO[root.state]}.` });
    return [];
  }
  const files: { path: string; bytes: Buffer }[] = [];
  async function walk(relative: string) {
    for (const entry of await fs.readdir(absolutePath(config, relative), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) problems.push({ at: 'preview_root', message_ko: `${child}: ${PATH_STATE_KO.symlink}.` });
      else if (entry.isDirectory()) await walk(child);
      else if (entry.isFile()) files.push({ path: child, bytes: await fs.readFile(absolutePath(config, child)) });
    }
  }
  await walk(config.preview_root);
  return files;
}

/**
 * catalog JSON 값을 서비스 파일과 대조한다. schema, ID 중복, BDD 파일·Gherkin 구조·태그
 * 유일성, HTML preview 파일 존재를 검사하고 문제 목록과 읽은 원본을 돌려준다.
 * schema가 맞지 않으면 catalog는 null이다.
 */
export async function checkCatalog(
  config: LoadedConfig,
  json: unknown,
): Promise<{ catalog: Catalog | null; problems: Problem[]; documents: ReadDocument[]; files: SourceFile[] }> {
  const parsed = CatalogSchema.safeParse(json);
  if (!parsed.success) return { catalog: null, problems: zodProblems(parsed.error), documents: [], files: [] };
  const catalog = parsed.data;
  const problems: Problem[] = [];

  const componentIds = new Map<string, string>();
  catalog.components.forEach((component, index) => {
    const at = `components[${index}]`;
    if (componentIds.has(component.id)) problems.push({ at: `${at}.id`, message_ko: `컴포넌트 ID ${component.id}가 ${componentIds.get(component.id)}와 중복된다.` });
    else componentIds.set(component.id, at);
    const variantIds = new Set<string>();
    component.variants.forEach((variant, variantIndex) => {
      if (variantIds.has(variant.id)) problems.push({ at: `${at}.variants[${variantIndex}].id`, message_ko: `${component.id}의 variant ID ${variant.id}가 중복된다.` });
      variantIds.add(variant.id);
    });
  });

  const documents: ReadDocument[] = [];
  const readmePath = `${config.docs_root}/${DOCS_README}`;
  const readme = await readServiceFile(config, readmePath, 'docs_root', problems);
  if (readme) documents.push({ path: DOCS_README, file: readmePath, bytes: readme, scenarios: [] });

  // 같은 .feature를 여러 컴포넌트가 참조해도 한 번만 읽고 검사한다.
  const features = new Map<string, Buffer | null>();
  const tagOwners = new Map<string, string>();
  for (const [index, component] of catalog.components.entries()) {
    for (const [refIndex, reference] of component.bdd.entries()) {
      const at = `components[${index}].bdd[${refIndex}]`;
      if (features.has(reference)) continue;
      const file = `${config.docs_root}/${reference}`;
      const bytes = await readServiceFile(config, file, at, problems);
      features.set(reference, bytes);
      if (!bytes) {
        if (!problems.some((item) => item.at === at)) problems.push({ at, message_ko: `BDD 문서 ${file}가 없다.` });
        continue;
      }
      const { scenarios, problems: featureProblems } = parseFeature(bytes.toString('utf8'));
      for (const item of featureProblems) problems.push({ at: `${file}:${item.line}`, message_ko: item.message_ko });
      for (const scenario of scenarios) {
        for (const tag of new Set(scenario.tags)) {
          const where = `${file}:${scenario.line}`;
          if (tagOwners.has(tag)) {
            problems.push({ at: where, message_ko: `시나리오 태그 ${tag}가 ${tagOwners.get(tag)}에도 있다. 시나리오 태그는 서비스 안에서 한 시나리오에만 붙인다.` });
          } else {
            tagOwners.set(tag, where);
          }
        }
      }
      documents.push({ path: reference, file, bytes, scenarios });
    }
  }

  const previews = catalog.components.flatMap((component, index): [string, Preview | undefined][] => [
    [`components[${index}].preview`, component.preview],
    ...component.variants.map((variant, variantIndex): [string, Preview | undefined] => [`components[${index}].variants[${variantIndex}].preview`, variant.preview]),
  ]);
  for (const [at, preview] of previews) {
    if (preview?.type !== 'html') continue;
    const file = `${config.preview_root}/${preview.src}`;
    const info = await inspectServicePath(config, file);
    if (info.state !== 'file') problems.push({ at: `${at}.src`, message_ko: `HTML preview ${file}: ${PATH_STATE_KO[info.state]}.` });
  }

  const files = [
    ...documents.map((doc) => ({ path: doc.file, sha256: sha256(doc.bytes) })),
    ...(await previewFiles(config, problems)).map((file) => ({ path: file.path, sha256: sha256(file.bytes) })),
  ];
  return { catalog, problems, documents, files };
}

/** 검증한 서비스 원본 묶음. 정의 오류는 catalog_invalid로 문제 목록과 함께 거부한다. */
export async function loadSource(config: LoadedConfig): Promise<SourceBundle> {
  const problems: Problem[] = [];
  const raw = await readServiceFile(config, config.catalog, 'catalog', problems);
  if (!raw) throw invalid(`${config.catalog}를 읽을 수 없다.`, problems.length > 0 ? problems : [{ at: 'catalog', message_ko: `${config.catalog}가 없다.` }]);
  let json: unknown;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch (error) {
    throw invalid(`${config.catalog} JSON 구문 오류 (${messageOf(error)}).`);
  }
  const checked = await checkCatalog(config, json);
  if (!checked.catalog || checked.problems.length > 0) throw invalid(`${config.catalog}와 연결 파일이 계약과 다르다.`, checked.problems);

  const catalogFile = { path: config.catalog, sha256: sha256(raw) };
  // 경로가 겹치는 설정(예: preview_root 안의 .feature)에서도 파일은 한 번만 센다.
  const files = [...new Map([catalogFile, ...checked.files].map((file) => [file.path, file])).values()].sort(byPath);
  return {
    catalog: checked.catalog,
    catalogSha256: catalogFile.sha256,
    sourceSha256: sourceFingerprint(files),
    files,
    documents: checked.documents.map((doc) => ({
      path: doc.path,
      sha256: sha256(doc.bytes),
      text: doc.bytes.toString('utf8'),
      scenarios: doc.scenarios,
      scenario_ids: scenarioIds(doc.scenarios),
    })),
  };
}
