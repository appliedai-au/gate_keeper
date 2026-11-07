import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { runTrueForgeTurn, turnInputDigest, TURN_CONFIG } from '../scripts/learning-v2/trueforge-turn.mjs';

// SOURCE ONLY until the required managed remote gate runs this suite. Injected
// clients model the verified SDK contracts; there are no credentials/model calls.
const call = () => ({ callId: 'call:1', operationId: 'operation:1', leaseId: 'lease:1',
  requestDigest: 'a'.repeat(64), sourceCommit: 'b'.repeat(40), runtimeDigest: 'c'.repeat(64),
  model: { name: 'tfy-direct/test-model', params: { temperature: 0, maxTokens: 1500 } },
  instructions: 'Review the numbered code.', message: '1 | example();' });

const output = () => ({ id: 'message:1', type: 'model.message', threadId: 'main',
  createdAt: '2026-11-04T00:00:00Z', content: '{"findings":[]}', finishReason: 'stop' });
const done = () => ({ status: 'done', completedAt: '2026-11-04T00:00:01Z', output: output(),
  requiredActions: [], metrics: { totalCostInUsd: 0.002, totalInputTokens: 50, totalOutputTokens: 5 } });
const turn = state => ({ id: 'turn:1', sessionId: 'session:1', previousTurnId: null,
  createdAt: '2026-11-04T00:00:00Z', state });

function fixture({ state = done(), reads = [], pages = null } = {}) {
  const order = [], sdkCalls = [], stages = [];
  const claims = new Set();
  let now = 0, readIndex = 0, pageIndex = 0;
  const responses = pages ?? [{ data: [output()], pagination: { limit: 100 } }];
  const invoke = (method, implementation) => async (...args) => {
    order.push(method); sdkCalls.push({ method, args }); return implementation(...args);
  };
  const client = { sessions: {
    create: invoke('create', () => ({ data: { id: 'session:1', metadata: {} } })),
    createTurn: invoke('createTurn', () => ({ data: turn(copy(state)) })),
    getTurn: invoke('getTurn', () => ({ data: turn(copy(reads[readIndex++] ?? done())) })),
    listTurnEvents: invoke('listTurnEvents', () => ({ response: copy(responses[pageIndex++]),
      rawResponse: { headers: { authorization: 'DO_NOT_ARCHIVE_TRANSPORT_SECRET' } } })),
  } };
  const archive = {
    async claimCall(value) {
      order.push('claim');
      if (claims.has(value.callId)) throw new Error('duplicate call');
      claims.add(value.callId);
    },
    async recordCall(callId, stage, payload) {
      order.push(stage); stages.push({ callId, stage, payload: copy(payload) });
    },
  };
  const args = { client, call: call(), archive, clock: () => now,
    pause: async milliseconds => { now += milliseconds; }, timeoutMs: 1000, pollIntervalMs: 10 };
  return { args, client, archive, order, sdkCalls, stages, setTime: value => { now = value; } };
}

test('claims a call before fresh session/root-turn mutations and archives immutable stages in order', async () => {
  const f = fixture();
  const result = await runTrueForgeTurn(f.args);
  assert.deepEqual(f.order, ['claim', 'create', 'session', 'createTurn', 'turn', 'listTurnEvents', 'final']);
  assert.deepEqual(f.stages.map(item => item.stage), ['session', 'turn', 'final']);
  assert.equal(result.sessionId, 'session:1');
  assert.equal(result.turnId, 'turn:1');
  assert.equal(result.complete, true);
  assert.deepEqual(f.sdkCalls[0].args[0].agent.spec.config, {
    askUserQuestions: { enabled: false }, generativeUi: { enabled: false },
    dynamicSubAgents: { enabled: false }, webSearch: { enabled: false },
    sandbox: { enabled: false }, contextManagement: {
      compaction: { enabled: false }, largeToolResponse: { enabled: false },
    }, iterationLimit: 1,
  });
  assert.deepEqual(f.sdkCalls[0].args[0], { agent: { spec: { model: call().model,
    instructions: call().instructions, config: TURN_CONFIG } }, metadata: {
    purpose: 'gk-learning-v2', callId: 'call:1', operationId: 'operation:1', requestDigest: 'a'.repeat(64) } });
  assert.deepEqual(f.sdkCalls[1].args.slice(0, 2), ['session:1', {
    input: [{ type: 'user.message', content: call().message }], previousTurnId: 'none' }]);
  assert.equal(Object.hasOwn(f.sdkCalls[0].args[0].agent.spec, 'skills'), false);
  assert.equal(Object.hasOwn(TURN_CONFIG, 'memory'), false);
});

