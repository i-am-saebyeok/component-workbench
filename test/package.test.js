// 배포 검증: 이 checkout의 npm pack tarball을 checkout 밖의 새 서비스 A/B(경로에 공백)에
// 설치하고, 설치된 CLI로 빈 init부터 웹·MCP·독립 선택까지 실행한다. A/B의 컴포넌트는
// 테스트 fixture를 그 서비스에만 복사해 등록한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parse as parseToml } from 'smol-toml';
import { INSTALL_COMMAND } from '../src/init.js';
import { jsonSchemas } from '../src/schemas.js';
import { CLI, FIXTURES, run, snapshot } from './helpers.js';
import { FORBIDDEN, PKG, assignPort, installService, npx, packTarball, startWorkbench, stopWorkbench, tempRoot } from './installed.js';

let work;
let packed;
let A;
let B;
const servers = [];
const clients = [];
const SKIP = ['node_modules'];
const toolDir = (service) => path.join(service, 'node_modules', ...PKG.split('/'));

before(async () => {
  work = await tempRoot('cw pack ');
  packed = await packTarball(work);
  A = path.join(work, 'service a');
  B = path.join(work, 'service b');
  await installService(A, packed.tarball, { name: 'service-a', scripts: { build: 'echo build' } });
  await installService(B, packed.tarball, { name: 'service-b' });
  await fs.writeFile(path.join(B, '.mcp.json'), `${JSON.stringify({ mcpServers: { docs: { command: 'docs-mcp', args: ['--stdio'] } } }, null, 2)}\n`);
  await fs.mkdir(path.join(B, '.codex'));
  await fs.writeFile(path.join(B, '.codex', 'config.toml'), '# B의 Codex 설정\napproval_policy = "on-request"\n\n[mcp_servers.docs]\ncommand = "docs-mcp"\nargs = ["--stdio"]\n');
  await fs.writeFile(path.join(B, '.gitignore'), 'dist/\n');
});

after(async () => {
  for (const client of clients) await client.close().catch(() => {});
  for (const server of servers) await stopWorkbench(server).catch(() => {});
  await fs.rm(work, { recursive: true, force: true });
});

async function connect(transport) {
  const client = new Client({ name: 'component-workbench-package-test', version: '0' }, { versionNegotiation: { mode: 'legacy' } });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), data: JSON.parse(result.content[0].text), content: result.content };
}

async function textFiles(dir) {
  const out = [];
  async function walk(current) {
    for (const entry of await fs.readdir(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'node_modules') await walk(absolute);
      } else out.push(absolute);
    }
  }
  await walk(dir);
  return out;
}

test('the tarball carries only the tool: runtime, web, templates, schema and docs; no tests, fixtures or other service data', async () => {
  assert.deepEqual(packed.files, [
    'LICENSE',
    'README.md',
    'docs/verification.md',
    'package.json',
    'schema/catalog.schema.json',
    'schema/config.schema.json',
    'src/cli.js',
    'src/config.js',
    'src/errors.js',
    'src/gherkin.js',
    'src/http.js',
    'src/init.js',
    'src/mcp.js',
    'src/schemas.js',
    'src/selection-store.js',
    'src/service.js',
    'src/source.js',
    'templates/workbench/README.md',
    'templates/workbench/behaviors/README.md',
    'templates/workbench/catalog.json',
    'templates/workbench/previews/README.md',
    'web/adapters/box.js',
    'web/adapters/html.js',
    'web/app.js',
    'web/index.html',
    'web/styles.css',
  ]);
  const extracted = path.join(work, 'extracted');
  await fs.mkdir(extracted);
  await run('tar', ['-xzf', packed.tarball, '-C', extracted]);
  const fixtureIds = /storage-panel|metal-blue|html-button|button\/primary/;
  for (const file of await textFiles(extracted)) {
    const text = await fs.readFile(file, 'utf8');
    assert.ok(!FORBIDDEN.test(text), `${path.relative(extracted, file)}: ${FORBIDDEN.exec(text)?.[0]}`);
    assert.ok(!fixtureIds.test(text), `${path.relative(extracted, file)} mentions a test fixture`);
  }
  for (const [file, text] of Object.entries(jsonSchemas())) assert.equal(await fs.readFile(path.join(extracted, 'package', file), 'utf8'), text, `${file} is generated from src/schemas.js`);
  const manifest = JSON.parse(await fs.readFile(path.join(extracted, 'package', 'package.json'), 'utf8'));
  assert.deepEqual([manifest.private, manifest.bin['component-workbench']], [true, 'src/cli.js']);
});

