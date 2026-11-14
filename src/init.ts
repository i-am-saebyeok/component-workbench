// 소비 서비스 init. 모든 대상 파일을 먼저 읽고 검사해 변경 계획을 만든 뒤, 충돌이 하나도
// 없을 때만 적용한다. 적용 중 실패하면 만든 파일·디렉토리를 지우고 고친 파일을 되돌린다.
import { randomBytes } from 'node:crypto';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse as parseToml } from 'smol-toml';
import { CONFIG_FILE, checkConfig, defaultConfig, mcpServerName, serializeConfig } from './config.js';
import { messageOf, systemCode } from './errors.js';
import { PACKAGE, PACKAGE_ROOT } from './package.js';
import { ServiceName, Title } from './schemas.js';
import type { Config } from './schemas.js';

const TEMPLATE_DIR = path.join(PACKAGE_ROOT, 'templates', 'workbench');
export const INSTALL_COMMAND = `npm install -D git+https://github.com/i-am-saebyeok/component-workbench.git#v${PACKAGE.version}`;
export const SCRIPTS = { workbench: 'component-workbench serve', 'workbench:mcp': 'component-workbench mcp' };
export const MCP_COMMAND = { command: 'npx', args: ['--no-install', 'component-workbench', 'mcp'] };

export type InitProblem = { path: string; message_ko: string };
export type InitChange = { relative: string; before: Buffer | null; after: Buffer; summary: string };
export type InitPlan = { root: string; changes: InitChange[]; kept: string[]; config: Config };
export type InitOptions = { target?: string | undefined; name?: string | undefined; title?: string | undefined; runningRoot?: string };

export class InitError extends Error {
  readonly problems: InitProblem[];

  constructor(message: string, problems: InitProblem[] = []) {
    super(message);
    this.name = 'InitError';
    this.problems = problems;
  }
}

type Probe = { state: 'missing' } | { state: 'file'; bytes: Buffer } | { state: 'conflict'; reason: string };
type JsonObject = Record<string, unknown>;
type JsonFormat = { indent: string; eol: string; finalNewline: boolean };

/** 경로 구성 요소를 lstat으로 따라가며 상태를 본다: missing | file(bytes) | conflict(reason). */
async function probe(root: string, relative: string): Promise<Probe> {
  const parts = relative.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    const shown = parts.slice(0, index + 1).join('/');
    let stat;
    try {
      stat = await fs.lstat(path.join(root, ...parts.slice(0, index + 1)));
    } catch (error) {
      if (systemCode(error) === 'ENOENT') return { state: 'missing' };
      throw error;
    }
    const last = index === parts.length - 1;
    if (stat.isSymbolicLink()) return { state: 'conflict', reason: `${shown}가 심볼릭 링크다. init은 링크를 따라 쓰지 않는다.` };
    if (!last && !stat.isDirectory()) return { state: 'conflict', reason: `${shown}가 디렉토리가 아니다.` };
    if (last && !stat.isFile()) return { state: 'conflict', reason: `${shown}가 일반 파일이 아니다.` };
  }
  return { state: 'file', bytes: await fs.readFile(path.join(root, ...parts)) };
}

/** 기존 JSON의 들여쓰기·줄바꿈·마지막 개행을 유지해 다시 쓴다. */
function jsonFormat(text: string): JsonFormat {
  return {
    indent: /^([ \t]+)"/m.exec(text)?.[1] ?? '  ',
    eol: text.includes('\r\n') ? '\r\n' : '\n',
    finalNewline: text === '' || /\n$/.test(text),
  };
}

function formatJson(value: unknown, { indent, eol, finalNewline }: JsonFormat = jsonFormat('')): Buffer {
  const text = JSON.stringify(value, null, indent).replace(/\n/g, eol);
  return Buffer.from(finalNewline ? text + eol : text);
}

const isPlainObject = (value: unknown): value is JsonObject => value !== null && typeof value === 'object' && !Array.isArray(value);
const plain = (value: unknown): unknown => JSON.parse(JSON.stringify(value));
/** JSON 값의 `value[key]`. 객체가 아니면 undefined다. */
const member = (value: unknown, key: string): unknown => (isPlainObject(value) ? value[key] : undefined);

function parseJsonObject(bytes: Buffer): { value: JsonObject; reason?: never } | { value?: never; reason: string } {
  try {
    const value: unknown = JSON.parse(bytes.toString('utf8'));
    return isPlainObject(value) ? { value } : { reason: 'JSON 객체가 아니다.' };
  } catch (error) {
    return { reason: `올바른 JSON이 아니다 (${messageOf(error)}).` };
  }
}

