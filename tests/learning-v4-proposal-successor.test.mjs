import test from 'node:test';
import assert from 'node:assert/strict';
import { copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { createProposalObservationSourceVerifier, verifyProposalObservationQualification } from '../scripts/learning-v2/proposal-observation-proof.mjs';
import { originalFourthFixture, D, B } from './helpers/proposal-observation-fixture.mjs';
import { proposalObservationSourceFixture, D_HEAD } from './helpers/proposal-observation-source-fixture.mjs';

const ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';
const NEXT = '7'.repeat(40), NEXT_HEAD = '8'.repeat(40), NEXT_TREE = '9'.repeat(40);
const V1 = 'gk-learning-proposal-observation-gate-proof-v1';
const V2 = 'gk-learning-proposal-observation-gate-proof-v2';
const PREFIX = 'GK_PROPOSAL_OBSERVATION_QUALIFICATION\n';

function successorFixture(f) {
  const previous = proposalObservationSourceFixture(f), routes = new Map(previous.routes), requests = [];
  const time = delta => new Date(f.controls.now + delta).toISOString();
  const policy = { ...previous.proof.gatePolicy,
    effectiveTreeDigest: digest({ repository: 'appliedai-au/gate_keeper', gitTree: NEXT_TREE }) };
  const request = { id: 900, user: previous.owner, issue_url: ROOT + '/issues/161',
    body: '@gitar review exact head ' + NEXT_HEAD, created_at: time(-60000) };
  const approval = { id: 901, user: previous.bot, body: 'TEST-ONLY successor approval',
    commit_id: NEXT_HEAD, state: 'APPROVED', submitted_at: time(-50000) };
  const proof = { ...copy(previous.proof), pullRequest: 161, qualifiedCommit: NEXT_HEAD, baseCommit: D,
    treeSha: NEXT_TREE, gatePolicy: policy,
    deployment: { ...copy(previous.proof.deployment), deploymentId: '55555555-5555-5555-5555-555555555555', finishedAt: time(-30000) },
    cleanup: { ...copy(previous.proof.cleanup), observedAt: time(-20000) },
    rawLogsDigest: previous.sha('TEST-ONLY distinct full successor logs'),
    review: { mode: 'formal-review', requestedHead: NEXT_HEAD,
      request: { id: 900, bodySha256: previous.sha(request.body) }, acknowledgement: null,
      approval: { id: 901, bodySha256: previous.sha(approval.body) }, resolvedComments: [],
      nativeReviews: [{ id: 901, commitId: NEXT_HEAD, state: 'APPROVED' }] } };
  const comment = { id: 902, user: previous.owner, created_at: time(-10000), issue_url: ROOT + '/issues/161' };
  const descriptor = { schema: 'gk-learning-proposal-observation-source-proof-v1', gatePolicy: policy,
    sourceProof: { schema: V2, repository: 'appliedai-au/gate_keeper', sourceCommit: NEXT,
      qualification: { commentId: 902, bodySha256: '', authorId: previous.owner.id, authorLogin: previous.owner.login },
      previous: copy(previous.descriptor) } };
  for (const [path, value] of [
    ['/issues/comments/900', request], ['/pulls/161/reviews/901', approval], ['/issues/comments/902', comment],
    ['/pulls/161/reviews?per_page=100&page=1', [approval]],
    ['/pulls/161', { head: { sha: NEXT_HEAD, repo: { full_name: 'appliedai-au/gate_keeper' } },
      base: { ref: 'main', repo: { full_name: 'appliedai-au/gate_keeper' } }, merged: true, merge_commit_sha: NEXT }],
    ['/git/commits/' + NEXT_HEAD, { sha: NEXT_HEAD, tree: { sha: NEXT_TREE }, parents: [{ sha: D }] }],
    ['/git/commits/' + NEXT, { sha: NEXT, tree: { sha: NEXT_TREE }, parents: [{ sha: D }, { sha: NEXT_HEAD }] }],
    ['/branches/main', { commit: { sha: NEXT } }],
    ['/contents/Dockerfile.qualify?ref=' + NEXT, copy(previous.routes.get('/contents/Dockerfile.qualify?ref=' + D))],
  ]) routes.set(path, value);
  function refresh() {
    comment.body = PREFIX + JSON.stringify(proof);
    descriptor.sourceProof.qualification.bodySha256 = previous.sha(comment.body);
  }
  function refreshPrevious() { previous.refresh(); descriptor.sourceProof.previous = copy(previous.descriptor); }
  refresh();
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(ROOT + '/')); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    const path = url.slice(ROOT.length); requests.push(path);
    assert.ok(routes.has(path), 'unexpected TEST-ONLY successor source request ' + path);
    return Response.json(copy(routes.get(path)));
  };
  return { descriptor, proof, comment, approval, previous, routes, requests, fetcher, refresh, refreshPrevious,
    input: { bundle: f.bundle, implementationCommit: NEXT, historicalImplementationStatus: f.historicalStatus } };
}

