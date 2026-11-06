// Synthetic only. Executed by the isolated remote qualifier, never production.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createOperationalDiagnostic } from '../scripts/learning-v2/operational-diagnostics.mjs';
import { createDetachedAuthorityClient } from '../scripts/learning-v2/authority-client.mjs';

const SECRET = 'TEST-ONLY-DO-NOT-LOG-provider-secret-private-output';
const ORIGIN = 'https://authority.fixture.invalid';
const TOKEN = SECRET.repeat(2);
const binding = { ownerId: 'TEST-ONLY-owner', experimentId: 'TEST-ONLY-experiment',
  sourceCommit: 'a'.repeat(40), configDigest: 'b'.repeat(64) };
const trust = Object.fromEntries(['evaluation', 'novelty'].map(role => [role,
  { publicKeyPem: 'TEST-ONLY-public-key', pinnedFingerprint: 'c'.repeat(64) }]));
const parse = lines => lines.map(line => {
  assert.ok(line.startsWith('GK_OPERATION_DIAGNOSTIC '));
  return JSON.parse(line.slice('GK_OPERATION_DIAGNOSTIC '.length));
});
const privateValuesAbsent = lines => {
  const text = lines.join('\n');
  for (const value of [SECRET, TOKEN, ORIGIN, binding.ownerId, binding.experimentId,
    binding.sourceCommit, binding.configDigest, 'PRIVATE-CALL-ID', 'PRIVATE-OPERATION-ID'])
    assert.equal(text.includes(value), false, 'private value leaked into diagnostics');
};
function clientFixture(fetcher, emit) {
  const lines = [], requests = [];
  const client = createDetachedAuthorityClient({ baseUrl: ORIGIN, token: TOKEN, binding, trust,
    emitDiagnostic: emit ?? (line => lines.push(line)), fetcher: async (url, options) => {
      requests.push({ url, options });
      assert.equal(url, ORIGIN + '/v1/gatekeeper/authority');
      assert.equal(options.redirect, 'error');
      assert.equal(options.headers.Authorization, 'Bearer ' + TOKEN);
      return fetcher(url, options);
    } });
  return { client, lines, requests };
}

test('diagnostics are bounded, allowlisted and unrelated to private operation identity', () => {
  const lines = [], emit = line => lines.push(line);
  const diagnostic = createOperationalDiagnostic({ component: 'authority-client', emit });
  const ignored = { toJSON() { assert.fail('unknown data must not be serialized'); } };
  diagnostic('request', 'started', { method: 'prepareProposalObservation', command: 'prepare-proposal-observation',
    reason: SECRET, error: ignored, stack: SECRET, cause: ignored, token: TOKEN, url: ORIGIN,
    operationId: 'PRIVATE-OPERATION-ID', httpStatus: 401, responseBytes: 10 });
  diagnostic(SECRET, 'failed'); diagnostic('request', SECRET);
  const event = parse(lines)[0];
  assert.equal(event.method, 'prepareProposalObservation'); assert.equal(event.httpStatus, 401);
  assert.equal(Object.hasOwn(event, 'reason'), false);
  assert.match(event.diagnosticId, /^[a-f0-9-]{36}$/u);
  assert.ok(Number.isFinite(Date.parse(event.at))); assert.ok(event.elapsedMs >= 0);
  assert.deepEqual(Object.keys(event).sort(), ['schema','component','diagnosticId','sequence','stage','outcome','at',
    'elapsedMs','method','command','httpStatus','responseBytes'].sort());
  for (let i = 0; i < 100; i++) diagnostic('complete', 'finished');
  assert.equal(lines.length, 32);
  assert.deepEqual(parse(lines).map(row => row.sequence), Array.from({ length: 32 }, (_, i) => i + 1));
  privateValuesAbsent(lines);
});

test('diagnostics validate a single field snapshot and contain hostile getters', () => {
  const lines = [], diagnostic = createOperationalDiagnostic({ component: 'authority-client', emit: line => lines.push(line) });
  let reads = 0;
  diagnostic('request', 'started', { get method() { return ++reads === 1 ? 'implementationStatus' : SECRET; } });
  assert.equal(reads, 1); assert.equal(parse(lines)[0].method, 'implementationStatus');
  assert.doesNotThrow(() => diagnostic('request', 'started', { get method() { throw Error(SECRET); } }));
  assert.equal(lines.length, 1);
  for (const bad of [null, SECRET, {}, Infinity, -1, 600])
    diagnostic('request', 'started', { method: bad, httpStatus: bad, responseBytes: bad });
  assert.ok(parse(lines).slice(1).every(row => !Object.hasOwn(row, 'method') && !Object.hasOwn(row, 'httpStatus')));
  privateValuesAbsent(lines);
});

