import test from 'node:test';
import assert from 'node:assert/strict';
import { digest, procedure } from '../scripts/learning-v2/contracts.mjs';
import { prepareOriginalProposalRecovery } from '../scripts/learning-v2/original-proposal-recovery.mjs';

// These tests exercise only the trusted-history input boundary. Reaching the
// checkpoint reader is their explicit oracle, NOT a claim of recovered output.
const rule = scope => procedure({ scope, languages: ['javascript'],
  applicability: 'TEST-ONLY applicability', trigger: 'TEST-ONLY trigger', evidence: 'TEST-ONLY evidence',
  action: 'TEST-ONLY action', sufficientGuard: 'TEST-ONLY guard' }, scope);
const reference = (id, scope) => ({ id, procedure: rule(scope), outcome: 'rejected', sourceRef: 'TEST-ONLY' });
function invocation(history) {
  const counts = { original: 0, provider: 0 };
  const never = async () => { counts.provider++; throw new Error('TEST-ONLY unexpected provider read'); };
  const expected = { binding: { ownerId: 'owner-TEST-ONLY', experimentId: 'experiment-TEST-ONLY',
    sourceCommit: 'a'.repeat(40), configDigest: 'b'.repeat(64) }, checkpointDigest: 'c'.repeat(64),
    runtime: {}, history, historyDigest: digest(history),
    ownedEntry: { callId: 'call-TEST-ONLY', sessionId: 'session-TEST-ONLY', turnId: 'turn-TEST-ONLY',
      inputDigest: 'd'.repeat(64), createdBySubject: 'subject-TEST-ONLY', sessionRequest: {}, turnRequest: {} } };
  return { counts, run: () => prepareOriginalProposalRecovery({ expected,
    provider: { sessions: { get: never, getTurn: never, listTurns: never, listTurnEvents: never } },
    readOriginal: async () => { counts.original++; throw new Error('TEST-ONLY checkpoint reader reached'); } }) };
}

test('mixed historical scopes retain their original identity and reach checkpoint inspection', async () => {
  const f = invocation([reference('concurrency-TEST-ONLY', 'concurrency-atomicity'),
    reference('null-TEST-ONLY', 'null-handling')]);
  await assert.rejects(f.run(), /TEST-ONLY checkpoint reader reached/);
  assert.equal(f.counts.original, 1); assert.equal(f.counts.provider, 0);
});

test('unnormalized history cannot silently evade exact rejected-rule detection', async () => {
  const item = reference('prior-TEST-ONLY', 'concurrency-atomicity');
  item.procedure.action = '  TEST-ONLY   action  ';
  const f = invocation([item]);
  await assert.rejects(f.run(), /retained normalized identity/);
  assert.equal(f.counts.original, 0); assert.equal(f.counts.provider, 0);
});

test('duplicate historical IDs are refused even across distinct fault families', async () => {
  const f = invocation([reference('prior-TEST-ONLY', 'concurrency-atomicity'),
    reference('prior-TEST-ONLY', 'null-handling')]);
  await assert.rejects(f.run(), /duplicate prior reference/);
  assert.equal(f.counts.original, 0); assert.equal(f.counts.provider, 0);
});
