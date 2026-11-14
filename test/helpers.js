// 테스트 공용 도구. 모든 서비스는 경로에 공백이 있는 임시 디렉토리에 만들고, 도구 저장소의
// 파일은 쓰지 않는다. fixture는 test/fixtures에만 있고 배포물에 포함하지 않는다.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CONFIG_FILE, defaultConfig, loadConfig, serializeConfig } from '../src/config.js';
import { createWorkbenchService } from '../src/service.js';

export const run = promisify(execFile);
export const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url));
export const CLI = path.join(REPO_ROOT, 'src', 'cli.js');
export const FIXTURES = path.join(REPO_ROOT, 'test', 'fixtures');
const TEMPLATES = path.join(REPO_ROOT, 'templates', 'workbench');

export const sha256 = (data) => createHash('sha256').update(data).digest('hex');
export const readJson = async (file) => JSON.parse(await fs.readFile(file, 'utf8'));
export const writeJson = (file, value) => fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`);

/** 경로에 공백이 들어간 새 임시 디렉토리. 테스트가 끝나면 지운다. */
export async function tempDir(t, label = 'service') {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), 'cw test '));
  t.after(() => fs.rm(base, { recursive: true, force: true }));
  const dir = path.join(base, label);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

/**
 * init 결과와 같은 구조의 서비스(설치 없이 소스 모듈로 검사할 때). fixture를 주면 그 서비스의
 * workbench/ 내용을 덮어 등록한다.
 */
export async function makeService(t, { name = 'svc', title = 'Service', fixture, label } = {}) {
  const root = await tempDir(t, label ?? name);
  await fs.writeFile(path.join(root, CONFIG_FILE), serializeConfig(defaultConfig(name, title)));
  await fs.mkdir(path.join(root, 'workbench', 'behaviors'), { recursive: true });
  await fs.mkdir(path.join(root, 'workbench', 'previews'), { recursive: true });
  for (const file of ['catalog.json', 'README.md', 'behaviors/README.md', 'previews/README.md']) {
    await fs.copyFile(path.join(TEMPLATES, ...file.split('/')), path.join(root, 'workbench', ...file.split('/')));
  }
  if (fixture) await fs.cp(path.join(FIXTURES, fixture, 'workbench'), path.join(root, 'workbench'), { recursive: true });
  return root;
}

export async function serviceAt(root, options) {
  return createWorkbenchService(await loadConfig({ cwd: root }), options);
}

/** 원본을 새로 읽은 revision·fingerprint로 저장한다(정상 클라이언트의 동작). */
export async function selectFresh(service, component_id, variant_id) {
  const current = await service.getSelection();
  return service.selectComponent({ component_id, variant_id, expected_selection_revision: current.revision, expected_source_sha256: current.source.source_sha256 });
}

export async function rejectsWith(promise, code) {
  try {
    await promise;
  } catch (error) {
    if (error.code === code) return error;
    throw new Error(`expected ${code}, got ${error.code}: ${error.message}`);
  }
  throw new Error(`expected ${code}, but the call succeeded`);
}

/** 디렉토리 전체의 경로 → sha256(파일) / 'dir' / 'link:<대상>'. 무변경 비교에 쓴다. */
export async function snapshot(root, { skip = [] } = {}) {
  const entries = {};
  async function walk(dir, prefix) {
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (skip.includes(relative)) continue;
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) entries[relative] = `link:${await fs.readlink(absolute)}`;
      else if (entry.isDirectory()) {
        entries[relative] = 'dir';
        await walk(absolute, relative);
      } else entries[relative] = sha256(await fs.readFile(absolute));
    }
  }
  await walk(root, '');
  return entries;
}