test('logging sink failures never change return values or rejection semantics', async () => {
  for (const emit of [() => { throw Error(SECRET); }, async () => { throw Error(SECRET); }]) {
    const f = clientFixture(async () => Response.json({ result: { ok: true } }), emit);
    assert.deepEqual(await f.client.implementationStatus(), { ok: true });
    assert.equal(f.requests.length, 1);
    const failed = clientFixture(async () => { throw Error(SECRET); }, emit);
    await assert.rejects(failed.client.implementationStatus(), { code: 'GK_AUTHORITY_TRANSPORT_UNRESOLVED' });
    assert.equal(failed.requests.length, 1);
  }
  await new Promise(resolve => setImmediate(resolve));
});

test('actual preparation transport retains receipt bytes and logs stages, not evidence', async () => {
  const expected = { z: SECRET, signature: 'PRIVATE-CALL-ID', body: { b: 2, a: 1 } };
  const f = clientFixture(async () => Response.json({ result: expected }));
  const result = await f.client.prepareProposalObservation({ originalEvidence: SECRET });
  assert.equal(JSON.stringify(result), JSON.stringify(expected));
  assert.equal(f.requests.length, 1);
  assert.equal(JSON.parse(f.requests[0].options.body).method, 'prepareProposalObservation');
  const events = parse(f.lines);
  assert.deepEqual(events.map(row => [row.stage, row.outcome]), [
    ['request','started'], ['response-read','started'], ['response-decode','started'], ['complete','finished']]);
  assert.equal(new Set(events.map(row => row.diagnosticId)).size, 1);
  assert.equal(events.at(-1).httpStatus, 200); assert.ok(events.at(-1).responseBytes > 0);
  privateValuesAbsent(f.lines);
});

for (const [name, fetcher, code, stage, reason, status] of [
  ['network exception', async () => { throw Error(SECRET); }, 'GK_AUTHORITY_TRANSPORT_UNRESOLVED', 'request', 'transport-unresolved', undefined],
  ['malformed response', async () => new Response(SECRET, { status: 502 }), 'GK_AUTHORITY_RESPONSE_INVALID', 'response-decode', 'response-invalid', 502],
  ['authenticated refusal', async () => Response.json({ error: 'GK_AUTHORITY_REFUSED', message: SECRET,
    operationId: 'PRIVATE-OPERATION-ID' }, { status: 409 }), 'GK_AUTHORITY_REFUSED', 'response-decode', 'authority-refused', 409],
  ['unrecognised response code', async () => Response.json({ error: SECRET }, { status: 401 }),
    'GK_AUTHORITY_REFUSED', 'response-decode', 'authority-refused', 401],
  ['wrong response contract', async () => Response.json({ secret: SECRET }), 'GK_AUTHORITY_TRANSPORT_UNRESOLVED',
    'response-contract', 'response-contract-invalid', 200],
  ['interrupted body stream', async () => ({ status: 200, ok: true, body: (async function* () {
    yield Buffer.from('{'); throw Error(SECRET);
  })() }), 'GK_AUTHORITY_TRANSPORT_UNRESOLVED', 'response-read', 'transport-unresolved', 200],
  ['oversized response', async () => ({ status: 200, ok: true, body: (async function* () {
    yield Buffer.alloc(16 * 1024 * 1024 + 1);
  })() }), 'GK_AUTHORITY_TRANSPORT_UNRESOLVED', 'response-read', 'response-too-large', 200],
]) test('actual authority diagnostic isolates ' + name + ' without retrying', async () => {
  const f = clientFixture(fetcher);
  await assert.rejects(f.client.prepareProposalObservation({ secret: SECRET }), { code });
  assert.equal(f.requests.length, 1);
  const events = parse(f.lines), last = events.at(-1);
  assert.equal(last.stage, stage); assert.equal(last.outcome, 'failed'); assert.equal(last.reason, reason);
  assert.equal(last.httpStatus, status);
  assert.equal(events.some(row => row.outcome === 'finished'), false);
  privateValuesAbsent(f.lines);
});

test('authority timeout emits aborted without a retry or private identifiers', async () => {
  const f = clientFixture(async (_url, options) => new Promise((_resolve, reject) => {
    const rejectAbort = () => reject(Error(SECRET));
    if (options.signal.aborted) rejectAbort();
    else options.signal.addEventListener('abort', rejectAbort, { once: true });
  }));
  await assert.rejects(f.client.client.sessions.getTurn('PRIVATE-CALL-ID', 'PRIVATE-OPERATION-ID',
    { timeoutInSeconds: 0.01 }), { code: 'GK_AUTHORITY_TRANSPORT_UNRESOLVED' });
  assert.equal(f.requests.length, 1); assert.equal(parse(f.lines).at(-1).reason, 'aborted');
  privateValuesAbsent(f.lines);
});
