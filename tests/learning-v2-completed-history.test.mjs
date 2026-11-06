import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { AuthorityLedger } from '../scripts/learning-v2/authority-ledger.mjs';
import { FileJournal } from '../scripts/learning-v2/journal.mjs';
import { readClosedHostSnapshot, openCompletedHistoryReader } from '../scripts/learning-v2/completed-history.mjs';
import { verifyAuthorityCapsule, readCompletedAuthorityArchive, projectCompletedAuthority } from '../scripts/learning-v2/completed-authority-export.mjs';
import { bytesSha, decodeHistoryChunks, encodeHistoryChunks } from '../scripts/learning-v2/completed-history-files.mjs';
import { completedPilotFixture } from './helpers/completed-pilot-fixture.mjs';
import { C } from './helpers/completed-source-fixture.mjs';
import { verifyProposalObservationStatus } from '../scripts/learning-v2/proposal-observation-proof.mjs';

// Execute only under the isolated remote exact-source qualification recipe.
const observeBytes = path => readdirSync(path, { recursive: true }).filter(name => name.endsWith('.json')).sort().map(name =>
  [name, bytesSha(readFileSync(join(path, name)))]);
const reader = f => openCompletedHistoryReader({ root: f.hostRoot, repositoryRoot: f.repositoryRoot,
  actualSourceCommit: C, fetcher: f.source.fetcher, clock: () => f.capturedAt + 5000 });

async function replaceSyntheticJournal(path, repositoryRoot, events) {
  rmSync(path, { recursive: true, force: true });
  const journal = new FileJournal({ directory: path, repositoryRoot }); let head = null;
  for (const event of events) head = (await journal.append(head, event)).head;
}

test('completed C reads ten genuine negative results and original expired-lease 1+13 BASE without any learning mutation', async t => {
  const f = await completedPilotFixture(t);
  const beforeHost = observeBytes(f.hostRoot), beforeAuthority = observeBytes(f.authorityRoot);
  const beforeCalls = { sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches };
  assert.equal(f.snapshot.completion.genuineAttempts, 10); assert.equal(f.snapshot.completion.calls, 24);
  assert.equal(f.snapshot.completion.unknownCostOperations, 11);
  assert.ok((await f.authorityState()).operations.filter(item => item.kind === 'proposal').every(item => item.complete === false),
    'genuine invalid proposals need not be successful evaluations');
  const history = await reader(f), first = await history.readStatus(), second = await history.readStatus();
  assert.equal(first.serving.sourceCommit, C); assert.equal(first.archive.experimentSourceCommit, 'a'.repeat(40));
  assert.equal(first.archive.originalExecutionSourceCommit, 'b'.repeat(40)); assert.equal(first.status.counts.attempted, 10);
  assert.equal(first.archive.finalExecutionSourceCommit, 'd'.repeat(40));
  assert.deepEqual(first.archive.recovery, { kind: 'original-invalid-proposal-observation', attempt: 4, additionalModelCalls: 0 });
  assert.equal(first.status.counts.invalid, 10); assert.equal(first.status.baseline.status, 'complete');
  assert.equal(first.status.budget.complete, false); assert.equal(first.status.budget.unknownCostOperations, 11);
  assert.equal(first.status.budget.observedSpentMicros, 0); // Unknown costs stay unknown, not a priced zero.
  assert.equal(first.archive.archivedAt, f.closure.archivedAt); assert.deepEqual(second, first);
  assert.notEqual(first.checkedAt, first.archive.archivedAt);
  assert.deepEqual(observeBytes(f.hostRoot), beforeHost); assert.deepEqual(observeBytes(f.authorityRoot), beforeAuthority);
  assert.deepEqual({ sessions: f.controls.sessions, turns: f.controls.turns, dispatches: f.controls.dispatches }, beforeCalls);
  const exported = canonical(f.capsule);
  for (const forbidden of ['PRIVATE-KEY-CANARY', 'PRIVATE-DRIVER-TOKEN-CANARY', 'PRIVATE-RELAY-PREFIX',
    f.bundle.config.baseInstructions, f.bundle.caseInputs[0].prompt]) assert.equal(exported.includes(forbidden), false);
  assert.ok(f.capsule.operations.every(item => typeof item.lease === 'string' && typeof item.settlement === 'string'));
  await f.assertOriginal();
});

