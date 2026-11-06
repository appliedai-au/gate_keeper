import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProviderCall } from '../scripts/learning-v2/authority-provider.mjs';
import { TURN_CONFIG } from '../scripts/learning-v2/trueforge-turn.mjs';

// REMOTE QUALIFICATION SOURCE ONLY. These are synthetic, read-only SDK artifacts;
// no model request, production session, signing identity or live receipt is used.
const SESSION_ID = 'session-TEST-ONLY-pagination';
const TURN_ID = 'turn-TEST-ONLY-owned';

function paginate(label, chunks) {
  return chunks.map((data, index) => ({ data,
    pagination: index + 1 < chunks.length ? { nextPageToken: `${label}-page-${index + 1}` } : {} }));
}

function fixture() {
  const model = { name: 'TEST-ONLY/pagination-model', params: { maxTokens: 100, temperature: 0 } };
  const entry = { callId: 'call-TEST-ONLY-pagination', sessionId: SESSION_ID, turnId: TURN_ID,
    inputDigest: 'a'.repeat(64), createdBySubject: 'TEST-ONLY-authority',
    sessionRequest: {
      agent: { spec: { model, instructions: 'TEST-ONLY frozen review instructions',
        config: structuredClone(TURN_CONFIG) } },
      metadata: { purpose: 'TEST-ONLY-pagination', callId: 'call-TEST-ONLY-pagination' },
    },
    turnRequest: { input: [{ type: 'user.message', content: 'TEST-ONLY review input' }], previousTurnId: 'none' },
  };
  const session = { id: SESSION_ID, shared: false, createdBySubject: entry.createdBySubject,
    metadata: structuredClone(entry.sessionRequest.metadata),
    agent: { type: 'inline', spec: structuredClone(entry.sessionRequest.agent.spec) } };
  const output = { type: 'model.message', id: 'message-TEST-ONLY-owned', threadId: 'main',
    model: structuredClone(model), content: '{"findings":[]}', finishReason: 'stop', toolCalls: [] };
  const turn = { id: TURN_ID, sessionId: SESSION_ID, previousTurnId: null,
    input: structuredClone(entry.turnRequest.input),
    state: { status: 'done', output: structuredClone(output), requiredActions: [] } };
  const initial = { type: output.type, id: output.id, threadId: output.threadId,
    model: structuredClone(model) };
  const pages = { turns: paginate('turns', [[{ id: TURN_ID }]]),
    events: paginate('events', [[initial], [structuredClone(output)]]) };
  const reads = { turns: [], events: [], getTurn: 0 };

  function readPage(label, request) {
    const maximum = label === 'turns' ? 25 : 100;
    // Model the observed 0.182 listTurns server rejection, rather than accepting
    // an arbitrary SDK request and only checking its limit after successful I/O.
    if (!Number.isInteger(request.limit) || request.limit < 1 || request.limit > maximum) {
      const error = new Error(`TEST-ONLY HTTP 400: ${label} limit exceeds ${maximum}`);
      error.statusCode = 400;
      throw error;
    }
    const index = reads[label].length;
    reads[label].push(structuredClone(request));
    assert.deepEqual(request, { order: 'asc', limit: maximum,
      ...(index ? { pageToken: `${label}-page-${index}` } : {}) });
    assert.ok(index < pages[label].length, 'unexpected extra fixture page read');
    return { response: structuredClone(pages[label][index]) };
  }

  const provider = { sessions: {
    async get(sessionId) { assert.equal(sessionId, SESSION_ID); return { data: structuredClone(session) }; },
    async getTurn(sessionId, turnId) {
      assert.equal(sessionId, SESSION_ID); assert.equal(turnId, TURN_ID);
      reads.getTurn++;
      return { data: structuredClone(turn) };
    },
    async listTurns(sessionId, request) {
      assert.equal(sessionId, SESSION_ID);
      return readPage('turns', request);
    },
    async listTurnEvents(sessionId, turnId, request) {
      assert.equal(sessionId, SESSION_ID); assert.equal(turnId, TURN_ID);
      return readPage('events', request);
    },
  } };
  return { provider, entry, pages, reads, turn, output };
}

