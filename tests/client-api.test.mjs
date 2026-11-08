import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createClientApi, clientPrincipal, configuredClientApi, CLIENT_API_PATH } from '../scripts/product/client-api.mjs';
import { tokenHash, validateReviewRequest, validateKeyRequest, validateIdempotency } from '../scripts/product/client-api-store.mjs';

const encoded = Buffer.alloc(32, 7).toString('base64url');
const token = 'g8s_v1_' + encoded;
const bearer = { authorization: 'Bearer ' + token };
const browser = { cookie: '__Host-g8s_session=' + encoded, origin: 'https://g8s.test', 'x-g8s-request': '1' };
const root = CLIENT_API_PATH + '/orgs/alpha';
const runId = '11111111-1111-4111-8111-111111111111';
const keyId = '22222222-2222-4222-8222-222222222222';
const review = { repositoryId: '101', prNumber: 7, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) };
const keyRequest = { name: 'Synthetic test', repositoryIds: ['101'], scopes: ['reviews:read', 'reviews:write'], expiresInDays: 7 };
const idempotency = 'synthetic-review-0001';
const error = (code, status) => Object.assign(new Error('PRIVATE_DETAIL_MUST_NOT_LEAK'), { code, status });

function fixture(overrides = {}, githubOverrides = {}) {
  const calls = [];
  const defaults = {
    rate: async () => {}, listKeys: async () => ({ keys: [] }), issueKey: async () => ({ key: { id: keyId }, token, shownOnce: true }),
    revokeKey: async () => ({ id: keyId, revoked: true }), existingRequest: async () => null,
    repository: async () => ({ user: { id: 'user', login: 'owner', github_id: '77' },
      repository: { full_name: 'synthetic/repository', github_installation_id: '50' } }),
    submit: async () => ({ runId, duplicate: false }), run: async () => ({ run: { id: runId, status: 'queued' }, findings: [] }),
  };
  const store = Object.fromEntries(Object.keys(defaults).map(name => [name, async (...args) => {
    calls.push({ name, args }); return (overrides[name] || defaults[name])(...args);
  }]));
  const access = { mayCommand: async () => true, pullRequest: async () => ({ number: 7, head: { sha: review.headSha }, base: { sha: review.baseSha } }), ...githubOverrides };
  const github = { installationClient: async (...args) => { calls.push({ name: 'github', args }); return access; } };
  const api = createClientApi({ store, github, config: { apiOrigin: 'https://api.g8s.test', frontendOrigin: 'https://g8s.test' },
    fallback(req, res) { calls.push({ name: 'fallback', args: [req.url] }); res.writeHead(418); res.end('existing-handler'); } });
  async function request(method, path, { headers = bearer, body, rawHeaders } = {}) {
    const bytes = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
    const requestHeaders = { ...(body === undefined ? {} : { 'content-type': 'application/json' }), ...headers };
    const req = Readable.from([Buffer.from(bytes)]);
    Object.assign(req, { method, url: path, headers: requestHeaders,
      rawHeaders: rawHeaders || Object.entries(requestHeaders).flat(), setTimeout() {} });
    const res = { headersSent: false, status: null, headers: {}, body: '',
      writeHead(status, values = {}) { this.status = status; this.headers = values; this.headersSent = true; },
      end(value = '') { this.body = value; }, destroy() { this.destroyed = true; } };
    await api.handler(req, res);
    return { ...res, json: res.body.startsWith('{') ? JSON.parse(res.body) : null };
  }
  return { api, calls, request };
}

for (const headers of [bearer, browser]) test('principal holds only the credential digest: ' + (headers.authorization ? 'key' : 'session'), () => {
  const principal = clientPrincipal({ headers, rawHeaders: Object.entries(headers).flat() });
  assert.equal(principal.kind, headers.authorization ? 'key' : 'session');
  assert.equal(principal.hash, tokenHash(headers.authorization ? token : encoded));
  assert.equal(JSON.stringify(principal).includes(encoded), false);
});
for (const headers of [{}, { authorization: 'Bearer invalid' }, { authorization: 'Basic anything' },
  { ...bearer, cookie: browser.cookie }, { cookie: browser.cookie + '; ' + browser.cookie },
  { authorization: 'Bearer g8s_v1_' + encoded.slice(0, -1) + 'B' }]) {
  test('malformed or mixed authentication is refused: ' + JSON.stringify(Object.keys(headers)), () => {
    assert.throws(() => clientPrincipal({ headers }), { code: 'unauthenticated', status: 401 });
  });
}
for (const name of ['Authorization', 'Cookie', 'Origin', 'X-G8S-Request', 'Idempotency-Key']) {
  test('duplicate security header is refused: ' + name, () => {
    assert.throws(() => clientPrincipal({ headers: bearer, rawHeaders: [name, 'first', name.toLowerCase(), 'second'] }),
      { code: 'invalid_request', status: 400 });
  });
}

