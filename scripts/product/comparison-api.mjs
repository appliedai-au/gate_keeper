import { PRODUCT_PATH, SLUG, UUID } from './contracts.mjs';
import { clientPrincipal } from './client-api.mjs';
import { ComparisonStore } from './comparison-store.mjs';
import { comparisonCandidates, COMPARISON_LIMITS } from './comparison-contract.mjs';

export const COMPARISON_PATH = PRODUCT_PATH + '/comparison-v1';
const fail = (code, status) => { throw Object.assign(new Error(code), { code, status }); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const messages = Object.freeze({
  invalid_request: 'Check the comparison fields and required headers.',
  unauthenticated: 'A current G8S session is required.', forbidden: 'This account cannot access this comparison.',
  not_found: 'The comparison is unavailable in this organization.', setup_required: 'Comparison capture has not been commissioned.',
  review_not_complete: 'Complete the independent G8S review before importing comparator output.',
  revision_changed: 'The pull request changed. Do not compare outputs as the same revision.',
  snapshot_changed: 'Comparator output changed. Read the current capture before judging it.',
  revision_conflict: 'Feedback changed elsewhere. Read it back before saving.',
  idempotency_conflict: 'This request identity was used for another judgment.',
  comparison_deleted: 'This comparison was deleted. Its retained identity cannot silently recreate private content.',
  comparison_limit: 'The comparison storage limit was reached.', comparison_too_large: 'The comparison exceeds its bounded capture size.',
  invalid_comparator_response: 'The comparator evidence could not be verified.',
  github_access_denied: 'GitHub access is not currently authorized.', github_not_found: 'The GitHub resource is unavailable.',
  github_unavailable: 'GitHub evidence could not be collected. No comparison success is implied.',
  github_response_too_large: 'The full GitHub evidence exceeds the bounded capture size.',
  rate_limited: 'Comparison requests are temporarily limited.', product_unavailable: 'G8S could not confirm this operation. Read back before retrying a write.',
});
async function readBody(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] || '')) fail('invalid_request', 415);
  const chunks = []; let size = 0;
  req.setTimeout?.(10000, () => req.destroy());
  try {
    for await (const chunk of req) { const bytes = Buffer.from(chunk); size += bytes.length;
      if (size > 16384) fail('invalid_request', 413); chunks.push(bytes); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) { if (error.code === 'invalid_request') throw error; fail('invalid_request', 400); }
  finally { req.setTimeout?.(0); }
}

