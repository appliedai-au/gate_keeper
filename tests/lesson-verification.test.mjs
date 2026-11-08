import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLessonSubject, verifyLessonAdmission, verificationTrust, validateLearningPolicy,
  canonicalLesson, lessonHash } from '../scripts/product/lesson-verification.mjs';
import { fixtureDetail, testAuthority, uuid, hash } from './helpers/lesson-fixture.mjs';
const policy = { revision: 1, requireAdversarialVerification: true };
const bound = change => buildLessonSubject(fixtureDetail(), policy, change ?? null);
const rejects = (fn, code) => assert.throws(fn, error => !code || error.code === code);
const authority = testAuthority();

test('subject covers both reviewers, all feedback, policy and changes with stable key ordering', () => {
  const result = bound();
  assert.equal(result.subject.itemKeys.length, 2);
  assert.equal(result.subject.benchmark, 'gitar_process');
  assert.equal(lessonHash({ b: 2, a: 1 }), lessonHash({ a: 1, b: 2 }));
  assert.notEqual(buildLessonSubject(fixtureDetail(), { ...policy, revision: 2 }).subjectHash, result.subjectHash);
  assert.notEqual(buildLessonSubject({ ...fixtureDetail(), feedback: fixtureDetail().feedback.map(x => ({ ...x, rationale: 'different' })) }, policy).subjectHash, result.subjectHash);
});
for (const input of ['true', 1, null, undefined]) test('admin checkbox never coerces ' + String(input), () => {
  rejects(() => validateLearningPolicy({ requireAdversarialVerification: input, expectedRevision: 1, reason: 'Test' }), 'invalid_request');
});
for (const revision of [null, '1', 0, -1, 1.5]) test('policy changes require a real revision: ' + String(revision), () => {
  rejects(() => validateLearningPolicy({ requireAdversarialVerification: true, expectedRevision: revision, reason: 'Test' }));
});
test('unbound or different-head Gitar evidence cannot become a lesson', () => {
  for (const revisionBinding of ['unbound', 'different_head']) {
    const detail = fixtureDetail(); detail.gitar.artifacts[0].revisionBinding = revisionBinding;
    rejects(() => buildLessonSubject(detail, policy), 'unbound_lesson_evidence');
  }
});
test('excluded or retracted feedback produces no candidates', () => {
  const detail = fixtureDetail(); detail.feedback[0].trainingUse = 'excluded';
  rejects(() => buildLessonSubject(detail, policy), 'no_learning_candidates');
});
test('separate authentic deterministic and adversarial receipts permit evidence admission, not training', () => {
  const b = bound(); const receipt = verifyLessonAdmission({ ...b, evidence: authority.evidence(b), trust: authority.trust });
  assert.equal(receipt.mode, 'deterministic_plus_adversarial_plus_human');
  assert.notEqual(receipt.deterministic.runId, receipt.adversarial.runId);
});
test('absence of trusted verifiers is explicit and cannot bank from Gitar approval text', () => {
  const b = bound(); rejects(() => verifyLessonAdmission({ ...b, evidence: { deterministic: 'Gitar Approved', adversarial: null }, trust: {} }), 'verification_setup_required');
});
test('tampered payload and caller-created key do not establish verification', () => {
  const b = bound(), evidence = authority.evidence(b);
  evidence.deterministic.payload.testsWeakened = true;
  rejects(() => verifyLessonAdmission({ ...b, evidence, trust: authority.trust }), 'verification_required');
  const stranger = testAuthority();
  rejects(() => verifyLessonAdmission({ ...b, evidence: stranger.evidence(b), trust: authority.trust }), 'verification_required');
});
for (const status of ['failed', 'skipped', 'neutral', 'cancelled', 'pending']) test('green aggregate cannot conceal required check status ' + status, () => {
  const b = bound(), evidence = authority.evidence(b), payload = structuredClone(evidence.deterministic.payload);
  payload.checks[0].status = status; evidence.deterministic = authority.signed('deterministic', payload);
  rejects(() => verifyLessonAdmission({ ...b, evidence, trust: authority.trust }), 'deterministic_verification_failed');
});
for (const patch of [
  { testsWeakened: true }, { exactRevisionVerified: false }, { immutableRecipe: false },
  { headSha: 'c'.repeat(40) }, { repositoryId: '202' }, { claims: [] }, { checks: [] },
]) test('deterministic evidence cannot omit or weaken ' + Object.keys(patch)[0], () => {
  const b = bound(), evidence = authority.evidence(b);
  evidence.deterministic = authority.signed('deterministic', { ...evidence.deterministic.payload, ...patch });
  rejects(() => verifyLessonAdmission({ ...b, evidence, trust: authority.trust }), 'deterministic_verification_failed');
});
for (const patch of [
  { independentSession: false }, { unresolved: 1 }, { counterargumentsConsidered: false },
  { reviewedItemKeys: ['gitar:review:11'] }, { confirmedFeedbackIds: [] }, { reviewedChanges: true },
  { model: 'direct-provider/model' }, { runId: uuid(100) },
]) test('adversarial evidence rejects incomplete or reused work: ' + Object.keys(patch)[0], () => {
  const b = bound(), evidence = authority.evidence(b);
  evidence.adversarial = authority.signed('adversarial', { ...evidence.adversarial.payload, ...patch });
  rejects(() => verifyLessonAdmission({ ...b, evidence, trust: authority.trust }), 'adversarial_verification_failed');
});
for (const patch of [
  { result: 'inconclusive' }, { subjectHash: '1'.repeat(64) },
  { expiresAt: '2000-01-01T00:00:00Z' }, { issuedAt: '2099-01-01T00:00:00Z' },
]) test('verification refuses stale/unconfirmed receipt: ' + Object.keys(patch)[0], () => {
  const b = bound(), evidence = authority.evidence(b);
  evidence.deterministic = authority.signed('deterministic', { ...evidence.deterministic.payload, ...patch });
  rejects(() => verifyLessonAdmission({ ...b, evidence, trust: authority.trust }), 'verification_required');
});
test('a proposed fix must reproduce the failure before and pass regressions after', () => {
  const b = bound({ beforeSha: 'a'.repeat(40), afterSha: 'c'.repeat(40), diffSha256: hash });
  const evidence = authority.evidence(b);
  assert.equal(verifyLessonAdmission({ ...b, evidence, trust: authority.trust }).mode, 'deterministic_plus_adversarial_plus_human');
  evidence.deterministic.payload.change.beforeReproduced = false;
  evidence.deterministic = authority.signed('deterministic', evidence.deterministic.payload);
  rejects(() => verifyLessonAdmission({ ...b, evidence, trust: authority.trust }), 'change_verification_required');
});
test('unchecked means deterministic plus human, never unchecked correctness', () => {
  const b = buildLessonSubject(fixtureDetail(), { revision: 2, requireAdversarialVerification: false });
  const evidence = authority.evidence(b);
  assert.equal(evidence.adversarial, null);
  assert.equal(verifyLessonAdmission({ ...b, evidence, trust: authority.trust }).mode, 'deterministic_plus_human');
  evidence.deterministic = null;
  rejects(() => verifyLessonAdmission({ ...b, evidence, trust: authority.trust }), 'verification_required');
});
test('invalid trust config does not silently disable checks', () => {
  rejects(() => verificationTrust('{'), 'verification_setup_required');
  rejects(() => verificationTrust('{"x":{"role":"adversarial","publicKey":"not a key"}}'), 'verification_setup_required');
  assert.deepEqual(verificationTrust(undefined), {});
  rejects(() => canonicalLesson({ value: NaN }), 'invalid_request');
});
