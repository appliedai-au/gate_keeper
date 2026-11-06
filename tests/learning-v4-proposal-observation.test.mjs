import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, linkSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import * as fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonical, copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { openLearningHost } from '../scripts/learning-v2/host.mjs';
import { createProductionDriver } from '../scripts/learning-v2/production-driver.mjs';
import { createDetachedAuthority } from '../scripts/learning-v2/authority-core.mjs';
import { AuthorityLedger } from '../scripts/learning-v2/authority-ledger.mjs';
import { readPrivatePublishedJson } from '../scripts/learning-v2/private-publication.mjs';
import { createOriginalProposalPacket, initializeProposalObservation, readProposalObservation,
  consumeProposalObservation, observationPrefixHead } from '../scripts/learning-v2/proposal-observation.mjs';
import { verifyProposalObservationStatus, verifyProposalObservationPreparation } from '../scripts/learning-v2/proposal-observation-proof.mjs';
import { originalFourthFixture, D, B } from './helpers/proposal-observation-fixture.mjs';

const original = value => JSON.parse(JSON.stringify(value));
const denied = async () => { throw new Error('TEST-ONLY forbidden remote or SDK capability touched'); };
const snapshotJournal = snapshot => ({ read: async () => copy(snapshot), append: denied });
async function cloneJournal(source) {
  const next = new MemoryJournal(); let head = null;
  for (const event of (await source.read()).events) head = (await next.append(head, event)).head;
  return next;
}
async function memoryOptions(f) {
  return { ...f.options, controllerJournal: await cloneJournal(f.options.controllerJournal),
    dispatchJournal: await cloneJournal(f.options.dispatchJournal), originalJournal: await cloneJournal(f.options.originalJournal),
    observationJournal: new MemoryJournal() };
}
function loseAcknowledgement(journal) {
  return { read: () => journal.read(), append: async (head, event) => {
    await journal.append(head, event); throw new Error('TEST-ONLY durable append acknowledgement lost');
  } };
}
function rehash(events) {
  let head = null;
  for (let i = 0; i < events.length; i++) head = digest({ schema: 'gk-learning-v2-journal-record-v1',
    sequence: i + 1, previousHead: head, event: events[i] });
  return { head, events };
}

test('D consumes authentic later invalid output with zero remote/model calls and preserves original A/B history', async t => {
  const f = await originalFourthFixture(t);
  const before = await f.host().inspect();
  assert.equal(before.state.attempts[3].status, 'reserved'); assert.equal(before.state.operations[4].consumed, false);
  assert.equal((await f.authority().initialize()).attempts[3].status, 'invalid');
  const implementation = { binding: f.bundle.binding, sourceCommit: D, status: f.options.status };
  const host = await openLearningHost({ ...f.hostOptions, implementation,
    client: { sessions: { create: denied, createTurn: denied, getTurn: denied, listTurnEvents: denied } },
    gateway: { admit: denied, settle: denied }, authorities: {
      evaluation: { ...f.trust.evaluation, issue: denied }, novelty: { ...f.trust.novelty, issue: denied } } });
  const driver = createProductionDriver({ host, remote: new Proxy({}, { get: () => denied }), bundle: f.bundle, implementation });
  const result = await driver.consumeProposalObservation();
  assert.equal(result.status, 'recovered'); assert.equal(result.additionalModelCalls, 0); assert.equal(result.attemptNumber, 4);
  const after = await host.inspect();
  assert.deepEqual(after.state.attempts.map(item => item.status), ['invalid', 'invalid', 'invalid', 'invalid']);
  assert.equal(after.state.operations.length, 5); assert.equal(after.dispatch.pending, null);
  assert.equal(after.state.operations[4].leaseId, f.operation.leaseId);
  assert.equal(after.state.operations[4].settlementReceiptId, f.originalSettlement.body.receiptId);
  assert.equal(after.state.operations[4].actualCalls, 1); assert.equal(after.state.operations[4].actualMicros, null);
  assert.equal(after.state.operations[4].evidenceComplete, false);
  assert.equal(after.state.operations[4].reconciliationOnly, undefined);
  assert.equal(after.observation.complete, true);
  assert.equal(after.implementation.actualPlatformCommit, D); assert.equal(after.implementation.historicalImplementationCommit, B);
  const archived = await host.inspectOperation(f.operation.id);
  assert.equal(archived.archive.calls[0].stages.map(item => item.stage).join(','), 'session,turn,failure');
  assert.equal(archived.archive.artifacts.length, 0);
  const stable = canonical(await f.options.observationJournal.read());
  await driver.consumeProposalObservation();
  assert.equal(canonical(await f.options.observationJournal.read()), stable);
  await f.assertNoNewCalls();
  assert.equal((await f.reader()).counts.invalid, 4);
  // A new process still reads the original BASE using B and the fourth via D.
  await f.reopenD(); assert.equal((await f.host().inspect()).observation.complete, true);
  const exportStatus = await f.authority().operatorStatus();
  assert.equal(exportStatus.implementation.qualificationReceiptId, f.options.status.qualificationEnvelope.body.receiptId);
  assert.equal(exportStatus.implementation.historicalQualificationReceiptId, f.historicalStatus.qualificationEnvelope.body.receiptId);
});

