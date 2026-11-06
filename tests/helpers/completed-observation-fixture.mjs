import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { canonical, copy, digest } from '../../scripts/learning-v2/contracts.mjs';
import { MemoryJournal } from '../../scripts/learning-v2/journal.mjs';
import { createDetachedAuthority } from '../../scripts/learning-v2/authority-core.mjs';
import { openLearningHost } from '../../scripts/learning-v2/host.mjs';
import { createProposalObservationSourceVerifier, verifyProposalObservationOwner,
  PROPOSAL_OBSERVATION_PURPOSE } from '../../scripts/learning-v2/proposal-observation-proof.mjs';
import { originalContinuationFixture, A, B, D } from './proposal-observation-fixture.mjs';
import { proposalObservationSourceFixture } from './proposal-observation-source-fixture.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
export const E = '2'.repeat(40), E_HEAD = '3'.repeat(40), TREE_E = '4'.repeat(40);
const ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';

/** Both releases use the real source verifier with authenticated transport
 * doubles. D is only E's qualified predecessor; it is never installed here. */
function successorSourceFixture(f, previous) {
  const routes = new Map(previous.routes), requests = [];
  const time = delta => new Date(f.controls.now + delta).toISOString();
  const gatePolicy = { ...copy(previous.proof.gatePolicy),
    effectiveTreeDigest: digest({ repository: 'appliedai-au/gate_keeper', gitTree: TREE_E }) };
  const request = { id: 900, user: previous.owner, issue_url: ROOT + '/issues/161',
    body: '@gitar review exact head ' + E_HEAD, created_at: time(-60000) };
  const approval = { id: 901, user: previous.bot, body: 'TEST-ONLY successor approval',
    commit_id: E_HEAD, state: 'APPROVED', submitted_at: time(-50000) };
  const proof = { ...copy(previous.proof), pullRequest: 161, qualifiedCommit: E_HEAD, baseCommit: D,
    treeSha: TREE_E, gatePolicy,
    deployment: { ...copy(previous.proof.deployment), deploymentId: '55555555-5555-5555-5555-555555555555', finishedAt: time(-30000) },
    cleanup: { ...copy(previous.proof.cleanup), observedAt: time(-20000) },
    rawLogsDigest: sha('TEST-ONLY distinct full successor logs'),
    review: { mode: 'formal-review', requestedHead: E_HEAD,
      request: { id: 900, bodySha256: sha(request.body) }, acknowledgement: null,
      approval: { id: 901, bodySha256: sha(approval.body) }, resolvedComments: [],
      nativeReviews: [{ id: 901, commitId: E_HEAD, state: 'APPROVED' }] } };
  const comment = { id: 902, user: previous.owner, created_at: time(-10000), issue_url: ROOT + '/issues/161' };
  const descriptor = { schema: 'gk-learning-proposal-observation-source-proof-v1', gatePolicy,
    sourceProof: { schema: 'gk-learning-proposal-observation-gate-proof-v2', repository: 'appliedai-au/gate_keeper', sourceCommit: E,
      qualification: { commentId: 902, bodySha256: '', authorId: previous.owner.id, authorLogin: previous.owner.login },
      previous: copy(previous.descriptor) } };
  for (const [path, value] of [
    ['/issues/comments/900', request], ['/pulls/161/reviews/901', approval], ['/issues/comments/902', comment],
    ['/pulls/161/reviews?per_page=100&page=1', [approval]],
    ['/pulls/161', { head: { sha: E_HEAD, repo: { full_name: 'appliedai-au/gate_keeper' } },
      base: { ref: 'main', repo: { full_name: 'appliedai-au/gate_keeper' } }, merged: true, merge_commit_sha: E }],
    ['/git/commits/' + E_HEAD, { sha: E_HEAD, tree: { sha: TREE_E }, parents: [{ sha: D }] }],
    ['/git/commits/' + E, { sha: E, tree: { sha: TREE_E }, parents: [{ sha: D }, { sha: E_HEAD }] }],
    ['/branches/main', { commit: { sha: E } }],
    ['/contents/Dockerfile.qualify?ref=' + E, copy(previous.routes.get('/contents/Dockerfile.qualify?ref=' + D))],
  ]) routes.set(path, value);
  function refresh() {
    comment.body = 'GK_PROPOSAL_OBSERVATION_QUALIFICATION\n' + JSON.stringify(proof);
    descriptor.sourceProof.qualification.bodySha256 = sha(comment.body);
  }
  refresh();
  const fetcher = async (url, options) => {
    assert.ok(url.startsWith(ROOT + '/')); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.Authorization, undefined);
    const path = url.slice(ROOT.length); requests.push(path);
    assert.ok(routes.has(path), 'unexpected TEST-ONLY successor evidence request ' + path);
    return Response.json(copy(routes.get(path)));
  };
  return { descriptor, proof, comment, previous, routes, requests, fetcher, refresh };
}

/** Actual B and D code under synthetic provider/Ed25519/GitHub transports.
 * This fixture creates every original operation and proof through its public
 * implementation API, including the failed fourth read, ordinary B settlement,
 * real D source verifier and zero-dispatch D consumption. Remote tests only. */
