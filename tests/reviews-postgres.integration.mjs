// REQUIRED remote qualification: real disposable PostgreSQL, never a production DB.
// Missing DB is a hard failure. This file is explicitly invoked by qualify.sh.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { openReviewPool } from '../scripts/reviews/runtime.mjs';
import { ReviewStore } from '../scripts/reviews/store.mjs';
import { reviewRuntime } from '../scripts/reviews/trueforge.mjs';
import { createReviewService } from '../scripts/reviews/service.mjs';
import { REVIEW_APP_ID, REVIEW_PATH } from '../integrations/base44/shared/review-contract.js';

const expectedUrl = 'postgresql://postgres@127.0.0.1:55432/gk_reviews_qualification';
assert.equal(process.env.GK_REVIEWS_TEST_DATABASE_URL, expectedUrl,
  'Real isolated PostgreSQL is mandatory; skipping or a production URL is forbidden.');
for (const key of ['TRUEFORGE_API_KEY', 'TRUEFOUNDRY_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY',
  'GATEKEEPER_REVIEW_TOKEN', 'GATEKEEPER_LEARNING_READ_TOKEN'])
  assert.equal(process.env[key], undefined, 'Qualification must not receive ' + key);

const createPool = () => openReviewPool({ DATABASE_URL: expectedUrl, POSTGRES_SSL_MODE: 'disable' });
const source = 'a'.repeat(40);
const runtime = reviewRuntime({ sourceCommit: source, model: 'fixture/model',
  instructions: readFileSync(new URL('../agent/instructions.md', import.meta.url), 'utf8'),
  checklist: readFileSync(new URL('../agent/skills/review-checklist/SKILL.md', import.meta.url), 'utf8') });
const input = { file: 'private.ts', language: 'typescript', context: 'Return count.', code: 'const count = 1;' };
const token = 'synthetic_' + 'x'.repeat(40);
const tokenHash = createHash('sha256').update(token).digest('hex');
const scope = () => ({ appId: REVIEW_APP_ID, ownerId: 'fixture-' + randomUUID() });

async function setup(t) {
  const first = createPool(), second = createPool();
  t.after(async () => { await first.end(); await second.end(); });
  await first.query(readFileSync(new URL('../scripts/reviews/schema.sql', import.meta.url), 'utf8'));
  return [new ReviewStore(first), new ReviewStore(second)];
}
function invoke(service, owner, command, overrides = {}) {
  const req = Readable.from([Buffer.from(JSON.stringify(command))]);
  Object.assign(req, { url: REVIEW_PATH, method: 'POST', headers: {
    'x-gatekeeper-review-token': token, 'x-gatekeeper-review-owner': owner,
    'x-gatekeeper-review-app': REVIEW_APP_ID, 'x-gatekeeper-review-source': source, ...overrides,
  } });
  return new Promise((resolve, reject) => {
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; },
      end(body) { resolve({ status: this.status, headers: this.headers, body: JSON.parse(body) }); } };
    service.handler(req, res).catch(reject);
  });
}
function provider({ fail = null, mutateSession = null, wrongTurnInput = false } = {}) {
  const calls = { sessions: 0, turns: 0, gets: 0 };
  const requests = new Map();
  const turnRequests = new Map();
  const output = { type: 'model.message', id: 'message-1', threadId: 'main', finishReason: 'stop', content: '{"findings":[]}' };
  const client = { sessions: {
    create: async (request, options) => {
      calls.sessions++; assert.equal(options.maxRetries, 0);
      if (fail === 'session') throw new Error('provider may have accepted session');
      const id = 'session-' + calls.sessions;
      requests.set(id, request);
      const data = JSON.parse(JSON.stringify({ id, shared: false, agent: { type: 'inline', spec: request.agent.spec }, metadata: request.metadata }));
      if (mutateSession) mutateSession(data);
      return { data };
    },
    createTurn: async (sessionId, request, options) => {
      calls.turns++; assert.equal(options.maxRetries, 0);
      assert.equal(request.previousTurnId, 'none');
      assert.ok(requests.has(sessionId));
      if (fail === 'turn') throw new Error('provider may have accepted turn');
      turnRequests.set(sessionId, request);
      return { data: { id: 'turn-1', sessionId, previousTurnId: null, input: request.input, state: { status: 'running' } } };
    },
    getTurn: async (sessionId, turnId) => {
      calls.gets++;
      return { data: { id: turnId, sessionId, previousTurnId: null,
        input: wrongTurnInput ? [{ type: 'user.message', content: 'different input' }] : turnRequests.get(sessionId).input,
        state: { status: 'done', requiredActions: [], output } } };
    },
    listTurnEvents: async () => ({ response: { data: [output], pagination: {} } }),
  } };
  return { client, calls };
}

