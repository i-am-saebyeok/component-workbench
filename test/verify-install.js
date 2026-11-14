// 설치 검증: 패키지 source를 경로에 공백이 있는 새 소비 서비스에 runtime dependency로 설치하고
// (--omit=dev, 서비스의 devDependencies 미설치) TypeScript 컴파일러 없이 생성된 init·validate·웹·
// 공식 MCP client(HTTP, .mcp.json·.codex/config.toml stdio)·문서·선택 유지가 동작하는지 확인한다.
//
//   npm run verify:install                                  # 이 checkout을 npm pack한 tarball
//   npm run verify:install -- '<package source>'            # 예: git+https://github.com/i-am-saebyeok/component-workbench.git#<sha 또는 태그>
//
// Git source는 GIT_TERMINAL_PROMPT=0과 빈 credential.helper로 익명 설치한다. 확인한 사실을 JSON으로
// stdout에 쓰고, 하나라도 실패하면 exit 1이다. 임시 서비스·포트는 끝나면 지운다.
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
import { parse as parseToml } from 'smol-toml';
import { FIXTURES } from './helpers.js';
import { PKG, assignPort, compilerPackages, installService, npx, packTarball, startWorkbench, stopWorkbench, tempRoot } from './installed.js';

const ANONYMOUS_GIT = { GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: '', SSH_ASKPASS: '', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'credential.helper', GIT_CONFIG_VALUE_0: '' };
// 서비스가 개발용으로 선언한 의존성. --omit=dev이므로 설치되지 않아야 한다.
const CONSUMER_DEV_DEPENDENCIES = { typescript: '7.1.0-beta' };

async function files(root, relative = '') {
  const out = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...(entry.name === 'node_modules' ? [] : await files(root, child)));
    else out.push(child);
  }
  return out.sort();
}

async function connect(transport, clients) {
  const client = new Client({ name: 'component-workbench-verify-install', version: '0' }, { versionNegotiation: { mode: 'legacy' } });
  await client.connect(transport);
  clients.push(client);
  return client;
}

async function call(client, name, args = {}) {
  const result = await client.callTool({ name, arguments: args });
  return { isError: Boolean(result.isError), data: JSON.parse(result.content[0].text) };
}

