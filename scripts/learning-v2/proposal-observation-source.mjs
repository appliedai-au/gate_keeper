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
const PREFIX = 'GK_PROPOSAL_OBSERVATION_QUALIFICATION\n';
const sha = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b, why) => requireThat(canonical(a) === canonical(b), why);

async function github(fetcher, path) {
  // GitHub's comparison separator is not a parent-directory segment. Admit
  // only this exact, already hash-bound route; retain refusal for every other '..'.
  const pinnedComparison = /^\/compare\/[a-f0-9]{40}\.\.\.[a-f0-9]{40}\?per_page=100$/u.test(path);
  requireThat(path.startsWith('/') && (!path.includes('..') || pinnedComparison), 'source evidence path');
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

async function nativeReviewInventory(fetcher, pullRequest) {
  const values = [], seen = new Set();
  for (let page = 1; page <= 10; page++) {
    const rows = await github(fetcher, '/pulls/' + pullRequest + '/reviews?per_page=100&page=' + page);
    requireThat(Array.isArray(rows) && rows.length <= 100, 'native review inventory page');
    for (const row of rows) {
      integer(row.id, 'native review inventory identity', 1);
      requireThat(!seen.has(row.id), 'native review inventory repeats a page or review'); seen.add(row.id);
      values.push(row);
    }
    if (rows.length < 100) return values;
  }
  requireThat(false, 'native review inventory exceeds complete bounded read');
}

function checkSummary(value, label) {
  record(value, ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'], label);
  for (const key of Object.keys(value)) integer(value[key], label + ' ' + key, 0, 1000000);
  requireThat(value.tests > 0 && value.tests === value.pass &&
    ['fail', 'skipped', 'cancelled', 'todo'].every(key => value[key] === 0), label + ' incomplete');
}

export function createProposalObservationGateVerifier({ descriptor: supplied, fetcher = fetch }) {
  record(supplied, ['schema', 'repository', 'sourceCommit', 'qualification'], 'protected source proof');
  const descriptor = copy(supplied);
  requireThat(descriptor.schema === 'gk-learning-proposal-observation-gate-proof-v1' &&
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
    requireThat(proof.schema === 'gk-learning-proposal-observation-source-qualification-v1' && proof.repository === REPOSITORY,
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
      if (kind === 'inline') requireThat(value.pull_request_url === ROOT + '/pulls/' + proof.pullRequest,
        'historical finding belongs to another PR');
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
      approval.commit_id === proof.qualifiedCommit && Number.isFinite(Date.parse(approval.submitted_at)) &&
      Date.parse(approval.submitted_at) >= Date.parse(acknowledgement?.created_at || request.created_at),
    'formal review is not a fresh approval of the requested exact head');
    else {
      requireThat(acknowledgement && acknowledgement.body.includes(proof.qualifiedCommit) &&
        /(?:queued|current.head|reviewing|review.*(?:started|requested))/iu.test(acknowledgement.body),
      'dashboard review lacks exact-head bot acknowledgement');
      requireThat(hasCompleteReviewDashboard(approval.body), 'Gitar dashboard has no complete approval evidence');
      requireThat(Date.parse(approval.updated_at || approval.created_at) >= Date.parse(acknowledgement.created_at),
        'dashboard approval predates exact-head bot acknowledgement');
    }
    // GitHub keeps an inline finding's old commit_id after its fix. Preserve
    // that fact, authenticate the bot's fixed-by artifact, and independently
    // prove the actual fix is contained in the freshly approved final head.
    for (const pin of review.resolvedComments) {
      record(pin, ['id', 'bodySha256', 'commitId', 'fixCommit'], 'historical fixed finding pin');
      hash(pin.commitId, 'original finding commit', 40); hash(pin.fixCommit, 'actual fix commit', 40);
      const finding = await loadComment({ id: pin.id, bodySha256: pin.bodySha256 }, 'inline', { id: BOT_ID, login: BOT_LOGIN });
      requireThat(finding.commit_id === pin.commitId && finding.body.includes('Fixed by @' + q.authorLogin + ' in ') &&
        [pin.fixCommit, pin.fixCommit.slice(0, 8), pin.fixCommit.slice(0, 7)].some(value => finding.body.includes(value)),
      'historical finding lacks its actual authenticated fix context');
      if (pin.fixCommit !== proof.qualifiedCommit) {
        const comparison = await github(fetcher, '/compare/' + pin.fixCommit + '...' + proof.qualifiedCommit + '?per_page=100');
        requireThat(comparison.status === 'ahead' && comparison.base_commit?.sha === pin.fixCommit &&
          comparison.merge_base_commit?.sha === pin.fixCommit && Number.isInteger(comparison.total_commits) &&
          comparison.total_commits > 0 && comparison.total_commits <= 100 &&
          comparison.commits?.length === comparison.total_commits && comparison.commits.at(-1)?.sha === proof.qualifiedCommit,
        'resolved finding fix is not proven in the exact qualified candidate');
        artifacts.push(comparison);
      }
    }
    // Independently enumerate the current complete native-review inventory.
    // The owner cannot omit a later blocking review by omitting its pin.
    const nativeInventory = await nativeReviewInventory(fetcher, proof.pullRequest);
    const botInventory = nativeInventory.filter(item => item.user?.id === BOT_ID || item.user?.login === BOT_LOGIN);
    requireThat(botInventory.every(item => item.user.id === BOT_ID && item.user.login === BOT_LOGIN),
      'native review bot identity drift');
    equal(botInventory.map(item => ({ id: item.id, commitId: item.commit_id, state: item.state })).sort((a, b) => a.id - b.id),
      [...review.nativeReviews].sort((a, b) => a.id - b.id), 'native review inventory is incomplete or changed');
    requireThat(!botInventory.some(item => item.commit_id === proof.qualifiedCommit && item.state === 'CHANGES_REQUESTED'),
      'qualified head retains an unpinned or undismissed changes-requested review');
    artifacts.push(...nativeInventory);
    // COMMENTED remains COMMENTED even when approval uses a dashboard.
    for (const pin of review.nativeReviews) {
      record(pin, ['id', 'commitId', 'state'], 'native review pin');
      const native = await github(fetcher, '/pulls/' + proof.pullRequest + '/reviews/' + pin.id);
      requireThat(native.user?.id === BOT_ID && native.user.login === BOT_LOGIN &&
        native.commit_id === pin.commitId && native.state === pin.state, 'native review state changed');
      requireThat(!(native.commit_id === proof.qualifiedCommit && native.state === 'CHANGES_REQUESTED'),
        'qualified head retains an undismissed changes-requested review');
      artifacts.push(native);
    }
    return { runId: proof.deployment.deploymentId, rawLogsDigest: proof.rawLogsDigest,
      evidence: { schema: 'gk-learning-proposal-observation-source-evidence-v1', descriptor, qualification: proof,
        ownerComment: comment, pullRequest: pr, qualified, source, base,
        observedMain: main.commit.sha, reviewArtifacts: artifacts,
        trustBoundary: 'Authenticated owner attests actual Railway execution; authority independently retrieves exact source, owner receipt and Gitar artifacts.' } };
  };
}
