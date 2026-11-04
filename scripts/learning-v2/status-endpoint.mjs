import { createHash, timingSafeEqual } from 'node:crypto';
import { LEARNING_STATUS_PATH, projectLearningStatusResponse, validateLearningStatusBinding }
  from '../../integrations/base44/shared/learning-status-contract.js';

const NO_STORE = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
});
const json = (value, status) => Response.json(value, { status, headers: NO_STORE });
const unavailable = () => json({ error: 'learning_status_unavailable' }, 503);
const digestToken = token => createHash('sha256').update(token, 'utf8').digest();
const validToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);

/** A server-configured token grants only one owner's fixed experiment/source. */
export function createLearningStatusTokenAuthenticator({ readToken, binding }) {
  const fixed = Object.freeze(validateLearningStatusBinding(binding));
  if (!validToken(readToken)) throw new Error('Invalid learning status token configuration');
  const expected = digestToken(readToken);
  return async request => {
    const supplied = request.headers.get('X-Gatekeeper-Learning-Token');
    if (!validToken(supplied) || !timingSafeEqual(expected, digestToken(supplied))) return null;
    return { ...fixed, permission: 'learning:status:read' };
  };
}

function grantMatches(grant, fixed) {
  if (!grant || typeof grant !== 'object' || Array.isArray(grant) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(grant))) return false;
  const keys = ['ownerId', 'experimentId', 'sourceCommit', 'permission'];
  if (Reflect.ownKeys(grant).length !== keys.length) return false;
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(grant, key);
    if (!field || !Object.hasOwn(field, 'value') || !field.enumerable) return false;
  }
  return grant.ownerId === fixed.ownerId && grant.experimentId === fixed.experimentId &&
    grant.sourceCommit === fixed.sourceCommit && grant.permission === 'learning:status:read';
}

/**
 * Mount only in the owned runtime integration after qualification. This module
 * starts no server and receives only a captured () => host.status() capability.
 * It cannot open journals, choose another experiment or dispatch learning work.
 */
export function createLearningStatusEndpoint({ readStatus, authenticate, binding, clock = () => new Date() }) {
  const fixed = Object.freeze(validateLearningStatusBinding(binding));
  if (![readStatus, authenticate, clock].every(value => typeof value === 'function')) {
    throw new Error('Invalid learning status capabilities');
  }
  return async request => {
    let url;
    try { url = new URL(request.url); } catch { return json({ error: 'bad_request' }, 400); }
    if (url.pathname !== LEARNING_STATUS_PATH) return json({ error: 'not_found' }, 404);
    if (request.method !== 'GET') return json({ error: 'method_not_allowed' }, 405);
    if (url.search || request.body !== null) return json({ error: 'bad_request' }, 400);

    let grant;
    try { grant = await authenticate(request); } catch { return json({ error: 'unauthorized' }, 401); }
    if (!grant) return json({ error: 'unauthorized' }, 401);
    try {
      if (!grantMatches(grant, fixed)) return json({ error: 'forbidden' }, 403);
      // This is an assertion of the bridge's authenticated owner, never a
      // selector. It detects mixed or mismatched owner/token configuration.
      if (request.headers.get('X-Gatekeeper-Learning-Owner') !== fixed.ownerId) {
        return json({ error: 'forbidden' }, 403);
      }
    } catch { return json({ error: 'forbidden' }, 403); }

    try {
      const status = await readStatus();
      const response = projectLearningStatusResponse({
        schema: 'gk-learning-v2-status-response', checkedAt: clock().toISOString(), status,
      }, fixed);
      return json(response, 200);
    } catch { return unavailable(); }
  };
}
