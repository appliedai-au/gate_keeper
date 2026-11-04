/**
 * Private, append-only observations for one already-admitted operation.
 *
 * The host supplies a dedicated FileJournal outside the repository; that journal
 * owns private-path checks, publication durability, locking and byte integrity.
 * MemoryJournal implements the same CAS contract for managed-gate tests only.
 * This archive grants no provider/budget authority and performs no SDK, network,
 * signing, recovery, lock reset or automatic retry. A recorded intent permanently
 * consumes its call slot even when dispatch or observation is incomplete.
 *
 * Payloads are strict JSON data, bounded by the journal's per-record ceiling.
 * Their contents are observations, never instructions or verified attestations.
 * Canonical JSON preserves values, not the original wire serialization: retain
 * byte-sensitive signed receipts as their original serialized string as well.
 */
import { canonical, copy, digest, hash, identifier, integer, record, requireThat, text } from './contracts.mjs';

const SCHEMA = 'gk-learning-v2-operation-archive-v1';
const MAX_EVENT_BYTES = 32 * 1024 * 1024 - 1024;
const OPERATION_FIELDS = ['id', 'kind', 'attemptId', 'namespace', 'requestDigest',
  'leaseId', 'maxCalls', 'reservationMicros', 'settled', 'consumed', 'observedFreshCalls', 'evidenceComplete'];
const CALL_FIELDS = ['callId', 'operationId', 'leaseId', 'requestDigest', 'sourceCommit',
  'runtimeDigest', 'model', 'instructions', 'message'];
const STAGES = ['session', 'turn', 'final'];
const KINDS = new Set(['baseline', 'proposal', 'screen', 'confirmation']);

