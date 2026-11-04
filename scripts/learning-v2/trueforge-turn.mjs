/**
 * One already-admitted finding call through an injected TrueForge SDK client.
 *
 * API provenance: truefoundry/trueforge tags v0.180.0 (b27acd9b06fcc8ea0765cd09188f9735da1c633c)
 * and v0.182.0 (842e4992b8ed6d34c13b1b208d52f295ba9f3b8b), packages/trueforge-sdk/src/
 * api/resources/sessions/client/Client.ts, api/types/Turn*.ts and core/pagination/Page.ts.
 * This file configures no provider, imports no executable runner, retries no request,
 * issues no signature, and converts no estimated metric into a billing settlement.
 * The runtime configuration below is an explicit change from the legacy runner
 * and requires new controls. One main-loop step is not provider-billing proof:
 * the pinned server still exposes its unconditional currentDateTime local tool,
 * which can execute after that step. Independent managed-runtime and gateway
 * enforcement must bound actual inference and cumulative programme spend.
 * The host must pin the runtime/provider, supply a durable create-once archive, and
 * obtain independent verification of these private observations before qualification.
 */
import { createHash } from 'node:crypto';
import { canonical, copy, digest, hash, identifier, integer, record, requireThat, text } from './contracts.mjs';

const CALL_FIELDS = ['callId', 'operationId', 'leaseId', 'requestDigest', 'sourceCommit',
  'runtimeDigest', 'model', 'instructions', 'message'];
const PARAMS = new Set(['maxTokens', 'temperature', 'topP', 'topK', 'reasoningEffort', 'parallelToolCalls']);
export const TURN_CONFIG = Object.freeze({
  askUserQuestions: Object.freeze({ enabled: false }),
  generativeUi: Object.freeze({ enabled: false }),
  dynamicSubAgents: Object.freeze({ enabled: false }),
  webSearch: Object.freeze({ enabled: false }),
  sandbox: Object.freeze({ enabled: false }),
  contextManagement: Object.freeze({
    compaction: Object.freeze({ enabled: false }),
    largeToolResponse: Object.freeze({ enabled: false }),
  }),
  iterationLimit: 1,
});
const MAX_POLLS = 1000;
const MAX_EVENT_PAGES = 100;
const MAX_EVENTS = 10_000;
const ACTION_TYPES = new Set(['tool.approval_required', 'tool.response_required', 'mcp.auth_required']);

class TurnFailure extends Error {
  constructor(code) { super(code); this.name = 'TrueForgeTurnFailure'; this.code = code; }
}

function callInput(value) {
  record(value, CALL_FIELDS, 'TrueForge call');
  canonical(value);
  const call = copy(value);
  for (const key of ['callId', 'operationId', 'leaseId']) identifier(call[key], key);
  for (const key of ['requestDigest', 'runtimeDigest']) hash(call[key], key);
  hash(call.sourceCommit, 'sourceCommit', 40);
  text(call.instructions, 'instructions', 100_000);
  text(call.message, 'message', 1_000_000);
  record(call.model, ['name', 'params'], 'model');
  text(call.model.name, 'model name', 200);
  requireThat(call.model.params && typeof call.model.params === 'object' && !Array.isArray(call.model.params), 'model params');
  requireThat(Object.keys(call.model.params).every(key => PARAMS.has(key)), 'unsupported model parameter');
  integer(call.model.params.maxTokens, 'maxTokens', 1, 1_000_000);
  for (const key of ['temperature', 'topP']) if (Object.hasOwn(call.model.params, key)) {
    const value = call.model.params[key];
    requireThat(typeof value === 'number' && Number.isFinite(value) && value >= 0 &&
      value <= (key === 'temperature' ? 2 : 1), `invalid ${key}`);
  }
  if (Object.hasOwn(call.model.params, 'topK')) integer(call.model.params.topK, 'topK', 1, 1_000_000);
  if (Object.hasOwn(call.model.params, 'reasoningEffort')) text(call.model.params.reasoningEffort, 'reasoningEffort', 80);
  if (Object.hasOwn(call.model.params, 'parallelToolCalls')) {
    requireThat(call.model.params.parallelToolCalls === false, 'parallel tool calls forbidden');
  }
  return call;
}

