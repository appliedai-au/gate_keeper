// Run only in the isolated Railway qualification image, which includes Caddy.
// These real HTTP checks use disposable loopback peers and synthetic credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { POLICY, version } from '../scripts/learning-v2/contracts.mjs';
import { statusView } from '../scripts/learning-v2/prompts.mjs';
import { createLearningStatusEndpoint, createLearningStatusTokenAuthenticator }
  from '../scripts/learning-v2/status-endpoint.mjs';
import { LEARNING_STATUS_PATH, PUBLIC_LEARNING_STATUS_PATH }
  from '../integrations/base44/shared/learning-status-contract.js';

const TOKEN = 'proxy_status_fixture_' + 'x'.repeat(32);
const BINDING = { ownerId: 'proxy-owner', experimentId: 'proxy-fixture', sourceCommit: 'b'.repeat(40) };
const AUTH = 'Basic ' + Buffer.from('proxy-fixture:synthetic-proxy-password').toString('base64');
const OWNER_HEADERS = { 'X-Gatekeeper-Learning-Token': TOKEN,
  'X-Gatekeeper-Learning-Owner': BINDING.ownerId };
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.off('error', reject); resolve(); });
  });
  return server.address().port;
}

function status() {
  const base = { ...version('Public proxy fixture.', []), confirmed: true, origin: 'frozen-base' };
  return { ...statusView({ config: { ...BINDING, scope: 'concurrency' }, policy: POLICY,
    baseVersion: base, activeVersionId: base.id, versions: [base], attempts: [],
    activationHistory: [], operations: [], baseline: null,
    budget: { spentMicros: 0, reservedMicros: 0 }, history: [], gate: null }),
  dispatch: { pending: null, completed: 0 } };
}

