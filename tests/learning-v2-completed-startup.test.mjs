import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCompletedRoleEnvironment, completedChildEnvironment, verifyCompletedVolume, COMPLETED_MOUNT }
  from '../scripts/learning-v2/completed-history-preflight.mjs';
import { startCompletedHistoryApp } from '../scripts/learning-v2/launch-completed-history.mjs';
import { createCompletedStatusHandler } from '../scripts/learning-v2/completed-history-status.mjs';
import { publishCompletedProfileFile } from '../scripts/learning-v2/completed-history-control.mjs';
import { binding, completedResponse, nowMs } from './base44-completed-learning-fixture.mjs';

// Authored for the isolated remote mandatory source suite. No actual model,
// production volume, HTTP listener or TrueForge process is used by these tests.
const source = binding.servingSourceCommit;
const token = 'TEST_ONLY_completed_history_read_token_123456789';
const serving = () => ({ GK_COMPLETED_HISTORY_ROLE: 'serve', RAILWAY_GIT_COMMIT_SHA: source,
  GK_V2_HOST_BOOTSTRAP: 'enabled', GK_V3_HTTP_ROUTER: 'enabled', PORT: '8080' });
const roleEnv = role => ({ ...serving(), GK_COMPLETED_HISTORY_ROLE: role,
  ...(role === 'serve' ? {} : { GK_COMPLETED_HISTORY_SOURCE_PROOF_B64: 'TEST-ONLY-source-pin' }),
  ...(role === 'capture' ? { GK_COMPLETED_HISTORY_CAPSULE_SHA256: '1'.repeat(64) } : {}),
  ...(role === 'activate' ? { GK_COMPLETED_HISTORY_OWNER_PIN_B64: 'TEST-ONLY-owner-pin' } : {}) });

test('completed roles are explicit and refuse Learning execution credentials or unrelated control inputs', () => {
  for (const role of ['authority-export', 'capture', 'activate', 'serve'])
    assert.equal(assertCompletedRoleEnvironment(roleEnv(role), role), role);
  for (const [name, value] of [
    ['GK_PRODUCTION_COMMAND', 'run'], ['GK_PRODUCTION_CONFIG_B64', 'TEST-ONLY-driver-config'],
    ['GK_AUTHORITY_ROLE', 'serve'], ['GK_V3_READONLY_STATUS', 'enabled'],
    ['GK_IMPLEMENTATION_QUALIFICATION_B64', 'TEST-ONLY-historical-B'],
    ['GATEKEEPER_LEARNING_READ_TOKEN', 'TEST-ONLY-extra-token'],
    ['GATEKEEPER_AUTHORITY_TOKEN', 'TEST-ONLY-authority-token'],
    ['GK_COMPLETED_HISTORY_SOURCE_PROOF_B64', 'TEST-ONLY-leftover-import'],
  ]) assert.throws(() => assertCompletedRoleEnvironment({ ...serving(), [name]: value }, 'serve'));
  assert.throws(() => assertCompletedRoleEnvironment({ ...serving(), RAILWAY_GIT_COMMIT_SHA: '' }, 'serve'));
  assert.throws(() => assertCompletedRoleEnvironment({ ...serving(), GK_COMPLETED_HISTORY_ROLE: 'run' }, 'serve'));
  assert.throws(() => assertCompletedRoleEnvironment({ ...roleEnv('capture'), TRUEFORGE_API_KEY: 'TEST-ONLY-provider' }, 'capture'));
  assert.throws(() => assertCompletedRoleEnvironment({ ...roleEnv('authority-export'), GATEKEEPER_REVIEW_TOKEN_SHA256: '2'.repeat(64) }, 'authority-export'));
  assert.throws(() => assertCompletedRoleEnvironment({ ...roleEnv('activate'), GK_COMPLETED_HISTORY_CAPSULE_SHA256: '1'.repeat(64) }, 'activate'));
  const missing = roleEnv('capture'); delete missing.GK_COMPLETED_HISTORY_SOURCE_PROOF_B64;
  assert.throws(() => assertCompletedRoleEnvironment(missing, 'capture'));
});

