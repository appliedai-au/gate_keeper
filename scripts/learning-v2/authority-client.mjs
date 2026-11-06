/**
 * Driver-only transport to the separately deployed Gate Keeper authority.
 * This client contains no provider credential, signing key, oracle or retry.
 */
import { copy, hash, identifier, record, requireThat, text } from './contracts.mjs';

export class DetachedAuthorityError extends Error {
  constructor(code, details = {}) {
    super(code);
    this.name = 'DetachedAuthorityError';
    this.code = code;
    for (const field of ['reviewId', 'operationId']) {
      if (typeof details[field] === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/u.test(details[field])) {
        this[field] = details[field];
      }
    }
  }
}

export function createDetachedAuthorityClient({ baseUrl, token, trust, binding, fetcher = fetch }) {
  const endpoint = new URL(baseUrl);
  const privateHost = endpoint.hostname === '127.0.0.1' || endpoint.hostname === 'localhost' ||
    endpoint.hostname.endsWith('.railway.internal');
  requireThat((endpoint.protocol === 'https:' || endpoint.protocol === 'http:' && privateHost) &&
    !endpoint.username && !endpoint.password && !endpoint.search && !endpoint.hash &&
    endpoint.pathname === '/', 'authority origin must be explicit HTTPS or private HTTP');
  text(token, 'authority client token', 4096);
  requireThat(token.length >= 32 && !/[\s]/u.test(token), 'authority client token format');
  record(binding, ['ownerId', 'experimentId', 'sourceCommit', 'configDigest'], 'authority binding');
  identifier(binding.ownerId, 'authority owner');
  identifier(binding.experimentId, 'authority experiment');
  hash(binding.sourceCommit, 'authority source', 40);
  hash(binding.configDigest, 'authority config');
  const frozenBinding = copy(binding);
  const publicTrust = copy(trust);
  requireThat(typeof fetcher === 'function', 'authority fetch capability');
  endpoint.pathname = '/v1/gatekeeper/authority';

  async function invoke(method, args = {}, options = {}) {
    const abort = new AbortController();
    const external = options.abortSignal;
    const onAbort = () => abort.abort();
    if (external?.aborted) abort.abort();
    else external?.addEventListener('abort', onAbort, { once: true });
    const seconds = options.timeoutInSeconds ?? 60;
    requireThat(Number.isFinite(seconds) && seconds > 0 && seconds <= 900,
      'authority request timeout');
    const timer = setTimeout(() => abort.abort(), seconds * 1000);
    try {
      const response = await fetcher(endpoint.href, {
        method: 'POST', redirect: 'error', signal: abort.signal,
        headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
        body: JSON.stringify({ binding: frozenBinding, method, args: copy(args) }),
      });
      const chunks = [];
      let length = 0;
      for await (const chunk of response.body) {
        length += chunk.byteLength;
        requireThat(length <= 16 * 1024 * 1024, 'authority response limit');
        chunks.push(Buffer.from(chunk));
      }
      let value;
      try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
      catch { throw new DetachedAuthorityError('GK_AUTHORITY_RESPONSE_INVALID'); }
      if (!response.ok) {
        const code = typeof value?.error === 'string' && /^GK_AUTHORITY_[A-Z_]+$/u.test(value.error)
          ? value.error : 'GK_AUTHORITY_REFUSED';
        throw new DetachedAuthorityError(code, value);
      }
      record(value, ['result'], 'authority response');
      // Signature envelopes retain original property order: JSON-copy, not
      // canonical-copy. The legacy receipt verifier signs JSON.stringify(body).
      return JSON.parse(JSON.stringify(value.result));
    } catch (error) {
      if (error instanceof DetachedAuthorityError) throw error;
      // A lost response is ambiguous. Never retry a dispatch or mint a new ID.
      throw new DetachedAuthorityError('GK_AUTHORITY_TRANSPORT_UNRESOLVED');
    } finally {
      clearTimeout(timer);
      external?.removeEventListener('abort', onAbort);
    }
  }

  const sessions = Object.freeze({
    create: (input, options) => invoke('sessions.create', { input }, options),
    createTurn: (sessionId, input, options) => invoke('sessions.createTurn', { sessionId, input }, options),
    getTurn: (sessionId, turnId, options) => invoke('sessions.getTurn', { sessionId, turnId }, options),
    listTurnEvents: async (sessionId, turnId, input, options) => ({
      response: await invoke('sessions.listTurnEvents', { sessionId, turnId, input }, options),
    }),
  });
  const authorities = Object.fromEntries(['evaluation', 'novelty'].map(role => {
    requireThat(publicTrust[role] && typeof publicTrust[role].publicKeyPem === 'string',
      'missing authority public identity');
    hash(publicTrust[role].pinnedFingerprint, role + ' authority pin');
    return [role, Object.freeze({
      publicKeyPem: publicTrust[role].publicKeyPem,
      pinnedFingerprint: publicTrust[role].pinnedFingerprint,
      issue: input => invoke(role + '.issue', input),
    })];
  }));
  return Object.freeze({
    client: Object.freeze({ sessions }),
    authorities: Object.freeze(authorities),
    gateway: Object.freeze({
      admit: input => invoke('gateway.admit', input),
      settle: input => invoke('gateway.settle', input),
    }),
    managedGate: () => invoke('managedGate'),
    fitFeedback: input => invoke('fitFeedback', input),
    activation: input => invoke('activation', input),
    noveltyDecision: input => invoke('noveltyDecision', input),
    reconcileUsage: input => invoke('reconcileUsage', input),
    operationReconciliation: input => invoke('operationReconciliation', input),
    implementationStatus: () => invoke('implementationStatus'),
    prepareBaselineContinuation: checkpoint => invoke('prepareBaselineContinuation', { checkpoint }),
  });
}
