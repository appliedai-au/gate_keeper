/** Separate qualified platform implementation B from the frozen experiment A.
 * A new image never changes an experiment bundle, its gate or any trust pin.
 * Qualification alone grants read/prepare access; a separately retrieved owner
 * authorization is required before continuing the one retained BASE operation.
 */
import { createHash } from 'node:crypto';
import { verifyEnvelope } from '../learning-trust.mjs';
import { canonical, copy, digest, hash, integer, record, requireThat } from './contracts.mjs';
import { createSourceGateVerifier } from './authority-source-proof.mjs';

export const CONTINUATION_PURPOSE = 'qualified-turn-pagination-repair-original-base';
const ROOT = 'https://api.github.com/repos/appliedai-au/gate_keeper';
const PREFIX = 'GK_BASE_CONTINUATION_AUTHORIZATION\n';
const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
const original = value => { canonical(value); return JSON.parse(JSON.stringify(value)); };

export function createImplementationSourceVerifier({ descriptor: supplied, fetcher = fetch }) {
  record(supplied, ['schema', 'sourceProof', 'gatePolicy'], 'implementation source descriptor');
  const descriptor = copy(supplied);
  requireThat(descriptor.schema === 'gk-learning-implementation-source-proof-v1', 'implementation proof schema');
  const verify = createSourceGateVerifier({ descriptor: descriptor.sourceProof, fetcher });
  return async ({ bundle, originalEvidence, implementationCommit }) => {
    hash(implementationCommit, 'actual implementation commit', 40);
    requireThat(implementationCommit !== bundle.binding.sourceCommit &&
      descriptor.sourceProof.sourceCommit === implementationCommit,
    'implementation qualification must name the actual different image');
    const pinnedOwner = originalEvidence?.descriptor?.qualification;
    requireThat(pinnedOwner && originalEvidence.ownerComment?.user?.id === pinnedOwner.authorId &&
      originalEvidence.ownerComment.user.login === pinnedOwner.authorLogin,
    'original authenticated qualification owner absent');
    const owner = descriptor.sourceProof.qualification;
    requireThat(owner.authorId === pinnedOwner.authorId && owner.authorLogin === pinnedOwner.authorLogin,
      'implementation qualification owner differs from original source authority');
    record(descriptor.gatePolicy, ['targetId', 'presetDigest', 'outputProfileDigest', 'effectiveTreeDigest'],
      'implementation gate policy');
    for (const key of ['targetId', 'presetDigest', 'outputProfileDigest']) requireThat(
      descriptor.gatePolicy[key] === bundle.config.gatePolicy[key], 'implementation qualification weakens original gate');
    // This is an explicit source-proof view, never an experiment bundle. The
    // verifier independently checks B's current main, ordered parents and tree.
    const result = await verify({ binding: { sourceCommit: implementationCommit },
      config: { gatePolicy: descriptor.gatePolicy } });
    return { ...result, implementationCommit, implementationTree: result.evidence.source.tree.sha,
      qualification: copy(owner), qualificationPullRequest: result.evidence.qualification.pullRequest,
      owner: { id: pinnedOwner.authorId, login: pinnedOwner.authorLogin } };
  };
}

/** The operator pins an immutable, authenticated owner comment on B's PR.
 * The driver cannot write this decision through its ordinary RPC credential. */
