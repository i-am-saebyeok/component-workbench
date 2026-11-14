// 서비스 config 탐색·검증과 서비스 루트 안의 경로 해석. 모든 경로는 config가 있는
// 서비스 루트 기준이며, 도구 설치 위치는 서비스 데이터 경로로 쓰지 않는다.
import fs from 'node:fs/promises';
import path from 'node:path';
import { WorkbenchError } from './errors.js';
import { ConfigSchema, zodProblems } from './schemas.js';

export const CONFIG_FILE = 'component-workbench.config.json';
export const DEFAULT_PORT = 4317;

export function defaultConfig(name, title) {
  return {
    schema_version: 1,
    name,
    title,
    catalog: 'workbench/catalog.json',
    selection: 'workbench/selection.json',
    docs_root: 'workbench',
    preview_root: 'workbench/previews',
    server: { port: DEFAULT_PORT },
  };
}

export const serializeConfig = (config) => `${JSON.stringify(config, null, 2)}\n`;

/** 프로젝트 MCP 설정 키와 MCP 서버 이름. */
export const mcpServerName = (name) => `${name}-components`;

export const isInside = (relative, directory) => relative === directory || relative.startsWith(`${directory}/`);

/** schema와 경로 사이 관계를 검사한다. */
export function checkConfig(json) {
  const parsed = ConfigSchema.safeParse(json);
  if (!parsed.success) return { config: null, problems: zodProblems(parsed.error) };
  const config = parsed.data;
  const problems = [];
  if (config.catalog === config.selection) problems.push({ at: 'selection', message_ko: 'selection은 catalog와 다른 파일이어야 한다.' });
  if (isInside(config.selection, config.preview_root)) {
    problems.push({ at: 'selection', message_ko: 'selection은 preview_root 밖에 있어야 한다. preview_root의 파일은 원본 fingerprint에 들어간다.' });
  }
  return { config, problems };
}

export async function findConfigFile(startDir) {
  let dir = path.resolve(startDir);
  for (;;) {
    const candidate = path.join(dir, CONFIG_FILE);
    try {
      if ((await fs.stat(candidate)).isFile()) return candidate;
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'ENOTDIR') throw error;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** `--config` 또는 cwd에서 부모로 찾은 config. `root`는 서비스 루트의 실제 경로다. */
export async function loadConfig({ configFile, cwd = process.cwd() } = {}) {
  const file = configFile ? path.resolve(cwd, configFile) : await findConfigFile(cwd);
  if (!file) {
    throw new WorkbenchError('config_invalid', `${CONFIG_FILE}을 ${cwd}와 그 상위 디렉토리에서 찾지 못했다. 서비스 루트에서 npx component-workbench init을 먼저 실행한다.`);
  }
  let json;
  try {
    json = JSON.parse(await fs.readFile(file, 'utf8'));
  } catch (error) {
    const reason = error instanceof SyntaxError ? `JSON 구문 오류: ${error.message}` : error.code;
    throw new WorkbenchError('config_invalid', `${file}을 읽을 수 없다 (${reason}).`);
  }
  const { config, problems } = checkConfig(json);
  if (problems.length > 0) throw new WorkbenchError('config_invalid', `${file} 내용이 schema_version 1 계약과 다르다.`, { problems });
  const root = await fs.realpath(path.dirname(file));
  return { ...config, root, file: path.join(root, path.basename(file)) };
}

/** 서비스 루트 기준 POSIX 상대 경로 → 절대 경로. */
export const absolutePath = (config, relative) => path.join(config.root, ...relative.split('/'));

/**
 * 서비스 파일 상태: file | missing | symlink | not_file. 서비스 루트 아래 경로에 심볼릭
 * 링크 구성 요소가 있으면(실제 경로가 다르면) symlink로 본다.
 */
export async function inspectServicePath(config, relative) {
  const absolute = absolutePath(config, relative);
  let real;
  try {
    real = await fs.realpath(absolute);
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ENOTDIR') return { state: 'missing', absolute };
    throw error;
  }
  if (real !== absolute) return { state: 'symlink', absolute };
  const stat = await fs.stat(absolute);
  return { state: stat.isFile() ? 'file' : stat.isDirectory() ? 'directory' : 'not_file', absolute };
}

export const PATH_STATE_KO = {
  missing: '없다',
  symlink: '심볼릭 링크를 거치거나 실제 이름의 대소문자가 다르다. 서비스 파일 경로에 심볼릭 링크를 쓰지 않는다',
  directory: '파일이 아니라 디렉토리다',
  not_file: '일반 파일이 아니다',
};
