// Isolated qualification only; no hosted account, real archive or provider call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import { validateLearningHistoryBinding, projectLearningHistoryForDisplay,
  projectLearningHistoryResponse } from '../integrations/base44/shared/learning-history-contract.js';
import { projectLearningStatus } from '../integrations/base44/shared/learning-status-contract.js';
import { createLearningHistoryBackend } from '../integrations/base44/shared/learning-history-backend.js';
import { binding, nowMs, completedResponse, legacyCompletedResponse } from './base44-completed-learning-fixture.mjs';

const marker = 'synthetic-private-value-never-reflected';
const token = 'synthetic_' + 'x'.repeat(48);
const values = {
  GATEKEEPER_LEARNING_OWNER_ID: binding.ownerId,
  GATEKEEPER_LEARNING_EXPERIMENT_ID: binding.experimentId,
  GATEKEEPER_LEARNING_SOURCE_COMMIT: binding.sourceCommit,
  GATEKEEPER_LEARNING_READ_TOKEN: token,
  GATEKEEPER_LEARNING_HISTORY_SOURCE_COMMIT: binding.servingSourceCommit,
  GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT: binding.originalExecutionSourceCommit,
  GATEKEEPER_LEARNING_FINAL_EXECUTION_SOURCE_COMMIT: binding.finalExecutionSourceCommit,
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
const flush = () => new Promise(resolve => setImmediate(resolve));
function controlledDeadlines(t) {
  const timers = []; let elapsed = 0;
  t.mock.method(AbortSignal, 'timeout', milliseconds => {
    const controller = new AbortController();
    timers.push({ milliseconds, deadline: elapsed + milliseconds, controller });
    return controller.signal;
  });
  return { timers, advance(milliseconds) {
    elapsed += milliseconds;
    for (const timer of timers) if (!timer.controller.signal.aborted && timer.deadline <= elapsed)
      timer.controller.abort(new DOMException('Synthetic timeout', 'TimeoutError'));
  } };
}

test('completed public projection retains A exactly and accepts negative outcomes with unknown prices', () => {
  const original = completedResponse();
  const result = projectLearningHistoryResponse(original, binding, nowMs);
  assert.deepEqual(projectLearningHistoryForDisplay(original, binding), result);
  assert.deepEqual(result.status, projectLearningStatus(original.status, {
    ownerId: binding.ownerId, experimentId: binding.experimentId, sourceCommit: binding.sourceCommit,
  }));
  assert.equal(result.status.budget.complete, false); assert.equal(result.status.budget.unknownCostCalls, 24);
  assert.equal(result.archive.archivedAt, original.archive.archivedAt);
  assert.equal(result.serving.sourceCommit, binding.servingSourceCommit);
  assert.equal(result.archive.originalExecutionSourceCommit, binding.originalExecutionSourceCommit);
  assert.equal(result.archive.finalExecutionSourceCommit, binding.finalExecutionSourceCommit);
  assert.deepEqual(result.archive.recovery, { kind: 'original-invalid-proposal-observation', attempt: 4, additionalModelCalls: 0 });
  assert.equal(result.status.counts.invalid, 4); assert.equal(result.status.budget.observedSpentMicros, 0);
  assert.notEqual(result.archive.recovery, original.archive.recovery);
  assert.notEqual(result, original); assert.notEqual(result.status, original.status);
  assert.deepEqual(validateLearningHistoryBinding(binding), binding);
});

test('history contract refuses source/closure substitution, private fields and legacy envelopes', () => {
  for (const mutate of [
    value => { value.serving.sourceCommit = 'e'.repeat(40); },
    value => { value.archive.originalExecutionSourceCommit = 'e'.repeat(40); },
    value => { value.archive.finalExecutionSourceCommit = 'e'.repeat(40); },
    value => { value.archive.closureDigest = 'e'.repeat(64); },
    value => { value.archive.experimentSourceCommit = 'e'.repeat(40); },
    value => { value.status.sourceCommit = binding.servingSourceCommit; },
    value => { value.serving.sourceCommit = binding.originalExecutionSourceCommit; },
    value => { value.privateEvidence = marker; },
    value => { value.archive.providerSession = marker; },
    value => { value.status.privatePrompt = marker; },
  ]) {
    const value = completedResponse(); mutate(value);
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
    assert.throws(() => projectLearningHistoryForDisplay(value, binding));
  }
  assert.throws(() => projectLearningHistoryResponse({ schema: 'gk-learning-v2-status-response',
    checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status }, binding, nowMs));
  assert.throws(() => projectLearningHistoryForDisplay({ schema: 'gk-learning-v2-status-response',
    checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status }, binding));
  assert.throws(() => validateLearningHistoryBinding({ ...binding, servingSourceCommit: binding.sourceCommit }));
  let accessed = false;
  const value = completedResponse();
  Object.defineProperty(value.archive, 'closureDigest', { enumerable: true, get() { accessed = true; return binding.closureDigest; } });
  assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs)); assert.equal(accessed, false);
  assert.throws(() => projectLearningHistoryForDisplay(value, binding)); assert.equal(accessed, false);
});