export async function verifyOwnerContinuationAuthorization({ descriptor, preparedEnvelope,
  qualificationEnvelope, qualificationEvidence, bundle, fetcher = fetch }) {
  record(descriptor, ['commentId', 'bodySha256'], 'owner continuation authorization pin');
  integer(descriptor.commentId, 'owner authorization comment', 1);
  hash(descriptor.bodySha256, 'owner authorization body hash');
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetcher(ROOT + '/issues/comments/' + descriptor.commentId,
      { redirect: 'error', signal: controller.signal,
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } });
    requireThat(response.ok && response.body, 'owner continuation authorization unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength; requireThat(size <= 1024 * 1024, 'owner authorization size');
      chunks.push(Buffer.from(chunk));
    }
    const comment = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const owner = qualificationEvidence.owner;
    requireThat(comment.id === descriptor.commentId && comment.user?.id === owner.id &&
      comment.user.login === owner.login && typeof comment.body === 'string' &&
      createHash('sha256').update(comment.body).digest('hex') === descriptor.bodySha256 &&
      comment.body.startsWith(PREFIX) &&
      comment.issue_url === ROOT + '/issues/' + qualificationEvidence.qualificationPullRequest,
    'continuation authorization owner, bytes or PR changed');
    const value = JSON.parse(comment.body.slice(PREFIX.length));
    record(value, ['schema', 'purpose', 'binding', 'implementationCommit', 'implementationTree',
      'qualificationDigest', 'preparedProofDigest', 'retainedDigest', 'allowCorrectedReaderRemainder'],
    'owner BASE continuation authorization');
    requireThat(value.schema === 'gk-learning-owner-base-continuation-v1' &&
      value.purpose === CONTINUATION_PURPOSE && value.allowCorrectedReaderRemainder === true,
    'owner did not authorize this continuation and corrected-reader experiment remainder');
    same(value.binding, bundle.binding, 'owner authorization changed frozen experiment');
    const qualified = qualificationEnvelope.body;
    requireThat(value.implementationCommit === qualified.implementationCommit &&
      value.implementationTree === qualified.implementationTree &&
      value.qualificationDigest === digest(qualificationEnvelope) &&
      value.preparedProofDigest === digest(preparedEnvelope), 'owner authorization substitutes implementation or proof');
    requireThat(value.retainedDigest === digest(preparedEnvelope.body.retained),
      'owner authorization changed original retained state');
    requireThat(Number.isFinite(Date.parse(comment.created_at)) &&
      Date.parse(comment.created_at) >= Date.parse(preparedEnvelope.body.preparedAt),
    'owner authorization must follow the actual nondispatching prepare');
    return { descriptor: copy(descriptor), authorization: copy(value), comment };
  } finally { clearTimeout(timer); }
}

export function verifyImplementationQualification(value, { binding, trust, implementationCommit }) {
  const signed = original(value);
  record(signed, ['body', 'signature'], 'qualified implementation envelope');
  const body = verifyEnvelope({ ...trust.evaluation, ...signed });
  record(body, ['schema', 'receiptId', 'purpose', 'binding', 'implementationCommit', 'implementationTree',
    'qualification', 'qualificationEvidenceDigest', 'runId', 'rawLogsDigest'], 'qualified implementation receipt');
  requireThat(body.schema === 'gk-learning-v2-qualified-implementation' &&
    body.purpose === CONTINUATION_PURPOSE, 'qualified implementation receipt purpose');
  same(body.binding, binding, 'qualified implementation changed frozen binding');
  hash(implementationCommit, 'actual platform implementation commit', 40);
  requireThat(body.implementationCommit === implementationCommit && implementationCommit !== binding.sourceCommit,
    'qualified implementation differs from actual platform image');
  hash(body.implementationTree, 'qualified implementation tree', 40);
  hash(body.qualificationEvidenceDigest, 'qualified implementation evidence');
  hash(body.rawLogsDigest, 'qualified implementation raw logs');
  record(body.qualification, ['commentId', 'bodySha256', 'authorId', 'authorLogin'], 'qualified implementation owner pin');
  integer(body.qualification.commentId, 'qualified implementation comment', 1);
  integer(body.qualification.authorId, 'qualified implementation owner', 1);
  hash(body.qualification.bodySha256, 'qualified implementation owner bytes');
  return signed;
}

export function verifyContinuationAuthorization(value, { binding, trust, implementationCommit, qualificationEnvelope }) {
  const qualification = verifyImplementationQualification(qualificationEnvelope, { binding, trust, implementationCommit });
  const signed = original(value);
  record(signed, ['body', 'signature'], 'BASE continuation authorization envelope');
  const body = verifyEnvelope({ ...trust.evaluation, ...signed });
  record(body, ['schema', 'receiptId', 'purpose', 'binding', 'implementationCommit', 'implementationTree',
    'qualificationDigest', 'ownerAuthorizationDigest', 'ownerAuthorization', 'preparedProofDigest',
    'retained', 'authorityPreparedHead', 'authorityOperationDigest', 'originalAuthorityCalls',
    'secondIntentAbsent', 'allowCorrectedReaderRemainder'], 'BASE continuation authorization');
  requireThat(body.schema === 'gk-learning-v2-baseline-continuation' && body.purpose === CONTINUATION_PURPOSE &&
    body.originalAuthorityCalls === 1 && body.secondIntentAbsent === true &&
    body.allowCorrectedReaderRemainder === true, 'BASE continuation authorization scope');
  same(body.binding, binding, 'BASE continuation frozen binding');
  requireThat(body.implementationCommit === implementationCommit &&
    body.implementationTree === qualification.body.implementationTree &&
    body.qualificationDigest === digest(qualification), 'BASE continuation implementation qualification differs');
  for (const key of ['ownerAuthorizationDigest', 'preparedProofDigest', 'authorityPreparedHead', 'authorityOperationDigest']) {
    hash(body[key], 'BASE continuation ' + key);
  }
  record(body.ownerAuthorization, ['commentId', 'bodySha256'], 'retained owner authorization pin');
  integer(body.ownerAuthorization.commentId, 'retained owner authorization comment', 1);
  hash(body.ownerAuthorization.bodySha256, 'retained owner authorization bytes');
  validateContinuationRetained(body.retained);
  return signed;
}

