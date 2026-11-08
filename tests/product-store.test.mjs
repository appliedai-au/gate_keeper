import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { ProductStore, normalizeFilters, validateConfiguration, projectRun, projectUser,
  DEFAULT_CONFIGURATION } from '../scripts/product/store.mjs';

const USER = '11111111-1111-4111-8111-111111111111';
const ORG = '22222222-2222-4222-8222-222222222222';
const RUN = '33333333-3333-4333-8333-333333333333';
const NOW = new Date('2026-11-08T12:00:00.000Z');

test('product reports accept exact date windows and reject impossible or hostile filters', () => {
  const ordinary = normalizeFilters({ repository: '123', merged: null }, NOW);
  assert.equal(ordinary.from, '2026-10-10'); assert.equal(ordinary.to, '2026-11-08');
  assert.equal(ordinary.repository, '123'); assert.equal(ordinary.merged, null);
  assert.equal(normalizeFilters({ from: '2026-11-07', to: '2026-11-08' }, NOW).weekdays, 0);
  for (const filters of [{ from: '2026-02-30' }, { to: 'not-a-date' }, { from: '2020-01-01' },
    { repository: "1' OR true" }, { repository: USER }, { groupBy: 'month' }, { page: -1 }, { merged: 'yes' }])
    assert.throws(() => normalizeFilters(filters, NOW), error => error.code === 'invalid_request');
});

test('product configuration cannot smuggle new authorization or executable fields', () => {
  const config = validateConfiguration(DEFAULT_CONFIGURATION);
  assert.deepEqual(config, DEFAULT_CONFIGURATION);
  assert.notEqual(config.allowedAuthors, DEFAULT_CONFIGURATION.allowedAuthors);
  for (const patch of [{ isAdmin: true }, { ownerUserId: USER }, { autoApprove: 'true' },
    { allowedBranches: ['/regex/i', 12] }, JSON.parse('{"__proto__":{"admin":true}}')])
    assert.throws(() => validateConfiguration(patch, true), error => error.code === 'invalid_request');
});

test('run projection exposes neither private input, raw observations nor TrueForge identifiers', () => {
  const row = { id: RUN, owner_user_id: USER, org_id: ORG, repository_id: ORG, github_repo_id: '123',
    full_name: 'synthetic/fixture', pr_number: 1, title: 'Isolated projection fixture', pr_url: 'https://github.com/synthetic/fixture/pull/1',
    head_sha: 'a'.repeat(40), trigger: 'review', state: 'complete', created_at: NOW, updated_at: NOW,
    started_at: NOW, finished_at: new Date(NOW.getTime() + 100), estimated_cost_usd: null, cost_source: null,
    session_id: 'private-session-sentinel', turn_id: 'private-turn-sentinel',
    input: { code: 'private-code-sentinel' }, observations: ['private-observation-sentinel'],
    result: { summary: 'A saved public summary.', verdict: 'COMMENT' } };
  const projected = projectRun(row), encoded = JSON.stringify(projected);
  assert.equal(projected.estimatedCostUsd, null); assert.equal(projected.verdict, 'COMMENT');
  assert.equal(projected.durationMs, 100);
  for (const field of ['owner_user_id', 'session_id', 'turn_id', 'input', 'observations']) assert.equal(Object.hasOwn(projected, field), false);
  assert.equal(encoded.includes('private-'), false);
  assert.equal(projectUser({ id: USER, github_id: '123', login: 'synthetic-fixture' }).email, null);
});

test('a wrong owner cannot use a real-looking run id to get details or an audit export', async () => {
  const calls = [];
  const store = new ProductStore({ async query(sql, values) { calls.push({ sql, values }); return { rows: [] }; } });
  await assert.rejects(() => store.runDetail(USER, 'another-owner', RUN), error => error.code === 'not_found');
  await assert.rejects(() => store.exportAudit(USER, 'another-owner'), error => error.code === 'not_found');
  assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.sql.includes('o.owner_user_id=$1') && call.values[0] === USER));
  assert.ok(calls.every(call => !call.sql.includes('FROM g8s_product.runs') && !call.sql.includes('FROM g8s_product.audit_log')));
});

test('forged session digest is rejected without querying the database', async () => {
  const store = new ProductStore({ query() { throw new Error('unexpected database call'); } });
  assert.equal(await store.getSession('SESSION_PLACEHOLDER_NOT_A_DIGEST'), null);
  await assert.rejects(() => store.consumeOAuth('STATE_PLACEHOLDER_NOT_A_DIGEST', 'BROWSER_PLACEHOLDER_NOT_A_DIGEST'),
    error => error.code === 'invalid_oauth_callback');
});

test('terminal completion cannot be invoked through the generic phase transition', async () => {
  const store = new ProductStore({ connect() { throw new Error('unexpected database call'); } });
  await assert.rejects(() => store.transitionRun(RUN, 'review_posted', 'complete'), error => error.code === 'invalid_request');
  await assert.rejects(() => store.transitionRun(RUN, 'held', 'queued'), error => error.code === 'invalid_request');
});

test('a committed database write with lost acknowledgement is never reissued by transaction helper', async () => {
  const calls = [];
  let released = false;
  const client = { async query(sql) { calls.push(sql); if (sql === 'COMMIT') throw new Error('synthetic-lost-acknowledgement'); return { rows: [] }; },
    release() { released = true; } };
  const store = new ProductStore({ async connect() { return client; } });
  let attempts = 0;
  await assert.rejects(() => store.transaction(async connection => {
    attempts++; await connection.query('synthetic-write');
  }), /synthetic-lost-acknowledgement/u);
  assert.equal(attempts, 1); assert.deepEqual(calls, ['BEGIN', 'synthetic-write', 'COMMIT', 'ROLLBACK']);
  assert.equal(released, true);
});

