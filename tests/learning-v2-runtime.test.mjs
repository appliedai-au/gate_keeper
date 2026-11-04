import test from 'node:test';
import assert from 'node:assert/strict';
import { dispatchManagedOperation } from '../scripts/learning-v2/runtime.mjs';

// Pure injected boundaries: no provider client, network, or real credentials.
function fixture() {
  const events = [];
  const request = { namespace: 'test:baseline', frozen: { value: 'original' } };
  const controller = {
    async executionRequest() { return request; },
    async reserveOperation(operation) { events.push('persist'); return { ...operation, leaseId: 'lease:1' }; },
    async recordBaseline() { events.push('evidence'); },
    async settleOperation() { events.push('settled'); },
    async status() { return { state: 'recorded' }; },
  };
  const args = {
    controller, kind: 'baseline', operationId: 'operation:1',
    async admit({ request: received }) { events.push('admit'); received.frozen.value = 'changed'; return {}; },
    async execute({ request: received }) {
      events.push('execute'); assert.equal(received.frozen.value, 'original'); return { evaluation: {} };
    },
    async settle() { events.push('settle'); return {}; },
  };
  return { args, events };
}

test('runtime persists the admitted intent before dispatch and settles after evidence', async () => {
  const { args, events } = fixture();
  assert.deepEqual(await dispatchManagedOperation(args), { state: 'recorded' });
  assert.deepEqual(events, ['admit', 'persist', 'execute', 'evidence', 'settle', 'settled']);
});

test('a refused or undurable intent never invokes the managed executor', async () => {
  for (const boundary of ['admit', 'persist']) {
    const { args, events } = fixture();
    if (boundary === 'admit') args.admit = async () => { throw new Error('admission refused'); };
    else args.controller.reserveOperation = async () => { throw new Error('journal unavailable'); };
    await assert.rejects(dispatchManagedOperation(args));
    assert.equal(events.includes('execute'), false);
  }
});

test('ambiguous execution remains unresolved without retry or zero-cost settlement', async () => {
  const { args, events } = fixture();
  args.execute = async () => { events.push('execute'); throw new Error('connection lost after dispatch'); };
  await assert.rejects(dispatchManagedOperation(args), /MANAGED_OPERATION_UNRESOLVED/);
  assert.deepEqual(events, ['admit', 'persist', 'execute']);
});

test('malformed output cannot advance the state or release the reservation', async () => {
  const { args, events } = fixture();
  args.execute = async () => { events.push('execute'); return { fabricated: true }; };
  await assert.rejects(dispatchManagedOperation(args), /evidence was not consumed/);
  assert.deepEqual(events, ['admit', 'persist', 'execute']);
});

test('settlement failure does not retry execution', async () => {
  const { args, events } = fixture();
  args.settle = async () => { events.push('settle'); throw new Error('billing is unresolved'); };
  await assert.rejects(dispatchManagedOperation(args), /billing is unresolved/);
  assert.deepEqual(events, ['admit', 'persist', 'execute', 'evidence', 'settle']);
});
