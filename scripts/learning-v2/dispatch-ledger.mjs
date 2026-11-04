/**
 * Private dispatch intent and observation history for one experiment.
 *
 * Claim before asking the gateway to admit an operation. An interrupted claim,
 * admission or settlement stays pending; this ledger never dispatches, retries,
 * repairs a journal or interprets a missing response as non-admission.
 *
 * Receipt strings retain their original serialization. They are observations,
 * not authenticated authority: the managed host verifies the independent issuer
 * and exact context before supplying a settled/not-admitted resolution. Nothing
 * here parses an envelope, signs evidence, calls a provider or releases money.
 *
 * Supply a dedicated private FileJournal outside the repository. It provides
 * locking, CAS, durable publication and byte integrity. The create-once anchor
 * prevents an empty/missing store from silently becoming a fresh experiment on
 * read. External custody is still needed to detect whole-store rollback.
 */
import { canonical, copy, digest, hash, identifier, integer, record, requireThat, text } from './contracts.mjs';

const SCHEMA = 'gk-learning-v2-dispatch-ledger-v1';
const MAX_EVENT_BYTES = 32 * 1024 * 1024 - 1024;
const MAX_OBSERVATIONS = 32;
const MAX_SELECTIONS = 32;
const OPERATION_FIELDS = ['id', 'kind', 'attemptId', 'namespace', 'requestDigest'];
const KINDS = new Set(['baseline', 'proposal', 'screen', 'confirmation']);

function boundedEvent(value) {
  const bytes = canonical(value); // Inspect descriptors before reading caller data.
  requireThat(Buffer.byteLength(bytes, 'utf8') <= MAX_EVENT_BYTES, 'dispatch ledger event exceeds journal size limit');
  return JSON.parse(bytes);
}

