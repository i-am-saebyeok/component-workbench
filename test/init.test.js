// init 계획·보존·충돌·롤백. 서비스에는 이 checkout을 가리키는 링크 설치(npm link와 같은 구조)를
// 두어 설치 확인을 통과시킨다. 실제 npm pack 설치는 package.test.js가 검사한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { parse as parseToml } from 'smol-toml';
import { INSTALL_COMMAND, InitError, runInit } from '../src/init.js';
import { REPO_ROOT, readJson, snapshot, tempDir } from './helpers.js';

const PKG = '@i-am-saebyeok/component-workbench';
const TEMPLATES = path.join(REPO_ROOT, 'templates', 'workbench');
const SKIP = ['node_modules'];

async function linkedService(t, { packageJson = {}, files = {}, link = true } = {}) {
  const root = await tempDir(t, 'linked service');
  await fs.writeFile(
    path.join(root, 'package.json'),
    typeof packageJson === 'string' ? packageJson : `${JSON.stringify({ name: 'demo-service', private: true, devDependencies: { [PKG]: 'file:../component-workbench' }, ...packageJson }, null, 2)}\n`,
  );
  if (link) {
    await fs.mkdir(path.join(root, 'node_modules', '@i-am-saebyeok'), { recursive: true });
    await fs.symlink(REPO_ROOT, path.join(root, 'node_modules', '@i-am-saebyeok', 'component-workbench'));
  }
  for (const [relative, content] of Object.entries(files)) {
    await fs.mkdir(path.dirname(path.join(root, relative)), { recursive: true });
    await fs.writeFile(path.join(root, relative), content);
  }
  return root;
}

async function initFails(root, options = {}) {
  try {
    await runInit({ target: root, ...options });
  } catch (error) {
    if (error instanceof InitError) return error;
    throw error;
  }
  throw new Error('init unexpectedly succeeded');
}

test('fresh init creates exactly the empty service files, scripts and project MCP entries; no selection file', async (t) => {
  const root = await linkedService(t);
  const before = await snapshot(root, { skip: SKIP });
  const plan = await runInit({ target: root, title: 'Demo Service' });
  const after = await snapshot(root, { skip: SKIP });
  const added = Object.keys(after).filter((key) => !(key in before)).sort();
  assert.deepEqual(added, [
    '.codex',
    '.codex/config.toml',
    '.mcp.json',
    'component-workbench.config.json',
    'workbench',
    'workbench/README.md',
    'workbench/behaviors',
    'workbench/behaviors/README.md',
    'workbench/catalog.json',
    'workbench/previews',
    'workbench/previews/README.md',
  ]);
  assert.deepEqual(plan.changes.map((change) => change.relative).sort(), [...added.filter((key) => !['.codex', 'workbench', 'workbench/behaviors', 'workbench/previews'].includes(key)), 'package.json'].sort());

  assert.deepEqual(await readJson(path.join(root, 'component-workbench.config.json')), {
    schema_version: 1,
    name: 'demo-service',
    title: 'Demo Service',
    catalog: 'workbench/catalog.json',
    selection: 'workbench/selection.json',
    docs_root: 'workbench',
    preview_root: 'workbench/previews',
    server: { port: 4317 },
  });
  for (const [target, template] of [['workbench/catalog.json', 'catalog.json'], ['workbench/README.md', 'README.md'], ['workbench/behaviors/README.md', 'behaviors/README.md'], ['workbench/previews/README.md', 'previews/README.md']]) {
    assert.ok((await fs.readFile(path.join(root, target))).equals(await fs.readFile(path.join(TEMPLATES, template))), target);
  }
  assert.deepEqual((await readJson(path.join(root, 'workbench', 'catalog.json'))).components, []);
  assert.deepEqual((await readJson(path.join(root, 'package.json'))).scripts, { workbench: 'component-workbench serve', 'workbench:mcp': 'component-workbench mcp' });
  const command = { command: 'npx', args: ['--no-install', 'component-workbench', 'mcp'] };
  assert.deepEqual(await readJson(path.join(root, '.mcp.json')), { mcpServers: { 'demo-service-components': { type: 'stdio', ...command } } });
  assert.deepEqual(JSON.parse(JSON.stringify(parseToml(await fs.readFile(path.join(root, '.codex', 'config.toml'), 'utf8')))), { mcp_servers: { 'demo-service-components': command } });
  await assert.rejects(fs.stat(path.join(root, 'workbench', 'selection.json')), { code: 'ENOENT' });
});