function modelVisibleInput(call) {
  return { model: copy(call.model), instructions: call.instructions, config: copy(TURN_CONFIG),
    messages: [{ type: 'user.message', content: call.message }], previousTurnId: 'none' };
}

/** Pure identity for a planned call; no archive access or SDK construction. */
export const turnInputDigest = call => digest(modelVisibleInput(callInput(call)));

// SDK serializers can retain undefined optional fields. Omit only those object
// properties; reject accessors/exotic values rather than running JSON hooks. HTTP
// response wrappers, headers, request objects, and SDK error objects never enter this.
function received(value, ancestors = new Set(), depth = 0) {
  if (depth > 64) throw new TurnFailure('TRUEFORGE_RESPONSE_INVALID');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || ancestors.has(value) ||
      Object.getOwnPropertySymbols(value).length) throw new TurnFailure('TRUEFORGE_RESPONSE_INVALID');
  const array = Array.isArray(value);
  if ((array && Object.getPrototypeOf(value) !== Array.prototype) || (!array &&
      ![Object.prototype, null].includes(Object.getPrototypeOf(value)))) throw new TurnFailure('TRUEFORGE_RESPONSE_INVALID');
  const result = array ? [] : Object.create(null);
  ancestors.add(value);
  const keys = Object.getOwnPropertyNames(value);
  if (array && keys.length !== value.length + 1) throw new TurnFailure('TRUEFORGE_RESPONSE_INVALID');
  if (array && !Array.from({ length: value.length }, (_, index) => Object.hasOwn(value, index)).every(Boolean)) {
    throw new TurnFailure('TRUEFORGE_RESPONSE_INVALID');
  }
  for (const key of keys) {
    if (array && key === 'length') continue;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor.enumerable || !Object.hasOwn(descriptor, 'value') ||
        ['__proto__', 'constructor', 'prototype'].includes(key)) throw new TurnFailure('TRUEFORGE_RESPONSE_INVALID');
    if (descriptor.value === undefined && !array) continue;
    result[key] = received(descriptor.value, ancestors, depth + 1);
  }
  ancestors.delete(value);
  return result;
}

function responseId(value) {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(value);
}

function checkTurn(turn, sessionId, turnId = null) {
  if (!turn || !responseId(turn.id) || turn.sessionId !== sessionId ||
      turn.previousTurnId !== null || (turnId !== null && turn.id !== turnId) ||
      !['running', 'paused', 'done', 'error', 'cancelled'].includes(turn.state?.status)) {
    throw new TurnFailure('TRUEFORGE_TURN_IDENTITY_INVALID');
  }
}

function finalObservation(call, inputDigest, sessionId, turnId, raw) {
  const turn = raw.turns.at(-1);
  const state = turn.state;
  const output = state.output ?? null;
  const rootOutput = output?.type === 'model.message' && output.threadId === 'main' && responseId(output.id);
  let valid = state.status === 'done' && rootOutput;
  let content = '';
  let refusal = false;
  if (rootOutput && typeof output.content === 'string') content = output.content;
  else if (rootOutput && Array.isArray(output.content)) {
    for (const part of output.content) {
      if (part?.type === 'text' && typeof part.text === 'string') content += part.text;
      else { valid = false; if (part?.type === 'refusal') refusal = true; }
    }
  } else valid = false;
  const toolCalls = [];
  const requiredActions = [];
  const gather = (target, values, optional = true) => {
    if (values === undefined && optional) return;
    if (!Array.isArray(values)) { valid = false; return; }
    target.push(...values);
  };
  gather(toolCalls, output?.toolCalls);
  gather(requiredActions, state.requiredActions, state.status !== 'done');
  if (state.status === 'paused') gather(requiredActions, state.actionRequiredOnEvents, false);
  const messages = [...raw.events, ...(output ? [output] : [])];
  const modelMessageIds = new Set();
  for (const event of messages) {
    if (event?.type === 'model.message' || event?.type === 'model.message.delta') {
      if (event !== output) gather(toolCalls, event.toolCalls);
      if (event.threadId !== 'main') valid = false;
      if (event.type === 'model.message') {
        if (!responseId(event.id)) valid = false;
        else modelMessageIds.add(event.id);
      }
      if (event.refusal !== undefined && event.refusal !== null && event.refusal !== '') refusal = true;
      if (Array.isArray(event.content) && event.content.some(part => part?.type === 'refusal')) refusal = true;
    }
    if (ACTION_TYPES.has(event?.type)) requiredActions.push(event);
    // An intermediate tool use is disqualifying even if the final message has none.
    if (/^(tool\.|mcp\.|sandbox\.)/u.test(event?.type ?? '')) valid = false;
  }
  // This adapter admits one finding call, not additional model iterations hidden
  // inside the same turn. These event IDs are observations, never billing proof.
  if (modelMessageIds.size !== 1) valid = false;
  const finishReason = typeof output?.finishReason === 'string' ? output.finishReason : null;
  const observedCost = state.metrics?.totalCostInUsd;
  const estimatedCostUsd = typeof observedCost === 'number' && Number.isFinite(observedCost) && observedCost >= 0
    ? observedCost : null;
  return {
    callId: call.callId, sessionId, turnId, inputDigest,
    outputDigest: createHash('sha256').update(content, 'utf8').digest('hex'),
    text: content,
    complete: !!(valid && raw.eventsComplete && raw.outcome === 'terminal' && finishReason === 'stop' &&
      content.trim() && !refusal && toolCalls.length === 0 && requiredActions.length === 0),
    finishReason, toolCalls, requiredActions, raw, estimatedCostUsd,
  };
}

