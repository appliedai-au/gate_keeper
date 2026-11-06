import test from 'node:test';
import assert from 'node:assert/strict';
import { hasCompleteReviewDashboard } from '../scripts/learning-v2/review-dashboard.mjs';
import { createProposalObservationSourceVerifier } from '../scripts/learning-v2/proposal-observation-proof.mjs';
import { originalFourthFixture, D } from './helpers/proposal-observation-fixture.mjs';
import { proposalObservationSourceFixture, D_HEAD } from './helpers/proposal-observation-source-fixture.mjs';

const plain = text => '✅ Approved\n' + text;
const dashboard = text => '<details>\n<summary><b>Code Review</b> <kbd>✅ Approved</kbd></summary>\n\n' + text + '\n</details>';
const positive = [
  ['no open statement', plain('No open findings remain')],
  ['no issues statement', plain('No issues found.')],
  ['zero findings', plain('0 findings')],
  ['zero open', plain('0 open')],
  ['zero open findings', plain('0 open findings')],
  ['zero count pair', plain('<kbd>0 closed / 0 findings</kbd>')],
  ['ten all closed', plain('<kbd>10 closed / 10 findings</kbd>')],
  ['structured real dashboard shape', dashboard('<kbd>🔴 High risk</kbd> · TEST-ONLY risk description.\n\nTEST-ONLY recovery description. No issues found.')],
  ['closed count with explicit zero open', dashboard('<kbd>12 closed / 12 findings</kbd>\n0 open')],
];
const negative = [
  ['ten findings is not zero', plain('<kbd>0 closed / 10 findings</kbd>')],
  ['hundred findings is not zero', plain('<kbd>0 closed / 100 findings</kbd>')],
  ['ten open is not zero', plain('10 open')],
  ['hundred open is not zero', plain('100 open')],
  ['positive open overrides clean prose', plain('No issues found.\n10 open')],
  ['open count overrides clean prose', plain('No open findings remain\n<kbd>0 closed / 1 findings</kbd>')],
  ['conflicting closed counts', plain('<kbd>0 closed / 0 findings</kbd>\n<kbd>0 closed / 10 findings</kbd>')],
  ['noncanonical counts', plain('<kbd>01 closed / 01 findings</kbd>')],
  ['oversized counts', plain('<kbd>9007199254740992 closed / 9007199254740992 findings</kbd>')],
  ['malformed count with clean prose', plain('No issues found.\n<kbd>x closed / y findings</kbd>')],
  ['more closed than total', plain('<kbd>5 closed / 3 findings</kbd>')],
  ['negated zero', plain('There are not 0 findings')],
  ['negated clean statement', plain('Not No issues found.')],
  ['quoted clean statement', plain('> No issues found.')],
  ['fenced clean statement', plain('```text\nNo issues found.\n```')],
  ['unterminated fenced clean statement', plain('```text\nNo issues found.')],
  ['inline code clean statement', plain('`No issues found.`')],
  ['commented clean statement', plain('<!-- No issues found. -->')],
  ['unapproved header', 'Changes requested\nNo issues found.'],
  ['quoted approval header', '> ✅ Approved\nNo issues found.'],
  ['other section cannot approve review', dashboard('TEST-ONLY no verdict.') + '\n<details>\n<summary>Verification</summary>\nNo issues found.\n</details>'],
  ['nested review content ambiguous', dashboard('<details>No issues found.</details>')],
];

for (const [name, body] of positive) test('dashboard accepts ' + name, () => {
  assert.equal(hasCompleteReviewDashboard(body), true);
});
for (const [name, body] of negative) test('dashboard refuses ' + name, () => {
  assert.equal(hasCompleteReviewDashboard(body), false);
});
test('dashboard refuses nontext and oversized bodies', () => {
  for (const body of [null, undefined, {}, 0, 'x'.repeat(4 * 1024 * 1024 + 1)]) {
    assert.equal(hasCompleteReviewDashboard(body), false);
  }
});

test('actual D source verifier rejects contradictory authenticated dashboards without weakening other gates', async t => {
  const f = await originalFourthFixture(t);
  const root = 'https://api.github.com/repos/appliedai-au/gate_keeper';
  const make = body => {
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
    return { ...g, dashboard: approval, acknowledgement };
  };
  const verify = g => createProposalObservationSourceVerifier({ descriptor: g.descriptor, fetcher: g.fetcher })(g.input);
  for (const [name, body] of positive) await t.test('accepts authenticated ' + name, async () => {
    assert.equal((await verify(make(body))).implementationCommit, D);
  });
  for (const [name, body] of negative) await t.test('refuses authenticated ' + name, async () => {
    await assert.rejects(verify(make(body)), /no complete approval evidence/);
  });
  await t.test('clean wording cannot override wrong bot identity', async () => {
    const g = make(dashboard('No issues found.'));
    g.dashboard.user = { id: 999, login: 'TEST-ONLY-wrong-reviewer' };
    await assert.rejects(verify(g), /review author or payload changed/);
  });
  await t.test('clean wording cannot override changed pinned bytes', async () => {
    const g = make(dashboard('No issues found.'));
    g.dashboard.body += '\nTEST-ONLY later unpinned edit';
    await assert.rejects(verify(g), /review author or payload changed/);
  });
  await t.test('clean wording cannot override stale approval', async () => {
    const g = make(dashboard('No issues found.'));
    g.dashboard.updated_at = new Date(f.controls.now - 116000).toISOString();
    await assert.rejects(verify(g), /predates exact-head/);
  });
  await f.assertNoNewCalls();
});