test('a completed label requires all ten terminal dispositions, BASE and public closure invariants', () => {
  for (const mutate of [
    value => { value.status.counts.attempted = 9; },
    value => { value.status.counts.provisional = 1; },
    value => { value.status.counts.noCoverage--; },
    value => { value.status.counts.invalid = 3; value.status.counts.noCoverage = 4; },
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
    assert.throws(() => projectLearningHistoryForDisplay(value, binding));
  }
});

test('v2 rejects v1 and hybrid envelope shapes without a legacy execution alias', () => {
  const hybrid = completedResponse(); hybrid.archive = legacyCompletedResponse().archive;
  const extra = completedResponse(); extra.archive.executionSourceCommit = binding.originalExecutionSourceCommit;
  const nestedLegacy = completedResponse(); nestedLegacy.status.schema = 'gk-learning-v1-status';
  for (const value of [legacyCompletedResponse(), hybrid, extra, nestedLegacy]) {
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
    assert.throws(() => projectLearningHistoryForDisplay(value, binding));
  }
  const legacyBinding = { ...binding, executionSourceCommit: binding.originalExecutionSourceCommit };
  delete legacyBinding.originalExecutionSourceCommit; delete legacyBinding.finalExecutionSourceCommit;
  assert.throws(() => validateLearningHistoryBinding(legacyBinding));
});

test('every source role must remain distinct in both trusted pins and the public envelope', () => {
  const fields = ['sourceCommit', 'originalExecutionSourceCommit', 'finalExecutionSourceCommit', 'servingSourceCommit'];
  for (let left = 0; left < fields.length; left++) for (let right = left + 1; right < fields.length; right++) {
    const pins = { ...binding, [fields[right]]: binding[fields[left]] };
    assert.throws(() => validateLearningHistoryBinding(pins));
    const value = completedResponse();
    if (fields[right] === 'servingSourceCommit') value.serving.sourceCommit = binding[fields[left]];
    else value.archive[fields[right]] = binding[fields[left]];
    assert.throws(() => projectLearningHistoryForDisplay(value));
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
  }
});

test('recovery is exactly the original fourth invalid observation with zero additional calls', () => {
  for (const mutate of [
    value => { value.archive.recovery.kind = 'new-proposal'; },
    value => { value.archive.recovery.attempt = 5; },
    value => { value.archive.recovery.additionalModelCalls = 1; },
    value => { value.archive.recovery.additionalModelCalls = '0'; },
    value => { value.archive.recovery.originalTurnId = marker; },
    value => { delete value.archive.recovery; },
  ]) {
    const value = completedResponse(); mutate(value);
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
    assert.throws(() => projectLearningHistoryForDisplay(value, binding));
  }
  const value = completedResponse(); let accessed = false;
  Object.defineProperty(value.archive.recovery, 'attempt', { enumerable: true,
    get() { accessed = true; return 4; } });
  assert.throws(() => projectLearningHistoryForDisplay(value, binding)); assert.equal(accessed, false);
});

test('freshness belongs to checkedAt, while archive time stays strict and historical', () => {
  for (const age of [-5000, 0, 60_000]) {
    const value = completedResponse(); value.checkedAt = new Date(nowMs - age).toISOString();
    assert.equal(projectLearningHistoryResponse(value, binding, nowMs).archive.archivedAt, value.archive.archivedAt);
  }
  for (const age of [-5001, 60_001]) {
    const value = completedResponse(); value.checkedAt = new Date(nowMs - age).toISOString();
    assert.deepEqual(projectLearningHistoryForDisplay(value, binding), value,
      'display projection has no wall-clock freshness authority');
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
  }
  for (const archivedAt of ['2026-02-30T00:00:00.000Z', 'invalid', new Date(nowMs + 1).toISOString()]) {
    const value = completedResponse(); value.archive.archivedAt = archivedAt;
    assert.throws(() => projectLearningHistoryResponse(value, binding, nowMs));
    assert.throws(() => projectLearningHistoryForDisplay(value, binding));
  }
  assert.throws(() => projectLearningHistoryResponse(completedResponse(), binding, NaN));
  assert.throws(() => projectLearningHistoryResponse(completedResponse(), binding, null));
});

test('the server projector still uses its own clock by default without a freshness bypass', t => {
  t.mock.method(Date, 'now', () => nowMs);
  assert.deepEqual(projectLearningHistoryResponse(completedResponse(), binding), completedResponse());
  for (const age of [-5001, 60_001]) {
    const value = completedResponse(); value.checkedAt = new Date(nowMs - age).toISOString();
    assert.deepEqual(projectLearningHistoryForDisplay(value, binding), value);
    assert.throws(() => projectLearningHistoryResponse(value, binding));
  }
});

test('actual backend enforces the exact stale/future boundaries even for structurally valid display data', async () => {
  for (const [age, accepted] of [[-5001, false], [-5000, true], [0, true], [60_000, true], [60_001, false]]) {
    const value = completedResponse(); value.checkedAt = new Date(nowMs - age).toISOString();
    assert.deepEqual(projectLearningHistoryForDisplay(value, binding), value);
    let fetches = 0;
    const bridge = factory({ fetchImpl: async () => { fetches++; return Response.json(value); } });
    const response = await bridge(request());
    if (accepted) {
      assert.equal(response.status, 200); assert.deepEqual(await response.json(), value);
    } else await fixedError(response, 503, 'learning_history_unavailable');
    assert.equal(fetches, 1, 'server freshness refusal does not trigger a second fetch');
  }
});

test('authentication and configured owner precede read token and all serving/execution/closure pins', async () => {
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
    'GATEKEEPER_LEARNING_FINAL_EXECUTION_SOURCE_COMMIT', 'GATEKEEPER_LEARNING_CLOSURE_SHA256']) {
    const mismatch = factory({ readSecret: async key => key === name ? 'e'.repeat(key.endsWith('SHA256') ? 64 : 40) : values[key] });
    await fixedError(await mismatch(request()), 503, 'learning_history_unavailable');
  }
});

