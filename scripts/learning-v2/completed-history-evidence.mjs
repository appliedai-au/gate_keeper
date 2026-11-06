/** Independent closed-history verifier. All inputs are already read-only
 * snapshots. This module issues no receipt and owns no append or SDK capability. */
import { POLICY, canonical, copy, digest, hash, integer, procedure, record, requireThat, version } from './contracts.mjs';
import { verifyEvaluation, compareEvaluations } from './evidence.mjs';
import { TURN_CONFIG, turnInputDigest } from './trueforge-turn.mjs';
import { originalReceipt, verifyAuthorityCapsule } from './completed-authority-export.mjs';
import { bytesSha, isoTime, same } from './completed-history-files.mjs';
import { COMPLETED_RECOVERY } from './completed-proposal-observation.mjs';

const retained = value => { const { calls, ...rest } = value; return copy(rest); };
const OP_KEYS = ['id', 'kind', 'attemptId', 'namespace', 'requestDigest'];
const identity = state => ({ experimentId: state.config.experimentId, configDigest: state.configDigest,
  sourceCommit: state.config.sourceCommit });
const operationIdentity = value => Object.fromEntries(OP_KEYS.map(key => [key, value[key]]));
const parsedProposal = (text, scope) => {
  try {
    let value = text.trim();
    const fence = value.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u); if (fence) value = fence[1];
    return procedure(JSON.parse(value), scope);
  } catch { return null; }
};
function historicalWindow(body, when) {
  isoTime(body.issuedAt, 'original receipt issue time'); isoTime(body.expiresAt, 'original receipt expiry');
  const issued = Date.parse(body.issuedAt), expires = Date.parse(body.expiresAt), observed = Date.parse(when);
  requireThat(issued <= observed && observed < expires && expires > issued && expires - issued <= 3_600_000,
    'receipt was not valid at its original host consumption');
}

function validateControllerHistory(snapshot, final) {
  requireThat(snapshot.events.length > 0 && snapshot.events[0].reason === 'initialized', 'original controller anchor absent');
  const immutable = item => ({ config: item.config, configDigest: item.configDigest, policy: item.policy,
    trustPins: item.trustPins, history: item.history, baseVersion: item.baseVersion });
  let previous = null, lastTime = -Infinity;
  const receiptTimes = new Map(), reservationTimes = new Map();
  for (const event of snapshot.events) {
    record(event, ['schema', 'reason', 'recordedAt', 'state'], 'retained controller event');
    requireThat(event.schema === 'gk-learning-v2-state' && event.state.schema === 'gk-learning-v2-experiment',
      'retained controller schema');
    isoTime(event.recordedAt, 'retained controller time');
    requireThat(Date.parse(event.recordedAt) >= lastTime, 'controller time reversed'); lastTime = Date.parse(event.recordedAt);
    same(immutable(event.state), immutable(final), 'frozen controller inputs changed in history');
    requireThat(new Set(event.state.receipts).size === event.state.receipts.length &&
      new Set(event.state.operations.map(item => item.id)).size === event.state.operations.length &&
      new Set(event.state.attempts.map(item => item.id)).size === event.state.attempts.length,
    'controller history duplicates identities');
    if (previous) {
      requireThat(event.state.attempts.length >= previous.attempts.length &&
        event.state.operations.length >= previous.operations.length && event.state.versions.length >= previous.versions.length &&
        event.state.activationHistory.length >= previous.activationHistory.length &&
        previous.receipts.every(id => event.state.receipts.includes(id)), 'controller history discarded evidence');
      for (const [index, old] of previous.operations.entries()) {
        const current = event.state.operations[index];
        same(operationIdentity(current), operationIdentity(old), 'controller changed admitted operation');
        for (const key of ['leaseId', 'maxCalls', 'reservationMicros']) same(current[key], old[key], 'controller changed original lease');
        requireThat(!old.consumed || current.consumed, 'controller reopened consumption');
        if (old.settled) for (const key of ['settled', 'settlementReceiptId', 'actualCalls', 'actualMicros'])
          same(current[key], old[key], 'controller replaced original settlement');
        if (old.usageReconciliation) same(current.usageReconciliation, old.usageReconciliation, 'controller replaced priced receipt');
      }
      previous.versions.forEach((item, index) => same(event.state.versions[index], item, 'controller replaced confirmed version'));
      previous.activationHistory.forEach((item, index) => same(event.state.activationHistory[index], item, 'controller replaced activation'));
      previous.attempts.forEach((item, index) => requireThat(event.state.attempts[index].id === item.id &&
        event.state.attempts[index].number === item.number && event.state.attempts[index].historyDigest === item.historyDigest &&
        event.state.attempts[index].incumbentVersionId === item.incumbentVersionId, 'controller replaced original attempt'));
    }
    for (const id of event.state.receipts) if (!receiptTimes.has(id)) receiptTimes.set(id, event.recordedAt);
    for (const op of event.state.operations) if (!reservationTimes.has(op.id)) reservationTimes.set(op.id, event.recordedAt);
    previous = event.state;
  }
  same(previous, final, 'controller snapshot changed');
  return { receiptTimes, reservationTimes, lastEventAt: snapshot.events.at(-1).recordedAt };
}

