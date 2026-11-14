// 공통 서비스 위의 MCP 표면. Streamable HTTP(요청마다 새 인스턴스)와 stdio(연결마다 하나)가
// 같은 factory를 쓴다. 원본 읽기·검증·선택 저장만 노출하고 파일 접근 도구는 없다.
import { McpServer, ResourceNotFoundError, ResourceTemplate } from '@modelcontextprotocol/server';
import type { CallToolResult, TextContent } from '@modelcontextprotocol/server';
import { mcpServerName } from './config.js';
import { toWorkbenchError } from './errors.js';
import { PACKAGE } from './package.js';
import { z } from './schemas.js';
import { ComponentQuery, DOC_URI_PREFIX, SelectInput, ValidateInput } from './service.js';
import type { WorkbenchService } from './service.js';

const INSTRUCTIONS = [
  '이 서비스가 소유한 컴포넌트 카탈로그다. 컴포넌트·variant·preview·용도/BDD는 서비스 파일에서 읽으며 도구에 기본 컴포넌트는 없다.',
  '선택 전에 get_component로 description·intended_uses·avoid_uses와 연결된 BDD 원문을 읽는다. 외형이나 이름에서 구현되지 않은 기능·물성·업무 규칙을 추론하지 않는다.',
  'select_component에는 get_selection(또는 list_components)에서 읽은 selection revision과 source.source_sha256을 넣는다. 충돌하면 다시 읽고 판단한다.',
  '정의 편집·새 컴포넌트 저장 기능은 없다. 정의는 서비스의 catalog 파일을 고치고 validate_component로 검사한다. BDD 시나리오는 실행하지 않는다.',
].join('\n');

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const NO_INPUT = z.object({}).strict();

const jsonText = (data: unknown): TextContent => ({ type: 'text', text: JSON.stringify(data, null, 2) });

/** 서비스 호출을 실행하고 공통 오류를 MCP tool 오류 결과로 바꾼다. */
async function toolResult(run: () => Promise<{ data: unknown; extra?: TextContent[] }>): Promise<CallToolResult> {
  try {
    const { data, extra = [] } = await run();
    return { content: [jsonText(data), ...extra] };
  } catch (error) {
    return { isError: true, content: [jsonText({ error: toWorkbenchError(error).toJSON() })] };
  }
}

const mimeTypeFor = (docPath: string) => (docPath.endsWith('.md') ? 'text/markdown' : 'text/plain');