test('final execution pin is required after owner authentication and never repurposes the original B secret', async () => {
  const finalName = 'GATEKEEPER_LEARNING_FINAL_EXECUTION_SOURCE_COMMIT';
  for (const missingOrAliased of [undefined, binding.sourceCommit, binding.originalExecutionSourceCommit, binding.servingSourceCommit]) {
    const reads = []; let fetches = 0;
    const bridge = factory({ readSecret: async name => { reads.push(name); return name === finalName ? missingOrAliased : values[name]; },
      fetchImpl: async () => { fetches++; return Response.json(completedResponse()); } });
    await fixedError(await bridge(request()), 503, 'learning_history_unavailable');
    assert.equal(reads[0], ownerName); assert.ok(reads.includes(finalName)); assert.equal(fetches, 0);
  }
  let resolveOwner; const reads = [];
  const bridge = factory({ readSecret: name => {
    reads.push(name); return name === ownerName ? new Promise(resolve => { resolveOwner = resolve; }) : values[name];
  }, fetchImpl: async () => assert.fail('unmatched owner cannot fetch') });
  const pending = bridge(request()); await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(reads, [ownerName]); resolveOwner('another-owner');
  await fixedError(await pending, 403, 'forbidden'); assert.deepEqual(reads, [ownerName]);
  assert.equal(values.GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT, binding.originalExecutionSourceCommit);
  assert.notEqual(values.GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT, values[finalName]);
});

