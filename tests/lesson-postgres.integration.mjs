import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import { ProductStore, DEFAULT_CONFIGURATION } from '../scripts/product/store.mjs';
import { ComparisonStore } from '../scripts/product/comparison-store.mjs';
import { LessonStore } from '../scripts/product/lesson-store.mjs';
import { createLessonApi, LEARNING_POLICY_PATH, LESSON_PATH } from '../scripts/product/lesson-api.mjs';
import { applyLearningSchemas } from '../scripts/product/migrate-learning.mjs';
import { tokenHash } from '../scripts/product/client-api-store.mjs';
import { testAuthority, uuid, hash } from './helpers/lesson-fixture.mjs';

if (process.env.G8S_LESSON_POSTGRES_TEST !== 'isolated-loopback') throw Error('Isolated lesson test required');
for (const name of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE',
  'TRUEFORGE_API_KEY','TRUEFOUNDRY_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','G8S_GITHUB_CLIENT_SECRET','G8S_GITHUB_APP_PRIVATE_KEY','G8S_GITHUB_WEBHOOK_SECRET'])
  if (Object.hasOwn(process.env, name)) throw Error('External capability refused');
const connectionString = 'postgresql://g8s_lesson_qualification@127.0.0.1:55436/g8s_lesson_qualification';
const token = n => Buffer.alloc(32, n).toString('base64url');
const principal = n => ({ kind: 'session', hash: tokenHash(token(n)) });
const a = principal(1), b = principal(2), head = 'a'.repeat(40), base = 'b'.repeat(40);
const identity = { userId: '901', login: 'synthetic-reviewer[bot]' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('real PostgreSQL multilayer lesson admission, policy races and content deletion', { timeout: 90000 }, async t => {
  const options = { connectionString, max: 8, connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 8000 };
  const pool = new pg.Pool(options), otherPool = new pg.Pool(options);
  t.after(() => Promise.all([pool.end(), otherPool.end()]));
  assert.equal((await pool.query('SELECT current_database() AS name')).rows[0].name, 'g8s_lesson_qualification');
  assert.equal((await pool.query("SELECT to_regnamespace('g8s_product') AS name")).rows[0].name, null);
  await pool.query(await readFile(new URL('../scripts/product/schema.sql', import.meta.url), 'utf8'));
  const migrated = await applyLearningSchemas(pool);
  assert.deepEqual(migrated.applied, ['comparison-schema.sql', 'lesson-schema.sql']);
  assert.equal(migrated.requireAdversarialVerification, true);
  assert.deepEqual((await applyLearningSchemas(otherPool)).applied, []);
  const authority = testAuthority(), product = new ProductStore(pool), otherProduct = new ProductStore(otherPool);
  const config = { identity, adminGithubIds: new Set(['101']), trust: authority.trust };
  const store = new LessonStore(product, config), other = new LessonStore(otherProduct, config);
  const comparisons = new ComparisonStore(product, { identity }); await store.ready();
  for (const [n, slug] of [[100, 'alpha'], [200, 'beta']]) {
    await pool.query('INSERT INTO g8s_product.users(id,github_id,login) VALUES($1,$2,$3)', [uuid(n+1), String(n+1), 'owner-'+slug]);
    await pool.query('INSERT INTO g8s_product.organizations(id,owner_user_id,slug,name) VALUES($1,$2,$3,$3)', [uuid(n+2),uuid(n+1),slug]);
    await pool.query("INSERT INTO g8s_product.memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [uuid(n+2),uuid(n+1)]);
    await pool.query("INSERT INTO g8s_product.sessions(session_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 day')", [principal(n/100).hash,uuid(n+1)]);
    await pool.query('INSERT INTO g8s_product.settings(org_id,owner_user_id,configuration) VALUES($1,$2,$3)', [uuid(n+2),uuid(n+1),JSON.stringify(DEFAULT_CONFIGURATION)]);
    await pool.query(`INSERT INTO g8s_product.installations(id,owner_user_id,org_id,github_installation_id,account_id,account_login,account_type,repository_selection)
      VALUES($1,$2,$3,$4,$5,$6,'User','selected')`, [uuid(n+3),uuid(n+1),uuid(n+2),String(n+50),String(n+1),'owner-'+slug]);
    await pool.query(`INSERT INTO g8s_product.repositories(id,owner_user_id,org_id,installation_id,github_repo_id,full_name,name,default_branch,private,enabled)
      VALUES($1,$2,$3,$4,$5,$6,'repository','main',true,true)`, [uuid(n+4),uuid(n+1),uuid(n+2),uuid(n+3),String(n+1),'owner-'+slug+'/repository']);
  }
  const runId = uuid(1001);
  await pool.query(`INSERT INTO g8s_product.webhook_deliveries(delivery_id,event,payload,payload_hash,status)
    VALUES($1,'synthetic_test','{}',$2,'processed')`, [runId,hash]);
  await pool.query(`INSERT INTO g8s_product.runs(id,owner_user_id,org_id,repository_id,installation_id,delivery_id,pr_number,
    head_sha,base_sha,base_branch,title,pr_url,trigger,dedup_key,state,result,finished_at)
    VALUES($1::uuid,$2,$3,$4,$5,$1::text,7,$6,$7,'main','Synthetic PR','https://github.com/owner-alpha/repository/pull/7',
    'pull_request','lesson-test','complete','{}',clock_timestamp())`, [runId,uuid(101),uuid(102),uuid(104),uuid(103),head,base]);
  await pool.query(`INSERT INTO g8s_product.findings(id,run_id,owner_user_id,org_id,repository_id,pr_number,file,line,end_line,
    severity,category,title,explanation,evidence) VALUES($1,$2,$3,$4,$5,7,'server.mjs',20,20,'medium','correctness',
    'Synthetic finding','Private test explanation','Test evidence')`, [uuid(11001),runId,uuid(101),uuid(102),uuid(104)]);
  const evidence = { reviews: [{ id: 11, user: { id: 901, login: identity.login, type: 'Bot' }, state: 'COMMENTED',
    body: 'Synthetic comparator finding', commit_id: head, submitted_at: '2026-11-08T12:00:00Z',
    pull_request_url: 'https://api.github.com/repos/owner-alpha/repository/pulls/7' }], inline: [], comments: [] };
  const captured = await comparisons.capture(a, 'alpha', runId, { evidence,
    observedRevision: { repositoryId: '101', prNumber: 7, headSha: head, baseSha: base, baseBranch: 'main' },
    expectedG8sDigest: (await comparisons.context(a, 'alpha', runId)).g8sDigest });
  const id = captured.comparisonId;
  const label = { snapshotId: captured.snapshotId, itemKey: 'gitar:review:11', expectedRevision: 0,
    verdict: 'valid_defect', rationale: 'PRIVATE_SYNTHETIC_LABEL', trainingUse: 'candidate', linkedItemKey: 'g8s:'+uuid(11001) };
  await comparisons.feedback(a, 'alpha', id, label, 'lesson-fixture-feedback-1');
  const input = bound => ({ expectedSubjectHash: bound.subjectHash, change: bound.subject.change,
    evidence: authority.evidence(bound), confirmed: true, reason: 'Synthetic human evidence confirmation' });
  let initial;
  await t.test('only explicit current server administrators can read or change policy', async () => {
    assert.equal((await store.readPolicy(a)).requireAdversarialVerification, true);
    await rejects(store.readPolicy(b), 'forbidden');
    await rejects(store.savePolicy(b, { requireAdversarialVerification: false, expectedRevision: 1, reason: 'forbidden' }), 'forbidden');
    await rejects(store.readPolicy({ kind: 'key', hash }), 'forbidden');
  });
  await t.test('preparation is not execution or a trained lesson, and requires the owner', async () => {
    initial = await store.prepare(a, 'alpha', id);
    assert.equal(initial.modelCalled, false); assert.equal(initial.lessonsBanked, false);
    await rejects(store.prepare(b, 'beta', id), 'not_found');
    await rejects(store.prepare(b, 'alpha', id), 'not_found');
  });
  await t.test('neither missing signer setup nor unchecked human confirmation can admit a lesson', async () => {
    const noKeys = new LessonStore(product, { ...config, trust: {} });
    await rejects(noKeys.bank(a, 'alpha', id, input(initial)), 'verification_setup_required');
    await rejects(store.bank(a, 'alpha', id, { ...input(initial), confirmed: false }), 'invalid_request');
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM g8s_product.banked_lesson_batches')).rows[0].n, 0);
  });
  await t.test('independent pools bank a verified subject once under eight simultaneous requests', async () => {
    const body = input(initial);
    const receipts = await Promise.all(Array.from({ length: 8 }, (_, n) => (n%2 ? store : other).bank(a, 'alpha', id, body)));
    assert.equal(new Set(receipts.map(row => row.batchId)).size, 1);
    assert.equal(receipts.filter(row => !row.duplicate).length, 1);
    assert.ok(receipts.every(row => row.trainingStarted === false && row.reviewerActivated === false));
  });
  await t.test('a feedback correction invalidates already-issued evidence and prior bank status', async () => {
    await comparisons.feedback(a, 'alpha', id, { ...label, expectedRevision: 1, rationale: 'Corrected private reasoning' }, 'lesson-feedback-correction-2');
    await rejects(store.bank(a, 'alpha', id, input(initial)), 'verification_stale');
    assert.equal((await store.list(a, 'alpha', id)).lessons[0].status, 'stale_requires_reverification');
  });
  await t.test('policy compare-and-swap prevents silent concurrent checkbox overwrite', async () => {
    const change = { requireAdversarialVerification: false, expectedRevision: 1, reason: 'Synthetic manual review mode' };
    const outcomes = await Promise.allSettled([store.savePolicy(a, change), other.savePolicy(a, change)]);
    assert.equal(outcomes.filter(row => row.status === 'fulfilled').length, 1);
    assert.equal(outcomes.find(row => row.status === 'rejected').reason.code, 'revision_conflict');
    assert.equal((await store.readPolicy(a)).revision, 2);
    assert.equal((await applyLearningSchemas(pool)).requireAdversarialVerification, false, 'migration must not reset an existing choice');
  });
  await t.test('unchecked still requires deterministic claim validation and human confirmation', async () => {
    const ready = await store.prepare(a, 'alpha', id), body = input(ready);
    assert.equal(body.evidence.adversarial, null);
    const missing = { ...body, evidence: { deterministic: null, adversarial: null } };
    await rejects(store.bank(a, 'alpha', id, missing), 'verification_required');
    const saved = await store.bank(a, 'alpha', id, body); assert.equal(saved.mode, 'deterministic_plus_human');
  });
  await t.test('re-enabling adversarial requirement invalidates the old deterministic-only subject', async () => {
    const old = await store.prepare(a, 'alpha', id);
    await store.savePolicy(a, { requireAdversarialVerification: true, expectedRevision: 2, reason: 'Return to required adversarial review' });
    await rejects(store.bank(a, 'alpha', id, input(old)), 'verification_stale');
    const current = await store.prepare(a, 'alpha', id), body = input(current); body.evidence.adversarial = null;
    await rejects(store.bank(a, 'alpha', id, body), 'verification_required');
  });
  await t.test('changed code requires reproduction and regression evidence on exact before/after commits', async () => {
    const ready = await store.prepare(a, 'alpha', id, { beforeSha: head, afterSha: 'c'.repeat(40), diffSha256: hash });
    const body = input(ready), altered = structuredClone(body.evidence.deterministic.payload);
    altered.change.beforeReproduced = false; body.evidence.deterministic = authority.signed('deterministic', altered);
    await rejects(store.bank(a, 'alpha', id, body), 'change_verification_required');
    assert.equal((await store.bank(a, 'alpha', id, input(ready))).status, 'banked_verified_examples');
  });
  await t.test('actual HTTP admin and lesson routes preserve origin, CSRF and current identity', async () => {
    const api = createLessonApi({ store, config: { apiOrigin: 'https://gate.g8s.test', frontendOrigin: 'https://g8s.test' },
      fallback(_req, res) { res.writeHead(404); res.end(); } });
    const server = createServer((req, res) => { void api.handler(req, res); });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = 'http://127.0.0.1:' + server.address().port;
    const request = async (path, options = {}) => {
      const r = await fetch(origin + path, { ...options, signal: AbortSignal.timeout(5000) });
      const data = await r.json(); return { status: r.status, data, headers: r.headers };
    };
    try {
      assert.equal((await request(LEARNING_POLICY_PATH)).status, 401);
      assert.equal((await request(LEARNING_POLICY_PATH, { headers: { Cookie: '__Host-g8s_session=' + token(2) } })).status, 403);
      const read = await request(LEARNING_POLICY_PATH, { headers: { Cookie: '__Host-g8s_session=' + token(1), Origin: 'https://g8s.test' } });
      assert.equal(read.status, 200); assert.equal(read.data.data.requireAdversarialVerification, true);
      const change = { requireAdversarialVerification: false, expectedRevision: read.data.data.revision, reason: 'Test' };
      assert.equal((await request(LEARNING_POLICY_PATH, { method: 'PUT', headers: { Cookie: '__Host-g8s_session=' + token(1), 'Content-Type': 'application/json' }, body: JSON.stringify(change) })).status, 403);
      const prepared = await request(LESSON_PATH + '/orgs/alpha/comparisons/' + id + '/prepare', { method: 'POST',
        headers: { Cookie: '__Host-g8s_session=' + token(1), Origin: 'https://g8s.test', 'X-G8S-Request': '1', 'Content-Type': 'application/json' }, body: '{"change":null}' });
      assert.equal(prepared.status, 200); assert.equal(prepared.data.data.modelCalled, false);
    } finally { api.stop(); await new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }); }
  });
  await t.test('revocation denies bank access and readback without caching an earlier session', async () => {
    const ready = await store.prepare(a, 'alpha', id);
    await pool.query('UPDATE g8s_product.users SET disabled=true WHERE id=$1', [uuid(101)]);
    await rejects(store.bank(a, 'alpha', id, input(ready)), 'unauthenticated');
    await pool.query('UPDATE g8s_product.users SET disabled=false WHERE id=$1', [uuid(101)]);
  });
  await t.test('comparison erasure also erases banked content; tombstone remains', async () => {
    assert.ok((await pool.query('SELECT count(*)::int AS n FROM g8s_product.banked_lesson_batches')).rows[0].n > 0);
    await comparisons.remove(a, 'alpha', id);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM g8s_product.banked_lesson_batches')).rows[0].n, 0);
    await rejects(store.prepare(a, 'alpha', id), 'comparison_deleted');
    assert.equal((await pool.query('SELECT paused FROM g8s_product.controls WHERE singleton=true')).rows[0].paused, true);
    const logs = JSON.stringify((await pool.query('SELECT details FROM g8s_product.audit_log')).rows);
    assert.equal(logs.includes('PRIVATE_SYNTHETIC_LABEL'), false);
  });
});
