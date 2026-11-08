import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptUrl = new URL('../scripts/product/qualify-postgres.sh', import.meta.url);
const read = path => readFileSync(new URL(path, import.meta.url), 'utf8');

test('full release qualifier requires inherited gates and the product PostgreSQL gate before success', () => {
  const recipe = read('../Dockerfile.reviews-qualify');
  const source = read('../scripts/reviews/qualify.sh');
  assert.match(recipe, /RUN \/bin\/sh scripts\/reviews\/qualify\.sh/u);
  const required = [
    'run_gate versions node scripts/reviews/qualification-versions.mjs',
    'run_gate canary node --test tests/proof-log-redaction-canary.test.mjs',
    'run_gate typecheck npm run typecheck',
    'run_gate score npm run score -- --selftest',
    'run_gate product-source node --test tests/product*.test.mjs',
    'run_gate real-postgres node --test tests/reviews-postgres.integration.mjs',
    'run_gate product-postgres /bin/sh scripts/product/qualify-postgres.sh',
    'run_gate full-source npm run test:learning-policy',
  ];
  let previous = -1;
  for (const line of required) {
    const index = source.indexOf('\n' + line + '\n');
    assert.ok(index > previous, 'mandatory gate absent, conditional, reordered or duplicated: ' + line);
    assert.equal(source.split('\n' + line + '\n').length, 2);
    previous = index;
  }
  assert.ok(source.indexOf("echo 'P6 qualification passed:") > previous);
  assert.match(source, /exit "\$gate_result"/u, 'a failing stage must preserve its nonzero status');
  assert.match(source, /full-source\) gate_deadline=90m/u, 'full suite budget must cover its observed accepted runtime');
  assert.match(source, /timeout --signal=TERM --kill-after=30s "\$gate_deadline"/u);
  assert.match(source, /cleanup\ntrap - EXIT INT TERM\nunset GK_REVIEWS_TEST_DATABASE_URL\nrun_gate full-source/u,
    'the full suite must retain its database-free environment');
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

test('product database qualifier refuses external capabilities before creating a database or revealing values', () => {
  const marker = 'TEST_ONLY_PRIVATE_BINDING_DO_NOT_PRINT';
  for (const name of ['DATABASE_URL', 'PGHOST', 'PGPORT', 'PGDATABASE', 'PGUSER', 'PGPASSWORD',
    'PGSERVICE', 'PGSERVICEFILE', 'PGPASSFILE', 'TRUEFORGE_API_KEY', 'TRUEFORGE_TOKEN',
    'TRUEFOUNDRY_API_KEY', 'OPENAI_API_KEY', 'ANTHROPIC_API_KEY', 'G8S_GITHUB_CLIENT_SECRET',
    'G8S_GITHUB_APP_PRIVATE_KEY', 'G8S_GITHUB_WEBHOOK_SECRET', 'GK_AUTHORITY_DRIVER_TOKEN']) {
    for (const value of [marker, '']) {
      const result = spawnSync('/bin/sh', [fileURLToPath(scriptUrl)], {
        env: { PATH: '/usr/local/bin:/usr/bin:/bin', [name]: value },
        encoding: 'utf8', timeout: 5000,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.status, 1, name + ' must be refused even when blank');
      assert.match(result.stderr, /external database or credential binding is present/u);
      assert.equal((result.stdout + result.stderr).includes(marker), false);
      assert.equal(result.stdout, '');
    }
  }
});

test('both release qualification shell scripts parse without executing any stage', () => {
  for (const path of ['../scripts/reviews/qualify.sh', '../scripts/product/qualify-postgres.sh']) {
    const result = spawnSync('/bin/sh', ['-n', fileURLToPath(new URL(path, import.meta.url))], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr);
  }
});
