import { PRODUCT_PATH, SLUG, UUID } from './contracts.mjs';
import { clientPrincipal } from './client-api.mjs';
import { LessonStore } from './lesson-store.mjs';
import { exact, verificationTrust } from './lesson-verification.mjs';

export const LEARNING_POLICY_PATH = PRODUCT_PATH + '/admin/learning-policy';
export const LESSON_PATH = PRODUCT_PATH + '/lesson-v1';
const codes = new Set(['invalid_request', 'unauthenticated', 'forbidden', 'not_found', 'revision_conflict', 'snapshot_changed',
  'comparison_deleted', 'review_not_complete', 'no_learning_candidates', 'unbound_lesson_evidence', 'verification_required',
  'verification_stale', 'verification_setup_required', 'deterministic_verification_failed', 'adversarial_verification_failed',
  'change_verification_required', 'rate_limited', 'product_unavailable']);
const fail = (code, status) => { throw Object.assign(new Error(code), { code, status }); };
async function body(req) {
  if (!/^application\/json(?:\s*;\s*charset=utf-8)?$/iu.test(req.headers['content-type'] || '')) fail('invalid_request', 415);
  let size = 0; const chunks = [];
  req.setTimeout?.(10000, () => req.destroy());
  try {
    for await (const part of req) { const bytes = Buffer.from(part); size += bytes.length;
      if (size > 300 * 1024) fail('invalid_request', 413); chunks.push(bytes); }
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
  } catch (error) { if (error.code === 'invalid_request') throw error; fail('invalid_request', 400); }
  finally { req.setTimeout?.(0); }
}
export function createLessonApi({ store, config, fallback }) {
  let stopped = false;
  function send(req, res, status, value) {
    const text = JSON.stringify(value);
    if (Buffer.byteLength(text) > 256 * 1024) fail('product_unavailable', 503);
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', Vary: 'Origin',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...(req.headers.origin === config.frontendOrigin ? { 'Access-Control-Allow-Origin': config.frontendOrigin,
        'Access-Control-Allow-Credentials': 'true' } : {}), ...(status === 429 ? { 'Retry-After': '60' } : {}) });
    res.end(text);
  }
  async function handler(req, res) {
    const raw = typeof req.url === 'string' ? req.url : '', path = raw.split('?')[0];
    if (path !== LEARNING_POLICY_PATH && path !== LESSON_PATH && !path.startsWith(LESSON_PATH + '/')) return fallback(req, res);
    try {
      if (stopped) fail('product_unavailable', 503);
      if (req.headers.origin !== undefined && req.headers.origin !== config.frontendOrigin) fail('forbidden', 403);
      const url = new URL(raw, config.apiOrigin);
      if (!raw.startsWith('/') || raw.startsWith('//') || raw.length > 2048 || /[%\\\u0000-\u0020\u007f]/u.test(path) ||
          url.pathname !== path || url.search || url.hash) fail('invalid_request', 400);
      if (req.method === 'OPTIONS') {
        const names = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
        if (req.headers.origin !== config.frontendOrigin || !['GET', 'POST', 'PUT'].includes(req.headers['access-control-request-method']) ||
            names.some(x => !['content-type', 'x-g8s-request'].includes(x))) fail('forbidden', 403);
        res.writeHead(204, { 'Access-Control-Allow-Origin': config.frontendOrigin, 'Access-Control-Allow-Credentials': 'true',
          'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type, X-G8S-Request',
          Vary: 'Origin', 'Cache-Control': 'no-store' }); res.end(); return;
      }
      if (!store) fail('verification_setup_required', 503);
      const principal = clientPrincipal(req);
      if (principal.kind !== 'session') fail('forbidden', 403);
      if (!['GET', 'POST', 'PUT'].includes(req.method)) fail('invalid_request', 405);
      if (req.method !== 'GET' && (req.headers.origin !== config.frontendOrigin || req.headers['x-g8s-request'] !== '1')) fail('forbidden', 403);
      await store.comparisons.rate(principal, req.method !== 'GET');
      if (path === LEARNING_POLICY_PATH) {
        if (req.method === 'GET') return send(req, res, 200, { data: await store.readPolicy(principal) });
        if (req.method === 'PUT') return send(req, res, 200, { data: await store.savePolicy(principal, await body(req)) });
        fail('invalid_request', 405);
      }
      const parts = path.slice(LESSON_PATH.length).split('/').slice(1);
      if (parts.length !== 5 || parts[0] !== 'orgs' || !SLUG.test(parts[1] || '') || parts[2] !== 'comparisons' ||
          !UUID.test(parts[3] || '') || !['prepare', 'bank', 'lessons'].includes(parts[4])) fail('not_found', 404);
      const [, slug, , id, action] = parts;
      if (action === 'lessons' && req.method === 'GET') return send(req, res, 200, { data: await store.list(principal, slug, id) });
      if (action === 'prepare' && req.method === 'POST') {
        const input = await body(req); if (!exact(input, ['change'])) fail('invalid_request', 400);
        return send(req, res, 200, { data: await store.prepare(principal, slug, id, input.change) });
      }
      if (action === 'bank' && req.method === 'POST') return send(req, res, 200, { data: await store.bank(principal, slug, id, await body(req)) });
      fail('invalid_request', 405);
    } catch (error) {
      if (res.headersSent) { res.destroy(); return; }
      const code = codes.has(error.code) ? error.code : 'product_unavailable';
      const status = code === 'product_unavailable' ? 503 : Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 503;
      send(req, res, status, { error: { code, message: code === 'verification_setup_required'
        ? 'The independent lesson verifier is not configured. No lesson was banked.'
        : 'This operation was not accepted. Read current policy, feedback and verification evidence before retrying.' } });
    }
  }
  return { handler, stop() { stopped = true; } };
}
export async function configuredLessonApi({ env, product, config, fallback }) {
  if (env.G8S_LESSON_POLICY_ENABLED !== 'enabled') return { handler: fallback, stop() {} };
  let store = null;
  try {
    store = new LessonStore(product, { identity: { userId: env.G8S_GITAR_BOT_ID, login: env.G8S_GITAR_BOT_LOGIN },
      adminGithubIds: config.adminGithubIds, trust: verificationTrust(env.G8S_VERIFIER_PUBLIC_KEYS_JSON) });
    await store.ready();
  } catch { store = null; }
  return createLessonApi({ store, config, fallback });
}