test('each exact acknowledged-write-loss prefix resumes only missing local metadata and status never falls back', async t => {
  const f = await originalFourthFixture(t);
  await initializeProposalObservation(f.options, f.checkpoint);
  assert.equal((await f.reader()).counts.invalid, 3);
  await f.reopenD(); // Atomic opener before dispatch link is a checked held prefix.
  const prefixes = ['0:1', '0:2', '1:2', '2:2', '2:3', '2:3'];
  for (let i = 0; i < prefixes.length; i++) {
    const interrupted = { ...f.options, controllerJournal: loseAcknowledgement(f.options.controllerJournal),
      dispatchJournal: loseAcknowledgement(f.options.dispatchJournal), observationJournal: loseAcknowledgement(f.options.observationJournal) };
    await assert.rejects(consumeProposalObservation(interrupted), /acknowledgement lost/);
    const checked = await readProposalObservation(f.options);
    assert.equal(checked.prefix, prefixes[i]); assert.equal(checked.complete, i === 5);
    await f.reopenD(); // Reopen validates the complete exact suffix at every step.
    if (i === 3 || i === 4) await assert.rejects(f.reader(), /complete later-observation custody/);
    else {
      const status = await f.reader();
      assert.equal(status.counts.invalid, i >= 2 ? 4 : 3);
      assert.equal(status.dispatch.pending !== null, i < 5);
    }
    await f.assertNoNewCalls();
  }
  const final = await consumeProposalObservation(f.options); assert.equal(final.additionalModelCalls, 0);
  renameSync(f.observationPath, f.observationPath + '-TEST-ONLY-removed');
  await assert.rejects(f.reopenD(), /sidecar missing/);
  await assert.rejects(f.reader(), /custody is missing/);
});

test('D qualification/owner/remainder scopes are separate and consuming four never starts five', async t => {
  const f = await originalFourthFixture(t, { authorize: false });
  await assert.rejects(f.host().consumeProposalObservation(), /owner authorization/);
  await assert.rejects(f.host().requireProposalObservationComplete(), /owner authorization/);
  await assert.rejects(f.authority().admit({ operation: {}, request: {} }), /owner authorization|remaining experiment/);
  await f.assertNoNewCalls();
  const g = await originalFourthFixture(t, { allowRemainingExperiment: false });
  await g.host().consumeProposalObservation();
  await assert.rejects(g.host().requireProposalObservationComplete(), /remaining experiment/);
  await assert.rejects(g.authority().fitFeedback({ attemptId: g.bundle.config.experimentId + ':attempt:5' }), /remaining experiment/);
  await g.assertNoNewCalls();
});

