import { PRODUCT_PATH, SLUG, UUID } from './contracts.mjs';
import { ClientApiStore, tokenHash, validateReviewRequest, validateIdempotency } from './client-api-store.mjs';

export const CLIENT_API_PATH = PRODUCT_PATH + '/client-v1';
const messages = Object.freeze({
  invalid_request: 'Check the request fields and required headers.',
  unauthenticated: 'A current G8S session or client API key is required.',
  forbidden: 'This credential cannot perform that action in this scope.',
  not_found: 'The resource is not available to this account.',
  revision_changed: 'The pull request revision changed. Read the current revision before submitting a new request.',
  review_out_of_scope: 'This pull request is outside the enabled repository review scope.',
  idempotency_conflict: 'This idempotency key was already used for a different request.',
  key_limit_reached: 'Revoke an unused client key before creating another.',
  rate_limited: 'The client request rate limit has been reached.',
  github_access_denied: 'GitHub access to this repository is not currently authorized.',
  github_not_found: 'The requested GitHub resource is unavailable.',
  github_unavailable: 'GitHub verification could not be completed. No new review was admitted.',
  setup_required: 'The client API has not been commissioned.',
  product_unavailable: 'G8S could not confirm the result. Reconcile using the same idempotency key; do not create a new request blindly.',
});
const fail = (code, status) => { throw Object.assign(new Error(code), { code, status }); };
const baseHeaders = Object.freeze({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", Vary: 'Origin' });

export function clientPrincipal(req) {
  const raw = req.rawHeaders || [];
  for (const name of ['authorization', 'cookie', 'origin', 'x-g8s-request', 'idempotency-key']) {
    let count = 0;
    for (let n = 0; n < raw.length; n += 2) if (raw[n].toLowerCase() === name) count++;
    if (count > 1) fail('invalid_request', 400);
  }
  const authorization = req.headers.authorization;
  if (authorization !== undefined) {
    if (req.headers.cookie !== undefined || typeof authorization !== 'string' ||
        !/^Bearer g8s_v1_[A-Za-z0-9_-]{43}$/u.test(authorization)) fail('unauthenticated', 401);
    const token = authorization.slice(7);
    const encoded = token.slice('g8s_v1_'.length);
    if (Buffer.from(encoded, 'base64url').toString('base64url') !== encoded) fail('unauthenticated', 401);
    return { kind: 'key', hash: tokenHash(token) };
  }
  if (typeof req.headers.cookie !== 'string') fail('unauthenticated', 401);
  const values = req.headers.cookie.split(';').map(value => value.trim()).filter(value => value.startsWith('__Host-g8s_session='));
  if (values.length !== 1) fail('unauthenticated', 401);
  const value = values[0].slice('__Host-g8s_session='.length);
  if (!/^[A-Za-z0-9_-]{43}$/u.test(value) || Buffer.from(value, 'base64url').toString('base64url') !== value)
    fail('unauthenticated', 401);
  return { kind: 'session', hash: tokenHash(value) };
}
async function readJSON(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] || '')) fail('invalid_request', 415);
  let length = 0; const parts = [];
  req.setTimeout?.(10000, () => req.destroy());
  try {
    for await (const part of req) {
      const chunk = Buffer.from(part); length += chunk.length;
      if (length > 16384) fail('invalid_request', 413);
      parts.push(chunk);
    }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(parts)));
  } catch (error) {
    if (error.code === 'invalid_request') throw error;
    fail('invalid_request', 400);
  } finally { req.setTimeout?.(0); }
}

