// Hosted server-only read bridge. The original live-status backend is unchanged.
import { PUBLIC_LEARNING_STATUS_PATH } from './learning-status-contract.js';
import { MAX_LEARNING_HISTORY_BYTES, projectLearningHistoryResponse,
  validateLearningHistoryBinding } from './learning-history-contract.js';

const ORIGIN = 'https://proxy-production-9553.up.railway.app';
const TIMEOUT_MS = 7000;
const NO_STORE = Object.freeze({
  'Cache-Control': 'private, no-store, max-age=0', 'X-Content-Type-Options': 'nosniff',
});
const json = (value, status) => Response.json(value, { status, headers: NO_STORE });
const unavailable = () => json({ error: 'learning_history_unavailable' }, 503);
const isIdentifier = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u.test(value);
const isToken = value => typeof value === 'string' && /^[A-Za-z0-9_-]{32,256}$/u.test(value);

// Same bounded, abort-aware Web API reads as the qualified live-status bridge.
async function boundedJson(message, maximum, signal) {
  const contentType = message.headers.get('Content-Type') || '';
  if (!/^application\/json(?:\s*;[^\r\n]*)?$/iu.test(contentType)) throw new Error('Invalid content type');
  const length = message.headers.get('Content-Length');
  if (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum)) throw new Error('Body limit');
  if (!message.body) throw new Error('Missing body');
  const reader = message.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0, text = '', aborted;
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
    void reader.cancel().catch(() => {});
    try { reader.releaseLock(); } catch { /* cancellation may still own a read */ }
  }
}
async function discard(message) {
  try { if (message.body) void message.body.cancel().catch(() => {}); } catch { /* no body exposed */ }
}

/** Fixed owner/A/B/C/closure pins. No browser-selected mode or legacy fallback. */
export function createLearningHistoryBackend({ authenticate, readSecret, fetchImpl = fetch, clock = () => new Date() }) {
  if (![authenticate, readSecret, fetchImpl, clock].every(value => typeof value === 'function'))
    throw new Error('Invalid learning history backend capabilities');
  return async request => {
    if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    let userId, role;
    try { const user = await authenticate(request); userId = user?.id; role = user?.role; }
    catch { return json({ error: 'unauthorized' }, 401); }
    if (!isIdentifier(userId)) return json({ error: 'unauthorized' }, 401);
    if (role !== 'admin') return json({ error: 'forbidden' }, 403);
    let ownerId;
    try { ownerId = await readSecret('GATEKEEPER_LEARNING_OWNER_ID'); if (!isIdentifier(ownerId)) return unavailable(); }
    catch { return unavailable(); }
    if (userId !== ownerId) return json({ error: 'forbidden' }, 403);
    try {
      if (new URL(request.url).search) { await discard(request); return json({ error: 'bad_request' }, 400); }
      const body = await boundedJson(request, 1024, AbortSignal.timeout(TIMEOUT_MS));
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).length !== 0)
        return json({ error: 'bad_request' }, 400);
    } catch { await discard(request); return json({ error: 'bad_request' }, 400); }

    let upstream;
    try {
      const [experimentId, sourceCommit, readToken, servingSourceCommit, executionSourceCommit, closureDigest] = await Promise.all([
        readSecret('GATEKEEPER_LEARNING_EXPERIMENT_ID'), readSecret('GATEKEEPER_LEARNING_SOURCE_COMMIT'),
        readSecret('GATEKEEPER_LEARNING_READ_TOKEN'), readSecret('GATEKEEPER_LEARNING_HISTORY_SOURCE_COMMIT'),
        readSecret('GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT'), readSecret('GATEKEEPER_LEARNING_CLOSURE_SHA256'),
      ]);
      const binding = validateLearningHistoryBinding({ ownerId, experimentId, sourceCommit,
        servingSourceCommit, executionSourceCommit, closureDigest });
      if (!isToken(readToken)) return unavailable();
      const signal = AbortSignal.timeout(TIMEOUT_MS);
      upstream = await fetchImpl(ORIGIN + PUBLIC_LEARNING_STATUS_PATH, {
        method: 'GET', redirect: 'error', cache: 'no-store', signal,
        headers: { 'X-Gatekeeper-Learning-Token': readToken,
          'X-Gatekeeper-Learning-Owner': ownerId, Accept: 'application/json' },
      });
      if (upstream.status !== 200 || upstream.redirected) { await discard(upstream); return unavailable(); }
      const response = projectLearningHistoryResponse(
        await boundedJson(upstream, MAX_LEARNING_HISTORY_BYTES, signal), binding, clock().getTime());
      return json(response, 200);
    } catch {
      if (upstream) await discard(upstream);
      return unavailable();
    }
  };
}