test('disables SDK retries and bounds every request, including polling and event pagination', async () => {
  const f = fixture({ state: { status: 'running' }, reads: [done()], pages: [
    { data: [output()], pagination: { limit: 100, nextPageToken: 'page:2' } },
    { data: [], pagination: { limit: 100 } },
  ] });
  const result = await runTrueForgeTurn(f.args);
  assert.equal(result.complete, true);
  assert.deepEqual(f.sdkCalls.map(item => item.method), ['create', 'createTurn', 'getTurn', 'listTurnEvents', 'listTurnEvents']);
  for (const { args } of f.sdkCalls) {
    const options = args.at(-1);
    assert.deepEqual(Object.keys(options).sort(), ['abortSignal', 'maxRetries', 'timeoutInSeconds']);
    assert.equal(options.maxRetries, 0);
    assert.ok(options.timeoutInSeconds > 0 && options.timeoutInSeconds <= 1);
    assert.ok(options.abortSignal instanceof AbortSignal);
  }
  assert.deepEqual(f.sdkCalls.at(-1).args.slice(0, 3), ['session:1', 'turn:1', { order: 'asc', limit: 100, pageToken: 'page:2' }]);
  assert.equal(result.raw.eventPages.length, 2);
  assert.equal(result.raw.turns.length, 2);
});

test('hashes the actual model-visible input and exact final UTF-8 text bytes', async () => {
  const state = done(); state.output.content = '  {"findings":[],"note":"é"}\n';
  const f = fixture({ state });
  const result = await runTrueForgeTurn(f.args);
  assert.equal(result.inputDigest, digest({ model: call().model, instructions: call().instructions,
    config: TURN_CONFIG, messages: [{ type: 'user.message', content: call().message }], previousTurnId: 'none' }));
  assert.equal(result.inputDigest, turnInputDigest(call()));
  assert.equal(result.outputDigest, createHash('sha256').update(state.output.content, 'utf8').digest('hex'));
  assert.equal(result.text, state.output.content);
  assert.equal(turnInputDigest({ ...call(), callId: 'another:call' }), result.inputDigest);
  assert.notEqual(turnInputDigest({ ...call(), message: call().message + '\n' }), result.inputDigest);
  assert.throws(() => { TURN_CONFIG.generativeUi.enabled = true; }, TypeError);
  assert.throws(() => { TURN_CONFIG.contextManagement.compaction.enabled = true; }, TypeError);
  assert.throws(() => { TURN_CONFIG.contextManagement.largeToolResponse = { enabled: true }; }, TypeError);
  assert.throws(() => { TURN_CONFIG.iterationLimit = 512; }, TypeError);
});

test('claim failure or an already-claimed call cannot make any new SDK call', async () => {
  const f = fixture();
  f.archive.claimCall = async () => { throw new Error('private journal unavailable'); };
  await assert.rejects(runTrueForgeTurn(f.args), /TRUEFORGE_CALL_CLAIM_FAILED/);
  assert.deepEqual(f.sdkCalls, []);
  assert.deepEqual(f.stages, []);
  const second = fixture();
  await runTrueForgeTurn(second.args);
  const count = second.sdkCalls.length;
  await assert.rejects(runTrueForgeTurn(second.args), /TRUEFORGE_CALL_CLAIM_FAILED/);
  assert.equal(second.sdkCalls.length, count);
});

