import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createProductClient, ProductError, PRODUCT_PATH, reportFilters, costDisplay, githubPullRequestHref } from '../integrations/base44/product/product-client.mjs';
import { parseFilters } from '../scripts/product/contracts.mjs';
import { createProductService } from '../scripts/product/service.mjs';
import { sha256 } from '../scripts/product/github.mjs';
import { SCREEN_READS } from '../integrations/base44/product/react-bindings.mjs';

const BASE = 'https://api.g8s.test' + PRODUCT_PATH;
const ID = '12345678-1234-4234-8234-123456789abc';
const NOW = new Date('2026-11-08T12:00:00Z');
const success = data => new Response(JSON.stringify({ data }), { headers: { 'Content-Type': 'application/json' } });
const errorResponse = (code, status) => new Response(JSON.stringify({ error: { code, message: 'PRIVATE RAW SERVER VALUE' } }),
  { status, headers: { 'Content-Type': 'application/json' } });
const client = fetcher => createProductClient({ baseUrl: BASE, mode: 'live', fetcher, now: () => NOW });

for (const mode of [undefined, 'preview', 'unknown']) test('preview lock blocks reads, writes and navigation: ' + mode, async () => {
  let calls = 0; const c = createProductClient({ baseUrl: BASE, mode, fetcher() { calls++; } });
  for (const [action, params] of [['session', {}], ['savePause', { confirmed: true, paused: false, reason: 'test' }]])
    await assert.rejects(c.call(action, params), { code: 'preview_only' });
  assert.throws(() => c.navigation('signin'), { code: 'preview_only' }); assert.equal(calls, 0);
});
for (const baseUrl of ['', undefined, 'http://api.g8s.test' + PRODUCT_PATH, BASE + '?secret=x', BASE + '#fragment',
  'https://user:pass@api.g8s.test' + PRODUCT_PATH, 'https://api.g8s.test/x/../gatekeeper/product-v1', BASE + '/extra'])
  test('invalid API base fails without a request: ' + String(baseUrl), async () => {
    let calls = 0; const c = createProductClient({ mode: 'live', baseUrl, fetcher() { calls++; } });
    await assert.rejects(c.call('session'), { code: 'setup_required' }); assert.equal(calls, 0);
  });

const routes = [
  ['session', {}, 'GET', '/session'], ['logout', {}, 'POST', '/auth/logout'],
  ['overview', { slug: 'team' }, 'GET', '/orgs/team/overview'], ['reviews', { slug: 'team' }, 'GET', '/orgs/team/reviews'],
  ['run', { slug: 'team', id: ID }, 'GET', '/orgs/team/runs/' + ID],
  ['finding', { slug: 'team', id: ID, status: 'closed' }, 'PUT', '/orgs/team/findings/' + ID],
  ['settings', { slug: 'team', section: 'audit', page: 2 }, 'GET', '/orgs/team/settings/audit'],
  ['saveSettings', { slug: 'team', section: 'configuration', value: { configuration: {}, revision: 3 } }, 'PUT', '/orgs/team/settings/configuration'],
  ['repositories', { slug: 'team', filters: { search: 'a&b' } }, 'GET', '/orgs/team/repositories'],
  ['saveRepository', { slug: 'team', id: '1234', value: { enabled: false } }, 'PATCH', '/orgs/team/repositories/1234'],
  ['refreshRepositories', { slug: 'team' }, 'POST', '/orgs/team/repositories/refresh'],
  ['disableAllRepositories', { slug: 'team', confirmed: true }, 'POST', '/orgs/team/repositories/disable-all'],
  ['saveMember', { slug: 'team', id: ID, value: { role: 'member' } }, 'PATCH', '/orgs/team/members/' + ID],
  ['removeMember', { slug: 'team', id: ID, confirmed: true }, 'DELETE', '/orgs/team/members/' + ID],
  ['admin', { section: 'users' }, 'GET', '/admin/users'],
  ['saveLimits', { id: ID, value: { monthlyRunLimit: 10, maxConcurrentRuns: 1 } }, 'PUT', '/admin/users/' + ID + '/limits'],
  ['savePause', { paused: true, reason: 'Test only', confirmed: true }, 'PUT', '/admin/controls'],
];
for (const [action, params, method, path] of routes) test('fixed route contract: ' + action, async () => {
  let count = 0;
  const c = client(async (url, options) => {
    count++; const parsed = new URL(url); assert.equal(parsed.origin + parsed.pathname, BASE + path);
    assert.equal(options.method, method); assert.equal(options.credentials, 'include');
    assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.referrerPolicy, 'no-referrer'); assert.equal(options.headers.Authorization, undefined);
    if (method !== 'GET') { assert.equal(options.headers['X-G8S-Request'], '1'); assert.equal(options.headers['Content-Type'], 'application/json'); }
    else assert.equal(options.body, undefined);
    if (action === 'repositories') assert.equal(parsed.searchParams.get('search'), 'a&b');
    return success({ saved: true });
  });
  assert.deepEqual(await c.call(action, params), { saved: true }); assert.equal(count, 1);
});