test('public cost projection rejects invalid numbers rather than inventing a zero', () => {
  const row = { id: RUN, created_at: NOW, updated_at: NOW, estimated_cost_usd: Infinity };
  assert.throws(() => projectRun(row), error => error.code === 'product_unavailable');
  assert.throws(() => projectRun({ ...row, estimated_cost_usd: -1 }), error => error.code === 'product_unavailable');
});

test('session issuance locks the identity and refuses an OAuth flow older than revocation', async () => {
  const calls = [];
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('authorization_fresh')) return { rows: [{ id: USER, authorization_fresh: false }] };
    return { rows: [] };
  }, release() {} };
  const store = new ProductStore({ async connect() { return client; } });
  await assert.rejects(() => store.createSession({ sessionHash: '1'.repeat(64), userId: USER,
    expiresAt: new Date(Date.now() + 300000), oauthStartedAt: new Date(Date.now() - 30000) }),
  error => error.code === 'invalid_oauth_callback');
  assert.ok(calls.some(call => call.sql.includes('authorization_revoked_at<$2') && call.sql.includes('FOR NO KEY UPDATE')));
  assert.equal(calls.some(call => call.sql.includes('INSERT INTO g8s_product.sessions')), false);
  assert.equal(calls.at(-1).sql, 'ROLLBACK');
});

test('replaying an already-recorded authorization revocation does not repeat its effects', async () => {
  const delivery = '44444444-4444-4444-8444-444444444444';
  const payload = { action: 'revoked', sender: { id: 1001 } };
  const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
  const calls = [];
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('SELECT delivery_id,event,payload_hash')) return { rows: [{ delivery_id: delivery, event: 'github_app_authorization', payload_hash: payloadHash }] };
    return { rows: [] };
  }, release() {} };
  const store = new ProductStore({ async connect() { return client; } });
  assert.equal((await store.receiveDelivery({ deliveryId: delivery, event: 'github_app_authorization', payload })).duplicate, true);
  assert.equal(calls.some(call => call.sql.includes('github_authorization_revocations')), false);
  assert.equal(calls.some(call => call.sql.startsWith('DELETE') || call.sql.startsWith('UPDATE')), false);
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('a newly recorded signed authorization revocation applies its effects before acknowledgement', async () => {
  const delivery = '55555555-5555-4555-8555-555555555555';
  const calls = [];
  const client = { async query(sql, values) {
    calls.push({ sql, values });
    if (sql.includes('INSERT INTO g8s_product.webhook_deliveries')) return { rows: [{ delivery_id: delivery }] };
    if (sql.includes('INSERT INTO g8s_product.github_authorization_revocations')) return { rows: [{ revoked_at: NOW }] };
    if (sql.includes('UPDATE g8s_product.users SET authorization_revoked_at')) return { rows: [{ id: USER }] };
    if (sql.includes('SELECT id FROM g8s_product.organizations')) return { rows: [{ id: ORG }] };
    return { rows: [] };
  }, release() {} };
  const store = new ProductStore({ async connect() { return client; } });
  assert.equal((await store.receiveDelivery({ deliveryId: delivery, event: 'github_app_authorization',
    payload: { action: 'revoked', sender: { id: 1001 } } })).duplicate, false);
  assert.ok(calls.some(call => call.sql.includes('DELETE FROM g8s_product.sessions WHERE user_id=$1') && call.values[0] === USER));
  assert.ok(calls.some(call => call.sql.includes("disabled_reason='authorization_revoked'")));
  assert.ok(calls.some(call => call.sql.includes('UPDATE g8s_product.repositories SET enabled=false')));
  assert.equal(calls.at(-1).sql, 'COMMIT');
});

test('signup policy defaults reject invalid allocations before any database operation', () => {
  for (const options of [{ defaultMonthlyRunLimit: -1 }, { defaultMonthlyRunLimit: 1000001 },
    { defaultMonthlyRunLimit: '12' }, { maxConcurrentRuns: 0 }, { maxConcurrentRuns: 17 }])
    assert.throws(() => new ProductStore({}, options), error => error.code === 'invalid_request');
  assert.equal(new ProductStore({}).defaultMonthlyRunLimit, 0);
  assert.equal(new ProductStore({}, { defaultMonthlyRunLimit: 7 }).defaultMonthlyRunLimit, 7);
});

test('model session reset is limited to the single organization-to-repository pass', async () => {
  const calls = [];
  const client = { async query(sql) {
    calls.push(sql);
    if (sql.includes('FROM g8s_product.controls')) return { rows: [{ paused: false }] };
    if (sql.includes('SELECT * FROM g8s_product.runs')) return { rows: [{ id: RUN, state: 'running',
      review_pass: 'repository', baseline_result: { findings: [] } }] };
    return { rows: [] };
  }, release() {} };
  const store = new ProductStore({ async connect() { return client; } });
  await assert.rejects(() => store.transitionRun(RUN, 'session_created', 'turn_dispatch', { sessionId: null }),
    error => error.code === 'invalid_request');
  await assert.rejects(() => store.transitionRun(RUN, 'running', 'session_dispatch', { reviewPass: 'repository',
    baselineResult: { risk: 'medium', summary: 'Synthetic bounded baseline.', findings: [], ruleEvaluations: [] },
    observation: { stage: 'repository_session_intent', payload: {} } }), error => error.code === 'conflict');
  assert.equal(calls.some(sql => sql.includes('INSERT INTO g8s_product.run_observations')), false);
});
