// loopback HTTP 서버: CSP, Host/Origin 검사, 정적 허용 목록, 서비스 preview 제공 범위, web API.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { test } from 'node:test';
import { startHttpServer } from '../src/http.js';
import { makeService, readJson, serviceAt } from './helpers.js';

async function serve(t, fixture = 'service-b') {
  const root = await makeService(t, { fixture });
  const running = await startHttpServer({ service: await serviceAt(root), port: 0, onError: () => {} });
  t.after(() => running.close());
  return { root, ...running };
}

/** Host/Origin을 정확히 지정하는 raw 요청(fetch는 Host를 바꿀 수 없다). Host: null이면 생략한다. */
function request(port, { method = 'GET', path: target = '/', headers = {}, body } = {}) {
  const allHeaders = { Host: `127.0.0.1:${port}`, ...headers };
  const setHost = allHeaders.Host !== null;
  if (!setHost) delete allHeaders.Host;
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, method, path: target, setHost, headers: allHeaders }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let json = null;
        try {
          json = JSON.parse(text);
        } catch {
          json = null;
        }
        resolve({ status: res.statusCode, headers: res.headers, text, json });
      });
    });
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

const jsonPost = (port, target, value, headers = {}) => request(port, { method: 'POST', path: target, body: JSON.stringify(value), headers: { 'Content-Type': 'application/json', ...headers } });

test('page CSP allows only its own scripts, the import-map hash and same-origin frames; tool assets and three are served', async (t) => {
  const { port } = await serve(t);
  const page = await request(port);
  assert.equal(page.status, 200);
  const importMap = /<script type="importmap">([\s\S]*?)<\/script>/.exec(page.text)[1];
  const hash = createHash('sha256').update(importMap).digest('base64');
  const csp = page.headers['content-security-policy'];
  assert.ok(csp.includes(`script-src 'self' 'sha256-${hash}'`), csp);
  assert.match(csp, /frame-src 'self'/);
  assert.match(csp, /frame-ancestors 'none'/);
  for (const asset of ['/app.js', '/styles.css', '/adapters/box.js', '/adapters/html.js', '/vendor/three/three.module.js', '/vendor/three/three.core.js', '/vendor/three/addons/controls/OrbitControls.js', '/vendor/three/addons/renderers/CSS2DRenderer.js', '/vendor/three/addons/environments/RoomEnvironment.js']) {
    assert.equal((await request(port, { path: asset })).status, 200, asset);
  }
});

test('only whitelisted tool files are served; source, package and service data paths are 404', async (t) => {
  const { port } = await serve(t);
  for (const target of ['/../package.json', '/src/service.js', '/package.json', '/web/app.js', '/node_modules/three/package.json', '/workbench/catalog.json', '/component-workbench.config.json', '/vendor/three/../../package.json']) {
    assert.equal((await request(port, { path: target })).status, 404, target);
  }
});

