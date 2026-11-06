import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { MemoryJournal, FileJournal } from '../scripts/learning-v2/journal.mjs';
import { OperationArchive } from '../scripts/learning-v2/operation-archive.mjs';
import { freezeProductionBundle } from '../scripts/learning-v2/production-bundle.mjs';
import { createDetachedAuthority } from '../scripts/learning-v2/authority-core.mjs';
import { authorityProviderBody } from '../scripts/learning-v2/authority-wire.mjs';
import { initializeLearningHost, openLearningHost } from '../scripts/learning-v2/host.mjs';
import { createReadOnlyLearningStatusReader } from '../scripts/learning-v2/status-reader.mjs';
import { TURN_CONFIG } from '../scripts/learning-v2/trueforge-turn.mjs';
import { initializeBaselineContinuation, readBaselineContinuation, replayOriginalBaselineResult } from '../scripts/learning-v2/baseline-continuation.mjs';
import { CONTINUATION_PURPOSE, verifyImplementationStatus, verifyOwnerContinuationAuthorization } from '../scripts/learning-v2/implementation-proof.mjs';
import { productionChildSpec } from '../scripts/learning-v2/production-bootstrap.mjs';
import { verifyProductionImplementationForCommand } from '../scripts/learning-v2/production-config.mjs';

// REMOTE QUALIFICATION SOURCE ONLY. Real host/controller/executor/archive and
// detached authority; synthetic keys, model results, source proof and owner
// comments. No model or network endpoint is used by these fixtures.
const NOW = Date.UTC(2026, 10, 6, 4), A = 'a'.repeat(40), B = 'b'.repeat(40), TREE_B = 'c'.repeat(40);
const sha = value => createHash('sha256').update(value).digest('hex');
const corpus = JSON.parse(readFileSync(new URL('../config/learning/concurrency-atomicity-corpus-v1.json', import.meta.url)));
function key() {
  const pair = generateKeyPairSync('ed25519');
  return { publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    pinnedFingerprint: sha(pair.publicKey.export({ type: 'spki', format: 'der' })),
    issue: body => ({ body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }) };
}

