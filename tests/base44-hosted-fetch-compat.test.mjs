// Authored for isolated qualification only. No hosted account, production secret,
// provider request or model call. Loopback servers exist only inside this test.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import vm from 'node:vm';
import ts from 'typescript';
import { createLearningStatusBackend } from '../integrations/base44/shared/learning-status-backend.js';
import { createLearningHistoryBackend } from '../integrations/base44/shared/learning-history-backend.js';
import { createReviewBridge } from '../integrations/base44/shared/review-backend.js';
import { REVIEW_PUBLIC_URL, REVIEW_APP_ID } from '../integrations/base44/shared/review-contract.js';
import { binding, nowMs, completedResponse } from './base44-completed-learning-fixture.mjs';

const marker = 'synthetic-private-value-never-exposed';
const token = 'synthetic_' + 'x'.repeat(48);
const values = {
  GATEKEEPER_LEARNING_OWNER_ID: binding.ownerId,
  GATEKEEPER_LEARNING_EXPERIMENT_ID: binding.experimentId,
  GATEKEEPER_LEARNING_SOURCE_COMMIT: binding.sourceCommit,
  GATEKEEPER_LEARNING_READ_TOKEN: token,
  GATEKEEPER_LEARNING_HISTORY_SOURCE_COMMIT: binding.servingSourceCommit,
  GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT: binding.executionSourceCommit,
  GATEKEEPER_LEARNING_CLOSURE_SHA256: binding.closureDigest,
  GATEKEEPER_REVIEW_OWNER_ID: binding.ownerId,
  GATEKEEPER_REVIEW_ENABLED: 'enabled',
  GATEKEEPER_REVIEW_SOURCE_COMMIT: binding.servingSourceCommit,
  GATEKEEPER_REVIEW_TOKEN: token,
};
const liveResponse = () => ({ schema: 'gk-learning-v2-status-response',
  checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status });
const reviewResponse = () => ({ version: 1, sourceCommit: binding.servingSourceCommit,
  scope: 'configured_admin_owner', enabled: true, job: null, jobs: [] });