function terminalCall(entry, owned, operation, request, runtime) {
  requireThat(entry.stages.map(item => item.stage).join(',') === 'session,turn,final',
    'counted call lacks its original terminal result');
  const call = entry.call, result = entry.stages[2].payload;
  same(call.model, runtime.model, 'archived model parameters changed');
  requireThat(call.operationId === operation.id && call.leaseId === operation.leaseId &&
    call.requestDigest === operation.requestDigest && call.sourceCommit === request.sourceCommit &&
    call.runtimeDigest === request.runtimeDigest && call.callId === owned.callId &&
    result.callId === call.callId && result.inputDigest === turnInputDigest(call) && result.inputDigest === owned.inputDigest &&
    typeof result.text === 'string' && result.text.trim() && result.outputDigest === bytesSha(result.text) &&
    result.outputDigest === owned.outputDigest && result.complete === true && result.finishReason === 'stop' &&
    Array.isArray(result.toolCalls) && result.toolCalls.length === 0 &&
    Array.isArray(result.requiredActions) && result.requiredActions.length === 0,
  'original complete call differs from owned evidence');
  for (const key of ['sessionId', 'turnId']) requireThat(result[key] === owned[key], 'host and authority call identity differ');
  requireThat(entry.stages[0].payload.sessionId === result.sessionId && entry.stages[1].payload.sessionId === result.sessionId &&
    entry.stages[1].payload.turnId === result.turnId, 'host stage identity changed');
  const intent = { callId: call.callId, slot: copy(owned.slot), inputDigest: result.inputDigest,
    sessionRequest: { agent: { spec: { model: copy(call.model), instructions: call.instructions, config: copy(TURN_CONFIG) } },
      metadata: { purpose: 'gk-learning-v2', callId: call.callId, operationId: operation.id, requestDigest: operation.requestDigest } },
    turnRequest: { input: [{ type: 'user.message', content: call.message }], previousTurnId: 'none' } };
  requireThat(digest(intent) === owned.intentDigest, 'host prompt/input differs from independently retained authority intent');
  return result;
}

function expectedEvaluations(request, state, attempt) {
  const config = state.config, expectedCases = config.cases.map(({ learnerVisible, ...item }) => item);
  const standard = (arm, expected) => {
    requireThat(expected.phase === request.kind && expected.experimentId === config.experimentId &&
      expected.sourceCommit === config.sourceCommit && expected.benchmarkDigest === config.benchmarkDigest &&
      expected.scorerDigest === config.scorerDigest && expected.model === config.model && expected.scope === config.scope &&
      expected.namespace === request.namespace && expected.promptDigest === digest(request.prompts[arm]),
    'evaluation schedule differs from frozen request');
    same(expected.cases, expectedCases, 'evaluation cases changed');
    return { arm, expected };
  };
  if (request.kind === 'baseline') return [standard('base', request.plan)];
  if (request.kind === 'proposal') return [];
  if (request.kind === 'screen') {
    same(request.plan, attempt.screenPlan, 'host screening plan changed');
    requireThat(request.plan.incumbent.executionIndex === 0 && request.plan.candidate.executionIndex === 1 &&
      request.plan.incumbent.pairId === request.namespace && request.plan.candidate.pairId === request.namespace,
    'screening pair schedule changed');
    return [standard('incumbent', request.plan.incumbent), standard('candidate', request.plan.candidate)];
  }
  same(request.plan, attempt.confirmationPlan, 'host confirmation plan changed');
  requireThat(request.plan.decision === POLICY.confirmationDecision && request.plan.additionalPairs === 0 &&
    request.plan.pairs.length === 3, 'exactly three original confirmation pairs required');
  const forward = request.incumbentVersionId === state.baseVersion.id ? ['incumbent', 'candidate'] : ['base', 'incumbent', 'candidate'];
  return request.plan.pairs.flatMap((pair, index) => {
    const order = index % 2 === 0 ? forward : [...forward].reverse();
    same(pair.order, order, 'fresh confirmation execution order changed');
    requireThat(pair.pairId === request.namespace + ':pair:' + (index + 1), 'confirmation pair namespace changed');
    record(pair.expectations, order, 'confirmation arms');
    return order.map((arm, executionIndex) => {
      requireThat(pair.expectations[arm].executionIndex === executionIndex && pair.expectations[arm].pairId === pair.pairId,
        'confirmation execution index changed');
      return standard(arm, pair.expectations[arm]);
    });
  });
}

