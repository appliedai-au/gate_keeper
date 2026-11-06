import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copy } from '../scripts/learning-v2/contracts.mjs';
import { createCompletedSourceVerifier, verifyCompletedOwnerPin } from '../scripts/learning-v2/completed-history-proof.mjs';
import { C, HEAD, completedSourceFixture } from './helpers/completed-source-fixture.mjs';

const NOW = Date.UTC(2026, 10, 6, 12), sha = value => createHash('sha256').update(value).digest('hex');
const original = { implementationCommit: 'b'.repeat(40), qualification: { authorId: 123, authorLogin: 'TEST-ONLY-owner' } };
const binding = { ownerId: 'unrelated-Base44-owner', experimentId: 'TEST-ONLY-history', sourceCommit: 'a'.repeat(40), configDigest: '1'.repeat(64) };
const verify = f => createCompletedSourceVerifier({ descriptor: f.descriptor, fetcher: f.fetcher })({
  actualSourceCommit: C, historicalQualification: original, binding });

test('actual C qualification authenticates its own full real-database recipe and source independently of historical B', async () => {
  const f = completedSourceFixture(NOW), result = await verify(f);
  assert.equal(result.sourceCommit, C); assert.equal(result.owner.id, 123);
  assert.notEqual(result.owner.login, binding.ownerId);
  assert.equal(result.evidence.qualification.checks.realPostgres.tests, 1);
  assert.equal(result.evidence.observedMain, C);
  await assert.rejects(createCompletedSourceVerifier({ descriptor: f.descriptor, fetcher: f.fetcher })({
    actualSourceCommit: 'b'.repeat(40), historicalQualification: original, binding }), /actual distinct C/);
  await assert.rejects(createCompletedSourceVerifier({ descriptor: f.descriptor, fetcher: f.fetcher })({
    actualSourceCommit: C, historicalQualification: { ...original,
      qualification: { authorId: 987, authorLogin: binding.ownerId } }, binding }), /GitHub owner/);
});

test('C qualification refuses a weaker recipe, omitted real PG, skipped tests, old runtime and reversed merge parents', async () => {
  const mutations = [
    f => { f.proof.gatePolicy.presetDigest = '0'.repeat(64); },
    f => { delete f.proof.checks.realPostgres; },
    f => { f.proof.checks.realPostgres.skipped = 1; },
    f => { f.proof.checks.node.skipped = 1; },
    f => { f.proof.checks.versions.trueforge = '0.180.0'; },
    f => { f.proof.checks.caddy = 'not-run'; },
    f => { f.routes.get('/git/commits/' + C).parents.reverse(); },
    f => { f.routes.get('/branches/main').commit.sha = 'b'.repeat(40); },
    f => { f.routes.get('/contents/scripts/reviews/qualify.sh?ref=' + C).content = Buffer.from('exit 0\n').toString('base64'); },
    f => { f.proof.cleanup.complete = false; },
  ];
  for (const mutate of mutations) {
    const f = completedSourceFixture(NOW); mutate(f); f.refresh(); await assert.rejects(verify(f));
  }
});

test('fresh current-head approval is required and a new unpinned changes request cannot be hidden', async () => {
  const stale = completedSourceFixture(NOW);
  stale.approval.submitted_at = new Date(NOW - 200000).toISOString(); await assert.rejects(verify(stale), /fresh approval/);
  const changed = completedSourceFixture(NOW);
  changed.routes.get('/pulls/59/reviews?per_page=100&page=1').push({ id: 699,
    user: { id: 159877585, login: 'gitar-bot[bot]' }, commit_id: HEAD, state: 'CHANGES_REQUESTED',
    submitted_at: new Date(NOW - 1000).toISOString(), body: 'TEST-ONLY new blocking finding' });
  await assert.rejects(verify(changed), /inventory|changes-requested/);
  changed.proof.review.nativeReviews.push({ id: 699, commitId: HEAD, state: 'CHANGES_REQUESTED' }); changed.refresh();
  await assert.rejects(verify(changed), /changes-requested/);
});

