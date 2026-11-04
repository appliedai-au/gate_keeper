/** Source prepared for the complete remote gate; do not run locally. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { DispatchLedger } from '../scripts/learning-v2/dispatch-ledger.mjs';
import { FileJournal, MemoryJournal } from '../scripts/learning-v2/journal.mjs';

const SCHEMA = 'gk-learning-v2-dispatch-ledger-v1';
const IDENTITY = { experimentId: 'experiment:dispatch', configDigest: 'c'.repeat(64) };
const ANCHOR = { schema: SCHEMA, type: 'initialized', ...IDENTITY };
const ADMISSION = '{\n  "signature":"external admission fixture", "body":{"z":2,"a":1}\n}\n';
const SETTLEMENT = ' {"body":{"receiptId":"settlement:first","actualCalls":1},"signature":"external settlement fixture"} ';
const NOT_ADMITTED = '{ "signature":"external non-admission fixture", "body":{"receiptId":"not-admitted:first","status":"not-admitted"} }\n';

function fixture({ kind = 'proposal', attemptId = 'attempt:1', id = 'operation:first', changes = {} } = {}) {
  const request = {
    schema: 'gk-learning-v2-execution-request', ...IDENTITY, sourceCommit: 'a'.repeat(40),
    kind, attemptId, namespace: `${IDENTITY.experimentId}:${kind}:${attemptId || 'base'}`,
    model: 'tfy-managed/test-model', provider: 'truefoundry', memory: 'off',
    requiredCalls: kind === 'proposal' ? 1 : 4,
    plan: { retained: ['private scheduling data'] }, ...changes,
  };
  const operation = { id, kind, attemptId, namespace: request.namespace, requestDigest: digest(request) };
  return { operation, request };
}

function fresh(journal) {
  return new DispatchLedger({ journal, ...IDENTITY });
}

async function initialized(journal = new MemoryJournal()) {
  const ledger = fresh(journal);
  await ledger.initialize();
  return { ledger, journal };
}

async function resolveNotAdmitted(ledger, operationId, receiptId = 'not-admitted:first') {
  await ledger.observe(operationId, 'not-admitted', NOT_ADMITTED);
  await ledger.complete(operationId, { kind: 'not-admitted', receiptId });
}

async function settle(ledger, operationId) {
  await ledger.observe(operationId, 'admission', ADMISSION);
  await ledger.observe(operationId, 'settlement', SETTLEMENT);
  await ledger.complete(operationId, { kind: 'settled', receiptId: 'settlement:first' });
}

async function appendRaw(journal, event) {
  await journal.append((await journal.read()).head, event);
}

function diskFixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-dispatch-ledger-'));
  chmodSync(root, 0o700);
  const repositoryRoot = join(root, 'repository');
  mkdirSync(repositoryRoot, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { repositoryRoot, directory: join(root, 'private', 'dispatch') };
}

test('an empty ledger refuses reads and mutations until explicit create-once initialization', async () => {
  const journal = new MemoryJournal();
  const ledger = fresh(journal);
  const { operation, request } = fixture();
  await assert.rejects(ledger.read(), /uninitialized/);
  await assert.rejects(ledger.claim(operation, request), /uninitialized/);
  await assert.rejects(ledger.observe(operation.id, 'admission', ADMISSION), /uninitialized/);
  await assert.rejects(ledger.select(operation.id, 'admission', 0), /uninitialized/);
  await assert.rejects(ledger.complete(operation.id, { kind: 'not-admitted', receiptId: 'receipt:first' }), /uninitialized/);
  assert.deepEqual(await journal.read(), { head: null, events: [] });
  assert.deepEqual(await ledger.initialize(), { ...IDENTITY, entries: [], pending: null });
  const before = await journal.read();
  await assert.rejects(ledger.initialize(), /already initialized/);
  await assert.rejects(fresh(journal).initialize(), /already initialized/);
  assert.deepEqual(await journal.read(), before);
});

test('concurrent initialization publishes one anchor and rejects the stale writer', async () => {
  const journal = new MemoryJournal();
  const results = await Promise.allSettled([fresh(journal).initialize(), fresh(journal).initialize()]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /stale expected head/);
  assert.equal((await journal.read()).events.length, 1);
});

test('the durable anchor refuses a different experiment or configuration', async () => {
  const { journal } = await initialized();
  for (const identity of [
    { ...IDENTITY, experimentId: 'experiment:other' },
    { ...IDENTITY, configDigest: 'f'.repeat(64) },
  ]) {
    const ledger = new DispatchLedger({ journal, ...identity });
    await assert.rejects(ledger.read(), /anchor identity mismatch/);
    await assert.rejects(ledger.initialize(), /anchor identity mismatch/);
    await assert.rejects(ledger.claim(fixture().operation, fixture().request), /anchor identity mismatch/);
  }
});

test('competing claimants publish at most one pending intent before gateway admission', async () => {
  for (const sameIntent of [true, false]) {
    const { journal } = await initialized();
    const left = fixture();
    const right = sameIntent ? copy(left) : fixture({ id: 'operation:other', attemptId: 'attempt:2' });
    const results = await Promise.allSettled([left, right].map(({ operation, request }) =>
      fresh(journal).claim(operation, request)));
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
    assert.equal(results.filter(result => result.status === 'rejected').length, 1);
    assert.match(results.find(result => result.status === 'rejected').reason.message, /stale expected head/);
    const state = await fresh(journal).read();
    assert.equal(state.entries.length, 1);
    assert.deepEqual(state.pending, state.entries[0]);
    assert.equal(state.pending.admission, null);
    assert.equal(state.pending.notAdmitted, null);
    assert.deepEqual(state.pending.observations, []);
    assert.equal(state.pending.selectionCount, 0);
    assert.equal(state.pending.resolution, null);
  }
});

test('a reopened pending intent blocks the old call and every competing operation', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  const reopened = fresh(journal);
  const before = await journal.read();
  await assert.rejects(reopened.claim(operation, request), /operation pending/);
  const different = fixture({ id: 'operation:other', attemptId: 'attempt:2' });
  await assert.rejects(reopened.claim(different.operation, different.request), /operation pending/);
  await assert.rejects(reopened.initialize(), /already initialized/);
  assert.deepEqual(await journal.read(), before);
  assert.equal((await reopened.read()).pending.operation.id, operation.id);
});

test('FileJournal retains unresolved observations and a missing store never silently reinitializes', async t => {
  const paths = diskFixture(t);
  const open = () => fresh(new FileJournal(paths));
  const { operation, request } = fixture();
  await open().initialize();
  await open().claim(operation, request);
  await open().observe(operation.id, 'admission', ADMISSION);
  const pending = (await open().read()).pending;
  assert.equal(pending.admission, ADMISSION);
  assert.equal(pending.settlement, null);
  await assert.rejects(open().claim(operation, request), /operation pending/);
  // Only this test's private temporary journal is removed. Reopening must fail
  // rather than creating an implicit anchor and forgetting a pending admission.
  rmSync(paths.directory, { recursive: true });
  await assert.rejects(open().read(), /uninitialized/);
  await assert.rejects(open().claim(operation, request), /uninitialized/);
});

test('operation and request identity errors are rejected before intent publication', async () => {
  const variants = [
    values => { values.operation.extra = true; },
    values => { values.operation.leaseId = 'not-yet-admitted'; },
    values => { values.operation.id = ''; },
    values => { values.operation.requestDigest = 'f'.repeat(64); },
    values => { values.operation.kind = 'screen'; },
    values => { values.operation.attemptId = 'attempt:other'; },
    values => { values.operation.namespace = 'namespace:other'; },
    values => { values.request.schema = 'wrong-request'; },
    values => { values.request.experimentId = 'experiment:other'; },
    values => { values.request.configDigest = 'f'.repeat(64); },
    values => { values.request.sourceCommit = 'not-a-commit'; },
    values => { values.request.model = ''; },
    values => { values.request.provider = 'unapproved'; },
    values => { values.request.memory = 'on'; },
    values => { values.request.requiredCalls = 0; },
    values => { values.request.requiredCalls = 1.5; },
  ];
  for (const change of variants) {
    const { ledger, journal } = await initialized();
    const values = fixture();
    change(values);
    await assert.rejects(ledger.claim(values.operation, values.request), /LEARNING_V2_REJECTED:/);
    assert.equal((await journal.read()).events.length, 1);
  }
  for (const values of [fixture({ kind: 'baseline', attemptId: 'attempt:1' }), fixture({ attemptId: null })]) {
    const { ledger } = await initialized();
    await assert.rejects(ledger.claim(values.operation, values.request), /dispatch baseline attempt|invalid identifier/);
  }
});

test('later claims cannot drift source or model while reusing the experiment digest', async () => {
  const { ledger, journal } = await initialized();
  const first = fixture();
  await ledger.claim(first.operation, first.request);
  await resolveNotAdmitted(ledger, first.operation.id);
  for (const changes of [{ sourceCommit: 'f'.repeat(40) }, { model: 'tfy-managed/other-model' }]) {
    const next = fixture({ id: 'operation:other', attemptId: 'attempt:2', changes });
    await assert.rejects(fresh(journal).claim(next.operation, next.request), /changed within experiment/);
  }
  const next = fixture({ id: 'operation:other', attemptId: 'attempt:2' });
  await ledger.claim(next.operation, next.request);
  assert.equal((await ledger.read()).entries.length, 2);
});

test('a completed logical phase and operation ID cannot be claimed again even after non-admission', async () => {
  for (const admitted of [true, false]) {
    const { ledger } = await initialized();
    const first = fixture();
    await ledger.claim(first.operation, first.request);
    if (admitted) await settle(ledger, first.operation.id);
    else await resolveNotAdmitted(ledger, first.operation.id);
    assert.equal((await ledger.read()).pending, null);
    await assert.rejects(ledger.claim(first.operation, first.request), /operation id already claimed/);
    const samePhase = fixture({ id: 'operation:renamed' });
    await assert.rejects(ledger.claim(samePhase.operation, samePhase.request), /logical phase already claimed/);
    const reusedId = fixture({ id: first.operation.id, attemptId: 'attempt:2' });
    await assert.rejects(ledger.claim(reusedId.operation, reusedId.request), /operation id already claimed/);
  }
});

test('observations preserve original signed strings and require admission before settlement', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await assert.rejects(ledger.observe(operation.id, 'admission', ADMISSION), /intent required/);
  await ledger.claim(operation, request);
  await assert.rejects(ledger.observe(operation.id, 'settlement', SETTLEMENT), /admission observation required/);
  for (const serialized of ['', ' \n\t ', {}, null]) {
    await assert.rejects(ledger.observe(operation.id, 'admission', serialized), /nonempty serialized string/);
  }
  await assert.rejects(ledger.observe(operation.id, 'other', ADMISSION), /unknown dispatch observation kind/);
  await ledger.observe(operation.id, 'admission', ADMISSION);
  await assert.rejects(ledger.observe(operation.id, 'admission', ADMISSION), /already recorded/);
  await ledger.observe(operation.id, 'settlement', SETTLEMENT);
  await assert.rejects(ledger.observe(operation.id, 'settlement', SETTLEMENT), /already recorded/);
  const reopened = await fresh(journal).read();
  assert.equal(reopened.pending.admission, ADMISSION);
  assert.equal(reopened.pending.settlement, SETTLEMENT);
  assert.equal(reopened.pending.resolution, null);
  assert.deepEqual(reopened.pending.observations, [
    { kind: 'admission', serialized: ADMISSION }, { kind: 'settlement', serialized: SETTLEMENT },
  ]);
  assert.equal((await journal.read()).events[2].serializedEnvelope, ADMISSION);
});

test('receipts are opaque observations and never authenticate or automatically complete an operation', async () => {
  const { ledger } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  const malformed = 'malformed external response retained for reconciliation; not JSON';
  await ledger.observe(operation.id, 'admission', malformed);
  assert.equal((await ledger.read()).pending.admission, malformed);
  assert.equal((await ledger.read()).pending.resolution, null);
  await assert.rejects(ledger.complete(operation.id, { kind: 'not-admitted', receiptId: 'receipt:first' }), /not-admitted observation required/);
  await assert.rejects(ledger.complete(operation.id, { kind: 'settled', receiptId: 'receipt:first' }), /settlement observations required/);
});

test('settlement remains pending across restart until the host explicitly resolves it', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  await ledger.observe(operation.id, 'admission', ADMISSION);
  await ledger.observe(operation.id, 'settlement', SETTLEMENT);
  const reopened = fresh(journal);
  assert.equal((await reopened.read()).pending.operation.id, operation.id);
  const next = fixture({ id: 'operation:next', attemptId: 'attempt:2' });
  await assert.rejects(reopened.claim(next.operation, next.request), /operation pending/);
  await reopened.complete(operation.id, { kind: 'settled', receiptId: 'settlement:first' });
  assert.equal((await fresh(journal).read()).pending, null);
  assert.deepEqual((await fresh(journal).read()).entries[0].resolution, { kind: 'settled', receiptId: 'settlement:first' });
});

test('resolution shape ordering and terminal immutability are enforced without rewriting evidence', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  const invalid = [
    { kind: 'settled', receiptId: 'receipt:first' },
    { kind: 'cancelled', receiptId: 'receipt:first' },
    { kind: 'not-admitted', receiptId: '' },
    { kind: 'not-admitted', receiptId: 'receipt:first', evidence: 'extra' },
  ];
  for (const resolution of invalid) await assert.rejects(ledger.complete(operation.id, resolution), /LEARNING_V2_REJECTED:/);
  await resolveNotAdmitted(ledger, operation.id);
  const before = await journal.read();
  for (const kind of ['admission', 'settlement', 'not-admitted']) await assert.rejects(ledger.observe(operation.id, kind, ADMISSION), /terminal/);
  for (const kind of ['not-admitted', 'settled']) {
    await assert.rejects(ledger.complete(operation.id, { kind, receiptId: 'receipt:replacement' }), /terminal/);
  }
  assert.deepEqual(await journal.read(), before);
});

test('concurrent observations and concurrent resolutions each have one CAS winner', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  const observing = await Promise.allSettled([ADMISSION, ADMISSION + '\n'].map(serialized =>
    fresh(journal).observe(operation.id, 'admission', serialized)));
  assert.equal(observing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(observing.filter(result => result.status === 'rejected').length, 1);
  await ledger.observe(operation.id, 'settlement', SETTLEMENT);
  const completing = await Promise.allSettled(['receipt:first', 'receipt:second'].map(receiptId =>
    fresh(journal).complete(operation.id, { kind: 'settled', receiptId })));
  assert.equal(completing.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(completing.filter(result => result.status === 'rejected').length, 1);
  const state = await ledger.read();
  assert.equal(state.entries.length, 1);
  assert.equal(state.pending, null);
  assert.ok(['receipt:first', 'receipt:second'].includes(state.entries[0].resolution.receiptId));
});

test('caller mutations before await and returned snapshots cannot alter the ledger', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  const claiming = ledger.claim(operation, request);
  operation.id = 'changed-after-entry';
  request.plan.retained[0] = 'changed-after-entry';
  await claiming;
  await ledger.observe('operation:first', 'not-admitted', NOT_ADMITTED);
  const resolution = { kind: 'not-admitted', receiptId: 'receipt:original' };
  const completing = ledger.complete('operation:first', resolution);
  resolution.receiptId = 'receipt:changed';
  await completing;
  const output = await ledger.read();
  output.experimentId = 'changed-output';
  output.entries[0].request.plan.retained.length = 0;
  output.entries[0].resolution.receiptId = 'receipt:changed-output';
  output.entries[0].observations[0].serialized = 'changed-output';
  output.entries[0].notAdmitted = 'changed-output';
  output.entries[0].selectionCount = 999;
  const reopened = await fresh(journal).read();
  assert.equal(reopened.experimentId, IDENTITY.experimentId);
  assert.equal(reopened.entries[0].operation.id, 'operation:first');
  assert.deepEqual(reopened.entries[0].request.plan.retained, ['private scheduling data']);
  assert.equal(reopened.entries[0].resolution.receiptId, 'receipt:original');
  assert.equal(reopened.entries[0].notAdmitted, NOT_ADMITTED);
  assert.deepEqual(reopened.entries[0].observations, [{ kind: 'not-admitted', serialized: NOT_ADMITTED }]);
  assert.equal(reopened.entries[0].selectionCount, 0);
});

test('claim validation rejects accessors and executable data before reading caller properties', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  let invoked = false;
  const accessor = { ...request };
  Object.defineProperty(accessor, 'plan', { enumerable: true, get() { invoked = true; return {}; } });
  await assert.rejects(ledger.claim(operation, accessor), /object accessor/);
  await assert.rejects(ledger.claim(operation, { ...request, plan: { run() { invoked = true; } } }), /non-JSON value/);
  assert.equal(invoked, false);
  assert.equal((await journal.read()).events.length, 1);
});

test('logical replay rejects missing anchors unknown schemas and duplicate or out-of-order records', async () => {
  const { operation, request } = fixture();
  const claim = { schema: SCHEMA, type: 'claimed', operation, request };
  const admission = { schema: SCHEMA, type: 'observed', operationId: operation.id, kind: 'admission', serializedEnvelope: ADMISSION };
  const settlement = { ...admission, kind: 'settlement', serializedEnvelope: SETTLEMENT };
  const notAdmittedObservation = { ...admission, kind: 'not-admitted', serializedEnvelope: NOT_ADMITTED };
  const notAdmitted = { schema: SCHEMA, type: 'completed', operationId: operation.id,
    resolution: { kind: 'not-admitted', receiptId: 'receipt:first' } };
  const completed = { ...notAdmitted, resolution: { kind: 'settled', receiptId: 'receipt:first' } };
  const invalidHistories = [
    [], [claim], [admission], [ANCHOR, ANCHOR], [{ ...ANCHOR, schema: 'unknown-ledger' }],
    [{ ...ANCHOR, extra: true }], [ANCHOR, { schema: SCHEMA, type: 'unknown' }],
    [ANCHOR, admission], [ANCHOR, claim, claim], [ANCHOR, claim, settlement],
    [ANCHOR, claim, admission, admission], [ANCHOR, claim, completed],
    [ANCHOR, claim, notAdmitted], [ANCHOR, claim, admission, notAdmitted],
    [ANCHOR, claim, notAdmittedObservation, notAdmitted, admission],
    [ANCHOR, claim, admission, settlement, completed, completed],
    [ANCHOR, claim, notAdmittedObservation, notAdmitted, { ...claim, operation: { ...operation, id: 'operation:renamed' } }],
    [ANCHOR, claim, { ...admission, operationId: 'operation:missing' }],
  ];
  for (const history of invalidHistories) {
    const journal = new MemoryJournal();
    for (const event of history) await appendRaw(journal, event);
    const ledger = fresh(journal);
    await assert.rejects(ledger.read(), /LEARNING_V2_REJECTED:/);
    await assert.rejects(ledger.claim(operation, request), /LEARNING_V2_REJECTED:/);
  }
});

test('replay checks original request identity and stable source even when journal hashes are valid', async () => {
  const { operation, request } = fixture();
  const next = fixture({ id: 'operation:next', attemptId: 'attempt:2', changes: { sourceCommit: 'f'.repeat(40) } });
  for (const history of [
    [{ schema: SCHEMA, type: 'claimed', operation, request: { ...request, requiredCalls: 9 } }],
    [{ schema: SCHEMA, type: 'claimed', operation, request },
      { schema: SCHEMA, type: 'observed', operationId: operation.id, kind: 'not-admitted', serializedEnvelope: NOT_ADMITTED },
      { schema: SCHEMA, type: 'completed', operationId: operation.id, resolution: { kind: 'not-admitted', receiptId: 'receipt:first' } },
      { schema: SCHEMA, type: 'claimed', operation: next.operation, request: next.request }],
  ]) {
    const journal = new MemoryJournal();
    await journal.append(null, ANCHOR);
    for (const event of history) await appendRaw(journal, event);
    await assert.rejects(fresh(journal).read(), /request digest mismatch|changed within experiment/);
  }
});

test('a committed intent with lost acknowledgement is retained and never retried automatically', async () => {
  const { journal } = await initialized();
  const { operation, request } = fixture();
  let writes = 0;
  const ambiguous = {
    read: () => journal.read(),
    async append(head, event) {
      writes++;
      await journal.append(head, event);
      throw new Error('dispatch acknowledgement lost');
    },
  };
  await assert.rejects(fresh(ambiguous).claim(operation, request), /acknowledgement lost/);
  assert.equal(writes, 1);
  assert.equal((await fresh(journal).read()).pending.operation.id, operation.id);
  await assert.rejects(fresh(journal).claim(operation, request), /operation pending/);
  assert.equal((await journal.read()).events.length, 2);
});

test('corrected recovery observations retain every original byte without authorizing progression', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  const malformedAdmission = 'original malformed gateway response';
  const expiredSettlement = '{"body":{"expired":true},"signature":"old fixture"}\n';
  await ledger.observe(operation.id, 'admission', malformedAdmission);
  await ledger.observe(operation.id, 'settlement', expiredSettlement);
  // An explicit recovery can retain a fresh admission even after settlement
  // was observed. The ledger neither verifies these strings nor calls admit.
  await fresh(journal).observe(operation.id, 'admission', ADMISSION);
  await fresh(journal).observe(operation.id, 'settlement', SETTLEMENT);
  const state = await fresh(journal).read();
  assert.equal(state.pending.operation.id, operation.id);
  assert.equal(state.pending.admission, ADMISSION);
  assert.equal(state.pending.settlement, SETTLEMENT);
  assert.equal(state.pending.resolution, null);
  assert.deepEqual(state.pending.observations, [
    { kind: 'admission', serialized: malformedAdmission },
    { kind: 'settlement', serialized: expiredSettlement },
    { kind: 'admission', serialized: ADMISSION },
    { kind: 'settlement', serialized: SETTLEMENT },
  ]);
  await assert.rejects(ledger.observe(operation.id, 'admission', malformedAdmission), /already recorded/);
  await assert.rejects(ledger.observe(operation.id, 'settlement', expiredSettlement), /already recorded/);
  const next = fixture({ id: 'operation:next', attemptId: 'attempt:2' });
  await assert.rejects(ledger.claim(next.operation, next.request), /operation pending/);
  await ledger.complete(operation.id, { kind: 'settled', receiptId: 'settlement:first' });
  await assert.rejects(ledger.observe(operation.id, 'admission', ADMISSION + '\n'), /terminal/);
  assert.equal((await ledger.read()).entries[0].observations.length, 4);
});

test('non-admission resolution requires retained receipt bytes rather than absence of admission', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  await assert.rejects(ledger.complete(operation.id, { kind: 'not-admitted', receiptId: 'not-admitted:first' }),
    /not-admitted observation required/);
  // A malformed observed response is not proof that a controller operation
  // exists. The host must authenticate reconciliation and check that state.
  await ledger.observe(operation.id, 'admission', 'unverified transport error');
  await ledger.observe(operation.id, 'not-admitted', NOT_ADMITTED);
  const pending = (await fresh(journal).read()).pending;
  assert.equal(pending.notAdmitted, NOT_ADMITTED);
  assert.equal(pending.resolution, null);
  await assert.rejects(ledger.observe(operation.id, 'not-admitted', NOT_ADMITTED), /already recorded/);
  await ledger.complete(operation.id, { kind: 'not-admitted', receiptId: 'not-admitted:first' });
  const entry = (await fresh(journal).read()).entries[0];
  assert.equal(entry.notAdmitted, NOT_ADMITTED);
  assert.deepEqual(entry.observations, [
    { kind: 'admission', serialized: 'unverified transport error' },
    { kind: 'not-admitted', serialized: NOT_ADMITTED },
  ]);
  await assert.rejects(ledger.observe(operation.id, 'not-admitted', NOT_ADMITTED + '\n'), /terminal/);
});

test('recovery observations have a 32-record bound enforced on writes and replay', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  await ledger.observe(operation.id, 'admission', ADMISSION);
  for (let index = 1; index < 32; index++) await ledger.observe(operation.id, 'settlement', `${SETTLEMENT}\n${index}`);
  const before = await journal.read();
  assert.equal((await fresh(journal).read()).pending.observations.length, 32);
  await assert.rejects(ledger.observe(operation.id, 'settlement', `${SETTLEMENT}\n32`), /observation limit reached/);
  assert.deepEqual(await journal.read(), before);
  await appendRaw(journal, { schema: SCHEMA, type: 'observed', operationId: operation.id,
    kind: 'settlement', serializedEnvelope: `${SETTLEMENT}\n32` });
  await assert.rejects(fresh(journal).read(), /observation limit reached/);
});

test('recovery reselects retained receipt bytes without duplicating observations or clearing pending work', async () => {
  for (const kind of ['admission', 'settlement', 'not-admitted']) {
    const { ledger, journal } = await initialized();
    const { operation, request } = fixture();
    await ledger.claim(operation, request);
    if (kind === 'settlement') await ledger.observe(operation.id, 'admission', ADMISSION);
    const valid = kind === 'admission' ? ADMISSION : kind === 'settlement' ? SETTLEMENT : NOT_ADMITTED;
    const invalid = `later independently signed but invalid ${kind} fixture`;
    const observationIndex = (await ledger.read()).pending.observations.length;
    await ledger.observe(operation.id, kind, valid);
    await ledger.observe(operation.id, kind, invalid);
    const originals = (await ledger.read()).pending.observations;
    const field = kind === 'not-admitted' ? 'notAdmitted' : kind;
    assert.equal((await ledger.read()).pending[field], invalid);
    await fresh(journal).select(operation.id, kind, observationIndex);
    const selected = (await fresh(journal).read()).pending;
    assert.equal(selected[field], valid);
    assert.equal(selected.selectionCount, 1);
    assert.equal(selected.resolution, null);
    assert.deepEqual(selected.observations, originals);
    assert.deepEqual((await journal.read()).events.at(-1), {
      schema: SCHEMA, type: 'selected', operationId: operation.id, kind, observationIndex,
    });
    await assert.rejects(ledger.observe(operation.id, kind, valid), /already recorded/);
    await assert.rejects(ledger.select(operation.id, kind, observationIndex), /already selected/);
    if (kind === 'admission') await ledger.observe(operation.id, 'settlement', SETTLEMENT);
    await ledger.complete(operation.id, kind === 'not-admitted' ?
      { kind: 'not-admitted', receiptId: 'not-admitted:first' } : { kind: 'settled', receiptId: 'settlement:first' });
    await assert.rejects(ledger.select(operation.id, kind, observationIndex + 1), /terminal/);
    assert.equal((await fresh(journal).read()).entries[0][field], valid);
  }
});

test('selection refuses missing observations invalid indexes kind substitution and malformed replay', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await assert.rejects(ledger.select(operation.id, 'admission', 0), /intent required/);
  await ledger.claim(operation, request);
  await assert.rejects(ledger.select(operation.id, 'admission', 0), /observation absent/);
  await ledger.observe(operation.id, 'admission', ADMISSION);
  const before = await journal.read();
  for (const index of [-1, 0.5, 1, 32, '0', null]) {
    await assert.rejects(ledger.select(operation.id, 'admission', index), /invalid integer|observation absent/);
  }
  await assert.rejects(ledger.select(operation.id, 'unknown-kind', 0), /unknown dispatch selection kind/);
  await assert.rejects(ledger.select(operation.id, 'settlement', 0), /kind mismatch/);
  await assert.rejects(ledger.select(operation.id, 'admission', 0), /already selected/);
  assert.deepEqual(await journal.read(), before);
  const selection = { schema: SCHEMA, type: 'selected', operationId: operation.id, kind: 'admission', observationIndex: 0 };
  for (const event of [selection, { ...selection, observationIndex: 1 },
    { ...selection, kind: 'settlement' }, { ...selection, serializedEnvelope: 'replacement bytes' }]) {
    const invalid = new MemoryJournal();
    for (const original of before.events) await appendRaw(invalid, original);
    await appendRaw(invalid, event);
    await assert.rejects(fresh(invalid).read(), /LEARNING_V2_REJECTED:/);
  }
});

test('selection transitions are capped at 32 on both writes and replay', async () => {
  const { ledger, journal } = await initialized();
  const { operation, request } = fixture();
  await ledger.claim(operation, request);
  await ledger.observe(operation.id, 'admission', ADMISSION);
  await ledger.observe(operation.id, 'admission', ADMISSION + '\n');
  for (let index = 0; index < 32; index++) await ledger.select(operation.id, 'admission', index % 2);
  const pending = (await fresh(journal).read()).pending;
  assert.equal(pending.selectionCount, 32);
  assert.equal(pending.observations.length, 2);
  assert.equal(pending.resolution, null);
  const before = await journal.read();
  await assert.rejects(ledger.select(operation.id, 'admission', 0), /selection limit reached/);
  assert.deepEqual(await journal.read(), before);
  await appendRaw(journal, { schema: SCHEMA, type: 'selected', operationId: operation.id,
    kind: 'admission', observationIndex: 0 });
  await assert.rejects(fresh(journal).read(), /selection limit reached/);
});
