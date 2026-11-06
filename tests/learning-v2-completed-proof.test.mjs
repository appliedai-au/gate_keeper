import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copy } from '../scripts/learning-v2/contracts.mjs';
import { createCompletedSourceVerifier, verifyCompletedOwnerPin } from '../scripts/learning-v2/completed-history-proof.mjs';
import { C, HEAD, completedSourceFixture } from './helpers/completed-source-fixture.mjs';

const NOW = Date.UTC(2026, 10, 6, 12), sha = value => createHash('sha256').update(value).digest('hex');
const original = { schema: 'gk-learning-v2-qualified-implementation', implementationCommit: 'b'.repeat(40), qualification: { authorId: 123, authorLogin: 'TEST-ONLY-owner' } };
const binding = { ownerId: 'unrelated-Base44-owner', experimentId: 'TEST-ONLY-history', sourceCommit: 'a'.repeat(40), configDigest: '1'.repeat(64) };
const final = { schema: 'gk-learning-qualified-proposal-observation-v1', implementationCommit: 'd'.repeat(40),
  implementationTree: 'e'.repeat(40), historicalImplementationCommit: original.implementationCommit, binding, qualification: copy(original.qualification) };
const verify = f => createCompletedSourceVerifier({ descriptor: f.descriptor, fetcher: f.fetcher })({
  actualSourceCommit: C, originalQualification: original, finalQualification: final, binding });