test('real PostgreSQL serializes concurrent duplicate admission and per-owner active slots', async t => {
  const stores = await setup(t), owner = scope(), key = randomUUID();
  const jobs = await Promise.all(Array.from({ length: 24 }, (_, i) => stores[i % 2].admit(owner, key, input, runtime)));
  assert.equal(new Set(jobs.map(job => job.id)).size, 1);
  await assert.rejects(stores[1].admit(owner, key, { ...input, code: 'different' }, runtime), { code: 'idempotency_conflict' });
  await assert.rejects(stores[1].admit(owner, randomUUID(), input, runtime), { code: 'review_in_progress' });
  await assert.rejects(stores[1].get(scope(), jobs[0].id), { code: 'not_found' });
  assert.equal((await stores[1].list(scope())).length, 0);
});

test('real PostgreSQL permits only one dispatch claim across independent pools and reconnect', async t => {
  const stores = await setup(t), owner = scope();
  const job = await stores[0].admit(owner, randomUUID(), input, runtime);
  const claims = await Promise.all(Array.from({ length: 24 }, (_, i) => stores[i % 2].claim(owner, job.id, runtime, runtime.request)));
  assert.equal(claims.filter(result => result.claim !== null).length, 1);
  const fresh = createPool();
  try {
    assert.equal((await new ReviewStore(fresh).claim(owner, job.id, runtime, runtime.request)).claim, null);
    const observations = await fresh.query('SELECT stage FROM gatekeeper_reviews.observations WHERE job_id=$1', [job.id]);
    assert.deepEqual(observations.rows.map(row => row.stage), ['session_intent']);
  } finally { await fresh.end(); }
});

test('lost COMMIT acknowledgement after actual database commit cannot redispatch', async t => {
  const [store, other] = await setup(t), owner = scope();
  const job = await store.admit(owner, randomUUID(), input, runtime);
  const faultPool = {
    async connect() {
      const real = await store.pool.connect();
      return { release: () => real.release(), async query(sql, values) {
        const result = await real.query(sql, values);
        if (sql === 'COMMIT') throw new Error('synthetic lost acknowledgement after real COMMIT');
        return result;
      } };
    },
  };
  await assert.rejects(new ReviewStore(faultPool).claim(owner, job.id, runtime, runtime.request), /lost acknowledgement/);
  assert.equal((await other.get(owner, job.id)).state, 'session_dispatch');
  assert.equal((await other.claim(owner, job.id, runtime, runtime.request)).claim, null);
  await assert.rejects(other.admit(owner, randomUUID(), input, runtime), { code: 'review_in_progress' });
});

test('uncertain upstream POST leaves a durable hold and never repeats the accepted write', async t => {
  const [store, other] = await setup(t);
  for (const fail of ['session', 'turn']) {
    const owner = scope(), upstream = provider({ fail });
    const service = createReviewService({ store, ...upstream, runtime, ownerId: owner.ownerId, tokenHash });
    const saved = await invoke(service, owner.ownerId, { action: 'submit', idempotencyKey: randomUUID(), input });
    assert.equal(saved.status, 202); assert.equal(upstream.calls.sessions, 0); assert.equal(upstream.calls.turns, 0);
    const id = saved.body.job.id;
    const responses = await Promise.all(Array.from({ length: 12 }, () => invoke(service, owner.ownerId, { action: 'start', jobId: id })));
    assert.equal(responses.every(response => response.status === 202), true);
    await service.drained();
    assert.equal((await other.get(owner, id)).state, 'held');
    assert.equal(upstream.calls.sessions, 1);
    assert.equal(upstream.calls.turns, fail === 'turn' ? 1 : 0);
    await invoke(service, owner.ownerId, { action: 'start', jobId: id });
    await service.drained();
    assert.equal(upstream.calls.sessions, 1); assert.equal(upstream.calls.turns, fail === 'turn' ? 1 : 0);
    await assert.rejects(other.admit(owner, randomUUID(), input, runtime), { code: 'review_in_progress' });
    service.stop();
  }
});

test('known turn and private result survive pool restart; polling never creates another turn', async t => {
  const [store, other] = await setup(t), owner = scope(), upstream = provider();
  const service = createReviewService({ store, ...upstream, runtime, ownerId: owner.ownerId, tokenHash });
  const saved = await invoke(service, owner.ownerId, { action: 'submit', idempotencyKey: randomUUID(), input });
  const id = saved.body.job.id;
  await invoke(service, owner.ownerId, { action: 'start', jobId: id }); await service.drained();
  assert.equal((await other.get(owner, id)).state, 'running');
  service.stop();
  const restarted = createReviewService({ store: other, ...upstream, runtime, ownerId: owner.ownerId, tokenHash });
  const result = await invoke(restarted, owner.ownerId, { action: 'get', jobId: id });
  assert.equal(result.body.job.state, 'complete'); assert.deepEqual(result.body.job.findings, []);
  assert.equal(result.body.job.estimatedCostUsd, null); assert.equal(result.body.job.billingStatus, 'unsettled');
  assert.equal(JSON.stringify(result.body).includes(input.code), false);
  assert.equal(JSON.stringify(result.body).includes('session-1'), false);
  await invoke(restarted, owner.ownerId, { action: 'get', jobId: id });
  assert.equal(upstream.calls.sessions, 1); assert.equal(upstream.calls.turns, 1); assert.equal(upstream.calls.gets, 2);
  assert.equal((await store.get(owner, id)).state, 'complete');
  const fresh = await other.admit(owner, randomUUID(), input, runtime);
  assert.notEqual(fresh.id, id);
  restarted.stop();
});

