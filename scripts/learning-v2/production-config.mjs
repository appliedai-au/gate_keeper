/** Create-once commissioning files in the existing private production volume. */
import { fileURLToPath } from 'node:url';
import { canonical, hash, record, requireThat, text } from './contracts.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';
import { publishPrivateJsonOnce, readPrivatePublishedJson } from './private-publication.mjs';
import { verifyImplementationStatus } from './implementation-proof.mjs';
import { PROPOSAL_OBSERVATION_STATUS, createProposalObservationSourceVerifier,
  verifyProposalObservationStatus } from './proposal-observation-proof.mjs';

export const PRODUCTION_ROOT = '/var/lib/gk-v2-private-journal';
export const PRODUCTION_DIRECTORY = `${PRODUCTION_ROOT}/experiment`;
export const PRODUCTION_CONFIG_PATH = `${PRODUCTION_ROOT}/production-config.json`;
export const PRODUCTION_STATUS_PATH = `${PRODUCTION_ROOT}/status-config.json`;
export const PRODUCTION_IMPLEMENTATION_PATH = `${PRODUCTION_ROOT}/implementation-qualification.json`;
export const PRODUCTION_CONTINUATION_PATH = `${PRODUCTION_ROOT}/baseline-continuation-authorization.json`;
export const PRODUCTION_PROPOSAL_OBSERVATION_QUALIFICATION_PATH = `${PRODUCTION_ROOT}/proposal-observation-qualification.json`;
export const PRODUCTION_PROPOSAL_OBSERVATION_PREPARATION_PATH = `${PRODUCTION_ROOT}/proposal-observation-preparation.json`;
export const PRODUCTION_PROPOSAL_OBSERVATION_AUTHORIZATION_PATH = `${PRODUCTION_ROOT}/proposal-observation-authorization.json`;
export const PRODUCTION_REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/u, '');
export const PRODUCTION_COMMANDS = Object.freeze(['init', 'run', 'resume-review', 'reconcile-usage',
  'reconcile-operation', 'status', 'prepare-baseline', 'continue-baseline',
  'prepare-proposal-observation', 'consume-proposal-observation']);
const OBSERVATION_COMMANDS = ['prepare-proposal-observation', 'consume-proposal-observation'];

/** A public proof descriptor is the sole extra child input. It is never a
 * credential or an override for the actual image or retained experiment. */
export function parseProductionProposalObservationDescriptor(serialized) {
  if (serialized === undefined || serialized === '') return null;
  requireThat(typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= 32768,
    'D production source descriptor size');
  const descriptor = JSON.parse(serialized);
  record(descriptor, ['schema', 'sourceProof', 'gatePolicy'], 'D production source descriptor');
  requireThat(descriptor.schema === 'gk-learning-proposal-observation-source-proof-v1',
    'D production source descriptor schema');
  canonical(descriptor);
  return descriptor;
}

/** Shared parent/child proof gate. A qualified B may inspect/prepare; every
 * operational B command independently requires the signed owner authorization. */
export function verifyProductionImplementationForCommand({ bundle: supplied, sourceCommit, command, status = null }) {
  const bundle = verifyProductionBundle(supplied);
  hash(sourceCommit, 'actual production image commit', 40);
  requireThat(PRODUCTION_COMMANDS.includes(command), 'qualified production command');
  if (sourceCommit === bundle.binding.sourceCommit) {
    requireThat(status === null, 'original image cannot adopt a different implementation proof');
    requireThat(!['prepare-baseline', 'continue-baseline', ...OBSERVATION_COMMANDS].includes(command),
      'continuation or observation requires the separately qualified actual implementation');
    return null;
  }
  requireThat(command !== 'init', 'different implementation cannot initialize a replacement experiment');
  requireThat(status !== null, 'different production image lacks independent implementation qualification');
  if (status.schema === PROPOSAL_OBSERVATION_STATUS) {
    requireThat(!['prepare-baseline', 'continue-baseline'].includes(command),
      'actual D cannot repeat historical B BASE commands');
    return verifyProposalObservationStatus(status, { binding: bundle.binding, trust: bundle.trust,
      implementationCommit: sourceCommit,
      requireAuthorization: !['status', 'prepare-proposal-observation'].includes(command),
      requireRemainder: !['status', ...OBSERVATION_COMMANDS].includes(command) });
  }
  requireThat(!OBSERVATION_COMMANDS.includes(command), 'proposal observation requires actual D proof');
  return verifyImplementationStatus(status, { binding: bundle.binding, trust: bundle.trust, implementationCommit: sourceCommit,
    requireAuthorization: !['prepare-baseline', 'status'].includes(command) });
}

