import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POLICY, configuration, copy, digest, procedure } from '../scripts/learning-v2/contracts.mjs';
import { LearningController } from '../scripts/learning-v2/controller.mjs';
import { DispatchLedger } from '../scripts/learning-v2/dispatch-ledger.mjs';
import { verifyEvaluation } from '../scripts/learning-v2/evidence.mjs';
import { initializeLearningHost, openLearningHost } from '../scripts/learning-v2/host.mjs';
import { FileJournal } from '../scripts/learning-v2/journal.mjs';
import { CHAIN_ASK, LEGACY_BAG_BLOB, LEGACY_RENDERER_ID } from '../scripts/learning-v2/legacy-renderer.mjs';
import { OperationArchive } from '../scripts/learning-v2/operation-archive.mjs';
import { TURN_CONFIG } from '../scripts/learning-v2/trueforge-turn.mjs';

// SOURCE ONLY for the managed remote gate. The host, controller, executor,
// SDK-turn adapter and FileJournal are real; all services, keys, source identity,
// code cases, oracle results and gateway balances below are synthetic fixtures.
const NOW = Date.UTC(2026, 10, 4, 12);
const sha = value => createHash('sha256').update(value).digest('hex');
const BASE = 'Review the numbered code. Return JSON findings.\n\nExtra field: quote the defective line.';
const window = () => ({ issuedAt: new Date(NOW - 1000).toISOString(), expiresAt: new Date(NOW + 30 * 60_000).toISOString() });
const proposed = () => procedure({ scope: 'concurrency', languages: ['javascript'],
  applicability: 'A JavaScript service writes a value derived from shared state.',
  trigger: 'A read determines a later write to the same shared value.',
  evidence: 'Trace the revision predicate and intervening writer: NEW_RULE_CANARY.',
  action: 'Report a lost update only when the same revision is not guarded: NEW_RULE_CANARY.',
  sufficientGuard: 'A compare-and-swap predicate covers the same revision and target.' }, 'concurrency');

function key() {
  const pair = generateKeyPairSync('ed25519');
  return { trust: { publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    pinnedFingerprint: sha(pair.publicKey.export({ type: 'spki', format: 'der' })) },
  seal: body => ({ body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }) };
}

function fixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-learning-v2-host-'));
  chmodSync(root, 0o700);
  const repositoryRoot = join(root, 'repository'), directory = join(root, 'experiment');
  mkdirSync(repositoryRoot, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const keys = Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation'].map(role => [role, key()]));
  const trust = Object.fromEntries(Object.entries(keys).map(([role, value]) => [role, { ...value.trust }]));
  trust.budget.gatewayId = 'fixture-global-gateway';
  const caseIds = ['fit-js', 'check-js'];
  const caseInputs = caseIds.map(caseId => ({ caseId, prompt: 'Review this code.\n```javascript\n' + [
    `const caseName = "${caseId}";`, 'const before = shared.count;', 'inspect(before);',
    'const next = before + 1;', 'count += 1;', 'audit(next);', 'publish(next);',
  ].map((line, index) => `${index + 1} | ${line}`).join('\n') + '\n```' }));
  const runtime = { schema: 'gk-learning-v2-runtime-v1', sdkVersion: '0.180.0', serverVersion: '0.180.0',
    provider: 'truefoundry', memory: 'off', sessionMode: 'inline-root-per-call',
    model: { name: 'tfy-direct/host-fixture', params: { temperature: 0, maxTokens: 1500 } },
    turnConfig: copy(TURN_CONFIG), renderer: LEGACY_RENDERER_ID, bagBlob: LEGACY_BAG_BLOB,
    caseInputsDigest: digest(caseInputs) };
  const config = configuration({ experimentId: 'host-fixture', sourceCommit: 'b'.repeat(40),
    benchmarkDigest: sha('synthetic fit/check code and oracle'), scorerDigest: sha('synthetic independent line scorer'),
    model: runtime.model.name, scope: 'concurrency', baseInstructions: BASE, firstPassInstructionsDigest: sha(BASE),
    runtimeDigest: digest(runtime), budgetId: 'fixture-programme',
    gatePolicy: { targetId: 'fixture-target', presetDigest: sha('fixture full suite'),
      outputProfileDigest: sha('fixture output profile'), effectiveTreeDigest: sha('fixture source tree') },
    cases: caseIds.map((caseId, index) => ({ caseId, split: index ? 'check' : 'fit', scope: 'concurrency',
      expectedBugs: 3, passes: 2, learnerVisible: !index })) });
  const trustPins = { ...Object.fromEntries(Object.entries(trust).map(([role, value]) => [role, value.pinnedFingerprint])),
    gatewayId: trust.budget.gatewayId };
  const configDigest = digest({ config, policy: POLICY, trustPins, history: [] });
  const identity = { experimentId: config.experimentId, configDigest, sourceCommit: config.sourceCommit };
  let serial = 0;
  const next = prefix => `${prefix}:${++serial}`;
  const seal = (role, body) => keys[role].seal(body);
  const budgetIdentity = { ...identity, budgetId: config.budgetId, gatewayId: trust.budget.gatewayId,
    provider: 'truefoundry', global: true, ceilingMicros: POLICY.programmeCeilingMicros };
  const budgetEnvelope = seal('budget', { schema: 'gk-learning-v2-budget-state', receiptId: next('initial-budget'),
    ...budgetIdentity, spentMicros: 0, reservedMicros: 0, ...window() });
  const gateEnvelope = seal('evaluation', { schema: 'gk-learning-v2-managed-gate', receiptId: next('managed-gate'),
    ...identity, ...config.gatePolicy, status: 'passed', fullSuite: true, independent: true,
    baseCurrent: true, cleanupComplete: true, noSkippedChecks: true,
    runId: next('managed-run'), rawLogsDigest: sha('synthetic complete managed logs') });
  const controls = { admission: null, settlement: null, turn: null, onAdmit: null, now: NOW };
  const admissions = [], settlements = [], sessions = [], turnRequests = [], evaluationIssues = [], noveltyIssues = [];
  const remote = { spentMicros: 0, reservedMicros: 0, operations: new Map() };
  const bySession = new Map();
  // An independent fixture gateway charges for observed synthetic dispatches;
  // provider estimated-cost fields are not its billing authority.
  const reconcile = operationId => {
    const held = remote.operations.get(operationId); assert.ok(held);
    if (held.settlementEnvelope) return held.settlementEnvelope;
    const actualCalls = turnRequests.filter(item => item.operationId === operationId).length;
    const actualMicros = actualCalls * 100;
    remote.spentMicros += actualMicros; remote.reservedMicros -= held.leaseEnvelope.body.reservationMicros;
    held.settlementEnvelope = seal('budget', { schema: 'gk-learning-v2-operation-settlement', receiptId: next('settlement'),
      ...budgetIdentity, operationId, leaseId: held.leaseEnvelope.body.receiptId,
      status: 'settled', actualCalls, actualMicros, spentMicros: remote.spentMicros, reservedMicros: remote.reservedMicros });
    return held.settlementEnvelope;
  };
  const gateway = {
    async admit(input) {
      admissions.push(copy(input));
      if (controls.onAdmit) await controls.onAdmit(input);
      if (controls.admission === 'not-admitted') throw new Error('fixture admission response unavailable');
      assert.equal(remote.operations.has(input.operation.id), false, 'fixture gateway must not receive a repeated admission');
      remote.reservedMicros += 10_000;
      const leaseEnvelope = seal('budget', { schema: 'gk-learning-v2-operation-lease', receiptId: next('lease'),
        ...budgetIdentity, ...input.operation, model: config.model, managedGateDigest: input.request.managedGateDigest,
        namespaceExclusive: true, providerLimitEnforced: true, maxCalls: input.request.requiredCalls,
        reservationMicros: 10_000, spentMicros: remote.spentMicros, reservedMicros: remote.reservedMicros, ...window() });
      remote.operations.set(input.operation.id, { ...copy(input), leaseEnvelope, settlementEnvelope: null });
      if (controls.admission === 'lost-after-reservation') throw new Error('fixture response lost after remote reservation');
      return leaseEnvelope;
    },
    async settle(input) {
      settlements.push(copy(input));
      const held = remote.operations.get(input.operationId); assert.ok(held);
      assert.equal(input.leaseId, held.leaseEnvelope.body.receiptId);
      assert.equal(input.requestDigest, held.operation.requestDigest);
      const envelope = reconcile(input.operationId);
      if (controls.settlement === 'lost-after-settlement') throw new Error('fixture settlement response lost');
      return envelope;
    },
  };
  const client = { sessions: {
    async create(request, options) {
      assert.equal(options.maxRetries, 0);
      const item = { id: `session:${sessions.length + 1}`, request: copy(request) };
      sessions.push(item); bySession.set(item.id, item);
      return { data: { id: item.id, metadata: copy(request.metadata) } };
    },
    async createTurn(sessionId, request, options) {
      assert.equal(options.maxRetries, 0);
      const session = bySession.get(sessionId), operationId = session.request.metadata.operationId;
      const operation = remote.operations.get(operationId).operation;
      const message = request.input[0].content, instructions = session.request.agent.spec.instructions;
      const pass = message.includes(CHAIN_ASK.split('%LIST%')[0]) ? 2 : 1;
      turnRequests.push({ operationId, sessionId, request: copy(request), instructions });
      if (controls.turn === 'lost-after-dispatch') {
        controls.turn = null; throw new Error('fixture model response lost after dispatch');
      }
      const content = operation.kind === 'proposal' ? JSON.stringify(proposed()) : JSON.stringify({ findings:
        (pass === 1 ? [2] : instructions.includes('NEW_RULE_CANARY') ? [5, 7] : [5])
          .map(line => ({ line, comment: `fixture defect ${line}` })) });
      const output = { id: `message:${turnRequests.length}`, type: 'model.message', threadId: 'main', role: 'assistant',
        createdAt: '2026-11-04T12:00:00Z', content, finishReason: 'stop' };
      session.turn = { id: `turn:${turnRequests.length}`, sessionId, previousTurnId: null,
        createdAt: '2026-11-04T12:00:00Z', state: { status: 'done', completedAt: '2026-11-04T12:00:01Z', output,
          requiredActions: [], metrics: { totalCostInUsd: 0.02, totalInputTokens: 40, totalOutputTokens: 10 } } };
      return { data: copy(session.turn) };
    },
    async getTurn() { assert.fail('terminal fixture turns must not be polled'); },
    async listTurnEvents(sessionId, turnId) {
      const turn = bySession.get(sessionId).turn; assert.equal(turn.id, turnId);
      return { response: { data: [copy(turn.state.output)], pagination: { limit: 100 } },
        rawResponse: { headers: { authorization: 'TRANSPORT_SECRET_CANARY' } } };
    },
  } };
  const oracle = new Map(caseIds.map(caseId => [caseId, new Set([2, 5, 7])]));
  const authorities = {
    evaluation: { ...keys.evaluation.trust, async issue(input) {
      evaluationIssues.push(copy(input));
      const { cases: _manifest, ...expected } = input.expected;
      return seal('evaluation', { schema: 'gk-learning-v2-evaluation', receiptId: next('evaluation'), ...expected,
        provider: 'truefoundry', memory: 'off', complete: true, cases: input.observation.cases.map(item => {
          const reported = new Set(item.mergedFindings.map(finding => finding.start)), truth = oracle.get(item.caseId);
          for (const [index, pass] of item.passes.entries()) {
            assert.equal(pass.callId, item.rawTurns[index].callId);
            assert.equal(pass.outputDigest, sha(item.rawTurns[index].text));
          }
          return { caseId: item.caseId, caught: [...reported].filter(line => truth.has(line)).length,
            falseAlarms: [...reported].filter(line => !truth.has(line)).length, passes: copy(item.passes) };
        }) });
    } },
    novelty: { ...keys.novelty.trust, async issue(input) {
      noveltyIssues.push(copy(input));
      return seal('novelty', { schema: 'gk-learning-v2-novelty', receiptId: next('novelty'), ...input.expected,
        verdict: 'novel', comparisons: input.priorReferences.map(item => ({ priorId: item.id, relation: 'distinct',
          reason: 'Distinct synthetic fixture procedure.' })), coverageCaseIds: caseIds });
    } },
  };
  const options = { directory, repositoryRoot, config, trust, client, runtime, caseInputs, authorities, gateway,
    clock: () => controls.now, timing: { clock: () => 0, pause: async () => {}, timeoutMs: 1000, pollIntervalMs: 1 } };
  const f = { root, directory, repositoryRoot, config, trust, options, identity, controls, admissions, settlements,
    sessions, turnRequests, evaluationIssues, noveltyIssues, remote, reconcile, seal, budgetEnvelope, gateEnvelope,
    journal: child => new FileJournal({ directory: join(directory, child), repositoryRoot }),
    archivePath: operationId => join(directory, 'operations', digest({ operationId })),
    async start({ withGate = true } = {}) {
      f.host = await initializeLearningHost(options, { history: [], budgetEnvelope });
      if (withGate) await f.host.recordManagedGate(gateEnvelope);
      return f.host;
    },
    async reopen() { f.host = await openLearningHost(options); return f.host; },
    notAdmitted(pending, changes = {}, role = 'budget') {
      return seal(role, { schema: 'gk-learning-v2-operation-not-admitted', receiptId: next('not-admitted'),
        ...budgetIdentity, operationId: pending.operation.id, requestDigest: pending.operation.requestDigest,
        status: 'not-admitted', reservationExists: false, actualCalls: 0, actualMicros: 0, ...changes });
    },
  };
  return f;
}

