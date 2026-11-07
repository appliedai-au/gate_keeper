/** Read-only historical recovery verification for the separately qualified C profile.
 * Only the one already signed fourth-result preparation may carry private
 * output text into the protected capsule. No provider client, key, signer,
 * authority constructor, admission or append capability is used here. */
import { canonical, copy, digest, hash, integer, record, requireThat } from './contracts.mjs';
import { AuthorityLedger } from './authority-ledger.mjs';
import { TURN_CONFIG } from './trueforge-turn.mjs';
import { continuationLink } from './baseline-continuation.mjs';
import { PROPOSAL_OBSERVATION_STATUS, PROPOSAL_OBSERVATION_PURPOSE,
  verifyProposalObservationStatus } from './proposal-observation-proof.mjs';
import { observationPrefixHead, readProposalObservation, validateOriginalProposalPacket,
  verifyOriginalProposalReceipts, originalProposalIsInvalid } from './proposal-observation.mjs';
import { bytesSha, isoTime, same } from './completed-history-files.mjs';

export const COMPLETED_RECOVERY = Object.freeze({ kind: 'original-invalid-proposal-observation',
  attempt: 4, additionalModelCalls: 0 });
const ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';
const QUALIFICATION_PREFIX = 'GK_PROPOSAL_OBSERVATION_QUALIFICATION\n';
const OWNER_PREFIX = 'GK_PROPOSAL_OBSERVATION_AUTHORIZATION\n';
const GATE_V1 = 'gk-learning-proposal-observation-gate-proof-v1';
const GATE_V2 = 'gk-learning-proposal-observation-gate-proof-v2';
const FACTS_V1 = 'gk-learning-proposal-observation-qualified-facts-v1';
const FACTS_V2 = 'gk-learning-proposal-observation-qualified-facts-v2';
// Original GitHub/qualification protocols accept valid historical timestamps
// with or without fractional seconds. Do not rewrite signed receipt strings
// or demand C's canonical capture-time formatting of those original values.
const historicalTime = (value, label) => {
  requireThat(typeof value === 'string' && value.length <= 64 && Number.isFinite(Date.parse(value)), label);
  return Date.parse(value);
};
const readOnly = snapshot => ({ read: async () => copy(snapshot),
  append: async () => { throw new Error('completed history has no journal write capability'); } });
const serialized = (value, label) => {
  requireThat(typeof value === 'string' && Buffer.byteLength(value) > 0 &&
    Buffer.byteLength(value) <= 2 * 1024 * 1024, label + ' bounds');
  const result = JSON.parse(value); canonical(result); return result;
};

function qualifiedFacts(evidence, historical) {
  const raw = evidence.evidence, commit = value => ({ sha: value.sha, tree: value.tree.sha,
    parents: value.parents.map(item => item.sha) });
  const successor = raw.descriptor.schema === GATE_V2;
  requireThat(successor === Boolean(raw.predecessor), 'retained successor evidence is incomplete');
  // Reproduce the exact E signer projection. The predecessor descriptor is
  // the nested v1 gate proof; its outer policy stays in sourceProof.previous.
  // In particular, do not normalize either schema or any signed fact bytes.
  const facts = { schema: successor ? FACTS_V2 : FACTS_V1,
    descriptor: { schema: 'gk-learning-proposal-observation-source-proof-v1', sourceProof: copy(raw.descriptor),
      gatePolicy: copy(raw.qualification.gatePolicy) }, qualificationReceipt: copy(raw.qualification),
    source: commit(raw.source), qualified: commit(raw.qualified), base: commit(raw.base),
    historicalQualificationDigest: digest(historical.qualificationEnvelope),
    historicalAuthorizationDigest: digest(historical.authorizationEnvelope) };
  if (raw.predecessor) {
    const previous = raw.predecessor;
    facts.predecessor = { descriptor: copy(previous.descriptor), qualificationReceipt: copy(previous.qualification),
      source: commit(previous.source), qualified: commit(previous.qualified), base: commit(previous.base) };
  }
  return facts;
}

