/** Fetch one independently pinned bundle from the authenticated authority.
 * The descriptor is small; the actual retained bank never needs an env value. */
import { canonical, hash, identifier, record, requireThat, text } from './contracts.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';

const MAX_BYTES = 4 * 1024 * 1024;
const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];

export function validateBootstrapDescriptor(input, sourceCommit) {
  record(input, ['schema', 'binding', 'legacyBankFileDigest', 'legacyBankDigest', 'trustPins', 'authority', 'readToken'],
    'production bootstrap descriptor');
  canonical(input);
  requireThat(input.schema === 'gk-learning-production-bootstrap-v1', 'production bootstrap schema');
  record(input.binding, ['ownerId', 'experimentId', 'sourceCommit', 'configDigest'], 'production bootstrap binding');
  identifier(input.binding.ownerId, 'bootstrap ownerId'); identifier(input.binding.experimentId, 'bootstrap experimentId');
  hash(sourceCommit, 'platform source commit', 40); hash(input.binding.configDigest, 'bootstrap config digest');
  requireThat(input.binding.sourceCommit === sourceCommit, 'bootstrap source differs from platform image');
  hash(input.legacyBankFileDigest, 'bootstrap legacy file digest'); hash(input.legacyBankDigest, 'bootstrap legacy projection digest');
  record(input.trustPins, [...ROLES, 'gatewayId'], 'bootstrap public authority pins');
  for (const role of ROLES) hash(input.trustPins[role], 'bootstrap public fingerprint');
  requireThat(new Set(ROLES.map(role => input.trustPins[role])).size === 4, 'bootstrap authority identities must be distinct');
  identifier(input.trustPins.gatewayId, 'bootstrap gatewayId');
  record(input.authority, ['baseUrl', 'token'], 'bootstrap authority connection');
  const url = new URL(input.authority.baseUrl);
  requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash &&
    url.pathname === '/', 'bootstrap requires a fixed HTTPS authority origin');
  text(input.authority.token, 'bootstrap scoped driver token', 4096); text(input.readToken, 'bootstrap status token', 4096);
  requireThat(/^[\x21-\x7e]{32,4096}$/u.test(input.authority.token) &&
    /^[A-Za-z0-9_-]{32,256}$/u.test(input.readToken) && input.authority.token !== input.readToken,
  'bootstrap requires separate scoped credentials');
  return JSON.parse(JSON.stringify(input));
}

export function bindBootstrapConfig(descriptor, config) {
  const bundle = verifyProductionBundle(config.bundle);
  requireThat(canonical(bundle.binding) === canonical(descriptor.binding) &&
    bundle.legacyBank.fileDigest === descriptor.legacyBankFileDigest &&
    bundle.legacyBankDigest === descriptor.legacyBankDigest, 'bootstrap bundle provenance mismatch');
  for (const role of ROLES) requireThat(bundle.trust[role].pinnedFingerprint === descriptor.trustPins[role],
    `bootstrap ${role} public pin mismatch`);
  requireThat(bundle.trust.budget.gatewayId === descriptor.trustPins.gatewayId, 'bootstrap gateway identity mismatch');
  requireThat(config.authority.baseUrl === new URL(descriptor.authority.baseUrl).origin &&
    config.authority.token === descriptor.authority.token && config.readToken === descriptor.readToken,
  'bootstrap credentials differ from existing private configuration');
  return config;
}

export async function fetchProductionConfig(descriptor, { fetcher = fetch, sourceCommit, signal } = {}) {
  const pinned = validateBootstrapDescriptor(descriptor, sourceCommit);
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 30_000);
  const stop = () => controller.abort();
  signal?.addEventListener('abort', stop, { once: true });
  if (signal?.aborted) stop();
  try {
    const url = new URL('/v1/gatekeeper/bootstrap', pinned.authority.baseUrl);
    const response = await fetcher(url.href, { method: 'GET', redirect: 'error', signal: controller.signal,
      headers: { authorization: `Bearer ${pinned.authority.token}`, accept: 'application/json' } });
    requireThat(response.status === 200 && response.body && typeof response.body.getReader === 'function',
      'authenticated bootstrap response unavailable');
    const length = response.headers.get('content-length');
    if (length !== null) requireThat(/^\d+$/u.test(length) && Number(length) <= MAX_BYTES, 'bootstrap response size');
    const reader = response.body.getReader(), chunks = []; let bytes = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        bytes += next.value.byteLength;
        requireThat(bytes <= MAX_BYTES, 'bootstrap response exceeds size limit');
        chunks.push(Buffer.from(next.value));
      }
    } catch (error) { await reader.cancel().catch(() => {}); throw error; }
    finally { reader.releaseLock(); }
    const config = { bundle: JSON.parse(Buffer.concat(chunks).toString('utf8')),
      authority: { baseUrl: new URL(pinned.authority.baseUrl).origin, token: pinned.authority.token }, readToken: pinned.readToken };
    return bindBootstrapConfig(pinned, config);
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', stop); controller.abort(); }
}
