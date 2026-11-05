import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Readable, PassThrough } from 'node:stream';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest } from 'node:http';
import {
  configuredShutdownGraceMs, configuredStatusHandler, createStatusRoutingHandler,
  forwardTrueForge, startTrueForgeStatusGateway,
} from '../scripts/learning-v2/trueforge-status-gateway.mjs';
import { LEARNING_STATUS_PATH } from '../integrations/base44/shared/learning-status-contract.js';

function output() {
  return {
    status: null, headers: {}, body: '',
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(body = '') { this.body = body; },
  };
}
function incoming(url, method = 'GET') { return { url, method, headers: {}, rawHeaders: [] }; }

test('exact status route never falls through to the ordinary TrueForge handler', async () => {
  let statusCount = 0, proxyCount = 0;
  const route = createStatusRoutingHandler({
    statusHandler: (_req, res) => { statusCount++; res.writeHead(401, {}); res.end(); },
    proxyHandler: (_req, res) => { proxyCount++; res.writeHead(200, {}); res.end(); },
  });
  let r = output(); route(incoming(LEARNING_STATUS_PATH), r);
  assert.equal(r.status, 401); assert.equal(statusCount, 1); assert.equal(proxyCount, 0);
  r = output(); route(incoming(LEARNING_STATUS_PATH + '?unexpected=1'), r);
  assert.equal(r.status, 401); assert.equal(proxyCount, 0);
  r = output(); route(incoming('/healthz'), r);
  assert.equal(r.status, 200); assert.equal(proxyCount, 1);
  r = output(); route(incoming('/api/v1/docs'), r);
  assert.equal(r.status, 200); assert.equal(proxyCount, 2);
});

test('missing status startup flag and private configuration deny without reads', () => {
  let calls = 0;
  const absent = configuredStatusHandler({
    env: {}, readConfig: () => { calls++; throw new Error('never'); },
  });
  const result = output();
  absent(incoming(LEARNING_STATUS_PATH), result);
  assert.equal(calls, 0);
  assert.equal(result.status, 503);
  assert.match(result.body, /learning_status_unavailable/);
});

test('wrong configured paths refuse even when a private file was read', () => {
  const wrong = configuredStatusHandler({
    env: { GK_V3_READONLY_STATUS: 'enabled' },
    readConfig: () => ({
      directory: '/tmp/another-tenant', repositoryRoot: '/app',
      binding: {}, trust: {}, configDigest: 'a'.repeat(64), readToken: 'x'.repeat(48),
    }),
    readStatusFactory: () => { throw new Error('must not be reached'); },
  });
  const result = output();
  wrong(incoming(LEARNING_STATUS_PATH), result);
  assert.equal(result.status, 503);
  assert.equal(result.body.includes('/tmp'), false);
});

test('absolute-form requests, control bytes and oversized targets refuse before proxying', () => {
  let proxies = 0, status = 0;
  const route = createStatusRoutingHandler({
    statusHandler: () => { status++; },
    proxyHandler: () => { proxies++; },
  });
  for (const path of [
    'https://malicious.test/', '//other-host/path', '/api\r/healthz', '/x'.repeat(5000),
  ]) {
    const result = output();
    route(incoming(path), result);
    assert.equal(result.status, 400);
  }
  assert.equal(proxies, 0);
  assert.equal(status, 0);
});

test('cannot start a new public gateway without non-root verified startup', async () => {
  await assert.rejects(() => startTrueForgeStatusGateway({ env: {
    GK_V2_HOST_BOOTSTRAP: 'enabled', GK_V3_HTTP_ROUTER: 'enabled', PORT: '8080',
  } }), /explicit non-root opt-in/);
});

test('default service image preserves existing production startup, and new path is opt in', () => {
  const existing = readFileSync(new URL('../Dockerfile.v2-host', import.meta.url), 'utf8');
  const integrated = readFileSync(new URL('../Dockerfile.v3-integrated', import.meta.url), 'utf8');
  assert.match(existing, /start-v2-host\.sh/);
  assert.doesNotMatch(existing, /launch-status-gateway/);
  assert.match(integrated, /start-v3-router\.sh/);
});