test('review request canonicalization preserves exact revision identity', () => {
  assert.deepEqual(validateReviewRequest({ baseSha: review.baseSha, headSha: review.headSha, prNumber: 7, repositoryId: '101' }), review);
  assert.equal(validateIdempotency(idempotency), tokenHash(idempotency));
});
for (const patch of [{ repositoryId: 101 }, { repositoryId: ['101'] }, { prNumber: '7' }, { prNumber: 0 },
  { prNumber: 2147483648 }, { headSha: [review.headSha] }, { baseSha: [review.baseSha] },
  { headSha: 'a'.repeat(39) }, { model: 'caller-model' }, { org: 'foreign' }]) {
  test('review input refuses type coercion and extra authority fields: ' + Object.keys(patch).join(','), () => {
    assert.throws(() => validateReviewRequest({ ...review, ...patch }), { code: 'invalid_request' });
  });
}
for (const patch of [{ scopes: ['admin'] }, { scopes: ['reviews:read', 'reviews:read'] }, { scopes: [] },
  { repositoryIds: [] }, { repositoryIds: ['101', '101'] }, { repositoryIds: [101] }, { expiresInDays: 0 },
  { expiresInDays: 91 }, { expiresInDays: '7' }, { name: '\nprivate' }, { extra: true }]) {
  test('client key input stays bounded and scoped: ' + Object.keys(patch).join(','), () => {
    assert.throws(() => validateKeyRequest({ ...keyRequest, ...patch }), { code: 'invalid_request' });
  });
}

test('client route leaves original app routes to the original handler', async () => {
  const f = fixture(); const res = await f.request('GET', '/gatekeeper/product-v1/session');
  assert.equal(res.status, 418); assert.equal(f.calls[0].name, 'fallback');
});
for (const suffix of ['/reviews?token=x', '/%72eviews', '/reviews/../keys', '/reviews#x', '/reviews\\x']) {
  test('noncanonical client path is refused: ' + suffix, async () => {
    const f = fixture(); const res = await f.request('GET', root + suffix);
    assert.equal(res.status, 400); assert.equal(f.calls.length, 0);
  });
}

