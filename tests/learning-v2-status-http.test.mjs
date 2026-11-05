import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, copy, version } from '../scripts/learning-v2/contracts.mjs';
import { statusView } from '../scripts/learning-v2/prompts.mjs';
import { createLearningStatusEndpoint, createLearningStatusTokenAuthenticator }
  from '../scripts/learning-v2/status-endpoint.mjs';
import { createLearningStatusBackend } from '../integrations/base44/shared/learning-status-backend.js';
import { LEARNING_STATUS_PATH, PUBLIC_LEARNING_STATUS_PATH, MAX_STATUS_BYTES }
  from '../integrations/base44/shared/learning-status-contract.js';

// SOURCE ONLY for the managed remote gate. The HTTP handlers, authenticator and
// public host projection are real; identity, secrets, clocks and fetch are fixtures.
// No test below starts a server, reads a journal or receives a learning mutation capability.
const NOW = Date.UTC(2026, 10, 4, 12);
const BINDING = Object.freeze({ ownerId: 'owner-fixture', experimentId: 'status-fixture',
  sourceCommit: 'b'.repeat(40) });
const TOKEN = 'READ_TOKEN_PRIVATE_CANARY_' + 'x'.repeat(24);
const USERNAME = 'proxy-fixture-user';
const PASSWORD = 'BASIC_PASSWORD_PRIVATE_CANARY';
const BASIC = 'Basic ' + Buffer.from(`${USERNAME}:${PASSWORD}`).toString('base64');
const PRIVATE = 'PRIVATE_HOST_STATE_CANARY';
const ERROR = 'PRIVATE_SERVICE_ERROR_CANARY';
const BROWSER_AUTH = 'BROWSER_AUTH_PRIVATE_CANARY';
const PROXY_URL = 'https://proxy-production-9553.up.railway.app' + PUBLIC_LEARNING_STATUS_PATH;
const BROWSER_URL = 'https://base44.example/functions/getLearningStatus';
const OWNER_SECRET = 'GATEKEEPER_LEARNING_OWNER_ID';
const fixedClock = () => new Date(NOW);
const grant = () => ({ ...BINDING, permission: 'learning:status:read' });

function hostFixture(pending = false) {
  const base = { ...version(`Review source: ${PRIVATE}`, []), confirmed: true, origin: 'frozen-base' };
  const state = { config: { ...BINDING, scope: 'concurrency', baseInstructions: PRIVATE },
    policy: copy(POLICY), baseVersion: base, activeVersionId: base.id, versions: [base],
    attempts: [], operations: [], activationHistory: [], baseline: null, baselineError: null,
    baselineNonAdmission: null, baselinePlan: pending ? { privatePlan: PRIVATE } : null,
    budget: { spentMicros: 0, reservedMicros: 0, privateReceipt: PRIVATE },
    gate: pending ? { privateEvidence: PRIVATE } : null, history: [{ privateFeedback: PRIVATE }] };
  return { state, status: () => ({ ...statusView(state, { pendingOperationId: pending ? 'operation:fixture' : null }),
    dispatch: { pending: pending ? { operationId: 'operation:fixture', kind: 'baseline',
      stage: 'admission-intent' } : null, completed: 0 } }) };
}

function envelope(status = hostFixture().status(), checkedAt = new Date(NOW).toISOString()) {
  return { schema: 'gk-learning-v2-status-response', checkedAt, status };
}

function endpointRequest({ path = LEARNING_STATUS_PATH, method = 'GET', owner = BINDING.ownerId,
  token = TOKEN, headers = {} } = {}) {
  const values = new Headers(headers);
  if (owner !== null) values.set('X-Gatekeeper-Learning-Owner', owner);
  if (token !== null) values.set('X-Gatekeeper-Learning-Token', token);
  return new Request('https://runner.example' + path, { method, headers: values });
}

