import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { verifyEnvelope } from '../scripts/learning-trust.mjs';
import { openAuthorityCustody } from '../scripts/learning-v2/authority-custody.mjs';
import { createSourceGateVerifier } from '../scripts/learning-v2/authority-source-proof.mjs';

// REMOTE-ONLY REGRESSION SOURCE. Disposable test keys and fake public GitHub
// documents are not real signer identities, qualifications or pilot evidence.
const sha = value => createHash('sha256').update(value).digest('hex');

test('protected signing identities are distinct, persist across reopen, and recover only their own publication links', async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-authority-custody-'));
  chmodSync(root, 0o700);
  const repositoryRoot = join(root, 'repository'), directory = join(root, 'protected');
  mkdirSync(repositoryRoot, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = openAuthorityCustody({ directory, repositoryRoot, initialize: true, gatewayId: 'test-gateway' });
  assert.equal(new Set(Object.values(first.trust).map(item => item.pinnedFingerprint)).size, 4);
  for (const role of ['evaluation', 'novelty', 'budget', 'activation']) {
    const file = join(directory, 'keys', role + '.pem');
    assert.equal(lstatSync(file).mode & 0o077, 0);
    const envelope = first.signers[role]({ schema: 'TEST-ONLY', role });
    assert.equal(verifyEnvelope({ ...first.trust[role], ...envelope }).role, role);
  }
  const evidence = { schema: 'TEST-ONLY-artifact', body: 'retained genuine-boundary test payload' };
  const key = await first.artifactStore.put(evidence), path = join(directory, 'artifacts', key + '.json');
  const staged = path + '.pending-' + 'a'.repeat(32);
  linkSync(path, staged); // Exact crash gap after no-clobber publication, before staging unlink.
  assert.equal(lstatSync(path).nlink, 2);
  assert.deepEqual(await first.artifactStore.get(key), evidence);
  assert.equal(existsSync(staged), false);
  assert.equal(lstatSync(path).nlink, 1);
  const unrelated = join(root, 'unrecognized-hard-link');
  linkSync(path, unrelated);
  await assert.rejects(first.artifactStore.get(key), /unrecognized.*hard link/);
  rmSync(unrelated);
  first.writeBundle({ schema: 'TEST-ONLY-bundle', identity: 'immutable' });
  assert.throws(() => first.writeBundle({ schema: 'TEST-ONLY-bundle', identity: 'replacement' }), /replacement/);
  const reopened = openAuthorityCustody({ directory, repositoryRoot, gatewayId: 'test-gateway' });
  assert.deepEqual(reopened.trust, first.trust);
  assert.equal(reopened.relayPrefix, first.relayPrefix);
  assert.deepEqual(reopened.readBundle(), { identity: 'immutable', schema: 'TEST-ONLY-bundle' });
  assert.equal(readFileSync(path, 'utf8').includes('retained genuine-boundary'), true);
});

test('uncommitted partial artifact staging never becomes committed evidence and symlink custody is refused', async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-authority-partial-'));
  chmodSync(root, 0o700);
  const repositoryRoot = join(root, 'repository'), directory = join(root, 'protected');
  mkdirSync(repositoryRoot, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const custody = openAuthorityCustody({ directory, repositoryRoot, initialize: true, gatewayId: 'test-gateway' });
  const value = { complete: true }, id = digest(value);
  const pending = join(directory, 'artifacts', id + '.json.pending-' + 'b'.repeat(32));
  writeFileSync(pending, '{"partial":', { mode: 0o600 });
  assert.equal(await custody.artifactStore.put(value), id);
  assert.deepEqual(await custody.artifactStore.get(id), value);
  const linked = join(root, 'linked');
  symlinkSync(directory, linked);
  assert.throws(() => openAuthorityCustody({ directory: linked, repositoryRoot, gatewayId: 'test-gateway' }),
    /symlink/);
});