test('actual C qualification authenticates its own full real-database recipe and source independently of historical B', async () => {
  const f = completedSourceFixture(NOW), result = await verify(f);
  assert.equal(result.sourceCommit, C); assert.equal(result.owner.id, 123);
  assert.notEqual(result.owner.login, binding.ownerId);
  assert.equal(result.evidence.qualification.checks.realPostgres.tests, 1);
  assert.equal(result.evidence.observedMain, C);
  await assert.rejects(createCompletedSourceVerifier({ descriptor: f.descriptor, fetcher: f.fetcher })({
    actualSourceCommit: 'b'.repeat(40), originalQualification: original, finalQualification: final, binding }), /actual distinct C/);
  await assert.rejects(createCompletedSourceVerifier({ descriptor: f.descriptor, fetcher: f.fetcher })({
    actualSourceCommit: C, originalQualification: { ...original,
      qualification: { authorId: 987, authorLogin: binding.ownerId } }, finalQualification: final, binding }), /owner/);
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

test('v2 refuses the prior C protocol and a self-consistent merge onto B instead of the authenticated final D', async () => {
  const oldDescriptor = completedSourceFixture(NOW);
  oldDescriptor.descriptor.schema = 'gk-completed-history-source-proof-v1';
  assert.throws(() => createCompletedSourceVerifier({ descriptor: oldDescriptor.descriptor, fetcher: oldDescriptor.fetcher }));
  const oldReceipt = completedSourceFixture(NOW);
  oldReceipt.proof.schema = 'gk-completed-history-source-qualification-v1'; oldReceipt.refresh();
  await assert.rejects(verify(oldReceipt), /qualification schema/);
  const wrongBase = completedSourceFixture(NOW), other = original.implementationCommit;
  wrongBase.proof.baseCommit = other;
  wrongBase.routes.get('/git/commits/' + C).parents[0].sha = other;
  wrongBase.routes.set('/git/commits/' + other, { sha: other, tree: { sha: final.implementationTree } });
  wrongBase.refresh(); await assert.rejects(verify(wrongBase), /final D/);
  const changedD = { ...final, implementationCommit: '6'.repeat(40) };
  const clean = completedSourceFixture(NOW);
  await assert.rejects(createCompletedSourceVerifier({ descriptor: clean.descriptor, fetcher: clean.fetcher })({
    actualSourceCommit: C, originalQualification: original, finalQualification: changedD, binding }), /final D/);
  await assert.rejects(createCompletedSourceVerifier({ descriptor: clean.descriptor, fetcher: clean.fetcher })({
    actualSourceCommit: C, originalQualification: original, finalQualification: { ...final, implementationTree: '1'.repeat(40) }, binding }), /final D/);
  await assert.rejects(createCompletedSourceVerifier({ descriptor: clean.descriptor, fetcher: clean.fetcher })({
    actualSourceCommit: C, originalQualification: original, finalQualification: { ...final, binding: { ...binding, configDigest: '0'.repeat(64) } }, binding }),
  /frozen binding/);
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
  const closure = { binding, originalExecutionSourceCommit: 'b'.repeat(40), finalExecutionSourceCommit: 'd'.repeat(40),
    servingSourceCommit: C, completion: { observationQualificationDigest: 'a'.repeat(64),
      observationPreparationDigest: 'b'.repeat(64), observationAuthorizationDigest: 'c'.repeat(64) },
    authorityCapsuleSha256: '5'.repeat(64), archivedAt: new Date(NOW).toISOString() };
  const pin = f.ownerPin(closure, closureDigest);
  const result = await verifyCompletedOwnerPin({ pin, closure, closureDigest, sourceEvidence: source, fetcher: f.fetcher });
  assert.equal(result.body.driver, 'unavailable');
  for (const privateKey of ['ownerId', 'operationId', 'leaseId', 'sessionId', 'turnId', 'retained'])
    assert.equal(Object.hasOwn(result.body, privateKey), false);
  const wrong = copy(closure); wrong.finalExecutionSourceCommit = '6'.repeat(40);
  await assert.rejects(verifyCompletedOwnerPin({ pin, closure: wrong, closureDigest, sourceEvidence: source, fetcher: f.fetcher }));
  f.routes.get('/issues/comments/603').user = { id: 999, login: binding.ownerId };
  await assert.rejects(verifyCompletedOwnerPin({ pin, closure, closureDigest, sourceEvidence: source, fetcher: f.fetcher }), /author/);
});

// NOT executed locally: authored as source for remote qualification. These use
// the actual completed-source verifier and the actual hasCompleteReviewDashboard.
const DASH_ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';
const BOT = { id: 159877585, login: 'gitar-bot[bot]' };
const closedEntries = count => Array.from({ length: count }, (_, index) => '<details>\n' +
  '<summary>✅ <b>Bug:</b> TEST-ONLY resolved finding ' + index + '</summary>\n\n' +
  '> TEST-ONLY retained example: 10 open, 100 findings.\n\n' +
  '</details>').join('\n\n');
const allClosed = count => '<details>\n' +
  '<summary><b>Code Review</b> <kbd>✅ Approved</kbd> <kbd>' + count + ' closed / ' + count +
  ' findings</kbd></summary>\n\n' +
  '<kbd>🟢 Low risk</kbd> · TEST-ONLY. No open findings remain.\n\n' +
  '<details>\n' +
  '<summary><kbd>✅ ' + count + ' closed</kbd></summary>\n\n' +
  closedEntries(count) + '\n\n' +
  '</details>\n\n' +
  '</details>';
const dashboardCases = [
  ['actual zero-findings form', '✅ Approved\nNo open findings remain.', true],
  ['actual compact zero form', '<kbd>✅ Approved</kbd> <kbd>0 open</kbd>', true],
  ['actual all-closed form', allClosed(2), true],
  ['10 findings', '✅ Approved\n10 findings', false],
  ['100 open', '✅ Approved\n100 open', false],
  ['10 open', '✅ Approved\n10 open', false],
  ['singular 1 finding', '✅ Approved\n1 finding', false],
  ['singular 1 issue', '✅ Approved\n1 issue', false],
  ['contradictory clean prose', '✅ Approved\n3 open\nNo open findings remain.', false],
  ['malformed numerical count', '<details>\n' +
    '<summary><b>Code Review</b> <kbd>✅ Approved</kbd> <kbd>04 closed / 04 findings</kbd></summary>\n' +
    'No open findings remain.\n' +
    '</details>', false],
  ['unequal closed count', allClosed(2).replace('2 closed / 2 findings', '2 closed / 3 findings'), false],
  ['quoted examples only', '> ✅ Approved\n> No open findings remain.\n`0 open`', false],
  ['unanchored zero text', '✅ Approved\nStill 10 findings, previously 0 findings.', false],
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
  const wrongBot = dashboardFixture('✅ Approved\nNo open findings remain.');
  wrongBot.approval.user = { id: 456, login: 'other-authenticated-reviewer' };
  await assert.rejects(verify(wrongBot.f), /author or payload changed/);

  const altered = dashboardFixture('✅ Approved\nNo open findings remain.');
  altered.approval.body = '✅ Approved\nNo open findings remain.\n';
  await assert.rejects(verify(altered.f), /author or payload changed/);

  const stale = dashboardFixture('✅ Approved\nNo open findings remain.');
  stale.approval.updated_at = new Date(NOW - 120000).toISOString();
  await assert.rejects(verify(stale.f), /predates exact-head bot acknowledgement/);

  const noHead = dashboardFixture('✅ Approved\nNo open findings remain.', 'Queued current head ' + 'a'.repeat(40));
  await assert.rejects(verify(noHead.f), /lacks exact-head bot acknowledgement/);
});

// Public marker tails and original/fix identities below were read from the
// authenticated PR59 inline artifacts. The surrounding source/qualification
// graph and owner ID remain TEST-ONLY; no live qualification is represented.
const authenticatedFixedShapes = [
  { id: 4488884153, old: '22cf97d3f4a3608f193e1e2f92b2c2e2a5dcc0e6',
    fix: 'e346b34dac0751643645574dd1ad615b41d7487d',
    marker: '<kbd>✅ Fixed by `@appliedai-au` in e346b34</kbd>' },
  { id: 4488884204, old: '22cf97d3f4a3608f193e1e2f92b2c2e2a5dcc0e6',
    fix: 'e346b34dac0751643645574dd1ad615b41d7487d',
    marker: '<kbd>✅ Fixed by `@appliedai-au` in e346b34</kbd>' },
  { id: 4489421387, old: '0f127944d20a47907e4e0a21a6d4d56352c988d7',
    fix: '2776c09b8c45fa44e28f494732b052f139434513',
    marker: '<kbd>✅ Fixed by `@appliedai-au` in 2776c09</kbd>' },
];
function fixedByFixture(shapes = [authenticatedFixedShapes[0]]) {
  const f = completedSourceFixture(NOW), reads = [], findings = [];
  f.owner.login = 'appliedai-au'; f.descriptor.qualification.authorLogin = f.owner.login;
  for (const shape of shapes) {
    const finding = { id: shape.id, user: copy(BOT), pull_request_url: DASH_ROOT + '/pulls/59',
      commit_id: shape.old, line: null, body: '<details>\n' +
        '<summary>⚠️ <b>Bug:</b> TEST-ONLY retained finding</summary>\n\n' + shape.marker + '\n\n</details>' };
    const pin = { id: finding.id, bodySha256: sha(finding.body), commitId: shape.old, fixCommit: shape.fix };
    const comparison = { status: 'ahead', base_commit: { sha: shape.fix }, merge_base_commit: { sha: shape.fix },
      total_commits: 1, commits: [{ sha: HEAD }] };
    f.routes.set('/pulls/comments/' + finding.id, finding); f.proof.review.resolvedComments.push(pin);
    f.routes.set('/compare/' + shape.fix + '...' + HEAD + '?per_page=100', comparison);
    findings.push({ finding, pin, comparison, shape });
  }
  f.refresh();
  const fetcher = f.fetcher;
  f.fetcher = async (url, options) => { reads.push(url); return fetcher(url, options); };
  const ownerPin = { ...original.qualification, authorLogin: f.owner.login };
  return { f, reads, findings,
    check() { return createCompletedSourceVerifier({ descriptor: f.descriptor, fetcher: f.fetcher })({
      actualSourceCommit: C, originalQualification: { ...original, qualification: ownerPin },
      finalQualification: { ...final, qualification: ownerPin }, binding }); },
  };
}

test('actual C verifier accepts all three authenticated Markdown fixed-by shapes without relabelling their old commits', async () => {
  const fixture = fixedByFixture(authenticatedFixedShapes), result = await fixture.check();
  assert.equal(result.sourceCommit, C);
  assert.equal(result.evidence.qualification.review.resolvedComments.length, 3);
  for (const { finding, pin, shape } of fixture.findings) {
    const retained = result.evidence.reviewArtifacts.find(item => item.id === shape.id);
    assert.equal(retained.commit_id, shape.old); assert.equal(retained.body, finding.body);
    assert.equal(sha(retained.body), pin.bodySha256); assert.equal(pin.fixCommit, shape.fix);
    assert.notEqual(retained.commit_id, HEAD);
  }
  assert.equal(fixture.reads.filter(url => url.includes('/compare/')).length, 3,
    'each actual fix still requires its independent containment comparison');
});

test('actual C verifier preserves plain markers and accepts only the existing full, eight or seven hex fix forms', async () => {
  const shape = authenticatedFixedShapes[0];
  for (const owner of ['@appliedai-au', '`@appliedai-au`']) for (const length of [40, 8, 7]) {
    const fixture = fixedByFixture([{ ...shape, marker: 'Fixed by ' + owner + ' in ' + shape.fix.slice(0, length) }]);
    assert.equal((await fixture.check()).sourceCommit, C);
  }
});

test('a re-pinned fixed-by body must bind the original owner and actual fix in the same complete clause', async t => {
  const shape = authenticatedFixedShapes[0], fix = shape.fix, other = '4'.repeat(40);
  const markers = [
    ['wrong owner', '<kbd>✅ Fixed by `@another-owner` in ' + fix.slice(0, 7) + '</kbd>'],
    ['owner prefix only', 'Fixed by @appliedai-au-other in ' + fix],
    ['wrong fix plus correct hash elsewhere', 'Fixed by @appliedai-au in ' + other + '\nUnrelated reference: ' + fix],
    ['two mismatched clauses', 'Fixed by @another-owner in ' + fix + '\nFixed by `@appliedai-au` in ' + other],
    ['unpaired opening backtick', 'Fixed by `@appliedai-au in ' + fix],
    ['unpaired closing backtick', 'Fixed by @appliedai-au` in ' + fix],
    ['different full hash sharing the prefix', 'Fixed by `@appliedai-au` in ' + fix.slice(0, -1) + '0'],
    ['unsupported nine-character prefix', 'Fixed by @appliedai-au in ' + fix.slice(0, 9)],
    ['short hash embedded in a word', 'Fixed by @appliedai-au in ' + fix.slice(0, 7) + 'g'],
    ['full hash with an extra hex character', 'Fixed by @appliedai-au in ' + fix + '0'],
  ];
  for (const [name, marker] of markers) await t.test(name, async () => {
    const fixture = fixedByFixture([{ ...shape, marker }]);
    await assert.rejects(fixture.check(), /historical finding lacks its actual authenticated fix context/);
    assert.equal(fixture.reads.some(url => url.includes('/compare/')), false,
      'the authenticated body fails its fix context before ancestry lookup');
  });
});

test('Markdown marker support retains pinned bot, body, PR, original commit and actual ancestry guards', async t => {
  const changes = [
    ['bot ID', item => { item.finding.user.id = 456; }, /independent review author or payload changed/],
    ['bot login', item => { item.finding.user.login = 'another-bot'; }, /independent review author or payload changed/],
    ['unpinned body byte', item => { item.finding.body += '\n'; }, /independent review author or payload changed/],
    ['another PR', item => { item.finding.pull_request_url = DASH_ROOT + '/pulls/60'; }, /historical finding belongs to another PR/],
    ['rewritten original commit', item => { item.finding.commit_id = HEAD; }, /authenticated fix context/],
    ['wrong merge base', item => { item.comparison.merge_base_commit.sha = '4'.repeat(40); }, /fix is not proven/],
    ['wrong final comparison head', item => { item.comparison.commits[0].sha = '4'.repeat(40); }, /fix is not proven/],
  ];
  for (const [name, mutate, expected] of changes) await t.test(name, async () => {
    const fixture = fixedByFixture(); mutate(fixture.findings[0]);
    await assert.rejects(fixture.check(), expected);
  });
});