test('dropped long-lived SSE response destroys the upstream subscription', () => {
  const req = Readable.from([]);
  req.url = '/api/v1/events'; req.method = 'GET'; req.headers = {};
  const res = new EventEmitter();
  res.writableFinished = false;
  res.writeHead = () => res;
  res.end = () => res;
  res.destroy = () => res;
  const upstream = new PassThrough();
  forwardTrueForge(req, res, () => upstream);
  assert.equal(upstream.destroyed, false);
  res.emit('close');
  assert.equal(upstream.destroyed, true);
});

test('ordinary completed response does not cancel an already finished upstream', () => {
  const req = Readable.from([]);
  req.url = '/healthz'; req.method = 'GET'; req.headers = {};
  const res = new EventEmitter();
  res.writableFinished = true;
  res.writeHead = () => res;
  res.end = () => res;
  res.destroy = () => res;
  const upstream = new PassThrough();
  forwardTrueForge(req, res, () => upstream);
  res.emit('close');
  assert.equal(upstream.destroyed, false);
  upstream.destroy();
});

test('shutdown preserves TrueForge configured drain and refuses overflowing Node deadlines', () => {
  for (const raw of [undefined, '', '   ']) {
    assert.equal(configuredShutdownGraceMs({ GRACEFUL_TIMEOUT_SECONDS: raw }), 35000);
  }
  assert.equal(configuredShutdownGraceMs({ GRACEFUL_TIMEOUT_SECONDS: ' 60 ' }), 65000);
  assert.equal(configuredShutdownGraceMs({ GRACEFUL_TIMEOUT_SECONDS: '2147478' }), 2147483000);
  for (const raw of ['0', '-1', '1.5', 'invalid', 'Infinity', '2147479']) {
    assert.throws(() => configuredShutdownGraceMs({ GRACEFUL_TIMEOUT_SECONDS: raw }),
      /GK_STATUS_ROUTER_REFUSED:/);
  }
});

// These regressions run only in the isolated remote qualification. They use
// disposable loopback HTTP servers and Node children, never TrueForge/model
// credentials, production ports, private journal state or external services.
function within(promise, label, milliseconds = 5000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' timed out')), milliseconds);
    }),
  ]).finally(() => clearTimeout(timer));
}

async function loopbackServer(t, handler) {
  const server = createServer(handler);
  t.after(() => new Promise(resolve => {
    server.close(resolve);
    server.closeAllConnections();
  }));
  await within(new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve();
    });
  }), 'loopback listener');
  return server;
}

function loopbackResponse(t, port, path = '/api/v1/events') {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port, path, agent: false }, res => {
      let body = '', ended = false, firstData;
      const first = new Promise(done => { firstData = done; });
      const closed = new Promise(done => {
        res.on('data', chunk => {
          body += chunk.toString();
          firstData();
        });
        res.on('error', () => { /* a truncated response must remain observable */ });
        res.once('end', () => { ended = true; });
        res.once('close', () => done({
          status: res.statusCode, headers: res.headers, body,
          ended, complete: res.complete,
        }));
      });
      t.after(() => res.destroy());
      resolve({ first, closed });
    });
    req.once('error', reject);
    t.after(() => req.destroy());
    req.end();
  });
}

function forwardTo(server) {
  return (req, res) => forwardTrueForge(req, res, (options, callback) =>
    httpRequest({ ...options, port: server.address().port }, callback));
}

test('real upstream SSE truncation closes the downstream without completing or retrying it',
  { timeout: 10000 }, async t => {
    let upstreamResponse, calls = 0;
    const upstream = await loopbackServer(t, (_req, res) => {
      calls++;
      upstreamResponse = res;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: first\n\n');
    });
    const gateway = await loopbackServer(t, forwardTo(upstream));
    const response = await within(loopbackResponse(t, gateway.address().port), 'SSE headers');
    await within(response.first, 'first SSE event');
    upstreamResponse.destroy();
    const result = await within(response.closed, 'truncated SSE close');
    assert.equal(result.status, 200);
    assert.equal(result.headers['content-type'], 'text/event-stream');
    assert.equal(result.body, 'data: first\n\n');
    assert.equal(result.ended, false);
    assert.equal(result.complete, false);
    assert.equal(calls, 1);
  });

