// 서비스 원본 로더: config 탐색, 일반 schema, 경로·심볼릭 링크 제한, Gherkin 구조·태그,
// source fingerprint. 모든 서비스는 임시 디렉토리에 만든다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { CONFIG_FILE, loadConfig } from '../dist/src/config.js';
import { parseFeature } from '../dist/src/gherkin.js';
import { loadSource } from '../dist/src/source.js';
import { makeService, readJson, rejectsWith, selectFresh, serviceAt, sha256, writeJson } from './helpers.js';

const component = (overrides = {}) => ({
  id: 'panel',
  name: 'Panel',
  description: '테스트 컴포넌트',
  intended_uses: [],
  avoid_uses: [],
  bdd: [],
  variants: [],
  ...overrides,
});

async function withCatalog(t, components, { setup } = {}) {
  const root = await makeService(t);
  await writeJson(path.join(root, 'workbench', 'catalog.json'), { schema_version: 1, revision: 1, components });
  if (setup) await setup(root);
  return { root, config: await loadConfig({ cwd: root }) };
}

async function problemsOf(t, components, options) {
  const { config } = await withCatalog(t, components, options);
  const error = await rejectsWith(loadSource(config), 'catalog_invalid');
  return error.details?.problems ?? [];
}

const has = (problems, at, pattern) => problems.some((item) => item.at.startsWith(at) && pattern.test(item.message_ko));

test('init template catalog serves an empty service: 0 components, no selection, revision 0, no selection file', async (t) => {
  const root = await makeService(t);
  const service = await serviceAt(root);
  const list = await service.listComponents();
  assert.deepEqual(list.components, []);
  assert.deepEqual([list.selection.status, list.selection.revision, list.selection.selection], ['none', 0, null]);
  assert.deepEqual(list.documents.map((doc) => doc.path), ['README.md']);
  await assert.rejects(fs.stat(path.join(root, 'workbench', 'selection.json')), { code: 'ENOENT' });
});

test('config is found from service subdirectories (paths with spaces) or by --config; never from the tool location', async (t) => {
  const root = await makeService(t, { label: 'my service' });
  const deep = path.join(root, 'src', 'deep dir');
  await fs.mkdir(deep, { recursive: true });
  const real = await fs.realpath(root);
  assert.equal((await loadConfig({ cwd: deep })).root, real);
  assert.equal((await loadConfig({ cwd: '/', configFile: path.join(root, CONFIG_FILE) })).root, real);
  const outside = path.dirname(root);
  const missing = await rejectsWith(loadConfig({ cwd: outside }), 'config_invalid');
  assert.match(missing.message, /npx component-workbench init/);
});

test('invalid config values are refused with the offending field', async (t) => {
  const root = await makeService(t);
  const file = path.join(root, CONFIG_FILE);
  const base = await readJson(file);
  const cases = [
    [{ name: 'svc/a' }, 'name'],
    [{ name: 'Svc' }, 'name'],
    [{ title: 'a\nb' }, 'title'],
    [{ catalog: '../catalog.json' }, 'catalog'],
    [{ catalog: '/tmp/catalog.json' }, 'catalog'],
    [{ docs_root: 'work bench' }, 'docs_root'],
    [{ preview_root: '.hidden' }, 'preview_root'],
    [{ selection: 'workbench/previews/selection.json' }, 'selection'],
    [{ selection: 'workbench/catalog.json' }, 'selection'],
    [{ server: { port: 70000 } }, 'server.port'],
    [{ extra: true }, ''],
  ];
  for (const [patch, at] of cases) {
    await writeJson(file, { ...base, ...patch });
    const error = await rejectsWith(loadConfig({ cwd: root }), 'config_invalid');
    assert.ok(error.details.problems.some((item) => item.at === at), `${JSON.stringify(patch)} → ${JSON.stringify(error.details.problems)}`);
  }
});

test('service-defined arbitrary positive dimensions, empty variants and absent previews are accepted as written', async (t) => {
  const { root } = await withCatalog(t, [
    component({ id: 'tiny-rod', preview: { type: 'box', dimensions_m: [0.003, 12.5, 0.25] } }),
    component({ id: 'no-preview' }),
  ]);
  const service = await serviceAt(root);
  const list = await service.listComponents();
  assert.deepEqual(list.components.map((item) => [item.id, item.preview?.dimensions_m ?? null, item.variants.length]), [
    ['tiny-rod', [0.003, 12.5, 0.25], 0],
    ['no-preview', null, 0],
  ]);
  const detail = await service.getComponent({ component_id: 'no-preview' });
  assert.equal(detail.preview, null);
  const saved = await selectFresh(service, 'tiny-rod', null);
  assert.deepEqual([saved.status, saved.selection.variant_id, saved.revision], ['current', null, 1]);
});

