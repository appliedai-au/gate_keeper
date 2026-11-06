// Isolated qualification only; no hosted account, real archive or provider call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validateLearningHistoryBinding, projectLearningHistoryResponse } from '../integrations/base44/shared/learning-history-contract.js';
import { projectLearningStatus } from '../integrations/base44/shared/learning-status-contract.js';
import { createLearningHistoryBackend } from '../integrations/base44/shared/learning-history-backend.js';
import { binding, nowMs, completedResponse } from './base44-completed-learning-fixture.mjs';

const marker = 'synthetic-private-value-never-reflected';
const token = 'synthetic_' + 'x'.repeat(48);
const values = {
  GATEKEEPER_LEARNING_OWNER_ID: binding.ownerId,
  GATEKEEPER_LEARNING_EXPERIMENT_ID: binding.experimentId,
  GATEKEEPER_LEARNING_SOURCE_COMMIT: binding.sourceCommit,
  GATEKEEPER_LEARNING_READ_TOKEN: token,
  GATEKEEPER_LEARNING_HISTORY_SOURCE_COMMIT: binding.servingSourceCommit,
  GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT: binding.executionSourceCommit,
  GATEKEEPER_LEARNING_CLOSURE_SHA256: binding.closureDigest,
};
const ownerName = 'GATEKEEPER_LEARNING_OWNER_ID';
const request = (body = {}, { query = '', method = 'POST' } = {}) => new Request('https://fixture.invalid/function' + query, {
  method, ...(method === 'POST' ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
});
const factory = overrides => createLearningHistoryBackend({
  authenticate: async () => ({ id: binding.ownerId, role: 'admin' }), readSecret: async name => values[name],
  fetchImpl: async () => Response.json(completedResponse()), clock: () => new Date(nowMs), ...overrides,
});
async function fixedError(response, status, error) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  const text = await response.text();
  assert.deepEqual(JSON.parse(text), { error });
  for (const value of [marker, token, binding.ownerId]) assert.equal(text.includes(value), false);
}

test('completed public projection retains A exactly and accepts negative outcomes with unknown prices', () => {
  const original = completedResponse();
  const result = projectLearningHistoryResponse(original, binding, nowMs);
  assert.deepEqual(result.status, projectLearningStatus(original.status, {
    ownerId: binding.ownerId, experimentId: binding.experimentId, sourceCommit: binding.sourceCommit,
  }));
  assert.equal(result.status.budget.complete, false); assert.equal(result.status.budget.unknownCostCalls, 24);
  assert.equal(result.archive.archivedAt, original.archive.archivedAt);
  assert.equal(result.serving.sourceCommit, binding.servingSourceCommit);
  assert.equal(result.archive.executionSourceCommit, binding.executionSourceCommit);
  assert.notEqual(result, original); assert.notEqual(result.status, original.status);
  assert.deepEqual(validateLearningHistoryBinding(binding), binding);
});

test('history contract refuses source/closure substitution, private fields and legacy envelopes', () => {
  for (const mutate of [
    value => { value.serving.sourceCommit = 'e'.repeat(40); },
    value => { value.archive.executionSourceCommit = 'e'.repeat(40); },
    value => { value.archive.closureDigest = 'e'.repeat(64); },
    value => { value.archive.experimentSourceCommit = 'e'.repeat(40); },
    value => { value.status.sourceCommit = binding.servingSourceCommit; },
    value => { value.serving.sourceCommit = binding.executionSourceCommit; },
    value => { value.privateEvidence = marker; },
    value => { value.archive.providerSession = marker; },
    value => { value.status.privatePrompt = marker; },
  ]) {
    const value = completedResponse(); mutate(value);
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
  }
  assert.throws(() => projectLearningHistoryResponse({ schema: 'gk-learning-v2-status-response',
    checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status }, binding, nowMs));
  assert.throws(() => validateLearningHistoryBinding({ ...binding, servingSourceCommit: binding.sourceCommit }));
  let accessed = false;
  const value = completedResponse();
  Object.defineProperty(value.archive, 'closureDigest', { enumerable: true, get() { accessed = true; return binding.closureDigest; } });
  assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs)); assert.equal(accessed, false);
});