/** Both parent and child retrieve current D evidence independently. Historical
 * B is authenticated by its retained signatures, never requalified as current. */
export async function verifyProductionProposalObservationSource({ bundle: supplied, sourceCommit,
  status, descriptor, fetcher = fetch }) {
  const bundle = verifyProductionBundle(supplied);
  const checked = verifyProposalObservationStatus(status, { binding: bundle.binding, trust: bundle.trust,
    implementationCommit: sourceCommit });
  requireThat(descriptor, 'actual D requires its independent source descriptor');
  const observed = await createProposalObservationSourceVerifier({ descriptor, fetcher })({
    bundle, implementationCommit: sourceCommit, historicalImplementationStatus: checked.historicalImplementationStatus });
  const signed = checked.qualificationEnvelope.body;
  requireThat(observed.implementationCommit === sourceCommit && observed.implementationTree === signed.implementationTree &&
    canonical(observed.qualification) === canonical(signed.qualification) && observed.runId === signed.runId &&
    observed.rawLogsDigest === signed.rawLogsDigest && observed.qualificationEvidenceDigest === signed.qualificationEvidenceDigest,
  'independent D source evidence differs from signed qualification');
  return observed;
}

function publicationOptions() {
  requireThat(process.getuid?.() === 1000, 'production node identity required');
  return { directory: PRODUCTION_ROOT, uid: 1000 };
}

function readPrivate(path) {
  // A startup read cannot repair a publication prefix before its source gate.
  return readPrivatePublishedJson(path, { ...publicationOptions(), strictReadOnly: true });
}

function writePrivateOnce(path, value) {
  publishPrivateJsonOnce(path, value, publicationOptions());
}

function readOptional(path) {
  try { return readPrivate(path); }
  catch (error) { if (error.code !== 'ENOENT') throw error; return null; }
}

function retainedImplementationStatus() {
  const qualificationEnvelope = readOptional(PRODUCTION_IMPLEMENTATION_PATH);
  const authorizationEnvelope = readOptional(PRODUCTION_CONTINUATION_PATH);
  requireThat(qualificationEnvelope !== null || authorizationEnvelope === null,
    'historical B authorization lacks original qualification');
  return qualificationEnvelope === null ? null : { qualificationEnvelope, authorizationEnvelope };
}

function proposalObservationEnvelopes() {
  const qualificationEnvelope = readOptional(PRODUCTION_PROPOSAL_OBSERVATION_QUALIFICATION_PATH);
  const preparationEnvelope = readOptional(PRODUCTION_PROPOSAL_OBSERVATION_PREPARATION_PATH);
  const authorizationEnvelope = readOptional(PRODUCTION_PROPOSAL_OBSERVATION_AUTHORIZATION_PATH);
  requireThat(qualificationEnvelope !== null || preparationEnvelope === null && authorizationEnvelope === null,
    'D observation sidecars lack their qualification');
  requireThat(authorizationEnvelope === null || preparationEnvelope !== null,
    'D observation authorization lacks original preparation');
  return qualificationEnvelope === null ? null : { qualificationEnvelope, preparationEnvelope, authorizationEnvelope };
}

function validated(value, sourceCommit, implementationStatus = null) {
  record(value, ['bundle', 'authority', 'readToken'], 'private production config');
  canonical(value); hash(sourceCommit, 'platform source commit', 40);
  const bundle = verifyProductionBundle(value.bundle);
  requireThat(sourceCommit !== bundle.binding.sourceCommit || implementationStatus === null,
    'frozen image cannot reopen retained implementation proofs');
  let implementation = null;
  if (bundle.binding.sourceCommit !== sourceCommit) {
    requireThat(implementationStatus, 'platform image/source binding differs without independent implementation qualification');
    implementation = { binding: bundle.binding, sourceCommit,
      status: (implementationStatus.schema === PROPOSAL_OBSERVATION_STATUS ? verifyProposalObservationStatus :
        verifyImplementationStatus)(implementationStatus, { binding: bundle.binding, trust: bundle.trust,
        implementationCommit: sourceCommit }) };
  }
  record(value.authority, ['baseUrl', 'token'], 'private authority connection');
  const endpoint = new URL(value.authority.baseUrl);
  requireThat(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password &&
    !endpoint.search && !endpoint.hash && endpoint.pathname === '/', 'fixed authenticated authority HTTPS origin required');
  text(value.authority.token, 'scoped authority driver token', 4096);
  text(value.readToken, 'scoped status read token', 4096);
  requireThat(/^[\x21-\x7e]{32,4096}$/u.test(value.authority.token) &&
    /^[A-Za-z0-9_-]{32,256}$/u.test(value.readToken), 'scoped tokens must match their authority and status contracts');
  requireThat(value.authority.token !== value.readToken, 'authority and status credentials must be separate');
  return { bundle, authority: { baseUrl: endpoint.origin, token: value.authority.token }, readToken: value.readToken,
    ...(implementation ? { implementation } : {}) };
}

