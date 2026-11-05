/**
 * Standalone, durable per-run usage record. NOT an admission/budget gate.
 *
 * This records the verified charges for one run, and retains uncertain calls
 * without silently treating them as free. No provider API, model access,
 * programme ceiling, or retry authority is imported or constructed here.
 * Existing policy-v2 journals are never read or migrated by this module.
 */
import { canonical, copy, identifier, integer, record, requireThat, text } from './contracts.mjs';

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
    const last = snapshot.events.at(-1);
    return { head: snapshot.head, state: validate(last) };
  }
  async initialize({ runId, provider, model }) {
    identifier(runId, 'runId');
    text(provider, 'provider', 200);
    text(model, 'model', 200);
    const snapshot = await this.#journal.read();
    requireThat(snapshot.events.length === 0 && snapshot.head === null,
      'run balance already initialized');
    const state = validate({ schema: STATE_SCHEMA, runId, provider, model, calls: [] });
    await this.#journal.append(null, state);
    return project(state);
  }
  async recordCall(callId) {
    identifier(callId, 'callId');
    const { head, state } = await this.#read();
    requireThat(!state.calls.some(call => call.callId === callId), 'call already recorded');
    requireThat(state.calls.length < 100_000, 'run call record bound');
    state.calls.push({ callId, state: 'unreconciled', receipt: null });
    await this.#journal.append(head, validate(state));
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
    await this.#journal.append(head, state);
    return project(state);
  }
  async status() { return project((await this.#read()).state); }
}
