/**
 * Standalone, durable per-run usage record. NOT an admission/budget gate.
 *
 * This records the verified charges for one run, and retains uncertain calls
 * without silently treating them as free. No provider API, model access,
 * programme ceiling, or retry authority is imported or constructed here.
 * Append-only small delta events prevent O(N²) storage across a long run.
 * Existing policy-v2 journals are never read or migrated by this module.
 */
import { canonical, copy, digest, hash, identifier, integer, record, requireThat, text } from './contracts.mjs';

/**
 * Operation-level run balance for the controller's existing durable journal.
 * A provider may price an operation as a batch; do not invent a per-call split.
 * The controller authenticates each original settlement and any later charge
 * before recording it. This projection never signs or grants execution rights.
 * Null means unknown, including when the operation made zero model calls.
 */
export function operationRunBalance(operations) {
  requireThat(Array.isArray(operations), 'operation run balance requires operations');
  canonical(operations);
  const seen = new Set();
  const balance = { chargedMicros: 0, reservedMicros: 0,
    unknownCostOperations: 0, unknownCostCalls: 0, pendingExecutionOperations: 0, complete: true };
  const add = (key, amount) => {
    integer(amount, `operation balance ${key}`);
    const total = balance[key] + amount;
    requireThat(Number.isSafeInteger(total), 'operation run balance precision exceeded');
    balance[key] = total;
  };
  for (const operation of operations) {
    identifier(operation.id, 'run operation id');
    requireThat(!seen.has(operation.id), 'duplicate run operation');
    seen.add(operation.id);
    requireThat(typeof operation.settled === 'boolean', 'operation execution disposition required');
    integer(operation.reservationMicros, 'operation reservationMicros');
    if (!operation.settled) {
      requireThat(!operation.usageReconciliation, 'pending execution cannot have reconciled charges');
      add('reservedMicros', operation.reservationMicros);
      add('pendingExecutionOperations', 1);
      continue;
    }
    integer(operation.maxCalls, 'operation maxCalls', 1, 1_000_000);
    integer(operation.actualCalls, 'operation actualCalls', 0, operation.maxCalls);
    let charge = operation.actualMicros;
    if (operation.usageReconciliation) {
      requireThat(charge === null, 'known operation charge cannot be replaced');
      const reconciled = operation.usageReconciliation;
      record(reconciled, ['receiptId', 'actualMicros', 'receiptDigest', 'serialized'], 'operation usage reconciliation');
      identifier(reconciled.receiptId, 'usage receiptId');
      hash(reconciled.receiptDigest, 'usage receiptDigest');
      text(reconciled.serialized, 'original usage receipt', 16_384);
      requireThat(digest(reconciled.serialized) === reconciled.receiptDigest, 'usage receipt bytes changed');
      integer(reconciled.actualMicros, 'reconciled operation actualMicros');
      charge = reconciled.actualMicros;
    }
    if (charge === null) {
      add('unknownCostOperations', 1);
      add('unknownCostCalls', operation.actualCalls);
    } else {
      add('chargedMicros', charge);
    }
  }
  requireThat(Number.isSafeInteger(balance.chargedMicros + balance.reservedMicros),
    'operation run total precision exceeded');
  balance.complete = balance.unknownCostOperations === 0 && balance.pendingExecutionOperations === 0;
  return balance;
}

const STATE_SCHEMA = 'gk-run-balance-v1';
const CALL_STATES = ['unreconciled', 'settled'];
const validReceipt = body => {
  record(body, ['receiptId', 'runId', 'callId', 'chargedMicros'], 'provider charge receipt');
  identifier(body.receiptId, 'charge receiptId');
  identifier(body.runId, 'charge runId');
  identifier(body.callId, 'charge callId');
  integer(body.chargedMicros, 'actual charged microUSD', 0);
  return copy(body);
};

function validate(state) {
  record(state, ['schema', 'runId', 'provider', 'model', 'calls'], 'run balance state');
  requireThat(state.schema === STATE_SCHEMA, 'unknown run balance schema');
  identifier(state.runId, 'run balance runId');
  text(state.provider, 'provider', 200);
  text(state.model, 'model', 200);
  requireThat(Array.isArray(state.calls) && state.calls.length <= 100_000, 'run call record bound');
  const calls = new Set(), receipts = new Set();
  for (const call of state.calls) {
    record(call, ['callId', 'state', 'receipt'], 'run balance call');
    identifier(call.callId, 'run callId');
    requireThat(!calls.has(call.callId), 'duplicate run call identity');
    calls.add(call.callId);
    requireThat(CALL_STATES.includes(call.state), 'unknown run call state');
    if (call.state === 'unreconciled') {
      requireThat(call.receipt === null, 'unreconciled charge must remain unknown');
    } else {
      const receipt = validReceipt(call.receipt);
      requireThat(receipt.runId === state.runId && receipt.callId === call.callId,
        'charge receipt binding mismatch');
      requireThat(!receipts.has(receipt.receiptId), 'charge receipt replay');
      receipts.add(receipt.receiptId);
    }
  }
  return copy(state);
}