export function installProductionConfig(value, sourceCommit) {
  const config = validated(value, sourceCommit);
  writePrivateOnce(PRODUCTION_CONFIG_PATH, config);
  return config;
}

export function readProductionConfig(sourceCommit) {
  const original = readPrivate(PRODUCTION_CONFIG_PATH);
  const historicalImplementationStatus = retainedImplementationStatus();
  const observation = proposalObservationEnvelopes();
  if (observation) {
    requireThat(historicalImplementationStatus, 'D must retain original historical B proof files');
    return validated(original, sourceCommit, { schema: PROPOSAL_OBSERVATION_STATUS,
      historicalImplementationStatus, ...observation });
  }
  if (historicalImplementationStatus === null) return validated(original, sourceCommit);
  requireThat(sourceCommit !== original.bundle.binding.sourceCommit,
    'frozen image cannot reopen after separate implementation qualification');
  return validated(original, sourceCommit, historicalImplementationStatus);
}

/** Read the immutable original connection only for authenticated implementation
 * proof retrieval. This function grants no image approval or host execution. */
export function readOriginalProductionConfig() {
  const original = readPrivate(PRODUCTION_CONFIG_PATH);
  return validated(original, original.bundle?.binding?.sourceCommit);
}

/** Two create-once sidecars preserve the original commissioning bytes. A
 * qualification can precede owner authorization without overwriting either. */
export function installProductionImplementation(value, sourceCommit) {
  const original = readOriginalProductionConfig();
  requireThat(proposalObservationEnvelopes() === null, 'historical B installation cannot replace installed D proof');
  const status = verifyImplementationStatus(value, { binding: original.bundle.binding, trust: original.bundle.trust,
    implementationCommit: sourceCommit });
  writePrivateOnce(PRODUCTION_IMPLEMENTATION_PATH, status.qualificationEnvelope);
  if (status.authorizationEnvelope) writePrivateOnce(PRODUCTION_CONTINUATION_PATH, status.authorizationEnvelope);
  return readProductionConfig(sourceCommit);
}

/** Add D beside B. Qualification, preparation and authorization publish only
 * once, in order. Neither historical B file is passed to a writer here. */
export function installProductionProposalObservation(value, sourceCommit) {
  const original = readOriginalProductionConfig();
  // A missing mandatory predecessor is corruption, not an installation resume.
  proposalObservationEnvelopes();
  const historical = retainedImplementationStatus();
  requireThat(historical, 'D installation requires retained original B qualification and authorization');
  const checked = verifyProposalObservationStatus(value, { binding: original.bundle.binding, trust: original.bundle.trust,
    implementationCommit: sourceCommit });
  requireThat(canonical(checked.historicalImplementationStatus) === canonical(historical),
    'D status substitutes the retained original B proof files');
  writePrivateOnce(PRODUCTION_PROPOSAL_OBSERVATION_QUALIFICATION_PATH, checked.qualificationEnvelope);
  if (checked.preparationEnvelope) writePrivateOnce(PRODUCTION_PROPOSAL_OBSERVATION_PREPARATION_PATH, checked.preparationEnvelope);
  if (checked.authorizationEnvelope) writePrivateOnce(PRODUCTION_PROPOSAL_OBSERVATION_AUTHORIZATION_PATH, checked.authorizationEnvelope);
  return readProductionConfig(sourceCommit);
}

export async function publishProductionStatus(config, driver) {
  const inspected = await driver.inspect();
  requireThat(inspected.state.configDigest === config.bundle.binding.configDigest,
    'status must name the initialized production journal');
  const { ownerId, experimentId, sourceCommit, configDigest } = config.bundle.binding;
  writePrivateOnce(PRODUCTION_STATUS_PATH, { binding: { ownerId, experimentId, sourceCommit }, configDigest,
    directory: PRODUCTION_DIRECTORY, repositoryRoot: PRODUCTION_REPOSITORY_ROOT,
    readToken: config.readToken, trust: config.bundle.trust });
}
