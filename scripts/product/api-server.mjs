/** Product HTTP serving only. The historical host and model worker are not started here. */
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { PRODUCT_PATH, SHA } from './contracts.mjs';
import { productUnavailable } from './service.mjs';

const ARCHIVE_ROOT = '/var/lib/gk-v2-private-journal';
const safeHeaders = Object.freeze({ 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0',
  'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Vary': 'Origin',
  'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" });
const fail = () => { throw new Error('G8S_API_CONFIGURATION_REFUSED'); };
const origin = value => {
  try { const url = new URL(value); if (url.protocol !== 'https:' || value !== url.origin) fail(); return value; }
  catch { fail(); }
};
export const GITHUB_BINDINGS = Object.freeze(['G8S_GITHUB_APP_ID', 'G8S_GITHUB_APP_SLUG', 'G8S_GITHUB_CLIENT_ID',
  'G8S_GITHUB_CLIENT_SECRET', 'G8S_GITHUB_APP_PRIVATE_KEY', 'G8S_GITHUB_WEBHOOK_SECRET']);

export function apiConfiguration(env, { archivePresent = existsSync } = {}) {
  if (env.G8S_API_SERVICE !== 'enabled' || env.STANDALONE !== 'false' ||
      !SHA.test(env.G8S_PRODUCT_SOURCE_COMMIT || '') || env.G8S_PRODUCT_SOURCE_COMMIT !== env.RAILWAY_GIT_COMMIT_SHA ||
      !['enabled', 'disabled'].includes(env.G8S_PRODUCT_ENABLED) ||
      ![undefined, 'disabled'].includes(env.G8S_PRODUCT_WORKER_ENABLED)) fail();
  // This composition cannot inherit credentials or a volume from the old host.
  // Presence is refused even when a value is blank. No file contents are read.
  for (const name of Object.keys(env)) if (/^(?:GK_|GATEKEEPER_LEARNING_|GATEKEEPER_AUTHORITY_)/u.test(name) ||
      ['RAILWAY_VOLUME_MOUNT_PATH', 'TRUEFORGE_API_KEY', 'TRUEFORGE_TOKEN', 'TRUEFOUNDRY_API_KEY',
        'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'GATEKEEPER_REVIEW_TOKEN'].includes(name)) fail();
  if (archivePresent(ARCHIVE_ROOT)) fail();
  const rawPort = env.PORT ?? '8080';
  if (!/^\d{4,5}$/u.test(rawPort)) fail();
  const port = Number(rawPort); if (port < 1024 || port > 65535) fail();
  return Object.freeze({ apiOrigin: origin(env.G8S_PUBLIC_API_ORIGIN), frontendOrigin: origin(env.G8S_FRONTEND_ORIGIN), port,
    sourceCommit: env.G8S_PRODUCT_SOURCE_COMMIT,
    missingGitHubBindings: GITHUB_BINDINGS.filter(name => typeof env[name] !== 'string' || !env[name].trim()) });
}

function json(res, status, payload, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { ...safeHeaders, ...headers }); res.end(JSON.stringify(payload));
}
const error = (res, status, code, headers) => json(res, status, { error: { code,
  message: code === 'setup_required' ? 'G8S GitHub sign-in is not configured yet.' : 'The request could not be completed.' } }, headers);

export function productApiHandler({ config, product, configured }) {
  if (typeof product?.handler !== 'function' || typeof configured !== 'boolean') fail();
  return (req, res) => {
    const requestOrigin = req.headers.origin;
    const cors = requestOrigin === config.frontendOrigin
      ? { 'Access-Control-Allow-Origin': config.frontendOrigin, 'Access-Control-Allow-Credentials': 'true' } : {};
    for (const [key, value] of Object.entries(cors)) res.setHeader(key, value);
    if (requestOrigin !== undefined && requestOrigin !== config.frontendOrigin) return error(res, 403, 'forbidden');
    const raw = req.url;
    if (typeof raw !== 'string' || raw.length > 8192 || !raw.startsWith('/') || raw.startsWith('//') ||
        /[\u0000-\u0020\u007f\\]/u.test(raw)) return error(res, 400, 'invalid_request', cors);
    let path;
    try {
      const rawPath = raw.split('?')[0]; path = new URL(raw, config.apiOrigin).pathname;
      if (path !== rawPath || decodeURIComponent(rawPath) !== rawPath) throw new Error('noncanonical');
    } catch { return error(res, 400, 'invalid_request', cors); }
    if (raw === '/healthz' && req.method === 'GET') return json(res, 200, { data: { process: 'up' } }, cors);
    if (raw === '/readyz' && req.method === 'GET') return configured
      ? json(res, 200, { data: { api: 'ready', worker: 'not_in_this_service' } }, cors)
      : error(res, 503, 'setup_required', cors);
    if (path !== PRODUCT_PATH && !path.startsWith(PRODUCT_PATH + '/')) return error(res, 404, 'not_found', cors);
    // Handle unavailable-origin preflight too. A browser must see the real JSON
    // setup_required result, not a misleading CORS/network failure or Basic Auth.
    if (req.method === 'OPTIONS') {
      const requestedMethod = req.headers['access-control-request-method'];
      const names = String(req.headers['access-control-request-headers'] || '').toLowerCase().split(',').map(x => x.trim()).filter(Boolean);
      if (requestOrigin !== config.frontendOrigin || !['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(requestedMethod) ||
          names.some(name => !['content-type', 'x-g8s-request', 'idempotency-key'].includes(name)))
        return error(res, 403, 'forbidden');
      res.writeHead(204, { ...safeHeaders, ...cors, 'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, X-G8S-Request, Idempotency-Key', 'Access-Control-Max-Age': '600' });
      res.end(); return;
    }
    if (!configured) return error(res, 503, 'setup_required', cors);
    void Promise.resolve().then(() => product.handler(req, res)).catch(() => {
      if (res.headersSent) { if (!res.writableEnded) res.destroy(); }
      else error(res, 503, 'product_unavailable', cors);
    });
  };
}

/** No DDL, provider registration, history reader or model worker in this process. */
export async function createProductApiServer({ env = process.env, configure } = {}) {
  const config = apiConfiguration(env);
  const factory = configure ?? (await import('./runtime.mjs')).configuredProduct;
  const product = await factory({ env });
  const configured = env.G8S_PRODUCT_ENABLED === 'enabled' && product.handler !== productUnavailable;
  const server = createServer({ maxHeaderSize: 16384 }, productApiHandler({ config, product, configured }));
  server.requestTimeout = 15000; server.headersTimeout = 10000; server.keepAliveTimeout = 5000;
  server.maxRequestsPerSocket = 100;
  let closed;
  function close() {
    if (closed) return closed;
    product.stop();
    closed = (async () => {
      if (server.listening) await new Promise(resolve => {
        const timeout = setTimeout(() => server.closeAllConnections(), 5000); timeout.unref();
        server.close(() => { clearTimeout(timeout); resolve(); }); server.closeIdleConnections();
      });
      await product.close();
    })();
    return closed;
  }
  return { config, configured, server, close };
}
