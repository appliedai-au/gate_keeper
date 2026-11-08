// Mandatory real Caddy transport; all accounts, cookies and signatures are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createProductService } from '../scripts/product/service.mjs';
import { createStatusRoutingHandler } from '../scripts/learning-v2/trueforge-status-gateway.mjs';
import { PRODUCT_PATH } from '../scripts/product/contracts.mjs';
import { sha256 } from '../scripts/product/github.mjs';

const SESSION = 'TEST_ONLY_G8S_PROXY_SESSION'.padEnd(43, '_');
const WEBHOOK = 'TEST_ONLY_G8S_PROXY_WEBHOOK_SECRET';
const listen = server => new Promise((resolve, reject) => {
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(server.address().port); });
});

test('real Caddy preserves G8S session, CORS and raw webhook boundaries without weakening ordinary Basic Auth',
  { timeout: 30000 }, async t => {
    const config = { apiOrigin: 'https://api.g8s.test', frontendOrigin: 'https://g8s.test',
      githubClientId: 'TEST_ONLY_GITHUB_CLIENT_ID', githubAppSlug: 'test-only-app',
      adminGithubIds: new Set(['7101']), webhookSecret: WEBHOOK };
    const user = { id: '00000000-0000-4000-8000-000000007101', githubId: '7101', login: 'test-owner' };
    const deliveries = new Set(); let ordinary = 0, pauses = 0;
    const feature = createProductService({ config,
      github: new Proxy({}, { get() { assert.fail('proxy fixture must not call GitHub'); } }),
      store: {
        async getSession(value) { return value === sha256(SESSION) ? { user, organizations: [] } : null; },
        async setPause(userId, controls) { assert.equal(userId, user.id); pauses++; return controls; },
        async receiveDelivery({ deliveryId, event, payload }) {
          assert.equal(event, 'ping'); assert.deepEqual(payload, { zen: 'synthetic signed bytes' });
          const duplicate = deliveries.has(deliveryId); deliveries.add(deliveryId); return { duplicate };
        },
      } });
    const upstream = createServer(createStatusRoutingHandler({
      statusHandler() { assert.fail('product request cannot become a Learning request'); },
      productHandler: feature.handler,
      proxyHandler(req, res) { ordinary++; req.resume(); res.writeHead(200); res.end('ordinary'); },
    }));
    const upstreamPort = await listen(upstream);
    t.after(() => new Promise(resolve => { feature.stop(); upstream.close(resolve); upstream.closeAllConnections(); }));
    const reservation = createServer(); const port = await listen(reservation);
    await new Promise(resolve => reservation.close(resolve));
    const directory = await mkdtemp(join(tmpdir(), 'g8s-product-proxy-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const child = spawn('/bin/sh', [fileURLToPath(new URL('../scripts/learning-v2/start-status-proxy.sh', import.meta.url))], {
      stdio: ['ignore', 'ignore', 'pipe'], env: { PATH: process.env.PATH, PORT: String(port),
        UPSTREAM_HOST: '127.0.0.1', UPSTREAM_PORT: String(upstreamPort),
        BASIC_AUTH_USERNAME: 'proxy-fixture', BASIC_AUTH_PASSWORD: 'synthetic-password',
        XDG_CONFIG_HOME: join(directory, 'config'), XDG_DATA_HOME: join(directory, 'data') },
    });
    let log = '', spawnError;
    child.stderr.on('data', chunk => { log = (log + chunk).slice(-4000); });
    child.once('error', error => { spawnError = error; });
    const closed = new Promise(resolve => child.once('close', resolve));
    t.after(async () => {
      child.kill('SIGTERM'); const timer = setTimeout(() => child.kill('SIGKILL'), 2000);
      await closed; clearTimeout(timer);
    });
    const origin = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (spawnError || child.exitCode !== null) assert.fail('Caddy startup failed: ' + (spawnError?.message || log));
      try {
        const response = await fetch(origin + '/proxy-healthz', { signal: AbortSignal.timeout(200) });
        ready = response.status === 200; await response.text();
      } catch { /* Disposable loopback listener is starting. */ }
      if (!ready) await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(ready, true, 'Caddy binary and actual checked-in proxy configuration are mandatory');
    async function request(path, options = {}) {
      const response = await fetch(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(3000), ...options });
      const body = await response.text();
      for (const secret of [SESSION, WEBHOOK, 'synthetic-password']) assert.equal(body.includes(secret), false);
      return { response, body };
    }
    const anon = await request(PRODUCT_PATH + '/session');
    assert.equal(anon.response.status, 401); assert.equal(anon.response.headers.get('WWW-Authenticate'), null);
    assert.equal(JSON.parse(anon.body).error.code, 'unauthenticated');
    const cookie = { Cookie: '__Host-g8s_session=' + SESSION, Origin: config.frontendOrigin };
    const session = await request(PRODUCT_PATH + '/session', { headers: cookie });
    assert.equal(session.response.status, 200); assert.equal(JSON.parse(session.body).data.user.githubId, user.githubId);
    assert.equal(session.response.headers.get('Access-Control-Allow-Origin'), config.frontendOrigin);
    assert.equal(session.response.headers.get('Access-Control-Allow-Credentials'), 'true');
    assert.match(session.response.headers.get('Cache-Control'), /no-store/u);
    const preflight = await request(PRODUCT_PATH + '/admin/controls', { method: 'OPTIONS', headers: {
      Origin: config.frontendOrigin, 'Access-Control-Request-Method': 'PUT',
      'Access-Control-Request-Headers': 'Content-Type, X-G8S-Request' } });
    assert.equal(preflight.response.status, 204);
    const rejected = await request(PRODUCT_PATH + '/admin/controls', { method: 'PUT',
      headers: { ...cookie, Origin: 'https://foreign.test', 'Content-Type': 'application/json', 'X-G8S-Request': '1' },
      body: '{"paused":true,"reason":"Synthetic test"}' });
    assert.equal(rejected.response.status, 403); assert.equal(pauses, 0);
    const accepted = await request(PRODUCT_PATH + '/admin/controls', { method: 'PUT',
      headers: { ...cookie, 'Content-Type': 'application/json', 'X-G8S-Request': '1' },
      body: '{"paused":true,"reason":"Synthetic test"}' });
    assert.equal(accepted.response.status, 200); assert.equal(pauses, 1);

    const payload = '{ "zen": "synthetic signed bytes" }';
    const webhookHeaders = { 'Content-Type': 'application/json', 'X-GitHub-Event': 'ping',
      'X-GitHub-Delivery': '00000000-0000-4000-8000-000000007102' };
    const unsigned = await request(PRODUCT_PATH + '/webhooks/github', { method: 'POST', headers: webhookHeaders, body: payload });
    assert.equal(unsigned.response.status, 401); assert.equal(deliveries.size, 0);
    const signature = 'sha256=' + createHmac('sha256', WEBHOOK).update(payload).digest('hex');
    for (const duplicate of [false, true]) {
      const result = await request(PRODUCT_PATH + '/webhooks/github', { method: 'POST',
        headers: { ...webhookHeaders, 'X-Hub-Signature-256': signature }, body: payload });
      assert.equal(result.response.status, 202); assert.deepEqual(JSON.parse(result.body).data, { accepted: true, duplicate });
    }
    assert.equal(deliveries.size, 1);
    const altered = await request(PRODUCT_PATH + '/webhooks/github', { method: 'POST',
      headers: { ...webhookHeaders, 'X-Hub-Signature-256': signature }, body: JSON.stringify(JSON.parse(payload)) });
    assert.equal(altered.response.status, 401); assert.equal(deliveries.size, 1);
    for (const path of ['/gatekeeper/product-v10/session', '/api/v1/sessions']) {
      const result = await request(path, { headers: cookie });
      assert.equal(result.response.status, 401); assert.match(result.response.headers.get('WWW-Authenticate'), /^Basic /u);
    }
    assert.equal(ordinary, 0);
    const authenticated = await request('/api/v1/sessions', { headers: {
      Authorization: 'Basic ' + Buffer.from('proxy-fixture:synthetic-password').toString('base64') } });
    assert.equal(authenticated.response.status, 200); assert.equal(ordinary, 1);
  });