test('installed CLI initializes two fresh services with 0 components, preserves existing settings and repeats byte-stably', async () => {
  const initA = await npx(A, ['init', '--title', 'Service A']);
  assert.equal(initA.code, 0, initA.stderr);
  assert.match(initA.stdout, /컴포넌트 0개에서 시작/);
  const initB = await npx(B, ['init', '--name', 'svc-b', '--title', 'Service B']);
  assert.equal(initB.code, 0, initB.stderr);

  for (const [service, name] of [[A, 'service-a'], [B, 'svc-b']]) {
    const config = JSON.parse(await fs.readFile(path.join(service, 'component-workbench.config.json'), 'utf8'));
    assert.equal(config.name, name);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(service, 'workbench', 'catalog.json'), 'utf8')), { schema_version: 1, revision: 1, components: [] });
    await assert.rejects(fs.stat(path.join(service, 'workbench', 'selection.json')), { code: 'ENOENT' });
    const pkg = JSON.parse(await fs.readFile(path.join(service, 'package.json'), 'utf8'));
    assert.equal(pkg.scripts.workbench, 'component-workbench serve');
    assert.equal(pkg.scripts['workbench:mcp'], 'component-workbench mcp');
    assert.ok(pkg.devDependencies[PKG].startsWith('file:'));
    for (const file of await textFiles(service)) {
      const text = await fs.readFile(file, 'utf8');
      assert.ok(!FORBIDDEN.test(text), `${path.relative(service, file)}: ${FORBIDDEN.exec(text)?.[0]}`);
      if (!file.endsWith('package-lock.json') && !file.endsWith('package.json')) assert.ok(!text.includes(work), `${path.relative(service, file)} contains a machine-specific absolute path`);
    }
    const sub = path.join(service, 'src', 'nested dir');
    await fs.mkdir(sub, { recursive: true });
    const validate = await npx(sub, ['validate']);
    assert.equal(validate.code, 0, validate.stderr);
    assert.deepEqual([JSON.parse(validate.stdout).components, JSON.parse(validate.stdout).scenarios_executed], [0, false]);
    const recipe = await npx(sub, ['recipe']);
    assert.equal(recipe.code, 1);
    assert.match(recipe.stderr, /selection_missing/);
  }
  assert.equal(JSON.parse(await fs.readFile(path.join(A, 'package.json'), 'utf8')).scripts.build, 'echo build');
  const mcpB = JSON.parse(await fs.readFile(path.join(B, '.mcp.json'), 'utf8'));
  assert.deepEqual(Object.keys(mcpB.mcpServers), ['docs', 'svc-b-components']);
  const codexB = await fs.readFile(path.join(B, '.codex', 'config.toml'), 'utf8');
  assert.ok(codexB.startsWith('# B의 Codex 설정\napproval_policy = "on-request"\n\n[mcp_servers.docs]\n'));
  assert.deepEqual(Object.keys(parseToml(codexB).mcp_servers), ['docs', 'svc-b-components']);
  assert.equal(await fs.readFile(path.join(B, '.gitignore'), 'utf8'), 'dist/\n');

  for (const service of [A, B]) {
    const once = await snapshot(service, { skip: SKIP });
    const again = await npx(service, ['init']);
    assert.equal(again.code, 0, again.stderr);
    assert.match(again.stdout, /변경 없음/);
    assert.deepEqual(await snapshot(service, { skip: SKIP }), once);
  }
});

test('generated npm scripts actually run: both empty services serve the web UI on their own config ports and the MCP script speaks stdio', async () => {
  const ports = [await assignPort(A), await assignPort(B)];
  const [webA, webB] = [await startWorkbench(A), await startWorkbench(B)];
  servers.push(webA, webB);
  assert.deepEqual([webA.port, webB.port], ports);
  for (const [web, name] of [[webA, 'service-a'], [webB, 'svc-b']]) {
    const page = await fetch(web.url);
    assert.equal(page.status, 200);
    assert.equal((await fetch(new URL('vendor/three/three.module.js', web.url))).status, 200);
    const catalog = await (await fetch(new URL('api/catalog', web.url))).json();
    assert.deepEqual([catalog.workbench.name, catalog.components, catalog.selection.status, catalog.selection.revision], [name, [], 'none', 0]);
  }
  // npm은 script 실행 머리말을 stdout에 쓰므로 stdio 클라이언트는 -s로 실행해야 한다.
  const scripted = await connect(new StdioClientTransport({ command: 'npm', args: ['run', '-s', 'workbench:mcp'], cwd: A, stderr: 'pipe' }));
  assert.deepEqual((await call(scripted, 'list_components')).data.components, []);
  await stopWorkbench(webA);
  await stopWorkbench(webB);
});