test('exact duplicate proposals count only their one authentic result and preserve negative prior history', async t => {
  const f = await completedPilotFixture(t, { exactDuplicate: true });
  const result = await (await reader(f)).readStatus();
  assert.equal(result.status.counts.invalid, 4); assert.equal(result.status.counts.duplicate, 6); assert.equal(result.status.counts.scored, 0);
  assert.equal(f.snapshot.completion.operations, 11); assert.equal(f.controls.turns, 24);
  assert.equal(f.capsule.reviews.length, 0, 'exact duplicates do not require invented semantic receipts');
  await f.assertOriginal();
});

test('completed history verifies real paired screen, three fresh confirmation pairs, consumed renewal and covered uncertain proposal', async t => {
  const f = await completedPilotFixture(t, { positiveAndUncertain: true });
  const history = await reader(f), result = await history.readStatus();
  assert.equal(f.controls.turns, 123); assert.equal(f.snapshot.completion.calls, 123);
  assert.equal(f.snapshot.completion.operations, 13); assert.equal(result.status.counts.confirmed, 1);
  assert.equal(result.status.counts.unresolved, 1); assert.equal(result.status.counts.invalid, 8);
  assert.equal(result.status.counts.activated, 1); assert.equal(f.capsule.activations.length, 1);
  assert.equal(f.capsule.activations[0].renewals.length, 1);
  assert.equal(result.status.incumbentVersion, f.final.state.versions[1].id);
  assert.deepEqual(f.final.state.attempts[4].confirmation.map(item => item.order), [
    ['incumbent', 'candidate'], ['candidate', 'incumbent'], ['incumbent', 'candidate']]);
  const uncertain = f.final.state.operations.find(item => item.kind === 'proposal' && item.attemptId.endsWith(':6'));
  assert.equal(uncertain.actualCalls, 1); assert.equal(uncertain.evidenceComplete, false);
  const wrong = copy(f.capsule); wrong.activations[0].renewals = [];
  await assert.rejects(readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot,
    capsule: wrong, closurePresent: true }), /activation/);
  const unconsumed = copy(f.capsule); unconsumed.activations.push(copy(unconsumed.activations[0]));
  await assert.rejects(readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot,
    capsule: unconsumed, closurePresent: true }), /activation/);
  await f.assertOriginal(); assert.equal(f.controls.turns, 123);
});

test('authority closure rejects missing/extra attempts, changed call evidence, ambiguous relay, and substituted signed lease', async t => {
  const f = await completedPilotFixture(t);
  const options = { binding: f.bundle.binding, trust: f.trust, config: f.bundle.config, history: f.bundle.history };
  const cases = [
    value => { value.schema = 'gk-completed-authority-capsule-v1'; },
    value => { value.executionSourceCommit = value.originalExecutionSourceCommit; },
    value => value.attempts.pop(),
    value => value.attempts.push(copy(value.attempts[0])),
    value => { value.attempts[9].id = value.attempts[0].id; },
    value => { value.operations[1].calls[0].relay.status = 'claimed'; },
    value => { value.operations[1].calls[0].stage = 'turn-intent'; },
    value => { value.operations[1].calls[0].evidenceDigest = '0'.repeat(64); },
    value => { value.operations[1].settlement = value.operations[2].settlement; },
    value => { value.operations[1].lease = value.operations[2].lease; },
    value => { value.operations[1].calls[0].complete = false; },
    value => { value.operations[1].calls[0].observedModelCalls = 0; },
    value => { value.operations[1].calls = []; },
    value => { value.operations[1].evaluations = copy(value.operations[0].evaluations); },
    value => { value.originalImplementation.authorization = value.originalImplementation.qualification; },
    value => { value.finalExecutionSourceCommit = C; },
  ];
  for (const mutate of cases) { const value = copy(f.capsule); mutate(value); assert.throws(() => verifyAuthorityCapsule(value, options)); }
  assert.equal(f.controls.turns, 24);
});

