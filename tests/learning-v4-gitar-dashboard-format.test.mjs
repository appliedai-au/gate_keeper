import test from 'node:test';
import assert from 'node:assert/strict';
import { copy } from '../scripts/learning-v2/contracts.mjs';
import { hasCompleteReviewDashboard } from '../scripts/learning-v2/review-dashboard.mjs';
import { createProposalObservationSourceVerifier } from '../scripts/learning-v2/proposal-observation-proof.mjs';
import { createSourceGateVerifier } from '../scripts/learning-v2/authority-source-proof.mjs';
import { originalFourthFixture, D } from './helpers/proposal-observation-fixture.mjs';
import { proposalObservationSourceFixture, D_HEAD } from './helpers/proposal-observation-source-fixture.mjs';

// Structural fixture captured from Gitar's actual approved PR62 dashboard
// comment6681757959. Historical finding prose is shortened; it is never live
// review evidence. Header badge, closed group and four nested titles are real
// output shapes, not an invented simplified approval format.
const titles = [
  ['Security', 'Same unanchored 0-findings regex still gates authority-source-proof'],
  ['Bug', 'v2 successor proof is always rejected by the only consumer'],
  ['Quality', 'New v2 successor qualification path has no regression coverage'],
  ['Edge Case', "Singular '1 finding' or 'N issues' counts don't block clean prose"],
];
const entries = titles.map(([kind, title]) => '<details>\n<summary>✅ <b>' + kind + ':</b> ' + title +
  '</summary>\n\n> TEST-ONLY retained historical example: 10 open, 100 findings.\n\n</details>').join('\n\n');
const observed = '<details>\n<summary><b>Code Review</b> <kbd>✅ Approved</kbd> <kbd>4 closed / 4 findings</kbd></summary>\n\n' +
  '<kbd>🔴 High risk</kbd> · Changes to recovery release-proof and dashboard approval gates could accept an inadequately qualified successor.\n\n' +
  "Resolved: singular '1 finding' or 'N issues' counts no longer passing as clean prose. No open findings remain.\n\n" +
  '<details>\n<summary><kbd>✅ 4 closed</kbd></summary>\n\n' + entries + '\n\n</details>\n\n</details>\n\n' +
  '<details>\n<summary><b>Verification</b></summary>\n<details>\n<summary><b>Functional validation</b> <kbd>Not enabled</kbd></summary>\n</details>\n</details>';
const cases = [
  ['actual approved header badge and resolved history', observed, true],
  ['explicit open details attribute', observed.replace('<details>', '<details open>'), true],
  ['header badge without history', '<details>\n<summary><b>Code Review</b> <kbd>✅ Approved</kbd> <kbd>4 closed / 4 findings</kbd></summary>\nNo open findings remain.\n</details>', true],
  ['incomplete header count', observed.replace('4 closed / 4 findings', '4 closed / 5 findings'), false],
  ['different closed group count', observed.replace('✅ 4 closed', '✅ 3 closed'), false],
  ['noncanonical group count', observed.replace('✅ 4 closed', '✅ 04 closed'), false],
  ['open finding heading in closed history', observed.replace('<summary>✅ <b>Security:', '<summary>⚠️ <b>Security:'), false],
  ['missing historical entry', observed.replace('<details>\n<summary>✅ <b>Quality:</b> New v2 successor qualification path has no regression coverage</summary>\n\n> TEST-ONLY retained historical example: 10 open, 100 findings.\n\n</details>', ''), false],
  ['explicit top-level open count', observed.replace('<kbd>🔴 High risk</kbd>', '10 open\n<kbd>🔴 High risk</kbd>'), false],
  ['top-level singular issue', observed.replace('<kbd>🔴 High risk</kbd>', '1 issue\n<kbd>🔴 High risk</kbd>'), false],
  ['unclosed trailing history text', observed.replace('\n\n</details>\n\n</details>', '\n\n</details>\n10 open\n</details>'), false],
  ['wrong current verdict', observed.replace('✅ Approved', '❌ Needs fixes'), false],
  ['in-progress preamble never grants approval', '<kbd>Responding to your feedback</kbd>\n' + observed, false],
  ['closed history without current approval', observed.replace('<b>Code Review</b> <kbd>✅ Approved</kbd>', '<b>Code Review</b>'), false],
];
for (const [name, body, expected] of cases) test('real dashboard format: ' + name, () => {
  assert.equal(hasCompleteReviewDashboard(body), expected);
});

test('both actual gates accept the observed approved dashboard format and refuse malformed variants', async t => {
  const f = await originalFourthFixture(t), root = 'https://api.github.com/repos/appliedai-au/gate_keeper';
  for (const authority of [false, true]) for (const [name, body, expected] of cases) {
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
        verify = async () => (await createSourceGateVerifier({ descriptor, fetcher: g.fetcher })({
          binding: { sourceCommit: D }, config: { gatePolicy: g.descriptor.gatePolicy } })).evidence.source.sha;
      } else verify = async () => (await createProposalObservationSourceVerifier({ descriptor: g.descriptor, fetcher: g.fetcher })(g.input)).implementationCommit;
      if (expected) assert.equal(await verify(), D);
      else await assert.rejects(verify(), /no complete approval evidence/);
    });
  }
  await f.assertNoNewCalls();
});
