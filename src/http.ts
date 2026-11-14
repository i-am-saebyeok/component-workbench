// loopback HTTP 서버: 정적 웹 UI, 같은 origin의 JSON API, 서비스 preview 파일, MCP
// Streamable HTTP endpoint. 공개 서비스가 아닌 로컬 개발 도구다. Host는 이 서버를 정확히
// 가리켜야 하고 브라우저 요청은 이 origin에서만 받아 DNS rebinding과 교차 사이트 쓰기를 막는다.
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import type { IncomingMessage, OutgoingHttpHeaders, ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler } from '@modelcontextprotocol/server';
import type { CatalogResponse, SelectionState } from '../web/api.js';
import { inspectServicePath } from './config.js';
import type { LoadedConfig } from './config.js';
import { WorkbenchError, toWorkbenchError } from './errors.js';
import { createMcpServer } from './mcp.js';
import { PACKAGE_ROOT } from './package.js';
import type { WorkbenchService } from './service.js';

export const LOOPBACK_HOST = '127.0.0.1';
const API_BODY_LIMIT = 16 * 1024;
const MCP_BODY_LIMIT = 64 * 1024;

// HTML·CSS는 web/에 그대로 두고, 브라우저 모듈은 web/*.ts의 빌드 결과(dist/web/)를 쓴다.
const WEB_DIR = path.join(PACKAGE_ROOT, 'web');
const WEB_BUILD_DIR = path.join(PACKAGE_ROOT, 'dist', 'web');
// three는 설치 구조(hoisting 포함)와 관계없이 모듈 해석으로 찾는다.
const threeFile = (specifier: string) => fileURLToPath(import.meta.resolve(specifier));
const JS = 'text/javascript; charset=utf-8';

const STATIC_FILES: Record<string, [file: string, type: string]> = {
  '/': [path.join(WEB_DIR, 'index.html'), 'text/html; charset=utf-8'],
  '/app.js': [path.join(WEB_BUILD_DIR, 'app.js'), JS],
  '/styles.css': [path.join(WEB_DIR, 'styles.css'), 'text/css; charset=utf-8'],
  '/adapters/box.js': [path.join(WEB_BUILD_DIR, 'adapters', 'box.js'), JS],
  '/adapters/html.js': [path.join(WEB_BUILD_DIR, 'adapters', 'html.js'), JS],
  '/vendor/three/three.module.js': [threeFile('three'), JS],
  '/vendor/three/three.core.js': [path.join(path.dirname(threeFile('three')), 'three.core.js'), JS],
  '/vendor/three/addons/controls/OrbitControls.js': [threeFile('three/addons/controls/OrbitControls.js'), JS],
  '/vendor/three/addons/renderers/CSS2DRenderer.js': [threeFile('three/addons/renderers/CSS2DRenderer.js'), JS],
  '/vendor/three/addons/environments/RoomEnvironment.js': [threeFile('three/addons/environments/RoomEnvironment.js'), JS],
};

const PREVIEW_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': JS,
  '.mjs': JS,
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.wasm': 'application/wasm',
  '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

// 서비스 preview는 같은 origin 자산만 불러온다(원격 URL 불가). 서비스가 작성한 신뢰된 코드이며 sandbox가 아니다.
const PREVIEW_CSP = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "base-uri 'self'",
  "form-action 'none'",
  "frame-ancestors 'self'",
].join('; ');