async function readyAttempt(f) {
  await f.start(); await f.host.dispatch('baseline'); return f.host.beginAttempt();
}

async function journalSnapshots(f) {
  return { controller: await f.journal('controller').read(), dispatch: await f.journal('dispatch').read() };
}

test('exclusive host initialization and complete baseline persist real private journals and survive reopening', async t => {
  const f = fixture(t); await f.start();
  assert.deepEqual((await f.host.status()).baseline, { status: 'not-planned', failureCode: null });
  f.controls.onAdmit = async ({ operation, request }) => {
    const inspected = await f.host.inspect();
    assert.equal(inspected.dispatch.pending.operation.id, operation.id);
    assert.equal(inspected.dispatch.pending.operation.requestDigest, digest(request));
    assert.equal(inspected.dispatch.pending.admission, null);
    assert.equal(inspected.state.operations.length, 0);
    assert.ok((await f.journal('dispatch').read()).head, 'admission intent must already be durable');
  };
  await f.host.dispatch('baseline');
  const before = await f.host.inspect(), status = await f.host.status();
  assert.deepEqual(status.baseline, { status: 'complete', failureCode: null });
  assert.equal(before.state.baseline.totals.caught, 4); assert.equal(before.state.baseline.totals.falseAlarms, 0);
  assert.equal(before.state.operations.length, 1); assert.equal(before.state.operations[0].settled, true);
  assert.equal(before.state.operations[0].actualCalls, 4); assert.equal(before.state.budget.spentMicros, 400);
  assert.equal(before.state.budget.reservedMicros, 0); assert.equal(before.dispatch.pending, null);
  assert.equal(before.dispatch.entries[0].resolution.kind, 'settled');
  const operationId = before.state.operations[0].id;
  const archive = new OperationArchive({ journal: new FileJournal({ directory: f.archivePath(operationId), repositoryRoot: f.repositoryRoot }) });
  const recorded = await archive.read();
  assert.equal(recorded.calls.length, 4); assert.equal(recorded.operation.id, operationId);
  assert.ok(recorded.calls.every(item => item.stages.at(-1).payload.complete));
  const storedReceipt = JSON.parse(recorded.artifacts.find(item => item.kind === 'evaluation').payload.serialized);
  const verified = verifyEvaluation(storedReceipt, f.trust.evaluation, { ...before.dispatch.entries[0].request.plan,
    operationId, requestDigest: before.state.operations[0].requestDigest });
  assert.equal(verified.receiptId, before.state.baseline.receiptId);
  assert.equal(verified.bodyDigest, before.state.baseline.bodyDigest);
  assert.doesNotMatch(JSON.stringify(recorded), /TRANSPORT_SECRET_CANARY/);
  assert.equal(lstatSync(f.directory).mode & 0o777, 0o700);
  assert.equal(lstatSync(join(f.directory, 'controller', '000000000001.json')).mode & 0o777, 0o600);
  await f.reopen(); assert.deepEqual(await f.host.inspect(), before); assert.deepEqual(await f.host.status(), status);
  await assert.rejects(initializeLearningHost(f.options, { budgetEnvelope: f.budgetEnvelope }));
  assert.deepEqual(await f.host.inspect(), before);
  assert.equal(f.admissions.length, 1); assert.equal(f.settlements.length, 1); assert.equal(f.turnRequests.length, 4);
});

