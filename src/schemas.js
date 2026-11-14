// 서비스가 소유하는 파일(config·catalog·selection)의 schema_version 1 계약.
// 특정 서비스의 ID·치수·재질·규칙은 여기에 두지 않는다.
import * as z from 'zod';

z.config(z.locales.ko());

// 서비스 루트 기준 POSIX 상대 경로의 한 구성 요소. 숨김 이름·`.`·`..`을 허용하지 않는다.
const SEGMENT = '[A-Za-z0-9_-][A-Za-z0-9._-]*';
const relativePath = (suffix = '') => new RegExp(`^${SEGMENT}(?:/${SEGMENT})*${suffix.replace('.', '\\.')}$`);
const PATH_HINT = '상대 경로(영문·숫자·_-. 구성, 숨김 이름·..·절대 경로 불가)';

export const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export const Id = z.string().regex(ID_PATTERN, 'ID는 영문·숫자로 시작하고 영문·숫자·_.-로 된 64자 이하여야 한다.');
const Text = z.string().min(1);
const Sha256 = z.string().regex(SHA256_PATTERN, 'sha256 hex 64자');

export const ServiceName = z
  .string()
  .max(50)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'name은 소문자·숫자·하이픈으로 된 서비스 slug여야 한다.');
export const Title = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[^\u0000-\u001f\u007f]+$/, 'title에는 제어 문자를 쓸 수 없다.');

const JsonPath = z.string().regex(relativePath('.json'), `.json으로 끝나는 서비스 루트 기준 ${PATH_HINT}`);
const DirPath = z.string().regex(relativePath(), `서비스 루트 기준 ${PATH_HINT}`);

export const ConfigSchema = z
  .object({
    $schema: z.string().optional(),
    schema_version: z.literal(1),
    name: ServiceName,
    title: Title,
    catalog: JsonPath,
    selection: JsonPath,
    docs_root: DirPath,
    preview_root: DirPath,
    server: z.object({ port: z.int().min(1).max(65535) }).strict(),
  })
  .strict();

const Material = z
  .object({
    base_color_srgb_hex: z.string().regex(/^#[0-9A-Fa-f]{6}$/, '#RRGGBB 형식의 sRGB 색'),
    roughness: z.number().min(0).max(1),
    metallic: z.number().min(0).max(1),
  })
  .strict();

const BoxPreview = z
  .object({
    type: z.literal('box'),
    dimensions_m: z.tuple([z.number().positive(), z.number().positive(), z.number().positive()]),
  })
  .strict();

const HtmlPreview = z
  .object({
    type: z.literal('html'),
    src: z.string().regex(relativePath('.html'), `.html로 끝나는 preview_root 기준 ${PATH_HINT}`),
  })
  .strict();

export const PREVIEW_TYPES = ['box', 'html'];

const Preview = z.discriminatedUnion('type', [BoxPreview, HtmlPreview], {
  error: (issue) => (issue.code === 'invalid_union' ? `preview.type은 ${PREVIEW_TYPES.join(' 또는 ')}만 지원한다.` : undefined),
});

const Variant = z
  .object({
    id: Id,
    name: Text,
    material: Material.optional(),
    preview: Preview.optional(),
  })
  .strict();

export const ComponentSchema = z
  .object({
    id: Id,
    name: Text,
    description: Text,
    intended_uses: z.array(Text),
    avoid_uses: z.array(Text),
    bdd: z.array(z.string().regex(relativePath('.feature'), `.feature로 끝나는 docs_root 기준 ${PATH_HINT}`)),
    preview: Preview.optional(),
    variants: z.array(Variant),
  })
  .strict();

export const CatalogSchema = z
  .object({
    $schema: z.string().optional(),
    schema_version: z.literal(1),
    revision: z.int().positive(),
    components: z.array(ComponentSchema),
  })
  .strict();

export const SelectionSchema = z
  .object({
    schema_version: z.literal(1),
    revision: z.int().positive(),
    component_id: Id,
    variant_id: Id.nullable(),
    catalog_revision: z.int().positive(),
    source_sha256: Sha256,
  })
  .strict();

/** zod 문제를 `at`(JSON 경로)·`message_ko` 목록으로 바꾼다. */
export function zodProblems(error, prefix = '') {
  return error.issues.map((issue) => ({
    at: issue.path.reduce((at, key) => (typeof key === 'number' ? `${at}[${key}]` : at ? `${at}.${String(key)}` : String(key)), prefix),
    message_ko: issue.message,
  }));
}

export { z };

/** 패키지 `schema/`에 싣는 JSON Schema(편집기 보조용). 이 zod 정의에서 생성한다. */
export function jsonSchemas() {
  const render = (schema, title) => `${JSON.stringify({ title, ...z.toJSONSchema(schema, { io: 'input' }) }, null, 2)}\n`;
  return {
    'schema/config.schema.json': render(ConfigSchema, 'component-workbench.config.json'),
    'schema/catalog.schema.json': render(CatalogSchema, 'component-workbench catalog'),
  };
}
