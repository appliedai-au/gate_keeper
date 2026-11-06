import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, copy, digest, procedure } from '../scripts/learning-v2/contracts.mjs';
import { TURN_CONFIG, turnInputDigest } from '../scripts/learning-v2/trueforge-turn.mjs';
import { prepareOriginalProposalRecovery, retainOriginalProposalPreparation }
  from '../scripts/learning-v2/original-proposal-recovery.mjs';

// Synthetic fixtures only. No credentials, live sessions or provider writes.
const candidate = () => procedure({ scope: 'concurrency-atomicity', languages: ['javascript'],
  applicability: 'TEST-ONLY shared mutable counter', trigger: 'TEST-ONLY read then write across await',
  evidence: 'TEST-ONLY two concurrent requests observe the same old value',
  action: 'TEST-ONLY report the unprotected read-modify-write',
  sufficientGuard: 'TEST-ONLY one atomic database statement' }, 'concurrency-atomicity');

function fixture(outputText = 'This is not a structured procedure.') {
  const binding = { ownerId: 'owner-TEST-ONLY', experimentId: 'recovery-TEST-ONLY',
    sourceCommit: 'a'.repeat(40), configDigest: 'b'.repeat(64) };
  const runtime = { schema: 'TEST-ONLY-runtime', model: {
    name: 'TEST-ONLY/model', params: { maxTokens: 1000, temperature: 0 } } };
  const learner = { instructions: 'TEST-ONLY original proposal instructions', scope: 'concurrency-atomicity',
    baselineInstructions: 'TEST-ONLY original baseline', confirmedProcedures: [], retainedProcedures: [], fitExamples: [] };
  const request = { schema: 'gk-learning-v2-execution-request', kind: 'proposal', requiredCalls: 1,
    experimentId: binding.experimentId, sourceCommit: binding.sourceCommit, configDigest: binding.configDigest,
    runtimeDigest: digest(runtime), model: runtime.model.name, provider: 'truefoundry', memory: 'off',
    namespace: 'namespace-TEST-ONLY', attemptId: 'attempt-TEST-ONLY-4', learner };
  const operation = { id: 'operation-TEST-ONLY-4', kind: 'proposal', attemptId: request.attemptId,
    namespace: request.namespace, requestDigest: digest(request), leaseId: 'lease-TEST-ONLY-4', maxCalls: 1,
    reservationMicros: 0, settled: false, consumed: false, observedFreshCalls: 0, evidenceComplete: false };
  const { instructions, ...visible } = learner;
  const call = { callId: `call-${digest({ operationId: operation.id, slot: { kind: 'proposal' } })}`,
    operationId: operation.id, leaseId: operation.leaseId, requestDigest: operation.requestDigest,
    sourceCommit: binding.sourceCommit, runtimeDigest: digest(runtime), model: runtime.model,
    instructions, message: canonical(visible) };
  const entry = { callId: call.callId, sessionId: 'session-TEST-ONLY-4', turnId: 'turn-TEST-ONLY-4',
    inputDigest: turnInputDigest(call), createdBySubject: 'subject-TEST-ONLY',
    sessionRequest: { agent: { spec: { model: runtime.model, instructions, config: copy(TURN_CONFIG) } },
      metadata: { purpose: 'gk-learning-v2', callId: call.callId, operationId: operation.id,
        requestDigest: operation.requestDigest } },
    turnRequest: { input: [{ type: 'user.message', content: call.message }], previousTurnId: 'none' } };
  const session = { id: entry.sessionId, shared: false, createdBySubject: entry.createdBySubject,
    agent: { type: 'inline', spec: copy(entry.sessionRequest.agent.spec) }, metadata: copy(entry.sessionRequest.metadata) };
  const message = { type: 'model.message', id: 'message-TEST-ONLY', threadId: 'main', model: copy(runtime.model),
    content: outputText, finishReason: 'stop', toolCalls: [] };
  const turn = { id: entry.turnId, sessionId: entry.sessionId, previousTurnId: null,
    input: copy(entry.turnRequest.input), state: { status: 'done', output: copy(message), requiredActions: [] } };
  const initial = { ...copy(turn), state: { status: 'running' } };
  const failure = { code: 'TRUEFORGE_CALL_UNRESOLVED', name: 'Error', stage: 'turn-read', callId: call.callId,
    operationId: operation.id, inputDigest: entry.inputDigest, sessionId: entry.sessionId, turnId: entry.turnId,
    raw: { input: { model: runtime.model, instructions, config: copy(TURN_CONFIG),
      messages: copy(entry.turnRequest.input), previousTurnId: 'none' }, session: copy(session),
      turns: [copy(initial)], eventPages: [], events: [], eventsComplete: false, outcome: 'unresolved' } };
  const checkpoint = { controllerHead: 'c'.repeat(64), dispatchHead: 'd'.repeat(64), archiveHead: 'e'.repeat(64),
    archive: { operation, request, calls: [{ call, stages: [
      { stage: 'session', payload: { inputDigest: entry.inputDigest, sessionId: entry.sessionId,
        request: copy(entry.sessionRequest), response: copy(session) } },
      { stage: 'turn', payload: { inputDigest: entry.inputDigest, sessionId: entry.sessionId, turnId: entry.turnId,
        request: copy(entry.turnRequest), response: copy(initial) } },
      { stage: 'failure', payload: failure } ] }], artifacts: [] } };
  const expected = { binding, checkpointDigest: digest(checkpoint), runtime, history: [],
    historyDigest: digest([]), ownedEntry: copy(entry) };
  const reads = { original: 0, get: 0, getTurn: 0, listTurns: [], listTurnEvents: [], writes: 0 };
  const pages = { turns: [{ data: [{ id: entry.turnId }], pagination: {} }],
    events: [{ data: [{ type: message.type, id: message.id, threadId: 'main' }],
      pagination: { nextPageToken: 'page-TEST-ONLY-2' } }, { data: [copy(message)], pagination: {} }] };
  const controls = { changeSecondRead: false, getFailure: false, duringRead: null };
  const rejectWrite = async () => { reads.writes++; throw new Error('TEST-ONLY provider mutation forbidden'); };
  const provider = { sessions: {
    create: rejectWrite, createTurn: rejectWrite, update: rejectWrite, delete: rejectWrite,
    async get(id, options) {
      assert.equal(id, entry.sessionId); assert.equal(options.maxRetries, 0); reads.get++;
      if (controls.duringRead) controls.duringRead();
      if (controls.getFailure) throw new Error('TEST-ONLY read interruption');
      return { data: copy(session) };
    },
    async getTurn(sessionId, turnId, options) {
      assert.equal(sessionId, entry.sessionId); assert.equal(turnId, entry.turnId); assert.equal(options.maxRetries, 0);
      reads.getTurn++;
      const value = copy(turn);
      if (controls.changeSecondRead && reads.getTurn === 2) value.state.output.content += ' changed';
      return { data: value };
    },
    async listTurns(id, input, options) {
      assert.equal(id, entry.sessionId); assert.equal(input.limit, 25); assert.equal(options.maxRetries, 0);
      reads.listTurns.push(copy(input));
      return { response: copy(pages.turns[reads.listTurns.length - 1]) };
    },
    async listTurnEvents(sessionId, turnId, input, options) {
      assert.equal(sessionId, entry.sessionId); assert.equal(turnId, entry.turnId);
      assert.equal(input.limit, 100); assert.equal(options.maxRetries, 0);
      reads.listTurnEvents.push(copy(input));
      return { response: copy(pages.events[reads.listTurnEvents.length - 1]) };
    },
  } };
  const readOriginal = async () => { reads.original++; return copy(checkpoint); };
  return { checkpoint, expected, entry, session, turn, pages, reads, controls, provider, readOriginal,
    repin() { expected.checkpointDigest = digest(checkpoint); },
    async prepare() { return prepareOriginalProposalRecovery({ readOriginal, provider, expected }); } };
}

