import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { copy, digest } from '../../scripts/learning-v2/contracts.mjs';
import { completedGatePolicy } from '../../scripts/learning-v2/completed-history-proof.mjs';

export const C = 'd'.repeat(40), HEAD = 'e'.repeat(40), TREE = 'f'.repeat(40), BASE = 'b'.repeat(40);
const root = 'https://api.github.com/repos/appliedai-au/gate_keeper';
const sha = value => createHash('sha256').update(value).digest('hex');
export function completedSourceFixture(now) {
  const owner = { id: 123, login: 'TEST-ONLY-owner' }, bot = { id: 159877585, login: 'gitar-bot[bot]' };
  const time = delta => new Date(now + delta).toISOString();
  const request = { id: 600, user: owner, issue_url: root + '/issues/59',
    body: '@gitar review exact head ' + HEAD, created_at: time(-120000) };
  const approval = { id: 601, user: bot, body: 'TEST-ONLY current-head approval',
    commit_id: HEAD, state: 'APPROVED', submitted_at: time(-110000) };
  const all = { tests: 1, pass: 1, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
  const proof = { schema: 'gk-completed-history-source-qualification-v1', repository: 'appliedai-au/gate_keeper',
    pullRequest: 59, qualifiedCommit: HEAD, baseCommit: BASE, treeSha: TREE, gatePolicy: completedGatePolicy(TREE),
    deployment: { projectId: '11111111-1111-1111-1111-111111111111', environmentId: '22222222-2222-2222-2222-222222222222',
      serviceId: '33333333-3333-3333-3333-333333333333', deploymentId: '44444444-4444-4444-4444-444444444444',
      finishedAt: time(-90000), status: 'SUCCESS' },
    cleanup: { complete: true, serviceId: '33333333-3333-3333-3333-333333333333', observedAt: time(-80000) },
    checks: { node: copy(all), canary: copy(all), typecheck: 'passed', scorerSelfTests: 5, realPostgres: copy(all),
      versions: { node: '24.19.0', trueforge: '0.182.0', postgres: '15' }, caddy: 'passed' },
    rawLogsDigest: sha('TEST-ONLY actual fixture logs'), review: { mode: 'formal-review', requestedHead: HEAD,
      request: { id: request.id, bodySha256: sha(request.body) }, acknowledgement: null,
      approval: { id: approval.id, bodySha256: sha(approval.body) }, resolvedComments: [],
      nativeReviews: [{ id: approval.id, commitId: HEAD, state: 'APPROVED' }] } };
  const comment = { id: 602, user: owner, created_at: time(-70000), issue_url: root + '/issues/59' };
  const descriptor = { schema: 'gk-completed-history-source-proof-v1', repository: 'appliedai-au/gate_keeper', sourceCommit: C,
    qualification: { commentId: comment.id, bodySha256: '', authorId: owner.id, authorLogin: owner.login } };
  const routes = new Map([
    ['/issues/comments/600', request], ['/pulls/59/reviews/601', approval], ['/issues/comments/602', comment],
    ['/pulls/59/reviews?per_page=100&page=1', [approval]],
    ['/pulls/59', { head: { sha: HEAD, repo: { full_name: 'appliedai-au/gate_keeper' } },
      base: { ref: 'main', repo: { full_name: 'appliedai-au/gate_keeper' } }, merged: true, merge_commit_sha: C }],
    ['/git/commits/' + HEAD, { sha: HEAD, tree: { sha: TREE } }],
    ['/git/commits/' + C, { sha: C, tree: { sha: TREE }, parents: [{ sha: BASE }, { sha: HEAD }] }],
    ['/git/commits/' + BASE, { sha: BASE, tree: { sha: '1'.repeat(40) } }], ['/branches/main', { commit: { sha: C } }],
  ]);
  for (const path of ['Dockerfile.reviews-qualify', 'scripts/reviews/qualify.sh']) routes.set('/contents/' + path + '?ref=' + C,
    { encoding: 'base64', content: readFileSync(new URL('../../' + path, import.meta.url)).toString('base64') });
  function refresh() {
    comment.body = 'GK_COMPLETED_HISTORY_QUALIFICATION\n' + JSON.stringify(proof);
    descriptor.qualification.bodySha256 = sha(comment.body);
  }
  refresh();
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(root + '/')); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined); assert.ok(routes.has(url.slice(root.length)), 'unexpected source request ' + url);
    return Response.json(copy(routes.get(url.slice(root.length))));
  };
  function ownerPin(closure, closureDigest) {
    const body = 'GK_COMPLETED_HISTORY_ACTIVATION\n' + JSON.stringify({
      schema: 'gk-completed-history-owner-activation-v1', purpose: 'read-only-completed-pilot',
      experimentSourceCommit: closure.binding.sourceCommit, executionSourceCommit: closure.executionSourceCommit,
      servingSourceCommit: closure.servingSourceCommit, configDigest: closure.binding.configDigest, closureDigest,
      authorityCapsuleSha256: closure.authorityCapsuleSha256, qualificationDescriptorDigest: digest(descriptor), driver: 'unavailable' });
    routes.set('/issues/comments/603', { id: 603, user: owner, created_at: time(1000), issue_url: root + '/issues/59', body });
    return { commentId: 603, bodySha256: sha(body) };
  }
  return { descriptor, proof, routes, request, approval, comment, owner, fetcher, refresh, ownerPin };
}
