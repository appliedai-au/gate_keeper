import { createHash } from 'node:crypto';
import { GITHUB_ID, UUID, SHA, ACTOR_LOGIN, validPath } from './contracts.mjs';
import { ProductError } from './store.mjs';

export const COMPARISON_VERSION = 1;
export const VERDICTS = Object.freeze(['valid_defect', 'false_positive', 'intentional', 'duplicate',
  'already_fixed', 'insufficient_context', 'severity_correction', 'retracted']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (code = 'invalid_request', status = 400) => { throw new ProductError(code, status); };
const text = (value, max, min = 0) => typeof value === 'string' && value.length >= min && value.length <= max &&
  !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
const id = value => typeof value === 'string' && GITHUB_ID.test(value) || Number.isSafeInteger(value) && value > 0;
const time = value => typeof value === 'string' && value.length <= 40 && Number.isFinite(Date.parse(value));
export const comparisonDigest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const comparisonKey = value => typeof value === 'string' && /^(?:g8s:[0-9a-f-]{36}|gitar:(?:review|inline|comment):[1-9][0-9]{0,19})$/u.test(value);

export function comparatorIdentity({ userId, login }) {
  if (typeof userId !== 'string' || !GITHUB_ID.test(userId) || typeof login !== 'string' ||
      !ACTOR_LOGIN.test(login) || !login.endsWith('[bot]')) fail('setup_required', 503);
  return Object.freeze({ userId, login });
}

/** Keep genuine GitHub artifacts; never parse praise, markdown headings or approvals as defects. */
export function normalizeComparator(evidence, { fullName, prNumber, headSha, identity }) {
  comparatorIdentity(identity);
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(fullName || '') || !Number.isSafeInteger(prNumber) ||
      prNumber < 1 || !SHA.test(headSha || '') || !exact(evidence, ['reviews', 'inline', 'comments'])) fail();
  const root = `https://api.github.com/repos/${fullName}`, pull = `${root}/pulls/${prNumber}`;
  const pageUrl = `https://github.com/${fullName}/pull/${prNumber}`;
  const artifacts = [], seen = new Set(); let bytes = 0;
  for (const kind of ['reviews', 'inline', 'comments']) {
    const rows = evidence[kind];
    if (!Array.isArray(rows) || rows.length > 500) fail('comparison_too_large', 413);
    for (const raw of rows) {
      // Mutable login alone is never authority. A reused/foreign login is ignored.
      if (!object(raw) || String(raw.user?.id) !== identity.userId || raw.user?.login !== identity.login || raw.user?.type !== 'Bot') continue;
      if (!id(raw.id) || !text(raw.body, 65536) ||
          (kind === 'comments' ? raw.issue_url !== `${root}/issues/${prNumber}` : raw.pull_request_url !== pull))
        fail('invalid_comparator_response', 502);
      const sourceKind = kind === 'reviews' ? 'review' : kind === 'inline' ? 'inline' : 'comment';
      const key = `gitar:${sourceKind}:${raw.id}`;
      if (seen.has(key)) fail('invalid_comparator_response', 502); seen.add(key);
      const observedAt = kind === 'reviews' ? raw.submitted_at : raw.updated_at;
      if (!time(observedAt)) {
        if (kind === 'reviews' && raw.state === 'PENDING') continue;
        fail('invalid_comparator_response', 502);
      }
      let reviewedHeadSha = null;
      if (kind === 'reviews') {
        if (!['APPROVED', 'CHANGES_REQUESTED', 'COMMENTED', 'DISMISSED'].includes(raw.state) || !SHA.test(raw.commit_id || ''))
          fail('invalid_comparator_response', 502);
        reviewedHeadSha = raw.commit_id;
      } else if (kind === 'inline') {
        // original_commit_id binds the original comment, not a later repositioning.
        if (!SHA.test(raw.original_commit_id || '') || !SHA.test(raw.commit_id || '') || !validPath(raw.path))
          fail('invalid_comparator_response', 502);
        reviewedHeadSha = raw.original_commit_id;
      }
      bytes += Buffer.byteLength(JSON.stringify(raw));
      if (bytes > 1024 * 1024 || artifacts.length >= 500) fail('comparison_too_large', 413);
      artifacts.push({ key, source: 'gitar', kind: sourceKind, sourceId: String(raw.id),
        actor: { userId: identity.userId, login: identity.login }, body: raw.body,
        rawDigest: comparisonDigest(raw), sourceUpdatedAt: observedAt,
        url: `${pageUrl}#${kind === 'reviews' ? 'pullrequestreview-' : kind === 'inline' ? 'discussion_r' : 'issuecomment-'}${raw.id}`,
        reviewedHeadSha, reviewedBaseSha: null,
        revisionBinding: reviewedHeadSha === null ? 'unbound' : reviewedHeadSha === headSha ? 'head_only' : 'different_head',
        state: kind === 'reviews' ? raw.state : null,
        file: kind === 'inline' ? raw.path : null,
        line: kind === 'inline' && Number.isSafeInteger(raw.original_line) && raw.original_line > 0 ? raw.original_line : null,
        side: kind === 'inline' && ['LEFT', 'RIGHT'].includes(raw.side) ? raw.side : null,
        parentReviewId: kind === 'inline' && id(raw.pull_request_review_id) ? String(raw.pull_request_review_id) : null,
        replyToId: kind === 'inline' && id(raw.in_reply_to_id) ? String(raw.in_reply_to_id) : null });
    }
  }
  return artifacts.sort((a, b) => a.key.localeCompare(b.key));
}

