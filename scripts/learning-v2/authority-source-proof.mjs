/**
 * Independently retrieve public exact-source and review evidence. The test
 * execution trust boundary is explicit: a pinned authenticated owner publishes
 * the actual Railway qualification receipt, including its raw-log digest.
 * This service has no broad Railway credential and makes no claim to have
 * rerun those tests itself.
 */
import { createHash } from 'node:crypto';
import { canonical, copy, digest, hash, integer, record, requireThat, text } from './contracts.mjs';
import { hasCompleteReviewDashboard } from './review-dashboard.mjs';

const REPOSITORY = 'appliedai-au/gate_keeper';
const ROOT = 'https://api.github.com/repos/' + REPOSITORY;
const BOT_ID = 159877585;
const BOT_LOGIN = 'gitar-bot[bot]';
const PREFIX = 'GK_AUTHORITY_QUALIFICATION\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b, why) => requireThat(canonical(a) === canonical(b), why);

async function github(fetcher, path) {
  requireThat(path.startsWith('/') && !path.includes('..'), 'source evidence path');
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30_000);
  try {
    const response = await fetcher(ROOT + path, { redirect: 'error', signal: abort.signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    requireThat(response.ok, 'source evidence unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength;
      requireThat(size <= 4 * 1024 * 1024, 'source evidence size');
      chunks.push(Buffer.from(chunk));
    }
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    canonical(body);
    return body;
  } finally { clearTimeout(timer); }
}

function checkSummary(value, label) {
  record(value, ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'], label);
  for (const key of Object.keys(value)) integer(value[key], label + ' ' + key, 0, 1000000);
  requireThat(value.tests > 0 && value.tests === value.pass &&
    ['fail', 'skipped', 'cancelled', 'todo'].every(key => value[key] === 0), label + ' incomplete');
}

export function createSourceGateVerifier({ descriptor: supplied, fetcher = fetch }) {
  record(supplied, ['schema', 'repository', 'sourceCommit', 'qualification'], 'protected source proof');
  const descriptor = copy(supplied);
  requireThat(descriptor.schema === 'gk-learning-source-proof-v1' &&
    descriptor.repository === REPOSITORY, 'protected source proof repository');
  hash(descriptor.sourceCommit, 'protected source commit', 40);
  record(descriptor.qualification, ['commentId', 'bodySha256', 'authorId', 'authorLogin'],
    'qualification artifact pin');
  integer(descriptor.qualification.commentId, 'qualification comment', 1);
  integer(descriptor.qualification.authorId, 'qualification author', 1);
  text(descriptor.qualification.authorLogin, 'qualification author login', 100);
  hash(descriptor.qualification.bodySha256, 'qualification body hash');

  return async bundle => {
    requireThat(bundle.binding.sourceCommit === descriptor.sourceCommit, 'source proof differs from frozen source');
    const q = descriptor.qualification;
    const comment = await github(fetcher, '/issues/comments/' + q.commentId);
    requireThat(comment.id === q.commentId && comment.user?.id === q.authorId &&
      comment.user.login === q.authorLogin && sha(comment.body) === q.bodySha256 &&
      comment.body.startsWith(PREFIX), 'qualification owner or exact artifact changed');
    const proof = JSON.parse(comment.body.slice(PREFIX.length));
    record(proof, ['schema', 'repository', 'pullRequest', 'qualifiedCommit', 'baseCommit', 'treeSha',
      'gatePolicy', 'deployment', 'cleanup', 'checks', 'rawLogsDigest', 'review'], 'owner qualification receipt');
    requireThat(proof.schema === 'gk-learning-source-qualification-v1' && proof.repository === REPOSITORY,
      'qualification schema or repository');
    integer(proof.pullRequest, 'qualification PR', 1);
    for (const key of ['qualifiedCommit', 'baseCommit', 'treeSha']) hash(proof[key], key, 40);
    hash(proof.rawLogsDigest, 'qualification log digest');
    equal(proof.gatePolicy, bundle.config.gatePolicy, 'qualification target/preset/profile differs from frozen policy');
    requireThat(proof.gatePolicy.effectiveTreeDigest === digest({ repository: REPOSITORY, gitTree: proof.treeSha }),
      'qualification effective Git tree digest');
    requireThat(comment.issue_url === ROOT + '/issues/' + proof.pullRequest, 'qualification comment belongs to another PR');
    record(proof.deployment, ['projectId', 'environmentId', 'serviceId', 'deploymentId', 'finishedAt', 'status'],
      'qualification deployment');
    for (const key of ['projectId', 'environmentId', 'serviceId', 'deploymentId']) {
      requireThat(/^[a-f0-9-]{36}$/u.test(proof.deployment[key]), 'qualification Railway identity');
    }
    requireThat(proof.deployment.status === 'SUCCESS' && Number.isFinite(Date.parse(proof.deployment.finishedAt)),
      'qualification deployment not successful');
    record(proof.cleanup, ['complete', 'serviceId', 'observedAt'], 'qualification cleanup observation');
    requireThat(proof.cleanup.complete === true && proof.cleanup.serviceId === proof.deployment.serviceId &&
      Number.isFinite(Date.parse(proof.cleanup.observedAt)) &&
      Date.parse(proof.cleanup.observedAt) >= Date.parse(proof.deployment.finishedAt) &&
      Date.parse(comment.created_at) >= Date.parse(proof.cleanup.observedAt),
    'qualification cleanup has no actual owner observation after successful execution');
    record(proof.checks, ['node', 'canary', 'typecheck', 'scorerSelfTests'], 'qualification checks');
    checkSummary(proof.checks.node, 'full Node suite');
    checkSummary(proof.checks.canary, 'privacy canary');
    requireThat(proof.checks.typecheck === 'passed' && proof.checks.scorerSelfTests === 5,
      'qualification typecheck or scorer self-test incomplete');
    const [pr, qualified, source, base, main, preset] = await Promise.all([
      github(fetcher, '/pulls/' + proof.pullRequest),
      github(fetcher, '/git/commits/' + proof.qualifiedCommit),
      github(fetcher, '/git/commits/' + descriptor.sourceCommit),
      github(fetcher, '/git/commits/' + proof.baseCommit),
      github(fetcher, '/branches/main'),
      github(fetcher, '/contents/Dockerfile.qualify?ref=' + descriptor.sourceCommit),
    ]);
    requireThat(preset.encoding === 'base64' && typeof preset.content === 'string' &&
      preset.content.length <= 100000 && /^[A-Za-z0-9+/=\s]+$/u.test(preset.content) &&
      sha(Buffer.from(preset.content.replace(/\s/gu, ''), 'base64')) === proof.gatePolicy.presetDigest,
    'actual qualified Dockerfile differs from pinned full-suite preset');
    requireThat(pr.head?.sha === proof.qualifiedCommit && pr.base?.ref === 'main' &&
      pr.head.repo?.full_name === REPOSITORY && pr.base.repo?.full_name === REPOSITORY &&
      pr.merged === true && pr.merge_commit_sha === descriptor.sourceCommit,
    'qualification does not describe the merged repository PR');
    requireThat(qualified.sha === proof.qualifiedCommit && source.sha === descriptor.sourceCommit &&
      base.sha === proof.baseCommit && qualified.tree?.sha === proof.treeSha &&
      source.tree?.sha === proof.treeSha && main.commit?.sha === descriptor.sourceCommit,
    'qualified source tree or current main changed');
    requireThat(source.parents?.length === 2 && source.parents[0].sha === proof.baseCommit &&
      source.parents[1].sha === proof.qualifiedCommit,
    'merged source lacks exact qualified and current-base parents');
    const review = proof.review;
    record(review, ['mode', 'requestedHead', 'request', 'acknowledgement', 'approval',
      'resolvedComments', 'nativeReviews'], 'qualification independent review');
    requireThat(['formal-review', 'dashboard'].includes(review.mode) &&
      review.requestedHead === proof.qualifiedCommit && Array.isArray(review.resolvedComments) &&
      review.resolvedComments.length <= 100 && Array.isArray(review.nativeReviews) &&
      review.nativeReviews.length <= 100, 'independent review context');
    const artifacts = [];
    const loadComment = async (pin, kind, author) => {
      record(pin, ['id', 'bodySha256'], 'independent review artifact pin');
      integer(pin.id, 'independent review artifact ID', 1); hash(pin.bodySha256, 'independent review artifact hash');
      const value = await github(fetcher, kind === 'inline' ? '/pulls/comments/' + pin.id :
        kind === 'review' ? '/pulls/' + proof.pullRequest + '/reviews/' + pin.id : '/issues/comments/' + pin.id);
      requireThat(value.id === pin.id && value.user?.id === author.id && value.user.login === author.login &&
        sha(value.body || '') === pin.bodySha256, 'independent review author or payload changed');
      if (kind === 'issue') requireThat(value.issue_url === ROOT + '/issues/' + proof.pullRequest,
        'review issue comment belongs to another PR');
      if (kind === 'inline') requireThat(value.pull_request_url === ROOT + '/pulls/' + proof.pullRequest &&
        value.commit_id === proof.qualifiedCommit, 'resolved finding does not bind qualified head');
      artifacts.push(value);
      return value;
    };
    const request = await loadComment(review.request, 'issue', { id: q.authorId, login: q.authorLogin });
    requireThat(request.body.includes(proof.qualifiedCommit) && /gitar/iu.test(request.body),
      'independent review request lacks exact candidate');
    let acknowledgement = null;
    if (review.acknowledgement !== null) {
      acknowledgement = await loadComment(review.acknowledgement, 'issue', { id: BOT_ID, login: BOT_LOGIN });
      requireThat(Date.parse(acknowledgement.created_at) >= Date.parse(request.created_at), 'review acknowledgement precedes request');
    }
    const approval = await loadComment(review.approval, review.mode === 'formal-review' ? 'review' : 'issue',
      { id: BOT_ID, login: BOT_LOGIN });
    if (review.mode === 'formal-review') requireThat(approval.state === 'APPROVED' &&
      approval.commit_id === proof.qualifiedCommit, 'formal review is not approval of qualified head');
    else {
      requireThat(acknowledgement && acknowledgement.body.includes(proof.qualifiedCommit) &&
        /(?:queued|current.head|reviewing|review.*(?:started|requested))/iu.test(acknowledgement.body),
      'dashboard review lacks exact-head bot acknowledgement');
      requireThat(hasCompleteReviewDashboard(approval.body), 'Gitar dashboard has no complete approval evidence');
      requireThat(Date.parse(approval.updated_at || approval.created_at) >= Date.parse(acknowledgement.created_at),
        'dashboard approval predates exact-head bot acknowledgement');
    }
    for (const pin of review.resolvedComments) await loadComment(pin, 'inline', { id: BOT_ID, login: BOT_LOGIN });
    // Keep native review state honest even when Gitar's actual approval is a
    // dashboard artifact. COMMENTED is retained as COMMENTED, never APPROVED.
    for (const pin of review.nativeReviews) {
      record(pin, ['id', 'commitId', 'state'], 'native review pin');
      const native = await github(fetcher, '/pulls/' + proof.pullRequest + '/reviews/' + pin.id);
      requireThat(native.user?.id === BOT_ID && native.user.login === BOT_LOGIN &&
        native.commit_id === pin.commitId && native.state === pin.state, 'native review state changed');
      artifacts.push(native);
    }
    return { runId: proof.deployment.deploymentId, rawLogsDigest: proof.rawLogsDigest,
      evidence: { schema: 'gk-learning-source-proof-evidence-v1', descriptor, qualification: proof,
        ownerComment: comment, pullRequest: pr, qualified, source, base,
        observedMain: main.commit.sha, reviewArtifacts: artifacts,
        trustBoundary: 'Authenticated owner attests actual Railway execution; authority independently retrieves exact source, owner receipt and Gitar artifacts.' } };
  };
}