function verifyQualificationLeg({ descriptor, gatePolicy, proof, source, qualified, base, config, owner, successor }) {
  record(descriptor, successor ? ['schema', 'repository', 'sourceCommit', 'qualification', 'previous'] :
    ['schema', 'repository', 'sourceCommit', 'qualification'], 'historical recovery source proof');
  requireThat(descriptor.schema === (successor ? GATE_V2 : GATE_V1) &&
    descriptor.repository === 'appliedai-au/gate_keeper', 'historical recovery source proof version or repository');
  hash(descriptor.sourceCommit, 'historical recovery source', 40);
  record(descriptor.qualification, ['commentId', 'bodySha256', 'authorId', 'authorLogin'], 'historical recovery owner pin');
  integer(descriptor.qualification.commentId, 'historical recovery comment', 1);
  hash(descriptor.qualification.bodySha256, 'historical recovery owner artifact hash');
  requireThat(descriptor.qualification.authorId === owner.authorId && descriptor.qualification.authorLogin === owner.authorLogin,
    'historical recovery qualification changed original B owner');
  record(gatePolicy, ['targetId', 'presetDigest', 'outputProfileDigest', 'effectiveTreeDigest'], 'historical recovery gate recipe');
  for (const key of ['targetId', 'presetDigest', 'outputProfileDigest']) same(gatePolicy[key], config.gatePolicy[key],
    'historical recovery weakened the frozen full Learning recipe');
  record(proof, ['schema', 'repository', 'pullRequest', 'qualifiedCommit', 'baseCommit', 'treeSha',
    'gatePolicy', 'deployment', 'cleanup', 'checks', 'rawLogsDigest', 'review'], 'historical recovery qualification receipt');
  requireThat(proof.schema === 'gk-learning-proposal-observation-source-qualification-v1' &&
    proof.repository === 'appliedai-au/gate_keeper', 'historical recovery qualification schema or repository');
  integer(proof.pullRequest, 'historical recovery qualification PR', 1);
  for (const key of ['qualifiedCommit', 'baseCommit', 'treeSha']) hash(proof[key], 'historical recovery ' + key, 40);
  hash(proof.rawLogsDigest, 'historical recovery execution log digest');
  same(proof.gatePolicy, gatePolicy, 'historical recovery receipt recipe changed');
  requireThat(gatePolicy.effectiveTreeDigest === digest({ repository: 'appliedai-au/gate_keeper', gitTree: proof.treeSha }),
    'historical recovery qualified tree digest changed');
  for (const value of [source, qualified, base]) {
    record(value, ['sha', 'tree', 'parents'], 'historical recovery commit');
    hash(value.sha, 'historical commit', 40); hash(value.tree, 'historical tree', 40);
    requireThat(Array.isArray(value.parents) && value.parents.length <= 2, 'historical commit parent set');
    value.parents.forEach(parent => hash(parent, 'historical parent', 40));
  }
  requireThat(source.sha === descriptor.sourceCommit && source.tree === proof.treeSha &&
    qualified.sha === proof.qualifiedCommit && qualified.tree === proof.treeSha && base.sha === proof.baseCommit,
  'historical recovery source, tested tree or base changed');
  same(source.parents, [base.sha, qualified.sha], 'historical recovery ordered merge parents changed');
  record(proof.deployment, ['projectId', 'environmentId', 'serviceId', 'deploymentId', 'finishedAt', 'status'],
    'historical recovery deployment');
  for (const key of ['projectId', 'environmentId', 'serviceId', 'deploymentId'])
    requireThat(typeof proof.deployment[key] === 'string' && /^[a-f0-9-]{36}$/u.test(proof.deployment[key]),
      'historical recovery Railway identity');
  requireThat(proof.deployment.status === 'SUCCESS', 'historical recovery deployment incomplete');
  record(proof.cleanup, ['complete', 'serviceId', 'observedAt'], 'historical recovery cleanup');
  requireThat(proof.cleanup.complete === true && proof.cleanup.serviceId === proof.deployment.serviceId,
    'historical recovery cleanup incomplete');
  historicalTime(proof.deployment.finishedAt, 'historical recovery completion');
  historicalTime(proof.cleanup.observedAt, 'historical recovery cleanup');
  requireThat(Date.parse(proof.cleanup.observedAt) >= Date.parse(proof.deployment.finishedAt),
    'historical recovery cleanup precedes completion');
  record(proof.checks, ['node', 'canary', 'typecheck', 'scorerSelfTests'], 'historical recovery checks');
  for (const label of ['node', 'canary']) {
    const check = proof.checks[label];
    record(check, ['tests', 'pass', 'fail', 'skipped', 'cancelled', 'todo'], 'historical recovery ' + label);
    for (const value of Object.values(check)) integer(value, 'historical qualification count', 0, 1000000);
    requireThat(check.tests > 0 && check.tests === check.pass &&
      ['fail', 'skipped', 'cancelled', 'todo'].every(key => check[key] === 0), 'historical recovery full gate incomplete');
  }
  requireThat(proof.checks.typecheck === 'passed' && proof.checks.scorerSelfTests === 5,
    'historical recovery typecheck/scorer checks incomplete');
  const review = proof.review;
  record(review, ['mode', 'requestedHead', 'request', 'acknowledgement', 'approval', 'resolvedComments', 'nativeReviews'],
    'historical recovery review');
  requireThat(['formal-review', 'dashboard'].includes(review.mode) && review.requestedHead === proof.qualifiedCommit &&
    Array.isArray(review.nativeReviews) && review.nativeReviews.length <= 100 &&
    Array.isArray(review.resolvedComments) && review.resolvedComments.length <= 100,
  'historical recovery qualified review context changed');
  const pin = value => {
    record(value, ['id', 'bodySha256'], 'historical review artifact pin');
    integer(value.id, 'historical review artifact ID', 1); hash(value.bodySha256, 'historical review artifact hash');
  };
  pin(review.request); pin(review.approval);
  requireThat(review.mode !== 'dashboard' || review.acknowledgement !== null, 'historical dashboard lacks acknowledgement');
  if (review.acknowledgement !== null) pin(review.acknowledgement);
  for (const value of review.resolvedComments) {
    record(value, ['id', 'bodySha256', 'commitId', 'fixCommit'], 'historical resolved finding');
    pin({ id: value.id, bodySha256: value.bodySha256 });
    hash(value.commitId, 'historical finding commit', 40); hash(value.fixCommit, 'historical finding fix', 40);
  }
  const reviewIds = new Set();
  for (const value of review.nativeReviews) {
    record(value, ['id', 'commitId', 'state'], 'historical native review');
    integer(value.id, 'historical native review ID', 1); hash(value.commitId, 'historical native review commit', 40);
    requireThat(!reviewIds.has(value.id) && typeof value.state === 'string' && value.state.length > 0 &&
      !(value.commitId === proof.qualifiedCommit && value.state === 'CHANGES_REQUESTED'),
    'historical recovery qualified native review changed'); reviewIds.add(value.id);
  }
  // The original signer fetched all pinned review artifacts and the complete
  // inventory before issuing this fact digest. C validates those immutable
  // facts without claiming that an old recovery release is current main.
}