test('reopen rejects configuration or trust drift and missing stores without recreating evidence or contacting services', async t => {
  const f = fixture(t); await f.start(); await f.host.dispatch('baseline');
  const before = await f.host.inspect(), counts = [f.admissions.length, f.settlements.length, f.turnRequests.length];
  const alteredConfig = copy(f.config); alteredConfig.baseInstructions += ' changed';
  alteredConfig.firstPassInstructionsDigest = sha(alteredConfig.baseInstructions);
  await assert.rejects(openLearningHost({ ...f.options, config: alteredConfig }));
  const alteredTrust = copy(f.trust); alteredTrust.activation = key().trust;
  await assert.rejects(openLearningHost({ ...f.options, trust: alteredTrust }));
  for (const path of [join(f.directory, 'controller'), join(f.directory, 'dispatch'), join(f.directory, 'operations'),
    f.archivePath(before.state.operations[0].id)]) {
    const displaced = `${path}-missing-fixture`; renameSync(path, displaced);
    try {
      await assert.rejects(openLearningHost(f.options));
      assert.equal(existsSync(path), false, 'open must not manufacture a replacement store');
    } finally { renameSync(displaced, path); }
  }
  await f.reopen(); assert.deepEqual(await f.host.inspect(), before);
  assert.deepEqual([f.admissions.length, f.settlements.length, f.turnRequests.length], counts);
});

test('a completed logical phase and a missing managed gate refuse before another gateway admission', async t => {
  const f = fixture(t); await f.start({ withGate: false });
  await assert.rejects(f.host.dispatch('baseline'));
  assert.deepEqual(f.admissions, []); assert.deepEqual(f.sessions, []);
  await f.host.recordManagedGate(f.gateEnvelope); await f.host.dispatch('baseline'); await f.reopen();
  const before = await f.host.inspect();
  await assert.rejects(f.host.dispatch('baseline'));
  assert.deepEqual(await f.host.inspect(), before);
  assert.equal(f.admissions.length, 1); assert.equal(f.settlements.length, 1); assert.equal(f.turnRequests.length, 4);
});

