import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, copy, digest } from '../../scripts/learning-v2/contracts.mjs';
import { MemoryJournal, FileJournal } from '../../scripts/learning-v2/journal.mjs';
import { OperationArchive } from '../../scripts/learning-v2/operation-archive.mjs';
import { freezeProductionBundle } from '../../scripts/learning-v2/production-bundle.mjs';
import { createDetachedAuthority } from '../../scripts/learning-v2/authority-core.mjs';
import { authorityProviderBody } from '../../scripts/learning-v2/authority-wire.mjs';
import { initializeLearningHost, openLearningHost } from '../../scripts/learning-v2/host.mjs';
import { createReadOnlyLearningStatusReader } from '../../scripts/learning-v2/status-reader.mjs';
import { TURN_CONFIG } from '../../scripts/learning-v2/trueforge-turn.mjs';
import { initializeBaselineContinuation, readBaselineContinuation, replayOriginalBaselineResult } from '../../scripts/learning-v2/baseline-continuation.mjs';
import { CONTINUATION_PURPOSE, verifyImplementationStatus, verifyOwnerContinuationAuthorization } from '../../scripts/learning-v2/implementation-proof.mjs';
import { productionChildSpec } from '../../scripts/learning-v2/production-bootstrap.mjs';
import { verifyProductionImplementationForCommand } from '../../scripts/learning-v2/production-config.mjs';

// REMOTE QUALIFICATION SOURCE ONLY. Real host/controller/executor/archive and
// detached authority; synthetic keys, model results, source proof and owner
// comments. No model or network endpoint is used by these fixtures.
export const NOW = Date.UTC(2026, 10, 6, 4), A = 'a'.repeat(40), B = 'b'.repeat(40), TREE_B = 'c'.repeat(40);
const sha = value => createHash('sha256').update(value).digest('hex');
const corpus = JSON.parse(readFileSync(new URL('../../config/learning/concurrency-atomicity-corpus-v1.json', import.meta.url)));
function key() {
  const pair = generateKeyPairSync('ed25519');
  return { publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    pinnedFingerprint: sha(pair.publicKey.export({ type: 'spki', format: 'der' })),
    issue: body => ({ body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }) };
}

export async function originalContinuationFixture(t, { ambiguousFirstRelay = false } = {}) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-base-continuation-')); chmodSync(root, 0o700);
  const hostRoot = join(root, 'host'); mkdirSync(hostRoot, { mode: 0o700 });
  const directory = join(hostRoot, 'experiment'), repositoryRoot = join(root, 'repository');
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
  const bundle = freezeProductionBundle({ ownerId: 'TEST-ONLY-base44-owner', experimentId: 'TEST-ONLY-base-continuation',
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
      const observedState = await authority.initialize();
      const observedOperation = observedState.operations.find(item => item.id === session.metadata.operationId);
      const slot = observedOperation.calls.find(item => item.callId === session.metadata.callId).slot;
      const content = observedOperation.kind === 'proposal' ? controls.proposalContent || '{"findings":[]}' :
        controls.improveCandidate && slot.arm === 'candidate' && slot.pass === 2 && slot.caseId === corpus.cases[0].caseId ?
          JSON.stringify({ findings: [{ line: 28,
            quote: '        cur.execute("SELECT balance FROM accounts WHERE id = %s", (from_id,))',
            comment: 'Concurrent transfers read the same unlocked balance and both spend it, overdrawing the wallet.' }] }) :
          '{"findings":[]}';
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
  return { root, hostRoot, artifacts, bundle, keys, trust, settings, bSettings, journal, controls, originalJournal, immutableOriginal, originalArchive,
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
