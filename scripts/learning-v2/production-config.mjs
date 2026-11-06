/** Create-once commissioning files in the existing private production volume. */
import { fileURLToPath } from 'node:url';
import { canonical, hash, record, requireThat, text } from './contracts.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';
import { publishPrivateJsonOnce, readPrivatePublishedJson } from './private-publication.mjs';
import { verifyImplementationStatus } from './implementation-proof.mjs';

export const PRODUCTION_ROOT = '/var/lib/gk-v2-private-journal';
export const PRODUCTION_DIRECTORY = `${PRODUCTION_ROOT}/experiment`;
export const PRODUCTION_CONFIG_PATH = `${PRODUCTION_ROOT}/production-config.json`;
export const PRODUCTION_STATUS_PATH = `${PRODUCTION_ROOT}/status-config.json`;
export const PRODUCTION_IMPLEMENTATION_PATH = `${PRODUCTION_ROOT}/implementation-qualification.json`;
export const PRODUCTION_CONTINUATION_PATH = `${PRODUCTION_ROOT}/baseline-continuation-authorization.json`;
export const PRODUCTION_REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/u, '');

/** Shared parent/child proof gate. A qualified B may inspect/prepare; every
 * operational B command independently requires the signed owner authorization. */
export function verifyProductionImplementationForCommand({ bundle: supplied, sourceCommit, command, status = null }) {
  const bundle = verifyProductionBundle(supplied);
  hash(sourceCommit, 'actual production image commit', 40);
  requireThat(['init', 'run', 'resume-review', 'reconcile-usage', 'reconcile-operation', 'status',
    'prepare-baseline', 'continue-baseline'].includes(command), 'qualified production command');
  if (sourceCommit === bundle.binding.sourceCommit) {
    requireThat(status === null, 'original image cannot adopt a different implementation proof');
    requireThat(!['prepare-baseline', 'continue-baseline'].includes(command),
      'BASE continuation requires the separately qualified actual implementation');
    return null;
  }
  requireThat(command !== 'init', 'different implementation cannot initialize a replacement experiment');
  requireThat(status !== null, 'different production image lacks independent implementation qualification');
  return verifyImplementationStatus(status, { binding: bundle.binding, trust: bundle.trust, implementationCommit: sourceCommit,
    requireAuthorization: !['prepare-baseline', 'status'].includes(command) });
}

function publicationOptions() {
  requireThat(process.getuid?.() === 1000, 'production node identity required');
  return { directory: PRODUCTION_ROOT, uid: 1000 };
}

function readPrivate(path) {
  return readPrivatePublishedJson(path, publicationOptions());
}

function writePrivateOnce(path, value) {
  publishPrivateJsonOnce(path, value, publicationOptions());
}

function validated(value, sourceCommit, implementationStatus = null) {
  record(value, ['bundle', 'authority', 'readToken'], 'private production config');
  canonical(value); hash(sourceCommit, 'platform source commit', 40);
  const bundle = verifyProductionBundle(value.bundle);
  let implementation = null;
  if (bundle.binding.sourceCommit !== sourceCommit) {
    requireThat(implementationStatus, 'platform image/source binding differs without independent implementation qualification');
    implementation = { binding: bundle.binding, sourceCommit,
      status: verifyImplementationStatus(implementationStatus, { binding: bundle.binding, trust: bundle.trust,
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
  let qualificationEnvelope = null;
  try { qualificationEnvelope = readPrivate(PRODUCTION_IMPLEMENTATION_PATH); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (qualificationEnvelope === null) return validated(original, sourceCommit);
  requireThat(sourceCommit !== original.bundle.binding.sourceCommit,
    'frozen image cannot reopen after separate implementation qualification');
  let authorizationEnvelope = null;
  try { authorizationEnvelope = readPrivate(PRODUCTION_CONTINUATION_PATH); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return validated(original, sourceCommit, { qualificationEnvelope, authorizationEnvelope });
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
  const status = verifyImplementationStatus(value, { binding: original.bundle.binding, trust: original.bundle.trust,
    implementationCommit: sourceCommit });
  writePrivateOnce(PRODUCTION_IMPLEMENTATION_PATH, status.qualificationEnvelope);
  if (status.authorizationEnvelope) writePrivateOnce(PRODUCTION_CONTINUATION_PATH, status.authorizationEnvelope);
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