test('explicit authorized D remainder retains both links and a later consume invocation holds', async t => {
  const f = await originalFourthFixture(t);
  await assert.rejects(f.host().requireProposalObservationComplete(), /complete original fourth/);
  await f.host().consumeProposalObservation();
  await f.host().requireProposalObservationComplete();
  const fifth = f.bundle.config.experimentId + ':attempt:5';
  await f.host().beginAttempt(await f.authority().fitFeedback({ attemptId: fifth }));
  await f.host().dispatch('proposal', fifth);
  assert.equal(f.controls.turns, 19); assert.equal(f.controls.dispatches, 19);
  await f.reopenD(); assert.equal((await f.host().inspect()).state.attempts.length, 5);
  await assert.rejects(f.host().consumeProposalObservation(), /after any later proposal/);
  assert.equal(f.controls.turns, 19); assert.equal(f.controls.dispatches, 19);
  assert.equal(canonical(await f.options.originalJournal.read()), f.immutableOriginalFourth);
  await assert.rejects(openLearningHost({ ...f.hostOptions, implementation: {
    binding: f.bundle.binding, sourceCommit: B, status: f.historicalStatus } }), /historical B cannot reopen D/);
});

test('D exact prefix and evidence negatives refuse before appending', async t => {
  const f = await originalFourthFixture(t);
  await t.test('lost acknowledgement of the atomic opener resumes with exactly one opener', async () => {
    const options = await memoryOptions(f);
    const beforeController = canonical(await options.controllerJournal.read()), beforeDispatch = canonical(await options.dispatchJournal.read());
    await assert.rejects(initializeProposalObservation({ ...options,
      observationJournal: loseAcknowledgement(options.observationJournal) }, f.checkpoint), /acknowledgement lost/);
    assert.equal((await options.observationJournal.read()).events.length, 1);
    assert.equal(canonical(await options.controllerJournal.read()), beforeController);
    assert.equal(canonical(await options.dispatchJournal.read()), beforeDispatch);
    const reopened = await initializeProposalObservation(options, f.checkpoint);
    assert.equal(reopened.prefix, '0:0'); assert.equal((await options.observationJournal.read()).events.length, 1);
    await consumeProposalObservation(options);
    assert.equal((await options.observationJournal.read()).events.filter(item => item.type === 'authorized-observation').length, 1);
    await f.assertNoNewCalls();
  });
  await t.test('captured snapshot projections must match before preparation or signing', async () => {
    const c = await f.options.controllerJournal.read(), d = await f.options.dispatchJournal.read(), o = await f.options.originalJournal.read();
    const packet = copy(f.checkpoint); packet.dispatch.pending.request.model = 'TEST-ONLY-changed';
    await assert.rejects(createOriginalProposalPacket({ state: packet.state, dispatch: packet.dispatch,
      archive: packet.archive, controllerSnapshot: c, dispatchSnapshot: d, originalSnapshot: o,
      binding: f.bundle.binding, runtime: f.bundle.runtime }), /dispatch differs/);
    const badArchive = copy(f.checkpoint.archive); badArchive.calls[0].stages[2].payload.code = 'TEST-ONLY-other';
    await assert.rejects(createOriginalProposalPacket({ state: packet.state, dispatch: f.checkpoint.dispatch,
      archive: badArchive, controllerSnapshot: c, dispatchSnapshot: d, originalSnapshot: o,
      binding: f.bundle.binding, runtime: f.bundle.runtime }), /archive differs/);
    const sidecar = new MemoryJournal();
    await assert.rejects(initializeProposalObservation({ ...f.options, observationJournal: sidecar }, packet));
    assert.equal((await sidecar.read()).events.length, 0);
  });
  await t.test('wrong actual image and forged signature cannot create a sidecar', async () => {
    for (const change of ['actual', 'signature']) {
      const options = await memoryOptions(f);
      if (change === 'actual') options.implementationCommit = B;
      else { options.status = original(options.status); options.status.authorizationEnvelope.signature = 'AA=='; }
      await assert.rejects(initializeProposalObservation(options, f.checkpoint));
      assert.equal((await options.observationJournal.read()).events.length, 0);
    }
  });
  await t.test('extra/ambiguous authority intent and invalid observed output cannot be prepared', async () => {
    const before = canonical(await f.proofJournal.read());
    const altered = copy(f.checkpoint); altered.archive.calls[0].call.message += 'TEST-ONLY substitution';
    await assert.rejects(f.authority().prepareProposalObservation({ checkpoint: altered }));
    assert.equal(canonical(await f.proofJournal.read()), before);
    const options = await memoryOptions(f); options.status = original(options.status);
    options.status.preparationEnvelope.body.observed.complete = false;
    options.status.preparationEnvelope = f.keys.evaluation.issue(options.status.preparationEnvelope.body);
    assert.throws(() => verifyProposalObservationPreparation(options.status.preparationEnvelope, {
      binding: f.bundle.binding, trust: f.trust, implementationCommit: D,
      historicalImplementationStatus: f.historicalStatus, qualificationEnvelope: options.status.qualificationEnvelope,
    }), /complete original invalid result/);
    await assert.rejects(initializeProposalObservation(options, f.checkpoint));
    assert.equal((await options.observationJournal.read()).events.length, 0);
    for (const mutate of [
      state => { state.activeCallId = state.operations[4].calls[0].callId; },
      state => { state.operations[4].calls[0].relay.status = 'claimed'; },
      state => { state.operations[4].calls.push(copy(state.operations[4].calls[0])); },
      state => { state.reviews.push({ id: 'TEST-ONLY-unresolved-review', envelope: null }); },
      state => { state.attempts.push({ id: 'TEST-ONLY-fifth', number: 5, status: 'reserved' }); },
    ]) {
      const alteredAuthority = await cloneJournal(f.journal), separate = new MemoryJournal();
      const ledger = new AuthorityLedger({ journal: alteredAuthority, binding: f.bundle.binding, initial: null,
        clock: () => f.controls.now });
      await ledger.change('TEST-ONLY-conflicting-custody', mutate);
      await assert.rejects(createDetachedAuthority({ ...f.dSettings, journal: alteredAuthority,
        proposalObservation: { ...f.dSettings.proposalObservation, readOnlyJournal: alteredAuthority,
          journalFactory: () => separate } }));
      assert.equal((await separate.read()).events.length, 0, 'bad original authority prefix cannot initialize D proof custody');
    }
  });
  await t.test('changed original archive, wrong link and out-of-order controller suffix all hold', async () => {
    const options = await memoryOptions(f); await initializeProposalObservation(options, f.checkpoint);
    const before = canonical(await options.observationJournal.read());
    const old = await options.originalJournal.read(), alteredEvents = copy(old.events);
    alteredEvents.at(-1).payload.raw.outcome = 'TEST-ONLY-forged';
    await assert.rejects(readProposalObservation({ ...options, originalJournal: snapshotJournal(rehash(alteredEvents)) }), /immutable journal prefix/);
    const s = await options.observationJournal.read(), badOpener = copy(s.events);
    badOpener[0].authorizationSerialized += ' ';
    await assert.rejects(readProposalObservation({ ...options, observationJournal: snapshotJournal(rehash(badOpener)) }), /proof bytes/);
    const c = await options.controllerJournal.read();
    await options.controllerJournal.append(c.head, { ...copy(c.events.at(-1)), reason: 'proposal-recorded' });
    await assert.rejects(consumeProposalObservation(options), /controller state|cross-journal order|transition/);
    assert.equal(canonical(await options.observationJournal.read()), before);
  });
  await t.test('an unknown sidecar event or missing completion link cannot become ordinary work', async () => {
    const options = await memoryOptions(f); await initializeProposalObservation(options, f.checkpoint);
    const s = await options.observationJournal.read();
    await options.observationJournal.append(s.head, { schema: 'TEST-ONLY', type: 'unexpected' });
    const before = canonical(await options.observationJournal.read());
    await assert.rejects(consumeProposalObservation(options));
    assert.equal(canonical(await options.observationJournal.read()), before);
  });
  await t.test('altered or deleted exact dispatch link refuses before any append', async () => {
    const options = await memoryOptions(f); await initializeProposalObservation(options, f.checkpoint);
    await consumeProposalObservation(options);
    const snapshot = await options.dispatchJournal.read(), offset = f.checkpoint.dispatchCount;
    for (const remove of [false, true]) {
      const events = copy(snapshot.events);
      if (remove) events.splice(offset, 1);
      else events[offset].link.authorizationDigest = '9'.repeat(64);
      const altered = rehash(events); let writes = 0;
      const wrongJournal = { read: async () => copy(altered), append: async () => { writes++; throw new Error('must not append'); } };
      const before = canonical(await options.observationJournal.read());
      await assert.rejects(consumeProposalObservation({ ...options, dispatchJournal: wrongJournal }), /suffix differs|full cross-journal cut/);
      assert.equal(writes, 0); assert.equal(canonical(await options.observationJournal.read()), before);
    }
  });
  await t.test('original lease may be expired; no new admission is created', async () => {
    const options = await memoryOptions(f); options.clock = () => f.controls.now + 48 * 3600000;
    await initializeProposalObservation(options, f.checkpoint); await consumeProposalObservation(options);
    const checked = await readProposalObservation(options);
    assert.equal(checked.state.operations.length, 5); assert.equal(checked.state.operations[4].leaseId, f.operation.leaseId);
    assert.equal(checked.state.operations[4].actualCalls, 1); assert.equal(checked.retained.additionalCalls, 0);
  });
  await f.assertNoNewCalls();
});

