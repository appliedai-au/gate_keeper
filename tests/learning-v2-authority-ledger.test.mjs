import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync,
  unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { FileJournal, MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { AuthorityLedger } from '../scripts/learning-v2/authority-ledger.mjs';

// Remote qualification only. These disposable journals are cache-boundary
// fixtures, never production state, execution receipts or pilot evidence.
const binding = { ownerId: 'cache-test-owner', experimentId: 'cache-test',
  sourceCommit: 'a'.repeat(40), configDigest: 'b'.repeat(64) };
const initial = () => ({ schema: 'cache-boundary-test', binding: copy(binding), nested: { count: 0 }, items: [] });
const options = journal => ({ journal, binding, initial: initial(), clock: () => 1_800_000_000_000 });

test('cache hits still read the journal and return detached initialize/read/action values', async () => {
  const journal = new MemoryJournal();
  let reads = 0, rejectRead = false;
  const observed = {
    async read() { reads++; if (rejectRead) throw new Error('TEST integrity failure'); return journal.read(); },
    append: (...args) => journal.append(...args),
  };
  const ledger = new AuthorityLedger(options(observed));
  const created = await ledger.initialize();
  created.nested.count = 900;
  assert.equal((await ledger.read()).nested.count, 0);
  const changed = await ledger.change('fixture-change', state => {
    state.nested.count = 1; state.items.push({ value: 'retained' }); return state.nested;
  });
  changed.count = 901;
  const before = reads, first = await ledger.read();
  first.nested.count = 902; first.items[0].value = 'caller mutation';
  const second = await ledger.read();
  assert.equal(reads, before + 2, 'same-head reads never bypass durable integrity validation');
  assert.deepEqual(second, { ...initial(), nested: { count: 1 }, items: [{ value: 'retained' }] });
  rejectRead = true;
  await assert.rejects(ledger.read(), /integrity failure/);
});

test('failed append does not publish proposed state; lost acknowledgement is resolved by the next actual read', async () => {
  for (const failure of ['before-commit', 'after-commit']) {
    const journal = new MemoryJournal();
    let mode = null;
    const boundary = { read: () => journal.read(), async append(head, event) {
      if (mode === 'before-commit') throw new Error('TEST append failed before commit');
      const result = await journal.append(head, event);
      if (mode === 'after-commit') throw new Error('TEST append acknowledgement lost');
      return result;
    } };
    const ledger = new AuthorityLedger(options(boundary));
    await ledger.initialize(); mode = failure;
    await assert.rejects(ledger.change('fixture-change', state => { state.nested.count = 7; }), /TEST append/);
    mode = null;
    const actual = await ledger.read();
    assert.equal(actual.nested.count, failure === 'before-commit' ? 0 : 7);
    const reopened = new AuthorityLedger(options(boundary));
    assert.deepEqual(await reopened.initialize(), actual);
  }
});

test('a retained callback state cannot mutate cached bytes while durable append acknowledgement is delayed', async () => {
  const journal = new MemoryJournal();
  let hold = false, committed, release;
  const reachedCommit = new Promise(resolve => { committed = resolve; });
  const acknowledgement = new Promise(resolve => { release = resolve; });
  const boundary = { read: () => journal.read(), async append(head, event) {
    const snapshot = await journal.append(head, event);
    if (hold) { committed(); await acknowledgement; }
    return snapshot;
  } };
  const ledger = new AuthorityLedger(options(boundary));
  await ledger.initialize(); hold = true;
  let retained;
  const change = ledger.change('fixture-delayed-acknowledgement', state => {
    state.nested.count = 3; retained = state; return state;
  });
  await reachedCommit;
  retained.nested.count = 999;
  retained.items.push({ value: 'not committed' });
  release();
  await change;
  const actual = { ...initial(), nested: { count: 3 } };
  assert.deepEqual(await ledger.read(), actual);
  assert.deepEqual(await new AuthorityLedger(options(journal)).initialize(), actual);
});

test('append acknowledgement must contain the exact committed event and its actual journal head', async () => {
  for (const defect of ['wrong-head', 'different-event', 'missing-event']) {
    const journal = new MemoryJournal();
    let corrupt = false;
    const boundary = { read: () => journal.read(), async append(head, event) {
      const result = await journal.append(head, event);
      if (corrupt) {
        if (defect === 'wrong-head') result.head = 'f'.repeat(64);
        else if (defect === 'different-event') result.events.at(-1).kind = 'unacknowledged-other-event';
        else result.events.pop();
      }
      return result;
    } };
    const ledger = new AuthorityLedger(options(boundary));
    await ledger.initialize(); corrupt = true;
    await assert.rejects(ledger.change('fixture-change', state => { state.nested.count = 8; }),
      /append acknowledgement mismatch/);
    // The real append committed even though its returned receipt was corrupt.
    // Reopening/replaying actual durable bytes must preserve that real state.
    corrupt = false;
    assert.equal((await ledger.read()).nested.count, 8);
    assert.equal((await new AuthorityLedger(options(boundary)).initialize()).nested.count, 8);
  }
});

test('a changed durable head replays and verifies the full state chain instead of reusing cached state', async () => {
  const journal = new MemoryJournal(), ledger = new AuthorityLedger(options(journal));
  await ledger.initialize();
  const before = await ledger.read(), next = copy(before);
  next.nested.count = 9;
  const snapshot = await journal.read();
  await journal.append(snapshot.head, { schema: 'gk-detached-authority-event-v1', binding,
    kind: 'external-valid-append', recordedAt: '2026-11-05T00:00:00.000Z',
    previousDigest: digest(before), stateDigest: digest(next),
    changes: [{ path: ['nested', 'count'], value: 9 }] });
  assert.equal((await ledger.read()).nested.count, 9);
  assert.deepEqual(await new AuthorityLedger(options(journal)).initialize(), next);
  const current = await journal.read();
  await journal.append(current.head, { schema: 'gk-detached-authority-event-v1', binding,
    kind: 'external-invalid-state-chain', recordedAt: '2026-11-05T00:00:01.000Z',
    previousDigest: digest(next), stateDigest: '0'.repeat(64),
    changes: [{ path: ['nested', 'count'], value: 10 }] });
  await assert.rejects(ledger.read(), /state digest/);
});

test('same cached FileJournal head never hides modified records, a forked record or truncation', async t => {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-authority-cache-integrity-'));
  chmodSync(root, 0o700);
  const repositoryRoot = join(root, 'repository'), directory = join(root, 'journal');
  mkdirSync(repositoryRoot, { mode: 0o700 });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const journal = new FileJournal({ directory, repositoryRoot });
  const ledger = new AuthorityLedger(options(journal));
  await ledger.initialize();
  await ledger.change('fixture-change', state => { state.nested.count = 1; });
  const path = join(directory, '000000000002.json'), original = readFileSync(path);
  for (const defect of ['tamper', 'fork', 'truncate']) {
    if (defect === 'truncate') unlinkSync(path);
    else {
      const record = JSON.parse(original);
      record.event.kind = 'changed-committed-record';
      if (defect === 'fork') {
        const { hash, ...body } = record; record.hash = digest(body);
      }
      writeFileSync(path, JSON.stringify(record) + '\n', { mode: 0o600 });
    }
    await assert.rejects(ledger.read(), /JOURNAL_REJECTED/);
    writeFileSync(path, original, { mode: 0o600 });
    assert.equal((await ledger.read()).nested.count, 1);
  }
});
