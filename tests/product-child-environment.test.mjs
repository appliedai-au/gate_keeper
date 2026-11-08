import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { trueforgeTransportEnvironment } from '../scripts/learning-v2/trueforge-status-gateway.mjs';
import { completedChildEnvironment } from '../scripts/learning-v2/completed-history-preflight.mjs';

const productNames = ['G8S_PRODUCT_ENABLED', 'G8S_PRODUCT_WORKER', 'G8S_GITHUB_APP_ID',
  'G8S_GITHUB_CLIENT_SECRET', 'G8S_GITHUB_APP_PRIVATE_KEY', 'G8S_GITHUB_WEBHOOK_SECRET',
  'G8S_DATABASE_URL', 'G8S_PRODUCT_DATABASE_URL', 'G8S_FUTURE_PRIVATE_BINDING'];
const shared = { RAILWAY_GIT_COMMIT_SHA: 'a'.repeat(40),
  TRUEFORGE_API_KEY: 'TEST_ONLY_MODEL_TRANSPORT', TRUEFOUNDRY_API_KEY: 'TEST_ONLY_MODEL_PROVIDER',
  DATABASE_URL: 'postgresql://test-only-model-database', REDIS_URL: 'redis://test-only-cache',
  NODE_ENV: 'production', GRACEFUL_TIMEOUT_SECONDS: '45',
  HOST: '0.0.0.0', PORT: '8080', PATH: '/usr/local/bin:/usr/bin:/bin' };
function fixture(enabled) {
  return Object.freeze({ ...shared, GK_COMPLETED_HISTORY_ROLE: 'serve',
    GK_V2_HOST_BOOTSTRAP: 'enabled', GK_V3_HTTP_ROUTER: 'enabled',
    GATEKEEPER_REVIEW_TOKEN: 'TEST_ONLY_PRIVATE_REVIEW',
    ...Object.fromEntries(productNames.map(name => [name, 'TEST_ONLY_PRODUCT_VALUE'])),
    G8S_PRODUCT_ENABLED: enabled });
}

test('ordinary transport child omits every product binding while its parent retains them', () => {
  for (const enabled of ['enabled', 'disabled']) {
    const parent = fixture(enabled), before = { ...parent };
    const child = trueforgeTransportEnvironment(parent);
    assert.notEqual(child, parent);
    assert.equal(Object.keys(child).some(name => name.startsWith('G8S_')), false);
    assert.equal(child.HOST, '127.0.0.1'); assert.equal(child.PORT, '8790');
    for (const [name, value] of Object.entries(shared)) if (!['HOST', 'PORT'].includes(name)) assert.equal(child[name], value);
    assert.deepEqual(parent, before);
    for (const name of productNames) assert.equal(Object.hasOwn(parent, name), true);
  }
});

test('completed-history child independently excludes product and historical control bindings', () => {
  const parent = fixture('enabled'), before = { ...parent };
  const child = completedChildEnvironment(parent);
  assert.equal(Object.keys(child).some(name => /^(?:G8S_|GK_|GATEKEEPER_)/u.test(name)), false);
  for (const [name, value] of Object.entries(shared)) assert.equal(child[name], value);
  assert.deepEqual(parent, before);
  assert.throws(() => completedChildEnvironment({ ...parent, GK_PRODUCTION_COMMAND: 'replay' }), /learning execution\/control/u,
    'product filtering must not weaken the historical role refusal');
});

test('actual spawned synthetic children receive no product bindings and both production boot sites use the filters', () => {
  for (const childEnv of [trueforgeTransportEnvironment(fixture('enabled')), completedChildEnvironment(fixture('enabled'))]) {
    const result = spawnSync(process.execPath, ['-e',
      'if(Object.keys(process.env).some(k=>k.startsWith("G8S_")))process.exit(41);' +
      'if(process.env.DATABASE_URL!=="postgresql://test-only-model-database")process.exit(42);' +
      'if(process.env.TRUEFORGE_API_KEY!=="TEST_ONLY_MODEL_TRANSPORT")process.exit(43);' +
      'process.stdout.write("TEST_ONLY_CHILD_ENV_OK")'], { env: childEnv, encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined); assert.equal(result.status, 0);
    assert.equal(result.stdout, 'TEST_ONLY_CHILD_ENV_OK'); assert.equal(result.stderr, '');
  }
  const gateway = readFileSync(new URL('../scripts/learning-v2/trueforge-status-gateway.mjs', import.meta.url), 'utf8');
  const completed = readFileSync(new URL('../scripts/learning-v2/launch-completed-history.mjs', import.meta.url), 'utf8');
  assert.match(gateway, /env: trueforgeTransportEnvironment\(env\)/u);
  assert.match(completed, /const childEnv = completedChildEnvironment\(env\)/u);
  assert.match(completed, /childEnv\.HOST = '127\.0\.0\.1'; childEnv\.PORT = '8790'/u);
  assert.match(completed, /return run\(executable, args, \{ \.\.\.options, env: childEnv \}\)/u);
});
