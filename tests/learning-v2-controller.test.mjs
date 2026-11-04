import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { LearningController } from '../scripts/learning-v2/controller.mjs';
import { MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { POLICY, configuration, digest, procedure, procedureFingerprint } from '../scripts/learning-v2/contracts.mjs';
import { reviewerInstructions } from '../scripts/learning-v2/prompts.mjs';
import { dispatchManagedOperation } from '../scripts/learning-v2/runtime.mjs';

// All receipts, keys, source identities, counts and dollar amounts in this file
// are synthetic fixtures. Only the managed test runner may execute the suite;
// it does not contact a model, gateway, remote service, or held-out dataset.
const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];
const NOW = Date.UTC(2026, 10, 4, 12, 0, 0);
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const timeWindow = () => ({
  issuedAt: new Date(NOW - 1000).toISOString(),
  expiresAt: new Date(NOW + 30 * 60 * 1000).toISOString(),
});

function rule(label = 'candidate', changes = {}) {
  return {
    scope: 'concurrency',
    languages: ['javascript'],
    applicability: 'A JavaScript service updates a value derived from shared mutable state.',
    trigger: 'A read of shared state determines a later write to that state.',
    evidence: `Trace the read and write and inspect the revision predicate: ${label}.`,
    action: `Report a missing atomic guard only when another write can intervene: ${label}.`,
    sufficientGuard: 'A verified compare-and-swap predicate covers the same revision and target.',
    ...changes,
  };
}

function historyItem(id, outcome, value) {
  return { id, outcome, procedure: value, sourceRef: 'synthetic-history-source' };
}

function stateIdentity(state) {
  return {
    experimentId: state.config.experimentId,
    configDigest: state.configDigest,
    sourceCommit: state.config.sourceCommit,
  };
}

async function rig({ history = [], withBaseline = true, withGate = true, extraCases = [],
  openingSpentMicros = 2_000_000, openingReservedMicros = 0,
  openingCeilingMicros = POLICY.programmeCeilingMicros } = {}) {
  const privateKeys = {};
  const trust = {};
  for (const role of ROLES) {
    const pair = generateKeyPairSync('ed25519');
    privateKeys[role] = pair.privateKey;
    trust[role] = {
      publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      pinnedFingerprint: sha(pair.publicKey.export({ type: 'spki', format: 'der' })),
    };
  }
  trust.budget.gatewayId = 'synthetic-global-gateway';
  let serial = 0;
  const result = {
    trust,
    journal: new MemoryJournal(),
    next: prefix => `${prefix}-${++serial}`,
    sign: (role, body) => ({
      body,
      signature: sign(null, Buffer.from(JSON.stringify(body)), privateKeys[role]).toString('base64'),
    }),
  };
  result.controller = new LearningController({ journal: result.journal, trust, clock: () => NOW });
  result.config = configuration({
    experimentId: 'controller-test',
    sourceCommit: 'a'.repeat(40),
    benchmarkDigest: sha('synthetic development fixture manifest'),
    scorerDigest: sha('synthetic independently owned scorer'),
    model: 'tfy-managed/test-model',
    scope: 'concurrency',
    baseInstructions: 'Review the supplied code. Return complete structured findings.',
    firstPassInstructionsDigest: sha('Review the supplied code. Return complete structured findings.'),
    runtimeDigest: sha('synthetic frozen TrueForge runtime and parameters'),
    gatePolicy: {
      targetId: 'synthetic-gate-keeper-target',
      presetDigest: sha('synthetic full mandatory managed preset'),
      outputProfileDigest: sha('synthetic mandatory managed output profile'),
      effectiveTreeDigest: sha('synthetic complete source tree'),
    },
    budgetId: 'synthetic-cumulative-programme',
    cases: [
      { caseId: 'fit-js', split: 'fit', scope: 'concurrency', expectedBugs: 10, passes: 2, learnerVisible: true },
      { caseId: 'check-js', split: 'check', scope: 'concurrency', expectedBugs: 10, passes: 2, learnerVisible: false },
      ...extraCases,
    ],
  });
  const normalizedHistory = history.map(item => ({ ...clone(item), procedure: procedure(item.procedure, item.procedure.scope) }));
  const trustPins = {
    ...Object.fromEntries(ROLES.map(role => [role, trust[role].pinnedFingerprint])),
    gatewayId: trust.budget.gatewayId,
  };
  const configDigest = digest({ config: result.config, policy: POLICY, trustPins, history: normalizedHistory });
  const initialBudget = {
    schema: 'gk-learning-v2-budget-state',
    receiptId: result.next('initial-budget'),
    experimentId: result.config.experimentId,
    sourceCommit: result.config.sourceCommit,
    configDigest,
    budgetId: result.config.budgetId,
    gatewayId: trust.budget.gatewayId,
    provider: POLICY.provider,
    global: true,
    ceilingMicros: openingCeilingMicros,
    spentMicros: openingSpentMicros,
    reservedMicros: openingReservedMicros,
    ...timeWindow(),
  };
  result.initialBudget = result.sign('budget', initialBudget);
  await result.controller.initialize(result.config, { history, budgetEnvelope: result.initialBudget });
  if (withGate) await installGate(result);
  if (withBaseline) {
    const plan = await result.controller.planBaseline();
    const operation = await reserve(result, 'baseline');
    const body = evaluationBody(result, plan, operation);
    const envelope = result.sign('evaluation', body);
    await result.controller.recordBaseline(envelope);
    await settle(result, operation);
    result.baseline = { plan, operation, body, envelope };
  }
  return result;
}

async function installGate(r) {
  const state = await r.controller.state();
  await r.controller.recordManagedGate(r.sign('evaluation', {
    schema: 'gk-learning-v2-managed-gate', receiptId: r.next('managed-gate'),
    ...stateIdentity(state), ...state.config.gatePolicy,
    status: 'passed', fullSuite: true, independent: true,
    baseCurrent: true, cleanupComplete: true, noSkippedChecks: true,
    runId: r.next('managed-run'), rawLogsDigest: sha('synthetic complete gate logs'),
  }));
}

async function reserve(r, kind, attemptId = null, leaseChanges = {}) {
  const request = await r.controller.executionRequest(kind, attemptId);
  const operation = {
    id: r.next(`operation-${kind}`), kind, attemptId,
    namespace: request.namespace, requestDigest: digest(request),
  };
  const envelope = await operationLease(r, operation, request, leaseChanges);
  const reserved = await r.controller.reserveOperation(operation, envelope);
  return { ...reserved, request, envelope };
}

async function operationLease(r, operation, request, changes = {}) {
  const state = await r.controller.state();
  return r.sign('budget', {
    schema: 'gk-learning-v2-operation-lease', receiptId: r.next('lease'),
    ...stateIdentity(state), ...operation,
    budgetId: state.config.budgetId, gatewayId: r.trust.budget.gatewayId,
    provider: POLICY.provider, model: state.config.model, global: true,
    ceilingMicros: POLICY.programmeCeilingMicros,
    managedGateDigest: state.gate?.digest || sha('no gate'),
    namespaceExclusive: true, providerLimitEnforced: true,
    maxCalls: request.requiredCalls, reservationMicros: 10_000,
    spentMicros: state.budget.spentMicros, reservedMicros: 10_000,
    ...timeWindow(), ...changes,
  });
}