test('generated .mcp.json and .codex/config.toml entries start this service MCP from a subdirectory with spaces', async () => {
  const mcpA = JSON.parse(await fs.readFile(path.join(A, '.mcp.json'), 'utf8')).mcpServers['service-a-components'];
  assert.deepEqual(mcpA, { type: 'stdio', command: 'npx', args: ['--no-install', 'component-workbench', 'mcp'] });
  const codexB = parseToml(await fs.readFile(path.join(B, '.codex', 'config.toml'), 'utf8')).mcp_servers['svc-b-components'];
  for (const [service, entry, name] of [[A, mcpA, 'service-a-components'], [B, codexB, 'svc-b-components']]) {
    const client = await connect(new StdioClientTransport({ command: entry.command, args: entry.args, cwd: path.join(service, 'src', 'nested dir'), stderr: 'pipe' }));
    assert.equal(client.getServerVersion().name, name);
    assert.equal((await client.listTools()).tools.length, 6);
    assert.deepEqual((await call(client, 'list_components')).data.components, []);
    const selection = (await call(client, 'get_selection')).data;
    assert.deepEqual([selection.status, selection.revision, selection.path], ['none', 0, 'workbench/selection.json']);
    const readme = await client.readResource({ uri: 'workbench://docs/README.md' });
    assert.equal(readme.contents[0].text, await fs.readFile(path.join(service, 'workbench', 'README.md'), 'utf8'));
  }
});

test('service A box and service B HTML components live only in their services; selections, BDD and recipes stay independent', async () => {
  await fs.cp(path.join(FIXTURES, 'service-a', 'workbench'), path.join(A, 'workbench'), { recursive: true });
  await fs.cp(path.join(FIXTURES, 'service-b', 'workbench'), path.join(B, 'workbench'), { recursive: true });
  const tools = [await snapshot(toolDir(A)), await snapshot(toolDir(B))];

  // A: 생성된 .mcp.json 명령으로 연결해 BDD를 읽고 선택한다.
  const entry = JSON.parse(await fs.readFile(path.join(A, '.mcp.json'), 'utf8')).mcpServers['service-a-components'];
  const mcpA = await connect(new StdioClientTransport({ command: entry.command, args: entry.args, cwd: path.join(A, 'src', 'nested dir'), stderr: 'pipe' }));
  const detail = await call(mcpA, 'get_component', { component_id: 'storage-panel', variant_id: 'metal-blue' });
  const featureA = await fs.readFile(path.join(A, 'workbench', 'behaviors', 'storage-panel.feature'), 'utf8');
  assert.ok(detail.content[1].text.endsWith(featureA));
  assert.deepEqual(detail.data.preview, { type: 'box', dimensions_m: [3, 1, 1.5] });
  assert.deepEqual(detail.data.variants[0].material, { base_color_srgb_hex: '#4F7AA8', roughness: 0.4, metallic: 0.7 });
  assert.equal((await call(mcpA, 'get_component', { component_id: 'button' })).data.error.code, 'not_found');
  const beforeB = await snapshot(B, { skip: SKIP });
  const selectedA = await call(mcpA, 'select_component', { component_id: 'storage-panel', variant_id: 'metal-blue', expected_selection_revision: 0, expected_source_sha256: detail.data.source.source_sha256 });
  assert.equal(selectedA.isError, false, JSON.stringify(selectedA.data));
  assert.deepEqual(await snapshot(B, { skip: SKIP }), beforeB, 'selecting in A does not touch B');

  // B: 생성된 script로 띄운 웹 서버의 HTTP MCP로 선택한다.
  const webB = await startWorkbench(B);
  servers.push(webB);
  const mcpB = await connect(new StreamableHTTPClientTransport(new URL('mcp', webB.url)));
  assert.equal(mcpB.getServerVersion().name, 'svc-b-components');
  const listB = (await call(mcpB, 'list_components')).data;
  assert.deepEqual(listB.components.map((component) => component.id), ['button']);
  const selectionA = await fs.readFile(path.join(A, 'workbench', 'selection.json'));
  const selectedB = await call(mcpB, 'select_component', { component_id: 'button', variant_id: 'secondary', expected_selection_revision: 0, expected_source_sha256: listB.source.source_sha256 });
  assert.equal(selectedB.isError, false, JSON.stringify(selectedB.data));
  assert.ok(selectionA.equals(await fs.readFile(path.join(A, 'workbench', 'selection.json'))), 'selecting in B does not touch A');
  const webSelection = await (await fetch(new URL('api/selection', webB.url))).json();
  assert.deepEqual([webSelection.selection.component_id, webSelection.selection.variant_id, webSelection.revision], ['button', 'secondary', 1]);
  const html = await fetch(new URL('preview/button/secondary.html', webB.url));
  assert.equal(await html.text(), await fs.readFile(path.join(B, 'workbench', 'previews', 'button', 'secondary.html'), 'utf8'));

  // recipe: 서비스 루트 기준 경로만, 다른 서비스·이 기계의 절대 경로 없음.
  const recipe = await npx(path.join(A, 'src', 'nested dir'), ['recipe']);
  assert.equal(recipe.code, 0, recipe.stderr);
  const pinned = JSON.parse(recipe.stdout);
  assert.deepEqual([pinned.workbench.name, pinned.component.id, pinned.variant.id], ['service-a', 'storage-panel', 'metal-blue']);
  assert.deepEqual(pinned.documents.map((doc) => doc.path), ['workbench/behaviors/storage-panel.feature']);
  assert.ok(pinned.source.files.every((file) => file.path.startsWith('workbench/')));
  assert.ok(!recipe.stdout.includes(work) && !recipe.stdout.includes('button'));

  // B 문서만 고치면 B 선택만 오래된 상태가 되고 A는 그대로다.
  await fs.appendFile(path.join(B, 'workbench', 'behaviors', 'button.feature'), '\n');
  assert.equal((await call(mcpB, 'get_selection')).data.status, 'stale_source');
  assert.equal((await call(mcpA, 'get_selection')).data.status, 'current');
  assert.deepEqual([await snapshot(toolDir(A)), await snapshot(toolDir(B))], tools, 'nothing is written inside the installed tool');
  await stopWorkbench(webB);
});

