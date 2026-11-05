import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { RunBalance } from '../scripts/learning-v2/run-balance.mjs';

function rig() {
  const journal = new MemoryJournal();
  let verified = 0;
  const balance = new RunBalance({
    journal,
    verifyChargeReceipt: async envelope => {
      verified++;
      if (envelope?.trusted !== true) throw new Error('untrusted provider charge');
      return structuredClone(envelope.body);
    },
  });
  const receipt = (id, callId, chargedMicros) => ({
    trusted: true, body: { receiptId: id, runId: 'run-10', callId, chargedMicros },
  });
  return { balance, journal, receipt, get verified() { return verified; } };
}

test('new run exposes zero charges but unknown calls remain unreconciled', async () => {
  const f = rig();
  assert.deepEqual(await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' }), {
    schema: 'gk-run-balance-v1', runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test',
    callCount: 0, settledCalls: 0, unreconciledCalls: 0, chargedMicros: 0, complete: true,
  });
  await f.balance.recordCall('call-1');
  const s = await f.balance.status();
  assert.equal(s.callCount, 1);
  assert.equal(s.unreconciledCalls, 1);
  assert.equal(s.chargedMicros, 0);
  assert.equal(s.complete, false);
  assert.equal(JSON.stringify(s).includes('receipt'), false);
});

test('actual verified charges over former $50 cap remain reportable, not blocked', async () => {
  const f = rig();
  await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' });
  await f.balance.recordCall('call-1');
  const settled = await f.balance.settleCall('call-1', f.receipt('provider-charge-1', 'call-1', 125_000_000));
  assert.equal(settled.chargedMicros, 125_000_000);
  assert.equal(settled.complete, true);
  assert.equal(settled.unreconciledCalls, 0);
});

test('same verified receipt is idempotent, a different one cannot overwrite evidence', async () => {
  const f = rig();
  await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' });
  await f.balance.recordCall('call-1');
  const receipt = f.receipt('receipt-1', 'call-1', 123);
  await f.balance.settleCall('call-1', receipt);
  const head = (await f.journal.read()).head;
  await f.balance.settleCall('call-1', receipt);
  assert.equal((await f.journal.read()).head, head);
  await assert.rejects(() => f.balance.settleCall('call-1', f.receipt('receipt-2', 'call-1', 999)));
  assert.equal((await f.balance.status()).chargedMicros, 123);
});

test('unverified, cross-run and replayed receipts never settle a call', async () => {
  const f = rig();
  await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' });
  await f.balance.recordCall('call-1');
  await f.balance.recordCall('call-2');
  await assert.rejects(() => f.balance.settleCall('call-1', { trusted: false }));
  await assert.rejects(() => f.balance.settleCall('call-1', {
    trusted: true, body: { receiptId: 'r', runId: 'wrong', callId: 'call-1', chargedMicros: 1 },
  }));
  await f.balance.settleCall('call-1', f.receipt('receipt-1', 'call-1', 200));
  await assert.rejects(() => f.balance.settleCall('call-2', f.receipt('receipt-1', 'call-2', 200)));
  assert.deepEqual(await f.balance.status(), {
    schema: 'gk-run-balance-v1', runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test',
    callCount: 2, settledCalls: 1, unreconciledCalls: 1, chargedMicros: 200, complete: false,
  });
});

test('duplicate call cannot be run again and reopens with durable state', async () => {
  const f = rig();
  await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' });
  await f.balance.recordCall('call-1');
  await assert.rejects(() => f.balance.recordCall('call-1'));
  const reopened = new RunBalance({ journal: f.journal, verifyChargeReceipt: async receipt => receipt.body });
  assert.equal((await reopened.status()).unreconciledCalls, 1);
});

test('invalid configuration, unknown settlements and monetary overflow refuse without writes', async () => {
  assert.throws(() => new RunBalance({ journal: new MemoryJournal() }),
    /independent provider receipt/);
  const f = rig();
  await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' });
  await assert.rejects(() => f.balance.settleCall('call-missing', f.receipt('r', 'call-missing', 1)));
  await f.balance.recordCall('call-1');
  await f.balance.recordCall('call-2');
  await f.balance.settleCall('call-1', f.receipt('r1', 'call-1', Number.MAX_SAFE_INTEGER));
  const before = (await f.journal.read()).head;
  await assert.rejects(() => f.balance.settleCall('call-2', f.receipt('r2', 'call-2', 1)),
    /precision exceeded/);
  assert.equal((await f.journal.read()).head, before);
});

test('journal stores bounded deltas instead of quadratic full-state snapshots', async () => {
  const f = rig();
  await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' });
  for (let i = 0; i < 25; i++) {
    const id = 'call-' + i;
    await f.balance.recordCall(id);
    await f.balance.settleCall(id, f.receipt('receipt-' + i, id, i + 1));
  }
  const entries = (await f.journal.read()).events;
  assert.equal(entries.length, 51);
  assert.equal(entries[0].kind, 'opened');
  assert.equal(entries.filter(item => item.kind === 'call').length, 25);
  assert.equal(entries.filter(item => item.kind === 'settled').length, 25);
  assert.ok(entries.every(item => Object.keys(item).length <= 5));
  assert.ok(entries.every(item => JSON.stringify(item).length < 400));
  assert.equal((await f.balance.status()).chargedMicros, 325);
});

test('unexpected delta, duplicate settlement or orphaned event is refused on reopening', async () => {
  const f = rig();
  await f.balance.initialize({ runId: 'run-10', provider: 'truefoundry', model: 'tfy-managed/test' });
  const before = await f.journal.read();
  await f.journal.append(before.head, {
    schema: 'gk-run-balance-v1', kind: 'settled', callId: 'never-recorded',
    receipt: { receiptId: 'r', runId: 'run-10', callId: 'never-recorded', chargedMicros: 1 },
  });
  await assert.rejects(() => f.balance.status(), /unrecorded or repeated settlement event/);
});