async function baselineIntent(r) {
  const request = await r.controller.executionRequest('baseline');
  const operation = { id: r.next('baseline-intent'), kind: 'baseline', attemptId: null,
    namespace: request.namespace, requestDigest: digest(request) };
  return { operation, request };
}

async function baselineNotAdmitted(r, operation, changes = {}, role = 'budget') {
  const state = await r.controller.state();
  return r.sign(role, {
    schema: 'gk-learning-v2-operation-not-admitted', receiptId: r.next('baseline-not-admitted'),
    ...stateIdentity(state), operationId: operation.id, requestDigest: operation.requestDigest,
    budgetId: state.config.budgetId, gatewayId: r.trust.budget.gatewayId,
    provider: POLICY.provider, global: true, ceilingMicros: POLICY.programmeCeilingMicros,
    status: 'not-admitted', reservationExists: false, actualCalls: 0, actualMicros: 0,
    ...changes,
  });
}

async function settle(r, operation, changes = {}) {
  const state = await r.controller.state();
  const body = {
    schema: 'gk-learning-v2-operation-settlement', receiptId: r.next('settlement'),
    ...stateIdentity(state), operationId: operation.id, leaseId: operation.leaseId,
    budgetId: state.config.budgetId, gatewayId: r.trust.budget.gatewayId,
    provider: POLICY.provider, global: true, ceilingMicros: POLICY.programmeCeilingMicros,
    status: 'settled', actualCalls: operation.maxCalls, actualMicros: operation.maxCalls,
    spentMicros: state.budget.spentMicros + operation.maxCalls, reservedMicros: 0,
    ...changes,
  };
  const envelope = r.sign('budget', body);
  await r.controller.settleOperation(operation.id, envelope);
  return envelope;
}

function evaluationBody(r, expectation, operation, { fit = 2, check = 2, reuseFrom = null } = {}) {
  const receiptId = r.next('evaluation');
  return {
    schema: 'gk-learning-v2-evaluation', receiptId,
    ...Object.fromEntries(Object.entries(clone(expectation)).filter(([key]) => key !== 'cases')),
    operationId: operation.id, requestDigest: operation.requestDigest,
    provider: 'truefoundry', memory: 'off', complete: true,
    cases: expectation.cases.map(item => {
      const original = reuseFrom?.cases.find(value => value.caseId === item.caseId);
      const applicable = expectation.applicableCaseIds.includes(item.caseId);
      return {
        caseId: item.caseId,
        caught: original && !applicable ? original.caught : item.split === 'fit' ? fit : check,
        falseAlarms: original && !applicable ? original.falseAlarms : 0,
        passes: [1, 2].map(pass => {
          if (original && (pass === 1 || !applicable)) {
            return { ...clone(original.passes.find(value => value.pass === pass)), reused: true, originReceiptId: reuseFrom.receiptId };
          }
          const callId = `${receiptId}:${item.caseId}:pass:${pass}`;
          return {
            pass, callId, sessionId: `${receiptId}:${item.caseId}`, turnId: `${receiptId}:turn:${pass}`,
            inputDigest: sha(`${pass === 1 ? r.config.firstPassInstructionsDigest : expectation.promptDigest}:${item.caseId}:${pass}`),
            outputDigest: sha(`synthetic completed output:${callId}`),
            status: 'complete', finishReason: 'stop', parseValid: true, empty: false,
            truncated: false, toolCalls: 0, reused: false, originReceiptId: null,
          };
        }),
      };
    }),
  };
}

async function novelty(r, attempt, candidate, operation, { verdict = 'novel', coverageCaseIds, relations = {} } = {}) {
  const state = await r.controller.state();
  const references = [...state.history, ...state.attempts.filter(item => item.candidate).map(item => ({ id: item.id }))];
  const body = {
    schema: 'gk-learning-v2-novelty', receiptId: r.next('novelty'),
    ...stateIdentity(state), attemptId: attempt.attemptId,
    operationId: operation.id, requestDigest: operation.requestDigest,
    candidateDigest: procedureFingerprint(procedure(candidate, state.config.scope)),
    incumbentVersionId: state.activeVersionId, originalVersionId: state.baseVersion.id,
    historyDigest: attempt.historyDigest, policyVersion: 'gk-procedure-equivalence-v1',
    sourceScopeVerified: true, verdict,
    comparisons: references.map((item, index) => ({
      priorId: item.id,
      relation: relations[item.id] || (verdict === 'equivalent' && index === 0 ? 'equivalent' :
        verdict === 'uncertain' ? 'uncertain' : 'distinct'),
      reason: `HOST_REVIEW_REASON_CANARY: reviewed trigger, evidence, action, guard and applicability for ${item.id}.`,
    })),
    coverageCaseIds: coverageCaseIds || state.config.cases.filter(item => item.scope === state.config.scope).map(item => item.caseId),
  };
  return r.sign('novelty', body);
}

async function propose(r, candidate = rule(), options = {}) {
  const attempt = await r.controller.beginAttempt();
  const operation = await reserve(r, 'proposal', attempt.attemptId);
  const envelope = options.noReview ? null : await novelty(r, attempt, candidate, operation, options);
  await r.controller.recordProposal(attempt.attemptId, candidate, envelope);
  if (options.settle !== false) await settle(r, operation);
  return { ...attempt, operation, envelope };
}

async function screen(r, attemptId, { incumbentFit = 2, candidateFit = 3, mutate, settle: shouldSettle = true } = {}) {
  const plan = await r.controller.planScreen(attemptId);
  const operation = await reserve(r, 'screen', attemptId);
  const bodies = {
    incumbent: evaluationBody(r, plan.incumbent, operation, { fit: incumbentFit }),
  };
  bodies.candidate = evaluationBody(r, plan.candidate, operation, { fit: candidateFit, reuseFrom: bodies.incumbent });
  if (mutate) mutate(bodies, plan, operation);
  const envelopes = Object.fromEntries(Object.entries(bodies).map(([arm, body]) => [arm, r.sign('evaluation', body)]));
  await r.controller.recordScreen(attemptId, envelopes);
  if (shouldSettle) await settle(r, operation);
  return { plan, operation, bodies, envelopes };
}

async function confirm(r, attemptId, { incumbentFit = 2, candidateFits = [3, 3, 3], mutate, settle: shouldSettle = true } = {}) {
  const plan = await r.controller.planConfirmation(attemptId);
  const operation = await reserve(r, 'confirmation', attemptId);
  const bodies = plan.pairs.map((pair, index) => Object.fromEntries(pair.order.map(arm => [arm,
    evaluationBody(r, pair.expectations[arm], operation, {
      fit: arm === 'candidate' ? candidateFits[index] : arm === 'incumbent' ? incumbentFit : 2,
    }),
  ])));
  if (mutate) mutate(bodies, plan, operation);
  const envelopes = bodies.map(pair => Object.fromEntries(Object.entries(pair).map(([arm, body]) => [arm, r.sign('evaluation', body)])));
  await r.controller.recordConfirmation(attemptId, envelopes);
  if (shouldSettle) await settle(r, operation);
  return { plan, operation, bodies, envelopes };
}