test('strict call inputs reject extra fields, executable data, unbounded outputs and provider tool parameters before claiming', async () => {
  const invalid = [
    { ...call(), unexpected: 'value' },
    { ...call(), message: () => 'executable' },
    { ...call(), sourceCommit: 'not-a-commit' },
    { ...call(), model: { ...call().model, params: { temperature: 0 } } },
    { ...call(), model: { ...call().model, params: { maxTokens: 1500, tools: [] } } },
    { ...call(), model: { ...call().model, params: { maxTokens: 1500, parallelToolCalls: true } } },
    { ...call(), model: { ...call().model, params: { maxTokens: 1500, reasoningEffort: { nested: true } } } },
  ];
  for (const value of invalid) {
    const f = fixture(); f.args.call = value;
    await assert.rejects(runTrueForgeTurn(f.args), /LEARNING_V2_REJECTED/);
    assert.deepEqual(f.order, []);
  }
  const accessor = call();
  Object.defineProperty(accessor, 'message', { enumerable: true, get() { throw new Error('getter must not run'); } });
  assert.throws(() => turnInputDigest(accessor), /non-data property/);
});

test('a session archive failure prevents the potentially billable turn mutation', async () => {
  const f = fixture();
  const save = f.archive.recordCall;
  f.archive.recordCall = async (id, stage, payload) => {
    if (stage === 'session') throw new Error('archive failed');
    return save(id, stage, payload);
  };
  await assert.rejects(runTrueForgeTurn(f.args), /TRUEFORGE_CALL_UNRESOLVED/);
  assert.deepEqual(f.sdkCalls.map(item => item.method), ['create']);
  assert.equal(f.stages[0].stage, 'failure');
  assert.equal(f.stages[0].payload.sessionId, 'session:1');
});

test('ambiguous SDK failure preserves received frames without storing error messages, credentials or transport headers', async () => {
  const f = fixture();
  f.client.sessions.createTurn = async () => { throw new Error('https://secret-route.example/API_TOKEN'); };
  const error = await runTrueForgeTurn(f.args).then(() => null, value => value);
  assert.equal(error.code, 'TRUEFORGE_CALL_UNRESOLVED');
  assert.equal(error.failureRecorded, true);
  assert.equal(Object.hasOwn(error, 'cause'), false);
  assert.equal(f.stages.at(-1).payload.raw.session.id, 'session:1');
  assert.equal(f.stages.at(-1).payload.turnId, null);
  assert.doesNotMatch(JSON.stringify(f.stages), /secret-route|API_TOKEN|DO_NOT_ARCHIVE_TRANSPORT_SECRET/);
  const completed = fixture();
  const result = await runTrueForgeTurn(completed.args);
  assert.doesNotMatch(JSON.stringify(result), /DO_NOT_ARCHIVE_TRANSPORT_SECRET|rawResponse|authorization/);
});

test('poll deadline produces incomplete evidence without repeating mutations or reporting a made-up cost', async () => {
  const f = fixture({ state: { status: 'running' } });
  f.args.timeoutMs = 10; f.args.pollIntervalMs = 10;
  const result = await runTrueForgeTurn(f.args);
  assert.equal(result.complete, false);
  assert.equal(result.raw.outcome, 'deadline-exceeded');
  assert.equal(result.raw.eventsComplete, false);
  assert.equal(result.estimatedCostUsd, null);
  assert.deepEqual(f.sdkCalls.map(item => item.method), ['create', 'createTurn']);
  assert.equal(f.stages.at(-1).stage, 'final');
});

