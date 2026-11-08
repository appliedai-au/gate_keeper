import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import { ProductStore, DEFAULT_CONFIGURATION } from '../scripts/product/store.mjs';
import { ClientApiStore, tokenHash } from '../scripts/product/client-api-store.mjs';
import { createClientApi, CLIENT_API_PATH } from '../scripts/product/client-api.mjs';

const CONNECTION = 'postgresql://g8s_client_api_qualification@127.0.0.1:55434/g8s_client_api_qualification';
if (process.env.G8S_CLIENT_API_POSTGRES_TEST !== 'isolated-loopback') throw new Error('Explicit isolated client API qualification required');
for (const name of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD', 'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE',
  'TRUEFORGE_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'G8S_GITHUB_APP_PRIVATE_KEY', 'G8S_GITHUB_CLIENT_SECRET', 'G8S_GITHUB_WEBHOOK_SECRET']) {
  if (Object.hasOwn(process.env, name)) throw new Error('External capability refused by client API qualification');
}
const uuid = number => '00000000-0000-4000-8000-' + String(number).padStart(12, '0');
const options = { connectionString: CONNECTION, max: 8, connectionTimeoutMillis: 3000,
  statement_timeout: 5000, query_timeout: 8000, application_name: 'g8s-client-api-isolated-test' };
const principal = byte => ({ kind: 'session', hash: tokenHash(Buffer.alloc(32, byte).toString('base64url')) });
const a = principal(1), b = principal(2);
const keyBody = { name: 'Synthetic key', repositoryIds: ['101'], scopes: ['reviews:read', 'reviews:write'], expiresInDays: 7 };
const input = { repositoryId: '101', prNumber: 7, headSha: 'a'.repeat(40), baseSha: 'b'.repeat(40) };
const pr = { number: 7, title: 'Synthetic review', head: { sha: input.headSha }, base: { sha: input.baseSha, ref: 'main' },
  user: { login: 'synthetic-author', type: 'User' }, draft: false, merged: false, state: 'open' };
const assertCode = (promise, code) => assert.rejects(promise, error => error.code === code);