test('a lost admission response survives restart and authentic external recovery never repeats admission or model dispatch', async t => {
  const f = fixture(t), attempt = await readyAttempt(f);
  f.controls.admission = 'lost-after-reservation';
  await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  const held = await f.host.inspect(), pending = held.dispatch.pending;
  assert.equal(pending.operation.kind, 'proposal'); assert.equal(pending.admission, null);
  assert.equal(held.state.operations.length, 1); assert.equal(f.remote.reservedMicros, 10_000);
  const pendingStatus = await f.host.status();
  assert.equal(pendingStatus.pendingOperation, pending.operation.id);
  assert.deepEqual(pendingStatus.dispatch.pending, { operationId: pending.operation.id, kind: 'proposal', stage: 'admission-intent' });
  await f.reopen();
  await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  await assert.rejects(f.host.beginAttempt());
  await assert.rejects(f.host.recover({ operationId: pending.operation.id, reason: 'fixture reconcile without authority' }));
  assert.deepEqual(await f.host.inspect(), held);
  const admissionEnvelope = f.remote.operations.get(pending.operation.id).leaseEnvelope;
  await f.host.recover({ operationId: pending.operation.id, reason: 'fixture gateway confirmed reservation', admissionEnvelope });
  const observed = await f.host.inspect();
  assert.deepEqual(observed.state, held.state, 'an observed lease alone must not create execution authority');
  assert.equal(observed.dispatch.pending.admission, JSON.stringify(admissionEnvelope));
  assert.equal(f.remote.reservedMicros, 10_000); assert.ok(observed.dispatch.pending);
  assert.equal((await f.host.status()).dispatch.pending.stage, 'admission-observed');
  const settlementEnvelope = f.reconcile(pending.operation.id);
  await f.host.recover({ operationId: pending.operation.id, reason: 'fixture authenticated zero-dispatch settlement', settlementEnvelope });
  const resolved = await f.host.inspect();
  assert.equal(resolved.dispatch.pending, null); assert.equal(resolved.state.budget.reservedMicros, 0);
  assert.equal(resolved.state.operations.at(-1).actualCalls, 0);
  assert.equal((await f.host.beginAttempt()).number, 2);
  assert.equal(f.admissions.length, 2); assert.equal(f.settlements.length, 1); assert.equal(f.turnRequests.length, 4);
});

test('an expired historical admission resolves only through an authentic final settlement and never grants execution authority', async t => {
  const f = fixture(t), attempt = await readyAttempt(f);
  f.controls.admission = 'lost-after-reservation';
  await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  const pending = (await f.host.inspect()).dispatch.pending;
  const admissionEnvelope = f.remote.operations.get(pending.operation.id).leaseEnvelope;
  f.controls.now = Date.parse(admissionEnvelope.body.expiresAt) + 1;
  await f.reopen();
  await f.host.recover({ operationId: pending.operation.id, reason: 'fixture retain expired historical lease', admissionEnvelope });
  const held = await f.host.inspect();
  assert.equal(held.state.operations.some(item => item.id === pending.operation.id), false);
  assert.equal(held.state.attempts[0].status, 'reserved');
  assert.equal(held.dispatch.pending.admission, JSON.stringify(admissionEnvelope));
  assert.equal((await f.host.status()).pendingOperation, pending.operation.id);
  await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  await assert.rejects(f.host.beginAttempt());
  const settlementEnvelope = f.reconcile(pending.operation.id);
  const invalid = [
    { admissionEnvelope, settlementEnvelope: f.seal('activation', settlementEnvelope.body) },
    { admissionEnvelope, settlementEnvelope: f.seal('budget', { ...settlementEnvelope.body,
      actualCalls: admissionEnvelope.body.maxCalls + 1 }) },
    { admissionEnvelope, settlementEnvelope: f.seal('budget', { ...settlementEnvelope.body,
      actualMicros: admissionEnvelope.body.reservationMicros + 1,
      spentMicros: held.state.budget.spentMicros + admissionEnvelope.body.reservationMicros + 1 }) },
    { admissionEnvelope: f.seal('budget', { ...admissionEnvelope.body, issuedAt: admissionEnvelope.body.expiresAt }),
      settlementEnvelope },
  ];
  for (const receipts of invalid) {
    await assert.rejects(f.host.recover({ operationId: pending.operation.id, reason: 'fixture contradictory reconciliation', ...receipts }));
    const rejected = await f.host.inspect();
    assert.deepEqual(rejected.state, held.state, 'invalid recovery must not partially admit or settle an operation');
    assert.equal(rejected.dispatch.pending.operation.id, pending.operation.id);
    assert.equal(rejected.dispatch.pending.resolution, null);
  }
  await f.host.recover({ operationId: pending.operation.id, reason: 'fixture final historical reconciliation',
    admissionEnvelope, settlementEnvelope });
  const resolved = await f.host.inspect(), operation = resolved.state.operations.at(-1);
  assert.equal(operation.id, pending.operation.id); assert.equal(operation.leaseId, admissionEnvelope.body.receiptId);
  assert.equal(operation.reconciliationOnly, true); assert.equal(operation.consumed, true); assert.equal(operation.settled, true);
  assert.equal(operation.actualCalls, 0); assert.equal(operation.actualMicros, 0); assert.equal(operation.evidenceComplete, false);
  assert.equal(resolved.state.attempts[0].status, 'unresolved'); assert.equal(resolved.dispatch.pending, null);
  assert.equal(resolved.dispatch.entries.at(-1).admission, JSON.stringify(admissionEnvelope));
  assert.equal(resolved.dispatch.entries.at(-1).settlement, JSON.stringify(settlementEnvelope));
  assert.equal(resolved.state.budget.spentMicros, 400); assert.equal(resolved.state.budget.reservedMicros, 0);
  assert.equal(existsSync(f.archivePath(operation.id)), false, 'reconciliation must not create an execution archive');
  await f.reopen(); await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  assert.equal((await f.host.beginAttempt()).number, 2);
  assert.equal(f.admissions.length, 2); assert.equal(f.settlements.length, 1); assert.equal(f.turnRequests.length, 4);
});