test('init merges into existing package/MCP/Codex settings, keeps their format, and a repeat init is byte-stable even after user edits', async (t) => {
  const existingToml = '# 사용자 설정\nmodel = "o4"\n\n[mcp_servers.docs]\ncommand = "docs-server"\nargs = ["--port", "9"]\n';
  const root = await linkedService(t, {
    packageJson: `{\r\n\t"name": "@acme/Store Front",\r\n\t"private": true,\r\n\t"scripts": {\r\n\t\t"build": "vite build",\r\n\t\t"test": "vitest"\r\n\t},\r\n\t"devDependencies": {\r\n\t\t"${PKG}": "file:../cw"\r\n\t}\r\n}\r\n`,
    files: {
      '.mcp.json': `${JSON.stringify({ mcpServers: { docs: { command: 'docs-server', args: [] } }, other: { keep: true } }, null, 4)}\n`,
      '.codex/config.toml': existingToml,
      '.gitignore': 'dist/\n.env\n',
      'src/app.js': 'export {};\n',
    },
  });
  await runInit({ target: root });
  const packageText = await fs.readFile(path.join(root, 'package.json'), 'utf8');
  assert.match(packageText, /^\{\r\n\t"name"/);
  assert.ok(packageText.endsWith('}\r\n'));
  const pkg = JSON.parse(packageText);
  assert.deepEqual(pkg.scripts, { build: 'vite build', test: 'vitest', workbench: 'component-workbench serve', 'workbench:mcp': 'component-workbench mcp' });
  assert.equal((await readJson(path.join(root, 'component-workbench.config.json'))).name, 'store-front');
  const mcpText = await fs.readFile(path.join(root, '.mcp.json'), 'utf8');
  assert.match(mcpText, /^\{\n {4}"mcpServers"/);
  assert.deepEqual(JSON.parse(mcpText), {
    mcpServers: { docs: { command: 'docs-server', args: [] }, 'store-front-components': { type: 'stdio', command: 'npx', args: ['--no-install', 'component-workbench', 'mcp'] } },
    other: { keep: true },
  });
  const toml = await fs.readFile(path.join(root, '.codex', 'config.toml'), 'utf8');
  assert.ok(toml.startsWith(existingToml), 'existing TOML text (comments included) is kept verbatim');
  assert.equal(parseToml(toml).model, 'o4');
  assert.equal(await fs.readFile(path.join(root, '.gitignore'), 'utf8'), 'dist/\n.env\n');

  const once = await snapshot(root, { skip: SKIP });
  const repeat = await runInit({ target: root });
  assert.deepEqual(repeat.changes, []);
  assert.deepEqual(await snapshot(root, { skip: SKIP }), once);

  // 사용자가 정의·문서·선택·설정을 바꾼 뒤에도 init은 아무것도 되돌리지 않는다.
  await fs.writeFile(path.join(root, 'workbench', 'catalog.json'), '{"schema_version":1,"revision":7,"components":[]}\n');
  await fs.writeFile(path.join(root, 'workbench', 'README.md'), '# 서비스가 고친 안내\n');
  await fs.writeFile(path.join(root, 'workbench', 'selection.json'), '{"user":"selection"}\n');
  const config = await readJson(path.join(root, 'component-workbench.config.json'));
  await fs.writeFile(path.join(root, 'component-workbench.config.json'), `${JSON.stringify({ ...config, title: 'Store Front UI', server: { port: 5123 } }, null, 2)}\n`);
  await fs.rm(path.join(root, 'workbench', 'previews', 'README.md'));
  const edited = await snapshot(root, { skip: SKIP });
  const third = await runInit({ target: root });
  assert.deepEqual(third.changes.map((change) => change.relative), ['workbench/previews/README.md'], 'only the missing template is recreated');
  const final = await snapshot(root, { skip: SKIP });
  assert.deepEqual({ ...final, 'workbench/previews/README.md': undefined }, { ...edited, 'workbench/previews/README.md': undefined });
});

test('a conflict found late in the plan (Codex entry) leaves every file untouched, including ones that would have been created first', async (t) => {
  const root = await linkedService(t, {
    packageJson: { scripts: { build: 'tsc' } },
    files: { '.codex/config.toml': '[mcp_servers.demo-service-components]\ncommand = "node"\nargs = ["server.js"]\n', '.mcp.json': '{"mcpServers":{}}\n' },
  });
  const before = await snapshot(root, { skip: SKIP });
  const error = await initFails(root);
  assert.deepEqual(error.problems.map((item) => item.path), ['.codex/config.toml']);
  assert.match(error.problems[0].message_ko, /다른 설정/);
  assert.deepEqual(await snapshot(root, { skip: SKIP }), before);
});

test('every conflict kind is reported together and nothing is written', async (t) => {
  const root = await linkedService(t, {
    packageJson: { scripts: { workbench: 'storybook dev' } },
    files: { 'workbench/README.md': '# 이미 있던 다른 문서\n', '.mcp.json': '{ not json', '.codex/config.toml': 'mcp_servers = "oops"\n' },
  });
  const before = await snapshot(root, { skip: SKIP });
  const error = await initFails(root);
  const byPath = Object.fromEntries(error.problems.map((item) => [item.path, item.message_ko]));
  assert.deepEqual(Object.keys(byPath).sort(), ['.codex/config.toml', '.mcp.json', 'package.json', 'workbench/README.md']);
  assert.match(byPath['package.json'], /scripts\.workbench가 이미 "storybook dev"/);
  assert.match(byPath['.mcp.json'], /올바른 JSON이 아니다/);
  assert.match(byPath['.codex/config.toml'], /table이 아니다/);
  assert.match(byPath['workbench/README.md'], /덮어쓰지 않는다/);
  assert.deepEqual(await snapshot(root, { skip: SKIP }), before);
});

test('malformed TOML, inline mcp_servers tables, non-directory parents and symlinked targets are conflicts', async (t) => {
  const cases = [
    [{ '.codex/config.toml': '[mcp_servers\ncommand = 1\n' }, '.codex/config.toml', /올바른 TOML이 아니다/],
    [{ '.codex/config.toml': 'mcp_servers = { docs = { command = "x" } }\n' }, '.codex/config.toml', /안전하게 덧붙일 수 없다/],
    [{ workbench: 'not a directory' }, 'workbench/catalog.json', /디렉토리가 아니다/],
    [{ '.codex': 'file' }, '.codex/config.toml', /디렉토리가 아니다/],
  ];
  for (const [files, at, pattern] of cases) {
    const root = await linkedService(t, { files });
    const before = await snapshot(root, { skip: SKIP });
    const error = await initFails(root);
    assert.ok(error.problems.some((item) => item.path === at && pattern.test(item.message_ko)), `${at}: ${JSON.stringify(error.problems)}`);
    assert.deepEqual(await snapshot(root, { skip: SKIP }), before);
  }
  const root = await linkedService(t);
  const elsewhere = await tempDir(t, 'elsewhere');
  await fs.symlink(elsewhere, path.join(root, 'workbench'));
  const error = await initFails(root);
  assert.ok(error.problems.some((item) => /심볼릭 링크/.test(item.message_ko)));
  assert.deepEqual(await fs.readdir(elsewhere), []);
});

test('repeat init refuses a different --name/--title than the existing config and an invalid existing config', async (t) => {
  const root = await linkedService(t);
  await runInit({ target: root, name: 'shop', title: 'Shop' });
  const before = await snapshot(root, { skip: SKIP });
  const renamed = await initFails(root, { name: 'other' });
  assert.match(renamed.problems[0].message_ko, /--name other이 기존 config의 name shop과 다르다/);
  await initFails(root, { title: 'Other' });
  assert.deepEqual(await snapshot(root, { skip: SKIP }), before);
  await fs.writeFile(path.join(root, 'component-workbench.config.json'), '{"schema_version":1,"name":"../x"}\n');
  const invalid = await initFails(root);
  assert.match(invalid.message, /기존 config를 사용할 수 없다/);
});

test('a write failure during apply rolls back every earlier change', { skip: process.getuid?.() === 0 && 'root ignores directory permissions' }, async (t) => {
  const root = await linkedService(t, { packageJson: { scripts: { build: 'tsc' } }, files: { '.codex/keep.txt': 'x' } });
  // .codex/config.toml 생성(마지막 변경)이 권한 때문에 실패하게 한다. 계획 단계는 통과한다.
  await fs.chmod(path.join(root, '.codex'), 0o555);
  try {
    const before = await snapshot(root, { skip: SKIP });
    const error = await initFails(root);
    assert.match(error.message, /되돌렸다/);
    assert.deepEqual(await snapshot(root, { skip: SKIP }), before);
  } finally {
    await fs.chmod(path.join(root, '.codex'), 0o755);
  }
});

test('init requires the tool installed in the service; otherwise it prints the exact install command and writes nothing', async (t) => {
  const missing = await linkedService(t, { packageJson: { devDependencies: {} }, link: false });
  const before = await snapshot(missing);
  const error = await initFails(missing);
  assert.ok(error.message.includes(INSTALL_COMMAND) && error.message.includes('npx component-workbench init'), error.message);
  assert.equal(INSTALL_COMMAND, 'npm install -D git+https://github.com/i-am-saebyeok/component-workbench.git#v0.1.0');
  assert.deepEqual(await snapshot(missing), before);

  // 서비스에 다른 사본이 설치되어 있으면 지금 실행한 CLI로 init하지 않는다.
  const other = await linkedService(t, { link: false });
  const copy = path.join(other, 'node_modules', '@i-am-saebyeok', 'component-workbench');
  await fs.mkdir(copy, { recursive: true });
  await fs.writeFile(path.join(copy, 'package.json'), JSON.stringify({ name: PKG, version: '0.0.0' }));
  const mismatch = await initFails(other);
  assert.match(mismatch.message, /설치된 도구.*가 아니다/s);
  await assert.rejects(fs.stat(path.join(other, 'component-workbench.config.json')), { code: 'ENOENT' });

  const noPackage = await tempDir(t, 'no package');
  assert.match((await initFails(noPackage)).message, /package\.json이 없다/);
  const badName = await linkedService(t, { packageJson: { name: '___' } });
  assert.match((await initFails(badName)).message, /--name으로 지정한다/);
});
