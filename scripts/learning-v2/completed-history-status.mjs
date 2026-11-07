/** Same scoped GET route and owner/token boundary, explicit completed profile. */
import { createLearningStatusTokenAuthenticator } from './status-endpoint.mjs';
import { LEARNING_STATUS_PATH } from '../../integrations/base44/shared/learning-status-contract.js';
import { projectLearningHistoryResponse, validateLearningHistoryBinding } from '../../integrations/base44/shared/learning-history-contract.js';
import { requireThat } from './contracts.mjs';

const headers = { 'Cache-Control': 'private, no-store, max-age=0', 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' };
export function createCompletedStatusHandler({ readStatus, binding, readToken, clock = Date.now }) {
  const fixed = validateLearningHistoryBinding(binding);
  const original = { ownerId: fixed.ownerId, experimentId: fixed.experimentId, sourceCommit: fixed.sourceCommit };
  const authenticate = createLearningStatusTokenAuthenticator({ readToken, binding: original });
  requireThat(typeof readStatus === 'function', 'completed read-only capability absent');
  return async (incoming, outgoing) => {
    const send = (status, value) => { outgoing.writeHead(status, headers); outgoing.end(JSON.stringify(value)); };
    if (incoming.method !== 'GET' || incoming.headers['transfer-encoding'] !== undefined ||
      incoming.headers['content-length'] !== undefined) return send(405, { error: 'method_not_allowed' });
    if (typeof incoming.url !== 'string' || incoming.url.length > 8192 || incoming.url.startsWith('//') ||
      !incoming.url.startsWith('/') || incoming.rawHeaders && Buffer.byteLength(incoming.rawHeaders.join(':')) > 8192)
      return send(400, { error: 'bad_request' });
    let request;
    try {
      const url = new URL(incoming.url, 'http://127.0.0.1');
      if (url.pathname !== LEARNING_STATUS_PATH) return send(404, { error: 'not_found' });
      if (url.search || url.hash) return send(400, { error: 'bad_request' });
      const captured = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (typeof value === 'string') captured.set(name, value);
        else if (Array.isArray(value)) captured.set(name, value.join(','));
      }
      request = new Request(url, { method: 'GET', headers: captured });
    } catch { return send(400, { error: 'bad_request' }); }
    let grant;
    try { grant = await authenticate(request); } catch { return send(401, { error: 'unauthorized' }); }
    if (!grant) return send(401, { error: 'unauthorized' });
    if (request.headers.get('X-Gatekeeper-Learning-Owner') !== fixed.ownerId) return send(403, { error: 'forbidden' });
    try { return send(200, projectLearningHistoryResponse(await readStatus(), fixed, clock())); }
    catch { return send(503, { error: 'learning_status_unavailable' }); }
  };
}