test('real upstream failure before headers returns one bounded 502 without a retry',
  { timeout: 10000 }, async t => {
    let calls = 0;
    const upstream = await loopbackServer(t, req => { calls++; req.socket.destroy(); });
    const gateway = await loopbackServer(t, forwardTo(upstream));
    const response = await within(loopbackResponse(t, gateway.address().port), 'failure response');
    const result = await within(response.closed, '502 completion');
    assert.equal(result.status, 502);
    assert.deepEqual(JSON.parse(result.body), { error: 'trueforge_unavailable' });
    assert.equal(result.complete, true);
    assert.equal(calls, 1);
  });

test('real ordinary HTTP and normally ended SSE preserve status headers and complete bodies',
  { timeout: 10000 }, async t => {
    let calls = 0;
    const upstream = await loopbackServer(t, (req, res) => {
      calls++;
      const sse = req.url === '/api/v1/events';
      res.writeHead(sse ? 200 : 201, {
        'Content-Type': sse ? 'text/event-stream' : 'application/json',
        'X-Upstream': 'preserved',
      });
      res.end(sse ? 'data: complete\n\n' : '{"healthy":true}');
    });
    const gateway = await loopbackServer(t, forwardTo(upstream));
    for (const path of ['/healthz', '/api/v1/events']) {
      const response = await within(loopbackResponse(t, gateway.address().port, path), 'HTTP headers');
      const result = await within(response.closed, 'HTTP completion');
      assert.equal(result.status, path === '/healthz' ? 201 : 200);
      assert.equal(result.headers['x-upstream'], 'preserved');
      assert.equal(result.body, path === '/healthz' ? '{"healthy":true}' : 'data: complete\n\n');
      assert.equal(result.ended, true);
      assert.equal(result.complete, true);
    }
    assert.equal(calls, 2);
  });

