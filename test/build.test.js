// 빌드 검증: 생산 소스(src·scripts·web)는 모두 strict 검사되는 TypeScript이고, dist의 JS는
// 그 소스의 빌드 결과뿐이다. 타입 오류는 typecheck·build·pack을 실패시키고 JS를 만들지 않는다.
// 오류 주입은 저장소 사본(임시 디렉토리)에서만 한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { REPO_ROOT, run, tempDir } from './helpers.js';

const PROGRAMS = { node: 'tsconfig.json', web: 'web/tsconfig.json' };
const TSC = path.join(REPO_ROOT, 'node_modules', '.bin', 'tsc');

async function files(root, relative) {
  const out = [];
  for (const entry of await fs.readdir(path.join(root, relative), { withFileTypes: true })) {
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) out.push(...(await files(root, child)));
    else out.push(child);
  }
  return out.sort();
}

const productionFiles = async () => [...(await files(REPO_ROOT, 'src')), ...(await files(REPO_ROOT, 'scripts')), ...(await files(REPO_ROOT, 'web'))];

async function programFiles(config) {
  const { stdout } = await run(TSC, ['-p', config, '--listFilesOnly'], { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 });
  return stdout
    .split('\n')
    .filter((file) => file.startsWith(REPO_ROOT) && !file.includes('/node_modules/'))
    .map((file) => path.relative(REPO_ROOT, file))
    .sort();
}

test('every production source is TypeScript checked by its environment program with strict options and no bypass', async () => {
  const sources = await productionFiles();
  const code = sources.filter((file) => !file.endsWith('/tsconfig.json') && !['web/index.html', 'web/styles.css'].includes(file));
  assert.deepEqual(code.filter((file) => !file.endsWith('.ts')), [], 'no JavaScript production sources');
  const node = await programFiles(PROGRAMS.node);
  const web = await programFiles(PROGRAMS.web);
  assert.deepEqual(node, [...code.filter((file) => /^(src|scripts)\//.test(file)), 'web/api.d.ts'].sort(), 'Node program: src, scripts and the web API contract');
  assert.deepEqual(web, code.filter((file) => file.startsWith('web/')), 'browser program: web only');
  for (const config of Object.values(PROGRAMS)) {
    const { compilerOptions } = JSON.parse((await run(TSC, ['-p', config, '--showConfig'], { cwd: REPO_ROOT })).stdout);
    assert.deepEqual([compilerOptions.strict, compilerOptions.noUncheckedIndexedAccess, compilerOptions.noEmitOnError], [true, true, true], config);
    for (const bypass of ['skipLibCheck', 'noCheck', 'allowJs', 'checkJs']) assert.equal(compilerOptions[bypass], undefined, `${config}: ${bypass}`);
  }
  for (const file of code) assert.doesNotMatch(await fs.readFile(path.join(REPO_ROOT, file), 'utf8'), /@ts-(?:ignore|nocheck|expect-error)/, file);
});

test('dist contains exactly the JavaScript built from the TypeScript sources', async () => {
  const expected = (await productionFiles()).filter((file) => file.endsWith('.ts') && !file.endsWith('.d.ts')).map((file) => `dist/${file.replace(/\.ts$/, '.js')}`);
  assert.deepEqual(await files(REPO_ROOT, 'dist'), expected.sort());
});

test('a type error in src, scripts or web fails typecheck, build and pack and emits no JavaScript', async (t) => {
  const copy = await tempDir(t, 'typed copy');
  for (const entry of ['package.json', 'tsconfig.json', 'src', 'scripts', 'web', 'templates', 'schema', 'docs', 'README.md', 'LICENSE']) {
    await fs.cp(path.join(REPO_ROOT, entry), path.join(copy, entry), { recursive: true });
  }
  await fs.symlink(path.join(REPO_ROOT, 'node_modules'), path.join(copy, 'node_modules'));
  const fails = async (args) => {
    const result = await run('npm', args, { cwd: copy, maxBuffer: 16 * 1024 * 1024 }).then(
      () => ({ failed: false, output: '' }),
      (error) => ({ failed: error.code !== 0, output: `${error.stdout}${error.stderr}` }),
    );
    return result;
  };
  const cases = [
    ['src/config.ts', 'mcpServerName(1);'],
    ['scripts/write-schema.ts', "await fs.writeFile(path.join(PACKAGE_ROOT, 'x'), jsonSchemas);"],
    ['web/adapters/html.ts', 'createHtmlPreview(document.body);'],
  ];
  for (const [file, line] of cases) {
    const target = path.join(copy, file);
    const original = await fs.readFile(target, 'utf8');
    await fs.writeFile(target, `${original}${line}\n`);
    for (const args of [['run', 'typecheck'], ['run', 'build'], ['pack', '--dry-run', '--json']]) {
      const result = await fails(args);
      assert.ok(result.failed, `npm ${args.join(' ')} must fail for ${file}`);
      assert.match(result.output, new RegExp(`${file.replace(/[./]/g, '\\$&')}(?:\\(\\d+,\\d+\\)|:\\d+:\\d+)\\W+error TS\\d+`), `${file}: ${result.output}`);
      await assert.rejects(fs.stat(path.join(copy, 'dist')), { code: 'ENOENT' }, `npm ${args.join(' ')} emitted dist for ${file}`);
    }
    await fs.writeFile(target, original);
  }
  // 오류를 되돌린 같은 사본은 다시 빌드된다.
  await run('npm', ['run', 'build'], { cwd: copy });
  assert.ok((await fs.stat(path.join(copy, 'dist', 'src', 'cli.js'))).isFile());
});