async function approval(r, versionId, action = 'activate') {
  const state = await r.controller.state();
  const target = state.versions.find(item => item.id === versionId);
  return r.sign('activation', {
    schema: 'gk-learning-v2-activation', receiptId: r.next('activation'),
    ...stateIdentity(state), action, versionId, incumbentVersionId: state.activeVersionId,
    originalVersionId: state.baseVersion.id, evidenceDigest: target?.evidenceDigest || null,
    purpose: 'experiment-incumbent-only', ...timeWindow(),
  });
}

const lastAttempt = state => state.attempts.at(-1);

test('ten attempted cycles include invalid, exact duplicate, paraphrase and uncertain outcomes without replacement attempts', async () => {
  const rejected = rule('rejected-procedure');
  const r = await rig({ history: [historyItem('legacy-negative', 'rejected', rejected)] });
  const invalid = { ...rule('invalid'), learnerApproved: true };
  await propose(r, invalid, { noReview: true });
  const exact = { ...clone(rejected), languages: ['JAVASCRIPT'], action: `  ${rejected.action.replaceAll(' ', '   ')}  ` };
  await propose(r, exact, { noReview: true });
  const paraphrase = { ...rule('paraphrase'), action: 'Flag the same stale-read overwrite using different words.' };
  await propose(r, paraphrase, { verdict: 'equivalent' });
  await propose(r, rule('uncertain'), { verdict: 'uncertain' });
  await propose(r, rule('not-applicable'), { coverageCaseIds: [] });
  for (let index = 6; index <= 10; index += 1) await propose(r, rule(`uncertain-${index}`), { verdict: 'uncertain' });
  const state = await r.controller.state();
  assert.equal(state.attempts.length, 10);
  assert.deepEqual(state.attempts.slice(0, 5).map(item => item.status), ['invalid', 'duplicate', 'duplicate', 'unresolved', 'noCoverage']);
  assert.ok(state.attempts.every(item => item.screen === null));
  assert.equal(state.activeVersionId, state.baseVersion.id);
  await assert.rejects(r.controller.beginAttempt(), /ten attempt limit/);
  const reopened = new LearningController({ journal: r.journal, trust: r.trust, clock: () => NOW });
  await assert.rejects(reopened.beginAttempt(), /ten attempt limit/);
  await assert.rejects(reopened.initialize(r.config, { budgetEnvelope: r.initialBudget }), /already exists/);
  assert.equal((await reopened.status()).counts.attempted, 10);
});

test('screen gain creates only a provisional candidate and cannot change or activate the incumbent', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('screen-positive'));
  await screen(r, attempt.attemptId);
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'provisional');
  assert.equal(lastAttempt(state).screen.decision.gain, 1);
  assert.equal(state.activeVersionId, state.baseVersion.id);
  assert.equal(state.versions.length, 1);
  assert.deepEqual((await r.controller.learnerInput()).confirmedProcedures, []);
  await assert.rejects(r.controller.activateVersion(lastAttempt(state).version.id, {}), /pending|confirmed different/);
});

test('shared category words do not ban a reviewed distinct sufficient guard or procedure', async () => {
  const rejected = rule('shared-category');
  const r = await rig({ history: [historyItem('prior-concurrency-rule', 'rejected', rejected)] });
  const distinct = {
    ...clone(rejected),
    evidence: 'Compare both the ownership epoch and the per-record version before identifying an ABA transition.',
    sufficientGuard: 'A conditional write checks ownership epoch and record version together.',
  };
  const attempt = await propose(r, distinct);
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).id, attempt.attemptId);
  assert.equal(lastAttempt(state).status, 'ready');
  assert.equal(lastAttempt(state).novelty.comparisons[0].relation, 'distinct');
});

test('a novelty label cannot override an unresolved comparison or omit a prior procedure', async () => {
  for (const missing of [false, true]) {
    const r = await rig({ history: [historyItem('prior-rule', 'rejected', rule('prior-rule'))] });
    const attempt = await r.controller.beginAttempt();
    const operation = await reserve(r, 'proposal', attempt.attemptId);
    const candidate = rule('needs-comparison');
    const review = await novelty(r, attempt, candidate, operation);
    if (missing) review.body.comparisons = [];
    else review.body.comparisons[0].relation = 'uncertain';
    await r.controller.recordProposal(attempt.attemptId, candidate, r.sign('novelty', review.body));
    await settle(r, operation);
    const state = await r.controller.state();
    assert.equal(lastAttempt(state).status, 'unresolved');
    assert.equal(state.versions.length, 1);
    assert.equal(lastAttempt(state).screen, null);
  }
});

test('three preplanned fresh pairs create an immutable artifact; separate authorization activates and rolls back it', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('confirmed-procedure'));
  await screen(r, attempt.attemptId);
  const confirmation = await confirm(r, attempt.attemptId);
  assert.deepEqual(confirmation.plan.pairs.map(pair => pair.order), [
    ['incumbent', 'candidate'], ['candidate', 'incumbent'], ['incumbent', 'candidate'],
  ]);
  assert.equal(confirmation.plan.additionalPairs, 0);
  let state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'confirmed');
  assert.equal(state.activeVersionId, state.baseVersion.id);
  assert.equal(state.versions.length, 2);
  const candidate = state.versions.find(item => item.id !== state.baseVersion.id);
  assert.equal(candidate.confirmed, true);
  assert.equal(candidate.configDigest, state.configDigest);
  const authorization = await approval(r, candidate.id);
  await r.controller.activateVersion(candidate.id, authorization);
  state = await r.controller.state();
  assert.equal(state.activeVersionId, candidate.id);
  assert.equal((await r.controller.learnerInput()).confirmedProcedures.length, 1);
  await r.controller.activateVersion(state.baseVersion.id, await approval(r, state.baseVersion.id, 'rollback'), 'rollback');
  state = await r.controller.state();
  assert.equal(state.activeVersionId, state.baseVersion.id);
  assert.equal(state.versions.length, 2);
  assert.deepEqual(state.activationHistory.map(item => item.action), ['activate', 'rollback']);
  await assert.rejects(r.controller.activateVersion(candidate.id, authorization), /receipt replay/);
});

test('after a confirmed incumbent is activated, confirmation separately measures original BASE and incumbent', async () => {
  const r = await rig();
  const first = await propose(r, rule('first-accepted'));
  await screen(r, first.attemptId);
  await confirm(r, first.attemptId);
  let state = await r.controller.state();
  await r.controller.activateVersion(lastAttempt(state).version.id, await approval(r, lastAttempt(state).version.id));
  const second = await propose(r, rule('second-accepted'));
  await screen(r, second.attemptId, { incumbentFit: 3, candidateFit: 4 });
  const confirmation = await confirm(r, second.attemptId, { incumbentFit: 3, candidateFits: [4, 4, 4] });
  assert.deepEqual(confirmation.plan.pairs.map(pair => pair.order), [
    ['base', 'incumbent', 'candidate'], ['candidate', 'incumbent', 'base'], ['base', 'incumbent', 'candidate'],
  ]);
  state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'confirmed');
  assert.ok(lastAttempt(state).confirmation.every(pair => pair.evaluated.base && pair.decision.passed));
  assert.equal(state.versions.find(item => item.id === lastAttempt(state).version.id).rules.length, 2);
});

