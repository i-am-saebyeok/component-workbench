// 선택 저장·revision/원본 잠금·recipe·validate_component. 서비스 A/B fixture는 임시 서비스에만 복사한다.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { makeService, readJson, rejectsWith, selectFresh, serviceAt, sha256, snapshot, writeJson } from './helpers.js';

const selectionFile = (root) => path.join(root, 'workbench', 'selection.json');

test('empty service: selecting is refused without inventing a component, recipe reports selection_missing, nothing is written', async (t) => {
  const root = await makeService(t);
  const service = await serviceAt(root);
  const before = await snapshot(root);
  const refused = await rejectsWith(selectFresh(service, 'anything', null), 'invalid_selection');
  assert.deepEqual(refused.details.reasons.map((reason) => reason.code), ['unknown_component']);
  await rejectsWith(service.getRecipe(), 'selection_missing');
  await rejectsWith(service.getComponent({ component_id: 'anything' }), 'not_found');
  const check = await service.validateComponent({ component_id: 'anything' });
  assert.deepEqual([check.valid, check.reasons[0].code, check.scenarios_executed], [false, 'unknown_component', false]);
  assert.deepEqual(await snapshot(root), before);
});

test('first valid selection creates the file; the same pair again keeps the revision; a restarted service reads it', async (t) => {
  const root = await makeService(t, { fixture: 'service-a' });
  const service = await serviceAt(root);
  const saved = await selectFresh(service, 'storage-panel', 'metal-blue');
  assert.deepEqual([saved.changed, saved.status, saved.revision], [true, 'current', 1]);
  const file = await readJson(selectionFile(root));
  assert.deepEqual(Object.keys(file), ['schema_version', 'revision', 'component_id', 'variant_id', 'catalog_revision', 'source_sha256']);
  assert.deepEqual([file.component_id, file.variant_id, file.catalog_revision, file.source_sha256], ['storage-panel', 'metal-blue', 2, saved.source.source_sha256]);
  const bytes = await fs.readFile(selectionFile(root));
  const again = await selectFresh(service, 'storage-panel', 'metal-blue');
  assert.deepEqual([again.changed, again.revision], [false, 1]);
  assert.ok(bytes.equals(await fs.readFile(selectionFile(root))));
  const restarted = await (await serviceAt(root)).getSelection();
  assert.deepEqual([restarted.status, restarted.selection.component_id, restarted.revision], ['current', 'storage-panel', 1]);
});

test('variant rules are generic: required when variants exist, unknown variants refused, null only for variant-less components', async (t) => {
  const root = await makeService(t, { fixture: 'service-b' });
  const service = await serviceAt(root);
  for (const [variant, code] of [[null, 'variant_required'], [undefined, 'variant_required'], ['tertiary', 'unknown_variant']]) {
    const error = await rejectsWith(selectFresh(service, 'button', variant), 'invalid_selection');
    assert.deepEqual(error.details.reasons.map((reason) => reason.code), [code]);
  }
  const catalog = await readJson(path.join(root, 'workbench', 'catalog.json'));
  catalog.components.push({ id: 'divider', name: 'Divider', description: 'variant 없는 컴포넌트', intended_uses: [], avoid_uses: [], bdd: [], variants: [] });
  await writeJson(path.join(root, 'workbench', 'catalog.json'), catalog);
  const error = await rejectsWith(selectFresh(service, 'divider', 'primary'), 'invalid_selection');
  assert.deepEqual(error.details.reasons.map((reason) => reason.code), ['variant_not_available']);
  assert.equal((await selectFresh(service, 'divider', undefined)).selection.variant_id, null);
  const extra = await rejectsWith(service.selectComponent({ component_id: 'button', variant_id: 'primary', expected_selection_revision: 0, expected_source_sha256: '0'.repeat(64), material: {} }), 'invalid_request');
  assert.ok(extra.details.problems.length > 0);
});

test('a save based on an old selection revision fails and keeps the first save', async (t) => {
  const root = await makeService(t, { fixture: 'service-b' });
  const service = await serviceAt(root);
  const stale = await service.getSelection();
  await selectFresh(service, 'button', 'primary');
  const error = await rejectsWith(
    service.selectComponent({ component_id: 'button', variant_id: 'secondary', expected_selection_revision: stale.revision, expected_source_sha256: stale.source.source_sha256 }),
    'selection_conflict',
  );
  assert.equal(error.details.current.selection.variant_id, 'primary');
  assert.equal((await readJson(selectionFile(root))).variant_id, 'primary');
});

test('a document-only edit makes the saved selection stale, refuses saves based on the old fingerprint and blocks the recipe until reselected', async (t) => {
  const root = await makeService(t, { fixture: 'service-a' });
  const service = await serviceAt(root);
  const saved = await selectFresh(service, 'storage-panel', 'metal-blue');
  const feature = path.join(root, 'workbench', 'behaviors', 'storage-panel.feature');
  await fs.appendFile(feature, '\n  # 문서만 고친 줄\n');
  const after = await service.getSelection();
  assert.equal(after.status, 'stale_source');
  assert.equal(after.source.catalog_sha256, saved.source.catalog_sha256);
  assert.notEqual(after.source.source_sha256, saved.source.source_sha256);
  assert.ok(after.issues.some((issue) => issue.code === 'source_changed'));
  const error = await rejectsWith(
    service.selectComponent({ component_id: 'storage-panel', variant_id: 'metal-blue', expected_selection_revision: 1, expected_source_sha256: saved.source.source_sha256 }),
    'source_conflict',
  );
  assert.equal(error.details.current.revision, 1);
  await rejectsWith(service.getRecipe(), 'selection_stale');
  const reselected = await selectFresh(service, 'storage-panel', 'metal-blue');
  assert.deepEqual([reselected.changed, reselected.revision, reselected.status], [true, 2, 'current']);
});