test('persisting a session receipt must succeed before any review turn is sent', async t => {
  const [real, other] = await setup(t), owner = scope(), upstream = provider();
  const store = Object.create(real);
  store.receipt = async () => { throw new Error('synthetic receipt storage outage'); };
  const service = createReviewService({ store, ...upstream, runtime, ownerId: owner.ownerId, tokenHash });
  const saved = await invoke(service, owner.ownerId, { action: 'submit', idempotencyKey: randomUUID(), input });
  await invoke(service, owner.ownerId, { action: 'start', jobId: saved.body.job.id });
  await service.drained();
  assert.equal(upstream.calls.sessions, 1); assert.equal(upstream.calls.turns, 0);
  assert.equal((await other.get(owner, saved.body.job.id)).state, 'held');
  assert.equal((await other.claim(owner, saved.body.job.id, runtime, runtime.request)).claim, null);
  service.stop();
});

test('same turn IDs with different input can never expose findings or complete the private job', async t => {
  const [store, other] = await setup(t), owner = scope(), upstream = provider({ wrongTurnInput: true });
  const service = createReviewService({ store, ...upstream, runtime, ownerId: owner.ownerId, tokenHash });
  const saved = await invoke(service, owner.ownerId, { action: 'submit', idempotencyKey: randomUUID(), input });
  await invoke(service, owner.ownerId, { action: 'start', jobId: saved.body.job.id }); await service.drained();
  const result = await invoke(service, owner.ownerId, { action: 'get', jobId: saved.body.job.id });
  assert.equal(result.body.job.state, 'held'); assert.equal(result.body.job.findings, null);
  assert.equal((await other.get(owner, saved.body.job.id)).state, 'held');
  assert.equal(upstream.calls.turns, 1);
  service.stop();
});

test('changed session config, model parameters or metadata is durably held before any paid turn', async t => {
  const [store, other] = await setup(t);
  for (const mutateSession of [
    session => { session.agent.spec.config.iterationLimit = 2; },
    session => { session.agent.spec.config.sandbox.enabled = true; },
    session => { session.agent.spec.model.params.maxTokens = 65536; },
    session => { session.metadata.reviewInputDigest = 'b'.repeat(64); },
    session => { session.agent.spec.mcpServers = [{ name: 'unexpected' }]; },
  ]) {
    const owner = scope(), upstream = provider({ mutateSession });
    const service = createReviewService({ store, ...upstream, runtime, ownerId: owner.ownerId, tokenHash });
    const saved = await invoke(service, owner.ownerId, { action: 'submit', idempotencyKey: randomUUID(), input });
    await invoke(service, owner.ownerId, { action: 'start', jobId: saved.body.job.id }); await service.drained();
    assert.equal(upstream.calls.sessions, 1); assert.equal(upstream.calls.turns, 0);
    assert.equal((await other.get(owner, saved.body.job.id)).state, 'held');
    service.stop();
  }
});

test('expired dispatch and late receipt remain held with the receipt preserved for reconciliation', async t => {
  const [store, other] = await setup(t), owner = scope();
  const job = await store.admit(owner, randomUUID(), input, runtime);
  await store.claim(owner, job.id, runtime, runtime.request);
  await store.pool.query("UPDATE gatekeeper_reviews.jobs SET updated_at=now()-interval '3 minutes' WHERE id=$1", [job.id]);
  assert.equal((await other.expireDispatch(owner, job.id)).state, 'held');
  const receipt = { id: 'late-session', privateReceipt: 'synthetic fixture' };
  assert.equal((await store.receipt(owner, job.id, 'session', receipt, 'late-session')).state, 'held');
  const observations = await other.pool.query('SELECT payload FROM gatekeeper_reviews.observations WHERE job_id=$1 AND stage=$2', [job.id, 'session_receipt']);
  assert.deepEqual(observations.rows[0].payload, receipt);
  assert.equal((await other.claim(owner, job.id, runtime, runtime.request)).claim, null);
});

test('wrong capability, owner, app or source is denied before database/provider access', async () => {
  const owner = scope(); let reads = 0;
  const store = new Proxy({}, { get() { reads++; throw new Error('must not touch store'); } });
  const upstream = provider();
  const service = createReviewService({ store, ...upstream, runtime, ownerId: owner.ownerId, tokenHash });
  for (const [headers, status] of [
    [{ 'x-gatekeeper-review-token': 'learning_fixture_read_token' }, 401],
    [{ 'x-gatekeeper-review-owner': 'other' }, 403],
    [{ 'x-gatekeeper-review-app': 'another-app' }, 403],
    [{ 'x-gatekeeper-review-source': 'b'.repeat(40) }, 409],
  ]) assert.equal((await invoke(service, owner.ownerId, { action: 'list' }, headers)).status, status);
  assert.equal(reads, 0); assert.equal(upstream.calls.sessions, 0); assert.equal(upstream.calls.turns, 0);
});
