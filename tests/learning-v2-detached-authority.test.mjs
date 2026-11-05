import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { canonical, copy, digest, procedure } from '../scripts/learning-v2/contracts.mjs';
import { MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { LearningController } from '../scripts/learning-v2/controller.mjs';
import { dispatchManagedOperation } from '../scripts/learning-v2/runtime.mjs';
import { createLearningExecutor } from '../scripts/learning-v2/executor.mjs';
import { createDetachedAuthority } from '../scripts/learning-v2/authority-core.mjs';
import { AuthorityLedger } from '../scripts/learning-v2/authority-ledger.mjs';
import { authorityCallId, initialAuthorityState, reconstructAuthorityRequest } from '../scripts/learning-v2/authority-plan.mjs';
import { freezeProductionBundle } from '../scripts/learning-v2/production-bundle.mjs';
import { authorityProviderBody } from '../scripts/learning-v2/authority-wire.mjs';
import { createAuthorityRelay } from '../scripts/learning-v2/authority-relay.mjs';
import { createAuthorityHttpServer, emitAuthorityStatus, observeAuthorityServer } from '../scripts/learning-v2/authority-service.mjs';
import { renderReview } from '../scripts/learning-v2/legacy-renderer.mjs';
import { TURN_CONFIG } from '../scripts/learning-v2/trueforge-turn.mjs';

// REMOTE QUALIFICATION SOURCE ONLY. All keys, provider observations, legacy
// histories and semantic decisions below are explicit test doubles. These tests
// make no model request and their receipts are never production pilot evidence.
const NOW = Date.UTC(2026, 10, 5, 4);
const sha = value => createHash('sha256').update(value).digest('hex');

test('protected status framing preserves exact multi-part bytes with a digest and bounded summary', () => {
  const status = { schema: 'gk-learning-authority-operator-status-v1',
    binding: { experimentId: 'TEST-ONLY-log-framing' }, activeVersionId: 'BASE', activeCallId: null,
    operations: Array.from({ length: 61 }, (_, index) => ({ operationId: 'operation-' + index,
      fixture: 'TEST-ONLY multibyte framing \u00e9'.repeat(40), actualCalls: index, actualMicros: null })), reviews: [] };
  const lines = [];
  emitAuthorityStatus(status, line => lines.push(line));
  const parse = (line, prefix) => {
    assert.ok(line.startsWith(prefix + ' ')); return JSON.parse(line.slice(prefix.length + 1));
  };
  const summary = parse(lines[0], 'GK_AUTHORITY_OPERATION_STATUS');
  const begin = parse(lines[1], 'GK_AUTHORITY_STATUS_BEGIN');
  const end = parse(lines.at(-1), 'GK_AUTHORITY_STATUS_END');
  assert.equal(summary.operations, 61);
  assert.ok(lines[0].length < 512, 'summary does not duplicate the unbounded payload');
  assert.ok(begin.parts > 1);
  assert.equal(lines.length, begin.parts + 3);
  const chunks = lines.slice(2, -1).map((line, index) => {
    const part = parse(line, 'GK_AUTHORITY_STATUS_PART');
    assert.equal(part.statusId, begin.statusId); assert.equal(part.index, index);
    const chunk = Buffer.from(part.data, 'base64');
    assert.ok(chunk.length > 0 && chunk.length <= 6000);
    return chunk;
  });
  const bytes = Buffer.concat(chunks);
  assert.equal(bytes.length, begin.bytes);
  assert.equal(sha(bytes), begin.sha256);
  assert.equal(begin.statusId, begin.sha256);
  assert.equal(summary.statusId, begin.statusId);
  assert.deepEqual(end, { statusId: begin.statusId, parts: begin.parts, sha256: begin.sha256 });
  assert.deepEqual(JSON.parse(bytes.toString('utf8')), status);
});

const corpus = JSON.parse(readFileSync(new URL('../config/learning/concurrency-atomicity-corpus-v1.json', import.meta.url)));
const candidate = () => procedure({ scope: 'concurrency-atomicity', languages: ['python'],
  applicability: 'A Python transaction reads a revision before updating the same record.',
  trigger: 'Another writer can change that revision before the update.',
  evidence: 'Trace the original read, every await, and the later write predicate.',
  action: 'Report only a reachable lost update when the write omits the original revision predicate.',
  sufficientGuard: 'An atomic compare-and-swap against that revision covers the same record.' },
 'concurrency-atomicity');

function signer() {
  const pair = generateKeyPairSync('ed25519');
  return { publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    pinnedFingerprint: sha(pair.publicKey.export({ type: 'spki', format: 'der' })),
    issue: body => ({ body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }) };
}

async function fixture() {
  const keys = Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation'].map(role => [role, signer()]));
  const trust = Object.fromEntries(Object.entries(keys).map(([role, key]) =>
    [role, { publicKeyPem: key.publicKeyPem, pinnedFingerprint: key.pinnedFingerprint }]));
  trust.budget.gatewayId = 'test-authority-gateway';
  const records = ['harmful', 'unproven'].flatMap(group => Array.from({ length: group === 'harmful' ? 35 : 18 },
    (_, index) => ({ group, index, evidenceDigest: sha('TEST-ONLY ' + group + index),
      faultType: 'concurrency-atomicity', rules: ['TEST-ONLY retained procedure ' + group + index] })));
  const legacyBank = { schema: 'gk-legacy-bank-projection-v1', path: '/data/gk3-rule-bank.json',
    fileDigest: sha('TEST-ONLY legacy bank'), bytes: 12345, revision: 65,
    counts: { accepted: 0, harmful: 35, unproven: 18, history: 0 }, records,
    authority: 'historical-observation-only; not v4 signed promotion evidence' };
  const bundle = freezeProductionBundle({ ownerId: 'test-owner', experimentId: 'detached-fixture',
    sourceCommit: 'a'.repeat(40), model: 'gk-v4-authority/glm-5-3-flash', serverVersion: '0.182.0',
    gatePolicy: { targetId: 'test-full-suite', presetDigest: sha('test preset'),
      outputProfileDigest: sha('test output'), effectiveTreeDigest: sha('test tree') },
    trust, corpus, legacyBank });
  const journal = new MemoryJournal(), artifacts = new Map();
  const artifactStore = {
    async put(value) { const id = digest(value); artifacts.set(id, copy(value)); return id; },
    async get(id) { assert.ok(artifacts.has(id)); return copy(artifacts.get(id)); },
  };
  const controls = { now: NOW, sessions: 0, dispatches: 0, providerReads: 0,
    skipRelay: false, changeSpec: false, extraTurn: false, hiddenModel: false,
    elapsedAfterFirstFinal: false, proposalText: JSON.stringify(candidate()), captureEvaluation: null,
    terminalError: false, ambiguousRelay: false, forgeObservation: false, improveCandidate: false,
    dropSettlementKind: null };
  const sessions = new Map(), turns = new Map(), events = new Map(), archives = new Map();
  let authority;
  const provider = { sessions: {
    async create(input) {
      const id = 'session-' + (++controls.sessions);
      const session = { id, agent: { type: 'inline', spec: copy(input.agent.spec) },
        metadata: copy(input.metadata), shared: false, createdBySubject: 'protected-test-authority',
        createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };
      session.agent.spec.config.sandbox.fileDownloads = true;
      sessions.set(id, session); return { data: copy(session) };
    },
    async createTurn(sessionId, input) {
      const session = sessions.get(sessionId), state = await authority.initialize();
      const op = state.operations.find(item => item.id === session.metadata.operationId);
      const slot = op.calls.find(call => call.callId === session.metadata.callId).slot;
      const outputText = op.kind === 'proposal' ? controls.proposalText :
        controls.improveCandidate && slot.arm === 'candidate' && slot.pass === 2 &&
        slot.caseId === corpus.cases[0].caseId ? JSON.stringify({ findings: [{
          line: 28, quote: '        cur.execute("SELECT balance FROM accounts WHERE id = %s", (from_id,))',
          comment: 'Concurrent transfers read the same unlocked balance and both spend it, overdrawing the wallet.',
        }] }) : '{"findings":[]}';
      if (!controls.skipRelay) {
        const claimed = await authority.claimProviderDispatch({ body: authorityProviderBody({
          sessionRequest: { agent: { spec: session.agent.spec } }, turnRequest: input }, 'tfy-managed/glm-5.3-flash'),
          requestDigest: sha('HTTP ' + sessionId) });
        controls.dispatches++;
        if (controls.ambiguousRelay) throw new Error('TEST-ONLY lost provider response after durable claim');
        await authority.finishProviderDispatch({ callId: claimed.callId,
          status: controls.terminalError ? 'failed' : 'complete',
          resultDigest: sha(outputText), httpStatus: controls.terminalError ? 500 : 200 });
      }
      const id = 'turn-' + controls.sessions;
      const output = { type: 'model.message', id: 'message-' + controls.sessions, threadId: 'main',
        model: copy(bundle.runtime.model), content: outputText, finishReason: 'stop', toolCalls: [],
        createdAt: new Date(NOW).toISOString() };
      const turn = { id, sessionId, input: copy(input.input), previousTurnId: null,
        createdAt: new Date(NOW).toISOString(), state: { status: 'done',
          completedAt: new Date(NOW).toISOString(), output, requiredActions: [],
          metrics: { totalCostInUsd: 123.456 } } };
      turns.set(sessionId, turn);
      events.set(sessionId, [{ type: 'model.message', id: output.id, threadId: 'main',
        model: copy(bundle.runtime.model), createdAt: output.createdAt }, output]);
      if (controls.terminalError) {
        turn.state = { status: 'error', completedAt: new Date(NOW).toISOString(),
          error: { code: 'test-provider-error', message: 'TEST-ONLY received provider500' },
          metrics: { totalCostInUsd: 123.456 } };
        events.set(sessionId, events.get(sessionId).slice(0, 1));
      }
      return { data: copy(turn) };
    },
    async get(sessionId) {
      controls.providerReads++;
      const session = copy(sessions.get(sessionId));
      if (controls.changeSpec) session.agent.spec.instructions = 'UNOWNED CHANGED INSTRUCTIONS';
      return { data: session };
    },
    async getTurn(sessionId) { controls.providerReads++; return { data: copy(turns.get(sessionId)) }; },
    async listTurns(sessionId) {
      const data = [copy(turns.get(sessionId))];
      if (controls.extraTurn) data.push({ ...data[0], id: 'unowned-second-turn' });
      return { response: { data, pagination: {} } };
    },
    async listTurnEvents(sessionId, _turnId, request) {
      let data = copy(events.get(sessionId));
      if (controls.hiddenModel) data.push({ ...data.at(-1), id: 'unowned-second-model-message' });
      // Two pages prove the authority exhausts pagination and treats the
      // initial/final event with one ID as one observed SDK model step.
      const first = !request.pageToken;
      return { response: { data: first ? data.slice(0, 1) : data.slice(1),
        pagination: first ? { nextPageToken: 'final-page' } : {} } };
    },
  } };
  const settings = { bundle, signers: Object.fromEntries(Object.entries(keys).map(([role, key]) => [role, key.issue])),
    journal, artifactStore, provider, upstreamModelId: 'tfy-managed/glm-5.3-flash', reviewerId: 'independent-test-reviewer',
    clock: () => controls.now,
    verifyRuntime: async () => ({ status: 'ok', serverVersion: '0.182.0' }),
    verifySourceGate: async () => ({ runId: 'test-managed-qualification', rawLogsDigest: sha('TEST-ONLY complete logs'),
      evidence: { syntheticTestDouble: true } }) };
  authority = await createDetachedAuthority(settings);
  const controller = new LearningController({ journal: new MemoryJournal(), trust, clock: () => controls.now });
  await controller.initialize(bundle.config, { history: bundle.history });
  await controller.recordManagedGate(await authority.managedGate());
  const archiveFactory = async ({ operation }) => {
    assert.equal(archives.has(operation.id), false);
    const calls = new Map(), archive = {
      async claimOperation() {},
      async claimCall(call) { assert.equal(calls.has(call.callId), false); calls.set(call.callId, { call, stages: {} }); },
      async recordCall(id, stage, payload) {
        assert.equal(Object.hasOwn(calls.get(id).stages, stage), false);
        calls.get(id).stages[stage] = copy(payload);
        if (stage === 'final' && controls.elapsedAfterFirstFinal) {
          controls.elapsedAfterFirstFinal = false; controls.now += 2 * 3_600_000;
        }
      },
      async recordArtifact() {},
      async read() { return calls; },
    };
    archives.set(operation.id, archive);
    return archive;
  };
  const client = { sessions: {
    create: (input) => authority.sdk.create(input),
    createTurn: (id, input) => authority.sdk.createTurn(id, input),
    getTurn: (id, turnId) => authority.sdk.getTurn(id, turnId),
    listTurnEvents: async (id, turnId, request) => ({ response: await authority.sdk.listTurnEvents(id, turnId, request) }),
  } };
  const authorities = Object.fromEntries(['evaluation', 'novelty'].map(role => [role, {
    ...trust[role], issue: async input => {
      if (role === 'evaluation') {
        controls.captureEvaluation = copy(input);
        if (controls.forgeObservation) input.observation.cases[0].rawTurns[0].text = '{"findings":[{"line":1}]}';
        return authority.issueEvaluation(input);
      }
      return authority.issueNovelty(input);
    },
  }]));
  const execute = createLearningExecutor({ controller, client, runtime: bundle.runtime,
    caseInputs: bundle.caseInputs, archiveFactory, authorities,
    timing: { clock: () => controls.now, pause: async () => {}, timeoutMs: 600000 } });
  const dispatch = async (kind, attemptId = null) => dispatchManagedOperation({ controller, kind, attemptId,
    operationId: 'operation-' + digest({ experimentId: bundle.config.experimentId, kind, attemptId }),
    admit: args => authority.admit(args), execute, settle: async args => {
      const receipt = await authority.settle(args);
      if (controls.dropSettlementKind === kind) {
        controls.dropSettlementKind = null;
        throw new Error('TEST-ONLY lost settlement response after host consumption');
      }
      return receipt;
    } });
  return { bundle, journal, artifactStore, settings, controls, controller, execute, dispatch, archives, sessions, turns,
    authority: () => authority, async reopen() { authority = await createDetachedAuthority(settings); return authority; },
    async baseline() { await controller.planBaseline(); return dispatch('baseline'); },
    async propose() {
      const attemptId = bundle.config.experimentId + ':attempt:1';
      const feedback = await authority.fitFeedback({ attemptId });
      await controller.beginAttempt(feedback);
      return dispatch('proposal', attemptId);
    },
    async openFirstCallForRelay() {
      await controller.planBaseline();
      const request = await controller.executionRequest('baseline', null);
      const operation = { id: 'operation-' + digest({ experimentId: bundle.config.experimentId, kind: 'baseline', attemptId: null }),
        kind: 'baseline', attemptId: null, namespace: request.namespace, requestDigest: digest(request) };
      await authority.admit({ operation, request });
      const slot = { pairId: request.plan.pairId, arm: 'base', caseId: bundle.config.cases[0].caseId, pass: 1 };
      const rendered = renderReview({ artifact: request.prompts.base, originalBase: bundle.config.baseInstructions,
        caseInput: bundle.caseInputs[0], scope: bundle.config.scope, pass: 1 });
      const sessionRequest = { agent: { spec: { model: bundle.runtime.model,
        instructions: rendered.instructions, config: copy(TURN_CONFIG) } }, metadata: {
        purpose: 'gk-learning-v2', callId: authorityCallId(operation.id, slot),
        operationId: operation.id, requestDigest: operation.requestDigest } };
      const session = await authority.sdk.create(sessionRequest);
      const turnRequest = { input: [{ type: 'user.message', content: rendered.message }], previousTurnId: 'none' };
      controls.skipRelay = true;
      await authority.sdk.createTurn(session.data.id, turnRequest);
      return authorityProviderBody({ sessionRequest, turnRequest }, 'tfy-managed/glm-5.3-flash');
    } };
}

test('independent authority scores actual fixture provider reads, exhausts pages, preserves unknown actual price', async () => {
  const f = await fixture();
  await f.baseline();
  const state = await f.controller.state();
  assert.equal(f.controls.dispatches, f.bundle.config.cases.length * 2);
  assert.ok(f.controls.providerReads > f.controls.dispatches);
  assert.equal(state.baseline.totals.caught, 0);
  assert.equal(state.baseline.totals.falseAlarms, 0);
  assert.equal(state.operations[0].actualCalls, 14);
  assert.equal(state.operations[0].actualMicros, null, 'estimated USD123.456 is never actual billing');
  const usage = await f.authority().reconcileUsage({ operationId: state.operations[0].id });
  assert.equal(usage.status, 'unknown');
  const feedback = await f.authority().fitFeedback({ attemptId: 'detached-fixture:attempt:1' });
  assert.equal(feedback.body.examples.length, 5);
  assert.ok(feedback.body.examples.every(item => !item.caseId.startsWith('t6-')));
});

test('authority rejects a caller-invented plan before any session or upstream dispatch', async () => {
  const f = await fixture();
  await f.controller.planBaseline();
  const request = await f.controller.executionRequest('baseline', null);
  request.requiredCalls++;
  const operation = { id: 'operation-' + digest({ experimentId: f.bundle.config.experimentId, kind: 'baseline', attemptId: null }),
    kind: 'baseline', attemptId: null, namespace: request.namespace, requestDigest: digest(request) };
  await assert.rejects(f.authority().admit({ operation, request }), /frozen authority plan/);
  assert.equal(f.controls.sessions, 0);
  assert.equal(f.controls.dispatches, 0);
});

test('a bounded started operation finishes its remaining exact slots after lease time elapses', async () => {
  const f = await fixture();
  f.controls.elapsedAfterFirstFinal = true;
  await f.baseline();
  assert.equal(f.controls.dispatches, 14);
  assert.equal((await f.controller.state()).operations[0].settled, true);
  assert.ok(f.controls.now > NOW + 3_600_000);
});

for (const defect of ['skipRelay', 'changeSpec', 'extraTurn', 'hiddenModel']) {
  test('independent provider verification rejects ' + defect + ' and preserves the original admitted operation', async () => {
    const f = await fixture();
    f.controls[defect] = true;
    await assert.rejects(f.baseline(), /MANAGED_OPERATION_UNRESOLVED/);
    const state = await f.authority().initialize();
    assert.equal(state.operations.length, 1);
    assert.equal(state.operations[0].settlement, null);
    assert.equal(state.baseline, null);
    assert.ok(state.operations[0].calls.length <= 1);
  });
}

test('paid proposal durably pauses for protected semantic review and resumes same artifacts with zero new inference', async () => {
  const f = await fixture();
  await f.baseline();
  await assert.rejects(f.propose(), /MANAGED_OPERATION_UNRESOLVED/);
  const opId = 'operation-' + digest({ experimentId: 'detached-fixture', kind: 'proposal',
    attemptId: 'detached-fixture:attempt:1' });
  const before = f.controls.dispatches;
  const packet = await f.authority().reviewPacket(opId);
  assert.equal(packet.context.priorReferences.length, 53);
  assert.equal(packet.context.expected.historyDigest, digest(packet.context.priorReferences));
  await f.reopen();
  await assert.rejects(f.authority().noveltyDecision({ operationId: opId }),
    error => error.code === 'GK_AUTHORITY_REVIEW_PENDING' && error.reviewId === packet.reviewId);
  const decision = { schema: 'gk-learning-authority-review-v1', reviewId: packet.reviewId,
    contextDigest: packet.contextDigest, reviewer: { id: 'independent-test-reviewer',
      evidenceRef: 'test-only independent semantic comparison' }, verdict: 'uncertain',
    comparisons: packet.context.priorReferences.map(item => ({ priorId: item.id, relation: 'uncertain',
      reason: 'Test reviewer intentionally leaves semantic equivalence unresolved.' })),
    coverageCaseIds: [corpus.cases[0].caseId],
    coverageReasons: [{ caseId: corpus.cases[0].caseId, reason: 'Test-only applicability observation.' }] };
  const altered = copy(decision); altered.contextDigest = 'f'.repeat(64);
  await assert.rejects(f.authority().applyProtectedReview(altered), /another proposal/);
  const omission = copy(decision); omission.comparisons.pop();
  await assert.rejects(f.authority().applyProtectedReview(omission), /complete retained history/);
  const envelope = await f.authority().applyProtectedReview(decision);
  const hostState = await f.controller.state();
  const operation = hostState.operations.find(item => item.id === opId);
  await f.controller.recordProposal(operation.attemptId, candidate(), envelope);
  await f.controller.settleOperation(opId, await f.authority().settle({ operationId: opId,
    leaseId: operation.leaseId, requestDigest: operation.requestDigest }));
  assert.equal(f.controls.dispatches, before);
  assert.equal((await f.controller.state()).attempts[0].status, 'unresolved');
  assert.equal((await f.authority().initialize()).attempts[0].status, 'unresolved');
  const next = 'detached-fixture:attempt:2';
  const feedback = await f.authority().fitFeedback({ attemptId: next });
  await f.controller.beginAttempt(feedback);
  const state = await f.authority().initialize();
  const reconstructed = reconstructAuthorityRequest(f.bundle, state, 'proposal', next);
  assert.equal(digest(reconstructed.request), digest(await f.controller.executionRequest('proposal', next)));
  assert.equal(reconstructed.request.learner.fitExamples.some(item => item.caseId.startsWith('t6-')), false);
  const conflict = copy(decision); conflict.verdict = 'novel';
  await assert.rejects(f.authority().applyProtectedReview(conflict), /overwrite/);
});

test('positive source fixture aligns screen, three alternating fresh pairs, confirmed digest, activation renewal and next incumbent', async () => {
  const f = await fixture();
  await f.baseline();
  await assert.rejects(f.propose(), /MANAGED_OPERATION_UNRESOLVED/);
  const attemptId = 'detached-fixture:attempt:1';
  const proposalOp = (await f.controller.state()).operations.find(item => item.kind === 'proposal');
  const packet = await f.authority().reviewPacket(proposalOp.id);
  const novelty = await f.authority().applyProtectedReview({
    schema: 'gk-learning-authority-review-v1', reviewId: packet.reviewId, contextDigest: packet.contextDigest,
    reviewer: { id: 'independent-test-reviewer', evidenceRef: 'TEST-ONLY positive semantic-review fixture' },
    verdict: 'novel', comparisons: packet.context.priorReferences.map(item => ({
      priorId: item.id, relation: 'distinct', reason: 'TEST-ONLY explicit semantic decision for scheduler coverage.' })),
    coverageCaseIds: [corpus.cases[0].caseId],
    coverageReasons: [{ caseId: corpus.cases[0].caseId, reason: 'TEST-ONLY frozen applicability fixture.' }],
  });
  await f.controller.recordProposal(attemptId, candidate(), novelty);
  await f.controller.settleOperation(proposalOp.id, await f.authority().settle({ operationId: proposalOp.id,
    leaseId: proposalOp.leaseId, requestDigest: proposalOp.requestDigest }));
  f.controls.improveCandidate = true;
  await f.controller.planScreen(attemptId);
  await f.dispatch('screen', attemptId);
  assert.equal((await f.controller.state()).attempts[0].status, 'provisional');
  await f.controller.planConfirmation(attemptId);
  await f.dispatch('confirmation', attemptId);
  const hostState = await f.controller.state(), authorityState = await f.authority().initialize();
  assert.equal(hostState.attempts[0].status, 'confirmed');
  assert.equal(authorityState.attempts[0].status, 'confirmed');
  assert.deepEqual(hostState.attempts[0].confirmation.map(item => item.order), [
    ['incumbent', 'candidate'], ['candidate', 'incumbent'], ['incumbent', 'candidate'],
  ]);
  const target = hostState.versions.find(item => item.origin === attemptId);
  assert.ok(target);
  assert.equal(authorityState.versions.find(item => item.id === target.id).evidenceDigest, target.evidenceDigest);
  assert.equal(f.controls.dispatches, 14 + 1 + 15 + 84);
  const original = await f.authority().activation({ versionId: target.id, action: 'activate' });
  assert.deepEqual(await f.authority().activation({ versionId: target.id, action: 'activate' }), original,
    'timely replay preserves original signed bytes');
  // Simulate a lost authorization response; the host is still on the original
  // incumbent when the exact authorization is requested after expiry.
  f.controls.now += 2 * 3_600_000;
  await f.reopen();
  const renewed = await f.authority().activation({ versionId: target.id, action: 'activate' });
  assert.notEqual(renewed.body.receiptId, original.body.receiptId);
  for (const field of ['versionId', 'incumbentVersionId', 'evidenceDigest', 'sourceCommit', 'configDigest', 'action']) {
    assert.equal(renewed.body[field], original.body[field]);
  }
  await f.controller.activateVersion(target.id, renewed);
  assert.equal((await f.controller.state()).activeVersionId, (await f.authority().initialize()).activeVersionId);
  await assert.rejects(f.controller.activateVersion(target.id, renewed), /different version/);
  assert.equal(f.controls.dispatches, 114, 'activation and expiry recovery never infer again');
  const next = 'detached-fixture:attempt:2';
  await f.controller.beginAttempt(await f.authority().fitFeedback({ attemptId: next }));
  const reconstructed = reconstructAuthorityRequest(f.bundle, await f.authority().initialize(), 'proposal', next);
  assert.equal(digest(reconstructed.request), digest(await f.controller.executionRequest('proposal', next)));
  assert.equal(reconstructed.request.incumbentVersionId, target.id);
  const history = (await f.authority().initialize()).activationHistory[0];
  assert.equal(JSON.parse(history.envelope).body.receiptId, original.body.receiptId);
  assert.equal(history.renewals.length, 1);
});

test('compact durable ledger reopens the exact protected state and rejects another frozen binding', async () => {
  const f = await fixture();
  await f.baseline();
  const before = await f.authority().initialize();
  await f.reopen();
  assert.equal(canonical(await f.authority().initialize()), canonical(before));
  const other = new AuthorityLedger({ journal: f.journal,
    binding: { ...f.bundle.binding, experimentId: 'another-experiment' },
    initial: initialAuthorityState(f.bundle) });
  await assert.rejects(other.initialize(), /binding drift/);
});

test('a caller-provided successful observation cannot replace independently retrieved provider output', async () => {
  const f = await fixture();
  f.controls.forgeObservation = true;
  await assert.rejects(f.baseline(), /MANAGED_OPERATION_UNRESOLVED/);
  assert.equal((await f.authority().initialize()).baseline, null);
  assert.equal(f.controls.dispatches, 14, 'already paid fixture calls remain retained');
});

test('protected accounting recovery settles a definitively terminal received provider500 without rerunning it', async () => {
  const f = await fixture();
  f.controls.terminalError = true;
  await assert.rejects(f.baseline(), /MANAGED_OPERATION_UNRESOLVED/);
  const held = (await f.controller.state()).operations[0];
  const input = { schema: 'gk-learning-authority-reconciliation-v1', mode: 'failed-execution', operationId: held.id,
    leaseId: held.leaseId, requestDigest: held.requestDigest,
    reason: 'TEST-ONLY operator observed terminal provider500 and retained failed source evidence.' };
  const recovery = await f.authority().applyProtectedReconciliation(input);
  assert.equal(recovery.settlementEnvelope.body.actualCalls, 1);
  assert.equal(recovery.settlementEnvelope.body.actualMicros, null);
  await f.controller.abandonOperation(held.id, input.reason);
  await f.controller.settleOperation(held.id, recovery.settlementEnvelope);
  await f.reopen();
  assert.deepEqual(await f.authority().applyProtectedReconciliation(input), recovery);
  assert.equal(f.controls.dispatches, 1);
  assert.equal((await f.controller.state()).operations[0].settled, true);
  assert.equal((await f.authority().initialize()).baseline, null);
});

test('known zero-dispatch admission can be explicitly accounted, with no SDK or provider request', async () => {
  const f = await fixture();
  await f.controller.planBaseline();
  const request = await f.controller.executionRequest('baseline', null);
  const operation = { id: 'operation-' + digest({ experimentId: 'detached-fixture', kind: 'baseline', attemptId: null }),
    kind: 'baseline', attemptId: null, namespace: request.namespace, requestDigest: digest(request) };
  const lease = await f.authority().admit({ operation, request });
  const recovery = await f.authority().applyProtectedReconciliation({
    schema: 'gk-learning-authority-reconciliation-v1', mode: 'failed-execution', operationId: operation.id,
    leaseId: lease.body.receiptId, requestDigest: operation.requestDigest,
    reason: 'TEST-ONLY lost admission response; protected ledger proves no dispatch intent exists.' });
  await f.controller.reconcileAdmission(operation, recovery.admissionEnvelope, recovery.settlementEnvelope, recovery.reason);
  assert.equal(recovery.settlementEnvelope.body.actualCalls, 0);
  assert.equal(recovery.settlementEnvelope.body.actualMicros, 0);
  assert.equal(f.controls.sessions, 0); assert.equal(f.controls.dispatches, 0);
});

test('invalid paid proposal recovers its lost retained settlement without changing disposition or inferring again', async () => {
  const f = await fixture();
  await f.baseline();
  f.controls.proposalText = 'TEST-ONLY nonempty but invalid structured procedure';
  f.controls.dropSettlementKind = 'proposal';
  await assert.rejects(f.propose(), /lost settlement response/);
  const hostState = await f.controller.state();
  const held = hostState.operations.find(item => item.kind === 'proposal');
  assert.equal(held.consumed, true); assert.equal(held.settled, false);
  assert.equal(hostState.attempts[0].status, 'invalid');
  const original = (await f.authority().initialize()).operations.find(item => item.id === held.id).settlement;
  await f.reopen();
  const recovery = await f.authority().applyProtectedReconciliation({
    schema: 'gk-learning-authority-reconciliation-v1', mode: 'settlement-only',
    operationId: held.id, leaseId: held.leaseId, requestDigest: held.requestDigest,
    reason: 'TEST-ONLY host consumed invalid proposal; only the original settlement response was lost.' });
  assert.equal(JSON.stringify(recovery.settlementEnvelope), original);
  assert.equal(recovery.mode, 'settlement-only');
  await f.controller.settleOperation(held.id, recovery.settlementEnvelope);
  assert.equal((await f.controller.state()).attempts[0].status, 'invalid');
  assert.equal((await f.authority().initialize()).attempts[0].status, 'invalid');
  assert.equal(f.controls.dispatches, 15);
});

test('a claimed but unobserved provider response remains unresolved after restart and cannot be repeated or zeroed', async () => {
  const f = await fixture();
  f.controls.ambiguousRelay = true;
  await assert.rejects(f.baseline(), /MANAGED_OPERATION_UNRESOLVED/);
  await f.reopen();
  const state = await f.authority().initialize(), held = state.operations[0];
  assert.equal(held.calls[0].relay.status, 'claimed');
  await assert.rejects(f.authority().applyProtectedReconciliation({
    schema: 'gk-learning-authority-reconciliation-v1', mode: 'failed-execution', operationId: held.id,
    leaseId: held.leaseId, requestDigest: held.requestDigest, reason: 'TEST-ONLY cannot prove transport result.' }));
  await assert.rejects(f.authority().claimProviderDispatch({ body: authorityProviderBody(
    await f.artifactStore.get(held.calls[0].intentDigest), 'tfy-managed/glm-5.3-flash'),
    requestDigest: sha('attempted retry') }), /repeated or unowned/);
  assert.equal(f.controls.dispatches, 1);
  assert.equal((await f.authority().initialize()).operations[0].settlement, null);
});

async function loopback(t, server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => { server.removeListener('error', reject); resolve(); });
  });
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return 'http://127.0.0.1:' + server.address().port;
}