export function createComparisonApi({ store, github, config, fallback }) {
  let stopped = false;
  function send(req, res, status, value) {
    const cors = req.headers.origin === config.frontendOrigin
      ? { 'Access-Control-Allow-Origin': config.frontendOrigin, 'Access-Control-Allow-Credentials': 'true' } : {};
    const body = JSON.stringify(value);
    if (Buffer.byteLength(body) > COMPARISON_LIMITS.responseBytes) fail('comparison_too_large', 413);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'", ...cors,
      ...(status === 429 ? { 'Retry-After': '60' } : {}) }); res.end(body);
  }
  async function handler(req, res) {
    const raw = typeof req.url === 'string' ? req.url : '', rawPath = raw.split('?')[0];
    if (rawPath !== COMPARISON_PATH && !rawPath.startsWith(COMPARISON_PATH + '/')) return fallback(req, res);
    try {
      if (stopped) fail('product_unavailable', 503);
      if (req.headers.origin !== undefined && req.headers.origin !== config.frontendOrigin) fail('forbidden', 403);
      const url = new URL(raw, config.apiOrigin);
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 2048 || /[%\\\u0000-\u0020\u007f]/u.test(rawPath) ||
          url.pathname !== rawPath || url.origin !== config.apiOrigin || url.hash) fail('invalid_request', 400);
      if (req.method === 'OPTIONS') {
        const headers = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (req.headers.origin !== config.frontendOrigin || !['GET', 'POST', 'DELETE'].includes(req.headers['access-control-request-method']) ||
            headers.some(x => !['content-type', 'x-g8s-request', 'idempotency-key'].includes(x))) fail('forbidden', 403);
        res.writeHead(204, { 'Access-Control-Allow-Origin': config.frontendOrigin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, X-G8S-Request, Idempotency-Key', Vary: 'Origin', 'Cache-Control': 'no-store' });
        res.end(); return;
      }
      if (!store) fail('setup_required', 503);
      const principal = clientPrincipal(req);
      if (principal.kind !== 'session') fail('forbidden', 403);
      if (!['GET', 'POST', 'DELETE'].includes(req.method)) fail('invalid_request', 405);
      if (req.method !== 'GET' && (req.headers.origin !== config.frontendOrigin || req.headers['x-g8s-request'] !== '1')) fail('forbidden', 403);
      const parts = url.pathname.slice(COMPARISON_PATH.length).split('/').slice(1);
      if (parts[0] !== 'orgs' || !SLUG.test(parts[1] || '') || parts[2] !== 'comparisons' || parts.length < 3 || parts.length > 5 ||
          parts.length >= 4 && !UUID.test(parts[3])) fail('not_found', 404);
      const slug = parts[1], id = parts[3];
      const allowedQuery = req.method === 'GET' && parts.length === 3 ? 'page' : req.method === 'GET' && parts.length === 4 ? 'version' : null;
      for (const [key, value] of url.searchParams) if (key !== allowedQuery || url.searchParams.getAll(key).length !== 1 || !/^(?:0|[1-9][0-9]{0,4})$/u.test(value)) fail('invalid_request', 400);
      await store.rate(principal, req.method === 'POST' && parts.length === 3);
      if (parts.length === 3 && req.method === 'GET') return send(req, res, 200, { data: await store.list(principal, slug, Number(url.searchParams.get('page') || 0)) });
      if (parts.length === 3 && req.method === 'POST') {
        const body = await readBody(req);
        if (!exact(body, ['runId']) || typeof body.runId !== 'string' || !UUID.test(body.runId)) fail('invalid_request', 400);
        const ctx = await store.context(principal, slug, body.runId);
        const access = await github.installationClient(String(ctx.installation.github_installation_id), ctx.repository.github_repo_id, { readOnly: true });
        if (!await access.mayCommand(ctx.repository.full_name, ctx.user.login, ctx.user.github_id)) fail('github_access_denied', 403);
        const before = await access.pullRequest(ctx.repository.full_name, ctx.run.pr_number);
        const same = pr => pr.head?.sha === ctx.run.head_sha && pr.base?.sha === ctx.run.base_sha && pr.base?.ref === ctx.run.base_branch;
        if (!same(before)) fail('revision_changed', 409);
        const evidence = await access.comparisonEvidence(ctx.repository.full_name, ctx.run.pr_number);
        const after = await access.pullRequest(ctx.repository.full_name, ctx.run.pr_number);
        if (!same(after)) fail('revision_changed', 409);
        if (stopped) fail('product_unavailable', 503);
        const captured = await store.capture(principal, slug, body.runId, { evidence, expectedG8sDigest: ctx.g8sDigest,
          observedRevision: { repositoryId: ctx.repository.github_repo_id, prNumber: ctx.run.pr_number,
            headSha: after.head.sha, baseSha: after.base.sha, baseBranch: after.base.ref } });
        return send(req, res, 200, { data: { ...captured, reviewersTriggered: false, trainingStarted: false } });
      }
      if (parts.length === 4 && req.method === 'GET') return send(req, res, 200, { data: await store.detail(principal, slug, id,
        url.searchParams.has('version') ? Number(url.searchParams.get('version')) : null) });
      if (parts.length === 4 && req.method === 'DELETE') {
        const body = await readBody(req); if (!exact(body, ['confirmed']) || body.confirmed !== true) fail('invalid_request', 400);
        return send(req, res, 200, { data: await store.remove(principal, slug, id) });
      }
      if (parts.length === 5 && parts[4] === 'feedback' && req.method === 'POST') return send(req, res, 200,
        { data: await store.feedback(principal, slug, id, await readBody(req), req.headers['idempotency-key']) });
      if (parts.length === 5 && parts[4] === 'candidates' && req.method === 'GET') {
        const detail = await store.detail(principal, slug, id);
        return send(req, res, 200, { data: comparisonCandidates({ ...detail, comparisonId: id }) });
      }
      fail('not_found', 404);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const code = Object.hasOwn(messages, error.code) ? error.code : 'product_unavailable';
      const status = code === 'product_unavailable' ? 503 : Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
      send(req, res, status, { error: { code, message: messages[code] } });
    }
  }
  return { handler, stop() { stopped = true; } };
}

/** Optional reads/feedback only; missing comparison setup cannot break existing sign-in. */
export async function configuredComparisonApi({ env, product, github, config, fallback }) {
  if (env.G8S_COMPARISON_ENABLED !== 'enabled') return { handler: fallback, stop() {} };
  let store = null;
  try {
    store = new ComparisonStore(product, { identity: { userId: env.G8S_GITAR_BOT_ID, login: env.G8S_GITAR_BOT_LOGIN } });
    await store.ready();
  } catch { store = null; }
  return createComparisonApi({ store, github, config, fallback });
}