export function createMcpServer(service: WorkbenchService): McpServer {
  const { config } = service;
  const server = new McpServer({ name: mcpServerName(config.name), title: config.title, version: PACKAGE.version }, { instructions: INSTRUCTIONS });

  server.registerTool(
    'list_components',
    {
      title: '컴포넌트 목록',
      description: '서비스 catalog의 모든 컴포넌트 정의(variant·preview·용도·BDD 경로), 원본 식별값(catalog revision·sha256·source_sha256), 문서 목록(resource URI·시나리오 ID), 현재 저장 선택을 돌려준다. 등록된 컴포넌트가 없으면 빈 배열이다.',
      inputSchema: NO_INPUT,
      annotations: { title: '컴포넌트 목록', ...READ_ONLY },
    },
    async () => toolResult(async () => ({ data: await service.listComponents() })),
  );

  server.registerTool(
    'get_component',
    {
      title: '컴포넌트 상세와 BDD',
      description: '컴포넌트 하나(선택적으로 variant 하나)의 정의, 적용 preview, 연결 BDD 문서의 sha256·시나리오 ID와 현재 선택을 돌려준다. 첫 content 항목은 메타데이터 JSON이고 이어지는 항목이 BDD 원문이다.',
      inputSchema: ComponentQuery,
      annotations: { title: '컴포넌트 상세와 BDD', ...READ_ONLY },
    },
    async (input) =>
      toolResult(async () => {
        const { documents, ...rest } = await service.getComponent(input);
        return {
          data: { ...rest, documents: documents.map(({ text, ...meta }) => meta) },
          extra: documents.map((doc): TextContent => ({ type: 'text', text: `# ${doc.path} (sha256 ${doc.sha256})\n\n${doc.text}` })),
        };
      }),
  );

  server.registerTool(
    'validate_component',
    {
      title: '컴포넌트 검사',
      description: 'component_id(+variant_id)를 주면 그 조합을 선택할 수 있는지, definition을 주면 그 정의 후보를 현재 catalog에 넣었을 때 schema·ID 중복·BDD 파일/Gherkin 구조/태그 유일성·HTML preview 파일 검사를 통과하는지 이유와 함께 보고한다. 아무것도 저장하지 않고 BDD 시나리오를 실행하지 않는다.',
      inputSchema: ValidateInput,
      annotations: { title: '컴포넌트 검사', ...READ_ONLY },
    },
    async (input) => toolResult(async () => ({ data: await service.validateComponent(input) })),
  );

  server.registerTool(
    'get_selection',
    {
      title: '현재 선택',
      description: '저장된 component_id·variant_id, selection revision과 파일 sha256, 저장 당시 원본 fingerprint, 현재 원본과의 상태(none/current/stale_source/unresolvable)와 해석한 정의를 돌려준다.',
      inputSchema: NO_INPUT,
      annotations: { title: '현재 선택', ...READ_ONLY },
    },
    async () => toolResult(async () => ({ data: await service.getSelection() })),
  );

  server.registerTool(
    'select_component',
    {
      title: '컴포넌트 선택 저장',
      description: '선택 가능한 컴포넌트·variant 조합 하나를 웹과 공유하는 서비스 selection 파일에 저장한다. expected_selection_revision과 expected_source_sha256이 현재 값과 같을 때만 저장하고, 다르면 selection_conflict/source_conflict로 거부하며 기존 선택을 보존한다. 같은 조합을 다시 저장하면 revision이 오르지 않는다. 정의는 바꾸지 않는다.',
      inputSchema: SelectInput,
      annotations: { title: '컴포넌트 선택 저장', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    async (input) => toolResult(async () => ({ data: await service.selectComponent(input) })),
  );

  server.registerTool(
    'export_selection_recipe',
    {
      title: '선택 recipe',
      description: '현재 선택을 제작 입력으로 고정하는 recipe를 돌려준다: 서비스 이름, 컴포넌트·variant 정의, 적용 preview, 연결 문서 해시, 원본 파일별 sha256과 source_sha256, selection revision·sha256. 선택이 없거나 현재 원본과 맞지 않으면 실패한다. 아무것도 생성하거나 저장하지 않는다.',
      inputSchema: NO_INPUT,
      annotations: { title: '선택 recipe', ...READ_ONLY },
    },
    async () => toolResult(async () => ({ data: await service.getRecipe() })),
  );

  server.registerResource(
    'catalog',
    'workbench://catalog',
    { title: '컴포넌트 카탈로그', description: 'list_components와 같은 JSON(원본 식별값·문서 목록·현재 선택 포함).', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await service.listComponents(), null, 2) }] }),
  );

  server.registerResource(
    'selection',
    'workbench://selection',
    { title: '현재 선택', description: 'get_selection과 같은 저장 선택 JSON.', mimeType: 'application/json' },
    async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(await service.getSelection(), null, 2) }] }),
  );

  server.registerResource(
    'docs',
    new ResourceTemplate(`${DOC_URI_PREFIX}{+path}`, {
      list: async () => {
        const { documents } = await service.listComponents();
        return {
          resources: documents.map((doc) => ({
            uri: doc.uri,
            name: doc.path,
            title: doc.path,
            description: doc.scenario_ids.length > 0 ? `BDD 시나리오 ${doc.scenario_ids.join(' ')}` : '서비스 컴포넌트 안내',
            mimeType: mimeTypeFor(doc.path),
          })),
        };
      },
    }),
    { title: '용도·BDD 문서', description: 'docs_root의 README.md와 catalog가 연결한 .feature 원문. 원본 묶음에 속한 문서만 읽을 수 있다.' },
    async (uri, variables) => {
      const docPath = Array.isArray(variables.path) ? variables.path.join('/') : String(variables.path ?? '');
      try {
        const doc = await service.readDocument(docPath);
        return { contents: [{ uri: doc.uri, mimeType: mimeTypeFor(doc.path), text: doc.text }] };
      } catch (error) {
        if (toWorkbenchError(error).code === 'not_found') throw new ResourceNotFoundError(uri.href);
        throw error;
      }
    },
  );

  return server;
}
