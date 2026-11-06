import test from 'node:test';
import assert from 'node:assert/strict';
import { canonical, copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { observationPrefixHead } from '../scripts/learning-v2/proposal-observation.mjs';
import { COMPLETED_RECOVERY_SUMMARY, projectCompletedRecovery, verifyCompletedRecoverySummary,
  readCompletedRecoveryAuthority } from '../scripts/learning-v2/completed-recovery.mjs';
import { originalFourthFixture, D, B } from './helpers/proposal-observation-fixture.mjs';

const clone = value => JSON.parse(JSON.stringify(value));
async function copyJournal(source) {
  const next = new MemoryJournal(); let head = null;
  for (const event of (await source.read()).events) head = (await next.append(head, event)).head;
  return next;
}
const inputs = f => ({ bundle: f.bundle, originalJournal: f.journal, proofJournal: f.proofJournal, implementationCommit: D });
const privateOptions = f => ({ binding: f.bundle.binding, trust: f.trust, implementationCommit: D });

test('positive authenticated read and non-disclosing projection leave journals and calls unchanged', async t => {
  const f = await originalFourthFixture(t);
  const originalBefore = canonical(await f.journal.read()), proofBefore = canonical(await f.proofJournal.read());
  const proof = await readCompletedRecoveryAuthority(inputs(f));
  const summary = proof.summary;
  assert.equal(summary.schema, COMPLETED_RECOVERY_SUMMARY);
  assert.equal(summary.historicalImplementationCommit, B); assert.equal(summary.recoveryImplementationCommit, D);
  assert.equal(summary.preparationDigest, digest(f.preparation));
  assert.equal(summary.retainedDigest, digest(f.preparation.body.retained));
  assert.equal(summary.settlementDigest, digest(f.preparation.body.settlementSerialized));
  assert.equal(JSON.stringify(summary.qualificationEnvelope), JSON.stringify(f.options.status.qualificationEnvelope));
  assert.equal(JSON.stringify(summary.authorizationEnvelope), JSON.stringify(f.options.status.authorizationEnvelope));
  const head = (await f.proofJournal.read());
  assert.equal(proof.observation.head, head.head); assert.equal(proof.observation.count, head.events.length);
  assert.equal(proof.original.head, (await f.journal.read()).head);
  assert.equal(proof.original.preparedPrefix.head, f.preparation.body.authorityHead);
  assert.equal(canonical(await f.journal.read()), originalBefore); assert.equal(canonical(await f.proofJournal.read()), proofBefore);
  const text = JSON.stringify(proof);
  assert.equal(text.includes(f.preparation.body.observed.text), false);
  assert.equal(text.includes(f.preparation.body.observed.sessionId), false);
  assert.equal(text.includes('PRIVATE KEY'), false);
  assert.doesNotThrow(() => verifyCompletedRecoverySummary(summary, f.options.status, privateOptions(f)));
  await f.assertNoNewCalls();
});

test('projection and matching verifier reject tampered envelopes, summaries and digests', async t => {
  const f = await originalFourthFixture(t), options = privateOptions(f);
  const summary = projectCompletedRecovery(f.options.status, options);
  for (const mutate of [s => { s.preparationDigest = 'f'.repeat(64); }, s => { s.retainedDigest = 'f'.repeat(64); },
    s => { s.settlementDigest = 'f'.repeat(64); }, s => { s.recoveryImplementationCommit = 'f'.repeat(40); },
    s => { s.historicalImplementationCommit = 'f'.repeat(40); }, s => { s.extra = true; },
    s => { s.authorizationEnvelope.body.allowRemainingExperiment = false; },
    s => { s.qualificationEnvelope.body.runId = 'tampered'; }, s => { s.schema = 'other'; }]) {
    const bad = clone(summary); mutate(bad);
    assert.throws(() => verifyCompletedRecoverySummary(bad, f.options.status, options));
  }
  const status = clone(f.options.status); status.authorizationEnvelope.signature = 'AAAA' + status.authorizationEnvelope.signature.slice(4);
  assert.throws(() => projectCompletedRecovery(status, options));
  const reordered = clone(summary); reordered.qualificationEnvelope = { signature: summary.qualificationEnvelope.signature,
    body: summary.qualificationEnvelope.body };
  assert.throws(() => verifyCompletedRecoverySummary(reordered, f.options.status, options));
});

test('missing preparation or authorization and wrong B or E are refused', async t => {
  const f = await originalFourthFixture(t), options = privateOptions(f);
  for (const key of ['preparationEnvelope', 'authorizationEnvelope']) {
    const status = clone(f.options.status); status[key] = null;
    assert.throws(() => projectCompletedRecovery(status, options));
  }
  assert.throws(() => projectCompletedRecovery(f.options.status, { ...options, implementationCommit: 'e'.repeat(40) }));
  assert.throws(() => projectCompletedRecovery(f.options.status, { ...options, implementationCommit: B }));
  const g = await originalFourthFixture(t, { allowRemainingExperiment: false });
  assert.throws(() => projectCompletedRecovery(g.options.status, privateOptions(g)), /remaining experiment/);
  const unauthorized = await originalFourthFixture(t, { authorize: false });
  await assert.rejects(readCompletedRecoveryAuthority(inputs(unauthorized)));
});

test('ordinary later original attempts are allowed but a mismatched prefix or operation is refused', async t => {
  const f = await originalFourthFixture(t);
  const original = await copyJournal(f.journal), events = (await original.read()).events;
  const baseline = await readCompletedRecoveryAuthority({ ...inputs(f), originalJournal: original });
  assert.equal(baseline.original.count, events.length);
  // Journal rewritten before the prepared cut: the prepared head is no longer a prefix.
  const rewritten = copy({ head: null, events }); rewritten.events[1] = { ...rewritten.events[1], recordedAt: '2026-01-01T00:00:00.000Z' };
  let head = null; const forged = new MemoryJournal();
  for (const event of rewritten.events) head = (await forged.append(head, event)).head;
  await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), originalJournal: forged }));
  // Truncated original journal cannot contain the prepared head.
  const short = new MemoryJournal(); head = null;
  for (const event of events.slice(0, Math.max(1, events.length - 3))) head = (await short.append(head, event)).head;
  await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), originalJournal: short }));
});

