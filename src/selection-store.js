// 도구가 쓰는 파일은 서비스 config의 selection 하나다. 쓰는 쪽(웹 서버, stdio MCP 프로세스,
// 다른 로컬 호출자)은 owner를 기록한 잠금 파일로 직렬화하고, 같은 디렉토리의 임시 파일을
// rename해 바꾸므로 읽는 쪽은 항상 이전 또는 다음의 완전한 파일만 본다.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkbenchError } from './errors.js';
import { SelectionSchema, z } from './schemas.js';
import { sha256 } from './source.js';

const DEFAULT_LOCK_WAIT_MS = 5_000;
// owner 기록을 읽을 수 없는 잠금(손으로 고친 경우 등)만 시간으로 만료한다. 읽을 수 있는
// 잠금은 owner 프로세스가 없을 때만 오래된 것으로 본다.
const UNREADABLE_LOCK_GRACE_MS = 10_000;

export const lockFileFor = (selectionFile) => path.join(path.dirname(selectionFile), `.${path.basename(selectionFile)}.lock`);

/** 같은 내용이면 같은 바이트가 되도록 키 순서를 고정한다. */
export function serializeSelection(selection) {
  const { schema_version, revision, component_id, variant_id, catalog_revision, source_sha256 } = selection;
  return `${JSON.stringify({ schema_version, revision, component_id, variant_id, catalog_revision, source_sha256 }, null, 2)}\n`;
}

/** @returns {Promise<{selection: z.infer<typeof SelectionSchema> | null, sha256: string | null}>} */
export async function readSelection(selectionFile, displayPath) {
  let raw;
  try {
    raw = await fs.readFile(selectionFile);
  } catch (error) {
    if (error.code === 'ENOENT') return { selection: null, sha256: null };
    throw new WorkbenchError('selection_unreadable', `${displayPath}를 읽을 수 없다 (${error.code}).`);
  }
  let json;
  try {
    json = JSON.parse(raw.toString('utf8'));
  } catch {
    throw new WorkbenchError('selection_unreadable', `${displayPath}가 올바른 JSON이 아니다. 자동으로 덮어쓰지 않는다.`);
  }
  const parsed = SelectionSchema.safeParse(json);
  if (!parsed.success) {
    throw new WorkbenchError('selection_unreadable', `${displayPath} 필드가 schema_version 1 계약과 다르다. 자동으로 덮어쓰지 않는다.`, {
      issues: z.treeifyError(parsed.error),
    });
  }
  return { selection: parsed.data, sha256: sha256(raw) };
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const nonce = () => randomBytes(8).toString('hex');

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/** inode와 owner가 같은 파일의 것이 되도록 잠금을 한 번 열어서 읽는다. */
async function inspectLock(lockPath) {
  let handle;
  try {
    handle = await fs.open(lockPath, 'r');
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  try {
    const stat = await handle.stat();
    let owner = null;
    try {
      const parsed = JSON.parse(await handle.readFile('utf8'));
      if (Number.isInteger(parsed?.pid) && typeof parsed?.nonce === 'string') owner = parsed;
    } catch {
      owner = null;
    }
    return { ino: stat.ino, owner, ageMs: Date.now() - stat.mtimeMs };
  } finally {
    await handle.close();
  }
}

function isStale(info) {
  if (info.owner) return !processExists(info.owner.pid);
  return info.ageMs > UNREADABLE_LOCK_GRACE_MS;
}

/**
 * 검사한 오래된 잠금만 지운다. 먼저 옆으로 rename하고, 검사한 inode일 때만 지운다.
 * 그 사이 다른 잠금으로 바뀌었다면 옮긴 잠금을 제자리에 다시 link한다.
 */
async function breakStaleLock(lockPath, info) {
  const aside = `${lockPath}.${nonce()}.stale`;
  try {
    await fs.rename(lockPath, aside);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  try {
    if ((await fs.stat(aside)).ino !== info.ino) {
      await fs.link(aside, lockPath).catch((error) => {
        // 그 사이 다른 writer가 빈 경로를 가져갔다. 밀려난 owner는 commit 전 assertHeld()에서 알아채고 중단한다.
        if (error.code !== 'EEXIST') throw error;
      });
    }
  } finally {
    await fs.rm(aside, { force: true });
  }
}

/**
 * selection 쓰기의 프로세스 간 상호 배제. 잠금 파일은 `{pid, nonce}`를 담은 staged 파일의
 * hard link로 만들어 owner 기록 없이 존재하는 순간이 없다. `task`가 받는 handle의
 * `assertHeld()`는 commit 직전에 소유를 확인한다.
 */
export async function withSelectionLock(selectionFile, task, { waitMs = DEFAULT_LOCK_WAIT_MS } = {}) {
  const lockPath = lockFileFor(selectionFile);
  const owner = { pid: process.pid, nonce: nonce() };
  const staged = `${lockPath}.${owner.nonce}.staged`;
  const deadline = Date.now() + waitMs;
  let ino;
  await fs.writeFile(staged, `${JSON.stringify(owner)}\n`, { flag: 'wx' });
  try {
    for (;;) {
      try {
        await fs.link(staged, lockPath);
        ino = (await fs.stat(staged)).ino;
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
      }
      const info = await inspectLock(lockPath);
      if (info && isStale(info)) {
        await breakStaleLock(lockPath, info);
        continue;
      }
      if (Date.now() > deadline) {
        throw new WorkbenchError('selection_busy', '다른 저장이 선택 잠금을 쥐고 있어 저장하지 못했다. 다시 읽은 뒤 재시도한다.', {
          lock_owner_pid: info?.owner?.pid ?? null,
        });
      }
      await sleep(10 + Math.random() * 20);
    }
  } finally {
    await fs.rm(staged, { force: true });
  }

  const held = async () => {
    const info = await inspectLock(lockPath);
    return info !== null && info.ino === ino && info.owner?.nonce === owner.nonce;
  };
  const lock = {
    async assertHeld() {
      if (!(await held())) throw new WorkbenchError('selection_busy', '저장 도중 선택 잠금을 잃어 저장하지 않았다. 다시 읽은 뒤 재시도한다.');
    },
  };
  try {
    return await task(lock);
  } finally {
    // 자기 잠금만 푼다. 대신 들어선 잠금은 다른 writer의 것이다.
    if (await held()) await fs.rm(lockPath, { force: true });
  }
}

/** 원자 교체: 같은 디렉토리의 임시 파일, fsync, 소유 확인, rename. */
export async function writeSelectionAtomic(selectionFile, selection, lock) {
  const temp = path.join(path.dirname(selectionFile), `.${path.basename(selectionFile)}.${process.pid}.${nonce()}.tmp`);
  const bytes = serializeSelection(selection);
  try {
    const handle = await fs.open(temp, 'wx');
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await lock.assertHeld();
    await fs.rename(temp, selectionFile);
  } catch (error) {
    await fs.rm(temp, { force: true });
    throw error;
  }
  return sha256(bytes);
}