export function validateFeedback(body) {
  if (!exact(body, ['snapshotId', 'itemKey', 'expectedRevision', 'verdict', 'rationale', 'trainingUse', 'linkedItemKey']) ||
      typeof body.snapshotId !== 'string' || !UUID.test(body.snapshotId) || !comparisonKey(body.itemKey) ||
      !Number.isSafeInteger(body.expectedRevision) || body.expectedRevision < 0 || body.expectedRevision > 100000 ||
      !VERDICTS.includes(body.verdict) || !text(body.rationale, 4000, 1) || !body.rationale.trim() ||
      !['excluded', 'candidate'].includes(body.trainingUse) ||
      body.linkedItemKey !== null && (!comparisonKey(body.linkedItemKey) || body.linkedItemKey.split(':')[0] === body.itemKey.split(':')[0]) ||
      body.verdict === 'retracted' && body.trainingUse !== 'excluded') fail();
  return { snapshotId: body.snapshotId, itemKey: body.itemKey, expectedRevision: body.expectedRevision,
    verdict: body.verdict, rationale: body.rationale.trim(), trainingUse: body.trainingUse, linkedItemKey: body.linkedItemKey };
}

export function comparisonSummary(payload, labels = []) {
  if (!object(payload) || !Array.isArray(payload.g8s?.findings) || !Array.isArray(payload.gitar?.artifacts)) fail('product_unavailable', 503);
  const current = labels.filter(row => row.verdict !== 'retracted');
  return { g8sFindings: payload.g8s.findings.length, gitarArtifacts: payload.gitar.artifacts.length,
    matchingHeadArtifacts: payload.gitar.artifacts.filter(row => row.revisionBinding === 'head_only').length,
    unboundArtifacts: payload.gitar.artifacts.filter(row => row.revisionBinding === 'unbound').length,
    differentHeadArtifacts: payload.gitar.artifacts.filter(row => row.revisionBinding === 'different_head').length,
    comparatorAvailability: payload.gitar.artifacts.length ? 'captured' : 'no_output_observed',
    adjudicatedItems: current.length, trainingCandidates: current.filter(row => row.trainingUse === 'candidate').length,
    comparisonQuality: 'requires_human_review', baseRevisionVerified: false, independenceVerified: false,
    automaticTrainingEligible: false, precision: null, recall: null, winner: null };
}