export function verifyPreparedContinuation(value, { binding, trust, implementationCommit, qualificationEnvelope, retained }) {
  const qualification = verifyImplementationQualification(qualificationEnvelope, { binding, trust, implementationCommit });
  const signed = original(value);
  record(signed, ['body', 'signature'], 'prepared BASE continuation envelope');
  const body = verifyEnvelope({ ...trust.evaluation, ...signed });
  record(body, ['schema', 'receiptId', 'purpose', 'binding', 'implementationCommit', 'qualificationDigest',
    'retained', 'authorityPreparedHead', 'authorityOperationDigest', 'originalAuthorityCalls',
    'secondIntentAbsent', 'preparedAt'], 'prepared BASE continuation proof');
  requireThat(body.schema === 'gk-learning-v2-baseline-continuation-prepared' && body.purpose === CONTINUATION_PURPOSE &&
    body.implementationCommit === implementationCommit && body.qualificationDigest === digest(qualification) &&
    body.originalAuthorityCalls === 1 && body.secondIntentAbsent === true && Number.isFinite(Date.parse(body.preparedAt)),
  'independent BASE preparation identity or absence proof differs');
  same(body.binding, binding, 'prepared BASE frozen binding');
  validateContinuationRetained(body.retained);
  same(body.retained, retained, 'prepared BASE proof differs from actual original host checkpoint');
  hash(body.authorityPreparedHead, 'prepared authority journal head');
  hash(body.authorityOperationDigest, 'prepared authority operation');
  return signed;
}

export function validateContinuationRetained(value) {
  record(value, ['operationId', 'leaseId', 'requestDigest', 'maxCalls', 'remainingCalls',
    'controllerHead', 'dispatchHead', 'originalArchiveHead', 'originalArchiveDigest', 'hostPacketDigest',
    'firstCallId', 'firstResultDigest', 'firstInputDigest', 'firstOutputDigest', 'sessionId', 'turnId',
    'secondCallId', 'secondFailureDigest'], 'original BASE retained identities');
  requireThat(value.maxCalls === 14 && value.remainingCalls === 13, 'continuation must retain the exact 14-call BASE plan');
  for (const key of ['requestDigest', 'controllerHead', 'dispatchHead', 'originalArchiveHead',
    'originalArchiveDigest', 'hostPacketDigest', 'firstResultDigest', 'firstInputDigest', 'firstOutputDigest',
    'secondFailureDigest']) hash(value[key], 'original BASE ' + key);
  for (const key of ['operationId', 'leaseId', 'firstCallId', 'sessionId', 'turnId', 'secondCallId']) {
    requireThat(typeof value[key] === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value[key]),
      'original BASE ' + key);
  }
  requireThat(value.firstCallId !== value.secondCallId, 'continuation call identities collide');
  return copy(value);
}

export function verifyImplementationStatus(value, { binding, trust, implementationCommit, requireAuthorization = false }) {
  record(value, ['qualificationEnvelope', 'authorizationEnvelope'], 'implementation status');
  const qualificationEnvelope = verifyImplementationQualification(value.qualificationEnvelope,
    { binding, trust, implementationCommit });
  const authorizationEnvelope = value.authorizationEnvelope === null ? null :
    verifyContinuationAuthorization(value.authorizationEnvelope,
      { binding, trust, implementationCommit, qualificationEnvelope });
  requireThat(!requireAuthorization || authorizationEnvelope !== null,
    'actual implementation is qualified for prepare only; owner continuation authorization absent');
  return { qualificationEnvelope, authorizationEnvelope };
}