test('in an installed service a late collision fails without changing any file; a checkout CLI refuses to init', async () => {
  const C = path.join(work, 'service c');
  await fs.mkdir(C);
  await fs.cp(path.join(A, 'node_modules'), path.join(C, 'node_modules'), { recursive: true, verbatimSymlinks: true });
  const pkgA = JSON.parse(await fs.readFile(path.join(A, 'package.json'), 'utf8'));
  await fs.writeFile(path.join(C, 'package.json'), `${JSON.stringify({ name: 'service-c', private: true, scripts: { start: 'node .' }, devDependencies: pkgA.devDependencies }, null, 2)}\n`);
  await fs.mkdir(path.join(C, '.codex'));
  await fs.writeFile(path.join(C, '.codex', 'config.toml'), '[mcp_servers.service-c-components]\ncommand = "node"\nargs = ["old.js"]\n');
  const before = await snapshot(C, { skip: SKIP });
  const failed = await npx(C, ['init']);
  assert.equal(failed.code, 1);
  assert.match(failed.stderr, /\.codex\/config\.toml: mcp_servers\.service-c-components가 이미 다른 설정으로 있다/);
  assert.deepEqual(await snapshot(C, { skip: SKIP }), before);

  const checkout = await run(process.execPath, [CLI, 'init', '--target', C]).catch((error) => error);
  assert.equal(checkout.code, 1);
  assert.match(checkout.stderr, /이 서비스에 설치된 도구.*가 아니다/s);
  const bare = path.join(work, 'service d');
  await fs.mkdir(bare);
  await fs.writeFile(path.join(bare, 'package.json'), '{"name":"service-d","private":true}\n');
  const uninstalled = await run(process.execPath, [CLI, 'init', '--target', bare]).catch((error) => error);
  assert.equal(uninstalled.code, 1);
  assert.ok(uninstalled.stderr.includes(INSTALL_COMMAND), uninstalled.stderr);
  assert.deepEqual(await fs.readdir(bare), ['package.json']);
  assert.deepEqual(await snapshot(C, { skip: SKIP }), before);
});
