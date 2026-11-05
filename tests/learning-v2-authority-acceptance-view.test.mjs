import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { authorityAcceptanceView } from '../scripts/learning-v2/authority-acceptance-view.mjs';

// Explicit projection fixtures only. They are not signed live evidence and
// never invoke an authority, provider, journal writer, signer or model.
const digest = text => createHash('sha256').update(text).digest('hex');
const PRIVATE = 'PRIVATE_ACCEPTANCE_CANARY__must_not_leave_the_operator_state';
const clone = value => JSON.parse(JSON.stringify(value));
function metrics(caught, falseAlarms) { return { caught, falseAlarms, net: caught - falseAlarms }; }
function evaluation(label, phase, promptDigest, executionIndex = 0, pairId = label, caught = 8, falseAlarms = 2) {
  const fitCaught = Math.floor(caught / 2), fitAlarms = Math.floor(falseAlarms / 2);
  return { receiptId: 'evaluation-' + digest(label), bodyDigest: digest('body-' + label),
    operationId: 'operation-' + digest(phase + label), requestDigest: digest('request-' + label),
    pairId, phase, executionIndex, promptDigest, totals: metrics(caught, falseAlarms),
    splits: { fit: metrics(fitCaught, fitAlarms), check: metrics(caught - fitCaught, falseAlarms - fitAlarms) },
    cases: [{ caseId: PRIVATE, expected: [PRIVATE], passes: [{ text: PRIVATE, sessionId: PRIVATE }] }],
    calls: [{ body: PRIVATE }], signature: PRIVATE, rawResponse: PRIVATE };
}
function fixture() {
  const binding = { ownerId: 'fixture-owner', experimentId: 'acceptance-fixture',
    sourceCommit: 'a'.repeat(40), configDigest: digest('config') };
  const base = { id: digest('base'), promptDigest: digest('base'), confirmed: true,
    parent: null, origin: 'frozen-base', artifact: { instructions: PRIVATE }, rules: [] };
  const bundle = { binding, legacyBank: { fileDigest: digest('legacy-file'),
    counts: { accepted: 0, harmful: 35, unproven: 18, history: 47 }, records: [{ rawRules: PRIVATE }] },
    legacyBankDigest: digest('legacy-projection'), nonProcedureRecords: [{ privateRejectedText: PRIVATE }],
    history: [
      ...Array.from({ length: 35 }, () => ({ outcome: 'rejected', procedure: PRIVATE })),
      ...Array.from({ length: 18 }, () => ({ outcome: 'unproven', procedure: PRIVATE })),
    ], corpus: { oracle: PRIVATE }, trust: { privateKey: PRIVATE } };
  const state = { binding: clone(binding), baseVersion: clone(base), activeVersionId: base.id,
    versions: [base], attempts: [], operations: [], reviews: [], activationHistory: [],
    baseline: evaluation('baseline', 'baseline', base.promptDigest), feedback: PRIVATE,
    rawProviderArtifact: PRIVATE };
  return { bundle, state };
}
function proposal(f, number, status, { candidate = true, calls = 1, settled = true } = {}) {
  const id = f.bundle.binding.experimentId + ':attempt:' + number;
  const operationId = 'operation-' + digest(id);
  const attempt = { id, number, status, incumbentVersionId: f.state.activeVersionId,
    candidate: candidate ? { action: PRIVATE } : null,
    candidateDigest: candidate ? digest('candidate-' + number) : undefined,
    reason: PRIVATE, historyDigest: digest('history') };
  f.state.attempts.push(attempt);
  f.state.operations.push({ id: operationId, kind: 'proposal', attemptId: id,
    settlement: settled ? JSON.stringify({ body: { actualCalls: calls }, signature: PRIVATE }) : null,
    actualCalls: settled ? calls : undefined, actualMicros: null, calls: [{ body: PRIVATE }] });
  return attempt;
}
function confirmed(f, number, activate) {
  const attempt = proposal(f, number, 'confirmed');
  attempt.version = { id: digest('version-' + number), promptDigest: digest('version-' + number),
    parent: attempt.incumbentVersionId, artifact: { instructions: PRIVATE }, rules: [{ procedure: PRIVATE }] };
  attempt.disposition = 'confirmation-qualified';
  attempt.novelty = { verdict: 'novel', receiptId: 'novelty-' + digest(attempt.id),
    comparisons: [{ reason: PRIVATE }], coverageReasons: [{ reason: PRIVATE }] };
  const operationId = f.state.operations.at(-1).id;
  f.state.reviews.push({ id: 'review-' + digest(attempt.id), operationId, envelope: PRIVATE,
    reviewer: PRIVATE, packet: PRIVATE });
  const incumbent = f.state.versions.find(item => item.id === attempt.incumbentVersionId);
  const screenId = attempt.id + ':screen';
  attempt.screen = {
    control: evaluation(screenId + ':incumbent', 'screen', incumbent.promptDigest, 0, screenId, 8, 2),
    proposed: evaluation(screenId + ':candidate', 'screen', attempt.version.promptDigest, 1, screenId, 10, 1),
    decision: { passed: true, gain: 3, baseGain: 3, reasons: [PRIVATE] } };
  const forward = incumbent.id === f.state.baseVersion.id ? ['incumbent', 'candidate'] : ['base', 'incumbent', 'candidate'];
  attempt.confirmation = Array.from({ length: 3 }, (_, index) => {
    const pairId = attempt.id + ':confirmation:pair:' + (index + 1);
    const order = index % 2 ? [...forward].reverse() : [...forward];
    const evaluated = Object.fromEntries(order.map((arm, executionIndex) => {
      const version = arm === 'base' ? f.state.baseVersion : arm === 'incumbent' ? incumbent : attempt.version;
      const caught = arm === 'candidate' ? 10 + index : 8;
      return [arm, evaluation(pairId + ':' + arm, 'confirmation', version.promptDigest,
        executionIndex, pairId, caught, 2)];
    }));
    return { pairId, order, evaluated,
      decision: { passed: true, gain: 2 + index, baseGain: 2 + index, reasons: [PRIVATE] } };
  });
  f.state.versions.push({ ...clone(attempt.version), confirmed: true, origin: attempt.id,
    evidenceDigest: digest('retained-confirmation-' + number) });
  if (activate) f.state.activeVersionId = attempt.version.id;
  return attempt;
}

