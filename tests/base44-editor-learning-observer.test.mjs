// Authored for the isolated remote source gate; never run against hosted secrets.
// Compile the actual adapter and inject the three imports plus fetch/log fixtures.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

const path = '../integrations/base44/editor/base44/functions/gatekeeperLearningStatus/entry.ts';
const source = readFileSync(new URL(path, import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, { fileName: 'entry.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.deepEqual((compiled.diagnostics || []).filter(value => value.category === ts.DiagnosticCategory.Error), []);
const names = ['GATEKEEPER_LEARNING_OWNER_ID', 'GATEKEEPER_LEARNING_EXPERIMENT_ID',
  'GATEKEEPER_LEARNING_SOURCE_COMMIT', 'GATEKEEPER_LEARNING_READ_TOKEN'];
const events = new Set(['GK_LS_SECRET_BEGIN', 'GK_LS_SECRET_RESULT', 'GK_LS_SECRET_ERROR',
  'GK_LS_FETCH_BEGIN', 'GK_LS_FETCH_RESULT', 'GK_LS_FETCH_ERROR']);
const kinds = new Set(['timeout', 'dns', 'tls', 'network', 'unsupported-option', 'other']);
const secretMarker = 'synthetic-private-value-do-not-log';

function fixture({ getSecret = async () => secretMarker,
  fetchResult = async () => new Response('{}', { status: 200 }), throwLog = false } = {}) {
  const logs = [], factories = [], handled = [], authenticated = [], secretReads = [], fetches = [];
  const user = { id: 'synthetic-private-owner', role: 'admin' };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports,
    console: { info(...values) { if (throwLog) throw new Error('synthetic log outage'); logs.push(values); } },
    fetch(input, init) { fetches.push({ input, init }); return fetchResult(input, init); },
    require(name) {
      if (name === 'npm:@base44/sdk@0.8.54') return {
        createClientFromRequest(request) { authenticated.push(request); return { auth: { me: async () => user } }; },
      };
      if (name === 'base44:runtime') return { secrets: { get(name) { secretReads.push(name); return getSecret(name); } } };
      if (name === '../../../../shared/learning-status-backend.js') return {
        createLearningStatusBackend(options) {
          factories.push(options);
          return request => { handled.push(request); return options; };
        },
      };
      throw new Error('Unexpected adapter dependency: ' + name);
    },
  });
  new vm.Script(compiled.outputText, { filename: 'hosted-learning-entry.cjs' }).runInContext(context);
  return { handle: module.exports.default, logs, factories, handled, authenticated, secretReads, fetches, user };
}

function safeLogs(logs) {
  const plain = JSON.parse(JSON.stringify(logs));
  for (const args of plain) {
    assert.equal(args.length, 1);
    const record = args[0];
    assert.ok(events.has(record.event));
    assert.ok(Object.keys(record).every(key => ['event', 'binding', 'nonemptyString', 'status', 'kind'].includes(key)));
    if ('binding' in record) assert.ok(names.includes(record.binding));
    if ('nonemptyString' in record) assert.equal(typeof record.nonemptyString, 'boolean');
    if ('status' in record) assert.ok(Number.isSafeInteger(record.status) && record.status >= 100 && record.status <= 599);
    if ('kind' in record) assert.ok(kinds.has(record.kind));
  }
  assert.equal(JSON.stringify(plain).includes(secretMarker), false);
  assert.equal(JSON.stringify(plain).includes('synthetic-private-owner'), false);
  assert.equal(JSON.stringify(plain).includes('https://private.invalid'), false);
  return plain.map(args => args[0]);
}

test('hosted adapter constructs backend per invocation and preserves request/authentication', async () => {
  const host = fixture();
  assert.equal(host.factories.length, 0, 'factory cannot capture unavailable globals at module evaluation');
  const request = new Request('https://private.invalid/function', { method: 'POST', body: '{}' });
  const first = await host.handle(request), second = await host.handle(request);
  assert.equal(host.factories.length, 2); assert.notEqual(first, second);
  assert.equal(host.handled[0], request); assert.equal(host.handled[1], request);
  assert.equal(await first.authenticate(request), host.user);
  assert.equal(host.authenticated[0], request);
  assert.deepEqual(safeLogs(host.logs), []);
});

test('secret wrapper passes exact name/result and emits only known binding plus presence', async () => {
  for (const value of [secretMarker, '', ' ', null, 0, { private: secretMarker }]) {
    const host = fixture({ getSecret: () => value });
    const adapter = await host.handle({});
    for (const name of names) assert.equal(await adapter.readSecret(name), value);
    assert.deepEqual(host.secretReads, names);
    const logs = safeLogs(host.logs);
    assert.equal(logs.length, names.length * 2);
    for (let i = 0; i < names.length; i++) {
      assert.deepEqual(logs[i * 2], { event: 'GK_LS_SECRET_BEGIN', binding: names[i] });
      assert.deepEqual(logs[i * 2 + 1], { event: 'GK_LS_SECRET_RESULT', binding: names[i],
        nonemptyString: typeof value === 'string' && value.length > 0 });
    }
  }
  const host = fixture(); const adapter = await host.handle({});
  assert.equal(await adapter.readSecret(secretMarker), secretMarker);
  assert.equal(host.secretReads[0], secretMarker, 'unknown names are forwarded unchanged, never logged');
  assert.deepEqual(safeLogs(host.logs), [
    { event: 'GK_LS_SECRET_BEGIN' }, { event: 'GK_LS_SECRET_RESULT', nonemptyString: true },
  ]);
});

test('direct fetch preserves input/options/signal/header identities and response body untouched', async () => {
  const response = new Response(secretMarker, { status: 200 });
  const host = fixture({ fetchResult: async () => response });
  const adapter = await host.handle({});
  const input = new URL('https://private.invalid/' + secretMarker);
  const controller = new AbortController();
  const init = { method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
    headers: { 'X-Private': secretMarker } };
  assert.equal(await adapter.fetchImpl(input, init), response);
  assert.equal(host.fetches.length, 1);
  assert.equal(host.fetches[0].input, input); assert.equal(host.fetches[0].init, init);
  assert.equal(host.fetches[0].init.signal, controller.signal);
  assert.equal(host.fetches[0].init.headers, init.headers);
  assert.equal(response.bodyUsed, false);
  assert.deepEqual(safeLogs(host.logs), [
    { event: 'GK_LS_FETCH_BEGIN' }, { event: 'GK_LS_FETCH_RESULT', status: 200 },
  ]);
});

test('secret and fetch errors preserve original identity, classify boundedly, and never retry', async () => {
  const fixtures = [
    [new DOMException(secretMarker, 'TimeoutError'), 'timeout'],
    [Object.assign(new Error('https://private.invalid/' + secretMarker), { code: 'ENOTFOUND' }), 'dns'],
    [new Error('TLS certificate failure ' + secretMarker), 'tls'],
    [new Error('fetch failed ' + secretMarker), 'network'],
    [new TypeError('RequestInit.cache is not supported ' + secretMarker), 'unsupported-option'],
    [new Error(secretMarker), 'other'],
    [secretMarker, 'other'],
    [Object.defineProperty({}, 'message', { get() { throw new Error(secretMarker); } }), 'other'],
  ];
  for (const [error, kind] of fixtures) {
    const host = fixture({ getSecret: () => { throw error; }, fetchResult: () => { throw error; } });
    const adapter = await host.handle({});
    await assert.rejects(adapter.readSecret(names[3]), caught => caught === error);
    await assert.rejects(adapter.fetchImpl('https://private.invalid/' + secretMarker, {}), caught => caught === error);
    assert.equal(host.secretReads.length, 1); assert.equal(host.fetches.length, 1);
    const logs = safeLogs(host.logs);
    assert.deepEqual(logs[1], { event: 'GK_LS_SECRET_ERROR', binding: names[3], kind });
    assert.deepEqual(logs[3], { event: 'GK_LS_FETCH_ERROR', kind });
  }
});

test('status diagnostics omit invalid status and cannot replace returned response or original error', async () => {
  for (const status of [NaN, Infinity, -1, 0, 600, 200.5, secretMarker]) {
    const response = { status };
    const host = fixture({ fetchResult: () => response }); const adapter = await host.handle({});
    assert.equal(await adapter.fetchImpl('https://private.invalid', {}), response);
    assert.deepEqual(safeLogs(host.logs)[1], { event: 'GK_LS_FETCH_RESULT' });
  }
  const response = Object.defineProperty({}, 'status', { get() { throw new Error(secretMarker); } });
  const badStatus = fixture({ fetchResult: () => response }); const statusAdapter = await badStatus.handle({});
  assert.equal(await statusAdapter.fetchImpl('https://private.invalid', {}), response);
  assert.deepEqual(safeLogs(badStatus.logs)[1], { event: 'GK_LS_FETCH_RESULT' });
  const original = new Error(secretMarker);
  const noisy = fixture({ throwLog: true, getSecret: () => { throw original; }, fetchResult: () => { throw original; } });
  const adapter = await noisy.handle({});
  await assert.rejects(adapter.readSecret(names[0]), error => error === original);
  await assert.rejects(adapter.fetchImpl('https://private.invalid', {}), error => error === original);
  const silent = fixture({ throwLog: true, fetchResult: () => response });
  const successful = await silent.handle({});
  assert.equal(await successful.readSecret(names[0]), secretMarker);
  assert.equal(await successful.fetchImpl('https://private.invalid', {}), response);
});
