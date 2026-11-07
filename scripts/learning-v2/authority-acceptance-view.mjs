/** Protected acceptance projection of already verified authority state.
 * This is not another evaluator or a host activation acknowledgement. */
import { POLICY, canonical, hash, identifier, integer, requireThat } from './contracts.mjs';

const STATUSES = ['reserved', 'ready', 'provisional', 'confirmed', 'rejected',
  'duplicate', 'unresolved', 'invalid', 'noCoverage'];
const DISPOSITIONS = ['screen-positive', 'observed-regression', 'unproven',
  'confirmation-qualified', 'not-confirmed'];
const LEGACY_OUTCOMES = ['rejected', 'unproven', 'legacy-positive'];
const ARMS = ['base', 'incumbent', 'candidate'];
const signedInteger = value => integer(value, 'acceptance signed count', -Number.MAX_SAFE_INTEGER);
const id = value => identifier(value, 'acceptance identifier');
const sha = value => hash(value, 'acceptance digest');
function bounded(values, maximum) {
  requireThat(Array.isArray(values) && values.length <= maximum, 'acceptance collection limit');
  return values;
}
function choice(value, values) {
  requireThat(values.includes(value), 'acceptance state enum');
  return value;
}
function counts(values, outcomes, select) {
  const result = Object.fromEntries(outcomes.map(outcome => [outcome, 0]));
  for (const item of values) result[choice(select(item), outcomes)]++;
  return result;
}
function metrics(value) {
  requireThat(value && typeof value === 'object', 'acceptance metrics absent');
  const result = { caught: integer(value.caught, 'acceptance caught'),
    falseAlarms: integer(value.falseAlarms, 'acceptance false alarms'), net: signedInteger(value.net) };
  requireThat(result.net === result.caught - result.falseAlarms, 'acceptance metrics inconsistent');
  return result;
}
function evaluation(value, phase) {
  requireThat(value && value.phase === phase, 'acceptance evaluation phase');
  const totals = metrics(value.totals);
  const splits = { fit: metrics(value.splits?.fit), check: metrics(value.splits?.check) };
  for (const key of ['caught', 'falseAlarms', 'net']) requireThat(
    totals[key] === splits.fit[key] + splits.check[key], 'acceptance split totals inconsistent');
  return { receiptId: id(value.receiptId), bodyDigest: sha(value.bodyDigest),
    operationId: id(value.operationId), requestDigest: sha(value.requestDigest), pairId: id(value.pairId),
    phase, executionIndex: integer(value.executionIndex, 'acceptance execution index', 0, 2),
    promptDigest: sha(value.promptDigest), totals, splits };
}
function decision(value) {
  requireThat(value && typeof value.passed === 'boolean', 'acceptance decision absent');
  // The evaluator's free-form/internal reason text is deliberately not exported.
  return { passed: value.passed, gain: signedInteger(value.gain), baseGain: signedInteger(value.baseGain) };
}
function version(value, confirmed) {
  requireThat(value && value.id === value.promptDigest, 'acceptance version identity');
  return { versionId: sha(value.id), promptDigest: sha(value.promptDigest), confirmed };
}