test('strict D publication reads reject unresolved hard links without unlinking or repair', () => {
  const directory = mkdtempSync(join(tmpdir(), 'gk-D-read-only-')); chmodSync(directory, 0o700);
  try {
    const path = join(directory, 'proposal-observation-qualification.json');
    const staged = join(directory, '.gk-publish-proposal-observation-qualification.json-11111111-1111-1111-1111-111111111111');
    writeFileSync(path, JSON.stringify({ fixture: 'TEST-ONLY' }), { mode: 0o600 }); linkSync(path, staged);
    assert.throws(() => readPrivatePublishedJson(path, { directory, uid: process.getuid(), strictReadOnly: true }), /staging links/);
    assert.ok(existsSync(path)); assert.ok(existsSync(staged));
    // The historical non-read-only mode retains its pre-existing controlled
    // staging repair behavior; the new mode does not silently perform it.
    assert.deepEqual(readPrivatePublishedJson(path, { directory, uid: process.getuid() }), { fixture: 'TEST-ONLY' });
    assert.equal(existsSync(staged), false);
    const before = fs.readFileSync(path);
    const racedFs = { ...fs, readFileSync: (...args) => {
      const bytes = fs.readFileSync(...args); linkSync(path, staged); return bytes;
    } };
    assert.throws(() => readPrivatePublishedJson(path, { directory, uid: process.getuid(), strictReadOnly: true, fs: racedFs }),
      /acquired another link/);
    assert.ok(existsSync(staged)); assert.deepEqual(fs.readFileSync(path), before);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test('D source qualification and prepare/owner writes leave the original authority journal and artifacts byte-identical', async t => {
  const f = await originalFourthFixture(t);
  await f.assertNoNewCalls();
  const q = (await f.authority().operatorStatus()).implementation;
  assert.equal(q.actualPlatformCommit, D); assert.equal(q.historicalImplementationCommit, B);
  assert.ok(q.proposalObservation.preparationEnvelope.body.authorityHead);
  const reopened = await createDetachedAuthority(f.dSettings);
  assert.deepEqual(await reopened.implementationStatus(), f.options.status);
  await f.assertNoNewCalls();
  const packet = copy(f.checkpoint); packet.state.attempts.push(copy(packet.state.attempts[3]));
  await assert.rejects(reopened.prepareProposalObservation({ checkpoint: packet }));
  await f.assertNoNewCalls();
});