/** source를 새 서비스에 설치해 검사하고 보고서를 돌려준다. source가 없으면 이 checkout을 pack한다. */
export async function verifyInstall(source) {
  const work = await tempRoot('cw verify ');
  const checks = [];
  const check = (id, ok, details) => {
    checks.push({ id, ok: Boolean(ok), details });
    if (!ok) throw new Error(`${id}: ${JSON.stringify(details)}`);
  };
  const clients = [];
  let server = null;
  const report = { kind: 'component-workbench-install-verification', source: source ?? 'local npm pack', node: process.version, install: null, checks, passed: false };
  try {
    const spec = source ?? (await packTarball(work)).tarball;
    const service = path.join(work, 'consumer service');
    const nested = path.join(service, 'src', 'nested dir');
    await installService(service, spec, { name: 'consumer-service', devDependencies: CONSUMER_DEV_DEPENDENCIES }, { runtime: true, env: { ...process.env, ...ANONYMOUS_GIT } });
    const consumer = JSON.parse(await fs.readFile(path.join(service, 'package.json'), 'utf8'));
    const lock = JSON.parse(await fs.readFile(path.join(service, 'package-lock.json'), 'utf8'));
    const toolDir = path.join(service, 'node_modules', ...PKG.split('/'));
    const tool = JSON.parse(await fs.readFile(path.join(toolDir, 'package.json'), 'utf8'));
    const toolFiles = await files(toolDir);
    report.install = {
      flags: ['--save-prod', '--omit=dev'],
      declared: consumer.dependencies?.[PKG] ?? null,
      resolved: lock.packages?.[`node_modules/${PKG}`]?.resolved ?? null,
      version: tool.version,
      bin: tool.bin,
    };
    check('tool-is-runtime-dependency', consumer.dependencies?.[PKG] && !consumer.devDependencies?.[PKG], { dependencies: consumer.dependencies });
    check('installed-tool-is-compiled-js', toolFiles.includes(tool.bin['component-workbench']) && toolFiles.includes('dist/web/app.js') && toolFiles.includes('web/index.html') && !toolFiles.some((file) => /\.(ts|tsx|mts|cts)$/.test(file) || file.startsWith('src/')), { files: toolFiles });
    const compilers = await compilerPackages(service);
    const consumerDevInstalled = await fs.stat(path.join(service, 'node_modules', 'typescript')).then(() => true, () => false);
    check('no-compiler-in-consumer-tree', compilers.length === 0 && !consumerDevInstalled, { compiler_packages: compilers, consumer_dev_dependencies_declared: CONSUMER_DEV_DEPENDENCIES, consumer_dev_dependencies_installed: consumerDevInstalled });

    const init = await npx(service, ['init', '--title', 'Consumer Service']);
    const catalog = JSON.parse(await fs.readFile(path.join(service, 'workbench', 'catalog.json'), 'utf8'));
    check('init-starts-empty', init.code === 0 && /컴포넌트 0개에서 시작/.test(init.stdout) && catalog.components.length === 0, { code: init.code, stderr: init.stderr });
    await fs.mkdir(nested, { recursive: true });
    const validate = await npx(nested, ['validate']);
    check('validate-empty', validate.code === 0 && JSON.parse(validate.stdout).components === 0, { code: validate.code, stdout: validate.stdout, stderr: validate.stderr });

    // 서비스 소유 fixture를 등록하고 생성된 npm script로 웹을 띄운다.
    await fs.cp(path.join(FIXTURES, 'service-a', 'workbench'), path.join(service, 'workbench'), { recursive: true });
    const port = await assignPort(service);
    server = await startWorkbench(service);
    const statuses = {};
    for (const asset of ['', 'app.js', 'adapters/box.js', 'adapters/html.js', 'styles.css', 'vendor/three/three.module.js']) statuses[`/${asset}`] = (await fetch(new URL(asset, server.url))).status;
    const web = await (await fetch(new URL('api/catalog', server.url))).json();
    check('web-serves-compiled-ui-and-catalog', server.port === port && Object.values(statuses).every((status) => status === 200) && web.components.map((component) => component.id).join() === 'storage-panel', { statuses, components: web.components.map((component) => component.id) });

    // 생성된 .mcp.json stdio 명령: BDD 원문을 읽고 선택한다.
    const entry = JSON.parse(await fs.readFile(path.join(service, '.mcp.json'), 'utf8')).mcpServers['consumer-service-components'];
    const stdio = await connect(new StdioClientTransport({ command: entry.command, args: entry.args, cwd: nested, stderr: 'pipe' }), clients);
    const tools = (await stdio.listTools()).tools.map((item) => item.name).sort();
    const feature = await fs.readFile(path.join(service, 'workbench', 'behaviors', 'storage-panel.feature'), 'utf8');
    const doc = await stdio.readResource({ uri: 'workbench://docs/behaviors/storage-panel.feature' });
    const before = await call(stdio, 'get_selection');
    const selected = await call(stdio, 'select_component', { component_id: 'storage-panel', variant_id: 'metal-blue', expected_selection_revision: 0, expected_source_sha256: before.data.source.source_sha256 });
    check('mcp-json-stdio-reads-bdd-and-selects', tools.length === 6 && doc.contents[0].text === feature && !selected.isError && selected.data.revision === 1, { entry, tools, selected: selected.data.revision ?? selected.data });

    // 같은 선택이 파일·웹·HTTP MCP·생성된 Codex stdio 명령에서 유지된다.
    const saved = JSON.parse(await fs.readFile(path.join(service, 'workbench', 'selection.json'), 'utf8'));
    const webSelection = await (await fetch(new URL('api/selection', server.url))).json();
    const http = await connect(new StreamableHTTPClientTransport(new URL('mcp', server.url)), clients);
    const viaHttp = (await call(http, 'get_selection')).data;
    const codex = parseToml(await fs.readFile(path.join(service, '.codex', 'config.toml'), 'utf8')).mcp_servers['consumer-service-components'];
    const codexClient = await connect(new StdioClientTransport({ command: codex.command, args: codex.args, cwd: nested, stderr: 'pipe' }), clients);
    const viaCodex = (await call(codexClient, 'get_selection')).data;
    const readme = await codexClient.readResource({ uri: 'workbench://docs/README.md' });
    const same = [webSelection, viaHttp, viaCodex].every((item) => item.status === 'current' && item.revision === 1 && item.selection.component_id === 'storage-panel' && item.selection.variant_id === 'metal-blue');
    check('selection-persists-across-web-http-and-codex-stdio', saved.revision === 1 && same && readme.contents[0].text === (await fs.readFile(path.join(service, 'workbench', 'README.md'), 'utf8')), {
      codex,
      revisions: { file: saved.revision, web: webSelection.revision, http_mcp: viaHttp.revision, codex_stdio: viaCodex.revision },
    });
    report.passed = true;
  } catch (error) {
    report.error = String(error?.stack ?? error);
  } finally {
    for (const client of clients) await client.close().catch(() => {});
    if (server) await stopWorkbench(server).catch(() => {});
    await fs.rm(work, { recursive: true, force: true });
  }
  return report;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const report = await verifyInstall(process.argv[2]);
  const npm = await promisify(execFile)('npm', ['--version']).then(({ stdout }) => stdout.trim(), () => null);
  process.stdout.write(`${JSON.stringify({ ...report, npm }, null, 2)}\n`);
  if (!report.passed) process.exitCode = 1;
}
