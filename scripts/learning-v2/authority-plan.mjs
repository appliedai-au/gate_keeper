/** Independent request reconstruction from frozen inputs and verified receipts. */
import { POLICY, copy, digest, requireThat, version } from './contracts.mjs';
import { learnerRequest } from './prompts.mjs';

export function authorityReferences(bundle, state) {
  return [...copy(bundle.history), ...state.attempts.filter(item => item.candidate).map(item => ({
    id: item.id, procedure: copy(item.candidate), outcome: item.status, sourceRef: bundle.config.sourceCommit,
  }))];
}

export function initialAuthorityState(bundle) {
  const base = { ...version(bundle.config.baseInstructions, []), confirmed: true, origin: 'frozen-base' };
  return { schema: 'gk-detached-authority-state-v1', binding: copy(bundle.binding),
    baseVersion: base, activeVersionId: base.id, versions: [base], attempts: [],
    operations: [], reviews: [], activationHistory: [], gate: null, baseline: null, feedback: null };
}

export function authorityIdentity(bundle) {
  return { experimentId: bundle.config.experimentId, configDigest: bundle.binding.configDigest,
    sourceCommit: bundle.config.sourceCommit };
}

function expected(bundle, phase, namespace, pairId, artifact, executionIndex, coverage) {
  const config = bundle.config;
  return { experimentId: config.experimentId, sourceCommit: config.sourceCommit,
    benchmarkDigest: config.benchmarkDigest, scorerDigest: config.scorerDigest,
    model: config.model, scope: config.scope, phase, namespace, pairId,
    promptDigest: digest(artifact), executionIndex,
    applicableCaseIds: copy(coverage ?? config.cases.filter(item => item.scope === config.scope).map(item => item.caseId)),
    cases: config.cases.map(({ learnerVisible, ...item }) => copy(item)) };
}