function browserRequest({ url = BROWSER_URL, method = 'POST', body = '{}',
  contentType = 'application/json', headers = {} } = {}) {
  const values = new Headers({ Authorization: BROWSER_AUTH, ...headers });
  if (contentType !== null) values.set('Content-Type', contentType);
  const options = { method, headers: values };
  if (!['GET', 'HEAD'].includes(method)) {
    options.body = body;
    if (body instanceof ReadableStream) options.duplex = 'half';
  }
  return new Request(url, options);
}

function upstream(value = envelope(), { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(value), { status,
    headers: { 'Content-Type': 'application/json', ...headers } });
}

function observedStream(chunks) {
  const observed = { pulls: 0, cancelled: 0 };
  const stream = new ReadableStream({
    pull(controller) {
      const index = observed.pulls++;
      if (index < chunks.length) controller.enqueue(new TextEncoder().encode(chunks[index]));
      else controller.close();
    },
    cancel() { observed.cancelled++; },
  }, { highWaterMark: 0 });
  return { stream, observed };
}

async function responseBody(response, status, error = null) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store, max-age=0');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  assert.match(response.headers.get('Content-Type'), /^application\/json\b/i);
  for (const name of ['Set-Cookie', 'Location', 'Authorization', 'X-Gatekeeper-Learning-Token']) {
    assert.equal(response.headers.get(name), null, `private upstream header: ${name}`);
  }
  const text = await response.text();
  for (const value of [TOKEN, PASSWORD, BASIC, PRIVATE, ERROR, BROWSER_AUTH]) {
    assert.equal(text.includes(value), false, 'response must contain no credential, host-private text or raw error');
  }
  const value = JSON.parse(text);
  if (error !== null) assert.deepEqual(value, { error });
  return value;
}

function backendFixture({ user = { id: BINDING.ownerId, role: 'admin' }, secrets = {}, authenticate,
  readSecret, fetchImpl, clock = fixedClock } = {}) {
  const configured = { [OWNER_SECRET]: BINDING.ownerId,
    GATEKEEPER_LEARNING_EXPERIMENT_ID: BINDING.experimentId,
    GATEKEEPER_LEARNING_SOURCE_COMMIT: BINDING.sourceCommit,
    GATEKEEPER_LEARNING_READ_TOKEN: TOKEN, ...secrets };
  const events = [], secretReads = [], fetchCalls = [];
  const handle = createLearningStatusBackend({
    authenticate: async request => { events.push('authenticate');
      return authenticate ? authenticate(request) : user; },
    readSecret: name => { events.push(`secret:${name}`); secretReads.push(name);
      return readSecret ? readSecret(name, configured) : configured[name]; },
    fetchImpl: async (url, init) => { events.push('fetch'); fetchCalls.push({ url, init });
      return fetchImpl ? fetchImpl(url, init) : upstream(); }, clock,
  });
  return { handle, events, secretReads, fetchCalls, configured };
}

test('status token authenticates only a captured fixed binding and ignores caller identity claims', async () => {
  const binding = { ...BINDING };
  const authenticate = createLearningStatusTokenAuthenticator({ readToken: TOKEN, binding });
  binding.ownerId = 'changed-owner';
  const request = endpointRequest({ path: LEARNING_STATUS_PATH + '?ownerId=forged', owner: 'forged-owner',
    headers: { 'X-Experiment-Id': 'forged-experiment' } });
  const first = await authenticate(request);
  assert.deepEqual(first, grant());
  first.ownerId = 'mutated-return-value';
  assert.deepEqual(await authenticate(request), grant());
  for (const token of [null, 'short', 'z'.repeat(48), 'x'.repeat(257)]) {
    assert.equal(await authenticate(endpointRequest({ token })), null);
  }
  assert.throws(() => createLearningStatusTokenAuthenticator({ readToken: 'short', binding: BINDING }));
  assert.throws(() => createLearningStatusTokenAuthenticator({ readToken: TOKEN,
    binding: { ...BINDING, sourceCommit: 'not-a-commit' } }));
});