test('real Caddy preserves owner token checks, exact routing and existing Basic Auth',
  { timeout: 30_000 }, async t => {
    let statusReads = 0, ordinaryReads = 0, failStatus = false;
    const observations = [];
    const endpoint = createLearningStatusEndpoint({ binding: BINDING,
      authenticate: createLearningStatusTokenAuthenticator({ binding: BINDING, readToken: TOKEN }),
      readStatus: () => { statusReads++; if (failStatus) throw new Error('private journal error'); return status(); } });
    const upstream = createServer(async (req, res) => {
      req.resume();
      observations.push({ url: req.url, method: req.method, headers: req.headers });
      if (req.url.split('?')[0] === LEARNING_STATUS_PATH) {
        try {
          const response = await endpoint(new Request('http://upstream.example' + req.url,
            { method: req.method, headers: req.headers }));
          res.writeHead(response.status, Object.fromEntries(response.headers));
          res.end(await response.text());
        } catch { res.writeHead(500); res.end('fixture adapter failure'); }
      } else {
        ordinaryReads++;
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end('{"ordinary":true}');
      }
    });
    const upstreamPort = await listen(upstream);
    t.after(() => new Promise(resolve => { upstream.close(resolve); upstream.closeAllConnections(); }));
    const portReservation = createServer();
    const proxyPort = await listen(portReservation);
    await new Promise(resolve => portReservation.close(resolve));
    const temporary = await mkdtemp(join(tmpdir(), 'gk-status-proxy-'));
    t.after(() => rm(temporary, { recursive: true, force: true }));
    const entry = fileURLToPath(new URL('../scripts/learning-v2/start-status-proxy.sh', import.meta.url));
    const child = spawn('/bin/sh', [entry], { stdio: ['ignore', 'ignore', 'pipe'],
      env: { PATH: process.env.PATH, PORT: String(proxyPort), UPSTREAM_HOST: '127.0.0.1',
        UPSTREAM_PORT: String(upstreamPort), BASIC_AUTH_USERNAME: 'proxy-fixture',
        BASIC_AUTH_PASSWORD: 'synthetic-proxy-password', XDG_CONFIG_HOME: join(temporary, 'config'),
        XDG_DATA_HOME: join(temporary, 'data') } });
    let stderr = '', spawnError = null;
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8192); });
    child.once('error', error => { spawnError = error; });
    const closed = new Promise(resolve => child.once('close', resolve));
    t.after(async () => {
      child.kill('SIGTERM');
      const deadline = setTimeout(() => child.kill('SIGKILL'), 2000);
      await closed;
      clearTimeout(deadline);
    });
    const origin = `http://127.0.0.1:${proxyPort}`;
    let ready = false;
    for (let i = 0; i < 100 && !ready; i++) {
      if (spawnError || child.exitCode !== null) assert.fail('Caddy failed to start: ' + (spawnError?.message || stderr));
      try {
        const response = await fetch(origin + '/proxy-healthz', { signal: AbortSignal.timeout(200) });
        ready = response.status === 200 && await response.text() === 'OK';
      } catch { /* the process has not bound its disposable socket yet */ }
      if (!ready) await delay(50);
    }
    assert.equal(ready, true, 'Caddy must become ready');
    assert.equal(observations.length, 0, 'health check does not reach the upstream');

    async function request(path, options = {}) {
      const response = await fetch(origin + path,
        { redirect: 'manual', signal: AbortSignal.timeout(3000), ...options });
      const body = await response.text();
      assert.equal(body.includes(TOKEN), false);
      assert.equal(body.includes('synthetic-proxy-password'), false);
      return { response, body };
    }

    for (const [options, expected] of [
      [{}, 401],
      [{ headers: { ...OWNER_HEADERS, 'X-Gatekeeper-Learning-Token': 'z'.repeat(48) } }, 401],
      [{ headers: { ...OWNER_HEADERS, 'X-Gatekeeper-Learning-Owner': 'other-owner' } }, 403],
      [{ headers: OWNER_HEADERS, method: 'POST', body: '{}' }, 405],
    ]) {
      const result = await request(PUBLIC_LEARNING_STATUS_PATH, options);
      assert.equal(result.response.status, expected);
      assert.equal(result.response.headers.get('WWW-Authenticate'), null, 'the scoped status route uses its own authenticator');
      assert.equal(result.response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
    }
    const queried = await request(PUBLIC_LEARNING_STATUS_PATH + '?ownerId=other', { headers: OWNER_HEADERS });
    assert.equal(queried.response.status, 400, 'the rewrite must preserve query rejection');
    assert.equal(observations.at(-1).url, LEARNING_STATUS_PATH + '?ownerId=other');
    assert.equal(observations.find(item => item.method === 'POST').url, LEARNING_STATUS_PATH);
    assert.equal(statusReads, 0);
    assert.equal(ordinaryReads, 0);

    const owner = await request(PUBLIC_LEARNING_STATUS_PATH, { headers: OWNER_HEADERS });
    assert.equal(owner.response.status, 200);
    assert.deepEqual(JSON.parse(owner.body).status, status());
    assert.equal(statusReads, 1);
    assert.equal(observations.at(-1).headers.authorization, undefined, 'the owner read needs no general proxy credential');
    failStatus = true;
    const unavailable = await request(PUBLIC_LEARNING_STATUS_PATH, { headers: OWNER_HEADERS });
    assert.equal(unavailable.response.status, 503);
    assert.deepEqual(JSON.parse(unavailable.body), { error: 'learning_status_unavailable' });
    assert.equal(ordinaryReads, 0, 'failed status reads never fall through to TrueForge');

    const before = observations.length;
    for (const path of ['/', '/healthz', '/api/v1/sessions', LEARNING_STATUS_PATH,
      PUBLIC_LEARNING_STATUS_PATH + '/', PUBLIC_LEARNING_STATUS_PATH + '/extra',
      '/gatekeeper/learning-v3/status-other']) {
      const denied = await request(path, { headers: OWNER_HEADERS });
      assert.equal(denied.response.status, 401, path);
      assert.match(denied.response.headers.get('WWW-Authenticate'), /^Basic /);
    }
    assert.equal(observations.length, before, 'a learning read token cannot authorize ordinary routes');
    const wrongBasic = await request('/api/v1/sessions', { headers: { Authorization: 'Basic ' + btoa('wrong:wrong') } });
    assert.equal(wrongBasic.response.status, 401);
    assert.equal(observations.length, before);
    const ordinary = await request('/api/v1/sessions', { headers: { Authorization: AUTH } });
    assert.equal(ordinary.response.status, 200);
    assert.deepEqual(JSON.parse(ordinary.body), { ordinary: true });
    assert.equal(ordinaryReads, 1);
  });