test('schema problems are reported per field: unknown keys, unsupported preview type, bad IDs and non-positive sizes', async (t) => {
  const problems = await problemsOf(t, [
    component({ id: 'bad id', extra: 1 }),
    component({ id: 'gltf', preview: { type: 'gltf', src: 'x.glb' } }),
    component({ id: 'flat', preview: { type: 'box', dimensions_m: [1, 0, 1] } }),
    component({ id: 'two', preview: { type: 'box', dimensions_m: [1, 1] } }),
    component({ id: 'color', variants: [{ id: 'v', name: 'V', material: { base_color_srgb_hex: 'blue', roughness: 2, metallic: 0 } }] }),
  ]);
  assert.ok(has(problems, 'components[0].id', /ID/), JSON.stringify(problems));
  assert.ok(has(problems, 'components[0]', /extra/));
  assert.ok(has(problems, 'components[1].preview.type', /box 또는 html/));
  assert.ok(has(problems, 'components[2].preview.dimensions_m[1]', /./));
  assert.ok(has(problems, 'components[3].preview.dimensions_m', /./));
  assert.ok(has(problems, 'components[4].variants[0].material.base_color_srgb_hex', /#RRGGBB/));
  assert.ok(has(problems, 'components[4].variants[0].material.roughness', /./));

  const { config } = await withCatalog(t, []);
  await fs.writeFile(path.join(config.root, 'workbench', 'catalog.json'), '{"schema_version": 1, ');
  assert.match((await rejectsWith(loadSource(config), 'catalog_invalid')).message, /JSON 구문 오류/);
  await writeJson(path.join(config.root, 'workbench', 'catalog.json'), { schema_version: 2, revision: 1, components: [] });
  assert.ok((await rejectsWith(loadSource(config), 'catalog_invalid')).details.problems.some((item) => item.at === 'schema_version'));
});

test('duplicate component IDs and duplicate variant IDs inside one component are refused', async (t) => {
  const variant = { id: 'v', name: 'V' };
  const problems = await problemsOf(t, [component(), component({ variants: [variant, variant] })]);
  assert.ok(has(problems, 'components[1].id', /중복/));
  assert.ok(has(problems, 'components[1].variants[1].id', /중복/));
});

test('BDD and HTML references stay inside their roots: traversal, absolute, hidden, missing and symlinked files are refused', async (t) => {
  const patterns = await problemsOf(t, [
    component({ id: 'a', bdd: ['../outside.feature'] }),
    component({ id: 'b', bdd: ['/etc/x.feature'] }),
    component({ id: 'c', bdd: ['behaviors/.hidden.feature'] }),
    component({ id: 'd', preview: { type: 'html', src: '../index.html' } }),
  ]);
  for (const at of ['components[0].bdd[0]', 'components[1].bdd[0]', 'components[2].bdd[0]', 'components[3].preview.src']) assert.ok(has(patterns, at, /상대 경로/), at);

  const files = await problemsOf(t, [component({ id: 'a', bdd: ['behaviors/missing.feature'] }), component({ id: 'b', preview: { type: 'html', src: 'missing/index.html' } })]);
  assert.ok(has(files, 'components[0].bdd[0]', /없다/));
  assert.ok(has(files, 'components[1].preview.src', /없다/));

  const links = await problemsOf(t, [component({ id: 'a', bdd: ['behaviors/linked.feature'] }), component({ id: 'b', preview: { type: 'html', src: 'linked/index.html' } })], {
    setup: async (root) => {
      const outside = path.join(path.dirname(root), 'outside');
      await fs.mkdir(outside, { recursive: true });
      await fs.writeFile(path.join(outside, 'x.feature'), 'Feature: 밖\n\n@out\nScenario: 밖\n  Given 밖\n');
      await fs.writeFile(path.join(outside, 'index.html'), '<p>outside</p>');
      await fs.symlink(path.join(outside, 'x.feature'), path.join(root, 'workbench', 'behaviors', 'linked.feature'));
      await fs.symlink(outside, path.join(root, 'workbench', 'previews', 'linked'));
    },
  });
  assert.ok(has(links, 'components[0].bdd[0]', /심볼릭 링크/), JSON.stringify(links));
  assert.ok(has(links, 'components[1].preview.src', /심볼릭 링크/));
  assert.ok(has(links, 'preview_root', /심볼릭 링크/));
});

test('Gherkin structure is checked with line numbers; scenario tags are stable IDs unique across the service', async (t) => {
  const check = (text) => parseFeature(text).problems.map((item) => `${item.line}:${item.message_ko}`);
  const valid = [
    '# 주석',
    '@feature-tag',
    'Feature: 정상',
    '  자유 설명 줄',
    '',
    '  Background:',
    '    Given 공통 조건',
    '',
    '  Rule: 규칙',
    '    @ok-one @ok-two',
    '    Scenario: 표와 docstring',
    '      Given 표가 있다',
    '        | a | b |',
    '        | 1 | 2 |',
    '      When 본문을 붙인다',
    '        """',
    '        Then 이 줄은 docstring 안이라 단계가 아니다',
    '        """',
    '      Then 통과한다',
    '',
    '    @ok-outline',
    '    Scenario Outline: 예시',
    '      Given <값>',
    '      Examples:',
    '        | 값 |',
    '        | 1 |',
  ].join('\n');
  assert.deepEqual(check(valid), []);
  assert.deepEqual(parseFeature(valid).scenarios.map((scenario) => scenario.tags), [['@ok-one', '@ok-two'], ['@ok-outline']]);

  const cases = [
    ['Scenario: 앞에 Feature 없음\n  Given x\n', /Feature:가 없다|앞에 Feature:가 없다/],
    ['Feature: f\n\nScenario: 태그 없음\n  Given x\n', /안정 ID 태그가 없다/],
    ['Feature: f\n\n@t\nScenario: 단계 없음\n', /단계가 없다/],
    ['Feature: f\n  Given 시나리오 밖\n', /밖에 있다/],
    ['Feature: f\n\n@t\nScenario: s\n  Given x\n  Gven 오타\n', /알 수 없는 줄/],
    ['Feature: f\n\n@t\nScenario Outline: o\n  Given <x>\n', /Examples가 없다/],
    ['# language: ko\n기능: 한국어\n', /language: ko/],
    ['Feature: f\n\n@bad!tag\nScenario: s\n  Given x\n', /태그 @bad!tag/],
    ['Feature: f\n', /Scenario가 하나도 없다/],
    ['Feature: f\nFeature: g\n\n@t\nScenario: s\n  Given x\n', /한 번만/],
  ];
  for (const [text, pattern] of cases) assert.ok(check(text).some((line) => pattern.test(line)), `${JSON.stringify(text)} → ${check(text)}`);

  // 같은 태그를 두 파일이 쓰면 서비스 원본이 거부된다. 한 파일을 두 컴포넌트가 함께 참조하는 것은 허용한다.
  const problems = await problemsOf(t, [component({ id: 'a', bdd: ['behaviors/one.feature', 'behaviors/two.feature'] })], {
    setup: async (root) => {
      await fs.writeFile(path.join(root, 'workbench', 'behaviors', 'one.feature'), 'Feature: 하나\n\n@shared-id\nScenario: 첫째\n  Given x\n');
      await fs.writeFile(path.join(root, 'workbench', 'behaviors', 'two.feature'), 'Feature: 둘\n\n@shared-id\nScenario: 둘째\n  Given y\n');
    },
  });
  assert.ok(has(problems, 'workbench/behaviors/two.feature:4', /@shared-id가 workbench\/behaviors\/one.feature:4에도/), JSON.stringify(problems));
  const { root } = await withCatalog(t, [component({ id: 'a', bdd: ['behaviors/one.feature'] }), component({ id: 'b', bdd: ['behaviors/one.feature'] })], {
    setup: async (dir) => fs.writeFile(path.join(dir, 'workbench', 'behaviors', 'one.feature'), 'Feature: 하나\n\n@shared-id\nScenario: 첫째\n  Given x\n'),
  });
  assert.deepEqual((await (await serviceAt(root)).listComponents()).documents.map((doc) => doc.path), ['README.md', 'behaviors/one.feature']);
});

test('source fingerprint equals an independent sha256sum manifest and changes on README/BDD/preview-only edits, not on selection writes', async (t) => {
  const root = await makeService(t, { fixture: 'service-b' });
  const config = await loadConfig({ cwd: root });
  const first = await loadSource(config);

  const listed = [];
  async function walk(relative) {
    for (const entry of await fs.readdir(path.join(root, ...relative.split('/')), { withFileTypes: true })) {
      const child = `${relative}/${entry.name}`;
      if (entry.isDirectory()) await walk(child);
      else listed.push(child);
    }
  }
  await walk('workbench/previews');
  const expected = ['workbench/catalog.json', 'workbench/README.md', 'workbench/behaviors/button.feature', ...listed].sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b)));
  const lines = await Promise.all(expected.map(async (file) => `${sha256(await fs.readFile(path.join(root, ...file.split('/'))))}  ${file}\n`));
  assert.deepEqual(first.files.map((file) => file.path), expected);
  assert.equal(first.sourceSha256, sha256(lines.join('')));
  assert.equal(first.catalogSha256, sha256(await fs.readFile(path.join(root, 'workbench', 'catalog.json'))));

  const service = await serviceAt(root);
  await selectFresh(service, 'button', 'primary');
  assert.equal((await loadSource(config)).sourceSha256, first.sourceSha256, 'writing the selection does not change the source');

  let previous = first.sourceSha256;
  for (const file of ['workbench/README.md', 'workbench/behaviors/button.feature', 'workbench/previews/button/button.css']) {
    await fs.appendFile(path.join(root, ...file.split('/')), '\n');
    const next = await loadSource(config);
    assert.notEqual(next.sourceSha256, previous, `${file} edit changes source_sha256`);
    assert.equal(next.catalogSha256, first.catalogSha256, `${file} edit keeps catalog_sha256`);
    previous = next.sourceSha256;
  }
  assert.equal((await service.getSelection()).status, 'stale_source');
});