test('a hanging request is aborted at its deadline and remains an unresolved single dispatch', async () => {
  const f = fixture();
  let dispatched = 0, signal;
  f.args.timeoutMs = 5;
  f.client.sessions.createTurn = async (_id, _request, options) => {
    dispatched++; signal = options.abortSignal; return new Promise(() => {});
  };
  await assert.rejects(runTrueForgeTurn(f.args), /TRUEFORGE_DEADLINE_EXCEEDED/);
  assert.equal(dispatched, 1);
  assert.equal(signal.aborted, true);
  assert.equal(f.stages.at(-1).stage, 'failure');
  assert.equal(f.stages.at(-1).payload.sessionId, 'session:1');
});

for (const [name, change] of [
  ['truncated finish', state => { state.output.finishReason = 'length'; }],
  ['missing finish', state => { delete state.output.finishReason; }],
  ['null finish', state => { state.output.finishReason = null; }],
  ['tool finish', state => { state.output.finishReason = 'tool_calls'; }],
  ['tool calls', state => { state.output.toolCalls = [{ id: 'tool:1', name: 'read_file', arguments: '{}' }]; }],
  ['required actions', state => { state.requiredActions = [{ type: 'tool.approval_required', id: 'action:1' }]; }],
  ['missing required-action list', state => { delete state.requiredActions; }],
  ['refusal', state => { state.output.refusal = 'Cannot comply'; }],
  ['refusal content part', state => { state.output.content = [{ type: 'refusal', refusal: 'Cannot comply' }]; }],
  ['empty final text', state => { state.output.content = ' \n'; }],
  ['reasoning-only output', state => { state.output.reasoningContent = 'private reasoning'; delete state.output.content; }],
  ['missing final output', state => { state.output = null; }],
  ['subagent final output', state => { state.output.threadId = 'subagent:1'; }],
  ['error state', state => { state.status = 'error'; }],
  ['cancelled state', state => { state.status = 'cancelled'; }],
  ['paused state', state => { state.status = 'paused'; state.actionRequiredOnEvents = []; }],
]) {
  test(`${name} cannot qualify a finding call`, async () => {
    const state = done(); change(state);
    const f = fixture({ state });
    const result = await runTrueForgeTurn(f.args);
    assert.equal(result.complete, false);
    assert.deepEqual(f.sdkCalls.map(item => item.method), ['create', 'createTurn', 'listTurnEvents']);
  });
}

test('events cannot substitute text for a missing final output', async () => {
  const state = done(); state.output = null;
  const f = fixture({ state });
  const result = await runTrueForgeTurn(f.args);
  assert.equal(result.complete, false);
  assert.equal(result.text, '');
  assert.equal(result.raw.events[0].content, '{"findings":[]}');
});

test('text content parts concatenate exactly, and undefined SDK optional fields do not fabricate content', async () => {
  const f = fixture();
  f.client.sessions.createTurn = async () => ({ data: turn({ ...done(), output: { ...output(),
    content: [{ type: 'text', text: '{"findings":' }, { type: 'text', text: '[]}' }], refusal: undefined } }) });
  const result = await runTrueForgeTurn(f.args);
  assert.equal(result.complete, true);
  assert.equal(result.text, '{"findings":[]}');
  assert.equal(Object.hasOwn(result.raw.turns[0].state.output, 'refusal'), false);
});

test('intermediate tool use, actions or subagent model output disqualify an otherwise clean final message', async () => {
  for (const event of [
    { id: 'tool:1', type: 'tool.response', threadId: 'main', content: 'result' },
    { ...output(), id: 'message:0', toolCalls: [{ id: 'call:tool', name: 'read_file' }] },
    { id: 'action:1', type: 'mcp.auth_required', threadId: 'main' },
    { ...output(), id: 'sub:1', threadId: 'subagent:1', content: 'OTHER THREAD TEXT' },
  ]) {
    const f = fixture({ pages: [{ data: [event, output()], pagination: { limit: 100 } }] });
    const result = await runTrueForgeTurn(f.args);
    assert.equal(result.complete, false);
    assert.equal(result.text, '{"findings":[]}');
    assert.equal(result.raw.events.length, 2);
  }
});