function verifyQualifiedFacts(facts, status, config) {
  const successor = facts?.schema === FACTS_V2;
  record(facts, ['schema', 'descriptor', 'qualificationReceipt', 'source', 'qualified', 'base',
    'historicalQualificationDigest', 'historicalAuthorizationDigest', ...(successor ? ['predecessor'] : [])],
  'historical recovery qualified facts');
  const q = status.qualificationEnvelope.body, historical = status.historicalImplementationStatus;
  requireThat((facts.schema === FACTS_V1 || successor) && digest(facts) === q.qualificationEvidenceDigest &&
    facts.historicalQualificationDigest === digest(historical.qualificationEnvelope) &&
    facts.historicalAuthorizationDigest === digest(historical.authorizationEnvelope),
  'historical recovery facts differ from the independently signed qualification');
  const d = facts.descriptor, proof = facts.qualificationReceipt;
  record(d, ['schema', 'sourceProof', 'gatePolicy'], 'historical recovery source descriptor');
  requireThat(d.schema === 'gk-learning-proposal-observation-source-proof-v1', 'historical recovery outer descriptor changed');
  const owner = historical.qualificationEnvelope.body.qualification;
  verifyQualificationLeg({ descriptor: d.sourceProof, gatePolicy: d.gatePolicy, proof,
    source: facts.source, qualified: facts.qualified, base: facts.base, config, owner, successor });
  requireThat(facts.source.sha === q.implementationCommit && facts.source.tree === q.implementationTree &&
    proof.rawLogsDigest === q.rawLogsDigest && proof.deployment.deploymentId === q.runId,
  'historical recovery execution receipt changed');
  same(d.sourceProof.qualification, q.qualification, 'historical recovery owner qualification pin changed');
  let anchor = facts.base;
  if (successor) {
    const previous = d.sourceProof.previous, prior = facts.predecessor;
    record(previous, ['schema', 'sourceProof', 'gatePolicy'], 'historical qualified predecessor descriptor');
    requireThat(previous.schema === 'gk-learning-proposal-observation-source-proof-v1' &&
      previous.sourceProof?.schema === GATE_V1, 'historical successor requires exactly one v1 predecessor');
    record(prior, ['descriptor', 'qualificationReceipt', 'source', 'qualified', 'base'], 'historical predecessor facts');
    same(prior.descriptor, previous.sourceProof, 'historical predecessor descriptor changed');
    verifyQualificationLeg({ descriptor: prior.descriptor, gatePolicy: previous.gatePolicy, proof: prior.qualificationReceipt,
      source: prior.source, qualified: prior.qualified, base: prior.base, config, owner, successor: false });
    same(facts.base, prior.source, 'historical successor first parent is not the exact qualified predecessor');
    requireThat(prior.source.sha !== facts.source.sha &&
      prior.qualificationReceipt.pullRequest !== proof.pullRequest &&
      prior.qualificationReceipt.deployment.deploymentId !== proof.deployment.deploymentId,
    'historical successor reuses a predecessor source or qualification');
    anchor = prior.base;
  }
  requireThat(anchor.sha === q.historicalImplementationCommit &&
    anchor.tree === historical.qualificationEnvelope.body.implementationTree,
  'historical recovery chain changed the exact historical B anchor');
}

