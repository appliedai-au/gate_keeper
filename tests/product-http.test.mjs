import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import { createProductService, auditCSV } from '../scripts/product/service.mjs';
import { PRODUCT_PATH, CONFIGURATION_DEFAULTS } from '../scripts/product/contracts.mjs';
import { sha256 } from '../scripts/product/github.mjs';

// These inert named placeholders are test-only. No real credentials or records
// are created, and no GitHub/TrueForge/provider endpoint is reachable here.
const SESSION_PLACEHOLDER = 'OWNER_SET_SESSION_PLACEHOLDER'.padEnd(43, '_');
const WEBHOOK_PLACEHOLDER = 'OWNER_SET_G8S_GITHUB_WEBHOOK_SECRET';
const user = { id: '00000000-0000-4000-8000-000000000001', githubId: '1', login: 'owner', name: null, email: null };
const session = { user, organizations: [{ id: '00000000-0000-4000-8000-000000000010', slug: 'owner', name: 'owner', role: 'owner' }] };
const config = { apiOrigin: 'https://api.g8s.test', frontendOrigin: 'https://g8s.test',
  githubClientId: 'OWNER_SET_GITHUB_CLIENT_ID', githubAppSlug: 'owner-set-app-slug',
  adminGithubIds: new Set(['1']), webhookSecret: WEBHOOK_PLACEHOLDER };
const auth = { Cookie: `__Host-g8s_session=${SESSION_PLACEHOLDER}` };
const mutating = { ...auth, Origin: config.frontendOrigin, 'X-G8S-Request': '1', 'Content-Type': 'application/json' };
const reject = (code = 'not_found', status = 404) => { throw Object.assign(new Error(code), { code, status }); };