test('invalid first-pass output remains unscored and cannot make the candidate provisional', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('first-pass-failure'));
  await screen(r, attempt.attemptId, { mutate: bodies => {
    bodies.incumbent.cases[0].passes[0].finishReason = 'length';
    bodies.incumbent.cases[0].passes[0].truncated = true;
  } });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.equal(lastAttempt(state).screen, null);
  assert.match(lastAttempt(state).reason, /complete valid output/);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.activeVersionId, state.baseVersion.id);
});

test('an incomplete baseline consumes its admitted operation and cannot be retried into a valid control', async () => {
  const r = await rig({ withBaseline: false });
  const plan = await r.controller.planBaseline();
  const operation = await reserve(r, 'baseline');
  const body = evaluationBody(r, plan, operation);
  body.cases[0].passes[0].empty = true;
  await r.controller.recordBaseline(r.sign('evaluation', body));
  await settle(r, operation);
  const state = await r.controller.state();
  assert.equal(state.baseline, null);
  assert.match(state.baselineError, /complete valid output/);
  assert.equal(state.operations[0].consumed, true);
  await assert.rejects(r.controller.beginAttempt(), /complete baseline/);
  body.cases[0].passes[0].empty = false;
  await assert.rejects(r.controller.recordBaseline(r.sign('evaluation', body)), /admitted operation/);
  await assert.rejects(reserve(r, 'baseline'), /baseline request state/);
});

test('screening cache misses cannot silently buy a new first pass', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('cache-miss'));
  let fallbackCallId;
  await screen(r, attempt.attemptId, { mutate: bodies => {
    const pass = bodies.candidate.cases[0].passes[0];
    pass.reused = false;
    pass.originReceiptId = null;
    pass.callId = fallbackCallId = 'forbidden-fallback-call';
    pass.sessionId = 'forbidden-fallback-session';
    pass.turnId = 'forbidden-fallback-turn';
  } });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.match(lastAttempt(state).reason, /paired screening cache|fresh fallback/);
  assert.equal(state.observedCalls.some(call => call.callId === fallbackCallId), false);
});

test('screening reuses both passes of same-fault cases outside reviewed applicability', async () => {
  const r = await rig({ extraCases: [
    { caseId: 'fit-other-stack', split: 'fit', scope: 'concurrency', expectedBugs: 10, passes: 2, learnerVisible: true },
  ] });
  const attempt = await propose(r, rule('javascript-only'), { coverageCaseIds: ['fit-js', 'check-js'] });
  const screening = await screen(r, attempt.attemptId);
  const nonApplicable = screening.bodies.candidate.cases.find(item => item.caseId === 'fit-other-stack');
  assert.equal(screening.operation.request.requiredCalls, 8);
  assert.deepEqual(screening.plan.candidate.applicableCaseIds, ['fit-js', 'check-js']);
  assert.ok(nonApplicable.passes.every(pass => pass.reused));
  assert.equal(lastAttempt(await r.controller.state()).status, 'provisional');
});

test('an off-scope second-pass cache mismatch is unresolved without fallback', async () => {
  const r = await rig({ extraCases: [
    { caseId: 'check-input-validation', split: 'check', scope: 'input-validation', expectedBugs: 10, passes: 2, learnerVisible: false },
  ] });
  const attempt = await propose(r, rule('off-scope-cache'));
  await screen(r, attempt.attemptId, { mutate: bodies => {
    bodies.candidate.cases.find(item => item.caseId === 'check-input-validation').passes[1].inputDigest = sha('wrong cache input');
  } });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.match(lastAttempt(state).reason, /paired screening cache/);
});

test('identical off-scope replies cannot manufacture different merged scores', async () => {
  const r = await rig({ extraCases: [
    { caseId: 'fit-other-stack', split: 'fit', scope: 'concurrency', expectedBugs: 10, passes: 2, learnerVisible: true },
  ] });
  const attempt = await propose(r, rule('unchanged-replies'), { coverageCaseIds: ['fit-js', 'check-js'] });
  await screen(r, attempt.attemptId, { mutate: bodies => {
    bodies.candidate.cases.find(item => item.caseId === 'fit-other-stack').caught += 1;
  } });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.match(lastAttempt(state).reason, /inconsistent scores/);
  assert.equal(state.versions.length, 1);
});

test('confirmation rejects a screening call relabelled as fresh', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('replayed-confirmation'));
  const screening = await screen(r, attempt.attemptId);
  await confirm(r, attempt.attemptId, { mutate: bodies => {
    bodies[0].candidate.cases[0].passes[1].callId = screening.bodies.candidate.cases[0].passes[1].callId;
  } });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.match(lastAttempt(state).reason, /model call replay/);
  assert.equal(state.versions.length, 1);
});

test('confirmation does not accept a high average when one of its three frozen pairs fails', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('mixed-confirmation'));
  await screen(r, attempt.attemptId);
  await confirm(r, attempt.attemptId, { candidateFits: [5, 2, 5] });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'rejected');
  assert.deepEqual(lastAttempt(state).confirmation.map(pair => pair.decision.passed), [true, false, true]);
  assert.equal(state.versions.length, 1);
  await assert.rejects(r.controller.planConfirmation(attempt.attemptId), /invalid attempt transition/);
});

test('extra confirmation pairs cannot rescue a failed preplanned experiment', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('optional-extension'));
  await screen(r, attempt.attemptId);
  await confirm(r, attempt.attemptId, { mutate: bodies => { bodies.push(clone(bodies[0])); } });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.match(lastAttempt(state).reason, /exactly three/);
  assert.equal(state.versions.length, 1);
});

test('signed evidence from a different namespace or execution order cannot be substituted', async () => {
  for (const mutation of ['namespace', 'executionIndex', 'operationId', 'requestDigest']) {
    const r = await rig();
    const attempt = await propose(r, rule(`wrong-${mutation}`));
    await screen(r, attempt.attemptId, { mutate: bodies => {
      if (mutation === 'executionIndex') bodies.candidate.executionIndex += 1;
      else if (mutation === 'requestDigest') bodies.candidate.requestDigest = sha('different request');
      else bodies.candidate[mutation] += '-other';
    } });
    const state = await r.controller.state();
    assert.equal(lastAttempt(state).status, 'unresolved');
    assert.match(lastAttempt(state).reason, new RegExp(mutation));
  }
});

test('a consumed stage cannot replay evidence or reclaim its namespace', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('stage-replay'));
  const screening = await screen(r, attempt.attemptId);
  const before = await r.journal.read();
  await assert.rejects(r.controller.recordScreen(attempt.attemptId, screening.envelopes), /invalid attempt transition|consum/);
  await assert.rejects(r.controller.planScreen(attempt.attemptId), /invalid attempt transition/);
  const after = await r.journal.read();
  assert.equal(after.head, before.head);
  assert.equal((await r.controller.state()).namespaces.filter(value => value === screening.plan.candidate.namespace).length, 1);
});

