import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { createHash } from 'node:crypto';
import { apiConfiguration, productApiHandler, createProductApiServer, GITHUB_BINDINGS } from '../scripts/product/api-server.mjs';
import { createProductService, productUnavailable } from '../scripts/product/service.mjs';

const SHA = 'a'.repeat(40), FRONTEND = 'https://g8s.test', API = 'https://gate.g8s.test';
const env = (patch = {}) => ({ G8S_API_SERVICE: 'enabled', STANDALONE: 'false', PORT: '8080',
  RAILWAY_GIT_COMMIT_SHA: SHA, G8S_PRODUCT_SOURCE_COMMIT: SHA, G8S_PRODUCT_ENABLED: 'disabled',
  G8S_PUBLIC_API_ORIGIN: API, G8S_FRONTEND_ORIGIN: FRONTEND, ...patch });
const cfg = () => apiConfiguration(env());
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
async function fixture(t, handler) {
  const server = createServer(handler), port = await listen(server);
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  return (path, { method = 'GET', headers = {}, body } = {}) => new Promise((resolve, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port, path, method, headers,
      timeout: 5000, agent: false }, response => {
      let text = ''; response.setEncoding('utf8');
      response.on('data', chunk => { text += chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, text }));
      response.on('error', reject);
    });
    request.on('timeout', () => request.destroy(new Error('fixture timeout')));
    request.on('error', reject); request.end(body);
  });
}

for (const patch of [
  { G8S_API_SERVICE: undefined }, { STANDALONE: 'true' }, { G8S_PRODUCT_SOURCE_COMMIT: 'b'.repeat(40) },
  { RAILWAY_GIT_COMMIT_SHA: undefined }, { G8S_PRODUCT_ENABLED: 'true' }, { G8S_PRODUCT_WORKER_ENABLED: 'enabled' },
  { G8S_PRODUCT_WORKER_ENABLED: 'typo' }, { PORT: '0' }, { PORT: '1000' }, { PORT: '65536' },
  { G8S_PUBLIC_API_ORIGIN: 'http://gate.g8s.test' }, { G8S_FRONTEND_ORIGIN: 'https://g8s.test/path' },
  { G8S_FRONTEND_ORIGIN: 'https://user:password@g8s.test' }, { G8S_FRONTEND_ORIGIN: 'https://g8s.test/' },
]) test('API composition rejects invalid role/source/origin/port: ' + JSON.stringify(patch), () => {
  assert.throws(() => apiConfiguration(env(patch)), /G8S_API_CONFIGURATION_REFUSED/u);
});
for (const name of ['GK_PRODUCTION_CONFIG_B64', 'GATEKEEPER_LEARNING_TOKEN', 'GATEKEEPER_AUTHORITY_TOKEN',
  'RAILWAY_VOLUME_MOUNT_PATH', 'TRUEFORGE_API_KEY', 'TRUEFORGE_TOKEN', 'TRUEFOUNDRY_API_KEY', 'OPENAI_API_KEY',
  'ANTHROPIC_API_KEY', 'GATEKEEPER_REVIEW_TOKEN']) test('API refuses inherited capability name even blank: ' + name, () => {
  assert.throws(() => apiConfiguration(env({ [name]: '' })), /G8S_API_CONFIGURATION_REFUSED/u);
});
test('API checks archive absence without reading files and reports names, never values', () => {
  let checked;
  assert.throws(() => apiConfiguration(env(), { archivePresent(path) { checked = path; return true; } }));
  assert.equal(checked, '/var/lib/gk-v2-private-journal');
  assert.deepEqual(cfg().missingGitHubBindings, GITHUB_BINDINGS);
  const config = apiConfiguration(env({ G8S_GITHUB_CLIENT_SECRET: 'SYNTHETIC_SECRET_DO_NOT_RETURN' }));
  assert.equal(JSON.stringify(config).includes('SYNTHETIC_SECRET'), false);
});

test('unconfigured API returns JSON with exact CORS, no Basic Auth and distinct liveness/readiness', async t => {
  let calls = 0;
  const get = await fixture(t, productApiHandler({ config: cfg(), configured: false,
    product: { handler() { calls++; assert.fail('unconfigured handler must not be invoked'); } } }));
  const health = await get('/healthz'); assert.equal(health.status, 200);
  for (const path of ['/readyz', '/gatekeeper/product-v1/session', '/gatekeeper/product-v1/auth/github/start']) {
    const result = await get(path, { headers: { Origin: FRONTEND } });
    assert.equal(result.status, 503); assert.equal(JSON.parse(result.text).error.code, 'setup_required');
    assert.equal(result.headers['www-authenticate'], undefined);
    assert.equal(result.headers['access-control-allow-origin'], FRONTEND);
    assert.equal(result.headers['access-control-allow-credentials'], 'true');
    assert.match(result.headers['cache-control'], /no-store/u);
  }
  assert.equal(calls, 0);
});