test('retained-volume preflight refuses an empty mount and never prepares, changes ownership or accepts ambiguous mounts', () => {
  const names = ['production-config.json', 'status-config.json', 'implementation-qualification.json',
    'baseline-continuation-authorization.json', 'experiment', 'completed-history'];
  const mountinfo = '36 25 0:31 / ' + COMPLETED_MOUNT + ' rw - ext4 /dev/TEST-ONLY rw\n';
  const stat = path => ({ isDirectory: () => true, isSymbolicLink: () => false,
    uid: path === COMPLETED_MOUNT ? 1000 : 0, gid: path === COMPLETED_MOUNT ? 1000 : 0,
    mode: path === COMPLETED_MOUNT ? 0o40700 : 0o40755 });
  const options = { env: serving(), currentUid: 0, mountinfo, stat,
    list: path => path === COMPLETED_MOUNT ? [...names] : [] };
  assert.deepEqual(verifyCompletedVolume(options), { ready: true, prepared: false, path: COMPLETED_MOUNT, role: 'serve' });
  assert.throws(() => verifyCompletedVolume({ ...options, list: () => [] }), /retained host evidence/);
  assert.throws(() => verifyCompletedVolume({ ...options, currentUid: 1000 }), /root preflight/);
  assert.throws(() => verifyCompletedVolume({ ...options, mountinfo: '' }), /dedicated volume/);
  assert.throws(() => verifyCompletedVolume({ ...options, mountinfo: mountinfo + mountinfo }), /ambiguous/);
  assert.throws(() => verifyCompletedVolume({ ...options,
    stat: path => ({ ...stat(path), ...(path === COMPLETED_MOUNT ? { uid: 0, mode: 0o40755 } : {}) }) }), /fresh\/unprepared/);
  assert.throws(() => verifyCompletedVolume({ ...options,
    stat: path => ({ ...stat(path), ...(path === '/var/lib' ? { mode: 0o40777 } : {}) }) }), /ancestor custody/);
  assert.throws(() => verifyCompletedVolume({ ...options,
    list: path => path === COMPLETED_MOUNT ? [...names, 'lost+found'] : ['unexpected'],
    stat: path => ({ ...stat(path), ...(path.endsWith('/lost+found') ? { mode: 0o40700 } : {}) }) }), /filesystem-managed/);
});

test('no gateway or child starts before actual-C source, closure and control-variable checks pass', async t => {
  t.mock.method(process, 'getuid', () => 1000);
  let reads = 0, statuses = 0, gateways = 0, children = 0;
  const options = { env: serving(), read: async () => { reads++; return { binding, readToken: token, sourceCommit: source,
    readStatus: async () => { statuses++; return completedResponse(); } }; },
  startGateway: async () => { gateways++; return 'TEST-ONLY gateway'; }, run: () => { children++; } };
  await assert.rejects(startCompletedHistoryApp({ ...options, env: { ...serving(), GK_PRODUCTION_COMMAND: 'run' } }));
  assert.deepEqual([reads, statuses, gateways, children], [0, 0, 0, 0]);
  await assert.rejects(startCompletedHistoryApp({ ...options, read: async () => { throw new Error('TEST-ONLY missing original B sidecar'); } }));
  await assert.rejects(startCompletedHistoryApp({ ...options, read: async () => ({ sourceCommit: 'b'.repeat(40) }) }), /actual serving C/);
  await assert.rejects(startCompletedHistoryApp({ ...options, read: async () => ({ binding, readToken: token, sourceCommit: source,
    readStatus: async () => { throw new Error('TEST-ONLY modified original archive'); } }) }));
  assert.equal(gateways, 0); assert.equal(children, 0);
  assert.equal(await startCompletedHistoryApp(options), 'TEST-ONLY gateway');
  assert.deepEqual([reads, statuses, gateways, children], [1, 1, 1, 0]);
});

test('actual C owns one fixed TrueForge child and strips every Learning and review control credential from its environment', async t => {
  t.mock.method(process, 'getuid', () => 1000);
  const env = { ...serving(), GATEKEEPER_REVIEW_ENABLED: 'enabled', GATEKEEPER_REVIEW_SOURCE_COMMIT: source,
    GATEKEEPER_REVIEW_TOKEN_SHA256: '2'.repeat(64), TRUEFORGE_API_KEY: 'TEST-ONLY-internal-transport',
    DATABASE_URL: 'postgresql://TEST-ONLY/reviews', HOST: '0.0.0.0' };
  const seen = [], read = async () => ({ binding, readToken: token, sourceCommit: source, readStatus: async () => completedResponse() });
  const run = (...args) => { seen.push(args); return { syntheticChild: true }; };
  let wrapped;
  await startCompletedHistoryApp({ env, read, run, startGateway: async options => {
    assert.equal(options.env.RAILWAY_GIT_COMMIT_SHA, source);
    wrapped = options.run;
    assert.deepEqual(wrapped(process.execPath, ['node_modules/@truefoundry/trueforge/dist/main.js'],
      { cwd: '/app', stdio: 'inherit', env: { ...env, HOST: '127.0.0.1', PORT: '8790' } }), { syntheticChild: true });
  } });
  assert.equal(seen.length, 1);
  const child = seen[0][2].env;
  assert.ok(Object.keys(child).every(name => !name.startsWith('GK_') && !name.startsWith('GATEKEEPER_')));
  assert.equal(child.RAILWAY_GIT_COMMIT_SHA, source); assert.equal(child.HOST, '127.0.0.1'); assert.equal(child.PORT, '8790');
  assert.equal(child.TRUEFORGE_API_KEY, env.TRUEFORGE_API_KEY); assert.equal(child.DATABASE_URL, env.DATABASE_URL);
  assert.throws(() => wrapped(process.execPath, ['node_modules/@truefoundry/trueforge/dist/main.js'],
    { cwd: '/app', env }), /exactly one/);
  assert.equal(seen.length, 1);
  assert.equal(completedChildEnvironment(env).RAILWAY_GIT_COMMIT_SHA, source);
  await assert.rejects(startCompletedHistoryApp({ env, read, run, startGateway: async options =>
    options.run(process.execPath, ['scripts/learning-v2/production.mjs'], { cwd: '/app', env }) }), /exactly one/);
  assert.equal(seen.length, 1);
});