/** No counters are accepted as proof of completion. Every original proposal,
 * lease, request, call and settlement is matched one-to-one across custody. */
export function verifyClosedHostEvidence({ state, controllerSnapshot, dispatch, archives, continuation, observation,
  capsule: supplied, binding, trust }) {
  requireThat(state.schema === 'gk-learning-v2-experiment' && state.configDigest === binding.configDigest &&
    state.config.sourceCommit === binding.sourceCommit && state.config.experimentId === binding.experimentId,
  'closed host binding');
  same(state.policy, POLICY, 'closed policy changed');
  requireThat(digest({ config: state.config, policy: state.policy, trustPins: state.trustPins, history: state.history }) === binding.configDigest,
    'closed frozen configuration changed');
  same(state.trustPins, { ...Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation'].map(role =>
    [role, trust[role].pinnedFingerprint])), gatewayId: trust.budget.gatewayId }, 'closed role pins changed');
  const checked = verifyAuthorityCapsule(supplied, { binding, trust, config: state.config, history: state.history });
  const { capsule, gate, implementation, proposalObservation } = checked;
  const prepared = proposalObservation.status.preparationEnvelope.body;
  requireThat(observation?.complete === true && observation.prefix === '2:3' &&
    observation.snapshots.controller.head === controllerSnapshot.head &&
    observation.retained.operationId === state.operations[4]?.id &&
    digest(observation.packet.archive) === prepared.retained.originalArchiveDigest,
  'closed fourth lacks its exact retained failure and complete D consumption cut');
  same(observation.status, proposalObservation.status, 'host D proof differs from original authority D');
  same(observation.dispatch, dispatch, 'closed D dispatch capture differs');
  same(observation.state, state, 'closed D controller capture differs');
  same(observation.packet.archive, archives[state.operations[4].id], 'closed fourth original failure archive changed');
  same(observation.link, dispatch.entries[4].proposalObservation, 'mandatory closed D dispatch link missing or changed');
  const chronology = validateControllerHistory(controllerSnapshot, state);
  same(state.gate, { receiptId: gate.receiptId, digest: digest(gate), targetId: gate.targetId, runId: gate.runId },
    'host did not consume the original managed gate');
  const consumedReceipts = new Set([gate.receiptId]);
  const consume = id => { requireThat(!consumedReceipts.has(id), 'closed receipt reused'); consumedReceipts.add(id); };
  const base = { ...version(state.config.baseInstructions, []), confirmed: true, origin: 'frozen-base' };
  same(state.baseVersion, base, 'original baseline version changed');
  requireThat(state.baseline && !state.baselineError && !state.baselineNonAdmission &&
    state.attempts.length === 10 && dispatch.pending === null, 'host pilot is not complete');
  same(state.operations.map(item => item.id), capsule.operations.map(item => item.id), 'host/authority operation sets differ');
  same(dispatch.entries.map(item => item.operation.id), capsule.operations.map(item => item.id), 'dispatch/authority operation sets differ');
  same(Object.keys(archives).sort(), state.operations.map(item => item.id).sort(), 'closed operation archive inventory differs');
  requireThat(continuation && continuation.started && continuation.evaluation &&
    continuation.original.calls.length === 2 && continuation.saved.calls.length === 13 && continuation.archive.calls.length === 14,
  'mandatory original BASE/B continuation evidence absent');
  requireThat(canonical(continuation.qualificationEnvelope) === canonical(implementation.qualificationEnvelope) &&
    canonical(continuation.authorizationEnvelope) === canonical(implementation.authorizationEnvelope),
  'host continuation proof differs from historical authority B');
  const results = new Map(), byOperation = new Map(), seenCalls = new Set(), seenTurns = new Set(), observedFresh = [];
  const allEvaluations = new Map();
  for (const [index, operation] of state.operations.entries()) {
    const owned = capsule.operations[index], entry = dispatch.entries[index], archive = archives[operation.id];
    requireThat(operation.settled === true && operation.consumed === true && !operation.reconciliationOnly && !operation.failureReason &&
      !operation.reconciliation && (operation.kind === 'proposal' || operation.evidenceComplete === true),
    'closed operation is pending, reconciled or lacks complete evidence');
    same(operationIdentity(operation), operationIdentity(owned), 'host/authority operation changed');
    same(entry.operation, operationIdentity(operation), 'dispatch operation changed');
    same(entry.request, archive.request, 'dispatch/archived original request changed');
    requireThat(entry.admission === owned.lease && entry.settlement === owned.settlement && entry.notAdmitted === null &&
      entry.resolution?.kind === 'settled' && entry.resolution.receiptId === operation.settlementReceiptId,
    'original admission or settlement bytes differ across custody');
    const lease = JSON.parse(owned.lease).body, settlement = JSON.parse(owned.settlement).body;
    requireThat(operation.leaseId === lease.receiptId && operation.maxCalls === owned.maxCalls &&
      operation.reservationMicros === lease.reservationMicros && operation.settlementReceiptId === settlement.receiptId &&
      operation.actualCalls === settlement.actualCalls && operation.actualMicros === settlement.actualMicros,
    'host settled facts differ from original signed operation');
    historicalWindow(lease, chronology.reservationTimes.get(operation.id));
    consume(lease.receiptId); consume(settlement.receiptId);
    if (operation.usageReconciliation) {
      const usage = operation.usageReconciliation;
      record(usage, ['receiptId', 'actualMicros', 'receiptDigest', 'serialized'], 'closed delayed usage');
      const body = originalReceipt(usage.serialized, trust, 'budget', 'gk-learning-v4-operation-usage', {
        ...identity(state), operationId: operation.id, leaseId: operation.leaseId, requestDigest: operation.requestDigest,
        settlementReceiptId: operation.settlementReceiptId, actualCalls: operation.actualCalls,
        budgetId: state.config.budgetId, gatewayId: trust.budget.gatewayId, provider: 'truefoundry',
        global: false, ceilingMicros: null, status: 'known',
      }).body;
      requireThat(operation.actualMicros === null && usage.receiptDigest === digest(usage.serialized) &&
        usage.receiptId === body.receiptId && usage.actualMicros === body.actualMicros,
      'closed delayed cost replaced original settlement');
      integer(body.actualMicros, 'closed actual cost'); consume(body.receiptId);
    }
    const request = archive.request, attempt = state.attempts.find(item => item.id === operation.attemptId);
    same(operationIdentity(archive.operation), operationIdentity(operation), 'archive operation differs');
    requireThat(archive.operation.leaseId === operation.leaseId && digest(request) === operation.requestDigest &&
      request.requiredCalls === operation.maxCalls && request.provider === 'truefoundry' && request.memory === 'off' &&
      request.experimentId === binding.experimentId && request.configDigest === binding.configDigest && request.sourceCommit === binding.sourceCommit &&
      request.runtimeDigest === state.config.runtimeDigest && request.firstPassInstructionsDigest === state.config.firstPassInstructionsDigest &&
      request.model === state.config.model && request.originalVersionId === base.id && request.managedGateDigest === digest(gate),
    'archived original request differs from admitted frozen inputs');
    same(request.policy, POLICY, 'archived policy differs'); same(request.authorityPins, state.trustPins, 'archived pins differ');
    same(request.prompts.base, base.artifact, 'archived original prompt differs');
    if (attempt) {
      requireThat(request.incumbentVersionId === attempt.incumbentVersionId, 'archived incumbent differs');
      const incumbent = state.versions.find(item => item.id === attempt.incumbentVersionId);
      requireThat(incumbent?.confirmed, 'archived incumbent is not confirmed');
      same(request.prompts.incumbent, incumbent.artifact, 'archived incumbent prompt differs');
      if (operation.kind !== 'proposal') same(request.prompts.candidate, attempt.version?.artifact, 'archived candidate prompt differs');
    }
    requireThat(archive.calls.length === owned.calls.length, 'host and authority call sets differ');
    for (const [callIndex, saved] of archive.calls.entries()) {
      const observed = owned.calls[callIndex];
      requireThat(!seenCalls.has(observed.callId), 'closed SDK call reused'); seenCalls.add(observed.callId);
      const turn = canonical([observed.sessionId, observed.turnId]); requireThat(!seenTurns.has(turn), 'closed SDK turn reused'); seenTurns.add(turn);
      if (index === 4) {
        requireThat(operation.kind === 'proposal' && saved.stages.map(item => item.stage).join(',') === 'session,turn,failure' &&
          digest(saved.call) === prepared.retained.callDigest && digest(saved.stages[2].payload) === prepared.retained.failureDigest &&
          ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest', 'modelDigest'].every(key => observed[key] === prepared.observed[key]),
        'recovered fourth changed its original failed host read or authentic later observation');
        results.set(observed.callId, copy(prepared.observed));
      } else results.set(observed.callId, terminalCall(saved, observed, operation, request, capsule.frozen.runtime));
    }
    const scheduled = expectedEvaluations(request, state, attempt);
    requireThat(scheduled.length === owned.evaluations.length, 'closed evaluation arm set differs');
    const slots = operation.kind === 'proposal' ? [{ kind: 'proposal' }] : scheduled.flatMap(({ arm, expected }) =>
      state.config.cases.flatMap(item => (operation.kind === 'screen' && arm === 'candidate' ?
        expected.applicableCaseIds.includes(item.caseId) ? [2] : [] : [1, 2]).map(pass =>
        ({ pairId: expected.pairId, arm, caseId: item.caseId, pass }))));
    same(owned.calls.map(item => item.slot), slots, 'authority calls differ from original deterministic slot schedule');
    const allowedArtifacts = new Map(scheduled.flatMap(({ arm, expected }) => {
      const prefix = 'evaluation-' + digest({ pairId: expected.pairId, arm });
      return [[prefix + '-input', 'evaluation-input'], [prefix + '-receipt', 'evaluation']];
    }));
    if (operation.kind === 'baseline') {
      allowedArtifacts.set('baseline-continuation-link', 'base-continuation-authorization');
      allowedArtifacts.set('baseline-continuation-started', 'base-continuation-start');
      allowedArtifacts.set('baseline-continuation-original-replay', 'base-continuation-original-result');
    }
    if (operation.kind !== 'proposal') requireThat(archive.artifacts.length === allowedArtifacts.size &&
      archive.artifacts.every(item => allowedArtifacts.get(item.id) === item.kind),
    'completed evaluation has missing or unexpected artifacts');
    const signedArtifacts = archive.artifacts.filter(item => item.kind === 'evaluation');
    requireThat(signedArtifacts.length === scheduled.length, 'host evaluation receipts missing or duplicated');
    const evaluations = scheduled.map(({ arm, expected }, evalIndex) => {
      const original = owned.evaluations[evalIndex];
      requireThat(original.arm === arm && original.pairId === expected.pairId &&
        signedArtifacts.some(item => item.payload.serialized === original.envelope), 'host/authority evaluation bytes differ');
      const input = archive.artifacts.find(item => item.id === 'evaluation-' + digest({ pairId: expected.pairId, arm }) + '-input');
      same(input?.payload.expected, { ...expected, operationId: operation.id, requestDigest: operation.requestDigest },
        'retained evaluation input schedule changed');
      const verified = verifyEvaluation(JSON.parse(original.envelope), trust.evaluation,
        { ...expected, operationId: operation.id, requestDigest: operation.requestDigest });
      consume(verified.receiptId); allEvaluations.set(verified.receiptId, verified);
      for (const call of verified.calls) {
        const actual = results.get(call.callId);
        requireThat(actual && ['sessionId', 'turnId', 'inputDigest', 'outputDigest'].every(key => call[key] === actual[key]),
          'evaluation differs from complete original owned output');
        if (call.reused) {
          const origin = allEvaluations.get(call.originReceiptId);
          const prior = origin?.calls.find(item => item.caseId === call.caseId && item.pass === call.pass);
          requireThat(operation.kind === 'screen' && arm === 'candidate' && origin?.operationId === operation.id &&
            origin.pairId === verified.pairId && origin.executionIndex === 0 && prior?.reused === false &&
            ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest'].every(key => prior[key] === call[key]),
          'screening reuse lacks the exact paired incumbent receipt');
        } else observedFresh.push({ callId: call.callId, sessionId: call.sessionId, turnId: call.turnId });
      }
      return { arm, verified };
    });
    if (operation.kind !== 'proposal') {
      const freshIds = evaluations.flatMap(item => item.verified.calls.filter(call => !call.reused).map(call => call.callId));
      same([...freshIds].sort(), archive.calls.map(item => item.call.callId).sort(), 'evaluation did not consume every original SDK call exactly once');
      requireThat(operation.observedFreshCalls === operation.maxCalls, 'completed evaluation lacks observed fresh calls');
    }
    byOperation.set(operation.id, { operation, owned, entry, archive, evaluations });
  }
  same(state.observedCalls, observedFresh, 'controller observed-call history differs from signed fresh evidence');
  const baseline = byOperation.get(state.operations[0].id).evaluations[0]?.verified;
  same(state.baseline, retained(baseline), 'host original BASE differs from its signed fourteen-call result');
  requireThat(digest(state.baseline) === capsule.baselineDigest, 'authority original BASE differs from host');

  const expectedVersions = [base], references = copy(state.history), expectedReviewOperations = new Set();
  for (const [index, attempt] of state.attempts.entries()) {
    const authorized = capsule.attempts[index];
    requireThat(attempt.id === binding.experimentId + ':attempt:' + (index + 1) && attempt.number === index + 1,
      'closed attempt sequence');
    same({ id: attempt.id, number: attempt.number, status: attempt.status, incumbentVersionId: attempt.incumbentVersionId,
      historyDigest: attempt.historyDigest, candidateDigest: attempt.candidateDigest ?? null }, authorized,
    'host/authority attempts differ');
    requireThat(attempt.historyDigest === digest(references), 'negative and positive history was not retained in original proposal');
    const phases = state.operations.filter(item => item.attemptId === attempt.id);
    const proposal = byOperation.get(phases.find(item => item.kind === 'proposal')?.id);
    requireThat(proposal && proposal.operation.actualCalls === 1 && proposal.archive.calls.length === 1,
      'attempt is only reserved or was never a complete original proposal');
    const result = results.get(proposal.archive.calls[0].call.callId);
    const candidate = parsedProposal(result.text, state.config.scope);
    same(attempt.candidate, candidate, 'retained proposal classification differs from original text');
    requireThat((attempt.candidateDigest ?? null) === (candidate ? digest(candidate) : null), 'candidate fingerprint differs from original proposal');
    const exact = candidate ? references.filter(item => digest(item.procedure) === digest(candidate)) : [];
    const review = capsule.reviews.find(item => item.operationId === proposal.operation.id);
    let disposition, evaluatedCandidate = false;
    if (candidate === null) {
      if (index === 3) {
        requireThat(!review && proposal.archive.artifacts.length === 0 && result.classification === 'invalid' &&
          proposal.operation.id === prepared.retained.operationId && proposal.operation.actualCalls === 1 && proposal.operation.actualMicros === null,
        'later original observation cannot add a final/artifact or replace original one-call accounting');
      } else {
      requireThat(!review && proposal.archive.artifacts.length === 1 &&
        proposal.archive.artifacts[0].id === 'proposal-invalid' && proposal.archive.artifacts[0].kind === 'proposal',
      'invalid original proposal has an unexpected review or artifact');
      same(proposal.archive.artifacts[0].payload, { callId: result.callId, reason: 'invalid structured procedure' },
        'invalid original proposal artifact changed');
      }
      disposition = 'invalid';
    } else if (exact.length) {
      requireThat(!review && proposal.archive.artifacts.length === 1 &&
        proposal.archive.artifacts[0].id === 'proposal-exact-duplicate' && proposal.archive.artifacts[0].kind === 'proposal',
      'exact duplicate was retried or re-reviewed');
      same(proposal.archive.artifacts[0].payload, { candidate, callId: result.callId }, 'duplicate original proposal artifact changed');
      same(attempt.novelty, { verdict: 'exact', priorIds: exact.map(item => item.id) }, 'exact duplicate history mismatch');
      disposition = 'duplicate';
    } else {
      requireThat(review && proposal.archive.artifacts.length === 1 &&
        proposal.archive.artifacts[0].id === 'novelty-receipt' && proposal.archive.artifacts[0].kind === 'novelty' &&
        proposal.archive.artifacts[0].payload.serialized === review.envelope, 'novelty evidence missing or substituted');
      expectedReviewOperations.add(proposal.operation.id);
      const body = originalReceipt(review.envelope, trust, 'novelty', 'gk-learning-v2-novelty', {
        ...identity(state), attemptId: attempt.id, candidateDigest: digest(candidate),
        incumbentVersionId: attempt.incumbentVersionId, originalVersionId: base.id, historyDigest: attempt.historyDigest,
        policyVersion: 'gk-procedure-equivalence-v1', sourceScopeVerified: true,
        operationId: proposal.operation.id, requestDigest: proposal.operation.requestDigest,
      }).body;
      same(body, attempt.novelty, 'host novelty differs from signed original verdict'); consume(body.receiptId);
      requireThat(['novel', 'equivalent', 'uncertain'].includes(body.verdict) && Array.isArray(body.comparisons) &&
        body.comparisons.length === references.length && new Set(body.comparisons.map(item => item.priorId)).size === references.length &&
        body.comparisons.every(item => references.some(prior => prior.id === item.priorId) &&
          ['distinct', 'equivalent', 'uncertain'].includes(item.relation)), 'novelty did not compare every retained procedure');
      requireThat(Array.isArray(body.coverageCaseIds) && new Set(body.coverageCaseIds).size === body.coverageCaseIds.length &&
        body.coverageCaseIds.every(id => state.config.cases.some(item => item.caseId === id && item.scope === state.config.scope)),
      'novelty applicability differs from frozen case scope');
      const equivalent = body.comparisons.some(item => item.relation === 'equivalent');
      const uncertain = body.comparisons.some(item => item.relation === 'uncertain');
      requireThat((body.verdict === 'equivalent') === equivalent &&
        (body.verdict !== 'novel' || !equivalent && !uncertain), 'novelty verdict contradicts comparisons');
      if (!body.coverageCaseIds.some(id => state.config.cases.some(item => item.caseId === id && item.split === 'fit' && item.learnerVisible))) disposition = 'noCoverage';
      else if (body.verdict !== 'novel') disposition = equivalent ? 'duplicate' : 'unresolved';
      else {
        evaluatedCandidate = true;
        same(attempt.coverageCaseIds, body.coverageCaseIds, 'candidate coverage changed');
        const incumbent = expectedVersions.find(item => item.id === attempt.incumbentVersionId);
        requireThat(incumbent, 'candidate relies on an unconfirmed or future incumbent');
        same(attempt.version, version(state.config.baseInstructions, [...incumbent.rules,
          { id: attempt.id, procedure: candidate, coverageCaseIds: body.coverageCaseIds }], incumbent.id),
        'candidate version changed from original proposal');
        const screen = byOperation.get(phases.find(item => item.kind === 'screen')?.id);
        requireThat(screen?.evaluations.length === 2, 'novel covered candidate did not complete screening');
        const control = retained(screen.evaluations[0].verified), proposed = retained(screen.evaluations[1].verified);
        const decision = compareEvaluations({ base: state.baseline, incumbent: control, candidate: proposed });
        same(attempt.screen, { control, proposed, decision }, 'screening decision differs from original evidence');
        if (!decision.passed) { disposition = 'rejected'; requireThat(phases.length === 2 && !attempt.confirmation, 'negative screen was retried'); }
        else {
          const confirmation = byOperation.get(phases.find(item => item.kind === 'confirmation')?.id);
          requireThat(confirmation && phases.length === 3, 'positive screen lacks original confirmation');
          const evaluatedPairs = confirmation.archive.request.plan.pairs.map(pair => {
            const evaluated = Object.fromEntries(pair.order.map(arm => [arm, retained(confirmation.evaluations.find(item =>
              item.arm === arm && item.verified.pairId === pair.pairId).verified)]));
            return { pairId: pair.pairId, order: pair.order, evaluated, decision: compareEvaluations({
              base: evaluated.base || evaluated.incumbent, incumbent: evaluated.incumbent, candidate: evaluated.candidate }) };
          });
          same(attempt.confirmation, evaluatedPairs, 'confirmation decision differs from three original fresh pairs');
          disposition = evaluatedPairs.every(item => item.decision.passed) ? 'confirmed' : 'rejected';
          if (disposition === 'confirmed') expectedVersions.push({ ...copy(attempt.version), confirmed: true,
            origin: attempt.id, evidenceDigest: digest(evaluatedPairs), configDigest: state.configDigest });
        }
      }
    }
    requireThat(attempt.status === disposition, 'terminal proposal disposition does not follow actual evidence');
    if (!evaluatedCandidate) requireThat(phases.length === 1 && !attempt.version && !attempt.screen && !attempt.confirmation,
      'negative proposal was retried or given an evaluation');
    if (candidate) references.push({ id: attempt.id, procedure: candidate, outcome: attempt.status, sourceRef: binding.sourceCommit });
  }
  same([...expectedReviewOperations].sort(), capsule.reviews.map(item => item.operationId).sort(), 'novelty review set differs');
  same(state.versions, expectedVersions, 'confirmed versions lack three-pair evidence');
  requireThat(digest(state.versions) === capsule.versionsDigest, 'authority confirmed versions differ');
  requireThat(state.activationHistory.length === capsule.activations.length, 'an authority activation was never consumed by host');
  let active = base.id;
  for (const [index, step] of state.activationHistory.entries()) {
    const original = capsule.activations[index], target = expectedVersions.find(item => item.id === step.versionId);
    requireThat(target && step.previousVersionId === active && step.versionId !== active &&
      step.action === original.action && step.versionId === original.versionId && step.previousVersionId === original.previousVersionId,
    'activation chain differs across custody');
    if (step.action === 'activate') requireThat(target.parent === active, 'activation does not extend confirmed incumbent');
    else requireThat(target.id === base.id || state.activationHistory.slice(0, index).some(item => item.versionId === target.id),
      'rollback target was never active');
    const receipts = [original.envelope, ...original.renewals], bodies = receipts.map(serialized => originalReceipt(serialized,
      trust, 'activation', 'gk-learning-v2-activation', { ...identity(state), action: step.action,
        versionId: target.id, incumbentVersionId: active, originalVersionId: base.id,
        evidenceDigest: target.evidenceDigest || null, purpose: 'experiment-incumbent-only' }).body);
    for (const body of bodies) {
      const { receiptId, issuedAt, expiresAt, ...context } = body;
      const { receiptId: ignored, issuedAt: ignoredIssued, expiresAt: ignoredExpires, ...first } = bodies[0];
      same(context, first, 'activation renewal changed original decision');
      isoTime(issuedAt, 'activation issue time'); isoTime(expiresAt, 'activation expiry');
      requireThat(Date.parse(expiresAt) > Date.parse(issuedAt) && Date.parse(expiresAt) - Date.parse(issuedAt) <= 3_600_000,
        'activation historical window invalid');
    }
    const consumed = bodies.at(-1);
    requireThat(step.receiptId === consumed.receiptId, 'latest retained activation authorization was not consumed');
    historicalWindow(consumed, chronology.receiptTimes.get(step.receiptId)); consume(step.receiptId);
    active = target.id;
  }
  requireThat(state.activeVersionId === active && capsule.activeVersionId === active, 'final incumbent differs across custody');
  same([...consumedReceipts].sort(), [...state.receipts].sort(), 'controller contains missing or unauthenticated receipts');
  return { binding: copy(binding), originalExecutionSourceCommit: capsule.originalExecutionSourceCommit,
    finalExecutionSourceCommit: capsule.finalExecutionSourceCommit, recovery: copy(COMPLETED_RECOVERY),
    observationQualificationDigest: digest(proposalObservation.status.qualificationEnvelope),
    observationPreparationDigest: digest(proposalObservation.status.preparationEnvelope),
    observationAuthorizationDigest: digest(proposalObservation.status.authorizationEnvelope),
    operations: state.operations.length, calls: seenCalls.size, genuineAttempts: 10,
    activeVersionId: active, lastHostEventAt: chronology.lastEventAt,
    unknownCostOperations: state.operations.filter(item => item.actualMicros === null && !item.usageReconciliation).length };
}