test('absent BASE evidence stays unknown while genuine zero scores remain zero', () => {
  const f = fixture();
  f.state.baseline = null;
  let view = authorityAcceptanceView(f.bundle, f.state);
  assert.equal(view.baseline, null);
  assert.equal(view.authorityActiveVersion.basis, 'no-evaluation-yet');
  assert.deepEqual(view.authorityActiveVersion.observations, []);
  f.state.baseline = evaluation('zero-baseline', 'baseline', f.state.baseVersion.promptDigest, 0, 'baseline', 0, 0);
  view = authorityAcceptanceView(f.bundle, f.state);
  assert.deepEqual(view.baseline.totals, { caught: 0, falseAlarms: 0, net: 0 });
  assert.equal(view.authorityActiveVersion.basis, 'original-baseline');
  assert.deepEqual(view.authorityActiveVersion.observations, [view.baseline]);
  assert.equal(view.authorityActiveVersion.separateFinalEvaluationPerformed, false);
});

test('final learned incumbent reports every retained confirmation, ordered arms and exact receipt identities without raw evidence', () => {
  const f = fixture();
  confirmed(f, 1, true);
  const last = confirmed(f, 2, true), before = JSON.stringify(f);
  const view = authorityAcceptanceView(f.bundle, f.state);
  assert.equal(view.authorityActiveVersion.versionId, last.version.id);
  assert.equal(view.authorityActiveVersion.basis, 'retained-candidate-confirmations');
  assert.equal(view.authorityActiveVersion.originAttemptId, last.id);
  assert.equal(view.authorityActiveVersion.separateFinalEvaluationPerformed, false);
  assert.deepEqual(view.authorityActiveVersion.observations.map(item => item.totals),
    [metrics(10, 2), metrics(11, 2), metrics(12, 2)]);
  assert.deepEqual(view.authorityActiveVersion.observations.map(item => item.receiptId),
    last.confirmation.map(pair => pair.evaluated.candidate.receiptId));
  assert.deepEqual(view.attempts[1].confirmation.map(pair => pair.order),
    [['base', 'incumbent', 'candidate'], ['candidate', 'incumbent', 'base'], ['base', 'incumbent', 'candidate']]);
  assert.deepEqual(view.attempts[1].screen.decision, { passed: true, gain: 3, baseGain: 3 });
  assert.equal(view.attempts[1].novelty.receiptId, last.novelty.receiptId);
  assert.equal(view.attempts[1].candidate.procedureDigest, last.candidateDigest);
  assert.equal(view.retainedBank.confirmedLearnedVersions, 2);
  assert.equal(view.retainedBank.historicalCounts.harmful, 35);
  assert.equal(view.retainedBank.historicalOutcomes.rejected, 35);
  assert.equal(view.retainedBank.currentProceduresByStatus.confirmed, 2);
  const encoded = JSON.stringify(view);
  assert.equal(encoded.includes(PRIVATE), false);
  for (const forbidden of ['signature', 'privateKey', 'procedure', 'cases', 'rawResponse', 'comparisons', 'reasons', 'artifact']) {
    assert.equal(encoded.includes('"' + forbidden + '":'), false, forbidden);
  }
  assert.ok(encoded.length < 100_000);
  assert.equal(JSON.stringify(f), before, 'projection must not rewrite any source state or evidence');
});