test('/preview serves only regular files under preview_root with a same-origin CSP; traversal, hidden, symlinked and outside files are 404', async (t) => {
  const { root, port } = await serve(t);
  const page = await request(port, { path: '/preview/button/primary.html' });
  assert.equal(page.status, 200);
  assert.equal(page.headers['content-type'], 'text/html; charset=utf-8');
  assert.equal(page.text, await fs.readFile(path.join(root, 'workbench', 'previews', 'button', 'primary.html'), 'utf8'));
  assert.match(page.headers['content-security-policy'], /default-src 'self' data: blob:/);
  assert.match(page.headers['content-security-policy'], /frame-ancestors 'self'/);
  assert.equal(page.headers['x-frame-options'], 'SAMEORIGIN');
  assert.equal((await request(port, { path: '/preview/button/button.js' })).headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal((await request(port, { path: '/preview/button/button.css' })).headers['content-type'], 'text/css; charset=utf-8');

  const outside = path.join(path.dirname(root), 'secret.txt');
  await fs.writeFile(outside, 'secret');
  await fs.symlink(outside, path.join(root, 'workbench', 'previews', 'button', 'linked.txt'));
  await fs.writeFile(path.join(root, 'workbench', 'previews', '.env'), 'hidden');
  for (const target of [
    '/preview/../catalog.json',
    '/preview/%2e%2e/catalog.json',
    '/preview/button/%2e%2e/%2e%2e/catalog.json',
    '/preview/..%2fcatalog.json',
    '/preview/.env',
    '/preview/button/linked.txt',
    '/preview/button',
    '/preview/missing.html',
    `/preview/${encodeURIComponent(outside)}`,
  ]) {
    const response = await request(port, { path: target });
    assert.equal(response.status, 404, target);
    assert.ok(!response.text.includes('secret') && !response.text.includes('"components"'), target);
  }
  assert.equal((await request(port, { method: 'POST', path: '/preview/button/primary.html' })).status, 405);
});

test('Host must name this loopback server exactly on every route (DNS-rebinding guard)', async (t) => {
  const { port } = await serve(t);
  for (const host of ['evil.example', `evil.example:${port}`, `127.0.0.1:${port + 1}`, null]) {
    for (const target of ['/', '/api/selection', '/mcp', '/preview/button/primary.html']) {
      const response = await request(port, { path: target, headers: { Host: host } });
      assert.equal(response.status, host === null ? 400 : 403, `${host} ${target}`);
    }
  }
  for (const host of [`localhost:${port}`, `127.0.0.1:${port}`]) assert.equal((await request(port, { path: '/api/selection', headers: { Host: host } })).status, 200);
});

test('browser requests from other origins are refused, including the selection write and MCP', async (t) => {
  const { root, port } = await serve(t);
  const state = (await request(port, { path: '/api/selection' })).json;
  const body = { component_id: 'button', variant_id: 'primary', expected_selection_revision: state.revision, expected_source_sha256: state.source.source_sha256 };
  for (const origin of ['http://evil.example', `http://localhost:${port + 1}`, 'null']) {
    assert.equal((await jsonPost(port, '/api/selection', body, { Origin: origin })).status, 403, origin);
    assert.equal((await request(port, { method: 'POST', path: '/mcp', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: '{}' })).status, 403, origin);
  }
  await assert.rejects(fs.stat(path.join(root, 'workbench', 'selection.json')), { code: 'ENOENT' });
  const same = await jsonPost(port, '/api/selection', body, { Origin: `http://127.0.0.1:${port}` });
  assert.equal(same.status, 200);
  assert.equal((await readJson(path.join(root, 'workbench', 'selection.json'))).variant_id, 'primary');
});

test('web API: one-snapshot catalog with document texts, ETag polling, request validation and error statuses', async (t) => {
  const { root, port } = await serve(t);
  const catalog = (await request(port, { path: '/api/catalog' })).json;
  assert.deepEqual(catalog.workbench, { name: 'svc', title: 'Service', catalog: 'workbench/catalog.json' });
  const feature = catalog.documents.find((doc) => doc.path === 'behaviors/button.feature');
  assert.equal(feature.text, await fs.readFile(path.join(root, 'workbench', 'behaviors', 'button.feature'), 'utf8'));
  assert.equal(catalog.selection.source.source_sha256, catalog.source.source_sha256);

  const first = await request(port, { path: '/api/selection' });
  assert.equal((await request(port, { path: '/api/selection', headers: { 'If-None-Match': first.headers.etag } })).status, 304);
  assert.equal((await request(port, { method: 'POST', path: '/api/selection', body: '{}', headers: { 'Content-Type': 'text/plain' } })).status, 415);
  assert.equal((await request(port, { method: 'POST', path: '/api/selection', body: '{', headers: { 'Content-Type': 'application/json' } })).status, 400);
  assert.equal((await jsonPost(port, '/api/selection', { component_id: 'button' })).status, 400);
  assert.equal((await jsonPost(port, '/api/selection', { component_id: 'nope', expected_selection_revision: 0, expected_source_sha256: catalog.source.source_sha256 })).status, 422);
  assert.equal((await jsonPost(port, '/api/selection', { component_id: 'button', variant_id: 'primary', expected_selection_revision: 0, expected_source_sha256: '0'.repeat(64) })).json.error.code, 'source_conflict');
  assert.equal((await jsonPost(port, '/api/selection', { padding: 'x'.repeat(20_000) })).status, 413);
  assert.equal((await request(port, { method: 'DELETE', path: '/api/selection' })).status, 405);
  assert.equal((await request(port, { path: '/api/recipe' })).status, 404);

  await fs.writeFile(path.join(root, 'workbench', 'catalog.json'), '{"schema_version": 1');
  const broken = await request(port, { path: '/api/catalog' });
  assert.deepEqual([broken.status, broken.json.error.code], [503, 'catalog_invalid']);
});