test('endpoint reads the actual public projection once and leaves unplanned and pending host state unchanged', async () => {
  for (const pending of [false, true]) {
    const host = hostFixture(pending), before = copy(host.state), events = [];
    const endpoint = createLearningStatusEndpoint({ binding: BINDING, clock: fixedClock,
      authenticate: async () => { events.push('authenticate'); return grant(); },
      readStatus: () => { events.push('read'); return host.status(); } });
    const value = await responseBody(await endpoint(endpointRequest()), 200);
    assert.deepEqual(value, envelope(host.status()));
    assert.deepEqual(events, ['authenticate', 'read']);
    assert.deepEqual(host.state, before);
    assert.equal(value.status.baseline.status, pending ? 'planned' : 'not-planned');
    assert.equal(value.status.dispatch.pending?.stage ?? null, pending ? 'admission-intent' : null);
    assert.deepEqual(value.status.counts, { attempted: 0, scored: 0, duplicate: 0, unresolved: 0,
      invalid: 0, noCoverage: 0, rejected: 0, provisional: 0, confirmed: 0, activated: 0 });
  }
});

test('endpoint refuses routing, grant and owner assertion errors before reading host status', async () => {
  let reads = 0, authentications = 0;
  const endpoint = createLearningStatusEndpoint({ binding: BINDING, clock: fixedClock,
    authenticate: () => { authentications++; return grant(); }, readStatus: () => { reads++; return hostFixture().status(); } });
  const withBody = new Request('https://runner.example' + LEARNING_STATUS_PATH, { method: 'POST', body: '{}' });
  // Request construction forbids GET bodies; emulate an adapter exposing one.
  Object.defineProperty(withBody, 'method', { value: 'GET' });
  for (const [request, code, error] of [
    [endpointRequest({ path: '/different' }), 404, 'not_found'],
    [endpointRequest({ method: 'POST' }), 405, 'method_not_allowed'],
    [endpointRequest({ path: LEARNING_STATUS_PATH + '?experimentId=foreign' }), 400, 'bad_request'],
    [withBody, 400, 'bad_request'],
  ]) await responseBody(await endpoint(request), code, error);
  assert.equal(authentications, 0);
  for (const owner of [null, 'foreign-owner']) {
    await responseBody(await endpoint(endpointRequest({ owner })), 403, 'forbidden');
  }
  for (const [authenticate, code] of [
    [() => null, 401], [() => { throw new Error(ERROR); }, 401],
    [() => ({ ...grant(), ownerId: 'foreign-owner' }), 403],
    [() => ({ ...grant(), experimentId: 'foreign-experiment' }), 403],
    [() => ({ ...grant(), sourceCommit: 'c'.repeat(40) }), 403],
    [() => ({ ...grant(), permission: 'learning:dispatch' }), 403],
    [() => ({ ...grant(), privateExtra: PRIVATE }), 403],
  ]) {
    const refused = createLearningStatusEndpoint({ binding: BINDING, authenticate, clock: fixedClock,
      readStatus: () => { reads++; return hostFixture().status(); } });
    await responseBody(await refused(endpointRequest()), code, code === 401 ? 'unauthorized' : 'forbidden');
  }
  assert.equal(reads, 0);
  assert.throws(() => createLearningStatusEndpoint({ binding: BINDING, authenticate: () => grant(), readStatus: null }));
});

test('endpoint sanitizes private failures and refuses host projection or source drift', async () => {
  const variants = [
    () => { throw new Error(ERROR); },
    () => ({ ...hostFixture().status(), privateHistory: PRIVATE }),
    () => ({ ...hostFixture().status(), sourceCommit: 'c'.repeat(40) }),
    () => ({ ...hostFixture().status(), experimentId: 'foreign-experiment' }),
    () => ({ ...hostFixture().status(), confirmedVersions: 11 }),
    () => ({ ...hostFixture().status(), incumbentVersion: 'not-a-version' }),
  ];
  for (const readStatus of variants) {
    const endpoint = createLearningStatusEndpoint({ binding: BINDING, authenticate: () => grant(), readStatus, clock: fixedClock });
    await responseBody(await endpoint(endpointRequest()), 503, 'learning_status_unavailable');
  }
});