export function authorityAcceptanceView(bundle, state) {
  requireThat(bundle && state && canonical(bundle.binding) === canonical(state.binding),
    'acceptance binding differs from verified authority state');
  const binding = { ownerId: id(state.binding.ownerId), experimentId: id(state.binding.experimentId),
    sourceCommit: hash(state.binding.sourceCommit, 'acceptance source commit', 40),
    configDigest: sha(state.binding.configDigest) };
  const attempts = bounded(state.attempts, POLICY.attempts);
  const versions = bounded(state.versions, POLICY.attempts + 1);
  const operations = bounded(state.operations, 1 + POLICY.attempts * 3);
  const reviews = bounded(state.reviews, POLICY.attempts);
  const history = bounded(bundle.history, 256);
  const byVersion = new Map(versions.map(item => [item.id, item]));
  requireThat(byVersion.size === versions.length, 'acceptance duplicate version');
  const base = byVersion.get(state.baseVersion.id), active = byVersion.get(state.activeVersionId);
  requireThat(base?.confirmed === true && active?.confirmed === true, 'acceptance confirmed incumbent absent');
  const baseline = state.baseline === null ? null : evaluation(state.baseline, 'baseline');
  requireThat(baseline === null || baseline.promptDigest === base.promptDigest && baseline.executionIndex === 0,
    'acceptance baseline version differs');

  const rows = attempts.map((attempt, index) => {
    requireThat(attempt.number === index + 1 &&
      attempt.id === binding.experimentId + ':attempt:' + (index + 1), 'acceptance attempt sequence');
    const incumbent = byVersion.get(attempt.incumbentVersionId);
    requireThat(incumbent?.confirmed === true, 'acceptance attempt incumbent absent');
    const proposals = operations.filter(item => item.kind === 'proposal' && item.attemptId === attempt.id);
    requireThat(proposals.length <= 1, 'acceptance repeated proposal operation');
    const proposal = proposals[0] ?? null;
    const review = proposal ? reviews.find(item => item.operationId === proposal.id) : null;
    let novelty;
    if (attempt.novelty) {
      const verdict = choice(attempt.novelty.verdict, ['exact', 'novel', 'equivalent', 'uncertain']);
      novelty = { disposition: verdict,
        receiptId: verdict === 'exact' ? null : id(attempt.novelty.receiptId),
        reviewId: review ? id(review.id) : null };
    } else novelty = { disposition: review ? 'awaiting-independent-review' : 'not-issued',
      receiptId: null, reviewId: review ? id(review.id) : null };
    const candidate = attempt.candidate === null ? null : {
      procedureDigest: sha(attempt.candidateDigest),
      version: attempt.version ? version(attempt.version, byVersion.get(attempt.version.id)?.confirmed === true) : null };
    let screen = null;
    if (attempt.screen) {
      const control = evaluation(attempt.screen.control, 'screen');
      const proposed = evaluation(attempt.screen.proposed, 'screen');
      requireThat(candidate?.version && control.promptDigest === incumbent.promptDigest &&
        proposed.promptDigest === candidate.version.promptDigest && control.pairId === proposed.pairId &&
        control.executionIndex === 0 && proposed.executionIndex === 1, 'acceptance screen binding');
      screen = { incumbent: control, candidate: proposed, decision: decision(attempt.screen.decision) };
    }
    const confirmation = bounded(attempt.confirmation ?? [], POLICY.confirmationPairs).map(pair => {
      const order = bounded(pair.order, 3).map(arm => choice(arm, ARMS));
      requireThat(new Set(order).size === order.length && order.includes('incumbent') &&
        order.includes('candidate') && candidate?.version, 'acceptance confirmation arms');
      const evaluated = {};
      for (const [executionIndex, arm] of order.entries()) {
        const result = evaluation(pair.evaluated[arm], 'confirmation');
        const expectedVersion = arm === 'base' ? base : arm === 'incumbent' ? incumbent : attempt.version;
        requireThat(result.pairId === pair.pairId && result.executionIndex === executionIndex &&
          result.promptDigest === expectedVersion.promptDigest, 'acceptance confirmation binding');
        evaluated[arm] = result;
      }
      return { pairId: id(pair.pairId), order, evaluated, decision: decision(pair.decision) };
    });
    requireThat(new Set(confirmation.map(pair => pair.pairId)).size === confirmation.length,
      'acceptance duplicate confirmation pair');
    const proposalCallState = proposal === null ? 'not-admitted' : proposal.settlement === null ? 'unsettled' :
      proposal.actualCalls === 1 ? 'settled-one-call' : 'settled-other-count';
    return { number: attempt.number, attemptId: id(attempt.id), status: choice(attempt.status, STATUSES),
      disposition: attempt.disposition === undefined ? null : choice(attempt.disposition, DISPOSITIONS),
      incumbent: version(incumbent, true), candidate, novelty,
      proposalOperationId: proposal ? id(proposal.id) : null, proposalCallState, screen, confirmation };
  });

  let activeEvidence;
  if (active.id === base.id) activeEvidence = { basis: baseline ? 'original-baseline' : 'no-evaluation-yet',
    originAttemptId: null, observations: baseline ? [baseline] : [] };
  else {
    const origin = rows.find(item => item.attemptId === active.origin);
    requireThat(origin?.status === 'confirmed' && origin.candidate?.version?.versionId === active.id &&
      origin.confirmation.length === POLICY.confirmationPairs &&
      origin.confirmation.every(pair => pair.decision.passed), 'acceptance active version lacks retained confirmation');
    activeEvidence = { basis: 'retained-candidate-confirmations', originAttemptId: origin.attemptId,
      observations: origin.confirmation.map(pair => pair.evaluated.candidate) };
  }
  requireThat(Array.isArray(bundle.nonProcedureRecords), 'acceptance historical records absent');
  const legacyCounts = Object.fromEntries(['accepted', 'harmful', 'unproven', 'history']
    .map(group => [group, integer(bundle.legacyBank.counts[group], 'acceptance historical count', 0, 10_000)]));
  return { schema: 'gk-learning-authority-acceptance-view-v1', binding,
    evidenceScope: 'authority-journal; host-activation-consumption-not-attested',
    attemptLimit: POLICY.attempts, observedAttempts: rows.length,
    settledOneCallProposals: rows.filter(item => item.proposalCallState === 'settled-one-call').length,
    baseVersion: version(base, true), baseline, attempts: rows,
    authorityActiveVersion: { ...version(active, true), ...activeEvidence,
      separateFinalEvaluationPerformed: false },
    retainedBank: { historicalFileDigest: sha(bundle.legacyBank.fileDigest),
      historicalProjectionDigest: sha(bundle.legacyBankDigest), historicalCounts: legacyCounts,
      normalizedHistoricalReferences: history.length,
      historicalOutcomes: counts(history, LEGACY_OUTCOMES, item => item.outcome),
      retainedNonProcedureRecords: integer(bundle.nonProcedureRecords.length, 'acceptance retained record count'),
      currentAttemptsByStatus: counts(attempts, STATUSES, item => item.status),
      currentProceduresByStatus: counts(attempts.filter(item => item.candidate !== null), STATUSES, item => item.status),
      confirmedLearnedVersions: versions.filter(item => item.id !== base.id && item.confirmed === true).length } };
}
