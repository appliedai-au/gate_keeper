import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { LEARNING_STATUS_PATH } from '../integrations/base44/shared/learning-status-contract.js';
import { createReadOnlyStatusHandler, listenReadOnlyStatus } from '../scripts/learning-v2/status-listener.mjs';
import { readStatusConfig } from '../scripts/learning-v2/status-config.mjs';

const binding = { ownerId: 'owner-1', experimentId: 'experiment-1', sourceCommit: 'a'.repeat(40) };
const readToken = 'K'.repeat(48);
function fakeRequest(headers = {}, { method = 'GET', url = LEARNING_STATUS_PATH } = {}) {
  return { method, url, headers, rawHeaders: Object.entries(headers).flat() };
}
function response() {
  return {
    status: null, headers: null, chunks: [],
    writeHead(status, headers) { this.status = status; this.headers = headers; },
    end(content = '') { this.chunks.push(content); },
  };
}

test('unauthorized reads never reach the journal', async () => {
  let reads = 0;
  const handler = createReadOnlyStatusHandler({
    binding, readToken, readStatus: async () => { reads++; throw new Error('missing journal'); },
  });
  for (const headers of [{}, { 'x-gatekeeper-learning-token': 'wrong' },
    { 'x-gatekeeper-learning-token': readToken, 'x-gatekeeper-learning-owner': 'not-owner' }]) {
    const out = response();
    await handler(fakeRequest(headers), out);
    assert.ok([401, 403].includes(out.status));
  }
  assert.equal(reads, 0);
});

test('authenticated absent/corrupt journal returns 503 and never claims success', async () => {
  let reads = 0;
  const handler = createReadOnlyStatusHandler({
    binding, readToken, readStatus: async () => { reads++; throw new Error('journal unavailable'); },
  });
  const out = response();
  await handler(fakeRequest({
    'x-gatekeeper-learning-token': readToken,
    'x-gatekeeper-learning-owner': binding.ownerId,
  }), out);
  assert.equal(reads, 1);
  assert.equal(out.status, 503);
  assert.match(out.chunks.join(''), /learning_status_unavailable/);
  assert.doesNotMatch(out.chunks.join(''), /experiment-1/);
});

test('only fixed bodyless GET path is admitted', async () => {
  const handler = createReadOnlyStatusHandler({
    binding, readToken, readStatus: async () => { throw new Error('never'); },
  });
  for (const incoming of [
    fakeRequest({ 'content-length': '0' }),
    fakeRequest({ 'transfer-encoding': 'chunked' }),
    fakeRequest({}, { method: 'POST' }),
  ]) {
    const out = response(); await handler(incoming, out);
    assert.equal(out.status, 405);
  }
  const out = response();
  await handler(fakeRequest({}, { url: '/not-a-learning-route' }), out);
  assert.equal(out.status, 404);
});

test('status listener cannot bind a non-loopback address or privileged port', async () => {
  for (const settings of [
    { host: '0.0.0.0', port: 8791 },
    { host: '::1', port: 8791 },
    { host: '127.0.0.1', port: 80 },
  ]) {
    await assert.rejects(() => listenReadOnlyStatus({}, settings), /loopback port/);
  }
});

const privateFile = { isFile: () => true, uid: 1000, mode: 0o100600, nlink: 1, size: 24 };
const sample = JSON.stringify({ binding, configDigest: 'b'.repeat(64), directory: '/var/lib/gk-v2-private-journal/experiment',
  readToken, repositoryRoot: '/app', trust: {} });
function readConfig(overrides = {}) {
  const calls = [];
  const result = () => readStatusConfig({
    path: '/var/lib/gk-v2-private-journal/status-config.json',
    uid: 1000, open: () => { calls.push('open'); return 9; },
    stat: () => overrides.stat ?? privateFile,
    read: () => overrides.value ?? sample,
    close: () => calls.push('close'), ...overrides.args,
  });
  return { result, calls };
}

test('private config refuses wrong identity, path, permissions and invalid JSON', () => {
  const valid = readConfig();
  assert.equal(valid.result().binding.ownerId, 'owner-1');
  assert.deepEqual(valid.calls, ['open', 'close']);
  for (const input of [
    { args: { uid: 0 } },
    { args: { path: '/tmp/status-config.json' } },
    { stat: { ...privateFile, mode: 0o100644 } },
    { stat: { ...privateFile, uid: 0 } },
    { value: 'not-json' },
  ]) {
    assert.throws(readConfig(input).result, /GK_V2_STATUS_CONFIG_REFUSED/);
  }
});

test('production Dockerfile does not enable or start status transport', () => {
  const docker = readFileSync(new URL('../Dockerfile', import.meta.url), 'utf8');
  assert.doesNotMatch(docker, /start-status-listener|GK_V2_READONLY_STATUS|status-listener\.mjs/);
});
