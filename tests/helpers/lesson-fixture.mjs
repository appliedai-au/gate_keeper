import { generateKeyPairSync, sign } from 'node:crypto';
import { canonicalLesson, verificationTrust, REQUIRED_CHECKS } from '../../scripts/product/lesson-verification.mjs';
export const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
export const hash = 'e'.repeat(64);
export function fixtureDetail() {
  return { comparisonId: uuid(1), snapshotId: uuid(2), payloadHash: 'f'.repeat(64), repositoryId: '101',
    repository: 'owner/repository', prNumber: 7,
    observedRevision: { repositoryId: '101', prNumber: 7, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40), baseBranch: 'main' },
    g8s: { findings: [{ key: 'g8s:' + uuid(3), source: 'g8s', kind: 'finding' }] },
    gitar: { artifacts: [{ key: 'gitar:review:11', source: 'gitar', revisionBinding: 'head_only' }] },
    feedback: [{ id: uuid(4), itemKey: 'gitar:review:11', revision: 1, verdict: 'valid_defect',
      rationale: 'Synthetic reproduced defect', trainingUse: 'candidate', linkedItemKey: 'g8s:' + uuid(3) }] };
}
export function testAuthority() {
  const keys = { deterministic: generateKeyPairSync('ed25519'), adversarial: generateKeyPairSync('ed25519') };
  const trust = verificationTrust(JSON.stringify(Object.fromEntries(Object.entries(keys).map(([role, pair]) =>
    [role, { role, publicKey: pair.publicKey.export({ type: 'spki', format: 'pem' }) }]))));
  function signed(role, payload) {
    return { keyId: role, payload, signature: sign(null, Buffer.from(canonicalLesson(payload)), keys[role].privateKey).toString('base64url') };
  }
  function evidence(bound, now = Date.now()) {
    const s = bound.subject;
    const common = { schema: 'g8s-lesson-receipt-v1', subjectHash: bound.subjectHash, result: 'confirmed',
      issuedAt: new Date(now - 1000).toISOString(), expiresAt: new Date(now + 3600000).toISOString(), logsSha256: hash, recipeSha256: hash };
    const deterministic = signed('deterministic', { ...common, role: 'deterministic', runId: uuid(100),
      repositoryId: s.repositoryId, baseSha: s.baseSha, headSha: s.change?.afterSha ?? s.headSha,
      exactRevisionVerified: true, immutableRecipe: true, testsWeakened: false,
      checks: REQUIRED_CHECKS.map(name => ({ name, status: 'passed', evidenceSha256: hash })),
      claims: s.candidateFeedbackIds.map(feedbackId => ({ feedbackId, result: 'supports_feedback', method: 'regression_test', evidenceSha256: hash })),
      ...(s.change ? { change: { binding: s.change, beforeReproduced: true, afterRegressionPassed: true, noNewRegressions: true } } : {}) });
    const adversarial = s.requireAdversarialVerification ? signed('adversarial', { ...common, role: 'adversarial', runId: uuid(101),
      independentSession: true, model: 'truefoundry/synthetic-judge', unresolved: 0,
      reviewedItemKeys: [...s.itemKeys], confirmedFeedbackIds: [...s.candidateFeedbackIds], reviewedChanges: s.change !== null,
      counterargumentsConsidered: true }) : null;
    return { deterministic, adversarial };
  }
  return { trust, signed, evidence, keys };
}