test('negative, unproven and inactive positive procedures never enter learner or reviewer projections', async () => {
  const r = await rig({ history: [
    historyItem('negative-history', 'rejected', rule('HOST_REJECTED_CANARY')),
    historyItem('unproven-history', 'unproven', rule('HOST_UNPROVEN_CANARY')),
    historyItem('legacy-positive-history', 'legacy-positive', rule('HOST_LEGACY_POSITIVE_CANARY')),
  ] });
  const attempt = await propose(r, rule('CONFIRMED_POSITIVE_CANARY'));
  assert.doesNotMatch(JSON.stringify(attempt.operation.request.learner), /CANARY/);
  await screen(r, attempt.attemptId);
  let learner = JSON.stringify(await r.controller.learnerInput());
  assert.doesNotMatch(learner, /CANARY/);
  await confirm(r, attempt.attemptId);
  learner = JSON.stringify(await r.controller.learnerInput());
  assert.doesNotMatch(learner, /CANARY/);
  let state = await r.controller.state();
  await r.controller.activateVersion(lastAttempt(state).version.id, await approval(r, lastAttempt(state).version.id));
  learner = JSON.stringify(await r.controller.learnerInput());
  assert.match(learner, /CONFIRMED_POSITIVE_CANARY/);
  assert.doesNotMatch(learner, /HOST_REJECTED_CANARY|HOST_UNPROVEN_CANARY|HOST_LEGACY_POSITIVE_CANARY|HOST_REVIEW_REASON_CANARY/);
  state = await r.controller.state();
  const activeVersion = state.versions.find(item => item.id === state.activeVersionId);
  const first = reviewerInstructions({ originalInstructions: state.config.baseInstructions, activeVersion, scope: state.config.scope, caseId: 'fit-js', pass: 1 });
  const second = reviewerInstructions({ originalInstructions: state.config.baseInstructions, activeVersion, scope: state.config.scope, caseId: 'fit-js', pass: 2 });
  assert.equal(first, state.config.baseInstructions);
  assert.match(second, /CONFIRMED_POSITIVE_CANARY/);
  assert.doesNotMatch(second, /HOST_REJECTED_CANARY|HOST_UNPROVEN_CANARY|HOST_LEGACY_POSITIVE_CANARY|HOST_REVIEW_REASON_CANARY/);
  assert.doesNotMatch(JSON.stringify(await r.controller.status()), /CANARY/);
});

test('learner examples must be independently attributed to the original visible fit cases', async () => {
  const r = await rig();
  const state = await r.controller.state();
  const body = {
    schema: 'gk-learning-v2-fit-feedback', receiptId: r.next('fit-feedback'),
    ...stateIdentity(state), baselineReceiptId: state.baseline.receiptId, origin: 'original-baseline-fit-only',
    examples: [{ caseId: 'fit-js', code: 'const revision = readRevision();', feedback: 'ORIGINAL_FIT_FEEDBACK_CANARY' }],
  };
  const projected = await r.controller.learnerInput(r.sign('evaluation', body));
  assert.equal(projected.fitExamples[0].feedback, 'ORIGINAL_FIT_FEEDBACK_CANARY');
  assert.equal(Object.hasOwn(projected.fitExamples[0], 'caseId'), false);
  body.examples[0].caseId = 'check-js';
  await assert.rejects(r.controller.learnerInput(r.sign('evaluation', body)), /excluded learner example/);
  body.examples[0].caseId = 'fit-js';
  body.origin = 'rejected-candidate-feedback';
  await assert.rejects(r.controller.learnerInput(r.sign('evaluation', body)), /origin mismatch/);
});

test('model work requires the matching managed gate and complete source-bound call reservation', async () => {
  const r = await rig({ withBaseline: false, withGate: false });
  const plan = await r.controller.planBaseline();
  await assert.rejects(reserve(r, 'baseline'), /managed gate/);
  const fakeOperation = { id: 'not-reserved', requestDigest: sha('not-reserved') };
  await assert.rejects(r.controller.recordBaseline(r.sign('evaluation', evaluationBody(r, plan, fakeOperation))), /reserv|operation/i);
  await installGate(r);
  const request = await r.controller.executionRequest('baseline');
  await assert.rejects(reserve(r, 'baseline', null, { maxCalls: request.requiredCalls - 1 }), /call|lease/i);
  assert.equal((await r.controller.state()).operations.length, 0);
});

test('unresolved billing blocks a replacement attempt and cannot reset cumulative spend', async () => {
  const r = await rig();
  const attempt = await propose(r, rule('billing-unresolved'), { verdict: 'uncertain', settle: false });
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  await assert.rejects(r.controller.beginAttempt(), /billing unresolved|operation/);
  await assert.rejects(settle(r, attempt.operation, { spentMicros: 0 }), /spend|backwards/);
  assert.equal((await r.controller.state()).operations.at(-1).settled, false);
  await settle(r, attempt.operation);
  const next = await r.controller.beginAttempt();
  assert.equal(next.number, 2);
  assert.ok((await r.controller.status()).budget.observedSpentMicros >= 2_000_000);
});

test('complete baseline evidence cannot be settled as zero calls or release its billing hold', async () => {
  const r = await rig({ withBaseline: false });
  const plan = await r.controller.planBaseline();
  const operation = await reserve(r, 'baseline');
  await r.controller.recordBaseline(r.sign('evaluation', evaluationBody(r, plan, operation)));
  await assert.rejects(settle(r, operation, { actualCalls: 0, actualMicros: 0 }), /call count contradicts/);
  let state = await r.controller.state();
  assert.equal(state.operations[0].evidenceComplete, true);
  assert.equal(state.operations[0].observedFreshCalls, 4);
  assert.equal(state.operations[0].settled, false);
  assert.equal(state.budget.reservedMicros, 10_000);
  await assert.rejects(r.controller.beginAttempt(), /billing unresolved|operation/);
  await settle(r, operation);
  state = await r.controller.state();
  assert.equal(state.operations[0].actualCalls, 4);
  assert.equal(state.operations[0].actualMicros, 4);
});

test('reopening with the same budget key but a different gateway identity is rejected', async () => {
  const r = await rig();
  const changedTrust = clone(r.trust);
  changedTrust.budget.gatewayId = 'different-global-gateway';
  const reopened = new LearningController({ journal: r.journal, trust: changedTrust, clock: () => NOW });
  await assert.rejects(reopened.state(), /trusted signer changed/);
  assert.equal((await r.controller.state()).trustPins.gatewayId, r.trust.budget.gatewayId);
});

