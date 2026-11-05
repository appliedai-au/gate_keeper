/** Create-once commissioning files in the existing private production volume. */
import { fileURLToPath } from 'node:url';
import { canonical, hash, record, requireThat, text } from './contracts.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';
import { publishPrivateJsonOnce, readPrivatePublishedJson } from './private-publication.mjs';

export const PRODUCTION_ROOT = '/var/lib/gk-v2-private-journal';
export const PRODUCTION_DIRECTORY = `${PRODUCTION_ROOT}/experiment`;
export const PRODUCTION_CONFIG_PATH = `${PRODUCTION_ROOT}/production-config.json`;
export const PRODUCTION_STATUS_PATH = `${PRODUCTION_ROOT}/status-config.json`;
export const PRODUCTION_REPOSITORY_ROOT = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/u, '');

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

function validated(value, sourceCommit) {
  record(value, ['bundle', 'authority', 'readToken'], 'private production config');
  canonical(value); hash(sourceCommit, 'platform source commit', 40);
  const bundle = verifyProductionBundle(value.bundle);
  requireThat(bundle.binding.sourceCommit === sourceCommit, 'platform image/source binding differs from experiment');
  record(value.authority, ['baseUrl', 'token'], 'private authority connection');
  const endpoint = new URL(value.authority.baseUrl);
  requireThat(endpoint.protocol === 'https:' && !endpoint.username && !endpoint.password &&
    !endpoint.search && !endpoint.hash && endpoint.pathname === '/', 'fixed authenticated authority HTTPS origin required');
  text(value.authority.token, 'scoped authority driver token', 4096);
  text(value.readToken, 'scoped status read token', 4096);
  requireThat(/^[\x21-\x7e]{32,4096}$/u.test(value.authority.token) &&
    /^[A-Za-z0-9_-]{32,256}$/u.test(value.readToken), 'scoped tokens must match their authority and status contracts');
  requireThat(value.authority.token !== value.readToken, 'authority and status credentials must be separate');
  return { bundle, authority: { baseUrl: endpoint.origin, token: value.authority.token }, readToken: value.readToken };
}

export function installProductionConfig(value, sourceCommit) {
  const config = validated(value, sourceCommit);
  writePrivateOnce(PRODUCTION_CONFIG_PATH, config);
  return config;
}

export function readProductionConfig(sourceCommit) {
  return validated(readPrivate(PRODUCTION_CONFIG_PATH), sourceCommit);
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
