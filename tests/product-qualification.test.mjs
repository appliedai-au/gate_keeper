import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, rmSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { COMPLETED_QUALIFICATION_RECIPE } from '../scripts/learning-v2/completed-history-proof.mjs';

const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');
const pathOf = path => fileURLToPath(new URL(path, import.meta.url));
const isolatedEnv = { PATH: '/usr/local/bin:/usr/bin:/bin' };

test('G8S qualification preserves both immutable historical recipe hashes', () => {
  const pin = COMPLETED_QUALIFICATION_RECIPE;
  assert.equal(pin.dockerfile, 'Dockerfile.reviews-qualify');
  assert.equal(pin.runner, 'scripts/reviews/qualify.sh');
  assert.equal(pin.dockerfileSha256, 'c4ff16a3eaca5db2d02bad81b40337a688d336472946468ee4488b7f0f0aceac');
  assert.equal(pin.runnerSha256, '1bac3526e9e44fead93177814c351217aff85a75bb0f709558b271c6e4584d0d');
  for (const [path, expected] of [[pin.dockerfile, pin.dockerfileSha256], [pin.runner, pin.runnerSha256]]) {
    assert.equal(createHash('sha256').update(read('../' + path)).digest('hex'), expected,
      'new product coverage must not rewrite the historical recipe: ' + path);
  }
});