test('dates and filters match the backend contract with explicit UTC defaults', () => {
  for (const input of [{}, { from: '2026-10-01', to: '2026-10-31', groupBy: 'weekly', merged: false, window: 7, page: 3 }, { repository: '123456' }]) {
    const filters = reportFilters(input, NOW), actual = parseFilters(new URLSearchParams(Object.entries(filters).map(([k, v]) => [k, String(v)])), NOW);
    assert.deepEqual({ ...filters, merged: filters.merged ?? null }, actual);
  }
});
for (const filters of [{ from: '2026-02-30' }, { to: '2026-13-01' }, { from: '2026-11-09', to: '2026-11-08' },
  { from: '2024-01-01', to: '2026-11-08' }, { page: -1 }, { page: '2' }, { groupBy: 'monthly' },
  { repository: ID }, { merged: 'false' }, { window: 14 }, { unknown: 1 }, { to: '' }])
  test('invalid report filters never fetch: ' + JSON.stringify(filters), async () => {
    let calls = 0; await assert.rejects(client(async () => { calls++; return success({}); }).call('overview', { slug: 'team', filters }), { code: 'invalid_request' });
    assert.equal(calls, 0);
  });

test('arbitrary routes, product aliases and unconfirmed destructive actions are unavailable', async () => {
  let calls = 0; const c = client(async () => { calls++; return success({}); });
  for (const [action, params] of [['https://foreign.test', {}], ['run', { slug: '../admin', id: ID }],
    ['settings', { slug: 'team', section: '../users' }], ['saveRepository', { slug: 'team', id: ID, value: {} }],
    ['disableAllRepositories', { slug: 'team' }], ['removeMember', { slug: 'team', id: ID }],
    ['savePause', { paused: false, reason: '', confirmed: true }]]) await assert.rejects(c.call(action, params), { code: 'invalid_request' });
  assert.equal(calls, 0);
});

test('OAuth navigation is explicit and limited to fixed signin/install endpoints', () => {
  let calls = 0; const c = client(() => { calls++; });
  assert.equal(c.navigation('signin'), BASE + '/auth/github/start');
  assert.equal(c.navigation('install', { slug: 'team' }), BASE + '/auth/github/install?org=team');
  assert.throws(() => c.navigation('https://foreign.test'), { code: 'invalid_request' });
  assert.equal(calls, 0);
});
for (const response of [() => new Response('<html>private</html>', { headers: { 'Content-Type': 'text/html' } }),
  () => new Response('{bad', { headers: { 'Content-Type': 'application/json' } }),
  () => success(null), () => success([]), () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })])
  test('malformed successful response is not empty success', async () => {
    await assert.rejects(client(async () => response()).call('session'), { code: 'protocol_error' });
  });

test('oversized JSON is cancelled and never returned', async () => {
  await assert.rejects(client(async () => success({ text: 'x'.repeat(2 * 1024 * 1024) })).call('session'), { code: 'protocol_error' });
});
for (const [code, status] of [['unauthenticated', 401], ['forbidden', 403], ['revision_conflict', 409]])
  test('safe server error mapping: ' + code, async () => {
    await assert.rejects(client(async () => errorResponse(code, status)).call('session'), error => {
      assert.equal(error.code, code); assert.equal(error.status, status); assert.equal(error.message.includes('PRIVATE'), false); return true;
    });
  });
for (const behavior of ['network', '500', 'bad-success']) test('ambiguous write is never automatically replayed: ' + behavior, async () => {
  let count = 0; const c = client(async () => {
    count++; if (behavior === 'network') throw new TypeError('PRIVATE NETWORK DATA');
    return behavior === '500' ? errorResponse('product_unavailable', 500) : new Response('bad');
  });
  await assert.rejects(c.call('saveRepository', { slug: 'team', id: '123', value: { enabled: true } }), error => {
    assert.equal(error.uncertain, true); assert.equal(error.message.includes('PRIVATE'), false); return true;
  }); assert.equal(count, 1);
});