test('preflight is exact-origin and rejects arbitrary credentials or methods even before setup', async t => {
  const request = await fixture(t, productApiHandler({ config: cfg(), configured: false,
    product: { handler() { assert.fail('no requests'); } } }));
  const okay = await request('/gatekeeper/product-v1/client-v1/orgs/alpha/reviews', { method: 'OPTIONS', headers: {
    Origin: FRONTEND, 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'Content-Type, X-G8S-Request, Idempotency-Key' } });
  assert.equal(okay.status, 204); assert.equal(okay.headers['access-control-allow-origin'], FRONTEND);
  for (const headers of [
    { Origin: 'https://foreign.test', 'Access-Control-Request-Method': 'POST' },
    { Origin: FRONTEND, 'Access-Control-Request-Method': 'TRACE' },
    { Origin: FRONTEND, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'Authorization' },
    { 'Access-Control-Request-Method': 'POST' },
  ]) { const result = await request('/gatekeeper/product-v1/session', { method: 'OPTIONS', headers });
    assert.equal(result.status, 403); }
});

test('noncanonical paths and ordinary TrueForge endpoints never reach the product handler', async t => {
  let calls = 0;
  const request = await fixture(t, productApiHandler({ config: cfg(), configured: true,
    product: { handler() { calls++; assert.fail('route must not reach product'); } } }));
  for (const path of ['/gatekeeper/product-v1/%73ession', '/gatekeeper/product-v1/../session',
    '/gatekeeper/product-v1/%GG', '/gatekeeper%2Fproduct-v1/session', '//gatekeeper/product-v1/session',
    '/gatekeeper/product-v1\\session']) assert.equal((await request(path)).status, 400, path);
  for (const path of ['/api/v1/sessions', '/gatekeeper/learning-v3/status', '/gatekeeper/product-v10/session', '/.env'])
    assert.equal((await request(path)).status, 404, path);
  assert.equal(calls, 0);
});

test('configured listener uses actual session and OAuth handlers, not Basic Auth or a fake identity', async t => {
  const token = 'S'.repeat(43), requests = [];
  const config = { ...cfg(), githubClientId: 'SYNTHETIC_CLIENT_ID', githubAppSlug: 'synthetic-g8s',
    adminGithubIds: new Set(), webhookSecret: 'SYNTHETIC_WEBHOOK_SECRET_VALUE' };
  const user = { id: '00000000-0000-4000-8000-000000000101', githubId: '101', login: 'fixture' };
  const product = createProductService({ config,
    github: new Proxy({}, { get() { assert.fail('fixture cannot call external GitHub'); } }),
    store: {
      async getSession(hash) { return hash === createHash('sha256').update(token).digest('hex') ? { user, organizations: [] } : null; },
      async createOAuth(row) { requests.push(row); },
    } });
  t.after(product.stop);
  const request = await fixture(t, productApiHandler({ config, product, configured: true }));
  const missing = await request('/gatekeeper/product-v1/session', { headers: { Origin: FRONTEND } });
  assert.equal(missing.status, 401); assert.equal(JSON.parse(missing.text).error.code, 'unauthenticated');
  assert.equal(missing.headers['www-authenticate'], undefined);
  const known = await request('/gatekeeper/product-v1/session', { headers: { Origin: FRONTEND, Cookie: '__Host-g8s_session=' + token } });
  assert.equal(known.status, 200); assert.deepEqual(JSON.parse(known.text).data.user, user);
  assert.equal(known.text.includes(token), false);
  const signin = await request('/gatekeeper/product-v1/auth/github/start');
  assert.equal(signin.status, 303); assert.equal(requests.length, 1);
  const target = new URL(signin.headers.location);
  assert.equal(target.origin, 'https://github.com'); assert.equal(target.pathname, '/login/oauth/authorize');
  assert.equal(target.searchParams.get('redirect_uri'), API + '/gatekeeper/product-v1/auth/github/callback');
  assert.equal(target.searchParams.get('code_challenge_method'), 'S256');
  assert.match(signin.headers['set-cookie'][0], /HttpOnly; Secure; SameSite=Lax/u);
});

test('unexpected product exceptions are redacted and retain frontend CORS', async t => {
  const request = await fixture(t, productApiHandler({ config: cfg(), configured: true,
    product: { handler() { throw new Error('SYNTHETIC_PRIVATE_DETAIL'); } } }));
  const result = await request('/gatekeeper/product-v1/session', { headers: { Origin: FRONTEND } });
  assert.equal(result.status, 503); assert.equal(JSON.parse(result.text).error.code, 'product_unavailable');
  assert.equal(result.text.includes('SYNTHETIC_PRIVATE_DETAIL'), false);
  assert.equal(result.headers['access-control-allow-origin'], FRONTEND);
});

test('the HTTP role never starts a worker and closes its resources once', async t => {
  let starts = 0, stops = 0, closes = 0;
  const service = await createProductApiServer({ env: env(), configure: async () => ({
    handler: productUnavailable, start() { starts++; }, stop() { stops++; }, async close() { closes++; },
  }) });
  t.after(service.close); await listen(service.server);
  assert.equal(service.configured, false); assert.equal(starts, 0);
  await Promise.all([service.close(), service.close()]);
  assert.equal(stops, 1); assert.equal(closes, 1);
});