function plain(value, name) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${name}: expected object`);
}

function claimInput(operation, request, state) {
  record(operation, OPERATION_FIELDS, 'dispatch operation');
  plain(request, 'dispatch request');
  identifier(operation.id, 'dispatch operation id');
  identifier(operation.namespace, 'dispatch namespace');
  hash(operation.requestDigest, 'dispatch request digest');
  requireThat(request.schema === 'gk-learning-v2-execution-request', 'dispatch request schema');
  requireThat(request.experimentId === state.experimentId && request.configDigest === state.configDigest,
    'dispatch experiment/configuration mismatch');
  hash(request.sourceCommit, 'dispatch source commit', 40);
  text(request.model, 'dispatch model', 200);
  requireThat(request.provider === 'truefoundry' && request.memory === 'off', 'dispatch provider/memory mismatch');
  requireThat(KINDS.has(operation.kind) && operation.kind === request.kind &&
    operation.attemptId === request.attemptId && operation.namespace === request.namespace,
  'dispatch operation/request context mismatch');
  if (operation.kind === 'baseline') requireThat(operation.attemptId === null, 'dispatch baseline attempt');
  else identifier(operation.attemptId, 'dispatch attempt id');
  integer(request.requiredCalls, 'dispatch required calls', 1, 1_000_000);
  requireThat(operation.requestDigest === digest(request), 'dispatch request digest mismatch');
  if (state.entries.length) {
    const original = state.entries[0].request;
    for (const key of ['sourceCommit', 'model', 'provider', 'memory']) {
      requireThat(request[key] === original[key], `dispatch ${key} changed within experiment`);
    }
  }
}

function pendingEntry(state, operationId) {
  identifier(operationId, 'dispatch operation id');
  const entry = state.entries.find(item => item.operation.id === operationId);
  requireThat(entry, 'dispatch intent required');
  requireThat(entry.resolution === null, 'dispatch operation is terminal');
  requireThat(state.pending === entry, 'dispatch pending operation mismatch');
  return entry;
}

function apply(state, event, identity) {
  plain(event, 'dispatch record');
  requireThat(event.schema === SCHEMA, 'unknown dispatch ledger schema');
  if (event.type === 'initialized') {
    record(event, ['schema', 'type', 'experimentId', 'configDigest'], 'dispatch anchor');
    requireThat(state === null, 'dispatch ledger already initialized');
    requireThat(event.experimentId === identity.experimentId && event.configDigest === identity.configDigest,
      'dispatch anchor identity mismatch');
    return { experimentId: event.experimentId, configDigest: event.configDigest, entries: [], pending: null };
  }
  requireThat(state !== null, 'dispatch ledger is uninitialized');
  if (event.type === 'claimed') {
    record(event, ['schema', 'type', 'operation', 'request'], 'dispatch claim record');
    claimInput(event.operation, event.request, state);
    requireThat(state.pending === null, 'dispatch operation pending; reconcile before new work');
    requireThat(!state.entries.some(entry => entry.operation.id === event.operation.id), 'dispatch operation id already claimed');
    requireThat(!state.entries.some(entry => entry.operation.kind === event.operation.kind &&
      entry.operation.attemptId === event.operation.attemptId), 'dispatch logical phase already claimed');
    const entry = { operation: event.operation, request: event.request, admission: null, settlement: null,
      notAdmitted: null, observations: [], selectionCount: 0, resolution: null };
    state.entries.push(entry);
    state.pending = entry;
    return state;
  }
  if (event.type === 'observed') {
    record(event, ['schema', 'type', 'operationId', 'kind', 'serializedEnvelope'], 'dispatch observation record');
    requireThat(['admission', 'settlement', 'not-admitted'].includes(event.kind), 'unknown dispatch observation kind');
    // The enclosing canonical event enforces the journal's byte ceiling. Do not
    // trim, parse, reserialize or treat this original string as a trusted body.
    requireThat(typeof event.serializedEnvelope === 'string' && event.serializedEnvelope.trim().length > 0,
      'dispatch receipt must be a nonempty serialized string');
    const entry = pendingEntry(state, event.operationId);
    requireThat(!entry.observations.some(item => item.kind === event.kind && item.serialized === event.serializedEnvelope),
      'dispatch observation already recorded');
    requireThat(entry.observations.length < MAX_OBSERVATIONS, 'dispatch observation limit reached');
    if (event.kind === 'settlement') {
      requireThat(entry.admission !== null, 'dispatch admission observation required before settlement');
    }
    // Recovery may supply a corrected or fresh receipt. Preserve every original
    // observation; these selected-value projections grant no admission/settlement
    // authority and never clear pending work or start another gateway request.
    entry.observations.push({ kind: event.kind, serialized: event.serializedEnvelope });
    entry[event.kind === 'not-admitted' ? 'notAdmitted' : event.kind] = event.serializedEnvelope;
    return state;
  }
  if (event.type === 'selected') {
    record(event, ['schema', 'type', 'operationId', 'kind', 'observationIndex'], 'dispatch selection record');
    requireThat(['admission', 'settlement', 'not-admitted'].includes(event.kind), 'unknown dispatch selection kind');
    integer(event.observationIndex, 'dispatch observation index', 0, MAX_OBSERVATIONS - 1);
    const entry = pendingEntry(state, event.operationId);
    const selected = entry.observations[event.observationIndex];
    requireThat(selected && selected.kind === event.kind, 'dispatch selection observation absent or kind mismatch');
    const field = event.kind === 'not-admitted' ? 'notAdmitted' : event.kind;
    requireThat(entry[field] !== selected.serialized, 'dispatch observation already selected');
    requireThat(entry.selectionCount < MAX_SELECTIONS, 'dispatch selection limit reached');
    // Reference existing immutable bytes rather than duplicating an observation
    // or overwriting history. The host authenticates the chosen receipt; this
    // event only makes its explicit recovery selection durable and replayable.
    entry[field] = selected.serialized;
    entry.selectionCount++;
    return state;
  }
  if (event.type === 'completed') {
    record(event, ['schema', 'type', 'operationId', 'resolution'], 'dispatch completion record');
    record(event.resolution, ['kind', 'receiptId'], 'dispatch resolution');
    identifier(event.resolution.receiptId, 'dispatch resolution receipt id');
    requireThat(event.resolution.kind === 'settled' || event.resolution.kind === 'not-admitted',
      'unknown dispatch resolution kind');
    const entry = pendingEntry(state, event.operationId);
    if (event.resolution.kind === 'settled') {
      requireThat(entry.admission !== null && entry.settlement !== null, 'dispatch settlement observations required');
    } else {
      // The host authenticates this receipt and verifies that no controller
      // operation was admitted. Absence of observations alone proves nothing;
      // an earlier malformed admission response is not admission authority.
      requireThat(entry.notAdmitted !== null, 'dispatch not-admitted observation required');
    }
    entry.resolution = event.resolution;
    state.pending = null;
    return state;
  }
  requireThat(false, 'unknown dispatch ledger record type');
}

function replay(events, identity) {
  let state = null;
  for (let index = 0; index < events.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(events, String(index));
    requireThat(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable,
      'dispatch journal event accessor or gap');
    state = apply(state, boundedEvent(descriptor.value), identity);
  }
  return state;
}

export class DispatchLedger {
  #journal;
  #identity;

  constructor({ journal, experimentId, configDigest } = {}) {
    requireThat(typeof journal?.read === 'function' && typeof journal?.append === 'function', 'dispatch CAS journal required');
    identifier(experimentId, 'dispatch experiment id');
    hash(configDigest, 'dispatch configuration digest');
    this.#journal = journal;
    this.#identity = { experimentId, configDigest };
  }

  async #snapshot() {
    const value = await this.#journal.read();
    record(value, ['head', 'events'], 'dispatch journal snapshot');
    requireThat(Array.isArray(value.events) && Object.getPrototypeOf(value.events) === Array.prototype &&
      Object.getOwnPropertySymbols(value.events).length === 0 &&
      Object.getOwnPropertyNames(value.events).length === value.events.length + 1, 'dispatch journal event list');
    if (value.events.length) hash(value.head, 'dispatch journal head');
    else requireThat(value.head === null, 'dispatch empty journal head');
    return { head: value.head, state: replay(value.events, this.#identity) };
  }

  async #append(value) {
    const event = boundedEvent(value); // Copy before the first await.
    const { head, state } = await this.#snapshot();
    const next = apply(state, event, this.#identity);
    await this.#journal.append(head, event); // No stale-write or ambiguous-write retry.
    return copy(next);
  }

  /** Explicit create-only setup; never an implicit or idempotent reopen. */
  async initialize() {
    return this.#append({ schema: SCHEMA, type: 'initialized', ...this.#identity });
  }

  async read() {
    const { state } = await this.#snapshot();
    requireThat(state !== null, 'dispatch ledger is uninitialized');
    return copy(state);
  }

  /** Must be durably acknowledged before gateway admission is requested. */
  async claim(operation, request) {
    return this.#append({ schema: SCHEMA, type: 'claimed', operation, request });
  }

  async observe(operationId, kind, serializedEnvelope) {
    return this.#append({ schema: SCHEMA, type: 'observed', operationId, kind, serializedEnvelope });
  }

  /** Explicit recovery selection of retained bytes; no admission or dispatch. */
  async select(operationId, kind, observationIndex) {
    return this.#append({ schema: SCHEMA, type: 'selected', operationId, kind, observationIndex });
  }

  /** The host authenticates this resolution; this transition grants no authority. */
  async complete(operationId, resolution) {
    return this.#append({ schema: SCHEMA, type: 'completed', operationId, resolution });
  }
}