test('completed-history fetch may finish after 7 or 20 seconds within its separate 60-second deadline', async t => {
  const deadlines = controlledDeadlines(t);
  let resolveFetch, fetchSignal, completed = false, fetches = 0;
  const bridge = factory({ fetchImpl: (_, { signal }) => {
    fetches++; fetchSignal = signal;
    return new Promise((resolve, reject) => {
      resolveFetch = resolve;
      signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
  } });
  const pending = bridge(request()).then(value => { completed = true; return value; });
  await flush();
  assert.deepEqual(deadlines.timers.map(timer => timer.milliseconds), [7000, 60_000]);
  deadlines.advance(7000); await flush();
  assert.equal(deadlines.timers[0].controller.signal.aborted, true);
  assert.equal(fetchSignal.aborted, false); assert.equal(completed, false);
  deadlines.advance(13_000); await flush();
  assert.equal(fetchSignal.aborted, false); assert.equal(completed, false);
  deadlines.advance(39_999);
  resolveFetch(Response.json(completedResponse()));
  const response = await pending;
  assert.equal(response.status, 200); assert.deepEqual(await response.json(), completedResponse());
  assert.equal(fetchSignal.aborted, false); assert.equal(fetches, 1);
});

test('incoming empty JSON still has its own exact 7-second deadline before pins or fetch', async t => {
  const deadlines = controlledDeadlines(t), reads = [];
  let completed = false, cancelled = 0, fetches = 0;
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode('{}')); },
    cancel() { cancelled++; },
  });
  const incoming = new Request('https://fixture.invalid/function', {
    method: 'POST', body, duplex: 'half', headers: { 'Content-Type': 'application/json' },
  });
  const bridge = factory({ readSecret: async name => { reads.push(name); return values[name]; },
    fetchImpl: async () => { fetches++; return Response.json(completedResponse()); } });
  const pending = bridge(incoming).then(value => { completed = true; return value; });
  await flush();
  assert.deepEqual(deadlines.timers.map(timer => timer.milliseconds), [7000]);
  deadlines.advance(6999); await flush(); assert.equal(completed, false);
  deadlines.advance(1);
  await fixedError(await pending, 400, 'bad_request');
  assert.equal(cancelled, 1); assert.equal(fetches, 0); assert.deepEqual(reads, [ownerName]);
});

test('the same 60-second upstream deadline bounds both fetch and a stalled response body without retry', async t => {
  for (const stalledAt of ['headers', 'body']) await t.test(stalledAt, async child => {
    const deadlines = controlledDeadlines(child);
    let completed = false, fetches = 0, cancelled = 0, fetchSignal;
    const bridge = factory({ fetchImpl: (_, { signal }) => {
      fetches++; fetchSignal = signal;
      if (stalledAt === 'headers') return new Promise((_, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      });
      return Promise.resolve(new Response(new ReadableStream({
        start(controller) { controller.enqueue(new TextEncoder().encode('{"private":"' + marker)); },
        cancel() { cancelled++; },
      }), { headers: { 'Content-Type': 'application/json' } }));
    } });
    const pending = bridge(request()).then(value => { completed = true; return value; });
    await flush();
    assert.deepEqual(deadlines.timers.map(timer => timer.milliseconds), [7000, 60_000]);
    assert.equal(fetchSignal, deadlines.timers[1].controller.signal);
    deadlines.advance(59_999); await flush(); assert.equal(completed, false);
    deadlines.advance(1);
    await fixedError(await pending, 503, 'learning_history_unavailable');
    assert.equal(fetches, 1); assert.equal(fetchSignal.aborted, true);
    assert.equal(cancelled, stalledAt === 'body' ? 1 : 0);
    assert.equal(deadlines.timers.length, 2, 'reading the upstream body does not reset the deadline');
  });
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
    () => Response.json(legacyCompletedResponse()),
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