test('beginAttempt freezes verified original-fit feedback into the reserved execution request', async () => {
  const r = await rig();
  const state = await r.controller.state();
  const body = {
    schema: 'gk-learning-v2-fit-feedback', receiptId: r.next('frozen-fit-feedback'),
    ...stateIdentity(state), baselineReceiptId: state.baseline.receiptId, origin: 'original-baseline-fit-only',
    examples: [{ caseId: 'fit-js', code: 'const snapshot = readState();', feedback: 'FROZEN_ORIGINAL_FIT_FEEDBACK' }],
  };
  const envelope = r.sign('evaluation', body);
  const attempt = await r.controller.beginAttempt(envelope);
  const before = await r.controller.executionRequest('proposal', attempt.attemptId);
  body.examples[0].feedback = 'MUTATED_AFTER_ATTEMPT_RESERVATION';
  const after = await r.controller.executionRequest('proposal', attempt.attemptId);
  assert.equal(after.learner.fitExamples[0].feedback, 'FROZEN_ORIGINAL_FIT_FEEDBACK');
  assert.equal(Object.hasOwn(after.learner.fitExamples[0], 'caseId'), false);
  assert.equal(digest(after), digest(before));
  const operation = await reserve(r, 'proposal', attempt.attemptId);
  assert.equal(operation.requestDigest, digest(before));
  assert.doesNotMatch(JSON.stringify(operation.request.learner), /MUTATED_AFTER/);
});

test('an unconsumed operation cannot settle and cannot be retried under a different operation id', async () => {
  const r = await rig({ withBaseline: false });
  await r.controller.planBaseline();
  const operation = await reserve(r, 'baseline');
  const spentMicros = (await r.controller.state()).budget.spentMicros;
  await assert.rejects(settle(r, operation, { actualCalls: 0, actualMicros: 0, spentMicros }), /record evidence|explicitly abandon/);
  await assert.rejects(reserve(r, 'baseline'), /operation pending or reused/);
  let state = await r.controller.state();
  assert.equal(state.operations.length, 1);
  assert.equal(state.operations[0].consumed, false);
  assert.equal(state.operations[0].settled, false);
  await r.controller.abandonOperation(operation.id, 'Synthetic dispatch outcome is unresolved.');
  await settle(r, operation, { actualCalls: 0, actualMicros: 0, spentMicros });
  state = await r.controller.state();
  assert.equal(state.operations[0].consumed, true);
  assert.equal(state.operations[0].settled, true);
  await assert.rejects(reserve(r, 'baseline'), /baseline request state/);
  assert.equal((await r.controller.state()).operations.length, 1);
});

async function assertAmbiguousAttemptRecovery(kind) {
  const r = await rig();
  const attempt = kind === 'proposal' ? await r.controller.beginAttempt() :
    await propose(r, rule(`recovery-${kind}`));
  if (kind === 'screen') await r.controller.planScreen(attempt.attemptId);
  if (kind === 'confirmation') {
    await screen(r, attempt.attemptId);
    await r.controller.planConfirmation(attempt.attemptId);
  }
  const beforeDispatch = await r.controller.state();
  const counts = { admitted: 0, executed: 0, settled: 0 };
  let operation;
  const dispatch = {
    controller: r.controller, kind, attemptId: attempt.attemptId,
    operationId: r.next(`ambiguous-${kind}`),
    async admit({ operation: requested, request }) {
      counts.admitted++;
      return operationLease(r, requested, request);
    },
    async execute({ operation: reserved }) {
      operation = reserved;
      counts.executed++;
      throw new Error('Synthetic connection loss after dispatch; outcome unknown.');
    },
    async settle() {
      counts.settled++;
      throw new Error('Automatic settlement must not follow ambiguous execution.');
    },
  };
  await assert.rejects(dispatchManagedOperation(dispatch), /MANAGED_OPERATION_UNRESOLVED/);
  assert.deepEqual(counts, { admitted: 1, executed: 1, settled: 0 });
  const beforeRefusal = await r.controller.state();
  const journalBefore = await r.journal.read();
  assert.equal(beforeRefusal.operations.length, beforeDispatch.operations.length + 1);
  assert.equal(beforeRefusal.operations.at(-1).consumed, false);
  assert.equal(beforeRefusal.operations.at(-1).settled, false);
  assert.equal(beforeRefusal.budget.reservedMicros, operation.reservationMicros);

  await assert.rejects(r.controller.abandonAttempt(attempt.attemptId, 'Operator notes ambiguous execution.'),
    /abandon the pending operation instead/);
  assert.equal((await r.journal.read()).head, journalBefore.head);
  assert.deepEqual(await r.controller.state(), beforeRefusal);

  const reason = `Synthetic ${kind} outcome requires gateway reconciliation.`;
  await r.controller.abandonOperation(operation.id, reason);
  let state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.equal(lastAttempt(state).reason, reason);
  assert.equal(state.attempts.length, 1);
  assert.equal(state.operations.at(-1).consumed, true);
  assert.equal(state.operations.at(-1).settled, false);
  assert.equal(state.operations.at(-1).failureReason, reason);
  assert.equal(state.budget.reservedMicros, operation.reservationMicros);
  assert.equal(state.budget.spentMicros, beforeDispatch.budget.spentMicros);
  assert.equal(state.activeVersionId, beforeDispatch.activeVersionId);
  assert.equal(state.versions.length, beforeDispatch.versions.length);
  await assert.rejects(r.controller.beginAttempt(), /operation or billing unresolved/);
  await assert.rejects(r.controller.activateVersion(state.baseVersion.id, {}), /work is pending/);
  await assert.rejects(r.controller.settleOperation(operation.id, {}), /envelope/);
  assert.equal((await r.controller.state()).budget.reservedMicros, operation.reservationMicros);

  // The independent synthetic gateway reports a nonzero partial charge. The
  // timeout itself neither proves zero calls nor permits an automatic refund.
  await settle(r, operation, {
    actualCalls: 1, actualMicros: 7,
    spentMicros: beforeDispatch.budget.spentMicros + 7,
  });
  state = await r.controller.state();
  assert.equal(state.operations.at(-1).settled, true);
  assert.equal(state.operations.at(-1).actualCalls, 1);
  assert.equal(state.operations.at(-1).actualMicros, 7);
  assert.equal(state.budget.reservedMicros, 0);
  assert.equal(state.budget.spentMicros, beforeDispatch.budget.spentMicros + 7);
  const settledOperationCount = state.operations.length;
  await assert.rejects(dispatchManagedOperation({ ...dispatch, operationId: r.next('forbidden-phase-retry') }),
    /invalid attempt transition/);
  assert.deepEqual(counts, { admitted: 1, executed: 1, settled: 0 });
  assert.equal((await r.controller.state()).operations.length, settledOperationCount);

  const next = await r.controller.beginAttempt();
  state = await r.controller.state();
  assert.equal(next.number, 2);
  assert.notEqual(next.attemptId, attempt.attemptId);
  assert.equal(state.attempts[0].status, 'unresolved');
  assert.equal(state.attempts[0].id, attempt.attemptId);
  assert.equal(state.operations.length, settledOperationCount);
  assert.equal(state.operations.at(-1).id, operation.id);
  assert.equal(state.activeVersionId, beforeDispatch.activeVersionId);
  assert.deepEqual(counts, { admitted: 1, executed: 1, settled: 0 });
}

test('ambiguous proposal dispatch refuses attempt abandonment and remains explicitly settleable', async () => {
  await assertAmbiguousAttemptRecovery('proposal');
});

