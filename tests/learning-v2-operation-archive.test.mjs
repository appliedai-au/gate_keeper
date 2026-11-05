/** Source prepared for the complete remote gate; do not run locally. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { POLICY, copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { FileJournal, MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { OperationArchive } from '../scripts/learning-v2/operation-archive.mjs';

const SCHEMA = 'gk-learning-v2-operation-archive-v1';
const INPUT_DIGEST = 'd'.repeat(64);

function fixture(requiredCalls = 2) {
  const request = {
    schema: 'gk-learning-v2-execution-request', experimentId: 'experiment:archive',
    configDigest: 'e'.repeat(64), sourceCommit: 'a'.repeat(40),
    kind: 'baseline', attemptId: null, namespace: 'experiment:baseline',
    provider: 'truefoundry', memory: 'off', model: 'tfy-managed/test-model',
    runtimeDigest: 'b'.repeat(64), firstPassInstructionsDigest: 'c'.repeat(64),
    requiredCalls, plan: { namespace: 'experiment:baseline' },
    prompts: { base: { instructions: 'Review the supplied code.' } }, learner: null,
  };
  const operation = {
    id: 'operation:baseline', kind: request.kind, attemptId: request.attemptId,
    namespace: request.namespace, requestDigest: digest(request), leaseId: 'lease:baseline',
    maxCalls: requiredCalls, reservationMicros: 1_000_000, settled: false, consumed: false,
    observedFreshCalls: 0, evidenceComplete: false,
  };
  const call = {
    callId: 'call:first', operationId: operation.id, leaseId: operation.leaseId,
    requestDigest: operation.requestDigest, sourceCommit: request.sourceCommit,
    runtimeDigest: request.runtimeDigest,
    model: { name: request.model, params: { maxTokens: 4096, temperature: 0 } },
    instructions: 'Review the supplied code.', message: 'A complete supplied code window.',
  };
  return { operation, request, call };
}

async function admitted(requiredCalls = 2, journal = new MemoryJournal()) {
  const values = fixture(requiredCalls);
  const archive = new OperationArchive({ journal });
  await archive.claimOperation(values.operation, values.request);
  return { ...values, archive, journal };
}

function stagePayload(stage, changes = {}) {
  return {
    inputDigest: INPUT_DIGEST, sessionId: 'session:first',
    ...(stage === 'session' ? {} : { turnId: 'turn:first' }),
    ...(stage === 'final' ? { callId: 'call:first', text: 'Observed finding.', raw: { events: [] } } :
      { request: { message: 'Private input' }, response: { id: `${stage}:first`, data: { retained: true } } }),
    ...changes,
  };
}

async function recordThroughTurn(archive, call) {
  await archive.claimCall(call);
  await archive.recordCall(call.callId, 'session', stagePayload('session'));
  await archive.recordCall(call.callId, 'turn', stagePayload('turn'));
}

function diskFixture(t) {
  const root = mkdtempSync(join(realpathSync(tmpdir()), 'gk-operation-archive-'));
  chmodSync(root, 0o700);
  const repositoryRoot = join(root, 'repository');
  mkdirSync(repositoryRoot, { mode: 0o700 });
  const directory = join(root, 'private', 'operation');
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { directory, repositoryRoot };
}

async function appendRaw(journal, event) {
  const { head } = await journal.read();
  await journal.append(head, event);
}

test('an empty archive has no authority and an operation can be claimed only once', async () => {
  const journal = new MemoryJournal();
  const archive = new OperationArchive({ journal });
  const { operation, request, call } = fixture();
  assert.deepEqual(await archive.read(), { operation: null, request: null, calls: [], artifacts: [] });
  await assert.rejects(archive.claimCall(call), /operation claim required/);
  await assert.rejects(archive.recordArtifact('artifact:first', 'request-plan', request), /operation claim required/);
  const claimed = await archive.claimOperation(operation, request);
  assert.deepEqual(claimed, { operation, request, calls: [], artifacts: [] });
  const before = await journal.read();
  await assert.rejects(archive.claimOperation(operation, request), /already claimed/);
  await assert.rejects(new OperationArchive({ journal }).claimOperation(operation, request), /already claimed/);
  await assert.rejects(archive.claimOperation({ ...operation, id: 'operation:other' }, request), /already claimed/);
  assert.deepEqual(await journal.read(), before);
});

test('operation reservation and request identities are checked before any archive write', async () => {
  const variants = [
    ({ operation }) => { operation.requestDigest = 'f'.repeat(64); },
    ({ operation }) => { operation.maxCalls++; },
    ({ operation }) => { operation.kind = 'screen'; },
    ({ operation }) => { operation.attemptId = 'attempt:1'; },
    ({ operation }) => { operation.namespace = 'namespace:wrong'; },
    ({ operation }) => { operation.leaseId = ''; },
    ({ operation }) => { operation.consumed = true; },
    ({ operation }) => { operation.settled = true; },
    ({ operation }) => { operation.observedFreshCalls = 1; },
    ({ operation }) => { operation.evidenceComplete = true; },
    ({ request }) => { request.schema = 'other-schema'; },
    ({ request }) => { request.sourceCommit = 'not-a-commit'; },
    ({ request }) => { request.runtimeDigest = 'not-a-runtime'; },
    ({ request }) => { request.provider = 'unapproved'; },
    ({ request }) => { request.memory = 'on'; },
  ];
  for (const change of variants) {
    const values = fixture();
    change(values);
    const journal = new MemoryJournal();
    const archive = new OperationArchive({ journal });
    await assert.rejects(archive.claimOperation(values.operation, values.request), /LEARNING_V2_REJECTED:/);
    assert.deepEqual(await journal.read(), { head: null, events: [] });
  }
});

test('archive accepts exact call reservation above old programme cap without a spending gate', async () => {
  assert.equal(POLICY.version, 4);
  assert.equal(POLICY.programmeCeilingMicros, null);
  for (const micros of [0, 20_000_001, 60_000_000, 125_000_000]) {
    const { operation, request } = fixture();
    const bound = { ...operation, reservationMicros: micros };
    const journal = new MemoryJournal();
    const archive = new OperationArchive({ journal });
    const claimed = await archive.claimOperation(bound, request);
    assert.equal(claimed.operation.reservationMicros, micros);
    assert.equal((await new OperationArchive({ journal }).read()).operation.reservationMicros, micros);
  }
  for (const micros of [-1, Number.MAX_SAFE_INTEGER + 1]) {
    const { operation, request } = fixture();
    const journal = new MemoryJournal();
    await assert.rejects(new OperationArchive({ journal }).claimOperation({
      ...operation, reservationMicros: micros,
    }, request), /operation reservation: invalid integer/);
    assert.deepEqual(await journal.read(), { head: null, events: [] });
  }
});

test('two archive instances racing to claim the same operation have one CAS winner', async () => {
  const journal = new MemoryJournal();
  const { operation, request } = fixture();
  const results = await Promise.allSettled([new OperationArchive({ journal }), new OperationArchive({ journal })]
    .map(archive => archive.claimOperation(operation, request)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /stale expected head/);
  assert.equal((await journal.read()).events.length, 1);
  assert.deepEqual((await new OperationArchive({ journal }).read()).operation, operation);
});

test('call intents bind every admitted identity and freeze model settings', async () => {
  const { archive, journal, call } = await admitted(3);
  const before = await journal.read();
  const variants = [
    { operationId: 'operation:other' }, { leaseId: 'lease:other' },
    { requestDigest: 'f'.repeat(64) }, { sourceCommit: 'f'.repeat(40) },
    { runtimeDigest: 'f'.repeat(64) }, { model: { ...call.model, name: 'other-model' } },
    { instructions: '' }, { message: '' }, { extra: 'unbound' },
  ];
  for (const change of variants) await assert.rejects(archive.claimCall({ ...call, ...change }), /LEARNING_V2_REJECTED:/);
  assert.deepEqual(await journal.read(), before);
  await archive.claimCall(call);
  await assert.rejects(archive.claimCall({ ...call, callId: 'call:other',
    model: { ...call.model, params: { maxTokens: 4096, temperature: 1 } } }), /parameters changed/);
  await archive.claimCall({ ...call, callId: 'call:second', message: 'Another planned code window.' });
  assert.equal((await archive.read()).calls.length, 2);
});

test('two archive instances cannot dispatch the same call intent twice', async () => {
  const { journal, call } = await admitted();
  const results = await Promise.allSettled([new OperationArchive({ journal }), new OperationArchive({ journal })]
    .map(archive => archive.claimCall(call)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /stale expected head/);
  const reopened = new OperationArchive({ journal });
  await assert.rejects(reopened.claimCall(call), /already claimed/);
  assert.equal((await reopened.read()).calls.length, 1);
  assert.equal((await journal.read()).events.length, 2);
});

test('distinct concurrent call claims cannot exceed the complete reserved call count', async () => {
  const { journal, call } = await admitted(1);
  const results = await Promise.allSettled(['call:first', 'call:second'].map(callId =>
    new OperationArchive({ journal }).claimCall({ ...call, callId })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const archive = new OperationArchive({ journal });
  assert.equal((await archive.read()).calls.length, 1);
  await assert.rejects(archive.claimCall({ ...call, callId: 'call:third' }), /call count exhausted/);
});

test('private FileJournal preserves staged observations across fresh archive instances', async t => {
  const paths = diskFixture(t);
  const { operation, request, call } = fixture(1);
  const fresh = () => new OperationArchive({ journal: new FileJournal(paths) });
  await fresh().claimOperation(operation, request);
  await fresh().claimCall(call);
  await fresh().recordCall(call.callId, 'session', stagePayload('session'));
  assert.deepEqual((await fresh().read()).calls[0].stages, [{ stage: 'session', payload: stagePayload('session') }]);
  await fresh().recordCall(call.callId, 'turn', stagePayload('turn'));
  await fresh().recordCall(call.callId, 'final', stagePayload('final'));
  await fresh().recordArtifact('evaluation:first', 'evaluation', { rawFindings: ['private finding'], receiptBytes: '{"signed":true}' });
  const stored = await fresh().read();
  assert.deepEqual(stored.calls[0].stages.map(item => item.stage), ['session', 'turn', 'final']);
  assert.equal(stored.calls[0].stages[2].payload.text, 'Observed finding.');
  assert.equal(stored.artifacts[0].payload.receiptBytes, '{"signed":true}');
  await assert.rejects(fresh().claimCall(call), /already claimed/);
  await assert.rejects(fresh().claimOperation(operation, request), /already claimed/);
});

test('a restart does not retry an incomplete intent or restore a failed call slot', async () => {
  const { journal, archive, call } = await admitted(1);
  await archive.claimCall(call);
  const reopened = new OperationArchive({ journal });
  assert.deepEqual((await reopened.read()).calls[0].stages, []);
  await assert.rejects(reopened.claimCall(call), /already claimed/);
  await reopened.recordCall(call.callId, 'failure', {
    code: 'DISPATCH_UNRESOLVED', inputDigest: INPUT_DIGEST, sessionId: null, turnId: null,
  });
  const afterFailure = new OperationArchive({ journal });
  await assert.rejects(afterFailure.claimCall(call), /already claimed/);
  await assert.rejects(afterFailure.claimCall({ ...call, callId: 'call:replacement' }), /call count exhausted/);
  await assert.rejects(afterFailure.recordCall(call.callId, 'session', stagePayload('session')), /terminal/);
});

test('stages require an existing intent and follow session then turn then final exactly once', async () => {
  const { archive, journal, call } = await admitted();
  await assert.rejects(archive.recordCall(call.callId, 'session', stagePayload('session')), /call intent required/);
  await archive.claimCall(call);
  for (const stage of ['turn', 'final']) await assert.rejects(archive.recordCall(call.callId, stage, stagePayload(stage)), /out of order/);
  await assert.rejects(archive.recordCall(call.callId, 'unknown', {}), /unknown archive call stage/);
  await archive.recordCall(call.callId, 'session', stagePayload('session'));
  const afterSession = await journal.read();
  await assert.rejects(archive.recordCall(call.callId, 'session', stagePayload('session')), /out of order/);
  await assert.rejects(archive.recordCall(call.callId, 'final', stagePayload('final')), /out of order/);
  assert.deepEqual(await journal.read(), afterSession);
  await archive.recordCall(call.callId, 'turn', stagePayload('turn'));
  await archive.recordCall(call.callId, 'final', stagePayload('final'));
  const completed = await journal.read();
  for (const stage of ['session', 'turn', 'final', 'failure']) {
    await assert.rejects(archive.recordCall(call.callId, stage, stagePayload(stage)), /terminal/);
  }
  assert.deepEqual(await journal.read(), completed);
});

test('failure is terminal before session, after session, or after turn', async () => {
  for (let completedStages = 0; completedStages <= 2; completedStages++) {
    const { archive, call } = await admitted(1);
    await archive.claimCall(call);
    if (completedStages >= 1) await archive.recordCall(call.callId, 'session', stagePayload('session'));
    if (completedStages >= 2) await archive.recordCall(call.callId, 'turn', stagePayload('turn'));
    await archive.recordCall(call.callId, 'failure', {
      callId: call.callId, operationId: call.operationId, inputDigest: INPUT_DIGEST,
      sessionId: completedStages >= 1 ? 'session:first' : null,
      turnId: completedStages >= 2 ? 'turn:first' : null, code: 'OBSERVATION_UNRESOLVED',
    });
    const entry = (await archive.read()).calls[0];
    assert.equal(entry.stages.length, completedStages + 1);
    assert.equal(entry.stages.at(-1).stage, 'failure');
    await assert.rejects(archive.recordCall(call.callId, 'failure', {}), /terminal/);
    await assert.rejects(archive.recordCall(call.callId, 'final', stagePayload('final')), /terminal/);
  }
});

test('once observed, session turn and input identities cannot change or disappear', async () => {
  const { archive, call } = await admitted();
  await archive.claimCall(call);
  await archive.recordCall(call.callId, 'session', stagePayload('session'));
  await assert.rejects(archive.recordCall(call.callId, 'turn', stagePayload('turn', { sessionId: 'session:other' })), /sessionId changed/);
  await assert.rejects(archive.recordCall(call.callId, 'turn', stagePayload('turn', { inputDigest: 'f'.repeat(64) })), /inputDigest changed/);
  await assert.rejects(archive.recordCall(call.callId, 'turn', { sessionId: 'session:first', turnId: 'turn:first' }), /inputDigest changed or missing/);
  await assert.rejects(archive.recordCall(call.callId, 'failure', { inputDigest: INPUT_DIGEST, sessionId: null }), /sessionId changed/);
  await archive.recordCall(call.callId, 'turn', stagePayload('turn'));
  await assert.rejects(archive.recordCall(call.callId, 'final', stagePayload('final', { turnId: 'turn:other' })), /turnId changed/);
  await assert.rejects(archive.recordCall(call.callId, 'final', stagePayload('final', { callId: 'call:other' })), /callId mismatch/);
  await archive.recordCall(call.callId, 'final', stagePayload('final'));
});

test('concurrent final observations have one winner and no terminal overwrite', async () => {
  const { archive, journal, call } = await admitted();
  await recordThroughTurn(archive, call);
  const results = await Promise.allSettled(['first observation', 'second observation'].map(text =>
    new OperationArchive({ journal }).recordCall(call.callId, 'final', stagePayload('final', { text }))));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  const stages = (await archive.read()).calls[0].stages;
  assert.equal(stages.length, 3);
  assert.equal(stages.at(-1).stage, 'final');
  assert.ok(['first observation', 'second observation'].includes(stages.at(-1).payload.text));
});

test('raw inputs outputs and artifacts are copied at entry and on every read', async () => {
  const { archive, journal, operation, request, call } = await admitted();
  operation.id = 'mutated operation';
  request.prompts.base.instructions = 'mutated request';
  const claiming = archive.claimCall(call);
  call.message = 'mutated call';
  call.model.params.temperature = 1;
  await claiming;
  const payload = stagePayload('session');
  const recording = archive.recordCall('call:first', 'session', payload);
  payload.response.data.retained = false;
  await recording;
  const bytes = '{"z":"original signed bytes", "a":1}';
  const artifact = { receiptBytes: bytes, mergedFindings: [{ text: 'Do not execute: process.exit(1)' }] };
  const recordingArtifact = archive.recordArtifact('private:first', 'evaluation', artifact);
  artifact.mergedFindings[0].text = 'mutated artifact';
  await recordingArtifact;
  const output = await archive.read();
  output.operation.id = 'mutated read';
  output.request.prompts.base.instructions = 'mutated read';
  output.calls[0].stages[0].payload.response.data.retained = false;
  output.artifacts[0].payload.mergedFindings.length = 0;
  const reopened = await new OperationArchive({ journal }).read();
  assert.equal(reopened.operation.id, 'operation:baseline');
  assert.equal(reopened.request.prompts.base.instructions, 'Review the supplied code.');
  assert.equal(reopened.calls[0].call.message, 'A complete supplied code window.');
  assert.equal(reopened.calls[0].call.model.params.temperature, 0);
  assert.equal(reopened.calls[0].stages[0].payload.response.data.retained, true);
  assert.equal(reopened.artifacts[0].payload.receiptBytes, bytes);
  assert.equal(reopened.artifacts[0].payload.mergedFindings[0].text, 'Do not execute: process.exit(1)');
});

test('accessors executable values and non-JSON payloads are never evaluated or recorded', async () => {
  const { archive, journal, call } = await admitted();
  await archive.claimCall(call);
  let getterCalled = false;
  const getter = {};
  Object.defineProperty(getter, 'response', { enumerable: true, get() { getterCalled = true; return {}; } });
  const cyclic = {};
  cyclic.self = cyclic;
  const invalid = [getter, cyclic, { callback() {} }, { data: undefined }, { data: new Date() }, { data: NaN },
    { data: 1n }, { data: [, 1] }, JSON.parse('{"__proto__":{"polluted":true}}')];
  const before = await journal.read();
  for (const payload of invalid) {
    await assert.rejects(archive.recordCall(call.callId, 'session', payload), /LEARNING_V2_REJECTED:/);
    await assert.rejects(archive.recordArtifact('invalid:first', 'evaluation', payload), /LEARNING_V2_REJECTED:/);
  }
  assert.equal(getterCalled, false);
  assert.equal({}.polluted, undefined);
  assert.deepEqual(await journal.read(), before);
});

test('artifact identities are unique across kinds and concurrent archive instances', async () => {
  const { archive, journal } = await admitted();
  const results = await Promise.allSettled(['evaluation', 'novelty'].map(kind =>
    new OperationArchive({ journal }).recordArtifact('receipt:one', kind, { source: kind })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected').length, 1);
  await assert.rejects(archive.recordArtifact('receipt:one', 'proposal', {}), /artifact already recorded/);
  await archive.recordArtifact('receipt:two', 'proposal', 'original serialized receipt');
  await archive.recordArtifact('plan:first', 'request-plan', { requiredCalls: 2 });
  assert.equal((await archive.read()).artifacts.length, 3);
});

test('valid journal hashes do not excuse unknown archive schemas or record fields', async () => {
  const cases = [
    { schema: 'unknown-archive', type: 'operation-claimed' },
    { schema: SCHEMA, type: 'unknown-type' },
    { schema: SCHEMA, type: 'artifact-recorded', id: 'artifact:first', kind: 'evaluation', payload: {}, extra: true },
  ];
  for (const event of cases) {
    const { journal } = await admitted();
    await appendRaw(journal, event);
    await assert.rejects(new OperationArchive({ journal }).read(), /LEARNING_V2_REJECTED:/);
  }
});

test('replay rejects duplicate intents artifacts and observations with missing prerequisites', async () => {
  const { operation, request, call } = fixture(1);
  const claim = { schema: SCHEMA, type: 'call-claimed', call };
  const session = { schema: SCHEMA, type: 'call-recorded', callId: call.callId, stage: 'session', payload: stagePayload('session') };
  const turn = { ...session, stage: 'turn', payload: stagePayload('turn') };
  const final = { ...session, stage: 'final', payload: stagePayload('final') };
  const artifact = { schema: SCHEMA, type: 'artifact-recorded', id: 'artifact:first', kind: 'evaluation', payload: {} };
  const invalidHistories = [
    [claim, claim], [session], [claim, turn], [claim, session, session],
    [claim, session, final], [claim, session, turn, final, final],
    [claim, { ...session, stage: 'failure', payload: {} }, session],
    [claim, { ...claim, call: { ...call, callId: 'call:excess' } }],
    [artifact, artifact], [{ schema: SCHEMA, type: 'operation-claimed', operation, request }],
  ];
  for (const history of invalidHistories) {
    const journal = new MemoryJournal();
    await journal.append(null, { schema: SCHEMA, type: 'operation-claimed', operation, request });
    for (const event of history) await appendRaw(journal, event);
    const archive = new OperationArchive({ journal });
    await assert.rejects(archive.read(), /LEARNING_V2_REJECTED:/);
    await assert.rejects(archive.recordArtifact('attempted:repair', 'proposal', {}), /LEARNING_V2_REJECTED:/);
  }
});

test('replay rechecks call context and observation bindings instead of trusting hashed bytes', async () => {
  for (const tamper of [
    { schema: SCHEMA, type: 'call-claimed', call: { ...fixture().call, sourceCommit: 'f'.repeat(40) } },
    { schema: SCHEMA, type: 'call-recorded', callId: 'call:first', stage: 'turn',
      payload: stagePayload('turn', { sessionId: 'session:other' }) },
  ]) {
    const { archive, journal, call } = await admitted();
    if (tamper.type === 'call-recorded') {
      await archive.claimCall(call);
      await archive.recordCall(call.callId, 'session', stagePayload('session'));
    }
    await appendRaw(journal, tamper);
    await assert.rejects(new OperationArchive({ journal }).read(), /LEARNING_V2_REJECTED:/);
  }
});

test('ambiguous committed writes are not retried and remain visible to a later reader', async () => {
  const { journal, call } = await admitted(1);
  let appendCalls = 0;
  const ambiguous = {
    read: () => journal.read(),
    async append(head, event) {
      appendCalls++;
      await journal.append(head, event);
      throw new Error('publication acknowledgement lost');
    },
  };
  await assert.rejects(new OperationArchive({ journal: ambiguous }).claimCall(copy(call)), /acknowledgement lost/);
  assert.equal(appendCalls, 1);
  const reopened = new OperationArchive({ journal });
  assert.equal((await reopened.read()).calls.length, 1);
  await assert.rejects(reopened.claimCall(call), /already claimed/);
  await assert.rejects(reopened.claimCall({ ...call, callId: 'call:replacement' }), /call count exhausted/);
});