async function fixture(t, { ambiguousFirstRelay = false } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-base-continuation-')); chmodSync(root, 0o700);
  const directory = join(root, 'experiment'), repositoryRoot = join(root, 'repository');
  mkdirSync(repositoryRoot, { mode: 0o700 }); t.after(() => rmSync(root, { recursive: true, force: true }));
  const keys = Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation'].map(role => [role, key()]));
  const trust = Object.fromEntries(Object.entries(keys).map(([role, value]) => [role,
    { publicKeyPem: value.publicKeyPem, pinnedFingerprint: value.pinnedFingerprint }]));
  trust.budget.gatewayId = 'TEST-ONLY-continuation-gateway';
  const records = ['harmful', 'unproven'].flatMap(group => Array.from({ length: group === 'harmful' ? 35 : 18 },
    (_, index) => ({ group, index, evidenceDigest: sha('TEST-ONLY retained ' + group + index),
      faultType: 'concurrency-atomicity', rules: ['TEST-ONLY retained rule ' + group + index] })));
  const legacyBank = { schema: 'gk-legacy-bank-projection-v1', path: '/data/gk3-rule-bank.json',
    fileDigest: sha('TEST-ONLY original bank'), bytes: 9000, revision: 65,
    counts: { accepted: 0, harmful: 35, unproven: 18, history: 0 }, records,
    authority: 'historical-observation-only; not v4 signed promotion evidence' };
  const bundle = freezeProductionBundle({ ownerId: 'TEST-ONLY-owner', experimentId: 'TEST-ONLY-base-continuation',
    sourceCommit: A, model: 'gk-v4-authority/glm-5-3-flash', serverVersion: '0.182.0', trust, corpus, legacyBank,
    gatePolicy: { targetId: 'TEST-ONLY-full-suite', presetDigest: sha('TEST-ONLY preset'),
      outputProfileDigest: sha('TEST-ONLY output'), effectiveTreeDigest: sha('TEST-ONLY original tree') } });
  const originalBundle = canonical(bundle), journal = new MemoryJournal(), artifacts = new Map();
  const artifactStore = { async put(value) { const id = digest(value); artifacts.set(id, copy(value)); return id; },
    async get(id) { assert.ok(artifacts.has(id)); return copy(artifacts.get(id)); } };
  const controls = { sessions: 0, turns: 0, dispatches: 0, failOriginalRead: true, extraTurn: false,
    ambiguousNextRelay: false, ambiguousFirstRelay, dropSettlementOnce: false, requireContinuationLink: false,
    ownerComment: null, now: NOW };
  const sessions = new Map(), turns = new Map(), events = new Map();
  let authority, host;
  const provider = { sessions: {
    async create(input) {
      if (controls.requireContinuationLink) assert.ok((await host.inspect()).dispatch.pending?.baselineContinuation,
        'a new SDK session must follow the durable dispatch continuation link');
      const id = 'session-' + (++controls.sessions);
      const session = { id, agent: { type: 'inline', spec: copy(input.agent.spec) }, metadata: copy(input.metadata),
        shared: false, createdBySubject: 'TEST-ONLY-protected-authority',
        createdAt: new Date(NOW).toISOString(), updatedAt: new Date(NOW).toISOString() };
      session.agent.spec.config.sandbox.fileDownloads = true;
      sessions.set(id, session); return { data: copy(session) };
    },
    async createTurn(sessionId, input) {
      const session = sessions.get(sessionId); controls.turns++;
      const claimed = await authority.claimProviderDispatch({ body: authorityProviderBody({
        sessionRequest: { agent: { spec: session.agent.spec } }, turnRequest: input }, 'tfy-managed/glm-5.3-flash'),
        requestDigest: sha('TEST-ONLY HTTP ' + sessionId) });
      controls.dispatches++;
      if (controls.ambiguousNextRelay) throw new Error('TEST-ONLY lost response after durable provider claim');
      const content = '{"findings":[]}';
      if (!(controls.ambiguousFirstRelay && controls.turns === 1)) await authority.finishProviderDispatch({
        callId: claimed.callId, status: 'complete', resultDigest: sha(content), httpStatus: 200 });
      const id = 'turn-' + controls.turns, output = { type: 'model.message', id: 'message-' + controls.turns,
        threadId: 'main', model: copy(bundle.runtime.model), content, finishReason: 'stop', toolCalls: [],
        createdAt: new Date(NOW).toISOString() };
      const turn = { id, sessionId, input: copy(input.input), previousTurnId: null,
        createdAt: new Date(NOW).toISOString(), state: { status: 'done', completedAt: new Date(NOW).toISOString(),
          output, requiredActions: [], metrics: { totalCostInUsd: 0.0004 } } };
      turns.set(sessionId, turn); events.set(sessionId, [copy(output)]); return { data: copy(turn) };
    },
    async get(sessionId) { return { data: copy(sessions.get(sessionId)) }; },
    async getTurn(sessionId) { return { data: copy(turns.get(sessionId)) }; },
    async listTurns(sessionId, request) {
      assert.equal(request.limit, 25, 'strict backend turn endpoint contract');
      if (controls.failOriginalRead) { controls.failOriginalRead = false; throw new Error('TEST-ONLY original verification fault'); }
      const data = [copy(turns.get(sessionId))];
      if (controls.extraTurn) data.push({ ...copy(data[0]), id: 'UNOWNED-second-turn' });
      return { response: { data, pagination: {} } };
    },
    async listTurnEvents(sessionId, _turnId, request) {
      assert.equal(request.limit, 100, 'event endpoint contract stays unchanged');
      return { response: { data: copy(events.get(sessionId)), pagination: {} } };
    },
  } };
  const owner = { id: 123, login: 'TEST-ONLY-owner' };
  const settings = { bundle, signers: Object.fromEntries(Object.entries(keys).map(([role, value]) => [role, value.issue])),
    journal, artifactStore, provider, upstreamModelId: 'tfy-managed/glm-5.3-flash', reviewerId: 'TEST-ONLY-reviewer',
    clock: () => controls.now, verifyRuntime: async () => ({ status: 'ok', serverVersion: '0.182.0' }),
    verifySourceGate: async () => ({ runId: 'TEST-ONLY-original-qualification', rawLogsDigest: sha('TEST-ONLY logs A'),
      evidence: { descriptor: { qualification: { authorId: owner.id, authorLogin: owner.login } }, ownerComment: { user: owner } } }) };
  authority = await createDetachedAuthority(settings);
  const client = { sessions: { create: input => authority.sdk.create(input),
    createTurn: (id, input) => authority.sdk.createTurn(id, input),
    getTurn: (id, turnId) => authority.sdk.getTurn(id, turnId),
    listTurnEvents: async (id, turnId, request) => ({ response: await authority.sdk.listTurnEvents(id, turnId, request) }) } };
  const hostOptions = { directory, repositoryRoot, config: bundle.config, trust, runtime: bundle.runtime,
    caseInputs: bundle.caseInputs, client, authorities: {
      evaluation: { ...trust.evaluation, issue: input => authority.issueEvaluation(input) },
      novelty: { ...trust.novelty, issue: input => authority.issueNovelty(input) } },
    gateway: { admit: input => authority.admit(input), settle: async input => {
      const receipt = await authority.settle(input);
      if (controls.dropSettlementOnce) { controls.dropSettlementOnce = false;
        throw new Error('TEST-ONLY settlement response lost after independent authority settlement'); }
      return receipt;
    } },
    clock: () => controls.now, timing: { clock: () => controls.now, pause: async () => {}, timeoutMs: 600000 } };
  host = await initializeLearningHost(hostOptions, { history: bundle.history });
  await host.recordManagedGate(await authority.managedGate());
  await assert.rejects(host.dispatch('baseline'));
  assert.equal(controls.turns, 1);
  const originalState = await host.inspect(), id = originalState.dispatch.pending.operation.id;
  const originalPath = join(directory, 'operations', digest({ operationId: id }));
  const continuationPath = join(directory, 'baseline-continuations', digest({ operationId: id }));
  const originalJournal = new FileJournal({ directory: originalPath, repositoryRoot });
  const immutableOriginal = canonical(await originalJournal.read());
  const originalArchive = (await host.inspectOperation(id)).archive;
  const oldGate = (await authority.initialize()).gate;
  const qualification = { implementationCommit: B, implementationTree: TREE_B,
    qualification: { commentId: 55, bodySha256: sha('TEST-ONLY owner B qualification'), authorId: owner.id, authorLogin: owner.login },
    qualificationPullRequest: 58, owner, runId: 'TEST-ONLY-qualification-B', rawLogsDigest: sha('TEST-ONLY logs B'),
    evidence: { syntheticTestDouble: true } };
  const bSettings = { ...settings, implementationCommit: B,
    verifyImplementationSource: async input => { assert.equal(canonical(input.bundle), originalBundle); return copy(qualification); },
    verifyContinuationOwner: input => verifyOwnerContinuationAuthorization({ ...input,
      fetcher: async () => Response.json(controls.ownerComment) }) };
  async function reopenHost() {
    const status = await authority.implementationStatus();
    host = await openLearningHost({ ...hostOptions, implementation: { binding: bundle.binding, sourceCommit: B, status } });
    return host;
  }
  async function qualify() { authority = await createDetachedAuthority(bSettings); return reopenHost(); }
  async function prepare() {
    const checkpoint = await host.prepareBaselineContinuation();
    return { checkpoint, prepared: await authority.prepareBaselineContinuation({ checkpoint }) };
  }
  async function authorize(prepared) {
    const status = await authority.implementationStatus();
    const authorization = { schema: 'gk-learning-owner-base-continuation-v1', purpose: CONTINUATION_PURPOSE,
      binding: bundle.binding, implementationCommit: B, implementationTree: TREE_B,
      qualificationDigest: digest(status.qualificationEnvelope), preparedProofDigest: digest(prepared),
      retainedDigest: digest(prepared.body.retained), allowCorrectedReaderRemainder: true };
    const body = 'GK_BASE_CONTINUATION_AUTHORIZATION\n' + JSON.stringify(authorization);
    controls.ownerComment = { id: 56, user: owner, body, created_at: new Date(controls.now + 1000).toISOString(),
      issue_url: 'https://api.github.com/repos/appliedai-au/gate_keeper/issues/58' };
    await authority.authorizeBaselineContinuation({ commentId: 56, bodySha256: sha(body) });
    return reopenHost();
  }
  const reader = createReadOnlyLearningStatusReader({ directory, repositoryRoot, binding: {
    ownerId: bundle.binding.ownerId, experimentId: bundle.binding.experimentId, sourceCommit: A },
    trust, configDigest: bundle.binding.configDigest });
  return { bundle, keys, trust, settings, bSettings, journal, controls, originalJournal, immutableOriginal, originalArchive,
    originalPath, continuationPath, directory, repositoryRoot, hostOptions, id, oldGate, reader,
    authority: () => authority, host: () => host, qualify, prepare, authorize, reopenHost,
    async reopenAuthority() { authority = await createDetachedAuthority(bSettings); return authority; },
    async continuation() { const state = await host.inspect(); return readBaselineContinuation({ originalJournal,
      continuationJournal: new FileJournal({ directory: continuationPath, repositoryRoot }),
      link: state.dispatch.entries[0].baselineContinuation, binding: bundle.binding, trust, implementationCommit: B }); },
    async assertOriginal() { assert.equal(canonical(await originalJournal.read()), immutableOriginal);
      assert.equal(canonical(authority.bundle()), originalBundle); assert.equal((await authority.initialize()).gate, oldGate); },
  };
}