test('same reader rejects later lock, extra archive, missing mandatory continuation and source-file drift without stale success', async t => {
  const f = await completedPilotFixture(t), history = await reader(f);
  await history.readStatus(); const original = observeBytes(f.hostRoot);
  const lock = join(f.directory, 'controller', '.writer.lock');
  writeFileSync(lock, 'TEST-ONLY lock', { mode: 0o600, flag: 'wx' });
  await assert.rejects(history.readStatus()); unlinkSync(lock);
  const tail = join(f.directory, 'operations', 'unexpected-pending.json');
  writeFileSync(tail, '{}', { mode: 0o600, flag: 'wx' });
  await assert.rejects(history.readStatus()); unlinkSync(tail);
  renameSync(f.continuationPath, f.continuationPath + '-held');
  await assert.rejects(history.readStatus()); renameSync(f.continuationPath + '-held', f.continuationPath);
  const config = join(f.hostRoot, 'implementation-qualification.json'), bytes = readFileSync(config);
  writeFileSync(config, Buffer.concat([bytes, Buffer.from('\n')]));
  await assert.rejects(history.readStatus()); writeFileSync(config, bytes);
  await history.readStatus(); assert.deepEqual(observeBytes(f.hostRoot), original); assert.equal(f.controls.turns, 24);
});

test('whole-store self-consistent later snapshot cannot replace owner-pinned final heads', async t => {
  const f = await completedPilotFixture(t), history = await reader(f);
  const journal = new FileJournal({ directory: join(f.directory, 'controller'), repositoryRoot: f.repositoryRoot });
  const saved = await journal.read(), last = copy(saved.events.at(-1));
  last.reason = 'TEST-ONLY self-consistent later duplicate';
  await journal.append(saved.head, last);
  await assert.rejects(history.readStatus(), /pinned immutable|receipt|head|drift/);
  await assert.rejects(reader(f), /pinned immutable|receipt|head|drift/);
  assert.equal(f.controls.turns, 24);
});

test('forged controller promotion and a reserved/nonexecuted attempt do not become archived completion', async t => {
  const f = await completedPilotFixture(t), before = await reader(f);
  const journal = new FileJournal({ directory: join(f.directory, 'controller'), repositoryRoot: f.repositoryRoot });
  const saved = await journal.read(), event = copy(saved.events.at(-1));
  event.reason = 'TEST-ONLY forged promotion'; event.state.attempts[0].status = 'confirmed';
  event.state.versions.push({ ...copy(event.state.baseVersion), id: '0'.repeat(64), promptDigest: '0'.repeat(64), origin: event.state.attempts[0].id });
  await journal.append(saved.head, event); await assert.rejects(before.readStatus());
  const nine = copy(f.capsule); nine.operations = nine.operations.filter(item => item.attemptId !== nine.attempts[9].id);
  assert.throws(() => verifyAuthorityCapsule(nine, { binding: f.bundle.binding, trust: f.trust,
    config: f.bundle.config, history: f.bundle.history }), /settled proposal/);
});

test('read-only authority export refuses an orphan pending artifact and detects changed referenced evidence', async t => {
  const f = await completedPilotFixture(t);
  const exportAgain = () => readCompletedAuthorityArchive({ directory: f.authorityRoot, repositoryRoot: f.repositoryRoot,
    sourceDescriptor: f.source.descriptor, actualSourceCommit: C, fetcher: f.source.fetcher, clock: () => f.capturedAt });
  const pending = join(f.authorityRoot, 'artifacts', 'pending.json');
  writeFileSync(pending, '{}', { flag: 'wx', mode: 0o600 }); await assert.rejects(exportAgain()); unlinkSync(pending);
  const evidence = join(f.authorityRoot, 'artifacts', f.capsule.operations[1].calls[0].evidenceDigest + '.json');
  const bytes = readFileSync(evidence); writeFileSync(evidence, '{}'); await assert.rejects(exportAgain()); writeFileSync(evidence, bytes);
  assert.equal(f.controls.turns, 24); await f.assertOriginal();
});