const BASE_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function sendJson(res: ServerResponse, status: number, body: unknown, headers: OutgoingHttpHeaders = {}) {
  res.writeHead(status, { ...BASE_HEADERS, 'X-Frame-Options': 'DENY', 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(body));
}

function sendError(res: ServerResponse, error: unknown, headers?: OutgoingHttpHeaders) {
  const failure = toWorkbenchError(error);
  sendJson(res, failure.status, { error: failure.toJSON() }, headers);
}

function notFound(res: ServerResponse) {
  res.writeHead(404, { ...BASE_HEADERS, 'X-Frame-Options': 'DENY', 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not found');
}

function methodNotAllowed(res: ServerResponse, allowed: string[]) {
  sendError(res, new WorkbenchError('method_not_allowed', `이 경로는 ${allowed.join(', ')}만 허용한다.`), { Allow: allowed.join(', ') });
}

/** inline script는 import map 하나뿐이고 CSP는 그 해시만 허용한다. */
function pageSecurityPolicy(html: string): string {
  const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(html)?.[1];
  const scriptHash = importMap === undefined ? '' : ` 'sha256-${createHash('sha256').update(importMap).digest('base64')}'`;
  return [
    "default-src 'self'",
    `script-src 'self'${scriptHash}`,
    "style-src 'self'",
    "img-src 'self' data: blob:",
    "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join('; ');
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  const entry = STATIC_FILES[pathname];
  if (!entry) return notFound(res);
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  const [file, type] = entry;
  const body = await fs.readFile(file);
  const headers: OutgoingHttpHeaders = { ...BASE_HEADERS, 'X-Frame-Options': 'DENY', 'Content-Type': type, 'Cache-Control': 'no-cache' };
  if (pathname === '/') headers['Content-Security-Policy'] = pageSecurityPolicy(body.toString('utf8'));
  res.writeHead(200, headers);
  res.end(body);
}

/** `/preview/<preview_root 기준 경로>`: preview_root 안의 일반 파일만. 숨김 이름·링크·root 밖은 404. */
async function servePreview(req: IncomingMessage, res: ServerResponse, config: LoadedConfig, encodedPath: string) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET']);
  let segments;
  try {
    segments = encodedPath.split('/').map((segment) => decodeURIComponent(segment));
  } catch {
    return notFound(res);
  }
  if (segments.some((segment) => segment === '' || segment.startsWith('.') || /[\\/\0]/.test(segment))) return notFound(res);
  const relative = `${config.preview_root}/${segments.join('/')}`;
  const info = await inspectServicePath(config, relative);
  if (info.state !== 'file') return notFound(res);
  const body = await fs.readFile(info.absolute);
  res.writeHead(200, {
    ...BASE_HEADERS,
    'X-Frame-Options': 'SAMEORIGIN',
    'Content-Security-Policy': PREVIEW_CSP,
    'Content-Type': PREVIEW_TYPES[path.extname(relative).toLowerCase()] ?? 'application/octet-stream',
    'Cache-Control': 'no-cache',
  });
  res.end(body);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const [mediaType = ''] = (req.headers['content-type'] ?? '').split(';');
  if (mediaType.trim().toLowerCase() !== 'application/json') throw new WorkbenchError('unsupported_media_type', 'POST 본문은 Content-Type: application/json이어야 한다.');
  const tooLarge = () => new WorkbenchError('payload_too_large', `요청 본문은 ${API_BODY_LIMIT}바이트 이하여야 한다.`);
  if (Number(req.headers['content-length'] ?? 0) > API_BODY_LIMIT) throw tooLarge();
  const chunks: Buffer[] = [];
  let size = 0;
  // encoding을 지정하지 않은 요청 stream은 Buffer chunk를 낸다.
  for await (const chunk of req as AsyncIterable<Buffer>) {
    size += chunk.length;
    if (size > API_BODY_LIMIT) throw tooLarge();
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new WorkbenchError('invalid_request', '요청 본문이 올바른 JSON이 아니다.');
  }
}

type Route = Record<string, (req: IncomingMessage) => Promise<unknown>>;

function createApi(service: WorkbenchService) {
  // 반환형은 웹 UI가 읽는 계약(web/api.d.ts)이다.
  const routes: Record<string, Route> = {
    '/api/catalog': { GET: (): Promise<CatalogResponse> => service.listComponents({ withText: true }) },
    '/api/selection': {
      GET: (): Promise<SelectionState> => service.getSelection(),
      POST: async (req): Promise<SelectionState> => service.selectComponent(await readJsonBody(req)),
    },
  };

  return async (req: IncomingMessage, res: ServerResponse, pathname: string) => {
    const route = routes[pathname];
    if (!route) return sendError(res, new WorkbenchError('not_found', `API 경로 ${pathname}는 없다.`));
    const run = route[req.method ?? ''];
    if (!run) return methodNotAllowed(res, Object.keys(route));
    try {
      const data = await run(req);
      if (req.method !== 'GET') return sendJson(res, 200, data);
      // 웹 UI polling: 바뀌지 않은 상태는 본문 없는 304로 답한다.
      const etag = `"${createHash('sha256').update(JSON.stringify(data)).digest('base64url').slice(0, 27)}"`;
      if (req.headers['if-none-match'] === etag) {
        res.writeHead(304, { ...BASE_HEADERS, ETag: etag, 'Cache-Control': 'no-cache' });
        return res.end();
      }
      return sendJson(res, 200, data, { ETag: etag, 'Cache-Control': 'no-cache' });
    } catch (error) {
      return sendError(res, error);
    }
  };
}

/** 이 서버 포트에 대한 정확한 Host/Origin 허용 목록. */
function createRequestGuard(getPort: () => number) {
  return (req: IncomingMessage, res: ServerResponse): boolean => {
    const port = getPort();
    const authorities = new Set([`localhost:${port}`, `127.0.0.1:${port}`, `[::1]:${port}`]);
    const host = (req.headers.host ?? '').toLowerCase();
    if (!authorities.has(host)) {
      sendError(res, new WorkbenchError('forbidden', `Host ${JSON.stringify(req.headers.host ?? '')}는 허용되지 않는다. http://127.0.0.1:${port}/ 로 접속한다.`));
      return false;
    }
    const origin = req.headers.origin;
    if (origin !== undefined && !(origin.startsWith('http://') && authorities.has(origin.slice('http://'.length).toLowerCase()))) {
      sendError(res, new WorkbenchError('forbidden', `Origin ${JSON.stringify(origin)}의 요청은 허용되지 않는다. 같은 로컬 origin에서만 호출할 수 있다.`));
      return false;
    }
    return true;
  };
}

export async function startHttpServer({ service, port, onError = (error) => console.error(error) }: { service: WorkbenchService; port: number; onError?: (error: unknown) => void }) {
  const mcpHandler = createMcpHandler(() => createMcpServer(service), { maxRequestBodySize: MCP_BODY_LIMIT, onerror: onError });
  const mcp = toNodeHandler(mcpHandler, { maxRequestBodySize: MCP_BODY_LIMIT, onerror: onError });
  const api = createApi(service);

  const server = http.createServer();
  // TCP 포트로 listen하므로 주소는 AddressInfo다.
  const listeningPort = () => (server.address() as AddressInfo).port;
  const guard = createRequestGuard(listeningPort);
  server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
    try {
      if (!guard(req, res)) return;
      const { pathname } = new URL(req.url ?? '/', 'http://local.invalid');
      if (pathname === '/mcp') return await mcp(req, res);
      if (pathname.startsWith('/api/')) return await api(req, res, pathname);
      if (pathname.startsWith('/preview/')) return await servePreview(req, res, service.config, pathname.slice('/preview/'.length));
      return await serveStatic(req, res, pathname);
    } catch (error) {
      onError(error);
      if (!res.headersSent) sendError(res, error);
      else res.destroy();
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, LOOPBACK_HOST, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const actualPort = listeningPort();
  return {
    port: actualPort,
    url: `http://${LOOPBACK_HOST}:${actualPort}/`,
    mcpUrl: `http://${LOOPBACK_HOST}:${actualPort}/mcp`,
    async close() {
      await mcpHandler.close();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