test('qualified B prepares without dispatch; original BASE consumes 1 verified replay plus exactly 13 new calls', async t => {
  const f = await fixture(t); await f.qualify();
  const before = { sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches };
  const { checkpoint, prepared } = await f.prepare();
  assert.deepEqual({ sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches }, before);
  assert.equal(prepared.body.originalAuthorityCalls, 1); assert.equal(prepared.body.secondIntentAbsent, true);
  assert.deepEqual(await f.authority().prepareBaselineContinuation({ checkpoint }), prepared);
  await assert.rejects(f.host().continueBaseline(), /authorization/);
  await assert.rejects(f.authority().sdk.create({}), /owner authorization/);
  await f.authorize(prepared); await f.reopenAuthority(); await f.host().continueBaseline();
  assert.equal(f.controls.sessions, 14); assert.equal(f.controls.turns, 14); assert.equal(f.controls.dispatches, 14);
  const saved = await f.host().inspect(), operation = saved.state.operations[0];
  assert.equal(saved.state.attempts.length, 0); assert.equal(operation.id, f.id);
  assert.equal(operation.leaseId, f.originalArchive.operation.leaseId);
  assert.equal(operation.observedFreshCalls, 14); assert.equal(operation.actualCalls, 14);
  assert.equal(operation.actualMicros, null); assert.equal(operation.settled, true); assert.equal(saved.dispatch.pending, null);
  assert.equal(saved.implementation.frozenExperimentCommit, A); assert.equal(saved.implementation.actualPlatformCommit, B);
  const continued = await f.continuation();
  assert.equal(continued.saved.calls.length, 13); assert.equal(continued.archive.calls.length, 14);
  assert.equal(continued.saved.calls[0].call.callId, f.originalArchive.calls[1].call.callId);
  assert.equal(continued.original.calls[1].stages.at(-1).stage, 'failure');
  assert.ok(continued.evaluation.body.cases.every(item => item.passes.every(pass => pass.reused === false)));
  await f.assertOriginal(); await f.reopenHost(); await f.host().continueBaseline();
  assert.equal(f.controls.turns, 14, 'duplicate continuation never replays an SDK call');
  assert.equal((await f.authority().operatorStatus()).implementation.actualPlatformCommit, B);
  await f.reader();
  const authority = f.authority();
  await f.host().beginAttempt(await authority.fitFeedback({ attemptId: f.bundle.config.experimentId + ':attempt:1' }));
  assert.equal((await f.host().inspect()).state.attempts.length, 1, 'explicit authorization covers corrected-reader remainder');
});