test('closure rejects pending provider/review work, the tenth only reserved, and a forged original negative output', async t => {
  const f = await completedPilotFixture(t), originalState = await f.authorityState();
  const context = { bundle: f.bundle, snapshot: await f.journal.read(), files: f.capsule.provenance.files,
    exportSourceCommit: C, qualificationDescriptorDigest: digest(f.source.descriptor),
    capturedAt: new Date(f.capturedAt).toISOString(), observationSnapshot: await f.proofJournal.read(),
    observationState: await new AuthorityLedger({ journal: f.proofJournal, binding: f.bundle.binding, initial: null }).read(), getArtifact: async id => copy(f.artifacts.get(id)) };
  const mutations = [
    state => { state.activeCallId = state.operations[1].calls[0].callId; },
    state => { state.operations[1].settlement = null; },
    state => { state.operations[1].calls[0].relay.status = 'claimed'; },
    state => { state.reviews.push({ operationId: state.operations[1].id, envelope: null }); },
    state => { state.operations[1].reconciliation = { mode: 'failed-execution' }; },
    state => { state.attempts.pop(); state.operations.pop(); },
    state => { state.attempts[9].status = 'reserved'; state.operations = state.operations.filter(item => item.attemptId !== state.attempts[9].id); },
  ];
  for (const mutate of mutations) { const state = copy(originalState); mutate(state);
    await assert.rejects(projectCompletedAuthority({ ...context, state })); }
  const wrong = copy(f.capsule); wrong.operations[1].calls[0].outputDigest = '0'.repeat(64);
  await assert.rejects(readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot,
    capsule: wrong, closurePresent: true }), /owned evidence|owned output/);
  const signature = copy(f.capsule), lease = JSON.parse(signature.operations[1].lease);
  lease.body.reservationMicros = 999;
  signature.operations[1].lease = JSON.stringify(lease);
  assert.throws(() => verifyAuthorityCapsule(signature, { binding: f.bundle.binding, trust: f.trust,
    config: f.bundle.config, history: f.bundle.history }), /signature/);
  assert.equal(f.controls.turns, 24);
});

test('closure refuses symlinks, hard links and changed permissions without cleanup or repair', async t => {
  const f = await completedPilotFixture(t), history = await reader(f);
  const path = join(f.closurePath, 'authority-capsule.json'), original = path + '.saved';
  renameSync(path, original); symlinkSync(original, path); await assert.rejects(history.readStatus());
  unlinkSync(path); renameSync(original, path);
  const linked = join(f.root, 'extra-link'); linkSync(path, linked); await assert.rejects(history.readStatus());
  assert.ok(readFileSync(linked).length > 0); unlinkSync(linked);
  chmodSync(path, 0o644); await assert.rejects(history.readStatus()); chmodSync(path, 0o600);
  await history.readStatus(); assert.equal(f.controls.turns, 24);
});

test('private numbered capsule transport rejects omitted, duplicated, reordered and cross-capture chunks', () => {
  const value = { schema: 'TEST-ONLY bounded transport', payload: 'private-data'.repeat(3000) };
  const lines = encodeHistoryChunks(value), expected = lines[0].sha256;
  assert.deepEqual(decodeHistoryChunks(lines, expected).value, value);
  const cases = [lines.slice(0, -1), [lines[0], ...lines.slice(2)], [...lines.slice(0, 2), lines[1], ...lines.slice(2)],
    [lines[0], lines[2], lines[1], ...lines.slice(3)]];
  for (const input of cases) assert.throws(() => decodeHistoryChunks(input, expected));
  const wrong = copy(lines); wrong[1].captureId = 'capture-' + '0'.repeat(64);
  assert.throws(() => decodeHistoryChunks(wrong, expected));
  const partial = copy(lines); partial[1].data = partial[1].data.slice(0, -4);
  assert.throws(() => decodeHistoryChunks(partial, expected));
  assert.throws(() => decodeHistoryChunks(lines, '0'.repeat(64)));
});