test('abort before dispatch issues no request; timeout after dispatch marks a write uncertain', async () => {
  let count = 0; const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(client(async () => { count++; }).call('logout', {}, { signal: cancelled.signal }), { code: 'aborted', uncertain: false });
  assert.equal(count, 0);
  const c = createProductClient({ mode: 'live', baseUrl: BASE, timeoutMs: 5,
    fetcher: (_url, options) => new Promise((_resolve, reject) => { count++; options.signal.addEventListener('abort', () => reject(new Error('aborted'))); }) });
  await assert.rejects(c.call('logout'), { code: 'timeout', uncertain: true }); assert.equal(count, 1);
});

test('audit CSV stays inert text with a fixed filename', async () => {
  const csv = '"Timestamp","User"\r\n"test","name"\r\n';
  const c = client(async (url) => {
    assert.equal(new URL(url).pathname, PRODUCT_PATH + '/orgs/team/audit/export');
    return new Response(csv, { headers: { 'Content-Type': 'text/csv; charset=utf-8' } });
  });
  assert.deepEqual(await c.call('auditExport', { slug: 'team' }), { filename: 'g8s-audit.csv', text: csv });
});

test('cost and external-link projections do not fabricate values or trust arbitrary URLs', () => {
  assert.deepEqual(costDisplay({ modelSpendUsd: 0 }), { label: 'Reconciled spend (USD)', value: 0 });
  assert.deepEqual(costDisplay({ modelSpendUsd: null, estimatedModelCostUsd: 2, costComplete: false }), { label: 'Unavailable', value: null });
  assert.match(costDisplay({ knownEstimatedModelCostUsd: 0, costComplete: false }).label, /incomplete/u);
  assert.equal(costDisplay({ costComplete: true, estimatedModelCostUsd: 0 }).value, 0);
  assert.equal(costDisplay({ modelSpendUsd: -1 }).value, null);
  for (const url of ['javascript:alert(1)', 'https://github.com.evil.test/a/b/pull/1', 'https://user@github.com/a/b/pull/1']) assert.equal(githubPullRequestHref(url), null);
  assert.equal(githubPullRequestHref('https://github.com/a/b/pull/1?token=redacted'), 'https://github.com/a/b/pull/1');
  assert.equal(SCREEN_READS.adminUsers.action, 'admin'); assert.equal(SCREEN_READS.runDetail.action, 'run');
});

test('client talks to actual product handlers with synthetic cookie/origin transport', async t => {
  const sessionToken = 'TEST_ONLY_SESSION'.padEnd(43, '_'), calls = [];
  const service = createProductService({ config: { apiOrigin: 'https://api.g8s.test', frontendOrigin: 'https://g8s.test',
    adminGithubIds: new Set(), githubClientId: 'TEST_ONLY', githubAppSlug: 'test-only', webhookSecret: 'test-only' }, github: {},
    store: {
      async getSession(hash) { assert.equal(hash, sha256(sessionToken)); return { user: { id: ID, githubId: '101', login: 'test' }, organizations: [] }; },
      async overview(userId, slug, filters) { calls.push({ userId, slug, filters }); return { hasData: false, filters }; },
      async resolveFinding(userId, slug, id, value) { calls.push({ userId, slug, id, value }); return { id, ...value }; },
    } });
  t.after(() => service.stop());
  const c = client(async (url, options) => {
    const request = Readable.from(options.body ? [Buffer.from(options.body)] : []);
    request.url = new URL(url).pathname + new URL(url).search; request.method = options.method;
    request.headers = { origin: 'https://g8s.test', cookie: '__Host-g8s_session=' + sessionToken,
      ...Object.fromEntries(Object.entries(options.headers).map(([key, value]) => [key.toLowerCase(), value])) };
    return new Promise((resolve, reject) => {
      const response = { status: null, headers: null, destroyed: false, writableEnded: false, headersSent: false,
        writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; },
        end(body) { this.writableEnded = true; resolve(new Response(body, { status: this.status, headers: this.headers })); },
        destroy() { reject(new Error('synthetic response destroyed')); } };
      service.handler(request, response).catch(reject);
    });
  });
  assert.equal((await c.call('overview', { slug: 'team', filters: { merged: false } })).hasData, false);
  assert.deepEqual(await c.call('finding', { slug: 'team', id: ID, status: 'closed' }), { id: ID, status: 'closed' });
  assert.equal(calls[0].slug, 'team'); assert.equal(calls[0].filters.merged, false);
  await assert.rejects(c.call('admin', { section: 'users' }), { code: 'forbidden', status: 403 });
});
