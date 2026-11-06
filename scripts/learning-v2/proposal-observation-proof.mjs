/** Actual D is a separately qualified implementation. Historical B receipts
 * remain original objects; neither a source override nor a replacement B gate
 * authorizes the later read of the original fourth proposal. */
import { createHash } from 'node:crypto';
import { verifyEnvelope } from '../learning-trust.mjs';
import { canonical, copy, digest, hash, identifier, integer, record, requireThat, text } from './contracts.mjs';
import { verifyImplementationStatus } from './implementation-proof.mjs';
import { createProposalObservationGateVerifier } from './proposal-observation-source.mjs';

export const PROPOSAL_OBSERVATION_PURPOSE = 'qualified-original-fourth-invalid-proposal-observation';
export const PROPOSAL_OBSERVATION_STATUS = 'gk-learning-proposal-observation-status-v1';
const ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';
const PREFIX = 'GK_PROPOSAL_OBSERVATION_AUTHORIZATION\n';
const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
const original = value => { canonical(value); return JSON.parse(JSON.stringify(value)); };

export function createProposalObservationSourceVerifier({ descriptor, fetcher = fetch }) {
  // The independently observed full Learning gate is reused as a recipe, not
  // as B's authorization. This verifier checks D's actual source/tree/parents.
  record(descriptor, ['schema', 'sourceProof', 'gatePolicy'], 'D source descriptor');
  requireThat(descriptor.schema === 'gk-learning-proposal-observation-source-proof-v1', 'D source descriptor schema');
  const captured = copy(descriptor);
  const verify = createProposalObservationGateVerifier({ descriptor: captured.sourceProof, fetcher });
  return async input => {
    const historical = verifyImplementationStatus(input.historicalImplementationStatus, {
      binding: input.bundle.binding, trust: input.bundle.trust,
      implementationCommit: input.historicalImplementationStatus.qualificationEnvelope.body.implementationCommit,
      requireAuthorization: true,
    });
    requireThat(input.implementationCommit !== historical.qualificationEnvelope.body.implementationCommit,
      'proposal observation requires actual D distinct from historical B');
    const owner = historical.qualificationEnvelope.body.qualification;
    const pinned = input.originalEvidence?.descriptor?.qualification;
    if (input.originalEvidence) requireThat(pinned && input.originalEvidence.ownerComment?.user?.id === pinned.authorId &&
      input.originalEvidence.ownerComment.user.login === pinned.authorLogin && pinned.authorId === owner.authorId &&
      pinned.authorLogin === owner.authorLogin, 'D authority original owner evidence differs');
    requireThat(captured.sourceProof.qualification.authorId === owner.authorId &&
      captured.sourceProof.qualification.authorLogin === owner.authorLogin,
      'D source owner differs from original B owner');
    hash(input.implementationCommit, 'actual D source commit', 40);
    requireThat(captured.sourceProof.sourceCommit === input.implementationCommit &&
      input.implementationCommit !== input.bundle.binding.sourceCommit, 'D source proof differs from actual platform');
    record(captured.gatePolicy, ['targetId', 'presetDigest', 'outputProfileDigest', 'effectiveTreeDigest'], 'D full gate policy');
    for (const key of ['targetId', 'presetDigest', 'outputProfileDigest']) requireThat(
      captured.gatePolicy[key] === input.bundle.config.gatePolicy[key], 'D qualification weakens original full Learning recipe');
    const result = await verify({ binding: { sourceCommit: input.implementationCommit }, config: { gatePolicy: captured.gatePolicy } });
    requireThat(result.evidence.base.sha === historical.qualificationEnvelope.body.implementationCommit,
      'D qualified merge must retain historical B as its actual first parent');
    // Stable authenticated facts only. Live PR metadata may change when the
    // owner later posts authorization; every invocation still verifies the
    // current source and full review inventory before deriving this projection.
    const commit = value => ({ sha: value.sha, tree: value.tree.sha, parents: value.parents.map(item => item.sha) });
    const qualificationEvidenceDigest = digest({ schema: 'gk-learning-proposal-observation-qualified-facts-v1',
      descriptor: captured, qualificationReceipt: result.evidence.qualification,
      source: commit(result.evidence.source), qualified: commit(result.evidence.qualified), base: commit(result.evidence.base),
      historicalQualificationDigest: digest(historical.qualificationEnvelope),
      historicalAuthorizationDigest: digest(historical.authorizationEnvelope) });
    return { ...result, qualificationEvidenceDigest, implementationCommit: input.implementationCommit, implementationTree: result.evidence.source.tree.sha,
      qualification: copy(captured.sourceProof.qualification), qualificationPullRequest: result.evidence.qualification.pullRequest,
      owner: { id: owner.authorId, login: owner.authorLogin } };
  };
}

