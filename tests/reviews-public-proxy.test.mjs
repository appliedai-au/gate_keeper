// Real Caddy transport with synthetic identities; no model or production access.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReviewService } from '../scripts/reviews/service.mjs';
import { REVIEW_APP_ID, REVIEW_PATH } from '../integrations/base44/shared/review-contract.js';

const source = 'a'.repeat(40), owner = 'review-fixture-owner', token = 'review_fixture_' + 'x'.repeat(40);
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject); server.listen(0, '127.0.0.1', () => resolve(server.address().port));
});
test('real Caddy exposes only exact scoped review route and preserves ordinary Basic Auth', { timeout: 30000 }, async t => {
  let reads = 0, ordinary = 0;
  const feature = createReviewService({ ownerId: owner,
    tokenHash: createHash('sha256').update(token).digest('hex'),
    store: { async ready() { reads++; } }, runtime: { sourceCommit: source },
    client: { sessions: new Proxy({}, { get() { assert.fail('transport check must not call model SDK'); } }) } });
  const upstream = createServer((req, res) => {
    if (req.url.split('?')[0] === REVIEW_PATH) return void feature.handler(req, res);
    ordinary++; req.resume(); res.writeHead(200); res.end('ordinary');
  });
  const upstreamPort = await listen(upstream);
  t.after(() => new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); }));
  const reservation = createServer(); const port = await listen(reservation);
  await new Promise(resolve => reservation.close(resolve));
  const directory = await mkdtemp(join(tmpdir(), 'gk-review-proxy-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const child = spawn('/bin/sh', [fileURLToPath(new URL('../scripts/learning-v2/start-status-proxy.sh', import.meta.url))], {
    stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH, PORT: String(port), UPSTREAM_HOST: '127.0.0.1',
      UPSTREAM_PORT: String(upstreamPort), BASIC_AUTH_USERNAME: 'proxy-fixture', BASIC_AUTH_PASSWORD: 'synthetic-password',
      XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data') },
  });
  let log = '', spawnError;
  child.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
  child.once('error', error => { spawnError = error; });
  const closed = new Promise(resolve => child.once('close', resolve));
  t.after(async () => {
    child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
    await closed; clearTimeout(timer); feature.stop();
  });
  const origin = `http://127.0.0.1:${port}`;
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    if (spawnError || child.exitCode !== null) assert.fail('Caddy startup failed: ' + (spawnError?.message || log));
    try { ready = (await fetch(origin + '/proxy-healthz', { signal: AbortSignal.timeout(200) })).status === 200; }
    catch { /* Disposable listener is starting. */ }
    if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
  }
  assert.equal(ready, true);
  const headers = { 'Content-Type': 'application/json', 'X-Gatekeeper-Review-App': REVIEW_APP_ID,
    'X-Gatekeeper-Review-Token': token, 'X-Gatekeeper-Review-Owner': owner, 'X-Gatekeeper-Review-Source': source };
  async function post(path, overrides = {}) {
    const response = await fetch(origin + path, { method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(3000),
      headers: { ...headers, ...overrides }, body: '{"action":"info"}' });
    const body = await response.text();
    assert.equal(body.includes(token), false); assert.equal(body.includes('synthetic-password'), false);
    return { response, body };
  }
  for (const [overrides, status] of [
    [{ 'X-Gatekeeper-Review-Token': '' }, 401],
    [{ 'X-Gatekeeper-Review-Token': 'learning_fixture_' + 'x'.repeat(40) }, 401],
    [{ 'X-Gatekeeper-Review-Owner': 'other-owner' }, 403],
    [{ 'X-Gatekeeper-Review-Source': 'b'.repeat(40) }, 409],
  ]) {
    const result = await post(REVIEW_PATH, overrides);
    assert.equal(result.response.status, status);
    assert.equal(result.response.headers.get('WWW-Authenticate'), null);
    assert.equal(result.response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  }
  assert.equal(reads, 0);
  assert.equal((await post(REVIEW_PATH + '?owner=other')).response.status, 400);
  const accepted = await post(REVIEW_PATH);
  assert.equal(accepted.response.status, 200); assert.equal(JSON.parse(accepted.body).sourceCommit, source);
  assert.equal(reads, 1);
  for (const path of [REVIEW_PATH + '/', REVIEW_PATH + '/extra', '/api/v1/sessions']) {
    const result = await post(path);
    assert.equal(result.response.status, 401); assert.match(result.response.headers.get('WWW-Authenticate'), /^Basic /);
  }
  assert.equal(ordinary, 0);
  const basic = await post('/api/v1/sessions', { Authorization: 'Basic ' + Buffer.from('proxy-fixture:synthetic-password').toString('base64') });
  assert.equal(basic.response.status, 200); assert.equal(ordinary, 1);
});
