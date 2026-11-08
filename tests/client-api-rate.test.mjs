import test from 'node:test';
import assert from 'node:assert/strict';
import { ClientApiStore } from '../scripts/product/client-api-store.mjs';

function fixture() {
  let count = 0, allowed = true; const queries = [];
  const pool = { async query(sql, values) {
    queries.push({ sql, values });
    if (sql.includes('FROM g8s_product.client_keys')) return { rows: allowed ? [{ id: 'owner' }] : [] };
    if (sql.startsWith('INSERT INTO g8s_product.client_rate_windows')) {
      if (count >= 2) return { rows: [] }; return { rows: [{ requests: ++count }] };
    }
    if (sql.startsWith('DELETE FROM g8s_product.client_rate_windows')) return { rows: [] };
    assert.fail('unexpected test query');
  } };
  return { queries, revoke() { allowed = false; }, store: new ClientApiStore({ pool }, { requestsPerMinute: 2 }) };
}
const principal = { kind: 'key', hash: 'a'.repeat(64) };
test('retention runs only on the first accepted request in the rate window', async () => {
  const f = fixture(); await f.store.rate(principal); await f.store.rate(principal);
  assert.equal(f.queries.filter(x => x.sql.startsWith('DELETE')).length, 1);
  assert.equal(f.queries.filter(x => x.sql.includes('FROM g8s_product.client_keys')).length, 2);
  await assert.rejects(f.store.rate(principal), { code: 'rate_limited', status: 429 });
  assert.equal(f.queries.filter(x => x.sql.startsWith('DELETE')).length, 1);
});
test('rate optimization never reuses a cached identity after revocation', async () => {
  const f = fixture(); await f.store.rate(principal); f.revoke();
  await assert.rejects(f.store.rate(principal), { code: 'unauthenticated', status: 401 });
  assert.equal(f.queries.filter(x => x.sql.startsWith('INSERT')).length, 1);
  assert.equal(f.queries.filter(x => x.sql.includes('FROM g8s_product.client_keys')).length, 2);
});