test('a completed label requires all ten terminal dispositions, BASE and public closure invariants', () => {
  for (const mutate of [
    value => { value.status.counts.attempted = 9; },
    value => { value.status.counts.provisional = 1; },
    value => { value.status.counts.noCoverage = 3; },
    value => { value.status.baseline.status = 'planned'; },
    value => { value.status.qualification = 'source-only-unqualified'; },
    value => { value.status.dispatch.completed = 10; },
    value => { value.status.dispatch.completed = 32; },
    value => { value.status.budget.observedReservedMicros = 1; },
    value => {
      value.status.pendingOperation = 'operation-pending'; value.status.budget.pendingExecutionOperations = 1;
      value.status.dispatch.pending = { operationId: 'operation-pending', kind: 'proposal', stage: 'admission-intent' };
    },
  ]) {
    const value = completedResponse(); mutate(value);
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
  }
});

test('freshness belongs to checkedAt, while archive time stays strict and historical', () => {
  for (const age of [-5000, 0, 60_000]) {
    const value = completedResponse(); value.checkedAt = new Date(nowMs - age).toISOString();
    assert.equal(projectLearningHistoryResponse(value, binding, nowMs).archive.archivedAt, value.archive.archivedAt);
  }
  for (const age of [-5001, 60_001]) {
    const value = completedResponse(); value.checkedAt = new Date(nowMs - age).toISOString();
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
  }
  for (const archivedAt of ['2026-02-30T00:00:00.000Z', 'invalid', new Date(nowMs + 1).toISOString()]) {
    const value = completedResponse(); value.archive.archivedAt = archivedAt;
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
  }
  assert.throws(() => projectLearningHistoryResponse(completedResponse(), binding, NaN));
});

test('authentication and configured owner precede read token and all C/B/closure pins', async () => {
  for (const [user, status, code, expectedReads] of [
    [null, 401, 'unauthorized', []],
    [{ id: binding.ownerId, role: 'user' }, 403, 'forbidden', []],
    [{ id: 'another-owner', role: 'admin' }, 403, 'forbidden', [ownerName]],
  ]) {
    const reads = [], fetches = [];
    const bridge = factory({ authenticate: async () => user,
      readSecret: async name => { reads.push(name); return values[name]; },
      fetchImpl: async (...args) => { fetches.push(args); throw new Error(marker); } });
    await fixedError(await bridge(request()), status, code);
    assert.deepEqual(reads, expectedReads); assert.equal(fetches.length, 0);
  }
  const reads = [];
  const bridge = factory({ readSecret: async name => { reads.push(name); return values[name]; },
    fetchImpl: async () => assert.fail('invalid body cannot fetch') });
  for (const supplied of [request({ sourceCommit: binding.sourceCommit }), request({}, { query: '?mode=live' })]) {
    reads.length = 0; await fixedError(await bridge(supplied), 400, 'bad_request');
    assert.deepEqual(reads, [ownerName]);
  }
});

test('private history bridge keeps its fixed read-only URL/options and enforces configured provenance', async () => {
  let observed;
  const bridge = factory({ fetchImpl: async (input, init) => { observed = { input, init }; return Response.json(completedResponse()); } });
  const response = await bridge(request());
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), completedResponse());
  assert.equal(observed.input, 'https://proxy-production-9553.up.railway.app/gatekeeper/learning-v3/status');
  assert.equal(observed.init.method, 'GET'); assert.equal(observed.init.redirect, 'error');
  assert.equal(observed.init.cache, 'no-store'); assert.equal(observed.init.body, undefined);
  assert.deepEqual(observed.init.headers, { 'X-Gatekeeper-Learning-Token': token,
    'X-Gatekeeper-Learning-Owner': binding.ownerId, Accept: 'application/json' });
  for (const name of ['GATEKEEPER_LEARNING_HISTORY_SOURCE_COMMIT', 'GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT',
    'GATEKEEPER_LEARNING_CLOSURE_SHA256']) {
    const mismatch = factory({ readSecret: async key => key === name ? 'e'.repeat(key.endsWith('SHA256') ? 64 : 40) : values[key] });
    await fixedError(await mismatch(request()), 503, 'learning_history_unavailable');
  }
});