function journal({ loseAcknowledgement = false } = {}) {
  const state = { head: null, events: [] }; let appends = 0;
  return { state, get appends() { return appends; }, async read() { return copy(state); },
    async append(previous, value) {
      assert.equal(previous, state.head, 'TEST-ONLY actual CAS mismatch');
      state.events.push(copy(value)); state.head = digest(state.events); appends++;
      if (loseAcknowledgement) { loseAcknowledgement = false; throw new Error('TEST-ONLY lost acknowledgement'); }
    } };
}

test('recovers the original terminal observation using only reads and leaves every original byte unchanged', async () => {
  const f = fixture(); const before = canonical(f.checkpoint);
  const result = await f.prepare();
  assert.equal(result.preparation.classification.kind, 'invalid');
  assert.equal(result.preparation.observed.complete, true);
  assert.equal(result.preparation.observed.observedModelCalls, 1);
  assert.equal(result.preparation.status, 'prepared-not-consumed');
  assert.equal(result.preparation.authorityReceipt, false);
  assert.equal(result.preparation.actualMicros, null);
  assert.equal(result.preparation.providerMutations, 0);
  assert.equal(result.preparation.originalJournalWrites, 0);
  assert.equal(result.preparationDigest, digest(result.preparation));
  assert.equal(canonical(f.checkpoint), before);
  assert.equal(f.reads.writes, 0); assert.equal(f.reads.original, 2); assert.equal(f.reads.getTurn, 2);
  assert.deepEqual(f.reads.listTurnEvents, [{ order: 'asc', limit: 100 },
    { order: 'asc', limit: 100, pageToken: 'page-TEST-ONLY-2' }]);
});