function retainedQualificationComment(raw, descriptor, proof) {
  const comment = raw.ownerComment, pin = descriptor.qualification;
  requireThat(comment?.id === pin.commentId && comment.user?.id === pin.authorId &&
    comment.user.login === pin.authorLogin && typeof comment.body === 'string' && bytesSha(comment.body) === pin.bodySha256 &&
    comment.body.startsWith(QUALIFICATION_PREFIX) && comment.issue_url === ROOT + '/issues/' + proof.pullRequest,
  'retained recovery qualification owner or exact artifact changed');
  same(raw.descriptor, descriptor, 'retained recovery qualification descriptor changed');
  same(JSON.parse(comment.body.slice(QUALIFICATION_PREFIX.length)), proof, 'retained recovery qualification receipt changed');
  const createdAt = historicalTime(comment.created_at, 'historical recovery owner qualification time');
  requireThat(createdAt >= Date.parse(proof.cleanup.observedAt), 'historical recovery qualification predates actual cleanup');
  return createdAt;
}

/** Synchronous capsule validation authenticates original D receipts. Capture
 * separately proves the records against both actual read-only journals. */
export function historicalProposalObservation(capsule, { binding, trust, config, historical }) {
  const value = capsule.proposalObservation;
  record(value, ['qualification', 'preparation', 'authorization', 'qualificationFacts', 'provenance'], 'historical D observation');
  const status = verifyProposalObservationStatus({ schema: PROPOSAL_OBSERVATION_STATUS,
    historicalImplementationStatus: { qualificationEnvelope: historical.qualificationEnvelope,
      authorizationEnvelope: historical.authorizationEnvelope },
    qualificationEnvelope: serialized(value.qualification, 'historical D qualification'),
    preparationEnvelope: serialized(value.preparation, 'one original fourth signed preparation'),
    authorizationEnvelope: serialized(value.authorization, 'historical D authorization') }, {
    binding, trust, implementationCommit: capsule.finalExecutionSourceCommit,
    requireAuthorization: true, requireRemainder: true });
  verifyQualifiedFacts(value.qualificationFacts, status, config);
  const p = value.provenance, prepared = status.preparationEnvelope.body;
  record(p, ['head', 'events', 'stateDigest', 'lastEventAt', 'authorityPrefix', 'checkpointDigest'], 'historical D custody provenance');
  record(p.authorityPrefix, ['head', 'events', 'stateDigest'], 'original settled authority prefix');
  for (const key of ['head', 'stateDigest', 'checkpointDigest']) hash(p[key], 'D ' + key);
  requireThat(p.events === 3 && p.authorityPrefix.head === prepared.authorityHead &&
    p.authorityPrefix.stateDigest === prepared.authorityStateDigest && p.checkpointDigest === prepared.retained.hostPacketDigest,
  'historical D journal/prefix/checkpoint binding changed');
  integer(p.authorityPrefix.events, 'original authority prefix length', 1, 100000);
  isoTime(p.lastEventAt, 'D final authorization time'); isoTime(prepared.preparedAt, 'original fourth observation time');
  requireThat(Date.parse(p.lastEventAt) >= Date.parse(prepared.preparedAt) &&
    originalProposalIsInvalid(prepared.observed.text, config.scope) &&
    prepared.observed.modelDigest === digest(capsule.frozen.runtime.model),
  'historical D observation time, whole-output invalidity or model differs');
  return { status, recovery: copy(COMPLETED_RECOVERY) };
}