/** Optional composition over the existing product handler. No DDL or provider calls. */
export function createClientApi({ store, github, config, fallback }) {
  let stopped = false;
  function send(req, res, status, data, extra = {}) {
    const cors = req.headers.origin === config.frontendOrigin
      ? { 'Access-Control-Allow-Origin': config.frontendOrigin, 'Access-Control-Allow-Credentials': 'true' } : {};
    const text = JSON.stringify(data);
    if (Buffer.byteLength(text) > 2 * 1024 * 1024) fail('product_unavailable', 503);
    res.writeHead(status, { ...baseHeaders, ...cors, ...extra }); res.end(text);
  }
  async function handler(req, res) {
    const raw = typeof req.url === 'string' ? req.url : '';
    const rawPath = raw.split('?')[0];
    if (rawPath !== CLIENT_API_PATH && !rawPath.startsWith(CLIENT_API_PATH + '/')) return fallback(req, res);
    try {
      if (stopped) fail('product_unavailable', 503);
      const url = new URL(raw, config.apiOrigin);
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 2048 || /[%\\\u0000-\u0020\u007f]/u.test(rawPath) ||
          url.origin !== config.apiOrigin || url.pathname !== rawPath || url.search || url.hash) fail('invalid_request', 400);
      if (req.headers.origin !== undefined && req.headers.origin !== config.frontendOrigin) fail('forbidden', 403);
      if (req.method === 'OPTIONS') {
        if (req.headers.origin !== config.frontendOrigin) fail('forbidden', 403);
        const requested = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (requested.some(name => !['content-type', 'x-g8s-request', 'idempotency-key', 'authorization'].includes(name))) fail('forbidden', 403);
        res.writeHead(204, { ...baseHeaders, 'Access-Control-Allow-Origin': config.frontendOrigin,
          'Access-Control-Allow-Credentials': 'true', 'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-G8S-Request, Idempotency-Key, Authorization' });
        res.end(); return;
      }
      const principal = clientPrincipal(req);
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) fail('invalid_request', 405);
      if (principal.kind === 'session' && req.method !== 'GET' &&
          (req.headers.origin !== config.frontendOrigin || req.headers['x-g8s-request'] !== '1')) fail('forbidden', 403);
      const parts = url.pathname.slice(CLIENT_API_PATH.length).split('/').slice(1);
      if (parts[0] !== 'orgs' || !SLUG.test(parts[1] || '') || !['keys', 'reviews'].includes(parts[2]) ||
          parts.length < 3 || parts.length > 4) fail('not_found', 404);
      const slug = parts[1];
      await store.rate(principal);
      if (parts[2] === 'keys') {
        if (principal.kind !== 'session') fail('forbidden', 403);
        if (parts.length === 3 && req.method === 'GET') return send(req, res, 200, { data: await store.listKeys(principal, slug) });
        if (parts.length === 3 && req.method === 'POST') return send(req, res, 201, { data: await store.issueKey(principal, slug, await readJSON(req)) });
        if (parts.length === 4 && UUID.test(parts[3]) && req.method === 'DELETE')
          return send(req, res, 200, { data: await store.revokeKey(principal, slug, parts[3]) });
      }
      if (parts[2] === 'reviews') {
        if (parts.length === 4 && UUID.test(parts[3]) && req.method === 'GET')
          return send(req, res, 200, { data: await store.run(principal, slug, parts[3]) });
        if (parts.length === 3 && req.method === 'POST') {
          const body = validateReviewRequest(await readJSON(req));
          const key = req.headers['idempotency-key']; validateIdempotency(key);
          let accepted = await store.existingRequest(principal, slug, body, key);
          if (!accepted) {
            const selected = await store.repository(principal, slug, body.repositoryId, 'reviews:write');
            const access = await github.installationClient(String(selected.repository.github_installation_id), body.repositoryId);
            if (!await access.mayCommand(selected.repository.full_name, selected.user.login, selected.user.github_id)) fail('github_access_denied', 403);
            const pr = await access.pullRequest(selected.repository.full_name, body.prNumber);
            accepted = await store.submit(principal, slug, body, key, pr);
          }
          const statusPath = `${CLIENT_API_PATH}/orgs/${slug}/reviews/${accepted.runId}`;
          return send(req, res, 202, { data: { ...accepted, accepted: true, statusPath,
            execution: 'asynchronous', comparisonAvailable: false } }, { Location: statusPath });
        }
      }
      fail('not_found', 404);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const code = Object.hasOwn(messages, error.code) ? error.code : 'product_unavailable';
      const status = code === 'product_unavailable' ? 503 : Number.isInteger(error.status) && error.status >= 400 && error.status <= 599 ? error.status : 503;
      send(req, res, status, { error: { code, message: messages[code] } }, status === 429 ? { 'Retry-After': '60' } : {});
    }
  }
  return { handler, stop() { stopped = true; } };
}

export async function configuredClientApi({ env, product, github, config, fallback }) {
  if (env.G8S_CLIENT_API_ENABLED !== 'enabled') return { handler: fallback, stop() {} };
  const store = new ClientApiStore(product);
  await store.ready();
  return createClientApi({ store, github, config, fallback });
}