test('missing mandatory continuation sidecar blocks host reopen and authenticated read-only status after settlement', async t => {
  const f = await fixture(t); await f.qualify(); await f.authorize((await f.prepare()).prepared);
  await f.host().continueBaseline(); renameSync(f.continuationPath, f.continuationPath + '-held');
  await assert.rejects(f.reopenHost()); await assert.rejects(f.reader());
  assert.equal(f.controls.turns, 14); await f.assertOriginal();
});

test('an already started BASE continues after original lease expiry without renewal, admission or replacement', async t => {
  const f = await fixture(t), original = (await f.authority().initialize()).operations[0];
  const lease = original.lease, leaseId = original.leaseId;
  f.controls.now += 2 * 3_600_000;
  assert.ok(f.controls.now > Date.parse(JSON.parse(lease).body.expiresAt));
  await f.qualify(); await f.authorize((await f.prepare()).prepared); await f.host().continueBaseline();
  const authority = await f.authority().initialize(), host = await f.host().inspect();
  assert.equal(authority.operations.length, 1); assert.equal(authority.operations[0].lease, lease);
  assert.equal(authority.operations[0].leaseId, leaseId); assert.equal(host.state.operations[0].leaseId, leaseId);
  assert.equal(host.dispatch.entries.length, 1);
  assert.equal(host.dispatch.entries[0].observations.filter(item => item.kind === 'admission').length, 1);
  assert.equal(f.controls.turns, 14); assert.equal(authority.operations[0].actualCalls, 14);
  assert.equal(host.state.operations[0].actualCalls, 14); await f.assertOriginal();
});

