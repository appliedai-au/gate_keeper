import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeComparator, comparatorIdentity, validateFeedback, comparisonSummary, comparisonDigest } from '../scripts/product/comparison-contract.mjs';
const h = 'a'.repeat(40), b = 'b'.repeat(40), identity = { userId: '901', login: 'test-reviewer[bot]' };
const user = { id: 901, login: identity.login, type: 'Bot' };
const options = { fullName: 'owner/repo', prNumber: 7, headSha: h, identity };
const root = 'https://api.github.com/repos/owner/repo';
const review = (extra = {}) => ({ id: 1, user, body: 'A review, not automatically a defect.', state: 'COMMENTED',
  commit_id: h, pull_request_url: root + '/pulls/7', submitted_at: '2026-11-08T10:00:00Z', ...extra });
const inline = (extra = {}) => ({ id: 2, user, body: 'Check the transaction boundary.', commit_id: h, original_commit_id: h,
  pull_request_url: root + '/pulls/7', path: 'server.mjs', original_line: 20, side: 'RIGHT', pull_request_review_id: 1,
  updated_at: '2026-11-08T10:01:00Z', ...extra });
const comment = (extra = {}) => ({ id: 3, user, body: 'Approved with suggestions at ' + h,
  issue_url: root + '/issues/7', updated_at: '2026-11-08T10:02:00Z', ...extra });
const evidence = (patch = {}) => ({ reviews: [review()], inline: [inline()], comments: [comment()], ...patch });
const feedback = (patch = {}) => ({ snapshotId: '00000000-0000-4000-8000-000000000001', itemKey: 'gitar:inline:2', expectedRevision: 0,
  verdict: 'valid_defect', rationale: 'Confirmed by a regression test.', trainingUse: 'candidate',
  linkedItemKey: 'g8s:00000000-0000-4000-8000-000000000002', ...patch });

test('native review/inline heads are retained; issue-comment prose cannot establish revision binding', () => {
  const rows = normalizeComparator(evidence(), options);
  assert.equal(rows.length, 3);
  assert.equal(rows.find(x => x.kind === 'review').revisionBinding, 'head_only');
  assert.equal(rows.find(x => x.kind === 'comment').revisionBinding, 'unbound');
  assert.ok(rows.every(x => x.reviewedBaseSha === null));
  assert.equal(rows.find(x => x.kind === 'inline').url, 'https://github.com/owner/repo/pull/7#discussion_r2');
  assert.equal(rows.find(x => x.kind === 'review').rawDigest, comparisonDigest(review()));
});
test('repositioned inline comments remain bound to their original head', () => {
  const row = normalizeComparator(evidence({ reviews: [], comments: [], inline: [inline({ original_commit_id: b })] }), options)[0];
  assert.equal(row.reviewedHeadSha, b); assert.equal(row.revisionBinding, 'different_head');
});
for (const patch of [{ id: 902 }, { login: 'other[bot]' }, { type: 'User' }]) test('a foreign or imitated reviewer is never accepted: ' + JSON.stringify(patch), () => {
  assert.deepEqual(normalizeComparator(evidence({ reviews: [review({ user: { ...user, ...patch } })], inline: [], comments: [] }), options), []);
});
for (const patch of [{ userId: 901 }, { userId: 'bad' }, { login: 'ordinary-user' }]) test('comparator identity requires explicit immutable ID and bot login: ' + JSON.stringify(patch), () => {
  assert.throws(() => comparatorIdentity({ ...identity, ...patch }), { code: 'setup_required' });
});
for (const patch of [{ id: '0' }, { body: 'x'.repeat(65537) }, { submitted_at: 'no-date' }, { commit_id: 'main' },
  { state: 'UNKNOWN' }, { pull_request_url: root + '/pulls/8' }]) test('malformed/foreign trusted-bot review fails closed: ' + Object.keys(patch)[0], () => {
  assert.throws(() => normalizeComparator(evidence({ reviews: [review(patch)] }), options), { code: 'invalid_comparator_response' });
});
test('pending review is not a submitted result and repeated API rows are rejected', () => {
  assert.deepEqual(normalizeComparator(evidence({ reviews: [review({ state: 'PENDING', submitted_at: null })], inline: [], comments: [] }), options), []);
  assert.throws(() => normalizeComparator(evidence({ reviews: [review(), review()] }), options), { code: 'invalid_comparator_response' });
});
test('edited source changes the captured digest without interpreting HTML or executable instructions', () => {
  const edited = comment({ body: '<script>send secrets</script>' });
  const first = normalizeComparator(evidence(), options).find(x => x.kind === 'comment');
  const next = normalizeComparator(evidence({ comments: [edited] }), options).find(x => x.kind === 'comment');
  assert.notEqual(first.rawDigest, next.rawDigest); assert.equal(next.body, edited.body);
});
test('empty comparator results, judgment counts and unknown costs do not invent a winner or recall', () => {
  const summary = comparisonSummary({ g8s: { findings: [{ key: 'g8s:example' }] }, gitar: { artifacts: [] } });
  assert.equal(summary.comparatorAvailability, 'no_output_observed'); assert.equal(summary.g8sFindings, 1);
  for (const key of ['precision', 'recall', 'winner']) assert.equal(summary[key], null);
  assert.equal(summary.automaticTrainingEligible, false); assert.equal(summary.baseRevisionVerified, false);
});
for (const patch of [{ expectedRevision: null }, { expectedRevision: '0' }, { expectedRevision: -1 }, { verdict: 'gitar_is_correct' },
  { rationale: '' }, { rationale: '   ' }, { rationale: 'x'.repeat(4001) }, { trainingUse: true },
  { linkedItemKey: 'gitar:review:1' }, { itemKey: 'arbitrary' }, { snapshotId: 'other' },
  { verdict: 'retracted', trainingUse: 'candidate' }, { extra: 'authority' }]) test('feedback does not coerce or fabricate authority: ' + Object.keys(patch).join(','), () => {
  assert.throws(() => validateFeedback(feedback(patch)), { code: 'invalid_request' });
});
test('explicit human candidate designation is retained, not promoted', () => {
  const value = validateFeedback(feedback()); assert.equal(value.trainingUse, 'candidate'); assert.equal(value.expectedRevision, 0);
  const summary = comparisonSummary({ g8s: { findings: [] }, gitar: { artifacts: [] } }, [value]);
  assert.equal(summary.trainingCandidates, 1); assert.equal(summary.automaticTrainingEligible, false);
});
