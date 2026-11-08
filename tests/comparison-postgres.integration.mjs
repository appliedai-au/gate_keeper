import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import pg from 'pg';
import { ProductStore, DEFAULT_CONFIGURATION } from '../scripts/product/store.mjs';
import { ComparisonStore } from '../scripts/product/comparison-store.mjs';
import { tokenHash } from '../scripts/product/client-api-store.mjs';
import { createComparisonApi, COMPARISON_PATH } from '../scripts/product/comparison-api.mjs';

if (process.env.G8S_COMPARISON_POSTGRES_TEST !== 'isolated-loopback') throw new Error('Explicit isolated comparison qualification required');
for (const name of ['DATABASE_URL','PGHOST','PGPORT','PGDATABASE','PGUSER','PGPASSWORD','PGSERVICE','PGSERVICEFILE','PGPASSFILE',
  'TRUEFORGE_API_KEY','TRUEFORGE_TOKEN','TRUEFOUNDRY_API_KEY','OPENAI_API_KEY','ANTHROPIC_API_KEY','G8S_GITHUB_CLIENT_SECRET','G8S_GITHUB_APP_PRIVATE_KEY','G8S_GITHUB_WEBHOOK_SECRET'])
  if (Object.hasOwn(process.env, name)) throw new Error('External capability refused');
const uuid = n => '00000000-0000-4000-8000-' + String(n).padStart(12, '0');
const token = n => Buffer.alloc(32, n).toString('base64url');
const principal = n => ({ kind: 'session', hash: tokenHash(token(n)) });
const a = principal(1), b = principal(2), head = 'a'.repeat(40), base = 'b'.repeat(40);
const identity = { userId: '901', login: 'test-reviewer[bot]' };
const evidence = (body = 'PRIVATE_SYNTHETIC_COMPARATOR_BODY') => ({ reviews: [{ id: 11,
  user: { id: 901, login: identity.login, type: 'Bot' }, state: 'COMMENTED', body, commit_id: head,
  submitted_at: '2026-11-08T12:00:00Z', pull_request_url: 'https://api.github.com/repos/owner-alpha/repository/pulls/7' }], inline: [], comments: [] });
const observedRevision = { repositoryId: '101', prNumber: 7, headSha: head, baseSha: base };
const options = { connectionString: 'postgresql://g8s_comparison_qualification@127.0.0.1:55435/g8s_comparison_qualification',
  max: 10, connectionTimeoutMillis: 3000, statement_timeout: 5000, query_timeout: 8000,
  application_name: 'g8s-comparison-isolated-test' };
const rejects = (promise, code) => assert.rejects(promise, error => error.code === code);