test('ambiguous model dispatch retains its recorded IDs and nonzero hold until signed recovery settles it without rerunning', async t => {
  const f = fixture(t), attempt = await readyAttempt(f);
  f.controls.turn = 'lost-after-dispatch';
  await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  const held = await f.host.inspect(), operation = held.state.operations.at(-1);
  assert.equal(operation.kind, 'proposal'); assert.equal(operation.settled, false); assert.equal(operation.consumed, false);
  assert.equal(held.state.budget.reservedMicros, 10_000);
  const archive = new OperationArchive({ journal: new FileJournal({ directory: f.archivePath(operation.id), repositoryRoot: f.repositoryRoot }) });
  const evidence = await archive.read(); assert.equal(evidence.calls.length, 1);
  assert.equal(evidence.calls[0].stages.at(-1).stage, 'failure');
  assert.equal(evidence.calls[0].stages.at(-1).payload.sessionId, 'session:5');
  await f.reopen(); await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  await assert.rejects(f.host.abandonAttempt(attempt.attemptId, 'must retain recovery custody'));
  const settlementEnvelope = f.reconcile(operation.id);
  const forged = f.seal('activation', settlementEnvelope.body);
  await assert.rejects(f.host.recover({ operationId: operation.id, reason: 'fixture wrong authority', settlementEnvelope: forged }));
  assert.equal((await f.host.inspect()).state.budget.reservedMicros, 10_000);
  await f.host.recover({ operationId: operation.id, reason: 'fixture authenticated partial usage', settlementEnvelope });
  const resolved = await f.host.inspect();
  assert.equal(resolved.state.operations.at(-1).actualCalls, 1); assert.equal(resolved.state.operations.at(-1).actualMicros, 100);
  assert.equal(resolved.state.budget.spentMicros, 500); assert.equal(resolved.state.budget.reservedMicros, 0);
  assert.equal(resolved.state.attempts[0].status, 'unresolved'); assert.equal(resolved.dispatch.pending, null);
  assert.deepEqual(await archive.read(), evidence);
  assert.equal((await f.host.beginAttempt()).number, 2);
  assert.equal(f.admissions.length, 2); assert.equal(f.settlements.length, 1); assert.equal(f.turnRequests.length, 5);
});

test('a lost settlement response preserves accepted evidence and recovery imports the receipt without duplicate charges', async t => {
  const f = fixture(t); await f.start(); f.controls.settlement = 'lost-after-settlement';
  await assert.rejects(f.host.dispatch('baseline'));
  const held = await f.host.inspect(), operation = held.state.operations[0];
  assert.equal(held.state.baseline.totals.caught, 4); assert.equal(operation.consumed, true); assert.equal(operation.settled, false);
  assert.equal(held.state.budget.reservedMicros, 10_000); assert.equal(f.remote.reservedMicros, 0);
  await f.reopen(); await assert.rejects(f.host.dispatch('baseline'));
  const settlementEnvelope = f.remote.operations.get(operation.id).settlementEnvelope;
  await f.host.recover({ operationId: operation.id, reason: 'fixture import completed gateway settlement', settlementEnvelope });
  const resolved = await f.host.inspect();
  assert.deepEqual(resolved.state.baseline, held.state.baseline); assert.equal(resolved.state.operations[0].settled, true);
  assert.equal(resolved.state.budget.spentMicros, 400); assert.equal(f.remote.spentMicros, 400);
  assert.equal(resolved.dispatch.pending, null);
  assert.equal(f.admissions.length, 1); assert.equal(f.settlements.length, 1); assert.equal(f.turnRequests.length, 4);
});

test('only an exact budget-signed non-admission can close a pre-reservation intent and its logical phase stays consumed', async t => {
  const f = fixture(t), attempt = await readyAttempt(f); f.controls.admission = 'not-admitted';
  await assert.rejects(f.host.dispatch('proposal', attempt.attemptId)); await f.reopen();
  const held = await f.host.inspect(), pending = held.dispatch.pending;
  await assert.rejects(f.host.recordNotAdmitted(f.notAdmitted(pending, {}, 'activation')));
  await assert.rejects(f.host.recordNotAdmitted(f.notAdmitted(pending, { operationId: 'another-operation' })));
  assert.deepEqual(await f.host.inspect(), held);
  const envelope = f.notAdmitted(pending); await f.host.recordNotAdmitted(envelope);
  const resolved = await f.host.inspect(), entry = resolved.dispatch.entries.at(-1);
  assert.equal(resolved.dispatch.pending, null); assert.equal(entry.resolution.kind, 'not-admitted');
  assert.equal(entry.notAdmitted, JSON.stringify(envelope));
  assert.equal(resolved.state.operations.length, 1); assert.equal(resolved.state.attempts[0].status, 'unresolved');
  await assert.rejects(f.host.dispatch('proposal', attempt.attemptId));
  assert.equal((await f.host.beginAttempt()).number, 2);
  assert.equal(f.admissions.length, 2); assert.equal(f.settlements.length, 1); assert.equal(f.turnRequests.length, 4);
});