test('explicit successor verifies exactly two qualified releases while retaining original B', async t => {
  const f = await originalFourthFixture(t);
  const fresh = () => successorFixture(f);
  // Both constructor-time shape refusal and later evidence refusal must reach
  // assert.rejects; do not let a correct synchronous refusal escape the test.
  const verify = async g => createProposalObservationSourceVerifier({ descriptor: g.descriptor, fetcher: g.fetcher })(g.input);
  const commit = value => ({ sha: value.sha, tree: value.tree.sha, parents: value.parents.map(item => item.sha) });
  await t.test('actual successor is current main; the prior leg never pretends old D is current', async () => {
    const g = fresh(), result = await verify(g);
    assert.equal(result.implementationCommit, NEXT);
    assert.equal(result.evidence.base.sha, D);
    assert.equal(result.evidence.predecessor.source.sha, D);
    assert.equal(result.evidence.predecessor.base.sha, B);
    assert.equal(result.evidence.observedMain, NEXT);
    assert.equal(result.evidence.predecessor.observedMain, NEXT);
    assert.equal(result.evidence.schema, 'gk-learning-proposal-observation-source-evidence-v2');
    assert.equal(g.requests.filter(path => path === '/branches/main').length, 3);
    assert.equal(g.requests.some(path => path.startsWith('/compare/')), false);
    const p = result.evidence.predecessor;
    assert.equal(result.qualificationEvidenceDigest, digest({
      schema: 'gk-learning-proposal-observation-qualified-facts-v2', descriptor: g.descriptor,
      qualificationReceipt: result.evidence.qualification, source: commit(result.evidence.source),
      qualified: commit(result.evidence.qualified), base: commit(result.evidence.base),
      historicalQualificationDigest: digest(f.historicalStatus.qualificationEnvelope),
      historicalAuthorizationDigest: digest(f.historicalStatus.authorizationEnvelope),
      predecessor: { descriptor: p.descriptor, qualificationReceipt: p.qualification,
        source: commit(p.source), qualified: commit(p.qualified), base: commit(p.base) },
    }));
  });
  await t.test('v1 facts stay byte-compatible and cannot qualify a successor', async () => {
    const g = proposalObservationSourceFixture(f);
    const result = await createProposalObservationSourceVerifier({ descriptor: g.descriptor, fetcher: g.fetcher })(g.input);
    assert.equal(result.qualificationEvidenceDigest, digest({ schema: 'gk-learning-proposal-observation-qualified-facts-v1',
      descriptor: g.descriptor, qualificationReceipt: result.evidence.qualification,
      source: commit(result.evidence.source), qualified: commit(result.evidence.qualified), base: commit(result.evidence.base),
      historicalQualificationDigest: digest(f.historicalStatus.qualificationEnvelope),
      historicalAuthorizationDigest: digest(f.historicalStatus.authorizationEnvelope) }));
    const h = fresh(); h.descriptor.sourceProof.schema = V1; delete h.descriptor.sourceProof.previous;
    await assert.rejects(verify(h), /retain historical B/);
  });
  await t.test('predecessor immutable evidence changes alter the signed fact digest; metadata does not', async () => {
    const g = fresh(), before = await verify(g);
    g.routes.get('/pulls/160').comments = 900;
    assert.equal((await verify(g)).qualificationEvidenceDigest, before.qualificationEvidenceDigest);
    g.previous.proof.rawLogsDigest = g.previous.sha('TEST-ONLY different retained qualification artifact'); g.refreshPrevious();
    assert.notEqual((await verify(g)).qualificationEvidenceDigest, before.qualificationEvidenceDigest);
  });
  await t.test('missing, recursive and extra predecessor descriptors are refused', async () => {
    const g = fresh(); delete g.descriptor.sourceProof.previous; await assert.rejects(verify(g));
    const h = fresh(); h.descriptor.sourceProof.previous.sourceProof.schema = V2;
    await assert.rejects(verify(h), /exactly one v1 predecessor/);
    const i = fresh(); i.descriptor.sourceProof.extraPrevious = copy(i.descriptor.sourceProof.previous);
    await assert.rejects(verify(i), /unexpected or missing fields/);
  });
  await t.test('a self-reference and a different owner cannot supply predecessor evidence', async () => {
    const g = fresh(); g.descriptor.sourceProof.previous.sourceProof.sourceCommit = NEXT;
    await assert.rejects(verify(g), /predecessor source or owner/);
    const h = fresh(); h.descriptor.sourceProof.previous.sourceProof.qualification.authorId++;
    await assert.rejects(verify(h), /predecessor source or owner/);
  });
  await t.test('successor parent must be that exact predecessor, with ordered merge parents', async () => {
    const g = fresh(); g.routes.get('/git/commits/' + NEXT).parents.reverse();
    await assert.rejects(verify(g), /ordered|parents/);
    const h = fresh(), other = '3'.repeat(40);
    h.proof.baseCommit = other; h.routes.get('/git/commits/' + NEXT).parents[0].sha = other;
    h.routes.set('/git/commits/' + other, { sha: other, tree: { sha: '4'.repeat(40) }, parents: [{ sha: D }] }); h.refresh();
    await assert.rejects(verify(h), /first parent differs/);
  });
  await t.test('a self-consistent prior release rooted in another base cannot replace B', async () => {
    const g = fresh(), other = '3'.repeat(40);
    g.previous.proof.baseCommit = other; g.routes.get('/git/commits/' + D).parents[0].sha = other;
    g.routes.set('/git/commits/' + other, { sha: other, tree: { sha: '4'.repeat(40) }, parents: [{ sha: 'a'.repeat(40) }] });
    g.refreshPrevious(); await assert.rejects(verify(g), /retain historical B/);
  });
  await t.test('both recipes and Dockerfile bytes are independently checked', async () => {
    const g = fresh(); g.descriptor.sourceProof.previous.gatePolicy.presetDigest = '1'.repeat(64);
    await assert.rejects(verify(g), /predecessor weakens/);
    const h = fresh(); h.routes.get('/contents/Dockerfile.qualify?ref=' + D).content = Buffer.from('TEST-ONLY changed recipe').toString('base64');
    await assert.rejects(verify(h), /Dockerfile differs/);
  });
  await t.test('predecessor receipt bytes, test completeness and actual cleanup stay mandatory', async () => {
    const g = fresh(); g.previous.comment.body += ' '; await assert.rejects(verify(g), /exact artifact changed/);
    const h = fresh(); h.previous.proof.checks.node.skipped = 1; h.refreshPrevious(); await assert.rejects(verify(h), /suite incomplete/);
    const i = fresh(); i.previous.proof.cleanup.complete = false; i.refreshPrevious(); await assert.rejects(verify(i), /cleanup/);
  });
  await t.test('predecessor complete native-review inventory and approval freshness remain enforced', async () => {
    const g = fresh(); g.routes.get('/pulls/160/reviews?per_page=100&page=1').push({
      id: 999, user: g.previous.bot, commit_id: D_HEAD, state: 'CHANGES_REQUESTED' });
    await assert.rejects(verify(g), /inventory|changes-requested/);
    const h = fresh(); h.previous.approval.submitted_at = new Date(f.controls.now - 999999).toISOString();
    await assert.rejects(verify(h), /fresh approval/);
  });
  await t.test('neither old main nor a main change during the predecessor leg is accepted', async () => {
    const g = fresh(); g.routes.get('/branches/main').commit.sha = D; await assert.rejects(verify(g), /current main/);
    for (const changeOn of [2, 3]) {
      const h = fresh(), fetcher = h.fetcher; let reads = 0;
      h.fetcher = async (url, options) => {
        if (url === ROOT + '/branches/main' && ++reads === changeOn) h.routes.get('/branches/main').commit.sha = B;
        return fetcher(url, options);
      };
      await assert.rejects(verify(h), /current main/);
    }
  });
  await t.test('one test run cannot be relabelled as both releases', async () => {
    const g = fresh(); g.proof.deployment.deploymentId = g.previous.proof.deployment.deploymentId; g.refresh();
    await assert.rejects(verify(g), /predecessor identity or qualification chronology/);
  });
  await t.test('an already signed D qualification cannot be installed as successor evidence', async () => {
    assert.throws(() => verifyProposalObservationQualification(f.options.status.qualificationEnvelope, {
      binding: f.bundle.binding, trust: f.trust, implementationCommit: NEXT, historicalImplementationStatus: f.historicalStatus,
    }), /actual image/);
  });
  await f.assertNoNewCalls();
});