async function response(handler, patch = {}) {
  const incoming = { method: 'GET', url: '/gatekeeper/learning-v2/status', headers: {
    'x-gatekeeper-learning-token': token, 'x-gatekeeper-learning-owner': binding.ownerId }, rawHeaders: [], ...patch };
  const output = { status: null, headers: null, body: null };
  await handler(incoming, { writeHead(status, headers) { output.status = status; output.headers = headers; },
    end(body) { output.body = JSON.parse(body); } });
  return output;
}

test('completed status retains the owner-only transport boundary and truthful A/B/C provenance', async () => {
  let reads = 0;
  const handler = createCompletedStatusHandler({ binding, readToken: token, clock: () => nowMs,
    readStatus: async () => { reads++; return completedResponse(); } });
  const denied = [
    [{ headers: {} }, 401],
    [{ headers: { 'x-gatekeeper-learning-token': 'TEST_ONLY_wrong_private_token_123456789' } }, 401],
    [{ headers: { 'x-gatekeeper-learning-token': token, 'x-gatekeeper-learning-owner': 'another-owner' } }, 403],
    [{ method: 'POST' }, 405], [{ url: '/gatekeeper/learning-v2/status?experiment=another' }, 400],
    [{ headers: { 'content-length': '0' } }, 405], [{ url: '/other' }, 404],
    [{ rawHeaders: ['x-test', 'a'.repeat(9000)] }, 400],
  ];
  for (const [patch, expected] of denied) assert.equal((await response(handler, patch)).status, expected);
  assert.equal(reads, 0, 'denied requests cannot open or project the private archive');
  const result = await response(handler);
  assert.equal(result.status, 200); assert.equal(reads, 1);
  assert.deepEqual(result.body, completedResponse()); assert.match(result.headers['Cache-Control'], /no-store/);
  assert.equal(result.body.status.sourceCommit, binding.sourceCommit);
  assert.equal(result.body.archive.executionSourceCommit, binding.executionSourceCommit);
  assert.equal(result.body.serving.sourceCommit, source);
});

test('completed status holds on stale, substituted or unreadable closure with a fixed response and no legacy fallback', async () => {
  for (const readStatus of [
    async () => { throw new Error('TEST-ONLY private session secret/path must not be returned'); },
    async () => ({ ...completedResponse(), checkedAt: new Date(nowMs - 61000).toISOString() }),
    async () => ({ ...completedResponse(), serving: { mode: 'completed-history', sourceCommit: 'b'.repeat(40) } }),
    async () => ({ schema: 'gk-learning-v2-status-response', checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status }),
  ]) {
    const result = await response(createCompletedStatusHandler({ binding, readToken: token, clock: () => nowMs, readStatus }));
    assert.equal(result.status, 503); assert.deepEqual(result.body, { error: 'learning_status_unavailable' });
    assert.match(result.headers['Cache-Control'], /no-store/);
  }
});

test('new completed-profile files are create-once, retain partial writes as held and cannot overwrite historical files', t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-closed-publication-')); chmodSync(root, 0o700);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'completed-history'); mkdirSync(directory, { mode: 0o700 });
  const original = join(root, 'production-config.json'); writeFileSync(original, 'TEST-ONLY-original', { mode: 0o600, flag: 'wx' });
  const capsule = Buffer.from('{"TEST-ONLY":"complete immutable capsule"}');
  publishCompletedProfileFile({ directory, name: 'authority-capsule.json', bytes: capsule });
  assert.deepEqual(readFileSync(join(directory, 'authority-capsule.json')), capsule);
  assert.throws(() => publishCompletedProfileFile({ directory, name: 'authority-capsule.json', bytes: Buffer.from('replacement') }), /EEXIST/);
  writeFileSync(join(directory, 'closure.json'), '{', { flag: 'wx', mode: 0o600 });
  assert.throws(() => publishCompletedProfileFile({ directory, name: 'closure.json', bytes: Buffer.from('{"repaired":true}') }), /EEXIST/);
  assert.equal(readFileSync(join(directory, 'closure.json'), 'utf8'), '{', 'partial publication remains held for operator evidence');
  assert.throws(() => publishCompletedProfileFile({ directory, name: '../production-config.json', bytes: Buffer.from('replacement') }));
  assert.equal(readFileSync(original, 'utf8'), 'TEST-ONLY-original');
  assert.deepEqual(readdirSync(directory).sort(), ['authority-capsule.json', 'closure.json']);
  chmodSync(directory, 0o755);
  assert.throws(() => publishCompletedProfileFile({ directory, name: 'activation.json', bytes: Buffer.from('{}') }), /mode 0700/);
  assert.deepEqual(readdirSync(directory).sort(), ['authority-capsule.json', 'closure.json']);
});