test('ten-attempt v2 rejects an authentic consume-only D authorization and altered historical D facts', async t => {
  const f = await completedPilotFixture(t), options = { binding: f.bundle.binding, trust: f.trust,
    config: f.bundle.config, history: f.bundle.history };
  const originalStatusBytes = JSON.stringify(f.implementation.status);
  const statusOptions = { binding: f.bundle.binding, trust: f.trust,
    implementationCommit: f.capsule.finalExecutionSourceCommit, requireAuthorization: true };
  assert.equal(verifyProposalObservationStatus(f.implementation.status, { ...statusOptions,
    requireRemainder: true }).authorizationEnvelope.body.allowRemainingExperiment, true,
  'the original signed status authorizes the completed remainder');
  const value = copy(f.capsule), envelope = JSON.parse(value.proposalObservation.authorization);
  envelope.body.allowRemainingExperiment = false;
  const signed = f.keys.evaluation.issue(envelope.body);
  value.proposalObservation.authorization = JSON.stringify(signed);
  // These signatures authenticate original JSON bytes. contracts.copy sorts
  // object keys, so it would corrupt the retained historical B envelopes.
  const status = JSON.parse(originalStatusBytes); status.authorizationEnvelope = signed;
  assert.equal(JSON.stringify({ ...status, authorizationEnvelope: f.implementation.status.authorizationEnvelope }), originalStatusBytes,
    'only the deliberately re-signed authorization envelope differs');
  assert.equal(verifyProposalObservationStatus(status, statusOptions).authorizationEnvelope.body.allowRemainingExperiment, false,
  'the signed proof is sufficient only for bounded original-fourth consumption');
  const remainderRefusal = { message: 'LEARNING_V2_REJECTED: D observation does not authorize remaining experiment execution' };
  assert.throws(() => verifyProposalObservationStatus(status, { ...statusOptions, requireRemainder: true }), remainderRefusal);
  assert.throws(() => verifyAuthorityCapsule(value, options), remainderRefusal);
  const wrongFacts = copy(f.capsule); wrongFacts.proposalObservation.qualificationFacts.source.parents.reverse();
  assert.throws(() => verifyAuthorityCapsule(wrongFacts, options), /qualification|facts/);
  const changedOutput = copy(f.capsule), prepared = JSON.parse(changedOutput.proposalObservation.preparation);
  prepared.body.observed.text = JSON.stringify(f.bundle.history[0].procedure);
  prepared.body.observed.outputDigest = bytesSha(prepared.body.observed.text);
  changedOutput.proposalObservation.preparation = JSON.stringify(f.keys.evaluation.issue(prepared.body));
  const authorization = JSON.parse(changedOutput.proposalObservation.authorization);
  authorization.body.preparedProofDigest = digest(JSON.parse(changedOutput.proposalObservation.preparation));
  changedOutput.proposalObservation.authorization = JSON.stringify(f.keys.evaluation.issue(authorization.body));
  assert.throws(() => verifyAuthorityCapsule(changedOutput, options), /invalidity|invalid/);
  assert.equal(f.capsule.operations[4].calls.length, 1);
  assert.equal(JSON.parse(f.capsule.operations[4].settlement).body.actualCalls, 1);
  assert.equal(JSON.parse(f.capsule.operations[4].settlement).body.actualMicros, null);
  assert.equal(f.controls.turns, 24);
  assert.equal(JSON.stringify(f.implementation.status), originalStatusBytes, 'original signed status remains byte-identical');
});