test('historical fixed inline finding keeps its original commit and separately proves fix containment plus fresh final-head approval', async () => {
  const f = completedSourceFixture(NOW), old = '3'.repeat(40), fix = '2'.repeat(40);
  const finding = { id: 700, user: { id: 159877585, login: 'gitar-bot[bot]' },
    pull_request_url: 'https://api.github.com/repos/appliedai-au/gate_keeper/pulls/59', commit_id: old, line: null,
    body: 'TEST-ONLY historical finding. Fixed by @TEST-ONLY-owner in ' + fix.slice(0, 8) };
  f.routes.set('/pulls/comments/700', finding);
  f.proof.review.resolvedComments.push({ id: 700, bodySha256: sha(finding.body), commitId: old, fixCommit: fix });
  f.routes.set('/compare/' + fix + '...' + HEAD + '?per_page=100', { status: 'ahead', base_commit: { sha: fix },
    merge_base_commit: { sha: fix }, total_commits: 1, commits: [{ sha: HEAD }] }); f.refresh();
  const result = await verify(f); assert.equal(result.evidence.reviewArtifacts.find(item => item.id === 700).commit_id, old);
  f.routes.get('/compare/' + fix + '...' + HEAD + '?per_page=100').status = 'diverged';
  await assert.rejects(verify(f), /not proven/);
});

test('native review inventory follows bounded complete pages rather than trusting a selected pin list', async () => {
  const f = completedSourceFixture(NOW), first = Array.from({ length: 100 }, (_, index) => ({
    id: 1000 + index, user: { id: 456, login: 'other-authenticated-reviewer' }, commit_id: HEAD, state: 'COMMENTED' }));
  f.routes.set('/pulls/59/reviews?per_page=100&page=1', first);
  f.routes.set('/pulls/59/reviews?per_page=100&page=2', [f.approval]);
  await verify(f);
  f.routes.set('/pulls/59/reviews?per_page=100&page=2', [first[0], f.approval]);
  await assert.rejects(verify(f), /repeats/);
});

test('public closure authorization pins digests only and requires original GitHub owner after actual capture', async () => {
  const f = completedSourceFixture(NOW), source = await verify(f), closureDigest = '4'.repeat(64);
  const closure = { binding, executionSourceCommit: 'b'.repeat(40), servingSourceCommit: C,
    authorityCapsuleSha256: '5'.repeat(64), archivedAt: new Date(NOW).toISOString() };
  const pin = f.ownerPin(closure, closureDigest);
  const result = await verifyCompletedOwnerPin({ pin, closure, closureDigest, sourceEvidence: source, fetcher: f.fetcher });
  assert.equal(result.body.driver, 'unavailable');
  for (const privateKey of ['ownerId', 'operationId', 'leaseId', 'sessionId', 'turnId', 'retained'])
    assert.equal(Object.hasOwn(result.body, privateKey), false);
  const wrong = copy(closure); wrong.executionSourceCommit = '6'.repeat(40);
  await assert.rejects(verifyCompletedOwnerPin({ pin, closure: wrong, closureDigest, sourceEvidence: source, fetcher: f.fetcher }));
  f.routes.get('/issues/comments/603').user = { id: 999, login: binding.ownerId };
  await assert.rejects(verifyCompletedOwnerPin({ pin, closure, closureDigest, sourceEvidence: source, fetcher: f.fetcher }), /author/);
});