test('confirmed but unactivated evidence does not replace BASE; a pending review is not a rejected procedure', () => {
  const f = fixture();
  confirmed(f, 1, false);
  const pending = proposal(f, 2, 'reserved', { settled: false });
  f.state.reviews.push({ id: 'review-' + digest('pending'), operationId: f.state.operations.at(-1).id,
    envelope: null, packet: PRIVATE });
  const view = authorityAcceptanceView(f.bundle, f.state);
  assert.equal(view.authorityActiveVersion.versionId, f.state.baseVersion.id);
  assert.equal(view.authorityActiveVersion.basis, 'original-baseline');
  assert.equal(view.attempts[0].candidate.version.confirmed, true);
  assert.equal(view.attempts[1].attemptId, pending.id);
  assert.equal(view.attempts[1].status, 'reserved');
  assert.equal(view.attempts[1].novelty.disposition, 'awaiting-independent-review');
  assert.equal(view.attempts[1].proposalCallState, 'unsettled');
  assert.equal(view.attempts[1].screen, null);
  assert.deepEqual(view.attempts[1].confirmation, []);
  assert.equal(view.settledOneCallProposals, 1);
  assert.match(view.evidenceScope, /host-activation-consumption-not-attested/);
});

test('ten retained negative or invalid attempts remain a ten-cycle table with no invented promotion or zero-call completion', () => {
  const f = fixture(), statuses = ['duplicate', 'unresolved', 'invalid', 'noCoverage', 'rejected'];
  for (let index = 1; index <= 10; index++) {
    const status = statuses[(index - 1) % statuses.length];
    const attempt = proposal(f, index, status, { candidate: status !== 'invalid', calls: index === 10 ? 0 : 1 });
    if (status === 'duplicate') attempt.novelty = { verdict: 'exact', priorIds: [PRIVATE] };
    if (status === 'unresolved') attempt.novelty = { verdict: 'uncertain', receiptId: 'novelty-' + digest(attempt.id), reasons: PRIVATE };
  }
  const view = authorityAcceptanceView(f.bundle, f.state);
  assert.equal(view.attemptLimit, 10); assert.equal(view.observedAttempts, 10);
  assert.equal(view.settledOneCallProposals, 9);
  assert.deepEqual(view.attempts.map(item => item.number), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.equal(view.attempts[9].proposalCallState, 'settled-other-count');
  assert.equal(view.attempts[0].novelty.disposition, 'exact');
  assert.equal(view.attempts[0].novelty.receiptId, null);
  assert.equal(view.authorityActiveVersion.versionId, f.state.baseVersion.id);
  assert.equal(view.retainedBank.confirmedLearnedVersions, 0);
  for (const status of statuses) assert.equal(view.retainedBank.currentAttemptsByStatus[status], 2);
  assert.equal(view.retainedBank.currentProceduresByStatus.invalid, 0);
  assert.equal(JSON.stringify(view).includes(PRIVATE), false);
});

test('oversized, cross-bound, inconsistent or unconfirmed acceptance data is refused with bounded errors', () => {
  for (const alter of [
    f => { f.state.binding.sourceCommit = 'd'.repeat(40); },
    f => { f.state.baseline.totals.net++; },
    f => { f.state.baseline.receiptId = PRIVATE.repeat(100); },
    f => { for (let i = 1; i <= 11; i++) proposal(f, i, 'invalid', { candidate: false }); },
    f => { proposal(f, 1, PRIVATE); },
    f => { const attempt = confirmed(f, 1, true); attempt.confirmation.push(clone(attempt.confirmation[0])); },
    f => { const attempt = confirmed(f, 1, true); attempt.confirmation[0].decision.passed = false; },
    f => { const attempt = confirmed(f, 1, true); attempt.confirmation[0].evaluated.candidate.executionIndex = 0; },
    f => { f.state.versions[0].confirmed = false; },
  ]) {
    const f = fixture(); alter(f);
    assert.throws(() => authorityAcceptanceView(f.bundle, f.state), error =>
      error.message.startsWith('LEARNING_V2_REJECTED:') && !error.message.includes(PRIVATE));
  }
});