test('removing the selected component leaves the selection unresolvable instead of substituting another', async (t) => {
  const root = await makeService(t, { fixture: 'service-b' });
  const service = await serviceAt(root);
  await selectFresh(service, 'button', 'secondary');
  await writeJson(path.join(root, 'workbench', 'catalog.json'), { schema_version: 1, revision: 2, components: [] });
  const current = await service.getSelection();
  assert.deepEqual([current.status, current.component, current.selection.component_id], ['unresolvable', null, 'button']);
  await rejectsWith(service.getRecipe(), 'selection_stale');
});

test('an unreadable selection file is reported and never overwritten', async (t) => {
  const root = await makeService(t, { fixture: 'service-b' });
  const service = await serviceAt(root);
  await fs.writeFile(selectionFile(root), '{"broken"');
  await rejectsWith(service.getSelection(), 'selection_unreadable');
  await rejectsWith(service.selectComponent({ component_id: 'button', variant_id: 'primary', expected_selection_revision: 0, expected_source_sha256: '0'.repeat(64) }), 'selection_unreadable');
  assert.equal(await fs.readFile(selectionFile(root), 'utf8'), '{"broken"');
});

test('recipe pins the selection to the exact source files with service-root paths and writes nothing', async (t) => {
  const root = await makeService(t, { name: 'svc-a', title: 'Service A', fixture: 'service-a' });
  const service = await serviceAt(root);
  await selectFresh(service, 'storage-panel', 'metal-blue');
  const before = await snapshot(root);
  const recipe = await service.getRecipe();
  assert.deepEqual(await snapshot(root), before);
  assert.equal(recipe.kind, 'component-workbench/selection-recipe');
  assert.deepEqual(recipe.workbench, { name: 'svc-a', title: 'Service A' });
  assert.deepEqual([recipe.component.id, recipe.variant.id, recipe.preview], ['storage-panel', 'metal-blue', { type: 'box', dimensions_m: [3, 1, 1.5] }]);
  assert.deepEqual(recipe.variant.material, { base_color_srgb_hex: '#4F7AA8', roughness: 0.4, metallic: 0.7 });
  assert.deepEqual(recipe.documents.map((doc) => doc.path), ['workbench/behaviors/storage-panel.feature']);
  assert.deepEqual(recipe.documents[0].scenario_ids, ['@storage-panel-view-does-not-select', '@storage-panel-selection-persists']);
  for (const file of [...recipe.source.files, ...recipe.documents]) {
    assert.ok(!path.isAbsolute(file.path) && !file.path.includes('\\'), file.path);
    assert.equal(sha256(await fs.readFile(path.join(root, ...file.path.split('/')))), file.sha256, file.path);
  }
  assert.equal(recipe.selection.path, 'workbench/selection.json');
  assert.equal(recipe.selection.sha256, sha256(await fs.readFile(selectionFile(root))));
});

test('validate_component checks a selectable pair or a candidate definition against the real service files, without writing', async (t) => {
  const root = await makeService(t, { fixture: 'service-b' });
  const service = await serviceAt(root);
  const before = await snapshot(root);
  const pair = await service.validateComponent({ component_id: 'button', variant_id: 'secondary' });
  assert.deepEqual([pair.valid, pair.preview.src, pair.documents[0].scenario_ids.length, pair.writes, pair.scenarios_executed], [true, 'button/secondary.html', 3, false, false]);

  await fs.writeFile(path.join(root, 'workbench', 'behaviors', 'card.feature'), 'Feature: 카드\n\n@card-shows-title\nScenario: 제목\n  Given 카드가 있다\n  Then 제목이 보인다\n');
  const good = await service.validateComponent({
    definition: { id: 'card', name: 'Card', description: '후보', intended_uses: ['목록 항목'], avoid_uses: [], bdd: ['behaviors/card.feature'], preview: { type: 'html', src: 'button/primary.html' }, variants: [] },
  });
  assert.deepEqual([good.valid, good.reasons, good.documents], [true, [], [{ path: 'behaviors/card.feature', scenario_ids: ['@card-shows-title'] }]]);

  await fs.writeFile(path.join(root, 'workbench', 'behaviors', 'dup.feature'), 'Feature: 중복\n\n@html-button-click-counter\nScenario: 같은 ID\n  Given x\n');
  const bad = await service.validateComponent({
    definition: { id: 'card', name: 'Card', description: '후보', intended_uses: [], avoid_uses: [], bdd: ['behaviors/dup.feature', 'behaviors/none.feature'], preview: { type: 'svg', src: 'x' }, variants: [] },
  });
  assert.equal(bad.valid, false);
  assert.ok(bad.reasons.some((reason) => reason.at === 'definition.preview.type'), JSON.stringify(bad.reasons));
  const refs = await service.validateComponent({
    definition: { id: 'card', name: 'Card', description: '후보', intended_uses: [], avoid_uses: [], bdd: ['behaviors/dup.feature', 'behaviors/none.feature'], variants: [] },
  });
  assert.ok(refs.reasons.some((reason) => reason.at === 'definition.bdd[1]' && /없다/.test(reason.message_ko)));
  assert.ok(refs.reasons.some((reason) => /@html-button-click-counter/.test(reason.message_ko)));
  await rejectsWith(service.validateComponent({ component_id: 'button', definition: {} }), 'invalid_request');
  const after = await snapshot(root);
  delete after['workbench/behaviors/card.feature'];
  delete after['workbench/behaviors/dup.feature'];
  assert.deepEqual(after, before);
});
