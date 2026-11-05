import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { Readable, PassThrough } from 'node:stream';
import {
  configuredStatusHandler, createStatusRoutingHandler, forwardTrueForge, startTrueForgeStatusGateway,
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