function plain(value, name) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${name}: expected object`);
}

function boundedEvent(value) {
  const bytes = canonical(value); // Validate descriptors before any payload property reads.
  requireThat(Buffer.byteLength(bytes, 'utf8') <= MAX_EVENT_BYTES, 'archive event exceeds journal size limit');
  return JSON.parse(bytes);
}

function operationInput(operation, request) {
  record(operation, OPERATION_FIELDS, 'archive operation');
  plain(request, 'archive request');
  requireThat(request.schema === 'gk-learning-v2-execution-request', 'archive request schema');
  identifier(operation.id, 'operation id');
  identifier(operation.leaseId, 'lease id');
  identifier(operation.namespace, 'operation namespace');
  hash(operation.requestDigest, 'operation request digest');
  hash(request.sourceCommit, 'request source commit', 40);
  hash(request.runtimeDigest, 'request runtime digest');
  text(request.model, 'request model', 200);
  requireThat(request.provider === 'truefoundry' && request.memory === 'off', 'archive provider/memory binding');
  requireThat(KINDS.has(operation.kind) && operation.kind === request.kind, 'archive operation kind');
  requireThat(operation.attemptId === request.attemptId && operation.namespace === request.namespace,
    'archive operation plan binding');
  if (operation.kind === 'baseline') requireThat(operation.attemptId === null, 'baseline attempt binding');
  else identifier(operation.attemptId, 'operation attempt id');
  integer(request.requiredCalls, 'request required calls', 1, 1_000_000);
  integer(operation.maxCalls, 'operation maximum calls', 1, 1_000_000);
  requireThat(operation.maxCalls === request.requiredCalls, 'archive exact call count binding');
  integer(operation.reservationMicros, 'operation reservation', 1, 20_000_000);
  requireThat(operation.settled === false && operation.consumed === false &&
    operation.observedFreshCalls === 0 && operation.evidenceComplete === false, 'archive operation is not fresh');
  requireThat(operation.requestDigest === digest(request), 'archive request digest mismatch');
}

function callInput(call, state) {
  record(call, CALL_FIELDS, 'archive call');
  for (const key of ['callId', 'operationId', 'leaseId']) identifier(call[key], key);
  for (const key of ['requestDigest', 'runtimeDigest']) hash(call[key], key);
  hash(call.sourceCommit, 'call source commit', 40);
  text(call.instructions, 'call instructions', 100_000);
  text(call.message, 'call message', 1_000_000);
  record(call.model, ['name', 'params'], 'call model');
  text(call.model.name, 'call model name', 200);
  plain(call.model.params, 'call model params');
  requireThat(call.operationId === state.operation.id && call.leaseId === state.operation.leaseId &&
    call.requestDigest === state.operation.requestDigest && call.sourceCommit === state.request.sourceCommit &&
    call.runtimeDigest === state.request.runtimeDigest && call.model.name === state.request.model,
  'archive call identity mismatch');
  // The host verifies params against the pinned runtime manifest before admission.
  // Its opaque digest alone cannot prove that preimage here. Freeze the first
  // complete model object so later calls cannot silently change their settings.
  if (state.calls.length) requireThat(canonical(call.model) === canonical(state.calls[0].call.model),
    'archive model parameters changed');
}

function responseId(value, name) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(value),
    `${name}: invalid response identifier`);
}

/** Optional observation identities become immutable as soon as recorded. */
function observation(payload, entry, stage) {
  plain(payload, 'archive call payload');
  for (const key of ['callId', 'operationId', 'leaseId', 'requestDigest', 'sourceCommit', 'runtimeDigest']) {
    if (Object.hasOwn(payload, key)) requireThat(payload[key] === entry.call[key], `archive observation ${key} mismatch`);
  }
  for (const key of ['inputDigest', 'sessionId', 'turnId']) {
    const prior = entry.stages.find(item => Object.hasOwn(item.payload, key) && item.payload[key] !== null);
    const present = Object.hasOwn(payload, key);
    if (prior) requireThat(present && payload[key] === prior.payload[key], `archive observation ${key} changed or missing`);
    if (!present) continue;
    if (stage === 'failure' && payload[key] === null && key !== 'inputDigest') continue;
    if (key === 'inputDigest') hash(payload[key], 'observation input digest');
    else responseId(payload[key], `observation ${key}`);
  }
}

function apply(state, event) {
  plain(event, 'archive event');
  requireThat(event.schema === SCHEMA, 'unknown archive record schema');
  if (event.type === 'operation-claimed') {
    record(event, ['schema', 'type', 'operation', 'request'], 'operation claim record');
    requireThat(state.operation === null, 'archive operation already claimed; reopen/retry forbidden');
    operationInput(event.operation, event.request);
    state.operation = event.operation;
    state.request = event.request;
    return;
  }
  requireThat(state.operation !== null, 'archive operation claim required');
  if (event.type === 'call-claimed') {
    record(event, ['schema', 'type', 'call'], 'call claim record');
    callInput(event.call, state);
    requireThat(!state.calls.some(entry => entry.call.callId === event.call.callId), 'archive call already claimed; retry forbidden');
    requireThat(state.calls.length < state.operation.maxCalls, 'archive call count exhausted');
    state.calls.push({ call: event.call, stages: [] });
    return;
  }
  if (event.type === 'call-recorded') {
    record(event, ['schema', 'type', 'callId', 'stage', 'payload'], 'call observation record');
    identifier(event.callId, 'recorded call id');
    requireThat(STAGES.includes(event.stage) || event.stage === 'failure', 'unknown archive call stage');
    const entry = state.calls.find(item => item.call.callId === event.callId);
    requireThat(entry, 'archive call intent required');
    const previous = entry.stages.at(-1)?.stage;
    requireThat(previous !== 'final' && previous !== 'failure', 'archive call is terminal');
    requireThat(event.stage === 'failure' || event.stage === STAGES[entry.stages.length],
      'archive call stage out of order or already recorded');
    observation(event.payload, entry, event.stage);
    entry.stages.push({ stage: event.stage, payload: event.payload });
    return;
  }
  if (event.type === 'artifact-recorded') {
    record(event, ['schema', 'type', 'id', 'kind', 'payload'], 'artifact record');
    identifier(event.id, 'artifact id');
    identifier(event.kind, 'artifact kind');
    requireThat(!state.artifacts.some(item => item.id === event.id), 'archive artifact already recorded');
    // Artifacts may be any canonical JSON value, including original wire bytes
    // stored as a string. They are retained privately and are not attestations.
    state.artifacts.push({ id: event.id, kind: event.kind, payload: event.payload });
    return;
  }
  requireThat(false, 'unknown archive record type');
}

function replay(events) {
  const state = { operation: null, request: null, calls: [], artifacts: [] };
  for (const value of events) apply(state, boundedEvent(value));
  return state;
}

export class OperationArchive {
  #journal;

  constructor({ journal } = {}) {
    requireThat(typeof journal?.read === 'function' && typeof journal?.append === 'function', 'archive CAS journal required');
    this.#journal = journal;
  }

  async #snapshot() {
    const value = await this.#journal.read();
    record(value, ['head', 'events'], 'archive journal snapshot');
    // Snapshot shape is checked before dereferencing; event descriptors are
    // validated one at a time during replay, before any application fields read.
    requireThat(Array.isArray(value.events), 'archive journal event list');
    if (value.events.length) hash(value.head, 'archive journal head');
    else requireThat(value.head === null, 'archive empty journal head');
    return { head: value.head, state: replay(value.events) };
  }

  async #append(value) {
    // Freeze caller-owned values synchronously before the first await.
    const event = boundedEvent(value);
    const { head, state } = await this.#snapshot();
    apply(state, event);
    await this.#journal.append(head, event); // A stale/ambiguous write is never retried.
    return copy(state);
  }

  /** Copies only. Reading an incomplete archive never resumes its calls. */
  async read() {
    return copy((await this.#snapshot()).state);
  }

  /** An archive belongs to exactly one operation; even an identical reopen fails. */
  async claimOperation(operation, request) {
    return this.#append({ schema: SCHEMA, type: 'operation-claimed', operation, request });
  }

  /** Must succeed durably before a caller makes its first SDK mutation. */
  async claimCall(call) {
    return this.#append({ schema: SCHEMA, type: 'call-claimed', call });
  }

  /** session -> turn -> final, or one terminal failure at any pre-final point. */
  async recordCall(callId, stage, payload) {
    return this.#append({ schema: SCHEMA, type: 'call-recorded', callId, stage, payload });
  }

  /** Retains private raw observations; neither signs nor trusts their contents. */
  async recordArtifact(id, kind, payload) {
    return this.#append({ schema: SCHEMA, type: 'artifact-recorded', id, kind, payload });
  }
}