test('real PostgreSQL client API: auth isolation, atomic queue admission, races, revocation and loopback HTTP', { timeout: 90000 }, async t => {
  const pool = new pg.Pool(options), otherPool = new pg.Pool(options);
  t.after(async () => { await Promise.all([pool.end(), otherPool.end()]); });
  assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db, 'g8s_client_api_qualification');
  const schemas = await pool.query("SELECT schema_name FROM information_schema.schemata WHERE schema_name='g8s_product'");
  assert.equal(schemas.rows.length, 0, 'the test requires a new empty isolated cluster');
  await pool.query(await readFile(new URL('../scripts/product/schema.sql', import.meta.url), 'utf8'));
  const product = new ProductStore(pool), otherProduct = new ProductStore(otherPool);
  const store = new ClientApiStore(product), competitor = new ClientApiStore(otherProduct);
  await assert.rejects(store.ready());
  await pool.query(await readFile(new URL('../scripts/product/client-api-schema.sql', import.meta.url), 'utf8'));
  await store.ready();
  for (const [index, slug, repoId] of [[1, 'alpha', '101'], [2, 'beta', '201']]) {
    const n = index * 100;
    await pool.query('INSERT INTO g8s_product.users(id,github_id,login) VALUES($1,$2,$3)', [uuid(n + 1), String(n + 1), 'owner-' + slug]);
    await pool.query('INSERT INTO g8s_product.organizations(id,owner_user_id,slug,name) VALUES($1,$2,$3,$3)', [uuid(n + 2), uuid(n + 1), slug]);
    await pool.query("INSERT INTO g8s_product.memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [uuid(n + 2), uuid(n + 1)]);
    await pool.query("INSERT INTO g8s_product.sessions(session_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 day')", [principal(index).hash, uuid(n + 1)]);
    await pool.query('INSERT INTO g8s_product.settings(org_id,owner_user_id,configuration) VALUES($1,$2,$3)', [uuid(n + 2), uuid(n + 1), JSON.stringify(DEFAULT_CONFIGURATION)]);
    await pool.query('INSERT INTO g8s_product.user_limits(user_id,monthly_run_limit,max_concurrent_runs) VALUES($1,100,1)', [uuid(n + 1)]);
    await pool.query(`INSERT INTO g8s_product.installations(id,owner_user_id,org_id,github_installation_id,account_id,account_login,account_type,repository_selection)
      VALUES($1,$2,$3,$4,$5,$6,'User','selected')`, [uuid(n + 3), uuid(n + 1), uuid(n + 2), String(n + 50), String(n + 1), 'owner-' + slug]);
    await pool.query(`INSERT INTO g8s_product.repositories(id,owner_user_id,org_id,installation_id,github_repo_id,full_name,name,default_branch,private,enabled)
      VALUES($1,$2,$3,$4,$5,$6,'repository','main',true,true)`, [uuid(n + 4), uuid(n + 1), uuid(n + 2), uuid(n + 3), repoId, 'owner-' + slug + '/repository']);
  }
  await pool.query(`INSERT INTO g8s_product.repositories(id,owner_user_id,org_id,installation_id,github_repo_id,full_name,name,default_branch,private,enabled)
    VALUES($1,$2,$3,$4,'102','owner-alpha/other','other','main',true,true)`, [uuid(105), uuid(101), uuid(102), uuid(103)]);
  let issued, key, accepted;
  await t.test('key secret exists only in the one-time response; database and metadata retain no plaintext', async () => {
    issued = await store.issueKey(a, 'alpha', keyBody); key = { kind: 'key', hash: tokenHash(issued.token) };
    assert.match(issued.token, /^g8s_v1_[A-Za-z0-9_-]{43}$/u); assert.equal(issued.shownOnce, true);
    const saved = (await pool.query('SELECT * FROM g8s_product.client_keys WHERE id=$1', [issued.key.id])).rows[0];
    assert.equal(saved.token_hash, key.hash); assert.equal(JSON.stringify(saved).includes(issued.token), false);
    const listed = await store.listKeys(a, 'alpha');
    assert.equal(listed.keys.length, 1); assert.equal(JSON.stringify(listed).includes(key.hash), false);
    assert.equal(JSON.stringify(listed).includes(issued.token), false); assert.equal(listed.hasMoreHistory, false);
    const audit = JSON.stringify((await pool.query('SELECT details FROM g8s_product.audit_log')).rows);
    assert.equal(audit.includes(issued.token), false); assert.equal(audit.includes(key.hash), false);
  });
  await t.test('tenant, repository and scope authority is checked at every access', async () => {
    await assertCode(store.repository(key, 'beta', '201', 'reviews:read'), 'not_found');
    await assertCode(store.repository(key, 'alpha', '102', 'reviews:read'), 'forbidden');
    await assertCode(store.issueKey(key, 'alpha', keyBody), 'forbidden');
    await assertCode(store.listKeys(key, 'alpha'), 'forbidden');
    await assertCode(store.revokeKey(b, 'beta', issued.key.id), 'not_found');
    const read = await store.issueKey(a, 'alpha', { ...keyBody, scopes: ['reviews:read'] });
    await assertCode(store.repository({ kind: 'key', hash: tokenHash(read.token) }, 'alpha', '101', 'reviews:write'), 'forbidden');
    await assertCode(store.issueKey(a, 'alpha', { ...keyBody, repositoryIds: ['201'] }), 'not_found');
  });
  await t.test('independent connection pools admit one run for simultaneous duplicate requests', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, (_, index) =>
      (index % 2 ? store : competitor).submit(key, 'alpha', input, 'same-request-00001', pr)));
    assert.equal(new Set(results.map(x => x.runId)).size, 1);
    assert.equal(results.filter(x => !x.duplicate).length, 1); accepted = results[0];
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM g8s_product.runs')).rows[0].n, 1);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM g8s_product.client_requests')).rows[0].n, 1);
    const provenance = (await pool.query('SELECT event,status,payload FROM g8s_product.webhook_deliveries')).rows;
    assert.equal(provenance.length, 1); assert.equal(provenance[0].event, 'g8s_client_api');
    assert.equal(provenance[0].status, 'processed'); assert.equal(provenance[0].payload.source, 'g8s_client_api');
    assert.equal(JSON.stringify(provenance).includes(issued.token), false);
    const detail = await store.run(key, 'alpha', accepted.runId);
    assert.equal(detail.run.status, 'queued'); assert.deepEqual(detail.findings, []);
    await assertCode(store.run(b, 'beta', accepted.runId), 'not_found');
  });
  await t.test('request identity replay is stable and a changed body cannot reuse it', async () => {
    const again = await store.existingRequest(key, 'alpha', input, 'same-request-00001');
    assert.equal(again.runId, accepted.runId); assert.equal(again.duplicate, true);
    await assertCode(store.existingRequest(key, 'alpha', { ...input, headSha: 'c'.repeat(40) }, 'same-request-00001'), 'idempotency_conflict');
    await assertCode(store.submit(key, 'alpha', input, 'stale-request-0001', { ...pr, head: { sha: 'c'.repeat(40) } }), 'revision_changed');
    await assertCode(store.submit(key, 'alpha', input, 'draft-request-0001', { ...pr, draft: true }), 'review_out_of_scope');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM g8s_product.client_requests')).rows[0].n, 1);
  });
  await t.test('an admission failure rolls back run, provenance and request receipt together', async () => {
    class FailingStore extends ProductStore {
      async audit(client, userId, orgId, action, details) {
        if (action === 'client.review_requested') throw new Error('Synthetic failure after admission');
        return super.audit(client, userId, orgId, action, details);
      }
    }
    const failed = new ClientApiStore(new FailingStore(otherPool));
    await assert.rejects(failed.submit(key, 'alpha', input, 'rollback-request-01', pr));
    for (const table of ['runs', 'webhook_deliveries', 'client_requests'])
      assert.equal((await pool.query('SELECT count(*)::int AS n FROM g8s_product.' + table)).rows[0].n, 1, table);
  });
  await t.test('actual loopback HTTP submits and reads the durable run without model calls', async () => {
    let api, githubReads = 0;
    const server = createServer((req, res) => { void api.handler(req, res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    api = createClientApi({ store, config: { apiOrigin: origin, frontendOrigin: 'https://g8s.test' },
      github: { installationClient: async () => ({ mayCommand: async () => true,
        pullRequest: async () => { githubReads++; return pr; } }) }, fallback(_req, res) { res.writeHead(404); res.end(); } });
    try {
      const path = origin + CLIENT_API_PATH + '/orgs/alpha/reviews';
      const request = () => fetch(path, { method: 'POST', headers: { Authorization: 'Bearer ' + issued.token,
        'Content-Type': 'application/json', 'Idempotency-Key': 'actual-http-request-01' }, body: JSON.stringify(input), signal: AbortSignal.timeout(5000) });
      const first = await request(); assert.equal(first.status, 202); const data = (await first.json()).data;
      assert.equal(data.execution, 'asynchronous'); assert.equal(data.comparisonAvailable, false);
      const replay = await request(); assert.equal(replay.status, 202); assert.equal((await replay.json()).data.runId, data.runId);
      assert.equal(githubReads, 1);
      const read = await fetch(origin + data.statusPath, { headers: { Authorization: 'Bearer ' + issued.token }, signal: AbortSignal.timeout(5000) });
      assert.equal(read.status, 200); assert.equal((await read.json()).data.run.status, 'queued');
    } finally { api.stop(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  });
  await t.test('existing pause, monthly allowance and concurrency limits still govern execution', async () => {
    assert.equal(await product.claimRun(), null, 'default product pause remains in force');
    await pool.query('UPDATE g8s_product.controls SET paused=false');
    await pool.query('UPDATE g8s_product.user_limits SET monthly_run_limit=0 WHERE user_id=$1', [uuid(101)]);
    assert.equal(await product.claimRun(), null);
    await pool.query('UPDATE g8s_product.user_limits SET monthly_run_limit=100 WHERE user_id=$1', [uuid(101)]);
    const claimed = await product.claimRun(); assert.equal(claimed.ownerUserId, uuid(101));
    assert.equal(await otherProduct.claimRun(), null, 'the existing one-run concurrency limit is honored');
    await pool.query('UPDATE g8s_product.controls SET paused=true');
  });
  await t.test('repository disablement and installation revocation immediately deny client data access', async () => {
    await pool.query('UPDATE g8s_product.repositories SET enabled=false WHERE id=$1', [uuid(104)]);
    await assertCode(store.run(key, 'alpha', accepted.runId), 'not_found');
    await pool.query('UPDATE g8s_product.repositories SET enabled=true WHERE id=$1', [uuid(104)]);
    await pool.query("UPDATE g8s_product.installations SET disabled_reason='test_revocation' WHERE id=$1", [uuid(103)]);
    await assertCode(store.repository(key, 'alpha', '101', 'reviews:read'), 'not_found');
    await pool.query('UPDATE g8s_product.installations SET disabled_reason=NULL WHERE id=$1', [uuid(103)]);
  });
  await t.test('revoked, expired and disabled-user keys cannot authenticate', async () => {
    await store.revokeKey(a, 'alpha', issued.key.id);
    await assertCode(store.identity(key), 'unauthenticated');
    const expiring = await store.issueKey(a, 'alpha', keyBody), expPrincipal = { kind: 'key', hash: tokenHash(expiring.token) };
    await pool.query("UPDATE g8s_product.client_keys SET created_at=clock_timestamp()-interval '2 days',expires_at=clock_timestamp()-interval '1 day' WHERE id=$1", [expiring.key.id]);
    await assertCode(store.identity(expPrincipal), 'unauthenticated');
    const valid = await store.issueKey(a, 'alpha', keyBody), validPrincipal = { kind: 'key', hash: tokenHash(valid.token) };
    await pool.query('UPDATE g8s_product.users SET disabled=true WHERE id=$1', [uuid(101)]);
    await assertCode(store.identity(validPrincipal), 'unauthenticated');
    await pool.query('UPDATE g8s_product.users SET disabled=false,authorization_revoked_at=clock_timestamp() WHERE id=$1', [uuid(101)]);
    await assertCode(store.identity(validPrincipal), 'unauthenticated'); await assertCode(store.identity(a), 'unauthenticated');
    await pool.query('UPDATE g8s_product.users SET authorization_revoked_at=NULL WHERE id=$1', [uuid(101)]);
  });
  await t.test('owner-level rate limit is atomic across independent connections', async () => {
    const limited = new ClientApiStore(product, { requestsPerMinute: 2 });
    const other = new ClientApiStore(otherProduct, { requestsPerMinute: 2 });
    const result = await Promise.allSettled([limited.rate(b), other.rate(b), limited.rate(b)]);
    assert.equal(result.filter(x => x.status === 'fulfilled').length, 2);
    assert.equal(result.find(x => x.status === 'rejected').reason.code, 'rate_limited');
  });
  await t.test('key issuance limit remains atomic under competing requests', async () => {
    await pool.query('UPDATE g8s_product.client_keys SET revoked_at=clock_timestamp() WHERE owner_user_id=$1', [uuid(101)]);
    for (let n = 0; n < 19; n++) await store.issueKey(a, 'alpha', { ...keyBody, name: 'synthetic-' + n });
    const result = await Promise.allSettled([store.issueKey(a, 'alpha', keyBody), competitor.issueKey(a, 'alpha', keyBody)]);
    assert.equal(result.filter(x => x.status === 'fulfilled').length, 1);
    assert.equal(result.find(x => x.status === 'rejected').reason.code, 'key_limit_reached');
    assert.equal((await store.listKeys(a, 'alpha')).keys.filter(x => x.revokedAt === null && new Date(x.expiresAt) > new Date()).length, 20);
  });
});