async function ledgerAt(snapshot, binding, count = snapshot.events.length) {
  const head = observationPrefixHead(snapshot, count);
  return new AuthorityLedger({ journal: readOnly({ head, events: snapshot.events.slice(0, count) }),
    binding, initial: null }).read();
}

/** Pure retained-data projection. The caller supplies only read snapshots and
 * a bounded content-addressed artifact reader; no keys or provider capability. */
export async function projectCompletedObservation({ bundle, originalSnapshot, originalState,
  observationSnapshot, observationState, getArtifact, historical }) {
  observationPrefixHead(originalSnapshot); observationPrefixHead(observationSnapshot);
  requireThat(observationSnapshot.events.length === 3, 'D custody must contain exactly qualification, preparation and authorization');
  const saved = observationState;
  record(saved, ['schema', 'binding', 'qualificationEvidence', 'qualification', 'preparation', 'checkpoint',
    'authorization', 'ownerEvidence'], 'retained D authority state');
  requireThat(saved.schema === 'gk-learning-proposal-observation-authority-v1' && saved.preparation && saved.authorization &&
    saved.checkpoint && saved.ownerEvidence, 'D retained proof is incomplete');
  same(saved.binding, bundle.binding, 'D authority changed frozen A');
  const expectedKinds = ['initialized', 'original-fourth-observed-without-dispatch', 'original-fourth-observation-owner-authorized'];
  let lastTime = -Infinity;
  for (let index = 0; index < 3; index++) {
    const event = observationSnapshot.events[index];
    requireThat(event.kind === expectedKinds[index], 'unexpected D authority transition');
    isoTime(event.recordedAt, 'D authority event time');
    requireThat(Date.parse(event.recordedAt) >= lastTime, 'D authority time reversed'); lastTime = Date.parse(event.recordedAt);
    const expected = copy(saved);
    if (index < 2) { expected.authorization = null; expected.ownerEvidence = null; }
    if (index < 1) { expected.preparation = null; expected.checkpoint = null; }
    same(await ledgerAt(observationSnapshot, bundle.binding, index + 1), expected,
      'D proof namespace changed more than its exact permitted immutable steps');
  }
  const prepared = JSON.parse(saved.preparation).body;
  let prefixCount = 0, head = null;
  for (const [index, event] of originalSnapshot.events.entries()) {
    head = digest({ schema: 'gk-learning-v2-journal-record-v1', sequence: index + 1, previousHead: head, event });
    if (head === prepared.authorityHead) prefixCount = index + 1;
  }
  requireThat(prefixCount > 0, 'D preparation references no original authority prefix');
  const prefix = await ledgerAt(originalSnapshot, bundle.binding, prefixCount);
  same(prefix.binding, bundle.binding, 'original settled authority prefix changed frozen binding');
  requireThat(digest(prefix) === prepared.authorityStateDigest && prefix.activeCallId === null &&
    prefix.operations.length === 5 && prefix.attempts.length === 4 && prefix.reviews.length === 0 &&
    prefix.activationHistory.length === 0 && prefix.versions.length === 1 && prefix.baseline && !prefix.baselineError,
  'D preparation did not retain exact genuine settled original-fourth authority state');
  same(prefix.implementation, originalState.implementation, 'historical B implementation objects changed after D');
  same(prefix.operations, originalState.operations.slice(0, 5), 'D remainder replaced original BASE or first four authority operations');
  same(prefix.attempts, originalState.attempts.slice(0, 4), 'D remainder replaced original four invalid authority attempts');
  const checked = validateOriginalProposalPacket(saved.checkpoint, { binding: bundle.binding, runtime: bundle.runtime });
  same(prepared.retained, checked.retained, 'D retained original host checkpoint changed');
  verifyOriginalProposalReceipts(checked.packet, prepared, bundle.trust);
  same(checked.packet.dispatch.entries[0].baselineContinuation, continuationLink(historical.authorizationEnvelope,
    historical.qualificationEnvelope), 'D checkpoint replaced original B BASE link');
  same(prefix.baseline, checked.packet.state.baseline, 'D original BASE differs across custody');
  same(prefix.baseVersion, checked.packet.state.baseVersion, 'D original BASE version differs');
  same(prefix.versions, checked.packet.state.versions, 'D original version history differs');
  for (const [index, operation] of prefix.operations.entries()) {
    const held = checked.packet.state.operations[index], entry = checked.packet.dispatch.entries[index];
    requireThat(operation.id === held.id && operation.leaseId === held.leaseId && operation.requestDigest === held.requestDigest &&
      operation.lease === entry.admission && operation.settlement !== null && !operation.reconciliation &&
      operation.calls.length === (index === 0 ? 14 : 1) && operation.actualCalls === (index === 0 ? 14 : 1) &&
      operation.maxCalls === (index === 0 ? 14 : 1) && (index === 4 || operation.settlement === entry.settlement),
    'D original operation/lease/request/receipt sets differ');
    if (index === 0) requireThat(operation.complete && operation.kind === 'baseline', 'D original BASE incomplete');
    else requireThat(operation.kind === 'proposal' && operation.attemptId === prefix.attempts[index - 1].id &&
      prefix.attempts[index - 1].number === index && prefix.attempts[index - 1].status === 'invalid' &&
      prefix.attempts[index - 1].candidate === null && operation.evaluations.length === 0,
    'D preparation prefix contains a different original proposal');
  }
  const fourth = prefix.operations[4], owned = fourth.calls[0];
  requireThat(digest(fourth) === prepared.authorityOperationDigest && fourth.lease === prepared.admissionSerialized &&
    fourth.settlement === prepared.settlementSerialized && owned.evidenceDigest === prepared.authorityEvidenceDigest &&
    owned.stage === 'turn-created' && owned.relay?.status === 'complete' &&
    ['callId', 'sessionId', 'turnId'].every(key => owned[key] === prepared.retained[key]),
  'D observation changed original B settlement or owned call');
  const plan = await getArtifact(fourth.planDigest);
  requireThat(digest(plan) === fourth.planDigest, 'original fourth authority plan content address changed');
  same(plan.operation, checked.packet.dispatch.entries[4].operation, 'original fourth authority operation changed');
  same(plan.request, checked.request, 'original fourth authority request changed');
  same(plan.slots, [{ kind: 'proposal' }], 'original fourth authority schedule changed');
  const intent = await getArtifact(owned.intentDigest), observed = await getArtifact(owned.evidenceDigest);
  same(intent, { callId: checked.retained.callId, slot: { kind: 'proposal' }, inputDigest: checked.retained.inputDigest,
    sessionRequest: { agent: { spec: { model: bundle.runtime.model, instructions: checked.call.instructions, config: TURN_CONFIG } },
      metadata: { purpose: 'gk-learning-v2', callId: checked.retained.callId, operationId: fourth.id, requestDigest: fourth.requestDigest } },
    turnRequest: { input: [{ type: 'user.message', content: checked.call.message }], previousTurnId: 'none' } },
  'D original provider intent changed');
  requireThat(digest(intent) === owned.intentDigest && digest(observed) === owned.evidenceDigest,
    'D original content-addressed evidence changed');
  same(prepared.observed, { callId: observed.callId, sessionId: observed.sessionId, turnId: observed.turnId,
    inputDigest: observed.inputDigest, outputDigest: observed.outputDigest, text: observed.text, complete: observed.complete,
    finishReason: observed.finishReason, observedModelCalls: observed.observedModelCalls,
    modelDigest: digest(bundle.runtime.model), classification: 'invalid' }, 'D signed observation differs from original B evidence');
  const facts = qualifiedFacts(saved.qualificationEvidence, historical);
  const projection = { qualification: saved.qualification, preparation: saved.preparation, authorization: saved.authorization,
    qualificationFacts: facts, provenance: { head: observationSnapshot.head, events: 3, stateDigest: digest(saved),
      lastEventAt: observationSnapshot.events[2].recordedAt,
      authorityPrefix: { head: prepared.authorityHead, events: prefixCount, stateDigest: prepared.authorityStateDigest },
      checkpointDigest: digest(saved.checkpoint) } };
  const checkedD = historicalProposalObservation({ proposalObservation: projection,
    finalExecutionSourceCommit: JSON.parse(saved.qualification).body.implementationCommit, frozen: { runtime: bundle.runtime } },
  { binding: bundle.binding, trust: bundle.trust, config: bundle.config, historical });
  const q = checkedD.status.qualificationEnvelope.body, auth = checkedD.status.authorizationEnvelope.body;
  const evidence = saved.qualificationEvidence;
  requireThat(evidence.qualificationEvidenceDigest === digest(facts) && evidence.implementationCommit === q.implementationCommit &&
    evidence.implementationTree === q.implementationTree && evidence.runId === q.runId && evidence.rawLogsDigest === q.rawLogsDigest,
  'retained D authenticated source evidence changed');
  same(evidence.qualification, q.qualification, 'D stored qualification pin changed');
  const qualificationAt = retainedQualificationComment(evidence.evidence, facts.descriptor.sourceProof, facts.qualificationReceipt);
  requireThat(evidence.evidence.observedMain === q.implementationCommit &&
    Date.parse(observationSnapshot.events[0].recordedAt) >= qualificationAt,
  'historical recovery qualification does not precede its installation on actual main');
  if (facts.schema === FACTS_V2) {
    const prior = evidence.evidence.predecessor;
    const predecessorAt = retainedQualificationComment(prior, facts.predecessor.descriptor, facts.predecessor.qualificationReceipt);
    requireThat(prior.observedMain === q.implementationCommit && predecessorAt <= qualificationAt,
      'historical successor predecessor qualification chronology or observed main differs');
  }
  const owner = saved.ownerEvidence, ownerComment = owner.comment;
  requireThat(digest(owner) === auth.ownerAuthorizationDigest && ownerComment.id === auth.ownerAuthorization.commentId &&
    bytesSha(ownerComment.body) === auth.ownerAuthorization.bodySha256 && ownerComment.user?.id === q.qualification.authorId &&
    ownerComment.user.login === q.qualification.authorLogin && ownerComment.body.startsWith(OWNER_PREFIX) &&
    ownerComment.issue_url === ROOT + '/issues/' + facts.qualificationReceipt.pullRequest,
  'retained D owner authorization is not the original authenticated evidence');
  same(owner.descriptor, auth.ownerAuthorization, 'D owner pin changed');
  same(owner.authorization, JSON.parse(ownerComment.body.slice(OWNER_PREFIX.length)), 'D owner body changed');
  same(owner.authorization, { schema: 'gk-learning-owner-proposal-observation-v1', purpose: PROPOSAL_OBSERVATION_PURPOSE,
    experimentSourceCommit: bundle.binding.sourceCommit, historicalImplementationCommit: q.historicalImplementationCommit,
    implementationCommit: q.implementationCommit, implementationTree: q.implementationTree, configDigest: bundle.binding.configDigest,
    qualificationDigest: digest(checkedD.status.qualificationEnvelope), preparedProofDigest: digest(checkedD.status.preparationEnvelope),
    retainedDigest: digest(prepared.retained), settlementDigest: digest(prepared.settlementSerialized), allowRemainingExperiment: true },
  'D owner did not authorize this exact observation and separately invoked remaining experiment');
  historicalTime(ownerComment.created_at, 'historical D owner authorization time');
  requireThat(Date.parse(ownerComment.created_at) >= Date.parse(prepared.preparedAt) &&
    Date.parse(observationSnapshot.events[2].recordedAt) >= Date.parse(ownerComment.created_at) &&
    Date.parse(originalSnapshot.events[prefixCount - 1].recordedAt) <= Date.parse(observationSnapshot.events[0].recordedAt),
  'D historical qualification/observation/owner chronology differs');
  return projection;
}

/** Reuse the exact D read-only cut validator, with journals already opened in
 * readOnly mode. A missing/partial sidecar or changed old failure stays held. */
export async function readCompletedHostObservation({ controllerJournal, dispatchJournal, originalJournal, observationJournal,
  capsule, binding, trust, config, historical }) {
  const checked = historicalProposalObservation(capsule, { binding, trust, config, historical });
  const observed = await readProposalObservation({ controllerJournal, dispatchJournal, originalJournal, observationJournal,
    binding, trust, runtime: capsule.frozen.runtime, implementationCommit: capsule.finalExecutionSourceCommit,
    status: checked.status, allowLater: true });
  requireThat(observed.complete && observed.prefix === '2:3', 'completed profile requires the full original-fourth D consumption cut');
  return observed;
}