test('a lost settlement acknowledgement resumes only the retained complete evaluation and original settlement', async t => {
  const f = await fixture(t); await f.qualify(); await f.authorize((await f.prepare()).prepared);
  f.controls.dropSettlementOnce = true; await assert.rejects(f.host().continueBaseline(), /settlement response lost/);
  assert.equal(f.controls.turns, 14);
  const pending = await f.host().inspect();
  assert.equal(pending.state.operations[0].consumed, true); assert.equal(pending.state.operations[0].settled, false);
  const receipt = (await f.authority().initialize()).operations[0].settlement;
  assert.ok(receipt);
  await f.reopenAuthority(); await f.reopenHost(); await f.host().continueBaseline();
  assert.equal(f.controls.turns, 14); assert.equal((await f.authority().initialize()).operations[0].settlement, receipt);
  assert.equal((await f.host().inspect()).state.operations[0].settlementReceiptId, JSON.parse(receipt).body.receiptId);
  await f.assertOriginal();
});

test('an ambiguous new provider intent remains held on duplicate continuation and does not repeat the first result', async t => {
  const f = await fixture(t); await f.qualify(); await f.authorize((await f.prepare()).prepared);
  f.controls.ambiguousNextRelay = true;
  await assert.rejects(f.host().continueBaseline());
  assert.equal(f.controls.turns, 2); assert.equal(f.controls.sessions, 2);
  await f.reopenHost(); await assert.rejects(f.host().continueBaseline(), /incomplete started/);
  assert.equal(f.controls.turns, 2, 'ambiguous continuation creates no retry or new operation');
  const state = await f.host().inspect();
  assert.equal(state.state.operations.length, 1); assert.equal(state.dispatch.pending.operation.id, f.id);
  assert.equal(state.state.operations[0].consumed, false); await f.assertOriginal();
});

test('host null IDs are insufficient when the authority already owns a second session intent', async t => {
  const f = await fixture(t), second = f.originalArchive.calls[1].call;
  await f.authority().sdk.create({ agent: { spec: { model: second.model, instructions: second.instructions,
    config: copy(TURN_CONFIG) } }, metadata: { purpose: 'gk-learning-v2', callId: second.callId,
    operationId: second.operationId, requestDigest: second.requestDigest } });
  await f.qualify(); await assert.rejects(f.prepare(), /no second authority intent/);
  assert.equal(f.controls.turns, 1); await f.assertOriginal();
});

test('an unresolved original provider claim and an extra root turn each refuse nondispatching eligibility', async t => {
  const ambiguous = await fixture(t, { ambiguousFirstRelay: true }); await ambiguous.qualify();
  await assert.rejects(ambiguous.prepare(), /complete owned BASE call/);
  const extra = await fixture(t); await extra.qualify(); extra.controls.extraTurn = true;
  await assert.rejects(extra.prepare(), /root turn|extra|exclusive|one|unowned/i);
  assert.equal(ambiguous.controls.turns, 1); assert.equal(extra.controls.turns, 1);
});

test('changed host first output, changed original failure and forged replay capability are refused', async t => {
  const f = await fixture(t); await f.qualify();
  const checkpoint = await f.host().prepareBaselineContinuation();
  const changedOutput = copy(checkpoint), first = changedOutput.archive.calls[0].stages.at(-1).payload;
  first.text = '{"findings":[],"test":"substituted"}'; first.outputDigest = sha(first.text);
  await assert.rejects(f.authority().prepareBaselineContinuation({ checkpoint: changedOutput }), /authentic provider evidence/);
  const changedFailure = copy(checkpoint); changedFailure.archive.calls[1].stages[0].payload.sessionId = 'forged-session';
  await assert.rejects(f.authority().prepareBaselineContinuation({ checkpoint: changedFailure }), /precedes|precede/);
  await assert.rejects(replayOriginalBaselineResult({}, f.originalArchive.calls[0].call), /unverified/);
  assert.equal(f.controls.turns, 1); await f.assertOriginal();
});

