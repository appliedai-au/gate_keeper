/** Admission verification only: this module does not run a scanner, model, or arbitrary repository command. */
import { createHash, createPublicKey, verify } from 'node:crypto';
import { ProductError } from './store.mjs';
import { SHA, UUID } from './contracts.mjs';

export const REQUIRED_CHECKS = Object.freeze(['build', 'typecheck', 'tests', 'static_analysis', 'secrets']);
export const LEARNING_POLICY_LABEL = 'Require adversarial verification before banking lessons';
const HASH = /^[a-f0-9]{64}$/u;
const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export const exact = (x, fields) => record(x) && Object.keys(x).length === fields.length && fields.every(k => Object.hasOwn(x, k));
export const refuseLesson = (code = 'invalid_request', status = 400) => { throw new ProductError(code, status); };
export function canonicalLesson(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalLesson).join(',') + ']';
  if (!record(value) || Object.getPrototypeOf(value) !== Object.prototype) refuseLesson();
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonicalLesson(value[k])).join(',') + '}';
}
export const lessonHash = value => createHash('sha256').update(canonicalLesson(value)).digest('hex');
const same = (a, b) => canonicalLesson(a) === canonicalLesson(b);
const safeText = (x, max) => typeof x === 'string' && x.trim().length > 0 && x.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(x);
export function validateLearningPolicy(input) {
  if (!exact(input, ['requireAdversarialVerification', 'expectedRevision', 'reason']) ||
      typeof input.requireAdversarialVerification !== 'boolean' || !Number.isSafeInteger(input.expectedRevision) ||
      input.expectedRevision < 1 || !safeText(input.reason, 500)) refuseLesson();
  return { ...input, reason: input.reason.trim() };
}
export function validateLessonChange(change, headSha) {
  if (change === null) return null;
  if (!exact(change, ['beforeSha', 'afterSha', 'diffSha256']) || change.beforeSha !== headSha ||
      !SHA.test(change.afterSha || '') || change.afterSha === headSha || !HASH.test(change.diffSha256 || '')) refuseLesson();
  return { ...change }; // A claim until signed runner evidence verifies the actual bytes.
}
export function buildLessonSubject(detail, policy, change = null) {
  if (!record(detail) || !UUID.test(detail.comparisonId || '') || !UUID.test(detail.snapshotId || '') || !HASH.test(detail.payloadHash || '') ||
      !record(policy) || !Number.isSafeInteger(policy.revision) || policy.revision < 1 ||
      typeof policy.requireAdversarialVerification !== 'boolean' || !record(detail.observedRevision) ||
      !SHA.test(detail.observedRevision.headSha || '') || !SHA.test(detail.observedRevision.baseSha || '') ||
      !Array.isArray(detail.feedback) || !Array.isArray(detail.g8s?.findings) || !Array.isArray(detail.gitar?.artifacts)) refuseLesson();
  const feedback = detail.feedback.map(row => ({ id: row.id, itemKey: row.itemKey, revision: row.revision,
    verdict: row.verdict, rationale: row.rationale, trainingUse: row.trainingUse, linkedItemKey: row.linkedItemKey })).sort((a, b) => a.id.localeCompare(b.id));
  const candidates = feedback.filter(row => row.trainingUse === 'candidate' && !['retracted', 'insufficient_context'].includes(row.verdict));
  if (!candidates.length) refuseLesson('no_learning_candidates', 409);
  const items = [...detail.g8s.findings, ...detail.gitar.artifacts], itemKeys = items.map(item => item.key).sort();
  if (new Set(itemKeys).size !== itemKeys.length || itemKeys.length > 600) refuseLesson();
  const selected = new Set(candidates.flatMap(row => [row.itemKey, ...(row.linkedItemKey ? [row.linkedItemKey] : [])]));
  for (const key of selected) {
    const item = items.find(row => row.key === key);
    if (!item) refuseLesson();
    if (item.source !== 'g8s' && item.revisionBinding !== 'head_only') refuseLesson('unbound_lesson_evidence', 409);
  }
  const subject = { schema: 'g8s-lesson-subject-v1', comparisonId: detail.comparisonId, snapshotId: detail.snapshotId,
    payloadHash: detail.payloadHash, feedbackHash: lessonHash(feedback), policyRevision: policy.revision,
    requireAdversarialVerification: policy.requireAdversarialVerification,
    repositoryId: detail.repositoryId, repository: detail.repository, prNumber: detail.prNumber,
    headSha: detail.observedRevision.headSha, baseSha: detail.observedRevision.baseSha,
    baseBranch: detail.observedRevision.baseBranch, itemKeys,
    candidateFeedbackIds: candidates.map(row => row.id).sort(),
    change: validateLessonChange(change, detail.observedRevision.headSha), benchmark: 'gitar_process', checks: [...REQUIRED_CHECKS] };
  return { subject, subjectHash: lessonHash(subject), candidates };
}

