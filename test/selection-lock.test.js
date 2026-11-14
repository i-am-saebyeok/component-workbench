// 프로세스 간 selection 쓰기: owner 인식 잠금, 원자 교체, 오래된 잠금 복구.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { lockFileFor, withSelectionLock, writeSelectionAtomic } from '../dist/src/selection-store.js';
import { makeService, readJson, rejectsWith, selectFresh, serviceAt, writeJson } from './helpers.js';

const WORKER = fileURLToPath(new URL('./workers/select-worker.js', import.meta.url));
const SELECTION = { schema_version: 1, revision: 1, component_id: 'button', variant_id: 'primary', catalog_revision: 1, source_sha256: '0'.repeat(64) };

async function service(t) {
  const root = await makeService(t, { fixture: 'service-b' });
  const file = path.join(root, 'workbench', 'catalog.json');
  const catalog = await readJson(file);
  catalog.components.push({ id: 'divider', name: 'Divider', description: 'variant 없는 컴포넌트', intended_uses: [], avoid_uses: [], bdd: [], variants: [] });
  await writeJson(file, catalog);
  return { root, selection: path.join(root, 'workbench', 'selection.json') };
}

function runWorker(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [WORKER, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.stderr.on('data', (chunk) => (err += chunk));
    child.once('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`worker exit ${code}: ${err}`))));
  });
}

async function deadPid() {
  const child = spawn(process.execPath, ['-e', '']);
  await new Promise((resolve) => child.once('exit', resolve));
  return child.pid;
}

function liveProcess(t) {
  const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  t.after(() => child.kill());
  return child;
}

const leftovers = async (selection) => (await fs.readdir(path.dirname(selection))).filter((name) => name.startsWith('.selection.json'));

test('racing processes with the same expected revision: exactly one save wins', async (t) => {
  const { root, selection } = await service(t);
  const startAt = String(Date.now() + 400);
  const outcomes = await Promise.all(Array.from({ length: 6 }, (_, index) => runWorker([root, 'once', startAt, String(index)])));
  assert.equal(outcomes.filter((outcome) => outcome.won).length, 1);
  assert.ok(outcomes.filter((outcome) => !outcome.won).every((outcome) => outcome.code === 'selection_conflict'));
  assert.equal((await readJson(selection)).revision, 1);
  assert.deepEqual(await leftovers(selection), []);
});

test('concurrent writer processes lose no update: final revision equals the number of successful changes', async (t) => {
  const { root, selection } = await service(t);
  const startAt = String(Date.now() + 400);
  const rounds = 10;
  const outcomes = await Promise.all(Array.from({ length: 4 }, (_, index) => runWorker([root, 'loop', startAt, String(index), String(rounds)])));
  const changes = outcomes.reduce((sum, outcome) => sum + outcome.changed, 0);
  assert.equal(changes, 4 * rounds);
  assert.equal((await readJson(selection)).revision, changes);
  assert.deepEqual(await leftovers(selection), []);
});

test('a lock left by a crashed writer (dead PID) is recovered', async (t) => {
  const { root, selection } = await service(t);
  await fs.writeFile(lockFileFor(selection), JSON.stringify({ pid: await deadPid(), nonce: 'crashed' }));
  const saved = await selectFresh(await serviceAt(root, { lockWaitMs: 2000 }), 'button', 'secondary');
  assert.equal(saved.revision, 1);
  assert.deepEqual(await leftovers(selection), []);
});

test('a lock held by a live process is never broken or released by another writer, regardless of its age', async (t) => {
  const { root, selection } = await service(t);
  const workbench = await serviceAt(root, { lockWaitMs: 300 });
  await selectFresh(workbench, 'button', 'primary');
  const lock = lockFileFor(selection);
  const owner = liveProcess(t);
  const record = JSON.stringify({ pid: owner.pid, nonce: 'live-owner' });
  await fs.writeFile(lock, record);
  const past = new Date(Date.now() - 3_600_000);
  await fs.utimes(lock, past, past);
  const inode = (await fs.stat(lock)).ino;

  const busy = await rejectsWith(selectFresh(workbench, 'divider', null), 'selection_busy');
  assert.equal(busy.details.lock_owner_pid, owner.pid);
  assert.equal(await fs.readFile(lock, 'utf8'), record);
  assert.equal((await fs.stat(lock)).ino, inode);
  assert.equal((await readJson(selection)).component_id, 'button');

  owner.kill();
  await new Promise((resolve) => owner.once('exit', resolve));
  const saved = await selectFresh(workbench, 'divider', null);
  assert.deepEqual([saved.selection.component_id, saved.revision], ['divider', 2]);
});

test('an unreadable lock is honored while fresh and aged out only after the grace period', async (t) => {
  const { root, selection } = await service(t);
  const workbench = await serviceAt(root, { lockWaitMs: 300 });
  const lock = lockFileFor(selection);
  await fs.writeFile(lock, 'not json');
  await rejectsWith(selectFresh(workbench, 'button', 'primary'), 'selection_busy');
  const past = new Date(Date.now() - 60_000);
  await fs.utimes(lock, past, past);
  assert.equal((await selectFresh(workbench, 'button', 'primary')).revision, 1);
});

test('a failed atomic write removes its temp file and releases the lock', async (t) => {
  const { selection } = await service(t);
  // selection.json을 비어 있지 않은 디렉토리로 만들어 마지막 rename을 실패시킨다.
  await fs.mkdir(path.join(selection, 'blocker'), { recursive: true });
  await assert.rejects(withSelectionLock(selection, (lock) => writeSelectionAtomic(selection, SELECTION, lock)));
  assert.deepEqual(await leftovers(selection), []);
});

test('a writer that lost its lock before commit does not write and does not release the replacement lock', async (t) => {
  const { selection } = await service(t);
  const lock = lockFileFor(selection);
  const other = JSON.stringify({ pid: process.pid, nonce: 'someone-else' });
  await rejectsWith(
    withSelectionLock(selection, async (held) => {
      await fs.rm(lock);
      await fs.writeFile(lock, other);
      await writeSelectionAtomic(selection, SELECTION, held);
    }),
    'selection_busy',
  );
  await assert.rejects(fs.stat(selection), { code: 'ENOENT' });
  assert.equal(await fs.readFile(lock, 'utf8'), other);
});
