// 공식 MCP 클라이언트(Streamable HTTP, stdio)로 도구·resource·BDD 원문·공유 선택을 확인한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { startHttpServer } from '../dist/src/http.js';
import { CLI, makeService, serviceAt } from './helpers.js';

const TOOLS = ['export_selection_recipe', 'get_component', 'get_selection', 'list_components', 'select_component', 'validate_component'];

async function connect(t, transport, mode) {
  const client = new Client({ name: 'component-workbench-test', version: '0' }, { versionNegotiation: { mode } });
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), data: JSON.parse(result.content[0].text), content: result.content };
}

/** 모든 transport × 협상 모드에 같은 검사를 한다. */
async function exercise(t, client, root, label) {
  t.diagnostic(`${label}: negotiated ${client.getNegotiatedProtocolVersion()}`);
  assert.equal(client.getServerVersion().name, 'svc-b-components');
  assert.equal(client.getServerVersion().title, 'Service B');

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map((tool) => tool.name).sort(), TOOLS);
  for (const tool of tools) {
    assert.equal(tool.annotations.readOnlyHint, tool.name !== 'select_component', tool.name);
    assert.equal(tool.annotations.destructiveHint, false, tool.name);
    assert.equal(tool.annotations.openWorldHint, false, tool.name);
  }
  const select = tools.find((tool) => tool.name === 'select_component');
  assert.deepEqual(select.inputSchema.required.sort(), ['component_id', 'expected_selection_revision', 'expected_source_sha256']);
  assert.equal(select.inputSchema.additionalProperties, false);

  const list = await call(client, 'list_components');
  assert.deepEqual(list.data.components.map((component) => [component.id, component.variants.map((variant) => variant.id)]), [['button', ['primary', 'secondary']]]);

  // BDD는 경로만이 아니라 실제 본문으로 돌려준다.
  const detail = await call(client, 'get_component', { component_id: 'button', variant_id: 'secondary' });
  const featureText = await fs.readFile(path.join(root, 'workbench', 'behaviors', 'button.feature'), 'utf8');
  assert.equal(detail.content.length, 2);
  assert.ok(detail.content[1].text.startsWith('# behaviors/button.feature (sha256 ') && detail.content[1].text.endsWith(featureText), label);
  assert.deepEqual(detail.data.documents[0].scenario_ids, ['@html-button-click-counter', '@html-button-variant-preview', '@html-button-selection-persists']);
  assert.deepEqual(detail.data.preview, { type: 'html', src: 'button/secondary.html' });
  assert.ok(detail.data.component.avoid_uses.includes('preview 내부 클릭이 workbench 선택을 저장하는 것으로 혼동하지 않는다.'));

  const { resources } = await client.listResources();
  const uris = resources.map((resource) => resource.uri);
  for (const uri of ['workbench://catalog', 'workbench://selection', 'workbench://docs/README.md', 'workbench://docs/behaviors/button.feature']) assert.ok(uris.includes(uri), uri);
  assert.equal((await client.readResource({ uri: 'workbench://docs/behaviors/button.feature' })).contents[0].text, featureText);
  assert.equal((await client.readResource({ uri: 'workbench://docs/README.md' })).contents[0].text, await fs.readFile(path.join(root, 'workbench', 'README.md'), 'utf8'));
  for (const uri of ['workbench://docs/catalog.json', 'workbench://docs/../selection.json', 'workbench://docs/behaviors/missing.feature', 'workbench://docs/behaviors/README.md']) {
    await assert.rejects(client.readResource({ uri }), undefined, uri);
  }

  const invalid = await call(client, 'validate_component', { component_id: 'button', variant_id: 'tertiary' });
  assert.deepEqual([invalid.isError, invalid.data.valid, invalid.data.reasons[0].code], [false, false, 'unknown_variant']);
  assert.equal((await client.callTool({ name: 'validate_component', arguments: { component_id: 'button', scale: 2 } })).isError, true);
}

