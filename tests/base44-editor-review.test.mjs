// Authored for isolated remote qualification. Actual adapter/backend, synthetic
// hosted SDK/runtime bindings only: no account, real secret, network or inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { createReviewBridge } from '../integrations/base44/shared/review-backend.js';
import { REVIEW_PUBLIC_URL, REVIEW_APP_ID } from '../integrations/base44/shared/review-contract.js';

const path = '../integrations/base44/editor/base44/functions/gatekeeperReview/entry.ts';
const text = readFileSync(new URL(path, import.meta.url), 'utf8');
const compiled = ts.transpileModule(text, { fileName: 'entry.ts', reportDiagnostics: true,
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.deepEqual((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);

const owner = 'synthetic-owner', sourceCommit = 'c'.repeat(40);
const privateMarker = 'synthetic-private-marker-do-not-reflect';
const names = ['GATEKEEPER_REVIEW_OWNER_ID', 'GATEKEEPER_REVIEW_ENABLED',
  'GATEKEEPER_REVIEW_SOURCE_COMMIT', 'GATEKEEPER_REVIEW_TOKEN'];
const values = { GATEKEEPER_REVIEW_OWNER_ID: owner, GATEKEEPER_REVIEW_ENABLED: 'enabled',
  GATEKEEPER_REVIEW_SOURCE_COMMIT: sourceCommit, GATEKEEPER_REVIEW_TOKEN: 'synthetic_' + 'x'.repeat(48) };
const reply = { version: 1, sourceCommit, scope: 'configured_admin_owner', enabled: true, job: null, jobs: [] };
const request = (body = { action: 'info' }, method = 'POST') => new Request('https://fixture.invalid/function', {
  method, ...(method === 'POST' ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const flush = () => new Promise(resolve => setImmediate(resolve));

function hosted({ user = { id: owner, role: 'admin' }, authenticate = () => user,
  readSecret = async name => values[name], fetchResult = async () => Response.json(reply),
  factory = createReviewBridge } = {}) {
  const trace = [], factories = [], handled = [], requests = [], fetches = [];
  const module = { exports: {} };
  const auth = { me() { assert.equal(this, auth); trace.push('authenticate'); return authenticate(); } };
  const secrets = { get(name) { assert.equal(this, secrets); trace.push(name); return readSecret(name); } };
  const context = vm.createContext({ module, exports: module.exports,
    console: { info() { assert.fail('Review adapter must not log private runtime data'); },
      error() { assert.fail('Review adapter must not log private runtime data'); } },
    fetch(input, init) { trace.push('fetch'); fetches.push({ input, init }); return fetchResult(input, init); },
    require(name) {
      if (name === 'npm:@base44/sdk@0.8.54') return {
        createClientFromRequest(incoming) { requests.push(incoming); return { auth }; },
      };
      if (name === 'base44:runtime') return { secrets };
      if (name === '../../../../shared/review-backend.js') return {
        createReviewBridge(options) {
          factories.push(options);
          const bridge = factory(options);
          return incoming => { handled.push(incoming); return bridge(incoming); };
        },
      };
      throw new Error('Unexpected hosted Review dependency: ' + name);
    },
  });
  new vm.Script(compiled.outputText, { filename: 'hosted-review-entry.cjs' }).runInContext(context);
  return { handle: module.exports.default, trace, factories, handled, requests, fetches };
}

async function fixedError(response, status, code) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { error: code });
  assert.equal(body.includes(privateMarker), false);
  assert.equal(body.includes(values.GATEKEEPER_REVIEW_TOKEN), false);
}

test('hosted Review constructs per invocation and forwards exact runtime values without module-load effects', async () => {
  const upstream = new Response(privateMarker), fetched = Promise.resolve(upstream);
  const secret = Promise.resolve({ private: privateMarker });
  const host = hosted({ factory: options => () => options,
    readSecret: () => secret, fetchResult: () => fetched });
  assert.deepEqual(host.trace, []); assert.equal(host.factories.length, 0);
  const incoming = request();
  const first = await host.handle(incoming), second = await host.handle(incoming);
  assert.equal(host.factories.length, 2); assert.notEqual(first, second);
  assert.equal(host.handled[0], incoming); assert.equal(host.handled[1], incoming);
  assert.deepEqual(host.trace, []);
  assert.equal((await first.authenticate(incoming)).id, owner);
  assert.equal(host.requests[0], incoming);
  assert.equal(first.readEnv(names[0]), secret, 'secret promise identity is preserved');
  const input = new URL('https://fixture.invalid/private');
  const controller = new AbortController();
  const init = { method: 'POST', redirect: 'error', cache: 'no-store', signal: controller.signal,
    headers: { 'X-Synthetic': privateMarker }, body: privateMarker };
  assert.equal(await first.fetchImpl(input, init), upstream, 'accepted response identity is preserved');
  assert.equal(upstream.bodyUsed, false);
  assert.equal(host.fetches.length, 1);
  assert.equal(host.fetches[0].input, input); assert.notEqual(host.fetches[0].init, init);
  assert.deepEqual({ ...host.fetches[0].init }, { ...init, redirect: 'manual' });
  assert.equal(init.redirect, 'error');
  assert.equal(host.fetches[0].init.headers, init.headers);
  assert.equal(host.fetches[0].init.signal, controller.signal);

  const original = new Error(privateMarker);
  const failed = hosted({ factory: options => () => options,
    readSecret: () => { throw original; }, fetchResult: () => { throw original; } });
  const wrappers = await failed.handle(incoming);
  assert.throws(() => wrappers.readEnv(names[0]), error => error === original);
  await assert.rejects(wrappers.fetchImpl(input, init), error => error === original);
  assert.equal(failed.fetches.length, 1, 'wrapper never retries a failed fetch');
});

test('actual hosted Review authenticates and resolves async secrets before one fixed manual fetch', async () => {
  const host = hosted(); const incoming = request({ action: 'list' });
  const response = await host.handle(incoming);
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), reply);
  assert.equal(host.requests[0], incoming);
  assert.deepEqual(host.trace, ['authenticate', ...names, 'fetch']);
  const [{ input, init }] = host.fetches;
  assert.equal(input, REVIEW_PUBLIC_URL);
  assert.equal(init.method, 'POST'); assert.equal(init.redirect, 'manual'); assert.equal(init.cache, 'no-store');
  assert.ok(init.signal instanceof AbortSignal); assert.equal(init.signal.aborted, false);
  assert.deepEqual(init.headers, { 'Content-Type': 'application/json',
    'X-Gatekeeper-Review-Token': values.GATEKEEPER_REVIEW_TOKEN,
    'X-Gatekeeper-Review-Owner': owner, 'X-Gatekeeper-Review-App': REVIEW_APP_ID,
    'X-Gatekeeper-Review-Source': sourceCommit });
  assert.equal(init.body, '{"action":"list"}');
});

test('method, authentication and configured-owner denial cannot read the private Review capability', async () => {
  const wrongMethod = hosted();
  await fixedError(await wrongMethod.handle(request(null, 'GET')), 405, 'method_not_allowed');
  assert.deepEqual(wrongMethod.trace, []);
  for (const [user, status, code, reads] of [
    [null, 401, 'unauthorized', []],
    [{ id: owner, role: 'user' }, 403, 'forbidden', []],
    [{ id: 'different-owner', role: 'admin' }, 403, 'forbidden', [names[0]]],
  ]) {
    const host = hosted({ user });
    await fixedError(await host.handle(request()), status, code);
    assert.deepEqual(host.trace, ['authenticate', ...reads]);
    assert.equal(host.fetches.length, 0);
  }
  const rejectedAuth = hosted({ authenticate: async () => { throw new Error(privateMarker); } });
  await fixedError(await rejectedAuth.handle(request()), 401, 'unauthorized');
  assert.deepEqual(rejectedAuth.trace, ['authenticate']);
});

test('deferred owner secret must resolve and match before any other binding is read', async () => {
  let resolveOwner;
  const host = hosted({ readSecret: name => {
    assert.equal(name, names[0], 'no private read can overtake owner resolution');
    return new Promise(resolve => { resolveOwner = resolve; });
  } });
  const response = host.handle(request());
  await flush();
  assert.deepEqual(host.trace, ['authenticate', names[0]]);
  assert.equal(host.fetches.length, 0);
  resolveOwner('different-owner');
  await fixedError(await response, 403, 'forbidden');
  assert.deepEqual(host.trace, ['authenticate', names[0]]);
});

test('every rejected async binding returns a fixed unavailable response without fetch or secret reflection', async () => {
  for (let index = 0; index < names.length; index++) {
    const host = hosted({ readSecret: async name => {
      if (name === names[index]) throw new Error(privateMarker);
      return values[name];
    } });
    await fixedError(await host.handle(request()), 503, 'review_unavailable');
    assert.deepEqual(host.trace, ['authenticate', ...names.slice(0, index + 1)]);
    assert.equal(host.fetches.length, 0);
  }
  for (const value of [undefined, null, '', privateMarker, false]) {
    const host = hosted({ readSecret: async name => name === names[1] ? value : values[name] });
    await fixedError(await host.handle(request()), 503, 'review_unavailable');
    assert.deepEqual(host.trace, ['authenticate', names[0], names[1]]);
  }
});

test('hosted async bridge retains ambiguous-start and reply-validation behavior with zero automatic retries', async () => {
  for (const command of [{ action: 'info' },
    { action: 'start', jobId: 'c85f657a-1b83-4de0-9c49-37a8385630a8' }]) {
    const host = hosted({ fetchResult: async () => { throw new Error(privateMarker); } });
    await fixedError(await host.handle(request(command)), 503,
      command.action === 'start' ? 'dispatch_uncertain' : 'review_unavailable');
    assert.equal(host.fetches.length, 1);
  }
  for (const body of [{ ...reply, sourceCommit: 'a'.repeat(40) }, { ...reply, privateBody: privateMarker }]) {
    const host = hosted({ fetchResult: async () => Response.json(body) });
    await fixedError(await host.handle(request()), 503, 'review_unavailable');
    assert.equal(host.fetches.length, 1);
  }
  const invalid = hosted();
  await fixedError(await invalid.handle(request({ action: 'info', ownerId: 'different-owner' })), 400, 'invalid_request');
  assert.equal(invalid.fetches.length, 0);
});