test('v2 requires the exact completed D cut and original failure even with self-consistent replacement journal hashes', async t => {
  const f = await completedPilotFixture(t), id = f.final.state.operations[4].id;
  const observationPath = join(f.directory, 'proposal-observations', digest({ operationId: id }));
  const originalPath = join(f.directory, 'operations', digest({ operationId: id }));
  const dispatchPath = join(f.directory, 'dispatch');
  const read = path => new FileJournal({ directory: path, repositoryRoot: f.repositoryRoot, create: false, readOnly: true }).read();
  const sidecar = await read(observationPath), original = await read(originalPath), dispatch = await read(dispatchPath);
  const check = () => readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot, capsule: f.capsule, closurePresent: true });
  const rejectUnchanged = async () => { const before = observeBytes(f.hostRoot); await assert.rejects(check());
    assert.deepEqual(observeBytes(f.hostRoot), before); assert.equal(f.controls.turns, 24); };
  await replaceSyntheticJournal(observationPath, f.repositoryRoot, sidecar.events.slice(0, 1));
  await rejectUnchanged();
  await replaceSyntheticJournal(observationPath, f.repositoryRoot, sidecar.events);
  const wrongCut = copy(sidecar.events); wrongCut[1].dispatchHead = '0'.repeat(64);
  await replaceSyntheticJournal(observationPath, f.repositoryRoot, wrongCut); await rejectUnchanged();
  await replaceSyntheticJournal(observationPath, f.repositoryRoot, sidecar.events);
  const withoutLink = dispatch.events.filter(event => event.type !== 'proposal-observation-linked');
  await replaceSyntheticJournal(dispatchPath, f.repositoryRoot, withoutLink); await rejectUnchanged();
  await replaceSyntheticJournal(dispatchPath, f.repositoryRoot, dispatch.events);
  const wrongLink = copy(dispatch.events); wrongLink.find(event => event.type === 'proposal-observation-linked').link.initialHead = '0'.repeat(64);
  await replaceSyntheticJournal(dispatchPath, f.repositoryRoot, wrongLink); await rejectUnchanged();
  await replaceSyntheticJournal(dispatchPath, f.repositoryRoot, dispatch.events);
  const changedFailure = copy(original.events);
  changedFailure.at(-1).payload.raw.TEST_ONLY_changed_original_failure = true;
  await replaceSyntheticJournal(originalPath, f.repositoryRoot, changedFailure); await rejectUnchanged();
  await replaceSyntheticJournal(originalPath, f.repositoryRoot, original.events);
  await check(); assert.equal(f.controls.turns, 24);
});

test('C authority export requires unchanged independent D custody and refuses an extra or ambiguous proof tail without writes', async t => {
  const f = await completedPilotFixture(t), proofPath = join(f.authorityRoot, 'proposal-observation');
  const original = await f.observationAuthorityJournal.read();
  const exportAgain = () => readCompletedAuthorityArchive({ directory: f.authorityRoot, repositoryRoot: f.repositoryRoot,
    sourceDescriptor: f.source.descriptor, actualSourceCommit: C, fetcher: f.source.fetcher, clock: () => f.capturedAt });
  const before = observeBytes(f.authorityRoot);
  renameSync(proofPath, proofPath + '-held'); await assert.rejects(exportAgain()); renameSync(proofPath + '-held', proofPath);
  const lock = join(proofPath, '.writer.lock'); writeFileSync(lock, 'TEST-ONLY held writer', { mode: 0o600, flag: 'wx' });
  await assert.rejects(exportAgain()); assert.equal(readFileSync(lock, 'utf8'), 'TEST-ONLY held writer'); unlinkSync(lock);
  const last = original.events.at(-1);
  const extra = { schema: last.schema, binding: copy(last.binding), kind: 'TEST-ONLY extra D mutation',
    recordedAt: last.recordedAt, previousDigest: last.stateDigest, stateDigest: last.stateDigest, changes: [] };
  await replaceSyntheticJournal(proofPath, f.repositoryRoot, [...original.events, extra]);
  const mutated = observeBytes(f.authorityRoot); await assert.rejects(exportAgain());
  assert.deepEqual(observeBytes(f.authorityRoot), mutated);
  await replaceSyntheticJournal(proofPath, f.repositoryRoot, original.events);
  await exportAgain(); assert.deepEqual(observeBytes(f.authorityRoot), before); assert.equal(f.controls.turns, 24);
});
