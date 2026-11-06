import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copy, digest } from '../../scripts/learning-v2/contracts.mjs';
import { B, D, TREE_D } from './proposal-observation-fixture.mjs';

const ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';
export const D_HEAD = 'f'.repeat(40);
const sha = value => createHash('sha256').update(value).digest('hex');

/** Authenticated transport double only; no network and no actual source claim. */
export function proposalObservationSourceFixture(f) {
  const owner = f.owner, bot = { id: 159877585, login: 'gitar-bot[bot]' }, now = f.controls.now;
  const time = delta => new Date(now + delta).toISOString();
  const request = { id: 700, user: owner, issue_url: ROOT + '/issues/160',
    body: '@gitar review exact head ' + D_HEAD, created_at: time(-120000) };
  const approval = { id: 701, user: bot, body: 'TEST-ONLY exact D approval', commit_id: D_HEAD,
    state: 'APPROVED', submitted_at: time(-110000) };
  const all = { tests: 1, pass: 1, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
  const gatePolicy = { ...f.bundle.config.gatePolicy,
    effectiveTreeDigest: digest({ repository: 'appliedai-au/gate_keeper', gitTree: TREE_D }) };
  const proof = { schema: 'gk-learning-proposal-observation-source-qualification-v1', repository: 'appliedai-au/gate_keeper',
    pullRequest: 160, qualifiedCommit: D_HEAD, baseCommit: B, treeSha: TREE_D, gatePolicy,
    deployment: { projectId: '11111111-1111-1111-1111-111111111111', environmentId: '22222222-2222-2222-2222-222222222222',
      serviceId: '33333333-3333-3333-3333-333333333333', deploymentId: '44444444-4444-4444-4444-444444444444',
      finishedAt: time(-90000), status: 'SUCCESS' },
    cleanup: { complete: true, serviceId: '33333333-3333-3333-3333-333333333333', observedAt: time(-80000) },
    checks: { node: copy(all), canary: copy(all), typecheck: 'passed', scorerSelfTests: 5 },
    rawLogsDigest: sha('TEST-ONLY D full gate log'), review: { mode: 'formal-review', requestedHead: D_HEAD,
      request: { id: request.id, bodySha256: sha(request.body) }, acknowledgement: null,
      approval: { id: approval.id, bodySha256: sha(approval.body) }, resolvedComments: [],
      nativeReviews: [{ id: approval.id, commitId: D_HEAD, state: 'APPROVED' }] } };
  const comment = { id: 702, user: owner, created_at: time(-70000), issue_url: ROOT + '/issues/160' };
  const descriptor = { schema: 'gk-learning-proposal-observation-source-proof-v1', gatePolicy,
    sourceProof: { schema: 'gk-learning-proposal-observation-gate-proof-v1', repository: 'appliedai-au/gate_keeper', sourceCommit: D,
      qualification: { commentId: 702, bodySha256: '', authorId: owner.id, authorLogin: owner.login } } };
  const routes = new Map([
    ['/issues/comments/700', request], ['/pulls/160/reviews/701', approval], ['/issues/comments/702', comment],
    ['/pulls/160/reviews?per_page=100&page=1', [approval]],
    ['/pulls/160', { head: { sha: D_HEAD, repo: { full_name: 'appliedai-au/gate_keeper' } },
      base: { ref: 'main', repo: { full_name: 'appliedai-au/gate_keeper' } }, merged: true, merge_commit_sha: D }],
    ['/git/commits/' + D_HEAD, { sha: D_HEAD, tree: { sha: TREE_D }, parents: [{ sha: B }] }],
    ['/git/commits/' + D, { sha: D, tree: { sha: TREE_D }, parents: [{ sha: B }, { sha: D_HEAD }] }],
    ['/git/commits/' + B, { sha: B, tree: { sha: 'c'.repeat(40) }, parents: [{ sha: 'a'.repeat(40) }] }],
    ['/branches/main', { commit: { sha: D } }],
    ['/contents/Dockerfile.qualify?ref=' + D, { encoding: 'base64', content: Buffer.from('TEST-ONLY preset').toString('base64') }],
  ]);
  function refresh() {
    comment.body = 'GK_PROPOSAL_OBSERVATION_QUALIFICATION\n' + JSON.stringify(proof);
    descriptor.sourceProof.qualification.bodySha256 = sha(comment.body);
  }
  refresh();
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(ROOT + '/')); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    assert.ok(routes.has(url.slice(ROOT.length)), 'unexpected D evidence request ' + url);
    return Response.json(copy(routes.get(url.slice(ROOT.length))));
  };
  return { descriptor, proof, routes, request, approval, comment, owner, bot, fetcher, refresh, sha,
    input: { bundle: f.bundle, implementationCommit: D, historicalImplementationStatus: f.historicalStatus } };
}