test('backend authenticates and captures owner identity before secret, body or network access', async () => {
  const cases = [
    [{ user: null }, 401, 'unauthorized', []],
    [{ authenticate: () => { throw new Error(ERROR); } }, 401, 'unauthorized', []],
    [{ user: { role: 'admin' } }, 401, 'unauthorized', []],
    [{ user: { id: BINDING.ownerId, role: 'user' } }, 403, 'forbidden', []],
    [{ user: { id: 'foreign-owner', role: 'admin' } }, 403, 'forbidden', [OWNER_SECRET]],
    [{ secrets: { [OWNER_SECRET]: undefined } }, 503, 'learning_status_unavailable', [OWNER_SECRET]],
  ];
  for (const [options, code, error, reads] of cases) {
    const f = backendFixture(options), body = observedStream(['{}']);
    const request = browserRequest({ body: body.stream });
    await responseBody(await f.handle(request), code, error);
    assert.deepEqual(f.secretReads, reads);
    assert.equal(f.events[0], 'authenticate');
    assert.equal(f.fetchCalls.length, 0);
    assert.equal(body.observed.pulls, 0, 'unauthorized input must not be consumed');
    await request.body.cancel();
  }
  const user = { id: 'foreign-owner', role: 'admin' };
  const f = backendFixture({ user, readSecret: async (name, configured) => {
    user.id = BINDING.ownerId; return configured[name];
  } });
  await responseBody(await f.handle(browserRequest()), 403, 'forbidden');
  assert.deepEqual(f.secretReads, [OWNER_SECRET]);
  assert.equal(f.fetchCalls.length, 0);
});

test('backend accepts only the fixed empty JSON request and cancels early rejected streams', async () => {
  const method = backendFixture();
  await responseBody(await method.handle(browserRequest({ method: 'GET' })), 405, 'method_not_allowed');
  assert.deepEqual(method.events, []);
  for (const body of ['{"experimentId":"foreign"}', '[]', 'null', '{', '', ' '.repeat(1025) + '{}']) {
    const f = backendFixture();
    await responseBody(await f.handle(browserRequest({ body })), 400, 'bad_request');
    assert.deepEqual(f.secretReads, [OWNER_SECRET]);
    assert.equal(f.fetchCalls.length, 0);
  }
  for (const options of [
    { contentType: 'text/plain' },
    { headers: { 'Content-Length': '1025' } },
    { url: BROWSER_URL + '?ownerId=foreign' },
  ]) {
    const f = backendFixture(), body = observedStream(['{}']);
    await responseBody(await f.handle(browserRequest({ ...options, body: body.stream })), 400, 'bad_request');
    assert.deepEqual(f.secretReads, [OWNER_SECRET]);
    assert.equal(f.fetchCalls.length, 0);
    assert.equal(body.observed.pulls, 0, 'early refusal must not read the body');
    assert.equal(body.observed.cancelled, 1, 'early refusal must release the incoming stream');
  }
});

test('backend refuses missing or unsafe server configuration without sending credentials', async () => {
  for (const secrets of [
    { GATEKEEPER_LEARNING_READ_TOKEN: undefined }, { GATEKEEPER_LEARNING_READ_TOKEN: 'short' },
    { GATEKEEPER_LEARNING_READ_TOKEN: 'x'.repeat(257) }, { GATEKEEPER_LEARNING_EXPERIMENT_ID: '../foreign' },
    { GATEKEEPER_LEARNING_SOURCE_COMMIT: 'not-a-commit' },
  ]) {
    const f = backendFixture({ secrets });
    await responseBody(await f.handle(browserRequest()), 503, 'learning_status_unavailable');
    assert.equal(f.fetchCalls.length, 0);
    assert.equal(f.secretReads[0], OWNER_SECRET);
  }
  const f = backendFixture({ readSecret: name => { throw new Error(`${ERROR}:${name}`); } });
  await responseBody(await f.handle(browserRequest()), 503, 'learning_status_unavailable');
  assert.deepEqual(f.secretReads, [OWNER_SECRET]);
  assert.equal(f.fetchCalls.length, 0);
  assert.throws(() => createLearningStatusBackend({ authenticate: null, readSecret: () => null }));
});