export async function completedObservationFixture(t, { successor = false } = {}) {
  const f = await originalContinuationFixture(t);
  await f.qualify(); await f.authorize((await f.prepare()).prepared);
  f.controls.now += 4 * 3_600_000;
  await f.host().continueBaseline();
  for (let number = 1; number <= 3; number++) {
    const attemptId = f.bundle.config.experimentId + ':attempt:' + number;
    await f.host().beginAttempt(await f.authority().fitFeedback({ attemptId }));
    await f.host().dispatch('proposal', attemptId);
  }
  const attemptId = f.bundle.config.experimentId + ':attempt:4';
  await f.host().beginAttempt(await f.authority().fitFeedback({ attemptId }));
  f.controls.proposalContent = 'TEST-ONLY prose before fenced JSON\n\n```json\n' + JSON.stringify({
    scope: f.bundle.config.scope, languages: ['python'], applicability: 'TEST-ONLY concurrent debit',
    trigger: 'TEST-ONLY duplicate balance read', evidence: 'TEST-ONLY lost update',
    action: 'TEST-ONLY conditional debit', sufficientGuard: 'TEST-ONLY equivalent conditional update' }) + '\n```';
  f.controls.holdOriginalFourth = true;
  await assert.rejects(f.host().dispatch('proposal', attemptId));
  f.controls.holdOriginalFourth = false;
  const held = await f.host().inspect(), operation = held.state.operations[4];
  const originalFourth = (await f.host().inspectOperation(operation.id)).archive;
  assert.equal(originalFourth.calls[0].stages.map(item => item.stage).join(','), 'session,turn,failure');
  const originalSettlement = await f.authority().settle({ operationId: operation.id, leaseId: operation.leaseId,
    requestDigest: operation.requestDigest });
  assert.equal(originalSettlement.body.actualCalls, 1); assert.equal(originalSettlement.body.actualMicros, null);
  const historicalStatus = await f.authority().implementationStatus();
  const authorityBefore = canonical(await f.journal.read()), artifactsBefore = canonical([...f.artifacts.entries()]);
  let dSource = proposalObservationSourceFixture({ ...f, historicalStatus });
  // GitHub's actual timestamp form commonly omits fractional seconds. Preserve
  // that original valid format through D's signature and C's historical read.
  dSource.proof.deployment.finishedAt = dSource.proof.deployment.finishedAt.replace('.000Z', 'Z');
  dSource.proof.cleanup.observedAt = dSource.proof.cleanup.observedAt.replace('.000Z', 'Z');
  dSource.comment.created_at = dSource.comment.created_at.replace('.000Z', 'Z'); dSource.refresh();
  if (successor) dSource = successorSourceFixture(f, dSource);
  const recoveryCommit = dSource.descriptor.sourceProof.sourceCommit, recoveryTree = dSource.proof.treeSha;
  const proofJournal = new MemoryJournal(); let ownerComment;
  const dSettings = { ...f.settings, implementationCommit: recoveryCommit, proposalObservation: {
    readOnlyJournal: { read: () => f.journal.read(), append: async () => { throw new Error('original authority write during preparation'); } },
    journalFactory: () => proofJournal,
    verifySource: createProposalObservationSourceVerifier({ descriptor: dSource.descriptor, fetcher: dSource.fetcher }),
    verifyOwner: input => verifyProposalObservationOwner({ ...input, fetcher: async () => Response.json(ownerComment) }),
  } };
  f.setAuthority(await createDetachedAuthority(dSettings));
  async function reopenD() {
    const status = await f.authority().implementationStatus();
    const implementation = { binding: f.bundle.binding, sourceCommit: recoveryCommit, status };
    f.setHost(await openLearningHost({ ...f.hostOptions, implementation })); return implementation;
  }
  await reopenD();
  const checkpoint = await f.host().prepareProposalObservation();
  const preparation = await f.authority().prepareProposalObservation({ checkpoint });
  const status = await f.authority().implementationStatus();
  const ownerAuthorization = { schema: 'gk-learning-owner-proposal-observation-v1', purpose: PROPOSAL_OBSERVATION_PURPOSE,
    experimentSourceCommit: A, historicalImplementationCommit: B, implementationCommit: recoveryCommit, implementationTree: recoveryTree,
    configDigest: f.bundle.binding.configDigest, qualificationDigest: digest(status.qualificationEnvelope),
    preparedProofDigest: digest(preparation), retainedDigest: digest(preparation.body.retained),
    settlementDigest: digest(preparation.body.settlementSerialized), allowRemainingExperiment: true };
  const body = 'GK_PROPOSAL_OBSERVATION_AUTHORIZATION\n' + JSON.stringify(ownerAuthorization);
  f.controls.now += 1000;
  ownerComment = { id: 156, user: f.owner, body, created_at: new Date(f.controls.now).toISOString().replace('.000Z', 'Z'),
    issue_url: ROOT + '/issues/' + dSource.proof.pullRequest };
  await f.authority().authorizeProposalObservation({ commentId: 156, bodySha256: sha(body) });
  const implementation = await reopenD();
  await f.host().consumeProposalObservation();
  assert.equal(f.controls.turns, 18);
  assert.equal(canonical((await f.host().inspectOperation(operation.id)).archive), canonical(originalFourth));
  assert.equal(canonical(await f.journal.read()), authorityBefore);
  assert.equal(canonical([...f.artifacts.entries()]), artifactsBefore);
  assert.deepEqual((await f.host().inspect()).state.attempts.map(item => item.status), Array(4).fill('invalid'));
  return { ...f, historicalStatus, implementation, checkpoint, preparation, originalSettlement, originalFourth,
    operation, proofJournal, dSource, dSettings, ownerAuthorization, reopenD, recoveryCommit, recoveryTree };
}