test('valid unique output remains subject to independent semantic review and is never called novel', async () => {
  const f = fixture('```json\n' + JSON.stringify(candidate()) + '\n```');
  const prepared = (await f.prepare()).preparation;
  assert.equal(prepared.classification.kind, 'independent-review-required');
  assert.deepEqual(prepared.classification.candidate, candidate());
  assert.equal(prepared.authorityReceipt, false); assert.equal(f.reads.writes, 0);
});

test('an exact normalized rejected rule is identified without retry or replacement', async () => {
  const f = fixture(JSON.stringify(candidate()));
  f.expected.history = [{ id: 'prior-TEST-ONLY', procedure: candidate(), outcome: 'rejected', sourceRef: 'TEST-ONLY' }];
  f.expected.historyDigest = digest(f.expected.history);
  const prepared = (await f.prepare()).preparation;
  assert.equal(prepared.classification.kind, 'exact-duplicate');
  assert.deepEqual(prepared.classification.duplicateIds, ['prior-TEST-ONLY']);
  assert.equal(f.reads.writes, 0);
});

for (const [label, alter] of [
  ['checkpoint head drift', f => { f.checkpoint.dispatchHead = 'f'.repeat(64); }],
  ['authority session substitution', f => { f.expected.ownedEntry.sessionId = 'session-OTHER'; }],
  ['original request substitution', f => { f.checkpoint.archive.request.learner.instructions += ' changed'; f.repin(); }],
  ['second original call', f => { f.checkpoint.archive.calls.push(copy(f.checkpoint.archive.calls[0])); f.repin(); }],
  ['ambiguous final archive write', f => { f.checkpoint.archive.calls[0].stages[2].payload.stage = 'final-archive'; f.repin(); }],
  ['ambiguous create-turn write', f => { f.checkpoint.archive.calls[0].stages[2].payload.stage = 'turn-request'; f.repin(); }],
  ['existing final disposition', f => { f.checkpoint.archive.artifacts.push({ id: 'prior-result' }); f.repin(); }],
  ['already consumed operation', f => { f.checkpoint.archive.operation.consumed = true; f.repin(); }],
  ['changed history pin', f => { f.expected.historyDigest = 'f'.repeat(64); }],
  ['changed authority input', f => { f.expected.ownedEntry.turnRequest.input[0].content += ' changed'; }],
  ['failure identity mismatch', f => { f.checkpoint.archive.calls[0].stages[2].payload.turnId = 'turn-OTHER'; f.repin(); }],
]) test(`refuses ${label} before any provider read`, async () => {
  const f = fixture(); alter(f); const before = canonical(f.checkpoint);
  await assert.rejects(f.prepare());
  assert.equal(f.reads.get, 0); assert.equal(f.reads.writes, 0);
  assert.equal(canonical(f.checkpoint), before);
});