function signedBody(value, trust, schema, keys) {
  const signed = original(value);
  record(signed, ['body', 'signature'], 'proposal observation signed envelope');
  const body = verifyEnvelope({ ...trust.evaluation, ...signed });
  record(body, keys, 'proposal observation signed body');
  requireThat(body.schema === schema && body.purpose === PROPOSAL_OBSERVATION_PURPOSE,
    'proposal observation signed purpose');
  identifier(body.receiptId, 'proposal observation receipt');
  return signed;
}

export function verifyProposalObservationQualification(value, { binding, trust, implementationCommit,
  historicalImplementationStatus }) {
  const historicalCommit = historicalImplementationStatus?.qualificationEnvelope?.body?.implementationCommit;
  const historical = verifyImplementationStatus(historicalImplementationStatus, {
    binding, trust, implementationCommit: historicalCommit, requireAuthorization: true });
  const signed = signedBody(value, trust, 'gk-learning-qualified-proposal-observation-v1', [
    'schema', 'receiptId', 'purpose', 'binding', 'implementationCommit', 'implementationTree',
    'historicalImplementationCommit', 'historicalQualificationDigest', 'historicalAuthorizationDigest',
    'qualification', 'qualificationEvidenceDigest', 'runId', 'rawLogsDigest',
  ]);
  const body = signed.body;
  same(body.binding, binding, 'D qualification changed frozen A binding');
  hash(implementationCommit, 'actual D implementation', 40);
  requireThat(body.implementationCommit === implementationCommit && implementationCommit !== binding.sourceCommit &&
    implementationCommit !== historicalCommit && body.historicalImplementationCommit === historicalCommit &&
    body.historicalQualificationDigest === digest(historical.qualificationEnvelope) &&
    body.historicalAuthorizationDigest === digest(historical.authorizationEnvelope),
  'D qualification replaced historical B or actual image');
  hash(body.implementationTree, 'D qualified tree', 40);
  identifier(body.runId, 'D qualification run');
  for (const key of ['qualificationEvidenceDigest', 'rawLogsDigest']) hash(body[key], 'D ' + key);
  record(body.qualification, ['commentId', 'bodySha256', 'authorId', 'authorLogin'], 'D owner qualification pin');
  integer(body.qualification.commentId, 'D qualification comment', 1); hash(body.qualification.bodySha256, 'D qualification bytes');
  requireThat(body.qualification.authorId === historical.qualificationEnvelope.body.qualification.authorId &&
    body.qualification.authorLogin === historical.qualificationEnvelope.body.qualification.authorLogin,
  'D qualification changed original GitHub owner');
  return signed;
}

export function validateProposalObservationRetained(value) {
  record(value, ['operationId', 'attemptId', 'attemptNumber', 'leaseId', 'requestDigest', 'maxCalls', 'additionalCalls',
    'controllerHead', 'controllerCount', 'dispatchHead', 'dispatchCount', 'originalArchiveHead', 'originalArchiveCount',
    'originalArchiveDigest', 'hostPacketDigest', 'controllerStateDigest', 'dispatchDigest',
    'callId', 'callDigest', 'inputDigest', 'sessionId', 'turnId', 'failureDigest'], 'retained original fourth proposal');
  requireThat(value.attemptNumber === 4 && value.maxCalls === 1 && value.additionalCalls === 0 && value.originalArchiveCount === 5,
    'observation is limited to original fourth one-call proposal with zero new calls');
  for (const key of ['controllerCount', 'dispatchCount']) integer(value[key], 'retained ' + key, 1, 100000);
  for (const key of ['operationId', 'attemptId', 'leaseId', 'callId', 'sessionId', 'turnId']) identifier(value[key], 'retained ' + key);
  for (const key of ['requestDigest', 'controllerHead', 'dispatchHead', 'originalArchiveHead', 'originalArchiveDigest',
    'hostPacketDigest', 'controllerStateDigest', 'dispatchDigest', 'callDigest', 'inputDigest', 'failureDigest']) hash(value[key], 'retained ' + key);
  return copy(value);
}

