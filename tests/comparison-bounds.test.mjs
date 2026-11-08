import test from 'node:test';
import assert from 'node:assert/strict';
import { COMPARISON_LIMITS, validateFeedback, comparisonCandidates } from '../scripts/product/comparison-contract.mjs';
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const body = rationale => ({ snapshotId: uuid(1), itemKey: 'gitar:review:1', expectedRevision: 0,
  verdict: 'valid_defect', rationale, trainingUse: 'candidate', linkedItemKey: null });
for (const [label, rationale] of [['multibyte', '界'.repeat(1400)], ['JSON escape expansion', '\\'.repeat(2100)]])
  test('feedback limit counts serialized bytes, not just characters: ' + label, () => {
    assert.ok(rationale.length <= 4000);
    assert.throws(() => validateFeedback(body(rationale)), { code: 'invalid_request' });
  });
test('bounded Unicode rationale remains supported', () => {
  const rationale = '界'.repeat(1000);
  assert.equal(validateFeedback(body(rationale)).rationale, rationale);
});
test('maximum-count history and candidate links do not multiply a shared large artifact', () => {
  const common = { key: 'g8s:' + uuid(2), source: 'g8s', explanation: 'E'.repeat(64000) };
  const artifacts = Array.from({ length: COMPARISON_LIMITS.feedbackEvents }, (_, n) => ({
    key: 'gitar:comment:' + (n + 1), source: 'gitar', body: 'Synthetic artifact', revisionBinding: 'unbound' }));
  const labels = artifacts.map((item, n) => ({ id: uuid(n + 10), snapshotId: uuid(1), itemKey: item.key,
    revision: 1, verdict: 'valid_defect', rationale: 'R'.repeat(4000), trainingUse: 'candidate',
    linkedItemKey: common.key, actorUserId: uuid(3), createdAt: '2026-11-08T12:00:00Z', promoted: false }));
  const detail = { comparisonId: uuid(4), snapshotId: uuid(1), payloadHash: 'a'.repeat(64),
    g8s: { headSha: 'b'.repeat(40), baseSha: 'c'.repeat(40), findings: [common] },
    gitar: { artifacts }, feedback: labels, feedbackHistory: labels };
  const result = comparisonCandidates(detail);
  assert.equal(result.candidates.length, COMPARISON_LIMITS.feedbackEvents);
  assert.equal(result.items.length, artifacts.length + 1);
  assert.equal(result.items.filter(item => item.key === common.key).length, 1);
  assert.ok(Buffer.byteLength(JSON.stringify({ data: result })) < COMPARISON_LIMITS.responseBytes);
  assert.ok(Buffer.byteLength(JSON.stringify({ data: detail })) < COMPARISON_LIMITS.responseBytes);
  assert.equal(result.automaticTrainingEligible, false);
});
test('candidate export never silently omits a referenced item', () => {
  assert.throws(() => comparisonCandidates({ g8s: { findings: [] }, gitar: { artifacts: [] },
    feedback: [{ itemKey: 'gitar:review:1', trainingUse: 'candidate', verdict: 'valid_defect', linkedItemKey: null }] }),
  { code: 'product_unavailable' });
});