test('ambiguous screening dispatch refuses attempt abandonment and remains explicitly settleable', async () => {
  await assertAmbiguousAttemptRecovery('screen');
});

test('ambiguous confirmation dispatch refuses attempt abandonment and remains explicitly settleable', async () => {
  await assertAmbiguousAttemptRecovery('confirmation');
});

test('an attempt without an unconsumed operation can still be abandoned honestly', async () => {
  const r = await rig();
  const attempt = await r.controller.beginAttempt();
  const before = await r.controller.state();
  await r.controller.abandonAttempt(attempt.attemptId, 'No proposer operation was admitted.');
  const state = await r.controller.state();
  assert.equal(lastAttempt(state).status, 'unresolved');
  assert.equal(state.operations.length, before.operations.length);
  assert.equal(state.budget.reservedMicros, 0);
  assert.equal(state.budget.spentMicros, before.budget.spentMicros);
  const next = await r.controller.beginAttempt();
  assert.equal(next.number, 2);
});

test('authenticated baseline non-admission records one terminal outcome without changing money or admitted work', async () => {
  const r = await rig({ withBaseline: false });
  await r.controller.planBaseline();
  const { operation } = await baselineIntent(r);
  const envelope = await baselineNotAdmitted(r, operation);
  const before = await r.controller.state();
  const journalBefore = await r.journal.read();
  const expected = { operationId: operation.id, requestDigest: operation.requestDigest,
    receiptId: envelope.body.receiptId, receiptDigest: digest(JSON.stringify(envelope)) };
  assert.deepEqual(await r.controller.recordBaselineNotAdmitted(operation, envelope), expected);
  const after = await r.controller.state();
  assert.deepEqual(after, { ...before, baselineNonAdmission: expected,
    baselineError: 'Independent gateway confirmed that the baseline was not admitted.',
    receipts: [...before.receipts, envelope.body.receiptId] });
  const journalAfter = await r.journal.read();
  assert.equal(journalAfter.events.length, journalBefore.events.length + 1);
  assert.equal(journalAfter.events.at(-1).reason, 'baseline-not-admitted');
  assert.deepEqual(journalAfter.events.at(-1).state, after);
  assert.deepEqual(after.budget, before.budget);
  assert.deepEqual(after.operations, []);
  assert.deepEqual(after.observedCalls, []);
  assert.equal(after.baseline, null);
  assert.deepEqual((await r.controller.status()).baseline, { status: 'failed', failureCode: 'not-admitted' });
});

test('baseline non-admission rejects identity substitutions wrong signatures and nonzero usage without a state change', async () => {
  const r = await rig({ withBaseline: false });
  await r.controller.planBaseline();
  const { operation } = await baselineIntent(r);
  const envelope = await baselineNotAdmitted(r, operation);
  const before = await r.controller.state();
  const journalBefore = await r.journal.read();
  const operationChanges = [
    { id: '' }, { id: 'another-baseline-intent' }, { kind: 'proposal' }, { attemptId: 'attempt:1' },
    { namespace: 'other-baseline' }, { requestDigest: 'f'.repeat(64) }, { leaseId: 'not-a-prelease-operation' },
  ];
  for (const change of operationChanges) {
    await assert.rejects(r.controller.recordBaselineNotAdmitted({ ...operation, ...change }, envelope));
    assert.deepEqual(await r.controller.state(), before);
    assert.deepEqual(await r.journal.read(), journalBefore);
  }
  const receiptChanges = [
    { schema: 'gk-learning-v2-operation-settlement' }, { receiptId: '' },
    { experimentId: 'different-experiment' }, { configDigest: 'f'.repeat(64) },
    { sourceCommit: 'f'.repeat(40) }, { operationId: 'different-operation' },
    { requestDigest: 'f'.repeat(64) }, { budgetId: 'different-programme' },
    { gatewayId: 'different-gateway' }, { provider: 'different-provider' },
    { global: false }, { ceilingMicros: POLICY.programmeCeilingMicros + 1 },
    { status: 'admitted' }, { reservationExists: true }, { actualCalls: 1 }, { actualMicros: 1 },
  ];
  for (const change of receiptChanges) {
    const substituted = r.sign('budget', { ...clone(envelope.body), ...change });
    await assert.rejects(r.controller.recordBaselineNotAdmitted(operation, substituted));
    assert.deepEqual(await r.controller.state(), before);
    assert.deepEqual(await r.journal.read(), journalBefore);
  }
  const invalidEnvelopes = [
    r.sign('activation', clone(envelope.body)),
    { body: clone(envelope.body), signature: Buffer.alloc(64).toString('base64') },
  ];
  for (const invalid of invalidEnvelopes) await assert.rejects(r.controller.recordBaselineNotAdmitted(operation, invalid));
  let reads = 0;
  const accessor = clone(envelope);
  Object.defineProperty(accessor.body, 'actualCalls', { enumerable: true, get() { reads++; return 0; } });
  await assert.rejects(r.controller.recordBaselineNotAdmitted(operation, accessor));
  assert.equal(reads, 0);
  assert.deepEqual(await r.controller.state(), before);
  assert.deepEqual(await r.journal.read(), journalBefore);
});

test('baseline non-admission requires a planned unfailed baseline with a gate and no admitted operation', async () => {
  const scenarios = [];
  const unplanned = await rig({ withBaseline: false });
  scenarios.push({ r: unplanned, operation: { id: 'unplanned-baseline', kind: 'baseline', attemptId: null,
    namespace: `${unplanned.config.experimentId}:baseline`, requestDigest: sha('unplanned synthetic request') } });
  const ungated = await rig({ withBaseline: false, withGate: false });
  await ungated.controller.planBaseline();
  scenarios.push({ r: ungated, ...(await baselineIntent(ungated)) });
  const admitted = await rig({ withBaseline: false });
  await admitted.controller.planBaseline();
  const held = await baselineIntent(admitted);
  await admitted.controller.reserveOperation(held.operation, await operationLease(admitted, held.operation, held.request));
  scenarios.push({ r: admitted, ...held });
  const completed = await rig();
  const completedRequest = completed.baseline.operation.request;
  scenarios.push({ r: completed, operation: { id: 'completed-baseline', kind: 'baseline', attemptId: null,
    namespace: completedRequest.namespace, requestDigest: digest(completedRequest) } });
  const alreadyFailed = await rig({ withBaseline: false });
  await alreadyFailed.controller.planBaseline();
  const failedIntent = await baselineIntent(alreadyFailed);
  await alreadyFailed.controller.recordBaselineNotAdmitted(failedIntent.operation,
    await baselineNotAdmitted(alreadyFailed, failedIntent.operation));
  scenarios.push({ r: alreadyFailed, ...failedIntent });
  for (const { r, operation } of scenarios) {
    const envelope = await baselineNotAdmitted(r, operation);
    const before = await r.controller.state();
    const journalBefore = await r.journal.read();
    await assert.rejects(r.controller.recordBaselineNotAdmitted(operation, envelope), /baseline non-admission state|no admitted operation/);
    assert.deepEqual(await r.controller.state(), before);
    assert.deepEqual(await r.journal.read(), journalBefore);
  }
});

