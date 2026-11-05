/**
 * Single-dispatch TrueFoundry relay for the admitted private provider only.
 * No generic proxy, retry, redirect, caller-chosen upstream or public route.
 */
import { createHash, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { requireThat } from './contracts.mjs';

const UPSTREAM = 'https://stranger-builds.truefoundry.cloud/api/llm/chat/completions';
const MAX_REQUEST_BYTES = 2 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const sameSecret = (left, right) => {
  const a = createHash('sha256').update(left).digest(), b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
};
const drained = res => new Promise((resolve, reject) => {
  const cleanup = () => {
    res.removeListener('drain', onDrain); res.removeListener('close', onClose); res.removeListener('error', onError);
  };
  const onDrain = () => { cleanup(); resolve(); };
  const onClose = () => { cleanup(); reject(new Error('RELAY_DOWNSTREAM_CLOSED')); };
  const onError = () => { cleanup(); reject(new Error('RELAY_DOWNSTREAM_FAILED')); };
  res.once('drain', onDrain); res.once('close', onClose); res.once('error', onError);
  if (res.destroyed) onClose();
});

/** Existing approved transport repair: one TrueFoundry data line per SSE event. */
export async function* reframeTrueFoundry(stream, onBytes) {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let pending = '';
  for await (const chunk of stream) {
    onBytes(chunk);
    pending += decoder.decode(chunk, { stream: true });
    requireThat(pending.length <= MAX_RESPONSE_BYTES, 'provider SSE frame limit');
    for (let index = pending.indexOf('\n'); index >= 0; index = pending.indexOf('\n')) {
      const line = pending.slice(0, index).replace(/\r$/u, '');
      pending = pending.slice(index + 1);
      yield line + (line.startsWith('data:') ? '\n\n' : '\n');
    }
  }
  pending += decoder.decode();
  if (pending) yield pending.replace(/\r$/u, '') + (pending.startsWith('data:') ? '\n\n' : '\n');
}

export function createAuthorityRelay({ authority, prefix, providerToken, upstreamModelId, fetcher = fetch }) {
  requireThat(/^[a-f0-9]{64}$/u.test(prefix) && typeof providerToken === 'string' &&
    providerToken.length >= 16 && typeof upstreamModelId === 'string', 'protected relay configuration');
  const route = '/' + prefix + '/api/llm/chat/completions';
  const server = createServer(async (req, res) => {
    if (req.method !== 'POST' || req.url !== route ||
        !sameSecret(String(req.headers.authorization || ''), 'Bearer ' + providerToken)) {
      res.writeHead(404); res.end(); return;
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 900_000);
    let claimed = null, upstream = null, responseBytes = 0, finished = false;
    const responseHash = createHash('sha256');
    const stop = () => { if (!finished) abort.abort(); };
    req.once('aborted', stop);
    res.once('close', stop);
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        requireThat(size <= MAX_REQUEST_BYTES, 'provider relay request limit');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks);
      const body = JSON.parse(bytes.toString('utf8'));
      requireThat(body && body.model === upstreamModelId && body.stream === true &&
        Array.isArray(body.messages) && body.messages.length === 2, 'provider relay frozen request');
      claimed = await authority.claimProviderDispatch({ body,
        requestDigest: createHash('sha256').update(bytes).digest('hex') });
      // A rejection before an HTTP response is ambiguous. Preserve the claim;
      // never turn a timeout, DNS error or restart into a zero-cost retry.
      upstream = await fetcher(UPSTREAM, { method: 'POST', redirect: 'error', signal: abort.signal,
        headers: { Authorization: 'Bearer ' + providerToken, 'Content-Type': 'application/json',
          Accept: 'text/event-stream' }, body: bytes });
      requireThat(upstream.body, 'provider relay response body absent');
      const account = chunk => {
        responseBytes += chunk.byteLength;
        requireThat(responseBytes <= MAX_RESPONSE_BYTES, 'provider relay response limit');
        responseHash.update(chunk);
      };
      const type = upstream.headers.get('content-type') || 'application/octet-stream';
      const sse = type.toLowerCase().startsWith('text/event-stream');
      res.writeHead(upstream.status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
      const output = sse ? reframeTrueFoundry(upstream.body, account) :
        (async function* () { for await (const chunk of upstream.body) { account(chunk); yield chunk; } })();
      for await (const chunk of output) {
        if (!res.write(chunk)) await drained(res);
      }
      await authority.finishProviderDispatch({ callId: claimed.callId, status: upstream.ok ? 'complete' : 'failed',
        resultDigest: responseHash.digest('hex'), httpStatus: upstream.status });
      finished = true;
      res.end();
    } catch {
      abort.abort();
      if (claimed && upstream !== null) {
        try {
          await authority.finishProviderDispatch({ callId: claimed.callId, status: 'failed',
            resultDigest: responseHash.digest('hex'), httpStatus: upstream.status });
        } catch { /* Preserve any ambiguous durable write; never retry forwarding. */ }
      }
      if (!res.headersSent) { res.writeHead(claimed ? 502 : 409, { 'Content-Type': 'application/json' }); res.end('{"error":"provider_dispatch_unavailable"}'); }
      else res.destroy();
    } finally {
      clearTimeout(timer);
      req.removeListener('aborted', stop); res.removeListener('close', stop);
      if (!finished) abort.abort();
    }
  });
  server.requestTimeout = 910_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => socket.destroy());
  return server;
}