const specifications = [
  { name: 'gatekeeperLearningStatus', backend: 'learning-status-backend.js', hostedBackend: 'learningStatusBackend.ts',
    factoryName: 'createLearningStatusBackend', factory: createLearningStatusBackend,
    ownerName: 'GATEKEEPER_LEARNING_OWNER_ID', command: {}, response: liveResponse,
    unavailable: 'learning_status_unavailable', badRequest: 'bad_request', method: 'GET' },
  { name: 'gatekeeperLearningHistory', backend: 'learning-history-backend.js', hostedBackend: 'learningHistoryBackend.ts',
    factoryName: 'createLearningHistoryBackend', factory: createLearningHistoryBackend,
    ownerName: 'GATEKEEPER_LEARNING_OWNER_ID', command: {}, response: completedResponse,
    unavailable: 'learning_history_unavailable', badRequest: 'bad_request', method: 'GET' },
  { name: 'gatekeeperReview', backend: 'review-backend.js', hostedBackend: 'reviewBackend.ts',
    factoryName: 'createReviewBridge', factory: createReviewBridge,
    ownerName: 'GATEKEEPER_REVIEW_OWNER_ID', command: { action: 'info' }, response: reviewResponse,
    unavailable: 'review_unavailable', badRequest: 'invalid_request', method: 'POST' },
];
const sourcePath = name => `integrations/base44/editor/base44/functions/${name}/entry.ts`;
const readSource = path => readFileSync(new URL('../' + path, import.meta.url));
const incoming = (body, method = 'POST') => new Request('https://fixture.invalid/function', {
  method, ...(method === 'POST' ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
});

function hosted(specification, { extract = false, user = { id: binding.ownerId, role: 'admin' },
  fetchResult = () => Response.json(specification.response()), source = readSource(sourcePath(specification.name)).toString('utf8'),
  readSecret = name => Promise.resolve(values[name]) } = {}) {
  const compiled = ts.transpileModule(source, { fileName: 'entry.ts', reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
  const logs = [], calls = [], reads = [], trace = [], module = { exports: {} };
  const auth = { me() { assert.equal(this, auth); trace.push('authenticate'); return Promise.resolve(user); } };
  const secrets = { get(name) { assert.equal(this, secrets); reads.push(name); trace.push(name); return readSecret(name); } };
  const context = vm.createContext({ module, exports: module.exports,
    console: { info(value) { logs.push(value); } },
    fetch(input, init) { calls.push({ input, init }); trace.push('fetch'); return fetchResult(input, init); },
    require(name) {
      if (name === 'npm:@base44/sdk@0.8.54') return { createClientFromRequest() { return { auth }; } };
      if (name === 'base44:runtime') return { secrets };
      if (name === '../../../../shared/' + specification.backend || name === '../../shared/' + specification.hostedBackend)
        return { [specification.factoryName]: options => extract ? () => options :
          specification.factory({ ...options, clock: () => new Date(nowMs) }) };
      throw new Error('Unexpected test adapter dependency: ' + name);
    },
  });
  new vm.Script(compiled.outputText, { filename: specification.name + '.cjs' }).runInContext(context);
  assert.deepEqual(trace, [], 'module load cannot authenticate, read secrets or fetch');
  return { handle: module.exports.default, calls, reads, trace, logs };
}

function privateLogsAbsent(logs) {
  const records = JSON.parse(JSON.stringify(logs));
  const kinds = ['timeout', 'dns', 'tls', 'network', 'unsupported-option', 'other'];
  for (const record of records) {
    assert.ok(['GK_LS_SECRET_BEGIN', 'GK_LS_SECRET_RESULT', 'GK_LS_SECRET_ERROR',
      'GK_LS_FETCH_BEGIN', 'GK_LS_FETCH_RESULT', 'GK_LS_FETCH_ERROR'].includes(record.event));
    assert.ok(Object.keys(record).every(key => ['event', 'binding', 'nonemptyString', 'status', 'kind'].includes(key)));
    if ('kind' in record) assert.ok(kinds.includes(record.kind));
    if ('binding' in record) assert.ok(['GATEKEEPER_LEARNING_OWNER_ID', 'GATEKEEPER_LEARNING_EXPERIMENT_ID',
      'GATEKEEPER_LEARNING_SOURCE_COMMIT', 'GATEKEEPER_LEARNING_READ_TOKEN'].includes(record.binding));
    if ('status' in record) assert.ok(Number.isSafeInteger(record.status) && record.status >= 100 && record.status <= 599);
    if ('nonemptyString' in record) assert.equal(typeof record.nonemptyString, 'boolean');
  }
  for (const value of [marker, token, binding.ownerId, 'https://redirect.invalid'])
    assert.equal(JSON.stringify(records).includes(value), false);
}

async function fixedError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { error: code });
  for (const value of [marker, token, binding.ownerId, 'https://redirect.invalid']) assert.equal(body.includes(value), false);
}

test('all three actual adapters fail closed on every unexpected redirect policy before fetch', async () => {
  for (const specification of specifications) {
    for (const init of [undefined, {}, { redirect: undefined }, { redirect: null },
      { redirect: '' }, { redirect: 'follow' }, { redirect: 'manual' }]) {
      const host = hosted(specification, { extract: true });
      const options = await host.handle({});
      await assert.rejects(options.fetchImpl('https://fixture.invalid', init),
        error => error.name === 'TypeError' && error.message === 'Unexpected upstream redirect policy');
      assert.equal(host.calls.length, 0); assert.deepEqual(host.reads, []);
      privateLogsAbsent(host.logs);
    }
  }
});

test('all three actual adapters reject every 300–399 before reading response headers/body/URL', async () => {
  for (const specification of specifications) {
    for (let status = 300; status <= 399; status++) {
      const upstream = { status, redirected: false,
        get headers() { assert.fail('redirect headers must not be inspected'); },
        get body() { assert.fail('redirect body must not be inspected'); },
        get url() { assert.fail('redirect target must not be inspected'); } };
      const host = hosted(specification, { extract: true, fetchResult: () => upstream });
      const options = await host.handle({});
      await assert.rejects(options.fetchImpl('https://fixture.invalid', { redirect: 'error' }),
        error => error.name === 'TypeError' && error.message === 'Upstream redirect rejected');
      assert.equal(host.calls.length, 1); assert.equal(host.calls[0].init.redirect, 'manual');
      privateLogsAbsent(host.logs);
    }
  }
});

test('redirected responses are rejected for successful and error HTTP statuses', async () => {
  for (const specification of specifications) {
    for (const status of [200, 202, 400, 503]) {
      const host = hosted(specification, { extract: true, fetchResult: () => ({ status, redirected: true,
        get headers() { assert.fail('redirected headers must not be inspected'); },
        get body() { assert.fail('redirected body must not be inspected'); } }) });
      const options = await host.handle({});
      await assert.rejects(options.fetchImpl('https://fixture.invalid', { redirect: 'error' }),
        error => error.message === 'Upstream redirect rejected');
      assert.equal(host.calls.length, 1); privateLogsAbsent(host.logs);
    }
  }
});

test('manual translation clones only the options shell and preserves accepted response and error identities', async () => {
  for (const specification of specifications) {
    const response = new Response(marker, { status: 200 });
    const host = hosted(specification, { extract: true, fetchResult: () => response });
    const options = await host.handle({});
    const input = new URL('https://fixture.invalid/' + marker), abort = new AbortController();
    const init = Object.freeze({ method: 'POST', redirect: 'error', cache: 'no-store',
      signal: abort.signal, headers: Object.freeze({ 'X-Synthetic-Private': token }),
      body: new Uint8Array([1, 2, 3]) });
    assert.equal(await options.fetchImpl(input, init), response);
    const [{ input: seenInput, init: seenInit }] = host.calls;
    assert.equal(seenInput, input); assert.notEqual(seenInit, init);
    assert.deepEqual(Reflect.ownKeys(seenInit), Reflect.ownKeys(init));
    for (const key of Reflect.ownKeys(init)) assert.equal(seenInit[key], key === 'redirect' ? 'manual' : init[key]);
    assert.equal(init.redirect, 'error'); assert.equal(response.bodyUsed, false);
    assert.equal(host.calls.length, 1); privateLogsAbsent(host.logs);
    for (const asynchronous of [false, true]) {
      const original = new Error(marker);
      const failed = hosted(specification, { extract: true,
        fetchResult: () => { if (asynchronous) return Promise.reject(original); throw original; } });
      const wrapper = await failed.handle({});
      await assert.rejects(wrapper.fetchImpl(input, init), error => error === original);
      assert.equal(failed.calls.length, 1); privateLogsAbsent(failed.logs);
    }
  }
});

test('actual hosted backends retain method, owner and body gates before outbound fetch', async () => {
  for (const specification of specifications) {
    const method = hosted(specification);
    await fixedError(await method.handle(incoming(null, 'GET')), 405, 'method_not_allowed');
    assert.deepEqual(method.trace, []);
    for (const [user, status, error, expectedReads] of [
      [null, 401, 'unauthorized', []],
      [{ id: binding.ownerId, role: 'user' }, 403, 'forbidden', []],
      [{ id: 'another-owner', role: 'admin' }, 403, 'forbidden', [specification.ownerName]],
    ]) {
      const host = hosted(specification, { user });
      await fixedError(await host.handle(incoming(specification.command)), status, error);
      assert.equal(host.calls.length, 0); assert.deepEqual(host.reads, expectedReads);
      assert.deepEqual(host.trace, ['authenticate', ...expectedReads]); privateLogsAbsent(host.logs);
    }
    const invalid = hosted(specification);
    await fixedError(await invalid.handle(incoming({ ownerId: 'another-owner' })), 400, specification.badRequest);
    assert.equal(invalid.calls.length, 0);
    if (specification.method === 'GET') assert.deepEqual(invalid.reads, [specification.ownerName]);
  }
  const disabled = hosted(specifications[2], { readSecret: name => Promise.resolve(
    name === 'GATEKEEPER_REVIEW_ENABLED' ? 'disabled' : values[name]) });
  await fixedError(await disabled.handle(incoming({ action: 'info' })), 503, 'review_unavailable');
  assert.deepEqual(disabled.reads, ['GATEKEEPER_REVIEW_OWNER_ID', 'GATEKEEPER_REVIEW_ENABLED']);
  assert.equal(disabled.calls.length, 0);
});

test('actual backends receive unchanged fixed URL, auth headers, no-store, timeout and command', async () => {
  for (const specification of specifications) {
    const host = hosted(specification);
    const response = await host.handle(incoming(specification.command));
    assert.equal(response.status, 200); assert.deepEqual(await response.json(), specification.response());
    assert.equal(host.calls.length, 1);
    const [{ input, init }] = host.calls;
    assert.equal(input, specification.method === 'POST' ? REVIEW_PUBLIC_URL :
      'https://proxy-production-9553.up.railway.app/gatekeeper/learning-v3/status');
    assert.equal(init.method, specification.method); assert.equal(init.redirect, 'manual');
    assert.equal(init.cache, 'no-store'); assert.ok(init.signal instanceof AbortSignal);
    assert.equal(init.signal.aborted, false);
    if (specification.method === 'POST') {
      assert.equal(init.body, JSON.stringify(specification.command));
      assert.deepEqual(init.headers, { 'Content-Type': 'application/json',
        'X-Gatekeeper-Review-Token': token, 'X-Gatekeeper-Review-Owner': binding.ownerId,
        'X-Gatekeeper-Review-App': REVIEW_APP_ID, 'X-Gatekeeper-Review-Source': binding.servingSourceCommit });
    } else {
      assert.equal(init.body, undefined);
      assert.deepEqual(init.headers, { 'X-Gatekeeper-Learning-Token': token,
        'X-Gatekeeper-Learning-Owner': binding.ownerId, Accept: 'application/json' });
    }
    assert.equal(host.trace[0], 'authenticate'); assert.equal(host.reads[0], specification.ownerName);
    privateLogsAbsent(host.logs);
  }
});

test('manual rejection retains fixed private errors and mutation uncertainty without reposting', async () => {
  for (const specification of specifications) {
    const commands = specification.method === 'POST' ? [
      { action: 'info' },
      { action: 'start', jobId: 'c85f657a-1b83-4de0-9c49-37a8385630a8' },
      { action: 'submit', idempotencyKey: 'c85f657a-1b83-4de0-9c49-37a8385630a8',
        input: { file: 'fixture.js', language: 'javascript', context: 'Synthetic qualification fixture', code: 'const value = 1;' } },
    ] : [{}];
    for (const command of commands) {
      const host = hosted(specification, { fetchResult: () => ({ status: 307, redirected: false,
        get headers() { assert.fail('Location and response headers cannot enter the backend'); },
        get body() { assert.fail('redirect response content cannot enter the backend'); } }) });
      await fixedError(await host.handle(incoming(command)), 503,
        command.action === 'start' ? 'dispatch_uncertain' : specification.unavailable);
      assert.equal(host.calls.length, 1);
      if (specification.method === 'POST') assert.equal(host.calls[0].init.body, JSON.stringify(command));
      privateLogsAbsent(host.logs);
    }
  }
});

test('real loopback redirects never receive a forwarded token, body or second request', async t => {
  const destinationCalls = [], originCalls = [];
  const destination = createServer((request, response) => {
    destinationCalls.push({ url: request.url, headers: request.headers });
    request.resume(); response.end('unexpected destination');
  });
  destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
  t.after(() => { destination.closeAllConnections(); destination.close(); });
  const destinationUrl = `http://127.0.0.1:${destination.address().port}/private`;
  const origin = createServer((request, response) => {
    originCalls.push({ method: request.method, headers: request.headers });
    request.resume();
    response.writeHead(Number(request.url.slice(1)), { Location: destinationUrl, Connection: 'close' });
    response.end(marker);
  });
  origin.listen(0, '127.0.0.1'); await once(origin, 'listening');
  t.after(() => { origin.closeAllConnections(); origin.close(); });
  for (const specification of specifications) {
    for (const status of [301, 302, 303, 307, 308]) {
      const before = originCalls.length;
      const host = hosted(specification, { extract: true, fetchResult: (input, init) => fetch(input, init) });
      const options = await host.handle({});
      await assert.rejects(options.fetchImpl(`http://127.0.0.1:${origin.address().port}/${status}`, {
        method: specification.method, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(5000),
        headers: { 'X-Synthetic-Private': token },
        ...(specification.method === 'POST' ? { body: marker } : {}),
      }), error => error.message === 'Upstream redirect rejected');
      assert.equal(host.calls.length, 1); assert.equal(originCalls.length, before + 1);
      assert.equal(originCalls.at(-1).headers['x-synthetic-private'], token);
      assert.equal(destinationCalls.length, 0, 'the redirect target never receives any request');
      privateLogsAbsent(host.logs);
    }
  }
});

test('installation manifest permits only pinned import literals and optional one final LF removal', async () => {
  const manifest = JSON.parse(readSource('integrations/base44/editor/HOSTED_INSTALLATION_MANIFEST.json').toString('utf8'));
  assert.equal(manifest.schema, 'gatekeeper-base44-hosted-installation-v1');
  assert.equal(manifest.files.length, 9);
  const digest = bytes => createHash('sha256').update(bytes).digest('hex');
  for (const entry of manifest.files) {
    const repository = readSource(entry.repositoryPath);
    assert.equal(repository.length, entry.repository.bytes); assert.equal(digest(repository), entry.repository.sha256);
    assert.equal(repository.at(-1), 10);
    let adapted = repository.toString('utf8');
    for (const replacement of entry.importReplacements) {
      assert.equal(adapted.split(replacement.from).length - 1, 1, 'each exact import literal occurs once');
      adapted = adapted.replace(replacement.from, replacement.to);
    }
    const withLf = Buffer.from(adapted), withoutLf = withLf.subarray(0, withLf.length - 1);
    for (const [bytes, expected] of [[withLf, entry.hosted.withFinalLf], [withoutLf, entry.hosted.withoutFinalLf]]) {
      assert.equal(bytes.length, expected.bytes); assert.equal(digest(bytes), expected.sha256);
    }
    const allowed = new Set([entry.hosted.withFinalLf.sha256, entry.hosted.withoutFinalLf.sha256]);
    for (const invalid of [Buffer.concat([withLf, Buffer.from('\n')]), Buffer.concat([withoutLf, Buffer.from(' ')]),
      Buffer.from(adapted.replaceAll('\n', '\r\n')), Buffer.from('// altered\n' + adapted),
      withoutLf.subarray(0, withoutLf.length - 1)]) assert.equal(allowed.has(digest(invalid)), false);
    const specification = specifications.find(value => sourcePath(value.name) === entry.repositoryPath);
    if (specification) {
      for (const bytes of [withLf, withoutLf]) {
        const host = hosted(specification, { source: bytes.toString('utf8') });
        const response = await host.handle(incoming(specification.command));
        assert.equal(response.status, 200); assert.deepEqual(await response.json(), specification.response());
        assert.equal(host.calls.length, 1); assert.equal(host.calls[0].init.redirect, 'manual');
      }
    }
  }
});