test('real backend, token authenticator and endpoint compose a fixed read-only pending status roundtrip', async () => {
  const host = hostFixture(true), before = copy(host.state), order = [];
  const checkedAt = new Date(NOW - 1234).toISOString();
  const endpoint = createLearningStatusEndpoint({ binding: BINDING,
    authenticate: createLearningStatusTokenAuthenticator({ readToken: TOKEN, binding: BINDING }),
    clock: () => new Date(checkedAt), readStatus: () => { order.push('read-status'); return host.status(); } });
  const f = backendFixture({ readSecret: async (name, configured) => configured[name],
    fetchImpl: async (url, init) => {
      assert.equal(url, PROXY_URL);
      assert.equal(init.method, 'GET');
      assert.equal(init.redirect, 'error');
      assert.equal(init.cache, 'no-store');
      assert.equal(Object.hasOwn(init, 'body'), false);
      assert.ok(init.signal instanceof AbortSignal);
      const headers = new Headers(init.headers);
      assert.equal(headers.get('Authorization'), null);
      assert.equal(headers.get('X-Gatekeeper-Learning-Token'), TOKEN);
      assert.equal(headers.get('X-Gatekeeper-Learning-Owner'), BINDING.ownerId);
      assert.equal(headers.get('Accept'), 'application/json');
      assert.equal(headers.get('X-Caller-Private'), null);
      // The separately qualified Caddy route rewrites only this exact path.
      const internalUrl = new URL(url); internalUrl.pathname = LEARNING_STATUS_PATH;
      const result = await endpoint(new Request(internalUrl, { method: init.method, headers, signal: init.signal }));
      result.headers.set('Set-Cookie', PRIVATE);
      return result;
    } });
  const value = await responseBody(await f.handle(browserRequest({ body: ' \n{} \n',
    contentType: 'application/json; charset=utf-8', headers: { 'X-Gatekeeper-Learning-Owner': 'forged-owner',
      'X-Gatekeeper-Learning-Token': 'forged-token', 'X-Caller-Private': PRIVATE } })), 200);
  assert.deepEqual(value, envelope(host.status(), checkedAt));
  assert.deepEqual(host.state, before);
  assert.deepEqual(order, ['read-status']);
  assert.equal(f.fetchCalls.length, 1);
  assert.deepEqual(f.events.slice(0, 2), ['authenticate', `secret:${OWNER_SECRET}`]);
  assert.deepEqual(new Set(f.secretReads), new Set(Object.keys(f.configured)));
});

test('cross-owner token configuration cannot expose the same experiment and source through the bridge', async () => {
  let reads = 0, upstreamStatus = null;
  const foreign = { ...BINDING, ownerId: 'foreign-owner' }, foreignToken = 'F'.repeat(48);
  const endpoint = createLearningStatusEndpoint({ binding: foreign, clock: fixedClock,
    authenticate: createLearningStatusTokenAuthenticator({ readToken: foreignToken, binding: foreign }),
    readStatus: () => { reads++; return hostFixture().status(); } });
  const f = backendFixture({ secrets: { GATEKEEPER_LEARNING_READ_TOKEN: foreignToken },
    fetchImpl: async (url, init) => {
      assert.equal(new Headers(init.headers).get('X-Gatekeeper-Learning-Owner'), BINDING.ownerId);
      const internalUrl = new URL(url); internalUrl.pathname = LEARNING_STATUS_PATH;
      const result = await endpoint(new Request(internalUrl, { method: init.method, headers: init.headers }));
      upstreamStatus = result.status; return result;
    } });
  await responseBody(await f.handle(browserRequest({
    headers: { 'X-Gatekeeper-Learning-Owner': foreign.ownerId },
  })), 503, 'learning_status_unavailable');
  assert.equal(upstreamStatus, 403, 'a valid token for another owner must fail the owner assertion');
  assert.equal(reads, 0);
  assert.equal(f.fetchCalls.length, 1);
});