test('implementation source, frozen pins, owner identity, and exact authorization bytes cannot be substituted', async t => {
  const f = await fixture(t); await f.qualify(); const { prepared } = await f.prepare();
  await f.authorize(prepared); const status = await f.authority().implementationStatus();
  const options = { binding: f.bundle.binding, trust: f.trust, implementationCommit: B, requireAuthorization: true };
  assert.throws(() => verifyImplementationStatus(status, { ...options, implementationCommit: 'd'.repeat(40) }), /actual platform image/);
  assert.throws(() => verifyImplementationStatus(status, { ...options, binding: { ...f.bundle.binding, sourceCommit: B } }), /frozen binding/);
  assert.throws(() => verifyImplementationStatus(status, { ...options, trust: { ...f.trust,
    evaluation: f.trust.novelty } }));
  const forged = JSON.parse(JSON.stringify(status)); forged.authorizationEnvelope.body.retained.maxCalls = 15;
  assert.throws(() => verifyImplementationStatus(forged, options));
  await assert.rejects(createDetachedAuthority({ ...f.bSettings, implementationCommit: 'd'.repeat(40) }), /actual authority implementation/);
  await assert.rejects(f.authority().authorizeBaselineContinuation({ commentId: 57, bodySha256: sha('different') }), /replacement/);
  assert.equal(f.controls.turns, 1);
});

test('original OperationArchive final and failure remain terminal throughout authorization and continuation', async t => {
  const f = await fixture(t); await f.qualify(); await f.authorize((await f.prepare()).prepared);
  const archive = new OperationArchive({ journal: f.originalJournal });
  await assert.rejects(archive.claimOperation(f.originalArchive.operation, f.originalArchive.request), /already claimed/);
  await assert.rejects(archive.recordCall(f.originalArchive.calls[0].call.callId, 'failure', {}), /terminal/);
  await assert.rejects(archive.recordCall(f.originalArchive.calls[1].call.callId, 'session', {}), /terminal/);
  await f.host().continueBaseline(); await f.assertOriginal();
});

test('even a signed continuation cannot replace the actual original operation, lease, request or archive head', async t => {
  const f = await fixture(t); await f.qualify(); await f.authorize((await f.prepare()).prepared);
  const status = await f.authority().implementationStatus();
  for (const [field, value] of [['operationId', 'different-operation'], ['leaseId', 'different-lease'],
    ['requestDigest', sha('different request')], ['originalArchiveHead', sha('different original head')]]) {
    const body = copy(status.authorizationEnvelope.body); body.retained[field] = value;
    const substituted = { ...status, authorizationEnvelope: f.keys.evaluation.issue(body) };
    const host = await openLearningHost({ ...f.hostOptions, implementation: {
      binding: f.bundle.binding, sourceCommit: B, status: substituted } });
    await assert.rejects(host.continueBaseline(), /original BASE operation|original host checkpoint/);
  }
  const body = copy(status.authorizationEnvelope.body); body.secondIntentAbsent = false;
  assert.throws(() => verifyImplementationStatus({ ...status, authorizationEnvelope: f.keys.evaluation.issue(body) },
    { binding: f.bundle.binding, trust: f.trust, implementationCommit: B }), /scope/);
  assert.equal(f.controls.turns, 1); await f.assertOriginal();
});