test('secret/transport failures and stale, oversized or redirected responses never expose data or retry', async () => {
  for (const name of Object.keys(values)) {
    let fetches = 0;
    const bridge = factory({ readSecret: async key => { if (key === name) throw new Error(marker); return values[key]; },
      fetchImpl: async () => { fetches++; throw new Error(marker); } });
    await fixedError(await bridge(request()), 503, 'learning_history_unavailable');
    assert.equal(fetches, 0);
  }
  const stale = completedResponse(); stale.checkedAt = new Date(nowMs - 60_001).toISOString();
  for (const produce of [
    () => { throw new Error(marker); },
    () => Response.json(stale),
    () => Response.json({ schema: 'gk-learning-v2-status-response', checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status }),
    () => new Response('x'.repeat(16_385), { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(marker, { headers: { 'Content-Type': 'text/html' } }),
    () => Object.defineProperty(Response.json(completedResponse()), 'redirected', { value: true }),
  ]) {
    let fetches = 0;
    const bridge = factory({ fetchImpl: async () => { fetches++; return produce(); } });
    await fixedError(await bridge(request()), 503, 'learning_history_unavailable');
    assert.equal(fetches, 1);
  }
});

test('actual hosted history adapter uses established runtime interfaces inside invocation', async () => {
  const source = readFileSync(new URL('../integrations/base44/editor/base44/functions/gatekeeperLearningHistory/entry.ts', import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { fileName: 'entry.ts', reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
  const trace = [], options = [], sdkRequests = [], fetches = [], module = { exports: {} };
  const auth = { me() { assert.equal(this, auth); trace.push('auth'); return { id: binding.ownerId, role: 'admin' }; } };
  const secrets = { get(name) { assert.equal(this, secrets); trace.push(name); return Promise.resolve(values[name]); } };
  const context = vm.createContext({ module, exports: module.exports,
    fetch(input, init) { trace.push('fetch'); fetches.push({ input, init }); return Promise.resolve(Response.json(completedResponse())); },
    require(name) {
      if (name === 'npm:@base44/sdk@0.8.54') return { createClientFromRequest(value) { sdkRequests.push(value); return { auth }; } };
      if (name === 'base44:runtime') return { secrets };
      if (name === '../../../../shared/learning-history-backend.js') return { createLearningHistoryBackend(value) {
        options.push(value); return createLearningHistoryBackend({ ...value, clock: () => new Date(nowMs) });
      } };
      throw new Error('Unexpected history adapter dependency: ' + name);
    },
  });
  new vm.Script(compiled.outputText).runInContext(context);
  assert.deepEqual(trace, []); assert.equal(options.length, 0);
  const incoming = request(); const response = await module.exports.default(incoming);
  assert.equal(response.status, 200); assert.equal(options.length, 1); assert.equal(sdkRequests[0], incoming);
  assert.deepEqual(trace, ['auth', ...Object.keys(values), 'fetch']);
  assert.equal(fetches.length, 1);
  const input = new URL('https://fixture.invalid'), init = { method: 'GET', redirect: 'error', headers: { 'X-Fixture': marker } };
  await options[0].fetchImpl(input, init);
  assert.equal(fetches[1].input, input); assert.notEqual(fetches[1].init, init);
  assert.deepEqual({ ...fetches[1].init }, { ...init, redirect: 'manual' });
  assert.equal(init.redirect, 'error');
});