test('provider verification honors the strict 25-turn server limit and retains 100-event pages', async () => {
  const f = fixture();
  const result = await inspectProviderCall(f.provider, f.entry, { requireComplete: true });
  assert.equal(result.complete, true);
  assert.equal(result.text, '{"findings":[]}');
  assert.equal(result.observedModelCalls, 1, 'initial/final events with one ID describe one model step');
  assert.equal(result.actualMicros, null, 'verification does not invent a billed charge');
  assert.deepEqual(f.reads.turns, [{ order: 'asc', limit: 25 }]);
  assert.deepEqual(f.reads.events, [{ order: 'asc', limit: 100 },
    { order: 'asc', limit: 100, pageToken: 'events-page-1' }]);
  assert.deepEqual(result.artifact.turnPages, f.pages.turns);
  assert.deepEqual(result.artifact.eventPages, f.pages.events);
  assert.equal(f.reads.getTurn, 2, 'the completed turn is read again after all event pages');
});

test('an unowned additional turn on a later page is rejected before reading turn output or events', async () => {
  const f = fixture();
  f.pages.turns = paginate('turns', [[{ id: TURN_ID }], [{ id: 'turn-TEST-ONLY-unowned' }]]);
  await assert.rejects(inspectProviderCall(f.provider, f.entry, { requireComplete: true }),
    /session contains additional or unowned turns/);
  assert.deepEqual(f.reads.turns, [{ order: 'asc', limit: 25 },
    { order: 'asc', limit: 25, pageToken: 'turns-page-1' }]);
  assert.equal(f.reads.getTurn, 0);
  assert.equal(f.reads.events.length, 0);
});

test('event pagination still uses 100 and detects additional inference on a later page', async () => {
  const f = fixture();
  f.pages.events[1].data.push({ ...structuredClone(f.output), id: 'message-TEST-ONLY-unowned' });
  await assert.rejects(inspectProviderCall(f.provider, f.entry, { requireComplete: true }),
    /unexpected additional provider inference/);
  assert.deepEqual(f.reads.events, [{ order: 'asc', limit: 100 },
    { order: 'asc', limit: 100, pageToken: 'events-page-1' }]);
});

for (const label of ['turns', 'events']) test(`${label} pagination still rejects a repeated cursor`, async () => {
  const f = fixture();
  const data = label === 'turns' ? [{ id: TURN_ID }] : [structuredClone(f.output)];
  f.pages[label] = paginate(label, [data, []]);
  f.pages[label][1].pagination.nextPageToken = `${label}-page-1`;
  await assert.rejects(inspectProviderCall(f.provider, f.entry, { requireComplete: true }),
    new RegExp(`${label} repeated or invalid cursor`));
  assert.equal(f.reads[label].length, 2, 'a repeated cursor cannot trigger a third request');
});

test('turn pagination refuses an invalid continuation rather than accepting the visible owned turn', async () => {
  const f = fixture();
  f.pages.turns[0].pagination.nextPageToken = '';
  await assert.rejects(inspectProviderCall(f.provider, f.entry, { requireComplete: true }),
    /turns repeated or invalid cursor/);
  assert.equal(f.reads.turns.length, 1);
  assert.equal(f.reads.getTurn, 0);
});

test('the sole owned turn must still be a root turn before its output can qualify', async () => {
  const f = fixture();
  f.turn.previousTurnId = 'turn-TEST-ONLY-previous';
  await assert.rejects(inspectProviderCall(f.provider, f.entry, { requireComplete: true }),
    /provider execution remains unresolved/);
  assert.equal(f.reads.getTurn, 1);
  assert.equal(f.reads.events.length, 0);
});