test('real PostgreSQL comparison capture, feedback and privacy controls', { timeout: 90000 }, async t => {
  const pool = new pg.Pool(options), otherPool = new pg.Pool(options);
  t.after(async () => { await Promise.all([pool.end(), otherPool.end()]); });
  assert.equal((await pool.query('SELECT current_database() AS db')).rows[0].db, 'g8s_comparison_qualification');
  assert.equal((await pool.query("SELECT to_regnamespace('g8s_product') IS NOT NULL AS present")).rows[0].present, false);
  await pool.query(await readFile(new URL('../scripts/product/schema.sql', import.meta.url), 'utf8'));
  const product = new ProductStore(pool), otherProduct = new ProductStore(otherPool);
  const store = new ComparisonStore(product, { identity }), other = new ComparisonStore(otherProduct, { identity });
  await assert.rejects(store.ready());
  await pool.query(await readFile(new URL('../scripts/product/comparison-schema.sql', import.meta.url), 'utf8'));
  await store.ready();
  // Comparison session auth must not require the optional client-key schema.
  assert.equal((await pool.query("SELECT to_regclass('g8s_product.client_keys') AS value")).rows[0].value, null);
  for (const [index, slug, repoId] of [[1, 'alpha', '101'], [2, 'beta', '201']]) {
    const n = index * 100;
    await pool.query('INSERT INTO g8s_product.users(id,github_id,login) VALUES($1,$2,$3)', [uuid(n+1), String(n+1), 'owner-'+slug]);
    await pool.query('INSERT INTO g8s_product.organizations(id,owner_user_id,slug,name) VALUES($1,$2,$3,$3)', [uuid(n+2),uuid(n+1),slug]);
    await pool.query("INSERT INTO g8s_product.memberships(org_id,user_id,role) VALUES($1,$2,'owner')", [uuid(n+2),uuid(n+1)]);
    await pool.query("INSERT INTO g8s_product.sessions(session_hash,user_id,expires_at) VALUES($1,$2,clock_timestamp()+interval '1 day')", [principal(index).hash,uuid(n+1)]);
    await pool.query('INSERT INTO g8s_product.settings(org_id,owner_user_id,configuration) VALUES($1,$2,$3)', [uuid(n+2),uuid(n+1),JSON.stringify(DEFAULT_CONFIGURATION)]);
    await pool.query('INSERT INTO g8s_product.user_limits(user_id,monthly_run_limit,max_concurrent_runs) VALUES($1,0,1)', [uuid(n+1)]);
    await pool.query(`INSERT INTO g8s_product.installations(id,owner_user_id,org_id,github_installation_id,account_id,account_login,account_type,repository_selection)
      VALUES($1,$2,$3,$4,$5,$6,'User','selected')`, [uuid(n+3),uuid(n+1),uuid(n+2),String(n+50),String(n+1),'owner-'+slug]);
    await pool.query(`INSERT INTO g8s_product.repositories(id,owner_user_id,org_id,installation_id,github_repo_id,full_name,name,default_branch,private,enabled)
      VALUES($1,$2,$3,$4,$5,$6,'repository','main',true,true)`, [uuid(n+4),uuid(n+1),uuid(n+2),uuid(n+3),repoId,'owner-'+slug+'/repository']);
  }
  async function makeRun(n, state = 'complete') {
    await pool.query(`INSERT INTO g8s_product.webhook_deliveries(delivery_id,event,payload,payload_hash,status)
      VALUES($1,'synthetic_test',$2,$3,'processed')`, [uuid(n),JSON.stringify({ test: n }),tokenHash('test:'+n)]);
    await pool.query(`INSERT INTO g8s_product.runs(id,owner_user_id,org_id,repository_id,installation_id,delivery_id,pr_number,
      head_sha,base_sha,base_branch,title,pr_url,trigger,dedup_key,state,result,finished_at,model)
      VALUES($1,$2,$3,$4,$5,$1,7,$6,$7,'main','Synthetic PR','https://github.com/owner-alpha/repository/pull/7',
        'pull_request',$8,$9,$10,clock_timestamp(),'synthetic-model')`,
    [uuid(n),uuid(101),uuid(102),uuid(104),uuid(103),head,base,'test:'+n,state,JSON.stringify({ summary: 'Synthetic G8S review', risk: 'low', verdict: 'COMMENT' })]);
    await pool.query(`INSERT INTO g8s_product.findings(id,run_id,owner_user_id,org_id,repository_id,pr_number,file,line,end_line,
      severity,category,title,explanation,evidence) VALUES($1,$2,$3,$4,$5,7,'server.mjs',20,20,'medium','correctness',
      'Synthetic finding','PRIVATE_SYNTHETIC_G8S_EXPLANATION','Synthetic evidence')`, [uuid(n+10000),uuid(n),uuid(101),uuid(102),uuid(104)]);
    return uuid(n);
  }
  const runId = await makeRun(1001), incompleteId = await makeRun(1002, 'running');
  const input = async (run = runId, body) => ({ evidence: evidence(body), observedRevision,
    expectedG8sDigest: (await store.context(a, 'alpha', run)).g8sDigest });
  let captured, initialSnapshot;
  await t.test('comparison refuses incomplete reviews, foreign tenants and review API keys', async () => {
    await rejects(store.context(a, 'alpha', incompleteId), 'review_not_complete');
    await rejects(store.context(b, 'beta', runId), 'not_found');
    await rejects(store.context(b, 'alpha', runId), 'not_found');
    await rejects(store.context({ kind: 'key', hash: 'f'.repeat(64) }, 'alpha', runId), 'forbidden');
  });
  await t.test('independent pools concurrently import exactly one immutable capture', async () => {
    const value = await input();
    const results = await Promise.all(Array.from({ length: 8 }, (_, n) => (n%2 ? store : other).capture(a, 'alpha', runId, value)));
    assert.equal(new Set(results.map(x => x.comparisonId)).size, 1);
    assert.equal(new Set(results.map(x => x.snapshotId)).size, 1);
    assert.equal(results.filter(x => !x.duplicate).length, 1);
    captured = results[0]; initialSnapshot = captured.snapshotId;
    const detail = await store.detail(a, 'alpha', captured.comparisonId);
    assert.equal(detail.g8s.headSha, head); assert.equal(detail.g8s.baseSha, base);
    assert.equal(detail.gitar.artifacts[0].revisionBinding, 'head_only');
    assert.equal(detail.metrics.baseRevisionVerified, false); assert.equal(detail.metrics.winner, null);
    assert.equal((await store.list(a, 'alpha')).comparisons.length, 1);
    assert.equal((await store.list(b, 'beta')).comparisons.length, 0);
  });
  const label = (patch = {}) => ({ snapshotId: initialSnapshot, itemKey: 'gitar:review:11', expectedRevision: 0,
    verdict: 'valid_defect', rationale: 'PRIVATE_SYNTHETIC_HUMAN_REASON', trainingUse: 'candidate',
    linkedItemKey: 'g8s:'+uuid(11001), ...patch });
  await t.test('competing judgments produce one committed revision and explicit conflicts', async () => {
    const results = await Promise.allSettled(Array.from({ length: 8 }, (_, n) => (n%2 ? store : other).feedback(a, 'alpha', captured.comparisonId,
      label(), 'judgment-request-'+String(n).padStart(4,'0'))));
    assert.equal(results.filter(x => x.status === 'fulfilled').length, 1);
    assert.ok(results.filter(x => x.status === 'rejected').every(x => x.reason.code === 'revision_conflict'));
    const detail = await store.detail(a, 'alpha', captured.comparisonId);
    assert.equal(detail.feedback.length, 1); assert.equal(detail.feedback[0].revision, 1);
    assert.equal(detail.metrics.trainingCandidates, 1); assert.equal(detail.metrics.automaticTrainingEligible, false);
  });
  await t.test('idempotent feedback and append-only corrections cannot silently overwrite a judgment', async () => {
    const next = label({ expectedRevision: 1, verdict: 'false_positive', trainingUse: 'excluded' });
    const first = await store.feedback(a, 'alpha', captured.comparisonId, next, 'stable-judgment-request-1');
    const repeat = await other.feedback(a, 'alpha', captured.comparisonId, next, 'stable-judgment-request-1');
    assert.equal(first.id, repeat.id); assert.equal(repeat.duplicate, true); assert.equal(repeat.revision, 2);
    await rejects(store.feedback(a, 'alpha', captured.comparisonId, { ...next, rationale: 'changed' }, 'stable-judgment-request-1'), 'idempotency_conflict');
    const detail = await store.detail(a, 'alpha', captured.comparisonId);
    assert.equal(detail.feedbackHistory.length, 2); assert.equal(detail.feedback[0].verdict, 'false_positive');
    assert.equal(detail.metrics.trainingCandidates, 0);
  });
  await t.test('edited comparator output appends a new capture and old feedback is not rebound', async () => {
    const changed = await store.capture(a, 'alpha', runId, await input(runId, 'Edited comparator output'));
    assert.equal(changed.version, 2); assert.notEqual(changed.snapshotId, initialSnapshot);
    const current = await store.detail(a, 'alpha', captured.comparisonId);
    assert.equal(current.feedback.length, 0);
    const original = await store.detail(a, 'alpha', captured.comparisonId, 1);
    assert.equal(original.feedbackHistory.length, 2); assert.equal(original.gitar.artifacts[0].body, 'PRIVATE_SYNTHETIC_COMPARATOR_BODY');
    await rejects(store.feedback(a, 'alpha', captured.comparisonId, label({ expectedRevision: 2 }), 'old-snapshot-request-001'), 'snapshot_changed');
  });
  await t.test('access is checked again after remote work, and source changes refuse stale capture', async () => {
    const value = await input();
    await pool.query('UPDATE g8s_product.repositories SET enabled=false WHERE id=$1', [uuid(104)]);
    await rejects(store.capture(a, 'alpha', runId, value), 'not_found');
    await rejects(store.detail(a, 'alpha', captured.comparisonId), 'not_found');
    assert.equal((await store.list(a, 'alpha')).comparisons.length, 0);
    await pool.query('UPDATE g8s_product.repositories SET enabled=true WHERE id=$1', [uuid(104)]);
    await rejects(store.capture(a, 'alpha', runId, { ...value, expectedG8sDigest: 'changed' }), 'revision_changed');
    await pool.query("UPDATE g8s_product.installations SET disabled_reason='test' WHERE id=$1", [uuid(103)]);
    await rejects(store.detail(a, 'alpha', captured.comparisonId), 'not_found');
    await pool.query('UPDATE g8s_product.installations SET disabled_reason=NULL WHERE id=$1', [uuid(103)]);
  });
  await t.test('new schema remains private and audit excludes raw evidence, rationale and session hashes', async () => {
    const audit = JSON.stringify((await pool.query('SELECT details FROM g8s_product.audit_log')).rows);
    for (const secret of ['PRIVATE_SYNTHETIC', a.hash, token(1)]) assert.equal(audit.includes(secret), false);
    const grants = await pool.query(`SELECT table_name FROM information_schema.table_privileges WHERE table_schema='g8s_product'
      AND table_name LIKE 'comparison%' AND grantee='PUBLIC'`);
    assert.equal(grants.rows.length, 0);
  });
  await t.test('failure after capture rolls back new comparison, snapshot and audit together', async () => {
    const rollbackRun = await makeRun(1003);
    class FailingProduct extends ProductStore { async audit() { throw new Error('synthetic audit failure'); } }
    const failing = new ComparisonStore(new FailingProduct(otherPool), { identity });
    const before = (await pool.query('SELECT count(*)::int AS n FROM g8s_product.comparisons')).rows[0].n;
    await assert.rejects(failing.capture(a, 'alpha', rollbackRun, await input(rollbackRun)));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM g8s_product.comparisons')).rows[0].n, before);
  });
  await t.test('actual loopback API captures, reads and exports feedback candidates without inference', async () => {
    const httpRun = await makeRun(1004); let api;
    const server = createServer((req, res) => { void api.handler(req, res); });
    await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
    const origin = 'http://127.0.0.1:'+server.address().port;
    api = createComparisonApi({ store, config: { apiOrigin: origin, frontendOrigin: 'https://g8s.test' },
      github: { async installationClient(_id, _repo, flags) { assert.deepEqual(flags,{readOnly:true}); return {
        mayCommand: async () => true, pullRequest: async () => ({ head:{sha:head},base:{sha:base,ref:'main'} }),
        comparisonEvidence: async () => evidence(), }; } },
      fallback(_req,res) { res.writeHead(404); res.end(); } });
    try {
      const request = async (path, method = 'GET', body, idem) => {
        const response = await fetch(origin+COMPARISON_PATH+'/orgs/alpha/comparisons'+path, { method,
          headers: { Cookie:'__Host-g8s_session='+token(1),Origin:'https://g8s.test','Content-Type':'application/json','X-G8S-Request':'1',
            ...(idem?{'Idempotency-Key':idem}:{}) }, ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(5000) });
        return { status:response.status, body:await response.json() };
      };
      const created = await request('','POST',{runId:httpRun}); assert.equal(created.status,200);
      const c = created.body.data; assert.equal(c.trainingStarted,false);
      const judged = await request('/'+c.comparisonId+'/feedback','POST', label({snapshotId:c.snapshotId,
        linkedItemKey:'g8s:'+uuid(11004)}),'actual-http-judgment-01'); assert.equal(judged.status,200);
      const exported = await request('/'+c.comparisonId+'/candidates'); assert.equal(exported.status,200);
      assert.equal(exported.body.data.candidates.length,1); assert.equal(exported.body.data.automaticTrainingEligible,false);
      assert.equal(exported.body.data.trainingStarted,false);
      const read = await request('/'+c.comparisonId); assert.equal(read.body.data.metrics.winner,null);
    } finally { api.stop(); await new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}); }
  });
  await t.test('deleted comparison erases content and labels, keeps a non-recreation tombstone', async () => {
    const value = await input();
    await pool.query('UPDATE g8s_product.repositories SET enabled=false WHERE id=$1',[uuid(104)]);
    const deleted = await store.remove(a,'alpha',captured.comparisonId); assert.equal(deleted.deleted,true);
    await pool.query('UPDATE g8s_product.repositories SET enabled=true WHERE id=$1',[uuid(104)]);
    for(const table of ['comparison_feedback','comparison_snapshots']) assert.equal((await pool.query(
      'SELECT count(*)::int AS n FROM g8s_product.'+table+' WHERE comparison_id=$1',[captured.comparisonId])).rows[0].n,0);
    await rejects(store.capture(a,'alpha',runId,value),'comparison_deleted');
    await rejects(store.detail(a,'alpha',captured.comparisonId),'comparison_deleted');
    assert.ok((await pool.query('SELECT deleted_at FROM g8s_product.comparisons WHERE id=$1',[captured.comparisonId])).rows[0].deleted_at);
  });
  await t.test('expired and revoked sessions cannot recover private capture data', async () => {
    await pool.query("UPDATE g8s_product.sessions SET expires_at=clock_timestamp()-interval '1 second' WHERE session_hash=$1",[a.hash]);
    await rejects(store.list(a,'alpha'),'unauthenticated');
    await pool.query("UPDATE g8s_product.sessions SET expires_at=clock_timestamp()+interval '1 day' WHERE session_hash=$1",[a.hash]);
    await pool.query('UPDATE g8s_product.users SET authorization_revoked_at=clock_timestamp() WHERE id=$1',[uuid(101)]);
    await rejects(store.list(a,'alpha'),'unauthenticated');
    assert.equal((await pool.query('SELECT paused FROM g8s_product.controls WHERE singleton=true')).rows[0].paused,true);
  });
});
