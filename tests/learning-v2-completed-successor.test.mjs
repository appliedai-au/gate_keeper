import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { canonical, copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { AuthorityLedger } from '../scripts/learning-v2/authority-ledger.mjs';
import { LearningController } from '../scripts/learning-v2/controller.mjs';
import { FileJournal, MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { openCompletedHistoryReader, readClosedHostSnapshot } from '../scripts/learning-v2/completed-history.mjs';
import { readCompletedAuthorityArchive, verifyAuthorityCapsule } from '../scripts/learning-v2/completed-authority-export.mjs';
import { projectCompletedObservation } from '../scripts/learning-v2/completed-proposal-observation.mjs';
import { completedPilotFixture } from './helpers/completed-pilot-fixture.mjs';
import { E } from './helpers/completed-observation-fixture.mjs';
import { A, B, D } from './helpers/proposal-observation-fixture.mjs';
import { C } from './helpers/completed-source-fixture.mjs';

// Source authored for isolated remote qualification only. One real synthetic
// A/B/E pilot is reused across independent mutations; no live provider is used.
const readonly = snapshot => ({ read: async () => copy(snapshot),
  append: async () => { throw new Error('TEST-ONLY forbidden read-only write'); } });
const capsuleOptions = f => ({ binding: f.bundle.binding, trust: f.trust, config: f.bundle.config, history: f.bundle.history });

function reissueFacts(f, mutate) {
  const capsule = copy(f.capsule), observation = capsule.proposalObservation;
  mutate(observation.qualificationFacts);
  const qualified = JSON.parse(observation.qualification).body;
  qualified.qualificationEvidenceDigest = digest(observation.qualificationFacts);
  const qualification = f.keys.evaluation.issue(qualified);
  const prepared = JSON.parse(observation.preparation).body;
  prepared.qualificationDigest = digest(qualification);
  const preparation = f.keys.evaluation.issue(prepared);
  const authorized = JSON.parse(observation.authorization).body;
  authorized.qualificationDigest = digest(qualification); authorized.preparedProofDigest = digest(preparation);
  observation.qualification = JSON.stringify(qualification); observation.preparation = JSON.stringify(preparation);
  observation.authorization = JSON.stringify(f.keys.evaluation.issue(authorized));
  return capsule;
}

async function reprojectRetained(f, mutate) {
  const originalSnapshot = await f.journal.read(), proofSnapshot = await f.proofJournal.read();
  const state = await new AuthorityLedger({ journal: readonly(proofSnapshot), binding: f.bundle.binding, initial: null }).read();
  mutate(state.qualificationEvidence.evidence);
  const journal = new MemoryJournal(), initial = copy(state);
  initial.preparation = null; initial.checkpoint = null; initial.authorization = null; initial.ownerEvidence = null;
  let index = 0;
  const ledger = new AuthorityLedger({ journal, binding: f.bundle.binding, initial,
    clock: () => Date.parse(proofSnapshot.events[index].recordedAt) });
  await ledger.initialize(); index = 1;
  await ledger.change('original-fourth-observed-without-dispatch', next => {
    next.preparation = state.preparation; next.checkpoint = copy(state.checkpoint);
  });
  index = 2;
  await ledger.change('original-fourth-observation-owner-authorized', next => {
    next.authorization = state.authorization; next.ownerEvidence = copy(state.ownerEvidence);
  });
  const observationSnapshot = await journal.read(), observationState = await ledger.read();
  assert.equal(observationSnapshot.events.length, 3);
  return projectCompletedObservation({ bundle: f.bundle, originalSnapshot, originalState: await f.authorityState(),
    observationSnapshot, observationState, getArtifact: async id => copy(f.artifacts.get(id)), historical: f.historicalStatus });
}

async function restoreJournal(path, repositoryRoot, snapshot) {
  rmSync(path, { recursive: true });
  const journal = new FileJournal({ directory: path, repositoryRoot }); let head = null;
  for (const event of snapshot.events) head = (await journal.append(head, event)).head;
  assert.equal(head, snapshot.head);
}

test('completed history authenticates actual E recovery and its bounded qualified predecessor without relabelling B', async t => {
  const f = await completedPilotFixture(t, { successor: true });
  const beforeCalls = { sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches };
  const beforeOriginal = canonical(await f.journal.read()), beforeProof = canonical(await f.proofJournal.read());
  const facts = f.capsule.proposalObservation.qualificationFacts;

  await t.test('real E signer, preparation, consumption, closure and C reader agree on all source identities', async () => {
    const q = JSON.parse(f.capsule.proposalObservation.qualification);
    assert.equal(facts.schema, 'gk-learning-proposal-observation-qualified-facts-v2');
    assert.equal(q.body.implementationCommit, E); assert.equal(q.body.qualificationEvidenceDigest, digest(facts));
    assert.equal(facts.source.sha, E); assert.equal(facts.base.sha, D); assert.equal(facts.predecessor.base.sha, B);
    assert.equal(facts.predecessor.descriptor.schema, 'gk-learning-proposal-observation-gate-proof-v1');
    assert.deepEqual(facts.predecessor.descriptor, facts.descriptor.sourceProof.previous.sourceProof);
    assert.equal(facts.predecessor.descriptor.gatePolicy, undefined, 'nested original signed facts must not be reshaped');
    const history = await openCompletedHistoryReader({ root: f.hostRoot, repositoryRoot: f.repositoryRoot,
      actualSourceCommit: C, fetcher: f.source.fetcher, clock: () => f.capturedAt + 5000 });
    const result = await history.readStatus();
    assert.equal(result.archive.experimentSourceCommit, A); assert.equal(result.archive.originalExecutionSourceCommit, B);
    assert.equal(result.archive.finalExecutionSourceCommit, E); assert.equal(result.serving.sourceCommit, C);
    assert.deepEqual(result.archive.recovery, { kind: 'original-invalid-proposal-observation', attempt: 4, additionalModelCalls: 0 });
    assert.equal(result.status.counts.attempted, 10); assert.equal(result.status.counts.invalid, 10);
    assert.equal(result.status.counts.activated, 0); assert.equal(result.status.budget.unknownCostCalls, 24);
    assert.equal(result.status.budget.pendingExecutionOperations, 0); assert.equal(result.status.budget.complete, false);
    assert.equal(JSON.parse(f.capsule.operations[4].settlement).body.actualCalls, 1);
    assert.equal(JSON.parse(f.capsule.operations[4].settlement).body.actualMicros, null);
    assert.equal(canonical((await f.host().inspectOperation(f.operation.id)).archive), canonical(f.originalFourth));
  });

  await t.test('one read window reuses frozen verified snapshots and rereads every actual journal on every request', async child => {
    const actualRead = FileJournal.prototype.read, reads = new Map();
    child.mock.method(FileJournal.prototype, 'read', async function () {
      const snapshot = await actualRead.call(this);
      reads.set(snapshot.head, (reads.get(snapshot.head) || 0) + 1);
      return snapshot;
    });
    const read = () => readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot,
      capsule: f.capsule, closurePresent: true });
    const first = await read();
    assert.equal(reads.size, f.final.state.operations.length + 4,
      'all original operation journals, controller, dispatch, BASE continuation and recovery sidecar are read');
    assert.ok([...reads.values()].every(count => count === 2),
      'each complete on-disk chain is verified once initially and again after every semantic check');
    const controller = first.observation.snapshots.controller;
    assert.equal(Object.isFrozen(controller), true); assert.equal(Object.isFrozen(controller.events), true);
    assert.equal(Object.isFrozen(controller.events.at(-1).state.attempts[0]), true);
    assert.throws(() => { controller.events.at(-1).state.attempts[0].status = 'TEST-ONLY mutation'; }, TypeError);
    const second = await read();
    assert.notEqual(second.observation.snapshots.controller, controller);
    assert.deepEqual(second.capture, first.capture);
    assert.ok([...reads.values()].every(count => count === 4),
      'a later request repeats both real disk validations and cannot reuse the earlier request snapshot');
  });

  await t.test('the final on-disk reread rejects a valid append after the initial complete inventory', async child => {
    const directory = join(f.directory, 'controller');
    const writer = new FileJournal({ directory, repositoryRoot: f.repositoryRoot });
    const actualRead = FileJournal.prototype.read, before = await writer.read();
    const state = await new LearningController({ journal: readonly(before), trust: f.trust }).state();
    let appends = 0;
    child.mock.method(FileJournal.prototype, 'read', async function () {
      const snapshot = await actualRead.call(this);
      // The first original BASE archive is opened after the full initial byte
      // inventory, while the earlier controller snapshot is already frozen.
      if (appends === 0 && snapshot.head === f.snapshot.capture.operations[0].head) {
        appends++;
        await writer.append(before.head, { ...copy(before.events.at(-1)), reason: 'TEST-ONLY concurrent no-op append' });
      }
      return snapshot;
    });
    try {
      await assert.rejects(readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot,
        capsule: f.capsule, closurePresent: true }), /controller advanced during closed read/);
      assert.equal(appends, 1);
      const after = await actualRead.call(writer);
      assert.notEqual(after.head, before.head); assert.equal(after.events.length, before.events.length + 1);
      assert.deepEqual(await new LearningController({ journal: readonly(after), trust: f.trust }).state(), state,
        'the later snapshot has a valid complete hash chain and unchanged valid controller state');
    } finally { await restoreJournal(directory, f.repositoryRoot, before); }
  });

  const invalidFacts = [
    ['missing predecessor', value => { delete value.predecessor; }, /unexpected or missing fields/],
    ['recursive predecessor', value => {
      value.descriptor.sourceProof.previous.sourceProof.schema = 'gk-learning-proposal-observation-gate-proof-v2';
      value.predecessor.descriptor.schema = 'gk-learning-proposal-observation-gate-proof-v2';
    }, /exactly one v1 predecessor/],
    ['extra nested predecessor', value => {
      value.predecessor.descriptor.previous = copy(value.descriptor.sourceProof.previous);
      value.descriptor.sourceProof.previous.sourceProof = copy(value.predecessor.descriptor);
    }, /unexpected or missing fields/],
    ['changed historical B anchor', value => {
      value.predecessor.base.sha = '5'.repeat(40); value.predecessor.qualificationReceipt.baseCommit = '5'.repeat(40);
      value.predecessor.source.parents[0] = '5'.repeat(40); value.base.parents[0] = '5'.repeat(40);
    }, /historical B anchor/],
    ['reversed predecessor merge', value => { value.predecessor.source.parents.reverse(); value.base.parents.reverse(); }, /ordered merge parents/],
    ['different predecessor tree', value => { value.base.tree = '5'.repeat(40); }, /exact qualified predecessor/],
    ['different tested predecessor tree', value => { value.predecessor.qualified.tree = '5'.repeat(40); }, /tested tree/],
    ['different original owner', value => {
      value.predecessor.descriptor.qualification.authorId++;
      value.descriptor.sourceProof.previous.sourceProof.qualification.authorId++;
    }, /original B owner/],
    ['weaker predecessor recipe', value => {
      value.descriptor.sourceProof.previous.gatePolicy.presetDigest = '0'.repeat(64);
      value.predecessor.qualificationReceipt.gatePolicy.presetDigest = '0'.repeat(64);
    }, /frozen full Learning recipe/],
    ['reused qualification run', value => {
      value.predecessor.qualificationReceipt.deployment.deploymentId = value.qualificationReceipt.deployment.deploymentId;
    }, /reuses a predecessor source or qualification/],
    ['reused qualification PR', value => { value.predecessor.qualificationReceipt.pullRequest = value.qualificationReceipt.pullRequest; }, /reuses/],
    ['skipped predecessor test', value => { value.predecessor.qualificationReceipt.checks.node.skipped = 1; }, /full gate incomplete/],
    ['missing predecessor cleanup', value => { value.predecessor.qualificationReceipt.cleanup.complete = false; }, /cleanup incomplete/],
    ['predecessor cleanup before execution', value => {
      value.predecessor.qualificationReceipt.cleanup.observedAt = '2026-01-01T00:00:00Z';
    }, /cleanup precedes completion/],
    ['current predecessor changes request', value => {
      value.predecessor.qualificationReceipt.review.nativeReviews.push({ id: 999,
        commitId: value.predecessor.qualificationReceipt.qualifiedCommit, state: 'CHANGES_REQUESTED' });
    }, /qualified native review changed/],
    ['stripped successor presented as v1', value => {
      value.schema = 'gk-learning-proposal-observation-qualified-facts-v1'; delete value.predecessor;
      value.descriptor.sourceProof.schema = 'gk-learning-proposal-observation-gate-proof-v1'; delete value.descriptor.sourceProof.previous;
    }, /historical B anchor/],
  ];
  for (const [name, mutate, expected] of invalidFacts) await t.test('authentic re-signed facts still refuse ' + name, () => {
    assert.throws(() => verifyAuthorityCapsule(reissueFacts(f, mutate), capsuleOptions(f)), expected);
  });

  await t.test('a stale or relabelled predecessor cannot pass retained source projection', async () => {
    await assert.rejects(reprojectRetained(f, raw => {
      raw.predecessor.ownerComment.created_at = new Date(Date.parse(raw.ownerComment.created_at) + 1).toISOString();
    }), /predecessor qualification chronology/);
    await assert.rejects(reprojectRetained(f, raw => { raw.predecessor.observedMain = D; }), /observed main differs/);
    await assert.rejects(reprojectRetained(f, raw => { raw.predecessor.ownerComment.body += '\n'; }), /exact artifact changed/);
    assert.deepEqual(await reprojectRetained(f, () => {}), f.capsule.proposalObservation);
  });

  for (const [directoryName, expected] of [['ledger', /authority journal advanced during export/],
    ['proposal-observation', /D authority proof journal advanced during export/]]) {
    await t.test('actual export detects a valid later ' + directoryName + ' snapshot during source verification', async () => {
      const directory = join(f.authorityRoot, directoryName);
      const journal = new FileJournal({ directory, repositoryRoot: f.repositoryRoot });
      const before = await journal.read();
      const state = await new AuthorityLedger({ journal: readonly(before), binding: f.bundle.binding, initial: null }).read();
      let appends = 0;
      const fetcher = async (url, options) => {
        if (appends === 0) {
          appends++;
          const last = before.events.at(-1);
          await journal.append(before.head, { schema: last.schema, binding: copy(last.binding),
            kind: 'TEST-ONLY concurrent no-op append', recordedAt: last.recordedAt,
            previousDigest: digest(state), stateDigest: digest(state), changes: [] });
        }
        return f.source.fetcher(url, options);
      };
      try {
        await assert.rejects(readCompletedAuthorityArchive({ directory: f.authorityRoot, repositoryRoot: f.repositoryRoot,
          sourceDescriptor: f.source.descriptor, actualSourceCommit: C, fetcher, clock: () => f.capturedAt }), expected);
        assert.equal(appends, 1, 'the concurrent test append occurs exactly once after the original projection');
        const after = await journal.read();
        assert.notEqual(after.head, before.head); assert.equal(after.events.length, before.events.length + 1);
        assert.deepEqual(await new AuthorityLedger({ journal: readonly(after), binding: f.bundle.binding, initial: null }).read(), state,
          'both snapshots have valid complete chains and the same valid authority state');
      } finally { await restoreJournal(directory, f.repositoryRoot, before); }
    });
  }
  assert.equal(canonical(await f.journal.read()), beforeOriginal); assert.equal(canonical(await f.proofJournal.read()), beforeProof);
  assert.deepEqual({ sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches }, beforeCalls);
  await f.assertOriginal();
});