test('authentic baseline non-admission persists a private failure record and a terminal public baseline status', async t => {
  const f = fixture(t); await f.start(); f.controls.admission = 'not-admitted';
  await assert.rejects(f.host.dispatch('baseline'));
  const held = await f.host.inspect(), pending = held.dispatch.pending;
  assert.equal(pending.operation.kind, 'baseline'); assert.equal(pending.operation.attemptId, null);
  assert.deepEqual((await f.host.status()).baseline, { status: 'planned', failureCode: null });
  const before = await journalSnapshots(f);
  for (const invalid of [f.notAdmitted(pending, {}, 'activation'),
    f.notAdmitted(pending, { requestDigest: sha('a different baseline request') })]) {
    await assert.rejects(f.host.recordNotAdmitted(invalid));
    assert.deepEqual(await f.host.inspect(), held);
    assert.deepEqual(await journalSnapshots(f), before);
  }
  const envelope = f.notAdmitted(pending, { receiptId: 'baseline-denial-private-canary' });
  const status = await f.host.recordNotAdmitted(envelope), closed = await f.host.inspect();
  assert.equal(closed.state.baseline, null); assert.deepEqual(closed.state.operations, []);
  assert.deepEqual(closed.state.attempts, []); assert.deepEqual(closed.state.budget, held.state.budget);
  assert.equal(typeof closed.state.baselineError, 'string'); assert.ok(closed.state.baselineError.length > 0);
  assert.deepEqual(closed.state.baselineNonAdmission, { operationId: pending.operation.id,
    requestDigest: pending.operation.requestDigest, receiptId: envelope.body.receiptId,
    receiptDigest: digest(JSON.stringify(envelope)) });
  assert.equal(closed.state.receipts.filter(id => id === envelope.body.receiptId).length, 1);
  assert.equal(closed.dispatch.pending, null);
  assert.deepEqual(closed.dispatch.entries[0].resolution, { kind: 'not-admitted', receiptId: envelope.body.receiptId });
  assert.equal(closed.dispatch.entries[0].notAdmitted, JSON.stringify(envelope));
  assert.deepEqual(status.baseline, { status: 'failed', failureCode: 'not-admitted' });
  assert.equal(status.pendingOperation, null); assert.deepEqual(status.dispatch, { pending: null, completed: 1 });
  assert.equal(status.counts.attempted, 0);
  const publicBytes = JSON.stringify(status);
  assert.doesNotMatch(publicBytes, /baseline-denial-private-canary|baselineError|baselineNonAdmission|receiptDigest|Return JSON findings/);
  assert.equal(publicBytes.includes(envelope.signature), false);
  const finished = await journalSnapshots(f);
  await f.reopen(); assert.deepEqual(await f.host.inspect(), closed); assert.deepEqual(await f.host.status(), status);
  await assert.rejects(f.host.dispatch('baseline'));
  await assert.rejects(f.host.beginAttempt());
  await assert.rejects(f.host.recordNotAdmitted(envelope));
  assert.deepEqual(await journalSnapshots(f), finished);
  assert.equal(f.admissions.length, 1); assert.deepEqual(f.settlements, []);
  assert.deepEqual(f.sessions, []); assert.deepEqual(f.turnRequests, []);
  assert.deepEqual(f.evaluationIssues, []); assert.deepEqual(f.noveltyIssues, []);
  assert.equal(existsSync(f.archivePath(pending.operation.id)), false);
});