function deriveName(packageName: unknown): string {
  return String(packageName ?? '')
    .replace(/^@[^/]+\//, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 50)
    .replace(/^-+|-+$/g, '');
}

async function assertInstalled(root: string, servicePackage: JsonObject, runningRoot: string) {
  const declared = member(servicePackage.devDependencies, PACKAGE.name) ?? member(servicePackage.dependencies, PACKAGE.name);
  let installed = null;
  try {
    installed = await fs.realpath(path.dirname(createRequire(path.join(root, 'package.json')).resolve(`${PACKAGE.name}/package.json`)));
  } catch {
    installed = null;
  }
  const running = await fs.realpath(runningRoot);
  if (!declared || !installed) {
    throw new InitError(
      `이 서비스(${root})에 ${PACKAGE.name}이 설치되어 있지 않다. 생성할 npm scripts와 MCP 설정은 서비스에 설치된 도구를 실행하므로 먼저 서비스 루트에서 설치한다:\n  ${INSTALL_COMMAND}\n  npx component-workbench init`,
    );
  }
  if (installed !== running) {
    throw new InitError(`지금 실행한 CLI(${running})는 이 서비스에 설치된 도구(${installed})가 아니다. 서비스 루트에서 설치된 CLI로 실행한다:\n  npx component-workbench init`);
  }
}

/** 파일을 쓰지 않고 init 계획을 만든다. 충돌이 있으면 모두 모아 InitError로 보고한다. */
export async function planInit({ target = process.cwd(), name, title, runningRoot = PACKAGE_ROOT }: InitOptions = {}): Promise<InitPlan> {
  let root;
  try {
    root = await fs.realpath(path.resolve(target));
  } catch {
    throw new InitError(`대상 디렉토리 ${path.resolve(target)}가 없다.`);
  }
  const problems: InitProblem[] = [];
  const changes: InitChange[] = [];
  const kept: string[] = [];
  const conflict = (relative: string, message_ko: string) => problems.push({ path: relative, message_ko });

  const packageProbe = await probe(root, 'package.json');
  if (packageProbe.state !== 'file') {
    throw new InitError(`${root}에 package.json이 없다. 서비스 루트에서 실행하거나 --target으로 서비스 루트를 지정한다.`);
  }
  const servicePackage = parseJsonObject(packageProbe.bytes);
  if (!servicePackage.value) throw new InitError(`package.json: ${servicePackage.reason}`);
  await assertInstalled(root, servicePackage.value, runningRoot);

  // config: 첫 init이면 만들고, 있으면 그 값을 따른다(반복 init).
  let config: Config;
  const configProbe = await probe(root, CONFIG_FILE);
  const firstInit = configProbe.state === 'missing';
  if (configProbe.state === 'conflict') {
    throw new InitError('init을 진행할 수 없다.', [{ path: CONFIG_FILE, message_ko: configProbe.reason }]);
  } else if (configProbe.state === 'file') {
    const parsed = parseJsonObject(configProbe.bytes);
    const checked = parsed.value ? checkConfig(parsed.value) : { config: null, problems: [{ at: '', message_ko: parsed.reason }] };
    if (!checked.config || checked.problems.length > 0) {
      throw new InitError('기존 config를 사용할 수 없다.', checked.problems.map((item) => ({ path: CONFIG_FILE, message_ko: `${item.at ? `${item.at}: ` : ''}${item.message_ko}` })));
    }
    config = checked.config;
    if (name !== undefined && name !== config.name) conflict(CONFIG_FILE, `--name ${name}이 기존 config의 name ${config.name}과 다르다.`);
    if (title !== undefined && title !== config.title) conflict(CONFIG_FILE, `--title "${title}"이 기존 config의 title "${config.title}"과 다르다.`);
    kept.push(CONFIG_FILE);
  } else {
    const serviceName = name ?? deriveName(servicePackage.value.name);
    if (!ServiceName.safeParse(serviceName).success) {
      throw new InitError(`서비스 이름 ${JSON.stringify(serviceName)}은 slug(소문자·숫자·하이픈, 50자 이하)가 아니다. --name으로 지정한다.`);
    }
    const serviceTitle = title ?? serviceName;
    if (!Title.safeParse(serviceTitle).success) throw new InitError('--title은 제어 문자가 없는 1~80자여야 한다.');
    config = defaultConfig(serviceName, serviceTitle);
    changes.push({ relative: CONFIG_FILE, before: null, after: Buffer.from(serializeConfig(config)), summary: '생성' });
  }

  // 서비스 소유 파일: 없을 때만 템플릿을 복사한다. 반복 init에서는 내용과 관계없이 보존한다.
  const templates: [target: string, template: string][] = [
    [config.catalog, 'catalog.json'],
    [`${config.docs_root}/README.md`, 'README.md'],
    [`${config.docs_root}/behaviors/README.md`, 'behaviors/README.md'],
    [`${config.preview_root}/README.md`, 'previews/README.md'],
  ];
  const planned = new Set<string>();
  for (const [relative, template] of templates) {
    if (planned.has(relative)) continue;
    planned.add(relative);
    const content = await fs.readFile(path.join(TEMPLATE_DIR, ...template.split('/')));
    const found = await probe(root, relative);
    if (found.state === 'conflict') conflict(relative, found.reason);
    else if (found.state === 'missing') changes.push({ relative, before: null, after: content, summary: '생성' });
    else if (firstInit && !found.bytes.equals(content)) conflict(relative, '이미 다른 내용의 파일이 있다. init은 기존 파일을 덮어쓰지 않는다.');
    else kept.push(relative);
  }

  // package.json scripts
  const scripts = servicePackage.value.scripts;
  if (scripts !== undefined && !isPlainObject(scripts)) {
    conflict('package.json', 'scripts가 객체가 아니다.');
  } else {
    const additions: Record<string, string> = {};
    for (const [key, value] of Object.entries(SCRIPTS)) {
      if (scripts?.[key] === undefined) additions[key] = value;
      else if (scripts[key] !== value) conflict('package.json', `scripts.${key}가 이미 "${scripts[key]}"로 있다. init이 추가할 값은 "${value}"다.`);
    }
    if (Object.keys(additions).length > 0) {
      const after = formatJson({ ...servicePackage.value, scripts: { ...(scripts ?? {}), ...additions } }, jsonFormat(packageProbe.bytes.toString('utf8')));
      changes.push({ relative: 'package.json', before: packageProbe.bytes, after, summary: `scripts 추가: ${Object.keys(additions).join(', ')}` });
    } else {
      kept.push('package.json');
    }
  }

  // 프로젝트 MCP 설정 두 곳. 같은 키가 다른 설정이면 충돌이다.
  const key = mcpServerName(config.name);
  const mcpEntry = { type: 'stdio', ...MCP_COMMAND };
  const mcpProbe = await probe(root, '.mcp.json');
  if (mcpProbe.state === 'conflict') {
    conflict('.mcp.json', mcpProbe.reason);
  } else if (mcpProbe.state === 'missing') {
    changes.push({ relative: '.mcp.json', before: null, after: formatJson({ mcpServers: { [key]: mcpEntry } }), summary: `mcpServers.${key} 추가` });
  } else {
    const parsed = parseJsonObject(mcpProbe.bytes);
    const servers = parsed.value?.mcpServers;
    if (!parsed.value) conflict('.mcp.json', parsed.reason);
    else if (servers !== undefined && !isPlainObject(servers)) conflict('.mcp.json', 'mcpServers가 객체가 아니다.');
    else if (servers?.[key] === undefined) {
      const after = formatJson({ ...parsed.value, mcpServers: { ...(servers ?? {}), [key]: mcpEntry } }, jsonFormat(mcpProbe.bytes.toString('utf8')));
      changes.push({ relative: '.mcp.json', before: mcpProbe.bytes, after, summary: `mcpServers.${key} 추가` });
    } else if (!isDeepStrictEqual(servers[key], mcpEntry)) conflict('.mcp.json', `mcpServers.${key}가 이미 다른 설정으로 있다.`);
    else kept.push('.mcp.json');
  }

  const codexPath = '.codex/config.toml';
  const tomlBlock = `[mcp_servers.${key}]\ncommand = ${JSON.stringify(MCP_COMMAND.command)}\nargs = [${MCP_COMMAND.args.map((arg) => JSON.stringify(arg)).join(', ')}]\n`;
  const codexProbe = await probe(root, codexPath);
  if (codexProbe.state === 'conflict') {
    conflict(codexPath, codexProbe.reason);
  } else if (codexProbe.state === 'missing') {
    changes.push({ relative: codexPath, before: null, after: Buffer.from(tomlBlock), summary: `mcp_servers.${key} 추가` });
  } else {
    const text = codexProbe.bytes.toString('utf8');
    let parsed = null;
    try {
      parsed = parseToml(text);
    } catch (error) {
      conflict(codexPath, `올바른 TOML이 아니다 (${messageOf(error).split('\n')[0]}).`);
    }
    const servers = parsed?.mcp_servers;
    if (!parsed) {
      // 위에서 보고했다.
    } else if (servers !== undefined && !isPlainObject(servers)) {
      conflict(codexPath, 'mcp_servers가 table이 아니다.');
    } else if (servers?.[key] === undefined) {
      // 기존 주석·서식을 보존하도록 끝에 table을 덧붙이고, 결과가 의도한 값으로 해석되는지 확인한다.
      const eol = text.includes('\r\n') ? '\r\n' : '\n';
      const separator = text === '' ? '' : text.endsWith('\n') ? eol : eol + eol;
      const next = text + separator + tomlBlock.replace(/\n/g, eol);
      let appended = null;
      try {
        appended = parseToml(next);
      } catch {
        appended = null;
      }
      if (appended && isDeepStrictEqual(plain(member(appended.mcp_servers, key)), MCP_COMMAND)) {
        changes.push({ relative: codexPath, before: codexProbe.bytes, after: Buffer.from(next), summary: `mcp_servers.${key} 추가` });
      } else {
        conflict(codexPath, `기존 TOML 구조(예: inline table) 때문에 [mcp_servers.${key}]를 안전하게 덧붙일 수 없다.`);
      }
    } else if (!isDeepStrictEqual(plain(servers[key]), MCP_COMMAND)) {
      conflict(codexPath, `mcp_servers.${key}가 이미 다른 설정으로 있다.`);
    } else {
      kept.push(codexPath);
    }
  }

  if (problems.length > 0) throw new InitError('충돌이 있어 init을 적용하지 않았다. 어떤 파일도 바꾸지 않았다.', problems);
  return { root, changes, kept, config };
}

/** 계획을 적용한다. 계획 이후 대상이 바뀌었으면 쓰기 전에 중단한다. */
export async function applyInit(plan: InitPlan): Promise<void> {
  for (const change of plan.changes) {
    const now = await probe(plan.root, change.relative);
    const same = change.before === null ? now.state === 'missing' : now.state === 'file' && now.bytes.equals(change.before);
    if (!same) throw new InitError('init 계획 이후 대상 파일이 바뀌어 적용하지 않았다. 다시 실행한다.', [{ path: change.relative, message_ko: '계획 이후 바뀌었다.' }]);
  }
  const createdDirs: string[] = [];
  const done: { change: InitChange; absolute: string }[] = [];
  try {
    for (const change of plan.changes) {
      const parts = change.relative.split('/');
      for (let index = 1; index < parts.length; index += 1) {
        const dir = path.join(plan.root, ...parts.slice(0, index));
        try {
          await fs.mkdir(dir);
          createdDirs.push(dir);
        } catch (error) {
          if (systemCode(error) !== 'EEXIST') throw error;
        }
      }
      const absolute = path.join(plan.root, ...parts);
      if (change.before === null) {
        await fs.writeFile(absolute, change.after, { flag: 'wx' });
      } else {
        const { mode } = await fs.stat(absolute);
        const temp = `${absolute}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;
        try {
          await fs.writeFile(temp, change.after, { flag: 'wx', mode: mode & 0o7777 });
          await fs.rename(temp, absolute);
        } catch (error) {
          await fs.rm(temp, { force: true });
          throw error;
        }
      }
      done.push({ change, absolute });
    }
  } catch (error) {
    for (const { change, absolute } of done.reverse()) {
      if (change.before === null) await fs.rm(absolute, { force: true });
      else await fs.writeFile(absolute, change.before);
    }
    for (const dir of createdDirs.reverse()) await fs.rmdir(dir).catch(() => {});
    throw new InitError(`init 적용 중 실패해 바꾼 파일을 되돌렸다 (${systemCode(error) ?? messageOf(error)}).`, [{ path: '', message_ko: messageOf(error) }]);
  }
}

export async function runInit(options?: InitOptions): Promise<InitPlan> {
  const plan = await planInit(options);
  await applyInit(plan);
  return plan;
}