/** Explicit public trust roots; neither a browser nor a model supplies a verification key. */
export function verificationTrust(raw) {
  if (raw === undefined || raw === '') return Object.freeze({});
  try {
    const input = JSON.parse(raw);
    if (!record(input) || Object.keys(input).length > 10) throw Error();
    const result = {};
    for (const [id, value] of Object.entries(input)) {
      if (!/^[a-zA-Z0-9_-]{1,64}$/u.test(id) || ['__proto__', 'constructor', 'prototype'].includes(id) ||
          !exact(value, ['role', 'publicKey']) || !['deterministic', 'adversarial'].includes(value.role) ||
          typeof value.publicKey !== 'string' || value.publicKey.length > 2048) throw Error();
      const key = createPublicKey(value.publicKey);
      if (key.asymmetricKeyType !== 'ed25519') throw Error();
      result[id] = Object.freeze({ role: value.role, key,
        fingerprint: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('hex') });
    }
    return Object.freeze(result);
  } catch { refuseLesson('verification_setup_required', 503); }
}
function authenticatedReceipt(envelope, role, subjectHash, trust, now) {
  if (!exact(envelope, ['keyId', 'payload', 'signature']) || typeof envelope.keyId !== 'string' ||
      typeof envelope.signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/u.test(envelope.signature) || !record(envelope.payload))
    refuseLesson('verification_required', 409);
  const authority = Object.hasOwn(trust, envelope.keyId) ? trust[envelope.keyId] : null;
  if (!authority || authority.role !== role) refuseLesson('verification_required', 409);
  const bytes = Buffer.from(canonicalLesson(envelope.payload));
  if (bytes.length > 128 * 1024 || !verify(null, bytes, authority.key, Buffer.from(envelope.signature, 'base64url')))
    refuseLesson('verification_required', 409);
  const p = envelope.payload;
  if (p.schema !== 'g8s-lesson-receipt-v1' || p.role !== role || p.subjectHash !== subjectHash ||
      !UUID.test(p.runId || '') || !HASH.test(p.logsSha256 || '') || !HASH.test(p.recipeSha256 || '') ||
      typeof p.issuedAt !== 'string' || typeof p.expiresAt !== 'string' || !Number.isFinite(Date.parse(p.issuedAt)) ||
      !Number.isFinite(Date.parse(p.expiresAt)) || Date.parse(p.issuedAt) > now + 60000 ||
      Date.parse(p.expiresAt) <= now || Date.parse(p.expiresAt) <= Date.parse(p.issuedAt) ||
      Date.parse(p.expiresAt) - Date.parse(p.issuedAt) > 86400000 || p.result !== 'confirmed')
    refuseLesson('verification_required', 409);
  return { payload: p, fingerprint: authority.fingerprint, keyId: envelope.keyId, receiptHash: lessonHash(envelope) };
}
export function verifyLessonAdmission({ subject, subjectHash, evidence, trust, now = Date.now() }) {
  if (subjectHash !== lessonHash(subject) || !exact(evidence, ['deterministic', 'adversarial'])) refuseLesson();
  if (!Object.keys(trust).length) refuseLesson('verification_setup_required', 503);
  const deterministic = authenticatedReceipt(evidence.deterministic, 'deterministic', subjectHash, trust, now);
  const d = deterministic.payload, expectedHead = subject.change?.afterSha ?? subject.headSha;
  if (d.repositoryId !== subject.repositoryId || d.baseSha !== subject.baseSha || d.headSha !== expectedHead ||
      !Array.isArray(d.checks) || d.checks.length !== REQUIRED_CHECKS.length ||
      !same(d.checks.map(x => x.name).sort(), [...REQUIRED_CHECKS].sort()) ||
      d.checks.some(x => !exact(x, ['name', 'status', 'evidenceSha256']) || x.status !== 'passed' || !HASH.test(x.evidenceSha256 || '')) ||
      d.exactRevisionVerified !== true || d.immutableRecipe !== true || d.testsWeakened !== false ||
      !Array.isArray(d.claims) || !same(d.claims.map(x => x.feedbackId).sort(), subject.candidateFeedbackIds) ||
      d.claims.some(x => !exact(x, ['feedbackId', 'result', 'method', 'evidenceSha256']) || x.result !== 'supports_feedback' ||
        !['regression_test', 'static_trace', 'counterexample', 'reproduction'].includes(x.method) || !HASH.test(x.evidenceSha256 || '')))
    refuseLesson('deterministic_verification_failed', 409);
  if (subject.change && (!record(d.change) || !same(d.change.binding, subject.change) || d.change.beforeReproduced !== true ||
      d.change.afterRegressionPassed !== true || d.change.noNewRegressions !== true)) refuseLesson('change_verification_required', 409);
  let adversarial = null;
  if (subject.requireAdversarialVerification) {
    adversarial = authenticatedReceipt(evidence.adversarial, 'adversarial', subjectHash, trust, now);
    const a = adversarial.payload;
    if (adversarial.fingerprint === deterministic.fingerprint || a.runId === d.runId ||
        a.independentSession !== true || !safeText(a.model, 200) || !a.model.startsWith('truefoundry/') ||
        a.unresolved !== 0 || !Array.isArray(a.reviewedItemKeys) || !same([...a.reviewedItemKeys].sort(), subject.itemKeys) ||
        !Array.isArray(a.confirmedFeedbackIds) || !same([...a.confirmedFeedbackIds].sort(), subject.candidateFeedbackIds) ||
        a.reviewedChanges !== (subject.change !== null) || a.counterargumentsConsidered !== true)
      refuseLesson('adversarial_verification_failed', 409);
  } else if (evidence.adversarial !== null) refuseLesson();
  return { deterministic: { runId: d.runId, keyId: deterministic.keyId, receiptHash: deterministic.receiptHash },
    adversarial: adversarial ? { runId: adversarial.payload.runId, keyId: adversarial.keyId, receiptHash: adversarial.receiptHash } : null,
    mode: adversarial ? 'deterministic_plus_adversarial_plus_human' : 'deterministic_plus_human' };
}