export function verifyProposalObservationPreparation(value, options) {
  const qualified = verifyProposalObservationQualification(options.qualificationEnvelope, options);
  const signed = signedBody(value, options.trust, 'gk-learning-proposal-observation-prepared-v1', [
    'schema', 'receiptId', 'purpose', 'binding', 'implementationCommit', 'qualificationDigest',
    'retained', 'authorityHead', 'authorityStateDigest', 'authorityOperationDigest', 'authorityEvidenceDigest',
    'admissionSerialized', 'settlementSerialized', 'observed', 'preparedAt',
  ]);
  const body = signed.body;
  same(body.binding, options.binding, 'observed proposal changed frozen A binding');
  requireThat(body.implementationCommit === options.implementationCommit && body.qualificationDigest === digest(qualified) &&
    Number.isFinite(Date.parse(body.preparedAt)), 'observed proposal actual D qualification');
  validateProposalObservationRetained(body.retained);
  if (options.retained) same(body.retained, options.retained, 'observed proposal differs from exact original host checkpoint');
  for (const key of ['authorityHead', 'authorityStateDigest', 'authorityOperationDigest', 'authorityEvidenceDigest'])
    hash(body[key], 'observed proposal ' + key);
  for (const key of ['admissionSerialized', 'settlementSerialized']) requireThat(typeof body[key] === 'string' &&
    Buffer.byteLength(body[key]) > 0 && Buffer.byteLength(body[key]) <= 16384, 'original proposal receipt string');
  record(body.observed, ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest', 'text',
    'complete', 'finishReason', 'observedModelCalls', 'modelDigest', 'classification'], 'later original-turn observation');
  const observed = body.observed, retained = body.retained;
  for (const key of ['callId', 'sessionId', 'turnId', 'inputDigest']) requireThat(observed[key] === retained[key],
    'later observation does not belong to original fourth call');
  requireThat(observed.complete === true && observed.finishReason === 'stop' && observed.observedModelCalls === 1 &&
    observed.classification === 'invalid' && typeof observed.text === 'string' && observed.text.trim().length > 0 &&
    Buffer.byteLength(observed.text) <= 1024 * 1024 &&
    createHash('sha256').update(observed.text).digest('hex') === observed.outputDigest,
  'later observation is not a complete original invalid result');
  hash(observed.outputDigest, 'observed original output'); hash(observed.modelDigest, 'observed original model');
  return signed;
}

export function verifyProposalObservationAuthorization(value, options) {
  const qualification = verifyProposalObservationQualification(options.qualificationEnvelope, options);
  const prepared = verifyProposalObservationPreparation(options.preparationEnvelope, options);
  const signed = signedBody(value, options.trust, 'gk-learning-proposal-observation-authorized-v1', [
    'schema', 'receiptId', 'purpose', 'binding', 'implementationCommit', 'implementationTree',
    'qualificationDigest', 'preparedProofDigest', 'retainedDigest', 'settlementDigest', 'ownerAuthorization',
    'ownerAuthorizationDigest', 'allowRemainingExperiment',
  ]);
  const body = signed.body;
  same(body.binding, options.binding, 'observation owner authorization changed frozen A');
  requireThat(body.implementationCommit === options.implementationCommit &&
    body.implementationTree === qualification.body.implementationTree &&
    body.qualificationDigest === digest(qualification) && body.preparedProofDigest === digest(prepared) &&
    body.retainedDigest === digest(prepared.body.retained) && body.settlementDigest === digest(prepared.body.settlementSerialized) &&
    typeof body.allowRemainingExperiment === 'boolean', 'observation authorization differs from original proof/settlement');
  record(body.ownerAuthorization, ['commentId', 'bodySha256'], 'observation owner pin');
  integer(body.ownerAuthorization.commentId, 'observation owner comment', 1);
  hash(body.ownerAuthorization.bodySha256, 'observation owner bytes'); hash(body.ownerAuthorizationDigest, 'observation owner evidence');
  return signed;
}

