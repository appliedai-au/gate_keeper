import test from 'node:test';
import assert from 'node:assert/strict';
import { copy } from '../scripts/learning-v2/contracts.mjs';
import { hasCompleteReviewDashboard } from '../scripts/learning-v2/review-dashboard.mjs';
import { createSourceGateVerifier } from '../scripts/learning-v2/authority-source-proof.mjs';
import { createProposalObservationSourceVerifier } from '../scripts/learning-v2/proposal-observation-proof.mjs';
import { originalFourthFixture, D } from './helpers/proposal-observation-fixture.mjs';
import { proposalObservationSourceFixture, D_HEAD } from './helpers/proposal-observation-source-fixture.mjs';

const malformed = ['1.0', '+0', '-0', '1e0', '0x0', '10,000', '00', '1_000'];
const bodies = malformed.flatMap(value => [
  ['plain ' + value, '✅ Approved\nNo issues found.\n' + value + ' findings'],
  ['compact ' + value, '<kbd>✅ Approved</kbd> <kbd>' + value + ' findings</kbd>'],
  ['closed pair ' + value, '✅ Approved\n' + value + ' closed / ' + value + ' findings'],
]);
for (const [name, body] of bodies) test('dashboard rejects whole malformed numeric token: ' + name, () => {
  assert.equal(hasCompleteReviewDashboard(body), false);
});

test('both actual gates refuse malformed numeric suffixes despite clean prose and authenticated transport', async t => {
  const f = await originalFourthFixture(t), root = 'https://api.github.com/repos/appliedai-au/gate_keeper';
  for (const authority of [false, true]) for (const [name, body] of bodies) {
    await t.test((authority ? 'authority: ' : 'recovery: ') + name, async () => {
      const g = proposalObservationSourceFixture(f);
      const acknowledgement = { id: 806, user: g.bot, issue_url: root + '/issues/160',
        body: 'Queued current head ' + D_HEAD, created_at: new Date(f.controls.now - 115000).toISOString() };
      const approval = { id: 807, user: g.bot, issue_url: root + '/issues/160', body,
        created_at: new Date(f.controls.now - 130000).toISOString(), updated_at: new Date(f.controls.now - 110000).toISOString() };
      g.routes.set('/issues/comments/806', acknowledgement); g.routes.set('/issues/comments/807', approval);
      g.approval.state = 'COMMENTED'; g.proof.review.nativeReviews[0].state = 'COMMENTED';
      g.proof.review.mode = 'dashboard';
      g.proof.review.acknowledgement = { id: 806, bodySha256: g.sha(acknowledgement.body) };
      g.proof.review.approval = { id: 807, bodySha256: g.sha(approval.body) }; g.refresh();
      let verify;
      if (authority) {
        const descriptor = copy(g.descriptor.sourceProof); descriptor.schema = 'gk-learning-source-proof-v1';
        g.proof.schema = 'gk-learning-source-qualification-v1';
        g.comment.body = 'GK_AUTHORITY_QUALIFICATION\n' + JSON.stringify(g.proof);
        descriptor.qualification.bodySha256 = g.sha(g.comment.body);
        verify = async () => createSourceGateVerifier({ descriptor, fetcher: g.fetcher })({
          binding: { sourceCommit: D }, config: { gatePolicy: g.descriptor.gatePolicy } });
      } else verify = async () => createProposalObservationSourceVerifier({ descriptor: g.descriptor, fetcher: g.fetcher })(g.input);
      await assert.rejects(verify(), /no complete approval evidence/);
    });
  }
  await f.assertNoNewCalls();
});