test('Streamable HTTP: official clients (2025 and 2026 negotiation) read real BDD and share the web selection', async (t) => {
  const root = await makeService(t, { name: 'svc-b', title: 'Service B', fixture: 'service-b' });
  const running = await startHttpServer({ service: await serviceAt(root), port: 0, onError: () => {} });
  t.after(() => running.close());
  const http = () => new StreamableHTTPClientTransport(new URL(running.mcpUrl));

  for (const mode of ['legacy', 'auto']) await exercise(t, await connect(t, http(), mode), root, `http/${mode}`);
  assert.equal((await connect(t, http(), 'legacy')).getNegotiatedProtocolVersion(), '2025-11-25');
  assert.equal((await connect(t, http(), 'auto')).getNegotiatedProtocolVersion(), '2026-07-28');

  const client = await connect(t, http(), 'legacy');
  const before = await call(client, 'get_selection');
  assert.deepEqual([before.data.status, before.data.revision], ['none', 0]);
  const saved = await call(client, 'select_component', {
    component_id: 'button',
    variant_id: 'secondary',
    expected_selection_revision: 0,
    expected_source_sha256: before.data.source.source_sha256,
  });
  assert.equal(saved.isError, false);
  const web = await (await fetch(new URL('api/selection', running.url))).json();
  assert.deepEqual([web.selection.component_id, web.selection.variant_id, web.revision, web.source.source_sha256], ['button', 'secondary', 1, before.data.source.source_sha256]);

  // 웹이 먼저 저장하면 이전 revision의 MCP 저장은 거부된다.
  const webSave = await fetch(new URL('api/selection', running.url), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ component_id: 'button', variant_id: 'primary', expected_selection_revision: 1, expected_source_sha256: web.source.source_sha256 }),
  });
  assert.equal(webSave.status, 200);
  const stale = await call(client, 'select_component', { component_id: 'button', variant_id: 'secondary', expected_selection_revision: 1, expected_source_sha256: web.source.source_sha256 });
  assert.deepEqual([stale.isError, stale.data.error.code], [true, 'selection_conflict']);
  const recipe = await call(client, 'export_selection_recipe');
  assert.deepEqual([recipe.data.component.id, recipe.data.variant.id, recipe.data.selection.revision], ['button', 'primary', 2]);
});

test('stdio entry started from a service subdirectory (path with spaces) reaches the same service selection', async (t) => {
  const root = await makeService(t, { name: 'svc-b', title: 'Service B', fixture: 'service-b', label: 'service b root' });
  const subdir = path.join(root, 'packages', 'ui kit');
  await fs.mkdir(subdir, { recursive: true });
  const running = await startHttpServer({ service: await serviceAt(root), port: 0, onError: () => {} });
  t.after(() => running.close());
  const stdio = () => new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], cwd: subdir, stderr: 'pipe' });

  for (const mode of ['legacy', 'auto']) await exercise(t, await connect(t, stdio(), mode), root, `stdio/${mode}`);
  const client = await connect(t, stdio(), 'legacy');
  const before = await call(client, 'get_selection');
  const saved = await call(client, 'select_component', { component_id: 'button', variant_id: 'primary', expected_selection_revision: 0, expected_source_sha256: before.data.source.source_sha256 });
  assert.equal(saved.isError, false);
  const web = await (await fetch(new URL('api/selection', running.url))).json();
  assert.deepEqual([web.selection.variant_id, web.revision], ['primary', saved.data.revision]);
});

test('an invalid service definition does not stop the MCP connection; tool calls report catalog_invalid with problems', async (t) => {
  const root = await makeService(t, { name: 'svc-b', fixture: 'service-b' });
  await fs.writeFile(path.join(root, 'workbench', 'behaviors', 'button.feature'), 'Feature: 태그 없음\n\nScenario: s\n  Given x\n');
  const client = await connect(t, new StdioClientTransport({ command: process.execPath, args: [CLI, 'mcp'], cwd: root, stderr: 'pipe' }), 'legacy');
  const list = await call(client, 'list_components');
  assert.deepEqual([list.isError, list.data.error.code], [true, 'catalog_invalid']);
  assert.ok(list.data.error.details.problems.some((item) => item.at === 'workbench/behaviors/button.feature:3' && /안정 ID 태그/.test(item.message_ko)));
});