test('real relay HTTP enforces authentication, exact owned system/user/model body and one upstream POST', async t => {
  const f = await fixture(), body = await f.openFirstCallForRelay();
  const prefix = 'a'.repeat(64), token = 'TEST-ONLY-provider-token-not-a-real-credential';
  let forwarded = 0;
  const relay = createAuthorityRelay({ authority: f.authority(), prefix, providerToken: token,
    upstreamModelId: 'tfy-managed/glm-5.3-flash', fetcher: async (url, options) => {
      assert.equal(url, 'https://stranger-builds.truefoundry.cloud/api/llm/chat/completions');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer ' + token);
      assert.deepEqual(JSON.parse(options.body), body);
      forwarded++;
      return new Response('data: {"text":"café"}\r\ndata: [DONE]\n', {
        status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    } });
  const origin = await loopback(t, relay), url = origin + '/' + prefix + '/api/llm/chat/completions';
  const post = (payload, authorization = 'Bearer ' + token) => fetch(url, { method: 'POST',
    headers: { Authorization: authorization, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
  assert.equal((await post(body, 'Bearer WRONG')).status, 404);
  for (const alter of [
    value => { value.messages[1].content += '\nUNRELATED paid task'; },
    value => { value.messages[0].content = 'Unowned system instructions'; },
    value => { value.temperature = 0.9; },
    value => { value.tools[0].function.name = 'unowned_paid_tool'; },
    value => { value.model = 'tfy-managed/unowned-model'; },
  ]) {
    const wrong = copy(body); alter(wrong);
    const denied = await post(wrong); await denied.text();
    assert.equal(denied.status, 409);
    assert.equal(forwarded, 0);
  }
  const admitted = await post(body);
  assert.equal(admitted.status, 200);
  assert.equal(await admitted.text(), 'data: {"text":"café"}\n\ndata: [DONE]\n\n');
  const repeated = await post(body); await repeated.text();
  assert.equal(repeated.status, 409);
  assert.equal(forwarded, 1);
  const record = (await f.authority().initialize()).operations[0].calls[0].relay;
  assert.equal(record.status, 'complete');
  assert.equal(record.httpStatus, 200);
  assert.equal(typeof record.requestArtifactDigest, 'string');
});

test('real relay HTTP retains an ambiguous pre-response claim and never retries upstream', async t => {
  const f = await fixture(), body = await f.openFirstCallForRelay();
  let forwarded = 0;
  const prefix = 'b'.repeat(64), token = 'TEST-ONLY-provider-token-no-real-inference';
  const relay = createAuthorityRelay({ authority: f.authority(), prefix, providerToken: token,
    upstreamModelId: 'tfy-managed/glm-5.3-flash', fetcher: async () => {
      forwarded++; throw new Error('TEST-ONLY response lost after dispatch boundary');
    } });
  const origin = await loopback(t, relay);
  const send = () => fetch(origin + '/' + prefix + '/api/llm/chat/completions', {
    method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body) });
  const first = await send(); await first.text(); assert.equal(first.status, 502);
  await f.reopen();
  const second = await send(); await second.text(); assert.equal(second.status, 409);
  assert.equal(forwarded, 1);
  assert.equal((await f.authority().initialize()).operations[0].calls[0].relay.status, 'claimed');
});

test('public authority HTTP denies anonymous reads and protected decision/relay/key methods', async t => {
  const f = await fixture(), token = 'TEST-ONLY-driver-token-at-least-thirty-two-bytes';
  const server = createAuthorityHttpServer({ authority: f.authority(), token, binding: f.bundle.binding });
  const origin = await loopback(t, server);
  assert.equal((await fetch(origin + '/v1/gatekeeper/bootstrap')).status, 401);
  const bootstrap = await fetch(origin + '/v1/gatekeeper/bootstrap', { headers: { Authorization: 'Bearer ' + token } });
  assert.equal(bootstrap.status, 200);
  assert.equal((await bootstrap.json()).binding.configDigest, f.bundle.binding.configDigest);
  for (const method of ['applyProtectedReview', 'applyProtectedReconciliation', 'claimProviderDispatch', 'sign', 'keys']) {
    const response = await fetch(origin + '/v1/gatekeeper/authority', { method: 'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ binding: f.bundle.binding, method, args: {} }) });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, 'GK_AUTHORITY_REFUSED');
  }
  assert.equal(f.controls.dispatches, 0);
});

test('installed server version is read from health and an intended-but-different version fails before inference', async () => {
  const input = { baseUrl: 'http://trueforge.railway.internal:8080', token: 'TEST-ONLY-token', expectedVersion: '0.182.0' };
  const valid = await observeAuthorityServer({ ...input, fetcher: async (url, options) => {
    assert.equal(url, 'http://trueforge.railway.internal:8080/healthz');
    assert.equal(options.redirect, 'error');
    return Response.json({ status: 'ok', version: '0.182.0' });
  } });
  assert.equal(valid.serverVersion, '0.182.0');
  await assert.rejects(observeAuthorityServer({ ...input,
    fetcher: async () => Response.json({ status: 'ok', version: '0.180.0' }) }), /version mismatch/);
});