function project(state) {
  const calls = state.calls, settled = calls.filter(call => call.state === 'settled');
  const charged = settled.reduce((sum, call) => {
    const next = sum + call.receipt.chargedMicros;
    requireThat(Number.isSafeInteger(next), 'run charge total precision exceeded');
    return next;
  }, 0);
  return {
    schema: STATE_SCHEMA, runId: state.runId, provider: state.provider, model: state.model,
    callCount: calls.length, settledCalls: settled.length,
    unreconciledCalls: calls.length - settled.length,
    chargedMicros: charged, complete: calls.length === settled.length,
  };
}

/**
 * verifyChargeReceipt is a separately configured trusted provider settlement
 * verification capability, never a model-supplied assertion. It MUST return
 * the verified canonical receipt body or throw. There is no default verifier.
 */
export class RunBalance {
  #journal;
  #verify;
  constructor({ journal, verifyChargeReceipt }) {
    requireThat(journal && typeof journal.read === 'function' && typeof journal.append === 'function',
      'durable run journal required');
    requireThat(typeof verifyChargeReceipt === 'function',
      'independent provider receipt verification required');
    this.#journal = journal;
    this.#verify = verifyChargeReceipt;
  }
  async #read() {
    const snapshot = await this.#journal.read();
    requireThat(snapshot.events.length !== 0, 'run balance not initialized');
    const [opened, ...deltas] = snapshot.events;
    record(opened, ['schema', 'kind', 'runId', 'provider', 'model'], 'run balance opener');
    requireThat(opened.schema === STATE_SCHEMA && opened.kind === 'opened',
      'unknown run balance opener');
    const state = { schema: STATE_SCHEMA, runId: opened.runId,
      provider: opened.provider, model: opened.model, calls: [] };
    const calls = new Map();
    const receipts = new Set();
    for (const event of deltas) {
      requireThat(event?.schema === STATE_SCHEMA, 'unexpected run balance event schema');
      if (event.kind === 'call') {
        record(event, ['schema', 'kind', 'callId'], 'run balance call event');
        identifier(event.callId, 'callId');
        requireThat(!calls.has(event.callId) && calls.size < 100_000,
          'duplicate or excessive run call event');
        const entry = { callId: event.callId, state: 'unreconciled', receipt: null };
        calls.set(event.callId, entry);
        state.calls.push(entry);
      } else if (event.kind === 'settled') {
        record(event, ['schema', 'kind', 'callId', 'receipt'], 'run balance settlement event');
        const entry = calls.get(event.callId);
        requireThat(entry && entry.state === 'unreconciled',
          'unrecorded or repeated settlement event');
        const receipt = validReceipt(event.receipt);
        requireThat(receipt.runId === state.runId && receipt.callId === event.callId &&
          !receipts.has(receipt.receiptId), 'settlement event binding or receipt replay');
        entry.state = 'settled';
        entry.receipt = receipt;
        receipts.add(receipt.receiptId);
      } else {
        requireThat(false, 'unknown run balance event kind');
      }
    }
    return { head: snapshot.head, state: validate(state) };
  }
  async initialize({ runId, provider, model }) {
    identifier(runId, 'runId');
    text(provider, 'provider', 200);
    text(model, 'model', 200);
    const snapshot = await this.#journal.read();
    requireThat(snapshot.events.length === 0 && snapshot.head === null,
      'run balance already initialized');
    const state = validate({ schema: STATE_SCHEMA, runId, provider, model, calls: [] });
    await this.#journal.append(null, { schema: STATE_SCHEMA, kind: 'opened',
      runId: state.runId, provider: state.provider, model: state.model });
    return project(state);
  }
  async recordCall(callId) {
    identifier(callId, 'callId');
    const { head, state } = await this.#read();
    requireThat(!state.calls.some(call => call.callId === callId), 'call already recorded');
    requireThat(state.calls.length < 100_000, 'run call record bound');
    state.calls.push({ callId, state: 'unreconciled', receipt: null });
    validate(state);
    await this.#journal.append(head, { schema: STATE_SCHEMA, kind: 'call', callId });
    return project(state);
  }
  async settleCall(callId, receiptEnvelope) {
    identifier(callId, 'callId');
    const verified = validReceipt(await this.#verify(copy(receiptEnvelope)));
    const { head, state } = await this.#read();
    requireThat(verified.runId === state.runId && verified.callId === callId,
      'charge receipt belongs to different run/call');
    const call = state.calls.find(item => item.callId === callId);
    requireThat(call, 'unrecorded call cannot settle');
    if (call.state === 'settled') {
      requireThat(canonical(call.receipt) === canonical(verified),
        'conflicting settled charge receipt');
      return project(state); // idempotent: no additional journal append
    }
    requireThat(!state.calls.some(item => item.receipt?.receiptId === verified.receiptId),
      'charge receipt already used');
    call.state = 'settled';
    call.receipt = verified;
    validate(state);
    project(state); // detect precision overflow before publication
    await this.#journal.append(head, {
      schema: STATE_SCHEMA, kind: 'settled', callId, receipt: verified,
    });
    return project(state);
  }
  async status() { return project((await this.#read()).state); }
}
