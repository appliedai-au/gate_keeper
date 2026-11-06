import test from 'node:test';
import assert from 'node:assert/strict';
import { copy } from '../scripts/learning-v2/contracts.mjs';
import { createProposalObservationSourceVerifier } from '../scripts/learning-v2/proposal-observation-proof.mjs';
import { originalFourthFixture, D, B } from './helpers/proposal-observation-fixture.mjs';
import { proposalObservationSourceFixture, D_HEAD } from './helpers/proposal-observation-source-fixture.mjs';

test('D exact source qualification independently checks live complete review evidence', async t => {
  const f = await originalFourthFixture(t);
  const fresh = () => proposalObservationSourceFixture(f);
  const verify = g => createProposalObservationSourceVerifier({ descriptor: g.descriptor, fetcher: g.fetcher })(g.input);
  await t.test('valid exact D source returns stable facts despite unrelated PR metadata', async () => {
    const g = fresh(), before = await verify(g);
    g.routes.get('/pulls/160').comments = 900;
    g.routes.get('/pulls/160').updated_at = new Date(f.controls.now + 60000).toISOString();
    const after = await verify(g);
    assert.equal(before.qualificationEvidenceDigest, after.qualificationEvidenceDigest);
    assert.equal(before.implementationCommit, D); assert.equal(before.evidence.base.sha, B);
  });
  for (const pinned of [false, true]) await t.test(`rejects ${pinned ? 'pinned' : 'omitted'} current-head changes request`, async () => {
    const g = fresh(), blocker = { id: 703, user: g.bot, commit_id: D_HEAD, state: 'CHANGES_REQUESTED',
      submitted_at: new Date(f.controls.now - 60000).toISOString(), body: 'TEST-ONLY later blocker' };
    g.routes.get('/pulls/160/reviews?per_page=100&page=1').push(blocker);
    g.routes.set('/pulls/160/reviews/703', blocker);
    if (pinned) { g.proof.review.nativeReviews.push({ id: blocker.id, commitId: D_HEAD, state: blocker.state }); g.refresh(); }
    await assert.rejects(verify(g), /inventory|changes-requested/);
  });
  await t.test('rejects a formally approved head whose approval predates exact request', async () => {
    const g = fresh(); g.approval.submitted_at = new Date(f.controls.now - 300000).toISOString();
    await assert.rejects(verify(g), /fresh approval/);
  });
  await t.test('dashboard approval preserves COMMENTED native state and requires fresh closed findings', async () => {
    const g = fresh(), root = 'https://api.github.com/repos/appliedai-au/gate_keeper';
    const acknowledgement = { id: 706, user: g.bot, issue_url: root + '/issues/160',
      body: 'Queued current head ' + D_HEAD, created_at: new Date(f.controls.now - 115000).toISOString() };
    const dashboard = { id: 707, user: g.bot, issue_url: root + '/issues/160', body: '✅ Approved\nNo open findings remain',
      created_at: new Date(f.controls.now - 130000).toISOString(), updated_at: new Date(f.controls.now - 110000).toISOString() };
    g.routes.set('/issues/comments/706', acknowledgement); g.routes.set('/issues/comments/707', dashboard);
    g.approval.state = 'COMMENTED'; g.proof.review.nativeReviews[0].state = 'COMMENTED';
    g.proof.review.mode = 'dashboard';
    g.proof.review.acknowledgement = { id: 706, bodySha256: g.sha(acknowledgement.body) };
    g.proof.review.approval = { id: 707, bodySha256: g.sha(dashboard.body) }; g.refresh();
    const result = await verify(g);
    assert.ok(result.evidence.reviewArtifacts.some(item => item.id === 701 && item.state === 'COMMENTED'));
    dashboard.updated_at = new Date(f.controls.now - 116000).toISOString();
    await assert.rejects(verify(g), /predates exact-head/);
    dashboard.updated_at = new Date(f.controls.now - 110000).toISOString();
    dashboard.body = '✅ Approved\n<kbd>0 closed / 1 findings</kbd>';
    g.proof.review.approval.bodySha256 = g.sha(dashboard.body); g.refresh();
    await assert.rejects(verify(g), /no complete approval/);
    dashboard.body = '✅ Approved\nNo open findings remain'; g.proof.review.approval.bodySha256 = g.sha(dashboard.body);
    acknowledgement.body = 'Queued an unspecified candidate';
    g.proof.review.acknowledgement.bodySha256 = g.sha(acknowledgement.body); g.refresh();
    await assert.rejects(verify(g), /exact-head bot acknowledgement/);
  });
  await t.test('historical fixed finding retains its old commit and proves fix ancestry', async () => {
    const g = fresh(), original = '1'.repeat(40), fix = '2'.repeat(40);
    const finding = { id: 704, user: g.bot, commit_id: original, line: null,
      pull_request_url: 'https://api.github.com/repos/appliedai-au/gate_keeper/pulls/160',
      body: 'TEST-ONLY historical finding. Fixed by @' + g.owner.login + ' in ' + fix.slice(0, 8) };
    g.routes.set('/pulls/comments/704', finding);
    g.routes.set('/compare/' + fix + '...' + D_HEAD + '?per_page=100', { status: 'ahead', base_commit: { sha: fix },
      merge_base_commit: { sha: fix }, total_commits: 1, commits: [{ sha: D_HEAD }] });
    g.proof.review.resolvedComments.push({ id: 704, bodySha256: g.sha(finding.body), commitId: original, fixCommit: fix }); g.refresh();
    const approved = await verify(g); assert.equal(approved.implementationCommit, D);
    g.routes.get('/compare/' + fix + '...' + D_HEAD + '?per_page=100').merge_base_commit.sha = original;
    await assert.rejects(verify(g), /not proven/);
  });
  await t.test('full review pagination is bounded and cannot omit a later page blocker', async () => {
    const g = fresh();
    const first = Array.from({ length: 100 }, (_, i) => ({ id: 1000 + i, user: { id: 999, login: 'TEST-ONLY-human' },
      commit_id: D_HEAD, state: 'COMMENTED' }));
    g.routes.set('/pulls/160/reviews?per_page=100&page=1', first);
    g.routes.set('/pulls/160/reviews?per_page=100&page=2', [g.approval, { id: 705, user: g.bot, commit_id: D_HEAD, state: 'CHANGES_REQUESTED' }]);
    await assert.rejects(verify(g), /inventory|changes-requested/);
  });
  await t.test('actual D cannot spoof B or swap ordered parents/current main', async () => {
    const g = fresh(); await assert.rejects(createProposalObservationSourceVerifier({ descriptor: g.descriptor,
      fetcher: g.fetcher })({ ...g.input, implementationCommit: B }));
    g.routes.get('/git/commits/' + D).parents.reverse(); await assert.rejects(verify(g), /parents/);
    g.routes.get('/git/commits/' + D).parents.reverse(); g.routes.get('/branches/main').commit.sha = B;
    await assert.rejects(verify(g), /current main/);
  });
  await t.test('self-consistent other merge base cannot replace historical B', async () => {
    const g = fresh(), otherBase = '3'.repeat(40);
    g.proof.baseCommit = otherBase;
    g.routes.set('/git/commits/' + otherBase, { sha: otherBase, tree: { sha: '4'.repeat(40) }, parents: [{ sha: 'a'.repeat(40) }] });
    g.routes.get('/git/commits/' + D).parents[0].sha = otherBase;
    g.routes.get('/git/commits/' + D_HEAD).parents = [{ sha: otherBase }];
    g.refresh();
    await assert.rejects(verify(g), /retain historical B/);
  });
  await t.test('D cannot weaken full Learning recipe or switch authenticated owner', async () => {
    const g = fresh(); g.descriptor.gatePolicy = { ...g.descriptor.gatePolicy, presetDigest: '1'.repeat(64) };
    await assert.rejects(verify(g), /weakens/);
    const h = fresh(); h.descriptor.sourceProof.qualification.authorId++;
    await assert.rejects(verify(h), /owner/);
  });
  await f.assertNoNewCalls();
});