for (const [label, alter] of [
  ['nonterminal provider turn', f => { f.turn.state.status = 'running'; }],
  ['different session owner', f => { f.session.createdBySubject = 'subject-OTHER'; }],
  ['different provider model', f => { f.session.agent.spec.model.name = 'OTHER/model'; }],
  ['different provider input', f => { f.turn.input[0].content += ' changed'; }],
  ['extra owned-session turn', f => { f.pages.turns[0].data.push({ id: 'turn-OTHER' }); }],
  ['extra inference event', f => { f.pages.events[1].data.push({ ...copy(f.turn.state.output), id: 'message-OTHER' }); }],
  ['missing final event', f => { f.pages.events[1].data = []; }],
  ['unexpected tool use', f => { f.pages.events[1].data.push({ type: 'tool.call', id: 'tool-TEST-ONLY' }); }],
  ['truncated original output', f => { f.turn.state.output.finishReason = 'length'; }],
  ['terminal output changing during inspection', f => { f.controls.changeSecondRead = true; }],
]) test(`holds ${label} without declaring invalid or issuing a replacement`, async () => {
  const f = fixture(); alter(f); const before = canonical(f.checkpoint);
  await assert.rejects(f.prepare());
  assert.equal(f.reads.writes, 0); assert.equal(canonical(f.checkpoint), before);
});

test('a provider read error is not retried automatically', async () => {
  const f = fixture(); f.controls.getFailure = true;
  await assert.rejects(f.prepare(), /TEST-ONLY read interruption/);
  assert.equal(f.reads.get, 1); assert.equal(f.reads.writes, 0);
});

test('a changing original checkpoint rejects the result after complete provider verification', async () => {
  const f = fixture(); f.controls.duringRead = () => { f.checkpoint.controllerHead = 'f'.repeat(64); };
  await assert.rejects(f.prepare(), /original proposal checkpoint changed/);
  assert.equal(f.reads.getTurn, 2); assert.equal(f.reads.writes, 0);
});

test('mutating caller-owned expectations across awaits cannot substitute the authority input', async () => {
  const f = fixture(); f.controls.duringRead = () => { f.expected.ownedEntry.turnId = 'turn-OTHER'; };
  const result = await f.prepare();
  assert.equal(result.preparation.observed.turnId, f.entry.turnId);
  assert.equal(f.reads.writes, 0);
});

test('separate preparation journal publishes once and explicit reentry reads the same observation', async () => {
  const f = fixture(), prepared = await f.prepare(), store = journal();
  const args = { journal: store, prepared, expectedDigest: prepared.preparationDigest };
  assert.equal((await retainOriginalProposalPreparation(args)).appended, true);
  assert.equal((await retainOriginalProposalPreparation(args)).appended, false);
  assert.equal(store.appends, 1); assert.equal(f.reads.writes, 0);
});

test('a lost sidecar acknowledgement is inspected on explicit reentry without a second append', async () => {
  const f = fixture(), prepared = await f.prepare(), store = journal({ loseAcknowledgement: true });
  const args = { journal: store, prepared, expectedDigest: prepared.preparationDigest };
  await assert.rejects(retainOriginalProposalPreparation(args), /lost acknowledgement/);
  assert.equal(store.appends, 1);
  assert.equal((await retainOriginalProposalPreparation(args)).appended, false);
  assert.equal(store.appends, 1);
});

test('retained preparation rejects substitution and refuses an occupied non-recovery journal', async () => {
  const prepared = await fixture().prepare(), store = journal();
  const args = { journal: store, prepared, expectedDigest: prepared.preparationDigest };
  await retainOriginalProposalPreparation(args);
  const changed = copy(prepared); changed.preparation.observed.text += ' forged';
  await assert.rejects(retainOriginalProposalPreparation({ ...args, prepared: changed }));
  assert.equal(store.appends, 1);
  const other = journal(); await other.append(null, { schema: 'original-controller-record' });
  await assert.rejects(retainOriginalProposalPreparation({ ...args, journal: other }));
  assert.equal(other.appends, 1);
});