async function fixture(t, changes = {}, settings = {}) {
  const calls = [];
  const store = {
    async getSession(value) { calls.push(['session', value]); return value === sha256(SESSION_PLACEHOLDER) ? session : null; },
    async membership(userId, slug) { calls.push(['membership', userId, slug]); if (slug !== 'owner') reject(); return session.organizations[0]; },
    async overview(...args) { calls.push(['overview', ...args]); return { hasData: false, series: [] }; },
    async adminList(...args) { calls.push(['admin', ...args]); return { users: [] }; },
    async setPause(...args) { calls.push(['pause', ...args]); return { paused: args[1].paused }; },
    async saveSettings(...args) { calls.push(['save', ...args]); return { saved: true }; },
    async receiveDelivery(...args) { calls.push(['delivery', ...args]); return { duplicate: false }; },
    async createOAuth(...args) { calls.push(['oauth', ...args]); },
    async consumeOAuth(...args) { calls.push(['consume', ...args]); reject('invalid_oauth_callback', 401); },
    ...changes,
  };
  const github = new Proxy({}, { get: () => () => { throw new Error('unexpected GitHub call'); } });
  const service = createProductService({ store, github, config: { ...config, ...settings },
    entropy: () => 'OWNER_SET_OAUTH_PLACEHOLDER'.padEnd(43, '_') });
  const server = createServer(service.handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { service.stop(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const url = `http://127.0.0.1:${server.address().port}${PRODUCT_PATH}`;
  return { calls, store, request: (path, init = {}) => fetch(url + path, { redirect: 'manual', ...init }) };
}

test('anonymous requests cannot read tenant or global admin data', async t => {
  const f = await fixture(t);
  for (const path of ['/session', '/orgs/owner/overview', '/admin/users']) {
    const response = await f.request(path);
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error.code, 'unauthenticated');
  }
  assert.deepEqual(f.calls, []);
});

test('session role is derived only from immutable GitHub admin ids', async t => {
  const f = await fixture(t, {}, { adminGithubIds: new Set() });
  const response = await f.request('/session', { headers: { ...auth, 'X-User-Role': 'admin' } });
  const result = (await response.json()).data;
  assert.equal(result.isAdmin, false);
  assert.equal(result.user.githubId, '1');
  assert.ok(!JSON.stringify(result).includes(SESSION_PLACEHOLDER));
  const denied = await f.request('/admin/users', { headers: { ...auth, 'X-User-Role': 'admin' } });
  assert.equal(denied.status, 403);
  assert.ok(!f.calls.some(call => call[0] === 'admin'));
});

test('org slug is checked against server identity before repository or run queries', async t => {
  const f = await fixture(t);
  const response = await f.request('/orgs/another-user/overview', { headers: auth });
  assert.equal(response.status, 404);
  assert.deepEqual(f.calls.at(-1), ['membership', user.id, 'another-user']);
  assert.ok(!f.calls.some(call => call[0] === 'overview'));
});

test('mutations require exact frontend origin and a non-simple request header', async t => {
  const f = await fixture(t);
  const body = JSON.stringify({ paused: true, reason: 'Owner maintenance' });
  for (const headers of [auth, { ...auth, Origin: 'https://attacker.test', 'X-G8S-Request': '1' },
    { ...auth, Origin: config.frontendOrigin }]) {
    const response = await f.request('/admin/controls', { method: 'PUT', headers, body });
    assert.equal(response.status, 403);
  }
  assert.ok(!f.calls.some(call => call[0] === 'pause'));
  const accepted = await f.request('/admin/controls', { method: 'PUT', headers: mutating, body });
  assert.equal(accepted.status, 200);
  assert.deepEqual(f.calls.at(-1), ['pause', user.id, { paused: true, reason: 'Owner maintenance' }]);
});

test('CORS reflects only the configured exact origin, never arbitrary origins', async t => {
  const f = await fixture(t);
  const good = await f.request('/session', { method: 'OPTIONS', headers: { Origin: config.frontendOrigin,
    'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'Content-Type, X-G8S-Request' } });
  assert.equal(good.status, 204);
  assert.equal(good.headers.get('access-control-allow-origin'), config.frontendOrigin);
  assert.equal(good.headers.get('access-control-allow-credentials'), 'true');
  const bad = await f.request('/session', { method: 'OPTIONS', headers: { Origin: 'https://g8s.test.attacker.test' } });
  assert.equal(bad.status, 403);
  assert.equal(bad.headers.get('access-control-allow-origin'), null);
});

test('raw-body signature is checked before any durable webhook write', async t => {
  const f = await fixture(t);
  const body = JSON.stringify({ zen: 'synthetic webhook test' });
  const base = { 'Content-Type': 'application/json', 'X-GitHub-Event': 'ping',
    'X-GitHub-Delivery': '00000000-0000-4000-8000-000000000100' };
  for (const signature of ['', 'sha256=' + '0'.repeat(64)]) {
    const response = await f.request('/webhooks/github', { method: 'POST', headers: { ...base, 'X-Hub-Signature-256': signature }, body });
    assert.equal(response.status, 401);
  }
  assert.ok(!f.calls.some(call => call[0] === 'delivery'));
  const signature = 'sha256=' + createHmac('sha256', WEBHOOK_PLACEHOLDER).update(body).digest('hex');
  const response = await f.request('/webhooks/github', { method: 'POST', headers: { ...base, 'X-Hub-Signature-256': signature }, body });
  assert.equal(response.status, 202);
  assert.deepEqual((await response.json()).data, { accepted: true, duplicate: false });
  assert.equal(f.calls.filter(call => call[0] === 'delivery').length, 1);
  assert.ok(!f.calls.some(call => call[0] === 'session'));
});

test('a valid signature for different bytes is rejected', async t => {
  const f = await fixture(t);
  const original = '{"zen":"test"}', body = '{ "zen": "test" }';
  const signature = 'sha256=' + createHmac('sha256', WEBHOOK_PLACEHOLDER).update(original).digest('hex');
  const response = await f.request('/webhooks/github', { method: 'POST', body, headers: {
    'X-GitHub-Event': 'ping', 'X-GitHub-Delivery': '00000000-0000-4000-8000-000000000100',
    'X-Hub-Signature-256': signature } });
  assert.equal(response.status, 401);
  assert.deepEqual(f.calls, []);
});

test('a durable inbox failure is not acknowledged as accepted', async t => {
  const f = await fixture(t, { async receiveDelivery() { throw new Error('private database exception must never be reflected'); } });
  const body = '{"zen":"test"}';
  const response = await f.request('/webhooks/github', { method: 'POST', body, headers: {
    'X-GitHub-Event': 'ping', 'X-GitHub-Delivery': '00000000-0000-4000-8000-000000000100',
    'X-Hub-Signature-256': 'sha256=' + createHmac('sha256', WEBHOOK_PLACEHOLDER).update(body).digest('hex') } });
  assert.equal(response.status, 503);
  const text = await response.text();
  assert.ok(!text.includes('private database'));
});

test('OAuth uses PKCE, a one-use server record, and a host-only HttpOnly cookie', async t => {
  const f = await fixture(t);
  const response = await f.request('/auth/github/start');
  assert.equal(response.status, 303);
  const redirect = new URL(response.headers.get('location'));
  assert.equal(redirect.origin, 'https://github.com');
  assert.equal(redirect.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(redirect.searchParams.get('redirect_uri'), config.apiOrigin + PRODUCT_PATH + '/auth/github/callback');
  const record = f.calls.find(call => call[0] === 'oauth')[1];
  assert.notEqual(record.stateHash, redirect.searchParams.get('state'));
  assert.match(response.headers.get('set-cookie'), /__Host-g8s_oauth=.*; Path=\/; HttpOnly; Secure; SameSite=Lax/u);
  assert.ok(!response.headers.get('set-cookie').includes('Domain='));
});

test('exhausted OAuth admission returns a bounded error without a redirect or cookie', async t => {
  const f = await fixture(t, { async createOAuth() { reject('rate_limited', 429); } });
  const response = await f.request('/auth/github/start');
  assert.equal(response.status, 429);
  assert.equal((await response.json()).error.code, 'rate_limited');
  assert.equal(response.headers.get('location'), null);
  assert.equal(response.headers.get('set-cookie'), null);
});

test('an installation callback id without browser-bound state never binds repositories', async t => {
  const f = await fixture(t);
  const response = await f.request('/auth/github/setup?installation_id=123&state=attacker', { headers: auth });
  assert.equal(response.status, 400);
  assert.deepEqual(f.calls, []);
});

test('configuration validates known fields and rejects caller identity injection', async t => {
  const f = await fixture(t);
  const response = await f.request('/orgs/owner/settings/configuration', { method: 'PUT', headers: mutating,
    body: JSON.stringify({ configuration: CONFIGURATION_DEFAULTS, userId: 'another-user' }) });
  assert.equal(response.status, 400);
  assert.ok(!f.calls.some(call => call[0] === 'save'));
});

test('audit export quotes cells and neutralizes spreadsheet formulas', () => {
  const csv = auditCSV([{ timestamp: '2026-01-01T00:00:00Z', user: { login: '=COMMAND()' }, action: '+formula',
    details: { note: 'quoted " text\nnewline' } }]);
  assert.match(csv, /"'=COMMAND\(\)"/u);
  assert.match(csv, /"'\+formula"/u);
  assert.ok(csv.endsWith('\r\n'));
});