test('extra or partial proof state and a shared namespace are refused', async t => {
  const f = await originalFourthFixture(t);
  const partial = await copyJournal(f.proofJournal), snap = await partial.read();
  const trimmed = new MemoryJournal(); let head = null;
  for (const event of snap.events.slice(0, 1)) head = (await trimmed.append(head, event)).head;
  await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), proofJournal: trimmed }));
  await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), proofJournal: f.journal }));
  await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), proofJournal: new MemoryJournal() }));
  await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), implementationCommit: B }));
  const forgedHead = { read: async () => ({ ...copy(snap), head: 'f'.repeat(64) }), append: async () => { throw new Error('write'); } };
  await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), proofJournal: forgedHead }));
  assert.equal(observationPrefixHead(snap), snap.head);
});

test('a journal that changes on reread fails closed and no write is ever attempted', async t => {
  const f = await originalFourthFixture(t);
  for (const which of ['originalJournal', 'proofJournal']) {
    const source = which === 'originalJournal' ? f.journal : f.proofJournal;
    let reads = 0, appends = 0;
    const changing = { read: async () => { reads++; const s = await source.read();
      return reads <= 2 ? s : { head: s.head, events: s.events.slice(0, -1) }; }, append: async () => { appends++; throw new Error('forbidden'); } };
    await assert.rejects(readCompletedRecoveryAuthority({ ...inputs(f), [which]: changing }));
    assert.equal(appends, 0);
  }
  const writes = { read: () => f.proofJournal.read(), append: async () => { throw new Error('write attempted'); } };
  await readCompletedRecoveryAuthority({ ...inputs(f), proofJournal: writes });
  await f.assertNoNewCalls();
});