/** This verifier never chooses a next phase or dispatches a model. */
export function reconstructAuthorityRequest(bundle, state, kind, attemptId) {
  const config = bundle.config;
  const active = state.versions.find(item => item.id === state.activeVersionId && item.confirmed);
  requireThat(active && state.gate, 'authority source gate or incumbent absent');
  const prompts = { base: copy(state.baseVersion.artifact) };
  let plan, namespace, requiredCalls, learner = null, proposedAttempt = null;
  const evaluations = [];
  const slots = [];
  const addArm = (arm, expectation, freshPasses = () => [1, 2]) => {
    evaluations.push({ arm, expected: copy(expectation) });
    for (const item of config.cases) for (const pass of freshPasses(item.caseId)) {
      slots.push({ pairId: expectation.pairId, arm, caseId: item.caseId, pass });
    }
  };
  if (kind === 'baseline') {
    requireThat(attemptId === null && !state.baseline && state.attempts.length === 0, 'authority baseline state');
    namespace = config.experimentId + ':baseline';
    plan = expected(bundle, 'baseline', namespace, namespace, prompts.base, 0);
    requiredCalls = config.cases.length * 2;
    addArm('base', plan);
  } else {
    prompts.incumbent = copy(active.artifact);
    let attempt = state.attempts.find(item => item.id === attemptId);
    if (kind === 'proposal') {
      requireThat(state.baseline && state.feedback && !attempt && state.attempts.length < POLICY.attempts &&
        state.attempts.every(item => ['confirmed', 'rejected', 'duplicate', 'unresolved', 'invalid', 'noCoverage']
          .includes(item.status)), 'authority proposal state');
      const number = state.attempts.length + 1;
      requireThat(attemptId === config.experimentId + ':attempt:' + number, 'authority attempt sequence');
      proposedAttempt = attempt = { id: attemptId, number, status: 'reserved', candidate: null,
        incumbentVersionId: active.id, historyDigest: digest(authorityReferences(bundle, state)) };
      namespace = attemptId + ':proposal';
      plan = { attemptId, historyDigest: attempt.historyDigest };
      requiredCalls = 1;
      learner = learnerRequest({ scope: config.scope, activeVersion: active,
        baselineInstructions: config.baseInstructions, fitExamples: JSON.parse(state.feedback).body.examples });
      slots.push({ kind: 'proposal' });
    } else {
      requireThat(attempt && attempt.incumbentVersionId === active.id && attempt.version,
        'authority candidate or incumbent mismatch');
      prompts.candidate = copy(attempt.version.artifact);
      if (kind === 'screen') {
        requireThat(attempt.status === 'ready', 'authority screen state');
        namespace = config.experimentId + ':screen:' + attempt.number;
        plan = {
          incumbent: expected(bundle, 'screen', namespace, namespace, prompts.incumbent, 0),
          candidate: expected(bundle, 'screen', namespace, namespace, prompts.candidate, 1, attempt.coverageCaseIds),
        };
        requiredCalls = config.cases.length * 2 + attempt.coverageCaseIds.length;
        addArm('incumbent', plan.incumbent);
        addArm('candidate', plan.candidate, caseId => attempt.coverageCaseIds.includes(caseId) ? [2] : []);
      } else {
        requireThat(kind === 'confirmation' && attempt.status === 'provisional', 'authority confirmation state');
        namespace = config.experimentId + ':confirmation:' + attempt.number;
        const forward = active.id === state.baseVersion.id ? ['incumbent', 'candidate'] :
          ['base', 'incumbent', 'candidate'];
        plan = { namespace, pairs: [], decision: POLICY.confirmationDecision, additionalPairs: 0 };
        for (let index = 0; index < POLICY.confirmationPairs; index++) {
          const pairId = namespace + ':pair:' + (index + 1);
          const order = index % 2 === 0 ? [...forward] : [...forward].reverse();
          const expectations = {};
          for (const [executionIndex, arm] of order.entries()) {
            expectations[arm] = expected(bundle, 'confirmation', namespace, pairId, prompts[arm],
              executionIndex, arm === 'candidate' ? attempt.coverageCaseIds : undefined);
            addArm(arm, expectations[arm]);
          }
          plan.pairs.push({ pairId, order, expectations });
        }
        requiredCalls = slots.length;
      }
    }
  }
  const trustPins = { ...Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation']
    .map(role => [role, bundle.trust[role].pinnedFingerprint])), gatewayId: bundle.trust.budget.gatewayId };
  const request = { schema: 'gk-learning-v2-execution-request', ...authorityIdentity(bundle),
    kind, attemptId, namespace, provider: POLICY.provider, memory: POLICY.memory, model: config.model,
    runtimeDigest: config.runtimeDigest, firstPassInstructionsDigest: config.firstPassInstructionsDigest,
    policy: copy(POLICY), authorityPins: trustPins, originalVersionId: state.baseVersion.id,
    incumbentVersionId: active.id, managedGateDigest: digest(JSON.parse(state.gate).body),
    requiredCalls, plan, prompts, learner };
  const operation = { id: 'operation-' + digest({ experimentId: config.experimentId, kind, attemptId }),
    kind, attemptId, namespace, requestDigest: digest(request) };
  return copy({ request, operation, proposedAttempt, evaluations, slots });
}

export const authorityCallId = (operationId, slot) => 'call-' + digest({ operationId, slot });

/** Original frozen line-window scorer: expected order first, then neutral lines. */
export function scoreFrozenFindings(caseDefinition, findings) {
  const caught = new Set();
  let falseAlarms = 0;
  const matched = [], misses = [];
  for (const finding of findings) {
    requireThat(Number.isSafeInteger(finding.start) && finding.start > 0, 'authority finding location');
    const index = caseDefinition.expected.findIndex((line, position) =>
      !caught.has(position) && Math.abs(line - finding.start) <= 1);
    if (index >= 0) { caught.add(index); matched.push(caseDefinition.expected[index]); }
    else if (!caseDefinition.benign.some(line => Math.abs(line - finding.start) <= 1)) falseAlarms++;
  }
  caseDefinition.expected.forEach((line, index) => { if (!caught.has(index)) misses.push(line); });
  return { caught: caught.size, falseAlarms, matched, misses };
}