test('a subagent final message stays private raw evidence and cannot supply the normalized root reply', async () => {
  const state = done(); state.output.threadId = 'subagent:1'; state.output.content = 'SUBAGENT ONLY';
  const result = await runTrueForgeTurn(fixture({ state }).args);
  assert.equal(result.complete, false);
  assert.equal(result.text, '');
  assert.equal(result.raw.turns[0].state.output.content, 'SUBAGENT ONLY');
});

test('multiple model messages within one turn cannot masquerade as one complete finding call', async () => {
  const f = fixture({ pages: [{ data: [{ ...output(), id: 'message:0' }, output()], pagination: { limit: 100 } }] });
  const result = await runTrueForgeTurn(f.args);
  assert.equal(result.complete, false);
  assert.equal(result.raw.events.length, 2);
});

test('provider metrics remain estimates and missing/invalid cost remains unknown, including failed turns', async () => {
  for (const [value, expected] of [[0, 0], [0.013, 0.013], [undefined, null], [-1, null], ['0.013', null]]) {
    const state = done();
    if (value === undefined) delete state.metrics.totalCostInUsd;
    else state.metrics.totalCostInUsd = value;
    const result = await runTrueForgeTurn(fixture({ state }).args);
    assert.equal(result.estimatedCostUsd, expected);
    assert.equal(Object.hasOwn(result, 'settledCostUsd'), false);
  }
  const state = done(); state.status = 'error'; state.metrics.totalCostInUsd = 0.019;
  const result = await runTrueForgeTurn(fixture({ state }).args);
  assert.equal(result.complete, false);
  assert.equal(result.estimatedCostUsd, 0.019);
});

test('returned session/turn ownership and root-turn linkage are mandatory', async () => {
  for (const alter of [
    value => { value.sessionId = 'other-session'; },
    value => { value.previousTurnId = 'previous-turn'; },
    value => { delete value.previousTurnId; },
    value => { value.id = ''; },
  ]) {
    const f = fixture();
    f.client.sessions.createTurn = async () => { const value = turn(done()); alter(value); return { data: value }; };
    await assert.rejects(runTrueForgeTurn(f.args), /TRUEFORGE_TURN_IDENTITY_INVALID/);
    assert.equal(f.stages.at(-1).stage, 'failure');
    assert.equal(f.stages.some(item => item.stage === 'final'), false);
  }
  const f = fixture({ state: { status: 'running' } });
  f.client.sessions.getTurn = async () => ({ data: { ...turn(done()), id: 'another-turn' } });
  await assert.rejects(runTrueForgeTurn(f.args), /TRUEFORGE_TURN_IDENTITY_INVALID/);
  assert.equal(f.stages.at(-1).payload.turnId, 'turn:1');
});

test('repeated event cursors fail closed without rewriting prior receipts or repeating POSTs', async () => {
  const f = fixture({ pages: [
    { data: [output()], pagination: { limit: 100, nextPageToken: 'same' } },
    { data: [], pagination: { limit: 100, nextPageToken: 'same' } },
  ] });
  await assert.rejects(runTrueForgeTurn(f.args), /TRUEFORGE_EVENT_CURSOR_INVALID/);
  assert.deepEqual(f.stages.map(item => item.stage), ['session', 'turn', 'failure']);
  assert.equal(f.sdkCalls.filter(item => item.method === 'createTurn').length, 1);
});

test('failure-archive rejection is not retried and cannot produce a success result', async () => {
  const f = fixture();
  let writes = 0;
  f.client.sessions.create = async () => { throw new Error('dispatch unknown'); };
  f.archive.recordCall = async () => { writes++; throw new Error('archive unavailable'); };
  const error = await runTrueForgeTurn(f.args).then(() => null, value => value);
  assert.equal(error.code, 'TRUEFORGE_CALL_UNRESOLVED');
  assert.equal(error.failureRecorded, false);
  assert.equal(writes, 1);
});
