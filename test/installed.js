// npm pack 산출물을 checkout 밖의 새 서비스에 설치해 쓰는 공용 도구(package.test.js, browser QA).
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { REPO_ROOT, run } from './helpers.js';

export const PKG = '@i-am-saebyeok/component-workbench';

/** 이 checkout을 npm pack한 tarball 경로와 파일 목록. */
export async function packTarball(destination) {
  const { stdout } = await run('npm', ['pack', '--json', '--pack-destination', destination], { cwd: REPO_ROOT, maxBuffer: 16 * 1024 * 1024 });
  const [info] = JSON.parse(stdout);
  return { tarball: path.join(destination, info.filename), files: info.files.map((file) => file.path).sort(), info };
}

/**
 * 빈 서비스 디렉토리에 package.json을 만들고 패키지 source(tarball 경로, Git URL 등)를 설치한다.
 * 기본은 devDependency다. runtime이면 dependency로 저장하고 서비스의 devDependencies를 설치하지 않는다(--omit=dev).
 */
export async function installService(dir, source, packageJson = {}, { runtime = false, env = process.env } = {}) {
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'package.json'), `${JSON.stringify({ name: path.basename(dir).replace(/\s+/g, '-'), private: true, ...packageJson }, null, 2)}\n`);
  const save = runtime ? ['--save-prod', '--omit=dev'] : ['--save-dev'];
  await run('npm', ['install', '--no-audit', '--no-fund', '--prefer-offline', ...save, source], { cwd: dir, env, maxBuffer: 16 * 1024 * 1024 });
}

/** 서비스 node_modules 전체(중첩 포함)에서 TypeScript 컴파일러 패키지(typescript, @typescript/*)를 찾는다. */
export async function compilerPackages(service) {
  const found = [];
  async function walk(modules) {
    let entries;
    try {
      entries = await fs.readdir(modules, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const names = entry.name.startsWith('@') ? (await fs.readdir(path.join(modules, entry.name))).map((child) => `${entry.name}/${child}`) : [entry.name];
      for (const name of names) {
        if (name === 'typescript' || name.startsWith('@typescript/')) found.push(path.relative(service, path.join(modules, name)));
        await walk(path.join(modules, name, 'node_modules'));
      }
    }
  }
  await walk(path.join(service, 'node_modules'));
  return found.sort();
}

/** 설치된 CLI를 서비스(또는 하위 디렉토리)에서 npx --no-install로 실행한다. 실패해도 결과를 돌려준다. */
export async function npx(cwd, args) {
  try {
    const { stdout, stderr } = await run('npx', ['--no-install', 'component-workbench', ...args], { cwd, maxBuffer: 16 * 1024 * 1024 });
    return { code: 0, stdout, stderr };
  } catch (error) {
    return { code: error.code, stdout: error.stdout, stderr: error.stderr };
  }
}

export function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

/** config의 server.port를 비어 있는 포트로 바꾼다(실제 config 포트를 쓰는지 확인하려고). */
export async function assignPort(dir) {
  const file = path.join(dir, 'component-workbench.config.json');
  const config = JSON.parse(await fs.readFile(file, 'utf8'));
  config.server.port = await freePort();
  await fs.writeFile(file, `${JSON.stringify(config, null, 2)}\n`);
  return config.server.port;
}

/** 생성된 `npm run workbench`를 그대로 실행하고 출력된 주소를 기다린다. */
export function startWorkbench(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('npm', ['run', 'workbench'], { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    const onData = (chunk) => {
      output += chunk;
      const match = / workbench: (http:\/\/127\.0\.0\.1:(\d+)\/)/.exec(output);
      if (match) resolve({ child, url: match[1], port: Number(match[2]), output: () => output });
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.once('exit', (code) => reject(new Error(`npm run workbench exited ${code}: ${output}`)));
  });
}

export async function stopWorkbench(server) {
  if (server.child.exitCode !== null) return;
  const exited = new Promise((resolve) => server.child.once('exit', resolve));
  process.kill(-server.child.pid, 'SIGTERM');
  await exited;
}

export async function tempRoot(label) {
  return fs.mkdtemp(path.join(os.tmpdir(), label));
}

/** 서비스 원본·tarball 내용에 다른 서비스(기존 게임)의 이름·ID·경로가 없는지 찾는 패턴. */
export const FORBIDDEN = /medieval|voyage|half_[xyz]|half_axis|unreal|\/Game\/|Data\/Blocks|block_id|\bstone\b|\bwood\b|\bcube\b|블록|석재|목재/i;