test('parent and child production proof gate reject absent/wrong B and qualification-only execution while preserving actual B', async t => {
  const f = await fixture(t); await f.qualify();
  const qualifiedOnly = await f.authority().implementationStatus();
  const check = (command, status = qualifiedOnly, sourceCommit = B) => verifyProductionImplementationForCommand({
    bundle: f.bundle, sourceCommit, command, status });
  assert.throws(() => check('run', null), /lacks independent implementation qualification/);
  assert.throws(() => check('run'), /prepare only/);
  assert.throws(() => check('continue-baseline'), /prepare only/);
  assert.throws(() => check('init'), /replacement experiment/);
  assert.throws(() => check('status', qualifiedOnly, 'd'.repeat(40)), /actual platform image/);
  assert.equal(check('status').authorizationEnvelope, null);
  assert.equal(check('prepare-baseline').authorizationEnvelope, null);
  await f.authorize((await f.prepare()).prepared);
  const authorized = await f.authority().implementationStatus();
  assert.ok(check('continue-baseline', authorized).authorizationEnvelope);
  assert.ok(check('run', authorized).authorizationEnvelope);
  const spec = productionChildSpec({ GK_PRODUCTION_COMMAND: 'continue-baseline', RAILWAY_GIT_COMMIT_SHA: B,
    GK_PRODUCTION_SOURCE_COMMIT: A, TRUEFORGE_TOKEN: 'TEST-ONLY-secret-not-admitted', GK_TFY_PAT: 'TEST-ONLY-provider-secret' });
  assert.equal(spec.sourceCommit, B); assert.equal(spec.options.env.GK_PRODUCTION_SOURCE_COMMIT, B);
  assert.deepEqual(Object.keys(spec.options.env).sort(), ['GK_PRODUCTION_SOURCE_COMMIT', 'NODE_ENV', 'PATH']);
  assert.equal(spec.args.at(-1), 'continue-baseline'); assert.equal(f.controls.turns, 1);
});

for (const interruptedAfter of ['operation-claimed', 'artifact-recorded']) {
  test('unstarted initialization resumes only missing metadata after durable ' + interruptedAfter + ' acknowledgement loss', async t => {
    const f = await fixture(t); await f.qualify(); await f.authorize((await f.prepare()).prepared);
    const status = await f.authority().implementationStatus();
    const continuationJournal = new FileJournal({ directory: f.continuationPath, repositoryRoot: f.repositoryRoot, create: true });
    const options = { originalJournal: f.originalJournal, continuationJournal, ...status,
      binding: f.bundle.binding, trust: f.trust, implementationCommit: B };
    const dispatchJournal = new FileJournal({ directory: join(f.directory, 'dispatch'), repositoryRoot: f.repositoryRoot });
    const controllerJournal = new FileJournal({ directory: join(f.directory, 'controller'), repositoryRoot: f.repositoryRoot });
    const dispatchBefore = canonical(await dispatchJournal.read()), controllerBefore = canonical(await controllerJournal.read());
    const actualBefore = { sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches };
    const interrupted = { read: () => continuationJournal.read(), async append(head, event) {
      const committed = await continuationJournal.append(head, event);
      if (event.type === interruptedAfter) throw new Error('TEST-ONLY acknowledgement lost after durable initialization prefix');
      return committed;
    } };
    await assert.rejects(initializeBaselineContinuation({ ...options, continuationJournal: interrupted }), /acknowledgement lost/);
    const prefix = await new OperationArchive({ journal: continuationJournal }).read();
    assert.deepEqual(prefix.operation, f.originalArchive.operation); assert.deepEqual(prefix.request, f.originalArchive.request);
    assert.equal(prefix.calls.length, 0); assert.equal(prefix.artifacts.length, interruptedAfter === 'operation-claimed' ? 0 : 1);
    assert.equal((await f.host().inspect()).dispatch.entries[0].baselineContinuation, undefined);
    assert.equal(canonical(await dispatchJournal.read()), dispatchBefore);
    assert.equal(canonical(await controllerJournal.read()), controllerBefore);
    assert.deepEqual({ sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches }, actualBefore);
    // Explicitly finish metadata only, then prove an identical re-open appends
    // nothing. The host still must perform its original-head CAS linkage before
    // any resumed SDK mutation is permitted.
    const link = await initializeBaselineContinuation(options);
    const initialized = canonical(await continuationJournal.read());
    assert.deepEqual(await initializeBaselineContinuation(options), link);
    assert.equal(canonical(await continuationJournal.read()), initialized);
    assert.equal(canonical(await dispatchJournal.read()), dispatchBefore);
    assert.equal(canonical(await controllerJournal.read()), controllerBefore);
    assert.deepEqual({ sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches }, actualBefore);
    f.controls.requireContinuationLink = true;
    await f.reopenHost(); await f.host().continueBaseline();
    const settled = await f.host().inspect(), continued = await f.continuation();
    assert.equal(f.controls.sessions, 14); assert.equal(f.controls.turns, 14); assert.equal(f.controls.dispatches, 14);
    assert.equal(settled.state.operations.length, 1); assert.equal(settled.state.operations[0].leaseId, f.originalArchive.operation.leaseId);
    assert.equal(settled.state.operations[0].actualCalls, 14); assert.equal(settled.state.operations[0].settled, true);
    assert.equal(settled.dispatch.entries[0].observations.filter(item => item.kind === 'admission').length, 1);
    assert.equal(continued.saved.calls.length, 13);
    const events = (await continuationJournal.read()).events;
    assert.equal(events.filter(event => event.type === 'operation-claimed').length, 1);
    assert.equal(events.filter(event => event.type === 'artifact-recorded' && event.id === 'baseline-continuation-link').length, 1);
    await f.assertOriginal();
  });
}