test('backend sanitizes upstream transport and projection failures without forwarding bodies or headers', async () => {
  const variants = [
    () => upstream({ error: ERROR }, { status: 500, headers: { 'Set-Cookie': PRIVATE, Location: 'https://private.example' } }),
    () => upstream({ error: ERROR }, { status: 302, headers: { Location: 'https://private.example' } }),
    () => { const response = upstream(); Object.defineProperty(response, 'redirected', { value: true }); return response; },
    () => new Response(ERROR, { headers: { 'Content-Type': 'application/json' } }),
    () => new Response(JSON.stringify(envelope()), { headers: { 'Content-Type': 'text/plain' } }),
    () => upstream({ ...envelope(), privateExtra: PRIVATE }),
    () => upstream(envelope({ ...hostFixture().status(), privateHistory: PRIVATE })),
    () => upstream(envelope({ ...hostFixture().status(), sourceCommit: 'c'.repeat(40) })),
    () => upstream(envelope({ ...hostFixture().status(), experimentId: 'foreign-experiment' })),
    () => { throw new Error(ERROR); },
    () => { throw new DOMException(ERROR, 'AbortError'); },
  ];
  for (const fetchImpl of variants) {
    const f = backendFixture({ fetchImpl });
    await responseBody(await f.handle(browserRequest()), 503, 'learning_status_unavailable');
    assert.equal(f.fetchCalls.length, 1);
  }
});

test('backend preserves checkedAt and accepts only the documented freshness window', async () => {
  for (const [age, code] of [[60_000, 200], [-5000, 200], [60_001, 503], [-5001, 503]]) {
    const checkedAt = new Date(NOW - age).toISOString();
    const f = backendFixture({ fetchImpl: () => upstream(envelope(hostFixture().status(), checkedAt)) });
    const value = await responseBody(await f.handle(browserRequest()), code,
      code === 503 ? 'learning_status_unavailable' : null);
    if (code === 200) assert.equal(value.checkedAt, checkedAt, 'bridge must not restamp stale host evidence');
  }
  const f = backendFixture({ fetchImpl: () => upstream(envelope(hostFixture().status(), '2026-11-04T12:00:00Z')) });
  await responseBody(await f.handle(browserRequest()), 503, 'learning_status_unavailable');
});

test('backend bounds actual upstream bytes and cancels overflow before reading the remaining stream', async () => {
  for (const headers of [{}, { 'Content-Length': '1' }]) {
    const body = observedStream([' '.repeat(MAX_STATUS_BYTES + 1), JSON.stringify(envelope())]);
    const f = backendFixture({ fetchImpl: () => new Response(body.stream,
      { headers: { 'Content-Type': 'application/json', ...headers } }) });
    await responseBody(await f.handle(browserRequest()), 503, 'learning_status_unavailable');
    assert.equal(body.observed.pulls, 1, 'actual byte limit must apply without trusting Content-Length');
    assert.equal(body.observed.cancelled, 1);
  }
  const body = observedStream([JSON.stringify(envelope())]);
  const f = backendFixture({ fetchImpl: () => new Response(body.stream,
    { headers: { 'Content-Type': 'application/json', 'Content-Length': String(MAX_STATUS_BYTES + 1) } }) });
  await responseBody(await f.handle(browserRequest()), 503, 'learning_status_unavailable');
  assert.equal(body.observed.pulls, 0);
  assert.equal(body.observed.cancelled, 1);
});