test('baseline denial committed before a concurrent receipt selection reopens and finishes only from its exact original receipt', async t => {
  const f = fixture(t); await f.start(); f.controls.admission = 'not-admitted';
  await assert.rejects(f.host.dispatch('baseline'));
  const pending = (await f.host.inspect()).dispatch.pending;
  const envelope = f.notAdmitted(pending, { receiptId: 'crashed-baseline-denial' });
  const ledger = new DispatchLedger({ journal: f.journal('dispatch'),
    experimentId: f.config.experimentId, configDigest: f.identity.configDigest });
  const controller = new LearningController({ journal: f.journal('controller'), trust: f.trust, clock: () => f.controls.now });
  // Reproduce the durable boundary with the actual two stores: the receipt and
  // controller failure are recorded, but the process never completes the ledger.
  await ledger.observe(pending.operation.id, 'not-admitted', JSON.stringify(envelope));
  await controller.recordBaselineNotAdmitted(pending.operation, envelope);
  // Another recovery read the earlier state and selected receipt B after the
  // first recovery committed marker A. Both observations must remain available.
  const intervening = f.notAdmitted(pending, { receiptId: 'intervening-baseline-denial' });
  await ledger.observe(pending.operation.id, 'not-admitted', JSON.stringify(intervening));
  const interrupted = await f.host.inspect(), before = await journalSnapshots(f);
  assert.equal(interrupted.state.baselineNonAdmission.receiptDigest, digest(JSON.stringify(envelope)));
  assert.equal(interrupted.dispatch.pending.operation.id, pending.operation.id);
  assert.equal(interrupted.dispatch.pending.notAdmitted, JSON.stringify(intervening));
  assert.equal(interrupted.dispatch.pending.resolution, null);
  await f.reopen(); assert.deepEqual(await f.host.inspect(), interrupted);
  const pendingStatus = await f.host.status();
  assert.deepEqual(pendingStatus.baseline, { status: 'failed', failureCode: 'not-admitted' });
  assert.deepEqual(pendingStatus.dispatch.pending, { operationId: pending.operation.id, kind: 'baseline', stage: 'not-admitted-observed' });
  const alternatives = [
    intervening,
    // Same facts and receipt ID, valid signer, different signed wire bytes.
    f.seal('budget', Object.fromEntries(Object.entries(envelope.body).reverse())),
  ];
  for (const altered of alternatives) {
    assert.notEqual(JSON.stringify(altered), JSON.stringify(envelope));
    await assert.rejects(f.host.recordNotAdmitted(altered));
    assert.deepEqual(await journalSnapshots(f), before);
    assert.deepEqual(await f.host.inspect(), interrupted);
  }
  const status = await f.host.recordNotAdmitted(envelope), finished = await journalSnapshots(f);
  assert.deepEqual(finished.controller, before.controller, 'finishing the ledger must not replay the controller transition');
  assert.equal(finished.dispatch.events.at(-1).type, 'completed');
  assert.equal(finished.dispatch.events.at(-1).observationDigest, digest(JSON.stringify(envelope)));
  const closed = await f.host.inspect();
  assert.deepEqual(closed.state, interrupted.state); assert.equal(closed.dispatch.pending, null);
  assert.deepEqual(closed.dispatch.entries[0].resolution, { kind: 'not-admitted', receiptId: envelope.body.receiptId });
  assert.equal(closed.dispatch.entries[0].notAdmitted, JSON.stringify(envelope));
  assert.deepEqual(closed.dispatch.entries[0].observations, interrupted.dispatch.entries[0].observations);
  assert.deepEqual(status.baseline, { status: 'failed', failureCode: 'not-admitted' });
  await f.reopen(); await assert.rejects(f.host.recordNotAdmitted(envelope));
  await assert.rejects(f.host.dispatch('baseline'));
  assert.deepEqual(await journalSnapshots(f), finished);
  assert.equal(f.admissions.length, 1); assert.deepEqual(f.settlements, []);
  assert.deepEqual(f.sessions, []); assert.deepEqual(f.turnRequests, []);
});

test('a completed baseline denial without a controller disposition cannot reopen as a healthy experiment', async t => {
  const f = fixture(t); await f.start(); f.controls.admission = 'not-admitted';
  await assert.rejects(f.host.dispatch('baseline'));
  const pending = (await f.host.inspect()).dispatch.pending, envelope = f.notAdmitted(pending);
  const ledger = new DispatchLedger({ journal: f.journal('dispatch'),
    experimentId: f.config.experimentId, configDigest: f.identity.configDigest });
  await ledger.observe(pending.operation.id, 'not-admitted', JSON.stringify(envelope));
  await ledger.complete(pending.operation.id, { kind: 'not-admitted', receiptId: envelope.body.receiptId },
    digest(JSON.stringify(envelope)));
  const before = await journalSnapshots(f);
  await assert.rejects(openLearningHost(f.options));
  assert.deepEqual(await journalSnapshots(f), before);
  assert.equal(f.admissions.length, 1); assert.deepEqual(f.settlements, []);
  assert.deepEqual(f.sessions, []); assert.deepEqual(f.turnRequests, []);
});

test('explicit phases qualify a candidate across restart while leaving activation under separate authority', async t => {
  const f = fixture(t), attempt = await readyAttempt(f);
  await f.host.dispatch('proposal', attempt.attemptId);
  let inspected = await f.host.inspect(); assert.equal(inspected.state.attempts[0].status, 'ready');
  assert.equal(f.admissions.length, 2); assert.equal(f.turnRequests.length, 5);
  await f.reopen(); await f.host.dispatch('screen', attempt.attemptId);
  inspected = await f.host.inspect(); assert.equal(inspected.state.attempts[0].status, 'provisional');
  assert.equal(f.admissions.length, 3); assert.equal(f.turnRequests.length, 11);
  await f.reopen(); await f.host.dispatch('confirmation', attempt.attemptId);
  inspected = await f.host.inspect();
  assert.equal(inspected.state.attempts[0].status, 'confirmed');
  assert.equal(inspected.state.versions.filter(item => item.confirmed).length, 2);
  assert.equal(inspected.state.activeVersionId, inspected.state.baseVersion.id);
  assert.deepEqual(inspected.state.activationHistory, []); assert.equal(inspected.dispatch.pending, null);
  assert.equal(f.admissions.length, 4); assert.equal(f.settlements.length, 4); assert.equal(f.turnRequests.length, 35);
  assert.equal(inspected.state.budget.spentMicros, 3500); assert.equal(inspected.state.budget.reservedMicros, 0);
  const target = inspected.state.versions.find(item => item.id !== inspected.state.baseVersion.id);
  await assert.rejects(f.host.activateVersion(target.id, null));
  assert.equal((await f.host.inspect()).state.activeVersionId, inspected.state.baseVersion.id);
  await f.reopen(); assert.equal((await f.host.status()).counts.confirmed, 1);
});
