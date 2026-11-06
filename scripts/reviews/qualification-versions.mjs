// Qualification metadata only; no server startup, DB connection or provider call.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const serverPath = require.resolve('@truefoundry/trueforge/package.json');
const server = JSON.parse(readFileSync(serverPath, 'utf8'));
const sdk = JSON.parse(readFileSync(require.resolve('@truefoundry/trueforge-sdk/package.json'), 'utf8'));
const serverRequire = createRequire(serverPath);
let directory = dirname(serverRequire.resolve('pg')), pg;
for (let i = 0; i < 6; i++) {
  const path = join(directory, 'package.json');
  if (existsSync(path)) {
    const manifest = JSON.parse(readFileSync(path, 'utf8'));
    if (manifest.name === 'pg') { pg = manifest; break; }
  }
  directory = dirname(directory);
}
assert.equal(server.version, '0.182.0', 'P6 server version is unqualified');
assert.ok(['0.180.0', '0.182.0'].includes(sdk.version), 'P6 SDK version is unqualified');
assert.match(pg?.version ?? '', /^8\./u, 'P6 PostgreSQL driver major version is unqualified');
console.log('P6_RUNTIME_VERSIONS ' + JSON.stringify({ node: process.version,
  trueforge: server.version, sdk: sdk.version, pg: pg.version }));