async function lifecycleFixture(t, ignoreTerm = false) {
  const gatewayModule = new URL('../scripts/learning-v2/trueforge-status-gateway.mjs', import.meta.url).href;
  const upstreamSource = [
    "import { createServer } from 'node:http';",
    "if (" + JSON.stringify(ignoreTerm) + ") {",
    "  process.on('SIGTERM', () => process.send({ type: 'ignored-term' }));",
    "}",
    "process.on('message', message => {",
    "  if (message.type === 'exit-child') process.exit(7);",
    "});",
    "const server = createServer((_req, res) => {",
    "  process.send({ type: 'upstream-request' });",
    "  res.writeHead(200, { 'Content-Type': 'text/event-stream' });",
    "  res.write('data: child-ready\\n\\n');",
    "});",
    "server.listen(0, '127.0.0.1', () => {",
    "  process.send({ type: 'ready', port: server.address().port });",
    "});",
  ].join('\n');
  const ownerSource = [
    "import { spawn } from 'node:child_process';",
    "import { createServer, request } from 'node:http';",
    "import { forwardTrueForge, superviseTrueForgeGateway } from " + JSON.stringify(gatewayModule) + ";",
    "const child = spawn(process.execPath, ['--input-type=module', '--eval', " + JSON.stringify(upstreamSource) + "], {",
    "  stdio: ['ignore', 'ignore', 'inherit', 'ipc'],",
    "});",
    "child.once('error', () => process.exit(2));",
    "child.once('exit', (code, signal) => {",
    "  process.send({ type: 'child-exit', code, signal });",
    "});",
    "process.once('exit', () => { try { child.kill('SIGKILL'); } catch {} });",
    "process.on('message', message => {",
    "  if (message.type === 'exit-child') child.send(message);",
    "});",
    "child.on('message', message => {",
    "  if (message.type !== 'ready') process.send(message);",
    "});",
    "child.once('message', ({ port }) => {",
    "  const server = createServer((req, res) => forwardTrueForge(req, res, (options, callback) =>",
    "    request({ ...options, port }, callback)));",
    "  const lifecycle = superviseTrueForgeGateway({ server, child, shutdownGraceMs: 150 });",
    "  lifecycle.stopped.then(() => {",
    "    process.send({ type: 'stopped' }, () => process.disconnect());",
    "  });",
    "  server.listen(0, '127.0.0.1', () => {",
    "    process.send({ type: 'ready', port: server.address().port });",
    "  });",
    "});",
  ].join('\n');
  const owner = spawn(process.execPath, ['--input-type=module', '--eval', ownerSource], {
    detached: process.platform !== 'win32', stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
  });
  const messages = [];
  let stderr = '', readyResolve, readyReject, exitResolve;
  const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  const exited = new Promise(resolve => { exitResolve = resolve; });
  owner.stderr.setEncoding('utf8');
  owner.stderr.on('data', data => { stderr = (stderr + data).slice(-8192); });
  owner.on('message', message => {
    messages.push(message);
    if (message.type === 'ready') readyResolve(message);
  });
  owner.once('error', readyReject);
  // close follows exit and drains IPC/stdio before receipt assertions.
  owner.once('close', (code, signal) => {
    exitResolve({ code, signal });
    readyReject(new Error('fixture exited before ready: ' + stderr));
  });
  t.after(async () => {
    // The process group contains only these two disposable fixture children.
    // Tear it down even if a regression hangs the gateway or its upstream.
    if (!owner.pid) return;
    try {
      if (process.platform === 'win32') owner.kill('SIGKILL');
      else process.kill(-owner.pid, 'SIGKILL');
    } catch (error) { if (error.code !== 'ESRCH') throw error; }
    await within(exited, 'fixture cleanup');
  });
  const { port } = await within(ready, 'child gateway startup');
  return { owner, port, messages, exited };
}

test('unexpected child exit with active real SSE closes the stream and exits the gateway',
  { timeout: 10000 }, async t => {
    const fixture = await lifecycleFixture(t);
    const response = await within(loopbackResponse(t, fixture.port), 'child SSE headers');
    await within(response.first, 'child SSE event');
    fixture.owner.send({ type: 'exit-child' });
    const [result, exited] = await Promise.all([
      within(response.closed, 'SSE close after child exit'),
      within(fixture.exited, 'gateway exit after child exit'),
    ]);
    assert.equal(result.body, 'data: child-ready\n\n');
    assert.equal(result.complete, false);
    assert.equal(result.ended, false);
    assert.deepEqual(exited, { code: 7, signal: null });
    assert.equal(fixture.messages.filter(message => message.type === 'upstream-request').length, 1);
    assert.equal(fixture.messages.some(message => message.type === 'stopped'), true);
  });

test('gateway shutdown bounds an active SSE and escalates an uncooperative child to SIGKILL',
  { timeout: 10000 }, async t => {
    const fixture = await lifecycleFixture(t, true);
    const response = await within(loopbackResponse(t, fixture.port), 'resistant child SSE headers');
    await within(response.first, 'resistant child SSE event');
    fixture.owner.kill('SIGTERM');
    const [result, exited] = await Promise.all([
      within(response.closed, 'SSE close at shutdown deadline'),
      within(fixture.exited, 'gateway shutdown deadline'),
    ]);
    assert.equal(result.complete, false);
    assert.equal(result.ended, false);
    assert.deepEqual(exited, { code: 1, signal: null });
    assert.equal(fixture.messages.some(message => message.type === 'ignored-term'), true);
    assert.deepEqual(fixture.messages.find(message => message.type === 'child-exit'),
      { type: 'child-exit', code: null, signal: 'SIGKILL' });
    assert.equal(fixture.messages.filter(message => message.type === 'upstream-request').length, 1);
    assert.equal(fixture.messages.some(message => message.type === 'stopped'), true);
  });