test('a valid key submits only an asynchronous review and returns its stable status route', async () => {
  const f = fixture(); const res = await f.request('POST', root + '/reviews', { headers: { ...bearer, 'idempotency-key': idempotency }, body: review });
  assert.equal(res.status, 202); assert.equal(res.json.data.runId, runId);
  assert.equal(res.json.data.execution, 'asynchronous'); assert.equal(res.json.data.comparisonAvailable, false);
  assert.equal(res.headers.Location, root + '/reviews/' + runId);
  assert.deepEqual(f.calls.map(x => x.name), ['rate', 'existingRequest', 'repository', 'github', 'submit']);
  const submitted = f.calls.at(-1).args;
  assert.deepEqual(submitted[2], review); assert.equal(submitted[3], idempotency);
  assert.equal(res.body.includes(token), false); assert.match(res.headers['Cache-Control'], /no-store/u);
});
test('a repeated idempotent request does not call GitHub or enqueue again', async () => {
  const f = fixture({ existingRequest: async () => ({ runId, duplicate: true }) });
  const res = await f.request('POST', root + '/reviews', { headers: { ...bearer, 'idempotency-key': idempotency }, body: review });
  assert.equal(res.status, 202); assert.equal(res.json.data.duplicate, true);
  assert.deepEqual(f.calls.map(x => x.name), ['rate', 'existingRequest']);
});
test('current GitHub permission is required before admission', async () => {
  const f = fixture({}, { mayCommand: async () => false });
  const res = await f.request('POST', root + '/reviews', { headers: { ...bearer, 'idempotency-key': idempotency }, body: review });
  assert.equal(res.status, 403); assert.equal(f.calls.some(x => x.name === 'submit'), false);
});
for (const headers of [{ cookie: browser.cookie }, { ...browser, origin: 'https://foreign.test' },
  { ...browser, 'x-g8s-request': '0' }]) {
  test('browser mutation without exact CSRF boundary is refused: ' + JSON.stringify(Object.keys(headers)), async () => {
    const f = fixture(); const res = await f.request('POST', root + '/keys', { headers, body: keyRequest });
    assert.equal(res.status, 403); assert.equal(f.calls.length, 0);
  });
}
test('session key issuance is explicit and secret is returned only by that response', async () => {
  const f = fixture(); const issued = await f.request('POST', root + '/keys', { headers: browser, body: keyRequest });
  assert.equal(issued.status, 201); assert.equal(issued.json.data.shownOnce, true);
  assert.equal(issued.headers['Access-Control-Allow-Origin'], browser.origin);
  assert.equal(issued.headers['Access-Control-Allow-Credentials'], 'true');
  const listed = await f.request('GET', root + '/keys', { headers: browser });
  assert.equal(listed.status, 200); assert.equal(listed.body.includes(token), false);
  const revoked = await f.request('DELETE', root + '/keys/' + keyId, { headers: browser });
  assert.equal(revoked.status, 200); assert.equal(revoked.json.data.revoked, true);
});
for (const method of ['GET', 'POST', 'DELETE']) test('client API keys cannot administer credentials: ' + method, async () => {
  const f = fixture(); const res = await f.request(method, root + '/keys' + (method === 'DELETE' ? '/' + keyId : ''),
    { body: method === 'POST' ? keyRequest : undefined });
  assert.equal(res.status, 403); assert.deepEqual(f.calls.map(x => x.name), ['rate']);
});
test('scoped result reads use the authorized store, not caller owner claims', async () => {
  const f = fixture(); const res = await f.request('GET', root + '/reviews/' + runId);
  assert.equal(res.status, 200); assert.equal(res.json.data.run.status, 'queued');
  assert.deepEqual(f.calls.map(x => x.name), ['rate', 'run']);
  assert.equal(f.calls.at(-1).args[1], 'alpha');
});
test('CORS preflight permits only the configured frontend and known headers', async () => {
  const f = fixture(); const okay = await f.request('OPTIONS', root + '/reviews', { headers: {
    origin: browser.origin, 'access-control-request-headers': 'Content-Type, X-G8S-Request, Idempotency-Key' } });
  assert.equal(okay.status, 204); assert.equal(f.calls.length, 0);
  const wrong = await f.request('OPTIONS', root + '/reviews', { headers: { origin: 'https://foreign.test' } });
  assert.equal(wrong.status, 403);
});
for (const [name, headers, body, status] of [
  ['missing idempotency', bearer, review, 400],
  ['wrong content type', { ...bearer, 'content-type': 'text/plain', 'idempotency-key': idempotency }, review, 415],
  ['malformed JSON', { ...bearer, 'idempotency-key': idempotency }, '{', 400],
  ['oversized JSON', { ...bearer, 'idempotency-key': idempotency }, ' '.repeat(16385), 413],
]) test('bounded request refusal: ' + name, async () => {
  const f = fixture(); const res = await f.request('POST', root + '/reviews', { headers, body });
  assert.equal(res.status, status); assert.equal(f.calls.some(x => x.name === 'github' || x.name === 'submit'), false);
});
for (const [code, status] of [['rate_limited', 429], ['idempotency_conflict', 409], ['unauthenticated', 401], ['unknown_private_error', 500]]) {
  test('safe errors contain no private exception text: ' + code, async () => {
    const f = fixture({ rate: async () => { throw error(code, status); } });
    const res = await f.request('GET', root + '/reviews/' + runId);
    assert.equal(res.status, code === 'unknown_private_error' ? 503 : status);
    assert.equal(res.body.includes('PRIVATE_DETAIL'), false);
    if (status === 429) assert.equal(res.headers['Retry-After'], '60');
  });
}
test('disabled API adds no database dependency or side effect', async () => {
  const fallback = () => {}; const product = new Proxy({}, { get() { assert.fail('disabled API cannot read product store'); } });
  const api = await configuredClientApi({ env: {}, product, fallback }); assert.equal(api.handler, fallback); api.stop();
});
test('stopping refuses client requests without touching the queue', async () => {
  const f = fixture(); f.api.stop(); const res = await f.request('GET', root + '/reviews/' + runId);
  assert.equal(res.status, 503); assert.equal(f.calls.length, 0);
});
