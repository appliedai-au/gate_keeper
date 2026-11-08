/**
 * Explicit real-PostgreSQL qualification entrypoint. Never targets production.
 * The disposable qualifier must initialize an empty trust-auth loopback cluster
 * on 55433 with this exact user/database. No passwords or provider bindings.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { exerciseProductStore } from './product-store-database-cases.mjs';
import { ProductStore } from '../scripts/product/store.mjs';

const require = createRequire(import.meta.url);
if (process.env.G8S_PRODUCT_POSTGRES_TEST !== 'isolated-loopback') throw new Error('product_postgres_qualification_requires_isolated_loopback');
const packagePath = require.resolve('@truefoundry/trueforge/package.json');
const manifest = JSON.parse(readFileSync(packagePath, 'utf8'));
assert.equal(manifest.version, '0.182.0');
const { Pool } = createRequire(packagePath)('pg');
const connectionString = 'postgresql://g8s_product_qualification@127.0.0.1:55433/g8s_product_qualification';
const options = { connectionString, max: 2, connectionTimeoutMillis: 5000, statement_timeout: 5000,
  idle_in_transaction_session_timeout: 10000, allowExitOnIdle: true };

const deferred = () => {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
};
async function observe(promise, message) {
  let timer;
  try {
    await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
function instrumentPool(pool, { before = async () => {}, after = async () => {} }) {
  return { query: (...args) => pool.query(...args), async connect() {
    const client = await pool.connect();
    return { async query(sql, values) {
      await before(sql);
      const result = await client.query(sql, values);
      await after(sql);
      return result;
    }, release() { client.release(); } };
  } };
}

async function exerciseInstallationLockOrder(pool, competingPool) {
  const store = new ProductStore(pool);
  const identity = await store.upsertIdentity({ githubId: '6101', login: 'g8s-lock-order-test', name: null, email: null, avatarUrl: null });
  const user = identity.user.id, org = identity.organizations[0];
  const installation = { id: '6102', account: { id: '6101', login: identity.user.login, type: 'User' }, repositorySelection: 'selected' };
  const repo = { id: '6103', name: 'fixture', fullName: identity.user.login + '/fixture', private: true, defaultBranch: 'main' };
  const extraRepo = { ...repo, id: '6104', name: 'new-fixture', fullName: identity.user.login + '/new-fixture' };
  await store.saveInstallation({ userId: user, orgId: org.id, installation, repositories: [repo] });
  await store.updateRepository(user, org.slug, repo.id, { enabled: true });
  const installationLock = sql => /FROM g8s_product\.installations\b[\s\S]*FOR (?:NO KEY )?UPDATE\b/u.test(sql);

  // Pause a real independent connection after it owns the installation. Then
  // let the contender reach its first parent/repository lock before refresh
  // continues. The old repo→installation FK order forms a deterministic cycle;
  // the corrected parent-first order waits and both transactions commit.
  async function interleave(repositories, operation) {
    const held = deferred(), release = deferred(), contenderReachedLock = deferred();
    const refresher = new ProductStore(instrumentPool(pool, { async after(sql) {
      if (installationLock(sql)) { held.resolve(); await release.promise; }
    } }));
    const contender = new ProductStore(instrumentPool(competingPool, {
      async before(sql) { if (installationLock(sql)) contenderReachedLock.resolve(); },
      async after(sql) { if (/FOR (?:NO KEY )?UPDATE OF r\b/u.test(sql)) contenderReachedLock.resolve(); },
    }));
    const refreshing = refresher.syncInstallationRepositories(installation.id, repositories);
    let contending;
    try {
      await observe(held.promise, 'refresh did not reach its installation lock');
      contending = operation(contender);
      await observe(contenderReachedLock.promise, 'contender did not reach its parent or repository lock');
      release.resolve();
      const results = await Promise.all([refreshing, contending]);
      return results[1];
    } finally {
      release.resolve();
      await Promise.allSettled([refreshing, ...(contending ? [contending] : [])]);
    }
  }

  const deliveryId = randomUUID();
  await store.receiveDelivery({ deliveryId, event: 'pull_request', payload: { action: 'opened', fixture: 'lock-order-admission' } });
  const runs = await interleave([repo], contender => contender.enqueueRun({ deliveryId, installationId: installation.id,
    repositoryId: repo.id, prNumber: 1, headSha: 'c'.repeat(40), baseSha: 'd'.repeat(40), baseBranch: 'main',
    title: 'Synthetic refresh admission fixture', prUrl: `https://github.com/${repo.fullName}/pull/1`,
    authorLogin: identity.user.login, authorType: 'User', draft: false, merged: false,
    trigger: 'pull_request', actorLogin: null, actorGithubId: null, actorType: null, findingId: null }));
  assert.equal(runs.length, 1, 'refresh and run admission both commit without parent/FK deadlock');
  const connected = await interleave([extraRepo, repo], contender => contender.saveInstallation({
    userId: user, orgId: org.id, installation, repositories: [repo, extraRepo] }));
  assert.equal(connected.repositories.length, 2,
    'a freshness-locked callback and refresh inserting a child repository both commit');
}

test('G8S product PostgreSQL: isolation, inbox, queue, receipts and reporting', async () => {
  const pool = new Pool(options), competingPool = new Pool(options);
  try {
    const namespace = (await pool.query("SELECT to_regnamespace('g8s_product') AS existing")).rows[0].existing;
    assert.equal(namespace, null, 'qualification must start with an empty disposable database');
    await pool.query(readFileSync(new URL('../scripts/product/schema.sql', import.meta.url), 'utf8'));
    const cases = await exerciseProductStore(pool);
    assert.equal(cases.length, 14);
    await exerciseInstallationLockOrder(pool, competingPool);

    const store = new ProductStore(pool), competing = new ProductStore(competingPool);
    const identity = await store.upsertIdentity({ githubId: '6001', login: 'g8s-concurrent-test', name: null, email: null, avatarUrl: null });
    const user = identity.user.id, org = identity.organizations[0];
    const stateHash = '6'.repeat(64), browserHash = '7'.repeat(64);
    await store.createOAuth({ stateHash, browserHash, purpose: 'signin', userId: null,
      verifier: 'G8S_PKCE_VERIFIER_PLACEHOLDER_FOR_TESTS_ONLY_02', returnPath: '/', expiresAt: new Date(Date.now() + 300000) });
    const callbacks = await Promise.allSettled([store.consumeOAuth(stateHash, browserHash), competing.consumeOAuth(stateHash, browserHash)]);
    assert.equal(callbacks.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(callbacks.filter(result => result.status === 'rejected' && result.reason.code === 'invalid_oauth_callback').length, 1);
    await store.saveInstallation({ userId: user, orgId: org.id,
      installation: { id: '6002', account: { id: '6001', login: identity.user.login, type: 'User' }, repositorySelection: 'selected' },
      repositories: [{ id: '6003', name: 'fixture', fullName: identity.user.login + '/fixture', private: true, defaultBranch: 'main' }] });
    await store.updateRepository(user, org.slug, '6003', { enabled: true });
    await store.setLimits(user, user, { monthlyRunLimit: 1, maxConcurrentRuns: 1 });
    await store.setPause(user, { paused: false, reason: 'Isolated concurrent admission test.' });
    for (const [index, head] of ['8'.repeat(40), '9'.repeat(40)].entries()) {
      const deliveryId = randomUUID();
      await store.receiveDelivery({ deliveryId, event: 'pull_request', payload: { action: 'synchronize', fixtureHead: head } });
      await store.enqueueRun({ deliveryId, installationId: '6002', repositoryId: '6003', prNumber: index + 1,
        headSha: head, baseSha: 'a'.repeat(40), title: 'Synthetic concurrent fixture', prUrl: `https://github.com/${identity.user.login}/fixture/pull/${index + 1}`,
        authorLogin: identity.user.login, authorType: 'User', baseBranch: 'main', draft: false, merged: false,
        trigger: 'pull_request', actorLogin: null, actorGithubId: null, actorType: null, findingId: null });
    }
    const claims = await Promise.all([store.claimRun(), competing.claimRun()]);
    assert.equal(claims.filter(Boolean).length, 1, 'quota and concurrent-run admission are atomic across independent pools');
    const run = claims.find(Boolean), patch = { input: { fixture: true },
      observation: { stage: 'session_intent', payload: { fixture: true } } };
    const dispatches = await Promise.all([
      store.transitionRun(run.id, 'preparing', 'session_dispatch', patch),
      competing.transitionRun(run.id, 'preparing', 'session_dispatch', patch),
    ]);
    assert.equal(dispatches.filter(Boolean).length, 1, 'only one independently committed dispatch intent is returned');
    assert.equal((await pool.query(`SELECT count(*) AS count FROM g8s_product.run_observations WHERE run_id=$1 AND stage='session_intent'`, [run.id])).rows[0].count, '1');

    await store.createOAuth({ stateHash: 'b'.repeat(64), browserHash: 'c'.repeat(64), purpose: 'signin', userId: null,
      verifier: 'G8S_PKCE_VERIFIER_PLACEHOLDER_FOR_TESTS_ONLY_04', returnPath: '/', expiresAt: new Date(Date.now() + 300000) });
    const pending = await store.consumeOAuth('b'.repeat(64), 'c'.repeat(64));
    await pool.query('SELECT pg_sleep(0.005)');
    const race = await Promise.allSettled([
      competing.createSession({ sessionHash: 'e'.repeat(64), userId: user, oauthStartedAt: pending.createdAt,
        expiresAt: new Date(Date.now() + 300000) }),
      store.receiveDelivery({ deliveryId: randomUUID(), event: 'github_app_authorization',
        payload: { action: 'revoked', sender: { id: 6001 } } }),
    ]);
    assert.equal(race[1].status, 'fulfilled');
    assert.ok(race[0].status === 'fulfilled' || race[0].reason.code === 'invalid_oauth_callback');
    assert.equal(await store.getSession('e'.repeat(64)), null,
      'whether issuance or revocation locks first, a pre-revocation flow cannot leave a usable session afterward');
  } finally { await competingPool.end(); await pool.end(); }
});