export function verifyProposalObservationStatus(value, { binding, trust, implementationCommit,
  requireAuthorization = false, requireRemainder = false } = {}) {
  record(value, ['schema', 'historicalImplementationStatus', 'qualificationEnvelope', 'preparationEnvelope', 'authorizationEnvelope'],
    'D observation implementation status');
  requireThat(value.schema === PROPOSAL_OBSERVATION_STATUS, 'D observation status schema');
  const historical = value.historicalImplementationStatus;
  const historicalImplementationStatus = verifyImplementationStatus(historical, { binding, trust,
    implementationCommit: historical?.qualificationEnvelope?.body?.implementationCommit, requireAuthorization: true });
  const options = { binding, trust, implementationCommit, historicalImplementationStatus,
    qualificationEnvelope: value.qualificationEnvelope, preparationEnvelope: value.preparationEnvelope };
  const qualificationEnvelope = verifyProposalObservationQualification(value.qualificationEnvelope, options);
  const preparationEnvelope = value.preparationEnvelope === null ? null : verifyProposalObservationPreparation(value.preparationEnvelope, options);
  const authorizationEnvelope = value.authorizationEnvelope === null ? null : verifyProposalObservationAuthorization(value.authorizationEnvelope, options);
  requireThat(!requireAuthorization || authorizationEnvelope !== null,
    'qualified D permits status/prepare only before owner authorization');
  requireThat(!requireRemainder || authorizationEnvelope?.body.allowRemainingExperiment === true,
    'D observation does not authorize remaining experiment execution');
  return { schema: PROPOSAL_OBSERVATION_STATUS, historicalImplementationStatus,
    qualificationEnvelope, preparationEnvelope, authorizationEnvelope };
}

/** A public owner pin binds digests. Full private call/failure/output evidence
 * remains in the independently signed protected preparation, never the comment. */
export async function verifyProposalObservationOwner({ descriptor, qualificationEvidence,
  status, bundle, fetcher = fetch }) {
  record(descriptor, ['commentId', 'bodySha256'], 'proposal observation owner descriptor');
  integer(descriptor.commentId, 'proposal observation owner comment', 1); hash(descriptor.bodySha256, 'proposal observation owner hash');
  const checked = verifyProposalObservationStatus(status, { binding: bundle.binding, trust: bundle.trust,
    implementationCommit: status.qualificationEnvelope.body.implementationCommit });
  requireThat(checked.preparationEnvelope, 'actual nondispatching observation must precede owner authorization');
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 30000);
  try {
    const response = await fetcher(ROOT + '/issues/comments/' + descriptor.commentId, { redirect: 'error', signal: abort.signal,
      headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    requireThat(response.ok && response.body, 'proposal observation owner evidence unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) { size += chunk.byteLength; requireThat(size <= 1024 * 1024, 'observation owner byte bound'); chunks.push(Buffer.from(chunk)); }
    const comment = JSON.parse(Buffer.concat(chunks).toString('utf8')), owner = qualificationEvidence.owner;
    requireThat(comment.id === descriptor.commentId && comment.user?.id === owner.id && comment.user.login === owner.login &&
      typeof comment.body === 'string' && createHash('sha256').update(comment.body).digest('hex') === descriptor.bodySha256 &&
      comment.body.startsWith(PREFIX) && comment.issue_url === ROOT + '/issues/' + qualificationEvidence.qualificationPullRequest,
    'proposal observation owner, bytes or D PR changed');
    const value = JSON.parse(comment.body.slice(PREFIX.length));
    record(value, ['schema', 'purpose', 'experimentSourceCommit', 'historicalImplementationCommit', 'implementationCommit',
      'implementationTree', 'configDigest', 'qualificationDigest', 'preparedProofDigest', 'retainedDigest', 'settlementDigest',
      'allowRemainingExperiment'], 'owner proposal observation authorization');
    const qualified = checked.qualificationEnvelope, prepared = checked.preparationEnvelope;
    requireThat(typeof value.allowRemainingExperiment === 'boolean', 'explicit D remainder authorization required');
    same(value, { schema: 'gk-learning-owner-proposal-observation-v1', purpose: PROPOSAL_OBSERVATION_PURPOSE,
      experimentSourceCommit: bundle.binding.sourceCommit, historicalImplementationCommit: qualified.body.historicalImplementationCommit,
      implementationCommit: qualified.body.implementationCommit, implementationTree: qualified.body.implementationTree,
      configDigest: bundle.binding.configDigest, qualificationDigest: digest(qualified), preparedProofDigest: digest(prepared),
      retainedDigest: digest(prepared.body.retained), settlementDigest: digest(prepared.body.settlementSerialized),
      allowRemainingExperiment: value.allowRemainingExperiment }, 'owner changed original proposal recovery or actual D');
    requireThat(Number.isFinite(Date.parse(comment.created_at)) && Date.parse(comment.created_at) >= Date.parse(prepared.body.preparedAt),
      'owner authorization precedes actual independent observation');
    return { descriptor: copy(descriptor), authorization: copy(value), comment };
  } finally { clearTimeout(timer); }
}