test('separate product recipe requires product, historical-proof and full inherited qualification before success', () => {
  const recipe = read('../Dockerfile.product-qualify');
  const source = read('../scripts/product/qualify.sh');
  const historical = read('../scripts/reviews/qualify.sh');
  assert.match(recipe, /RUN \/bin\/sh scripts\/product\/qualify\.sh/u);
  assert.match(recipe, /COPY Dockerfile .*Dockerfile\.reviews-qualify Dockerfile\.product-qualify \.\//u);
  const required = [
    'run_product_gate product-source 20m node --test tests/product*.test.mjs',
    'run_product_gate historical-proof 20m node --test tests/learning-v2-completed-proof.test.mjs',
    'run_product_gate product-postgres 20m /bin/sh scripts/product/qualify-postgres.sh',
    'run_product_gate inherited-release 90m /bin/sh scripts/reviews/qualify.sh',
  ];
  let previous = -1;
  for (const line of required) {
    const index = source.indexOf('\n' + line + '\n');
    assert.ok(index > previous, 'mandatory stage absent, conditional or reordered: ' + line);
    assert.equal(source.split('\n' + line + '\n').length, 2);
    previous = index;
  }
  assert.ok(source.indexOf("printf 'G8S_QUAL_COMPLETE:") > previous);
  for (const line of [
    'run_gate versions node scripts/reviews/qualification-versions.mjs',
    'run_gate canary node --test tests/proof-log-redaction-canary.test.mjs',
    'run_gate typecheck npm run typecheck',
    'run_gate score npm run score -- --selftest',
    'run_gate full-source npm run test:learning-policy',
    'run_gate real-postgres node --test tests/reviews-postgres.integration.mjs',
  ]) assert.ok(historical.includes('\n' + line + '\n'), 'missing inherited stage: ' + line);
  assert.match(source, /set -eu/u);
  assert.equal(/^export (?:GK_REVIEWS_TEST_DATABASE_URL|G8S_PRODUCT_POSTGRES_TEST)=/mu.test(source), false,
    'the inherited release must not receive product test bindings');
});

test('product database qualifier is pinned to disposable loopback and runs the independent-pool suite', () => {
  const source = read('../scripts/product/qualify-postgres.sh');
  const suite = read('./product-postgres.integration.mjs');
  assert.match(source, /mktemp -d \/tmp\/g8s-product-pg\.XXXXXX/u);
  assert.match(source, /-h 127\.0\.0\.1 -p 55433 -k \/tmp/u);
  assert.match(source, /-U g8s_product_qualification g8s_product_qualification/u);
  assert.match(source, /^G8S_PRODUCT_POSTGRES_TEST=isolated-loopback node --test tests\/product-postgres\.integration\.mjs$/mu);
  assert.match(source, /trap cleanup EXIT/u);
  assert.match(source, /exit "\$result"/u);
  assert.match(suite, /postgresql:\/\/g8s_product_qualification@127\.0\.0\.1:55433\/g8s_product_qualification/u);
  assert.match(suite, /competingPool = new Pool\(options\)/u);
});

test('product qualification entrypoints refuse external capabilities before execution or revealing values', () => {
  const marker = 'TEST_ONLY_PRIVATE_BINDING_DO_NOT_PRINT';
  const common = ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'TRUEFORGE_API_KEY', 'TRUEFORGE_TOKEN',
    'TRUEFOUNDRY_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'G8S_GITHUB_CLIENT_SECRET',
    'G8S_GITHUB_APP_PRIVATE_KEY', 'G8S_GITHUB_WEBHOOK_SECRET', 'GK_AUTHORITY_DRIVER_TOKEN',
    'GATEKEEPER_REVIEW_TOKEN', 'GATEKEEPER_LEARNING_READ_TOKEN'];
  for (const path of ['../scripts/product/qualify.sh', '../scripts/product/qualify-postgres.sh']) {
    const names = path.endsWith('/qualify.sh') ? [...common, 'GK_REVIEWS_TEST_DATABASE_URL', 'G8S_PRODUCT_POSTGRES_TEST'] : common;
    for (const name of names) for (const value of [marker, '']) {
      const result = spawnSync('/bin/sh', [pathOf(path)], {
        env: { ...isolatedEnv, [name]: value }, encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, name + ' must be refused even when blank');
      assert.match(result.stderr, /external database or credential binding is present/u);
      assert.equal((result.stdout + result.stderr).includes(marker), false);
      assert.equal(result.stdout, '');
    }
  }
});

function executeStage(name, deadline, command) {
  return spawnSync('/bin/sh', ['-c',
    'set -eu; . "$1"; shift; run_product_gate "$@"; printf "TEST_ONLY_NEXT_STAGE\\n"',
    'g8s-stage-regression', pathOf('../scripts/product/qualification-stage.sh'), name, deadline,
    '/bin/sh', '-c', command], { env: isolatedEnv, encoding: 'utf8', timeout: 10000 });
}

test('real product-stage shell preserves command exit status and blocks later stages on failure', t => {
  for (const code of [0, 7, 19]) {
    const name = 'test-status-' + randomUUID();
    const log = '/tmp/gk-g8s-' + name + '.log';
    t.after(() => rmSync(log, { force: true }));
    const result = executeStage(name, '20m', 'printf "TEST_ONLY_STDOUT\\n"; printf "TEST_ONLY_STDERR\\n" >&2; exit ' + code);
    assert.equal(result.error, undefined);
    assert.equal(result.status, code);
    assert.ok(result.stdout.includes('G8S_QUAL_STAGE_END ' + name + ' exit=' + code));
    assert.equal(result.stdout.includes('TEST_ONLY_NEXT_STAGE'), code === 0);
    const retained = readFileSync(log, 'utf8');
    assert.equal(retained, 'TEST_ONLY_STDOUT\nTEST_ONLY_STDERR\n');
    assert.ok(result.stdout.includes('TEST_ONLY_STDOUT'));
    assert.ok(result.stdout.includes('TEST_ONLY_STDERR'));
  }
});

test('real product-stage timeout and invalid selectors fail without a later-stage marker', t => {
  const name = 'test-timeout-' + randomUUID();
  t.after(() => rmSync('/tmp/gk-g8s-' + name + '.log', { force: true }));
  const timed = executeStage(name, '1s', 'sleep 5; printf "TEST_ONLY_TOO_LATE\\n"');
  assert.equal(timed.error, undefined);
  assert.equal(timed.status, 124);
  assert.equal(timed.stdout.includes('TEST_ONLY_TOO_LATE'), false);
  assert.equal(timed.stdout.includes('TEST_ONLY_NEXT_STAGE'), false);
  for (const [selector, deadline] of [['../outside', '20m'], ['', '20m'], ['test-invalid', '0'], ['test-invalid', 'unbounded']]) {
    const result = executeStage(selector, deadline, 'exit 0');
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2);
    assert.equal(result.stdout, '');
  }
});

test('historical and product qualification scripts parse without executing any stage', () => {
  for (const path of ['../scripts/reviews/qualify.sh', '../scripts/product/qualify.sh',
    '../scripts/product/qualification-stage.sh', '../scripts/product/qualify-postgres.sh']) {
    const result = spawnSync('/bin/sh', ['-n', pathOf(path)], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  }
});