// NOT executed locally: authored as source for remote qualification. These use
// the actual completed-source verifier and the actual hasCompleteReviewDashboard.
const DASH_ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';
const BOT = { id: 159877585, login: 'gitar-bot[bot]' };
const closedEntries = count => Array.from({ length: count }, (_, index) => '<details>
<summary>✅ <b>Bug:</b> TEST-ONLY resolved finding ' +
  index + '</summary>

> TEST-ONLY retained example: 10 open, 100 findings.

</details>').join('

');
const allClosed = count => '<details>
<summary><b>Code Review</b> <kbd>✅ Approved</kbd> <kbd>' + count + ' closed / ' + count +
  ' findings</kbd></summary>

<kbd>🟢 Low risk</kbd> · TEST-ONLY. No open findings remain.

<details>
<summary><kbd>✅ ' +
  count + ' closed</kbd></summary>

' + closedEntries(count) + '

</details>

</details>';
const dashboardCases = [
  ['actual zero-findings form', '✅ Approved
No open findings remain.', true],
  ['actual compact zero form', '<kbd>✅ Approved</kbd> <kbd>0 open</kbd>', true],
  ['actual all-closed form', allClosed(2), true],
  ['10 findings', '✅ Approved
10 findings', false],
  ['100 open', '✅ Approved
100 open', false],
  ['10 open', '✅ Approved
10 open', false],
  ['singular 1 finding', '✅ Approved
1 finding', false],
  ['singular 1 issue', '✅ Approved
1 issue', false],
  ['contradictory clean prose', '✅ Approved
3 open
No open findings remain.', false],
  ['malformed numerical count', '<details>
<summary><b>Code Review</b> <kbd>✅ Approved</kbd> <kbd>04 closed / 04 findings</kbd></summary>
No open findings remain.
</details>', false],
  ['unequal closed count', allClosed(2).replace('2 closed / 2 findings', '2 closed / 3 findings'), false],
  ['quoted examples only', '> ✅ Approved
> No open findings remain.
`0 open`', false],
  ['unanchored zero text', '✅ Approved
Still 10 findings, previously 0 findings.', false],
];
function dashboardFixture(body, acknowledgementBody) {
  const f = completedSourceFixture(NOW);
  const acknowledgement = { id: 810, user: BOT, issue_url: DASH_ROOT + '/issues/59',
    body: acknowledgementBody ?? 'Queued current head ' + HEAD, created_at: new Date(NOW - 115000).toISOString() };
  const approval = { id: 811, user: BOT, issue_url: DASH_ROOT + '/issues/59', body,
    created_at: new Date(NOW - 130000).toISOString(), updated_at: new Date(NOW - 110000).toISOString() };
  f.routes.set('/issues/comments/810', acknowledgement); f.routes.set('/issues/comments/811', approval);
  // Dashboard approval is a COMMENTED native review, never a formal approval.
  f.approval.state = 'COMMENTED'; f.proof.review.nativeReviews[0].state = 'COMMENTED';
  f.proof.review.mode = 'dashboard';
  f.proof.review.acknowledgement = { id: 810, bodySha256: sha(acknowledgement.body) };
  f.proof.review.approval = { id: 811, bodySha256: sha(approval.body) };
  f.refresh();
  return { f, acknowledgement, approval };
}

for (const [name, body, expected] of dashboardCases) test('completed source dashboard approval: ' + name, async () => {
  const { f } = dashboardFixture(body);
  if (expected) assert.equal((await verify(f)).sourceCommit, C);
  else await assert.rejects(verify(f), /no complete approval evidence/);
});

test('completed source dashboard approval keeps bot, pinned-byte, acknowledgement and freshness guards', async () => {
  const wrongBot = dashboardFixture('✅ Approved
No open findings remain.');
  wrongBot.approval.user = { id: 456, login: 'other-authenticated-reviewer' };
  await assert.rejects(verify(wrongBot.f), /author or payload changed/);

  const altered = dashboardFixture('✅ Approved
No open findings remain.');
  altered.approval.body = '✅ Approved
No open findings remain.
';
  await assert.rejects(verify(altered.f), /author or payload changed/);

  const stale = dashboardFixture('✅ Approved
No open findings remain.');
  stale.approval.updated_at = new Date(NOW - 120000).toISOString();
  await assert.rejects(verify(stale.f), /predates exact-head bot acknowledgement/);

  const noHead = dashboardFixture('✅ Approved
No open findings remain.', 'Queued current head ' + 'a'.repeat(40));
  await assert.rejects(verify(noHead.f), /lacks exact-head bot acknowledgement/);
});
