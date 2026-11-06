// Synthetic public projection only. No production checkpoint or result evidence.
export const nowMs = Date.parse('2026-11-06T08:00:00.000Z');
export const binding = { ownerId: 'fixture-owner', experimentId: 'fixture-completed-pilot',
  sourceCommit: 'a'.repeat(40), originalExecutionSourceCommit: 'b'.repeat(40),
  finalExecutionSourceCommit: 'd'.repeat(40), servingSourceCommit: 'c'.repeat(40), closureDigest: 'd'.repeat(64) };
export function completedResponse() {
  return { schema: 'gk-learning-completed-history-response-v2', checkedAt: new Date(nowMs).toISOString(),
    serving: { mode: 'completed-history', sourceCommit: binding.servingSourceCommit },
    archive: { experimentSourceCommit: binding.sourceCommit, originalExecutionSourceCommit: binding.originalExecutionSourceCommit,
      finalExecutionSourceCommit: binding.finalExecutionSourceCommit,
      recovery: { kind: 'original-invalid-proposal-observation', attempt: 4, additionalModelCalls: 0 },
      closureDigest: binding.closureDigest, archivedAt: '2026-11-05T23:00:00.000Z' },
    status: { schema: 'gk-learning-v2-status', experimentId: binding.experimentId, sourceCommit: binding.sourceCommit,
      scope: 'concurrency-atomicity', policy: { schema: 'gk-learning-v2-policy', version: 4, attempts: 10,
        minimumGain: 1, confirmationPairs: 3, additionalPairs: 0, confirmationDecision: 'every-pair-passes',
        passes: 2, programmeCeilingMicros: null, usageMode: 'per-run-receipted', provider: 'truefoundry', memory: 'off' },
      counts: { attempted: 10, scored: 0, duplicate: 2, unresolved: 1, invalid: 4, noCoverage: 3,
        rejected: 0, provisional: 0, confirmed: 0, activated: 0 },
      originalVersion: '1'.repeat(64), incumbentVersion: '1'.repeat(64),
      baseline: { status: 'complete', failureCode: null }, confirmedVersions: 0, pendingOperation: null,
      budget: { ceilingMicros: null, observedSpentMicros: 0, observedReservedMicros: 0,
        unknownCostOperations: 11, unknownCostCalls: 24, pendingExecutionOperations: 0, complete: false,
        authoritative: 'external-gateway' },
      qualification: 'managed-source-gate-passed', deployment: 'not-managed-by-learning-core',
      dispatch: { pending: null, completed: 11 } } };
}

// Deliberately legacy negative fixture; no runtime reader may fall back to it.
export function legacyCompletedResponse() {
  const value = completedResponse();
  return { ...value, schema: 'gk-learning-completed-history-response-v1', archive: {
    experimentSourceCommit: binding.sourceCommit, executionSourceCommit: binding.originalExecutionSourceCommit,
    closureDigest: binding.closureDigest, archivedAt: value.archive.archivedAt } };
}
