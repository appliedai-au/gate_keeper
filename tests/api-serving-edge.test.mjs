import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { productApiHandler } from '../scripts/product/api-server.mjs';
import { createProductService } from '../scripts/product/service.mjs';

const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
const close = server => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); });
async function hashPassword() {
  const child = spawn('caddy', ['hash-password', '--plaintext', 'SYNTHETIC_TEST_PASSWORD'], { stdio: ['ignore', 'pipe', 'pipe'] });
  let result = ''; child.stdout.on('data', bytes => { result += bytes; });
  await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => code === 0 ? resolve() : reject(new Error('caddy hash failed'))); });
  return result.trim();
}

test('actual edge routes product OAuth/session only to product, preserves history and ordinary Basic Auth', { timeout: 30000 }, async t => {
  const config = { apiOrigin: 'https://gate.g8s.test', frontendOrigin: 'https://g8s.test',
    githubClientId: 'SYNTHETIC_CLIENT_ID', githubAppSlug: 'synthetic-g8s', adminGithubIds: new Set() };
  let oauth = 0; const historical = [];
  const service = createProductService({ config, github: {}, store: {
    async getSession() { return null; }, async createOAuth() { oauth++; },
  } });
  t.after(service.stop);
  let handler = productApiHandler({ config, product: service, configured: true });
  const product = createServer((req, res) => handler(req, res)), productPort = await listen(product);
  t.after(() => close(product));
  const original = createServer((req, res) => { historical.push(req.url); req.resume();
    res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ original: true, path: req.url })); });
  const originalPort = await listen(original); t.after(() => close(original));
  const reserve = createServer(), edgePort = await listen(reserve); await close(reserve);
  const directory = await mkdtemp(join(tmpdir(), 'g8s-edge-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn('caddy', ['run', '--config', fileURLToPath(new URL('../config/g8s-product-edge.Caddyfile', import.meta.url)), '--adapter', 'caddyfile'], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH,
      PORT: String(edgePort), G8S_PRODUCT_HOST: '127.0.0.1', G8S_PRODUCT_PORT: String(productPort),
      UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(originalPort), BASIC_AUTH_USERNAME: 'synthetic-owner',
      GK_PROXY_PASSWORD_HASH: await hashPassword(), XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data') },
  });
  let failure, log = ''; child.once('error', error => { failure = error; });
  child.stderr.on('data', bytes => { log = (log + bytes).slice(-4000); });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => { child.kill('SIGTERM'); const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
    await closed; clearTimeout(kill); });
  const base = 'http://127.0.0.1:' + edgePort;
  let ready = false;
  for (let n = 0; n < 100 && !ready; n++) {
    if (failure || child.exitCode !== null) assert.fail('actual Caddy unavailable: ' + (failure?.message || log));
    try { const response = await fetch(base + '/proxy-healthz', { signal: AbortSignal.timeout(200) });
      ready = response.status === 200; await response.text(); } catch { /* Listener starting. */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true);
  async function request(path, options = {}) {
    const response = await fetch(base + path, { redirect: 'manual', signal: AbortSignal.timeout(3000), ...options });
    const text = await response.text(); return { status: response.status, headers: response.headers, text };
  }
  const prefix = '/gatekeeper/product-v1';
  const anon = await request(prefix + '/session', { headers: { Origin: config.frontendOrigin } });
  assert.equal(anon.status, 401); assert.equal(JSON.parse(anon.text).error.code, 'unauthenticated');
  assert.equal(anon.headers.get('www-authenticate'), null);
  assert.equal(anon.headers.get('access-control-allow-origin'), config.frontendOrigin);
  const signin = await request(prefix + '/auth/github/start');
  assert.equal(signin.status, 303); assert.equal(new URL(signin.headers.get('location')).origin, 'https://github.com');
  assert.equal(oauth, 1); assert.deepEqual(historical, []);
  const denied = await request(prefix + '/session', { headers: { Origin: 'https://foreign.test' } });
  assert.equal(denied.status, 403); assert.equal(denied.headers.get('access-control-allow-origin'), null);
  const options = await request(prefix + '/client-v1/orgs/alpha/reviews', { method: 'OPTIONS', headers: {
    Origin: config.frontendOrigin, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type, X-G8S-Request, Idempotency-Key' } });
  assert.equal(options.status, 204);
  for (const path of ['/api/v1/sessions', '/gatekeeper/product-v10/session', '/.env']) {
    const result = await request(path); assert.equal(result.status, 401);
    assert.match(result.headers.get('www-authenticate'), /^Basic /u);
  }
  assert.deepEqual(historical, []);
  const auth = 'Basic ' + Buffer.from('synthetic-owner:SYNTHETIC_TEST_PASSWORD').toString('base64');
  assert.equal((await request('/api/v1/sessions', { headers: { Authorization: auth } })).status, 200);
  const history = await request('/gatekeeper/learning-v3/status');
  assert.equal(history.status, 200); assert.equal(JSON.parse(history.text).path, '/gatekeeper/learning-v2/status');
  assert.equal((await request('/gatekeeper/reviews-v1', { method: 'POST' })).status, 200);
  assert.deepEqual(historical, ['/api/v1/sessions', '/gatekeeper/learning-v2/status', '/gatekeeper/reviews-v1']);
  handler = productApiHandler({ config, product: service, configured: false });
  const setup = await request(prefix + '/session', { headers: { Origin: config.frontendOrigin } });
  assert.equal(setup.status, 503); assert.equal(JSON.parse(setup.text).error.code, 'setup_required');
  assert.equal(setup.headers.get('www-authenticate'), null);
  assert.equal(setup.headers.get('access-control-allow-credentials'), 'true');
});
