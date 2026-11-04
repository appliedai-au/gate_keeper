// Portable Web API bridge. Credentials and auth are injected by the selected
// Base44 runtime entrypoint; this module must never be included in a UI bundle.
import { LEARNING_STATUS_PATH, MAX_STATUS_BYTES, projectLearningStatusResponse,
  validateLearningStatusBinding } from './learning-status-contract.js';

const ORIGIN = 'https://proxy-production-9553.up.railway.app';
const TIMEOUT_MS = 7000;
const NO_STORE = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
});
const json = (value, status) => Response.json(value, { status, headers: NO_STORE });
const unavailable = () => json({ error: 'learning_status_unavailable' }, 503);
const isIdentifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value);
const isToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/.test(value);
const isCredential = value => typeof value === 'string' && value.length > 0 && value.length <= 1024 &&
  /^[\x20-\x7e]+$/.test(value);

// Fetch timeout covers headers AND the response stream. Bound actual bytes,
// independently of an absent, dishonest or compressed Content-Length header.
async function boundedJson(message, maximum, signal) {
  const contentType = message.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;[^\r\n]*)?$/i.test(contentType)) throw new Error('Invalid content type');
  const length = message.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > maximum)) {
    throw new Error('Body limit');
  }
  if (!message.body) throw new Error('Missing body');
  const reader = message.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  let text = '';
  let aborted;
  const interruption = new Promise((_, reject) => {
    aborted = () => reject(new Error('Read timed out'));
    signal.addEventListener('abort', aborted, { once: true });
    if (signal.aborted) aborted();
  });
  try {
    while (true) {
      const chunk = await Promise.race([reader.read(), interruption]);
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > maximum) throw new Error('Body limit');
      text += decoder.decode(chunk.value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text);
  } finally {
    signal.removeEventListener('abort', aborted);
    // Do not wait for an untrusted streaming peer to acknowledge cancellation.
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* cancellation may still own a read */ }
  }
}

async function discard(message) {
  try { if (message.body) void message.body.cancel().catch(() => {}); } catch { /* no body exposed */ }
}

/** Single configured owner and experiment; browser input cannot select either. */
export function createLearningStatusBackend({ authenticate, readSecret, fetchImpl = fetch, clock = () => new Date() }) {
  if (![authenticate, readSecret, fetchImpl, clock].every(value => typeof value === 'function')) {
    throw new Error('Invalid learning status backend capabilities');
  }
  return async request => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    let userId;
    let role;
    try {
      const user = await authenticate(request);
      userId = user?.id;
      role = user?.role;
    } catch { return json({ error: 'unauthorized' }, 401); }
    if (!isIdentifier(userId)) return json({ error: 'unauthorized' }, 401);
    if (role !== 'admin') return json({ error: 'forbidden' }, 403);

    let ownerId;
    try {
      ownerId = await readSecret('GATEKEEPER_LEARNING_OWNER_ID');
      if (!isIdentifier(ownerId)) return unavailable();
    } catch { return unavailable(); }
    if (userId !== ownerId) return json({ error: 'forbidden' }, 403);

    try {
      if (new URL(request.url).search) {
        await discard(request);
        return json({ error: 'bad_request' }, 400);
      }
      const body = await boundedJson(request, 1024, AbortSignal.timeout(TIMEOUT_MS));
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0) {
        return json({ error: 'bad_request' }, 400);
      }
    } catch {
      await discard(request);
      return json({ error: 'bad_request' }, 400);
    }

    let upstream;
    try {
      const [experimentId, sourceCommit, readToken, username, password] = await Promise.all([
        readSecret('GATEKEEPER_LEARNING_EXPERIMENT_ID'), readSecret('GATEKEEPER_LEARNING_SOURCE_COMMIT'),
        readSecret('GATEKEEPER_LEARNING_READ_TOKEN'), readSecret('GATEKEEPER_PROXY_USERNAME'),
        readSecret('GATEKEEPER_PROXY_PASSWORD'),
      ]);
      const binding = validateLearningStatusBinding({ ownerId, experimentId, sourceCommit });
      if (!isToken(readToken) || !isCredential(username) || username.includes(':') || !isCredential(password)) {
        return unavailable();
      }
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      upstream = await fetchImpl(ORIGIN + LEARNING_STATUS_PATH, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal,
        headers: { Authorization: 'Basic ' + btoa(username + ':' + password),
          'X-Gatekeeper-Learning-Token': readToken,
          'X-Gatekeeper-Learning-Owner': ownerId, Accept: 'application/json' },
      });
      if (upstream.status !== 200 || upstream.redirected) { await discard(upstream); return unavailable(); }
      const response = projectLearningStatusResponse(await boundedJson(upstream, MAX_STATUS_BYTES, signal), binding);
      const age = clock().getTime() - Date.parse(response.checkedAt);
      if (!Number.isFinite(age) || age < -5000 || age > 60_000) return unavailable();
      return json(response, 200);
    } catch {
      if (upstream) await discard(upstream);
      return unavailable();
    }
  };
}