function sourceFixture({ acknowledgement = true, acknowledgedHead = 'a'.repeat(40),
  approvalAt = '2026-11-05T05:03:00Z', nativeState = 'COMMENTED' } = {}) {
  const repository = 'appliedai-au/gate_keeper', root = 'https://api.github.com/repos/' + repository;
  const qualifiedCommit = 'a'.repeat(40), sourceCommit = 'b'.repeat(40),
    baseCommit = 'c'.repeat(40), treeSha = 'd'.repeat(40), pullRequest = 99;
  const owner = { login: 'test-owner', id: 123 }, bot = { login: 'gitar-bot[bot]', id: 159877585 };
  const documents = new Map();
  const add = (path, value) => { documents.set(root + path, value); return value; };
  const issue = (id, user, body, at) => add('/issues/comments/' + id, { id, user, body,
    created_at: at, updated_at: at, issue_url: root + '/issues/' + pullRequest });
  const request = issue(1, owner, '@gitar-bot review exact ' + qualifiedCommit, '2026-11-05T05:01:00Z');
  const ack = issue(2, bot, 'Queued a current-head review for ' + acknowledgedHead, '2026-11-05T05:02:00Z');
  const approval = issue(3, bot, '<kbd>✅ Approved</kbd> <kbd>0 findings</kbd>', approvalAt);
  const pin = comment => ({ id: comment.id, bodySha256: sha(comment.body) });
  const native = add('/pulls/99/reviews/4', { id: 4, user: bot, body: '', state: nativeState,
    commit_id: 'e'.repeat(40) });
  const gatePolicy = { targetId: 'test-full-suite', presetDigest: sha('TEST-ONLY preset'),
    outputProfileDigest: sha('TEST-ONLY profile'), effectiveTreeDigest: digest({ repository, gitTree: treeSha }) };
  const summary = { tests: 12, pass: 12, fail: 0, skipped: 0, cancelled: 0, todo: 0 };
  const receipt = { schema: 'gk-learning-source-qualification-v1', repository, pullRequest,
    qualifiedCommit, baseCommit, treeSha, gatePolicy,
    deployment: { projectId: '11111111-1111-1111-1111-111111111111',
      environmentId: '22222222-2222-2222-2222-222222222222',
      serviceId: '33333333-3333-3333-3333-333333333333',
      deploymentId: '44444444-4444-4444-4444-444444444444', finishedAt: '2026-11-05T05:00:00Z', status: 'SUCCESS' },
    cleanup: { complete: true, serviceId: '33333333-3333-3333-3333-333333333333', observedAt: '2026-11-05T05:03:30Z' },
    checks: { node: summary, canary: summary, typecheck: 'passed', scorerSelfTests: 5 },
    rawLogsDigest: sha('TEST-ONLY complete remote qualification log'),
    review: { mode: 'dashboard', requestedHead: qualifiedCommit, request: pin(request),
      acknowledgement: acknowledgement ? pin(ack) : null, approval: pin(approval), resolvedComments: [],
      nativeReviews: [{ id: native.id, commitId: native.commit_id, state: native.state }] } };
  const ownerComment = issue(5, owner, 'GK_AUTHORITY_QUALIFICATION\n' + JSON.stringify(receipt), '2026-11-05T05:04:00Z');
  add('/pulls/99', { head: { sha: qualifiedCommit, repo: { full_name: repository } },
    base: { ref: 'main', repo: { full_name: repository } }, merged: true, merge_commit_sha: sourceCommit });
  add('/git/commits/' + qualifiedCommit, { sha: qualifiedCommit, tree: { sha: treeSha }, parents: [{ sha: baseCommit }] });
  add('/git/commits/' + sourceCommit, { sha: sourceCommit, tree: { sha: treeSha },
    parents: [{ sha: baseCommit }, { sha: qualifiedCommit }] });
  add('/git/commits/' + baseCommit, { sha: baseCommit, tree: { sha: 'f'.repeat(40) }, parents: [] });
  add('/branches/main', { commit: { sha: sourceCommit } });
  add('/contents/Dockerfile.qualify?ref=' + sourceCommit, { encoding: 'base64',
    content: Buffer.from('TEST-ONLY preset').toString('base64') });
  const descriptor = { schema: 'gk-learning-source-proof-v1', repository, sourceCommit,
    qualification: { commentId: 5, bodySha256: sha(ownerComment.body), authorId: owner.id, authorLogin: owner.login } };
  const fetcher = async (url, options) => {
    assert.equal(options.redirect, 'error'); assert.ok(documents.has(url), 'only fixed GitHub evidence endpoints');
    return Response.json(copy(documents.get(url)));
  };
  return { verify: createSourceGateVerifier({ descriptor, fetcher }),
    bundle: { binding: { sourceCommit }, config: { gatePolicy } }, documents, root, receipt };
}

test('source gate independently fetches exact merged tree and real dashboard evidence, retaining COMMENTED honestly', async () => {
  const f = sourceFixture(), result = await f.verify(f.bundle);
  assert.equal(result.runId, f.receipt.deployment.deploymentId);
  assert.equal(result.evidence.qualification.review.nativeReviews[0].state, 'COMMENTED');
  assert.equal(result.evidence.reviewArtifacts.find(item => item.id === 4).state, 'COMMENTED');
});

for (const [name, options] of [
  ['missing exact-head bot acknowledgement', { acknowledgement: false }],
  ['acknowledgement for another head', { acknowledgedHead: 'f'.repeat(40) }],
  ['old approval before the exact-head acknowledgement', { approvalAt: '2026-11-05T05:01:30Z' }],
]) test('source gate rejects ' + name, async () => {
  const f = sourceFixture(options);
  await assert.rejects(f.verify(f.bundle), /acknowledgement/);
});

test('source gate rejects changed current main, changed qualification bytes and inverted merge ancestry', async () => {
  for (const mutate of [
    f => { f.documents.get(f.root + '/branches/main').commit.sha = 'e'.repeat(40); },
    f => { f.documents.get(f.root + '/issues/comments/5').body += '\nforged'; },
    f => { f.documents.get(f.root + '/git/commits/' + f.bundle.binding.sourceCommit).parents.reverse(); },
  ]) {
    const f = sourceFixture(); mutate(f);
    await assert.rejects(f.verify(f.bundle));
  }
});

test('source gate refuses an owner receipt without actual post-success cleanup evidence', async () => {
  const f = sourceFixture();
  f.receipt.cleanup.complete = false;
  const comment = f.documents.get(f.root + '/issues/comments/5');
  comment.body = 'GK_AUTHORITY_QUALIFICATION\n' + JSON.stringify(f.receipt);
  const descriptor = { schema: 'gk-learning-source-proof-v1', repository: 'appliedai-au/gate_keeper',
    sourceCommit: f.bundle.binding.sourceCommit, qualification: {
      commentId: 5, bodySha256: sha(comment.body), authorId: 123, authorLogin: 'test-owner' } };
  const verify = createSourceGateVerifier({ descriptor, fetcher: async url => Response.json(f.documents.get(url)) });
  await assert.rejects(verify(f.bundle), /cleanup/);
});