/**
 * archive.claimCall(call) must durably create a unique call intent before returning.
 * archive.recordCall(callId, stage, payload) must publish each immutable stage once.
 * A throw after dispatch leaves the programme reservation unresolved. The caller
 * must reconcile the recorded IDs; it must never retry this call under another ID.
 */
export async function runTrueForgeTurn({ client, call: value, archive, clock = () => Date.now(),
  pause = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds)),
  timeoutMs = 600_000, pollIntervalMs = 1500 } = {}) {
  const call = callInput(value);
  requireThat(['create', 'createTurn', 'getTurn', 'listTurnEvents'].every(key =>
    typeof client?.sessions?.[key] === 'function'), 'TrueForge client methods');
  requireThat(typeof archive?.claimCall === 'function' && typeof archive?.recordCall === 'function', 'durable call archive');
  requireThat(typeof clock === 'function' && typeof pause === 'function', 'clock and pause');
  integer(timeoutMs, 'timeoutMs', 1, 900_000);
  integer(pollIntervalMs, 'pollIntervalMs', 1, 60_000);
  const input = modelVisibleInput(call);
  const inputDigest = digest(input);
  try { await archive.claimCall(copy(call)); }
  catch { throw new TurnFailure('TRUEFORGE_CALL_CLAIM_FAILED'); }

  let sessionId = null, turnId = null, stage = 'clock';
  const raw = { input, session: null, turns: [], eventPages: [], events: [], eventsComplete: false, outcome: 'unresolved' };
  try {
    const start = clock();
    if (!Number.isSafeInteger(start) || start < 0 || start > Number.MAX_SAFE_INTEGER - timeoutMs) {
      throw new TurnFailure('TRUEFORGE_CLOCK_INVALID');
    }
    const deadline = start + timeoutMs;
    let previousTime = start;
    const remaining = () => {
      const now = clock();
      if (!Number.isSafeInteger(now) || now < previousTime) throw new TurnFailure('TRUEFORGE_CLOCK_INVALID');
      previousTime = now;
      return deadline - now;
    };
    const invoke = async execute => {
      const milliseconds = remaining();
      if (milliseconds <= 0) throw new TurnFailure('TRUEFORGE_DEADLINE_EXCEEDED');
      const abort = new AbortController();
      let timer;
      const timeout = new Promise((_, reject) => {
        timer = setTimeout(() => { abort.abort(); reject(new TurnFailure('TRUEFORGE_DEADLINE_EXCEEDED')); }, milliseconds);
      });
      try {
        return await Promise.race([Promise.resolve().then(() => execute({ maxRetries: 0,
          timeoutInSeconds: milliseconds / 1000, abortSignal: abort.signal })), timeout]);
      } finally { clearTimeout(timer); }
    };
    const sessionRequest = { agent: { spec: { model: copy(input.model), instructions: input.instructions,
      config: copy(input.config) } }, metadata: { purpose: 'gk-learning-v2', callId: call.callId,
      operationId: call.operationId, requestDigest: call.requestDigest } };
    stage = 'session-request';
    raw.session = received((await invoke(options => client.sessions.create(sessionRequest, options))).data);
    if (!responseId(raw.session?.id)) throw new TurnFailure('TRUEFORGE_SESSION_IDENTITY_INVALID');
    sessionId = raw.session.id;
    stage = 'session-archive';
    await archive.recordCall(call.callId, 'session', copy({ inputDigest, sessionId, request: sessionRequest, response: raw.session }));

    const turnRequest = { input: copy(input.messages), previousTurnId: 'none' };
    stage = 'turn-request';
    raw.turns.push(received((await invoke(options => client.sessions.createTurn(sessionId, turnRequest, options))).data));
    checkTurn(raw.turns.at(-1), sessionId);
    turnId = raw.turns.at(-1).id;
    stage = 'turn-archive';
    await archive.recordCall(call.callId, 'turn', copy({ inputDigest, sessionId, turnId, request: turnRequest, response: raw.turns[0] }));

    let polls = 0;
    while (raw.turns.at(-1).state.status === 'running') {
      const wait = remaining();
      if (wait <= 0 || polls >= MAX_POLLS) break;
      stage = 'poll-wait';
      await pause(Math.min(pollIntervalMs, wait));
      if (remaining() <= 0) break;
      stage = 'turn-read';
      raw.turns.push(received((await invoke(options => client.sessions.getTurn(sessionId, turnId, options))).data));
      checkTurn(raw.turns.at(-1), sessionId, turnId);
      polls++;
    }
    raw.outcome = raw.turns.at(-1).state.status === 'running'
      ? (polls >= MAX_POLLS ? 'poll-limit' : 'deadline-exceeded') : 'terminal';
    if (raw.outcome === 'terminal') {
      const seen = new Set();
      let pageToken;
      for (let count = 0; count < MAX_EVENT_PAGES; count++) {
        stage = 'events-read';
        const request = { order: 'asc', limit: 100, ...(pageToken ? { pageToken } : {}) };
        const page = await invoke(options => client.sessions.listTurnEvents(sessionId, turnId, request, options));
        // SDK Page.rawResponse contains transport data and must not be archived.
        const response = received(page.response);
        raw.eventPages.push(response);
        if (!Array.isArray(response?.data) || !response.pagination ||
            response.data.some(event => !event || typeof event.type !== 'string')) {
          throw new TurnFailure('TRUEFORGE_EVENTS_INVALID');
        }
        raw.events.push(...response.data);
        if (raw.events.length > MAX_EVENTS) throw new TurnFailure('TRUEFORGE_EVENT_LIMIT');
        const next = response.pagination.nextPageToken;
        if (next === undefined) { raw.eventsComplete = true; break; }
        if (typeof next !== 'string' || !next || next.length > 4096 || seen.has(next)) {
          throw new TurnFailure('TRUEFORGE_EVENT_CURSOR_INVALID');
        }
        seen.add(next);
        pageToken = next;
      }
    }
    const result = finalObservation(call, inputDigest, sessionId, turnId, raw);
    stage = 'final-archive';
    await archive.recordCall(call.callId, 'final', copy(result));
    return copy(result);
  } catch (error) {
    const code = error instanceof TurnFailure ? error.code : 'TRUEFORGE_CALL_UNRESOLVED';
    const failure = { code, name: error instanceof TypeError ? 'TypeError' : 'Error', stage,
      callId: call.callId, operationId: call.operationId, inputDigest, sessionId, turnId, raw };
    let failureRecorded = false;
    try { await archive.recordCall(call.callId, 'failure', copy(failure)); failureRecorded = true; }
    catch { /* An ambiguous archive write is never retried or overwritten. */ }
    const rejected = new TurnFailure(code);
    rejected.failureRecorded = failureRecorded;
    throw rejected;
  }
}