test('baseline non-admission rejects a previously consumed receipt identity before recording failure', async () => {
  const r = await rig({ withBaseline: false });
  await r.controller.planBaseline();
  const { operation } = await baselineIntent(r);
  const replay = await baselineNotAdmitted(r, operation, { receiptId: r.initialBudget.body.receiptId });
  const before = await r.controller.state();
  const journalBefore = await r.journal.read();
  await assert.rejects(r.controller.recordBaselineNotAdmitted(operation, replay), /receipt replay/);
  assert.deepEqual(await r.controller.state(), before);
  assert.deepEqual(await r.journal.read(), journalBefore);
  const fresh = await baselineNotAdmitted(r, operation);
  await r.controller.recordBaselineNotAdmitted(operation, fresh);
  assert.equal((await r.controller.state()).receipts.filter(id => id === fresh.body.receiptId).length, 1);
});

test('baseline non-admission survives restart and blocks request reservation reconciliation and dispatch retries', async () => {
  const r = await rig({ withBaseline: false });
  await r.controller.planBaseline();
  const { operation, request } = await baselineIntent(r);
  await r.controller.recordBaselineNotAdmitted(operation, await baselineNotAdmitted(r, operation));
  const stopped = await r.controller.state();
  const journalBefore = await r.journal.read();
  const retry = { ...operation, id: r.next('renamed-baseline-retry') };
  const lease = await operationLease(r, retry, request);
  const settlement = r.sign('budget', {
    schema: 'gk-learning-v2-operation-settlement', receiptId: r.next('forbidden-recovery-settlement'),
    ...stateIdentity(stopped), operationId: retry.id, leaseId: lease.body.receiptId,
    budgetId: stopped.config.budgetId, gatewayId: r.trust.budget.gatewayId,
    provider: POLICY.provider, global: true, ceilingMicros: POLICY.programmeCeilingMicros,
    status: 'settled', actualCalls: 0, actualMicros: 0,
    spentMicros: stopped.budget.spentMicros, reservedMicros: stopped.budget.reservedMicros,
  });
  const reopened = new LearningController({ journal: r.journal, trust: r.trust, clock: () => NOW });
  for (const controller of [r.controller, reopened]) {
    await assert.rejects(controller.executionRequest('baseline'), /baseline request state/);
    await assert.rejects(controller.reserveOperation(retry, lease), /baseline request state/);
    await assert.rejects(controller.reconcileAdmission(retry, lease, settlement, 'Forbidden new baseline recovery.'), /baseline request state/);
    await assert.rejects(controller.planBaseline(), /baseline already planned/);
    await assert.rejects(controller.beginAttempt(), /complete baseline required/);
  }
  const calls = { admitted: 0, executed: 0, settled: 0 };
  await assert.rejects(dispatchManagedOperation({ controller: reopened, kind: 'baseline', operationId: retry.id,
    async admit() { calls.admitted++; return lease; },
    async execute() { calls.executed++; return {}; },
    async settle() { calls.settled++; return settlement; },
  }), /baseline request state/);
  assert.deepEqual(calls, { admitted: 0, executed: 0, settled: 0 });
  assert.deepEqual(await reopened.state(), stopped);
  assert.deepEqual(await r.journal.read(), journalBefore);
});

test('baseline non-admission captures operation and original signing order before the first await', async () => {
  const r = await rig({ withBaseline: false });
  await r.controller.planBaseline();
  const { operation } = await baselineIntent(r);
  const originalOperation = clone(operation);
  const original = await baselineNotAdmitted(r, operation);
  const signed = r.sign('budget', Object.fromEntries(Object.entries(original.body).reverse()));
  const envelope = { signature: signed.signature, body: signed.body };
  const capturedBytes = JSON.stringify(envelope);
  const receiptId = envelope.body.receiptId;
  const before = await r.controller.state();
  const recording = r.controller.recordBaselineNotAdmitted(operation, envelope);
  operation.id = 'mutated-after-call'; operation.kind = 'proposal'; operation.requestDigest = 'f'.repeat(64);
  envelope.signature = 'mutated-after-call';
  envelope.body.receiptId = 'mutated-receipt'; envelope.body.actualCalls = 999;
  const retained = await recording;
  const expected = { operationId: originalOperation.id, requestDigest: originalOperation.requestDigest,
    receiptId, receiptDigest: digest(capturedBytes) };
  assert.deepEqual(retained, expected);
  retained.receiptId = 'mutated-return';
  const state = await r.controller.state();
  assert.deepEqual(state.baselineNonAdmission, expected);
  assert.equal(state.receipts.at(-1), receiptId);
  assert.deepEqual(state.budget, before.budget);
  assert.deepEqual(state.operations, before.operations);
});


test('US$50 total ceiling includes signed pre-existing spend and unsettled reservations', async () => {
  const r = await rig({ withBaseline: false, withGate: false,
    openingSpentMicros: 47_000_000, openingReservedMicros: 3_000_000 });
  const state = await r.controller.state();
  assert.equal(POLICY.version, 2);
  assert.equal(POLICY.programmeCeilingMicros, 50_000_000);
  assert.deepEqual(state.budget, {
    spentMicros: 47_000_000, reservedMicros: 3_000_000,
    lastReceiptId: r.initialBudget.body.receiptId,
  });
  assert.equal(state.policy.programmeCeilingMicros, 50_000_000);
  // The opening receipt is never translated into a new US$50 allowance.
  assert.equal(state.budget.spentMicros + state.budget.reservedMicros, POLICY.programmeCeilingMicros);
});

test('a signed opening state cannot reset prior charges or import more than US$50', async () => {
  for (const [spent, reserved] of [[47_000_000, 3_000_001],
    [50_000_001, 0], [0, 50_000_001]]) {
    await assert.rejects(rig({ withBaseline: false, withGate: false,
      openingSpentMicros: spent, openingReservedMicros: reserved }),
    /programme budget exceeded|invalid integer/);
  }
  // A v1 US$20 opening receipt is not a valid v2 opening authority.
  await assert.rejects(rig({ withBaseline: false, withGate: false,
    openingSpentMicros: 2_000_000, openingCeilingMicros: 20_000_000 }),
  /budget receipt ceilingMicros mismatch/);
});

test('existing spend and outstanding holds leave no new capacity despite a US$50 policy', async () => {
  const r = await rig({ withBaseline: false, withGate: true,
    openingSpentMicros: 49_995_000, openingReservedMicros: 5_000 });
  await r.controller.planBaseline();
  const request = await r.controller.executionRequest('baseline');
  const operation = { id: r.next('operation-baseline'), kind: 'baseline',
    attemptId: null, namespace: request.namespace, requestDigest: digest(request) };
  const lease = await operationLease(r, operation, request, {
    spentMicros: 49_995_000, reservedMicros: 10_000,
  });
  await assert.rejects(r.controller.reserveOperation(operation, lease),
    /programme budget exceeded|reservation|budget/);
  assert.deepEqual((await r.controller.state()).budget,
    { spentMicros: 49_995_000, reservedMicros: 5_000,
      lastReceiptId: r.initialBudget.body.receiptId });
});