test('initialization refuses changed LINK bytes/shape, request/lease, unknown or execution artifacts, call intents and corrupt prefixes before any append', async t => {
  const f = await fixture(t); await f.qualify(); await f.authorize((await f.prepare()).prepared);
  const status = await f.authority().implementationStatus();
  const payload = { qualificationSerialized: JSON.stringify(status.qualificationEnvelope),
    authorizationSerialized: JSON.stringify(status.authorizationEnvelope) };
  const link = archive => archive.recordArtifact('baseline-continuation-link', 'base-continuation-authorization', payload);
  const cases = [
    ['different LINK bytes', async archive => archive.recordArtifact('baseline-continuation-link', 'base-continuation-authorization',
      { ...payload, authorizationSerialized: payload.authorizationSerialized + '\n' })],
    ['different LINK kind', async archive => archive.recordArtifact('baseline-continuation-link', 'different-kind', payload)],
    ['extra LINK payload field', async archive => archive.recordArtifact('baseline-continuation-link', 'base-continuation-authorization',
      { ...payload, unaccepted: true })],
    ['unknown sole artifact', async archive => archive.recordArtifact('unknown-initialization-artifact', 'unknown', {})],
    ['started artifact', async archive => { await link(archive); await archive.recordArtifact('baseline-continuation-started', 'base-continuation-start', {}); }],
    ['replay artifact', async archive => { await link(archive); await archive.recordArtifact('baseline-continuation-original-replay', 'base-continuation-original-result', {}); }],
    ['evaluation artifact', async archive => { await link(archive); await archive.recordArtifact('unexpected-evaluation-receipt', 'evaluation', { serialized: '{}' }); }],
    ['ambiguous call intent', async archive => archive.claimCall(f.originalArchive.calls[1].call)],
  ];
  for (const [name, append] of cases) {
    const continuationJournal = new MemoryJournal(), archive = new OperationArchive({ journal: continuationJournal });
    await archive.claimOperation(f.originalArchive.operation, f.originalArchive.request); await append(archive);
    const before = canonical(await continuationJournal.read());
    await assert.rejects(initializeBaselineContinuation({ originalJournal: f.originalJournal, continuationJournal,
      ...status, binding: f.bundle.binding, trust: f.trust, implementationCommit: B }), undefined, name);
    assert.equal(canonical(await continuationJournal.read()), before, name + ' must not append or repair');
  }
  for (const name of ['request', 'lease']) {
    const continuationJournal = new MemoryJournal(), archive = new OperationArchive({ journal: continuationJournal });
    const operation = copy(f.originalArchive.operation), request = copy(f.originalArchive.request);
    if (name === 'request') { request.plan.pairId += ':different'; operation.requestDigest = digest(request); }
    else operation.leaseId = 'different-lease';
    await archive.claimOperation(operation, request);
    const before = canonical(await continuationJournal.read());
    await assert.rejects(initializeBaselineContinuation({ originalJournal: f.originalJournal, continuationJournal,
      ...status, binding: f.bundle.binding, trust: f.trust, implementationCommit: B }), /original operation|original request/);
    assert.equal(canonical(await continuationJournal.read()), before);
  }
  const corrupt = new MemoryJournal(); await corrupt.append(null, { schema: 'unknown-archive-schema', type: 'operation-claimed' });
  const corruptBefore = canonical(await corrupt.read());
  await assert.rejects(initializeBaselineContinuation({ originalJournal: f.originalJournal, continuationJournal: corrupt,
    ...status, binding: f.bundle.binding, trust: f.trust, implementationCommit: B }), /archive record schema/);
  assert.equal(canonical(await corrupt.read()), corruptBefore);
  assert.equal(f.controls.turns, 1); assert.equal(f.controls.sessions, 1); await f.assertOriginal();
});
