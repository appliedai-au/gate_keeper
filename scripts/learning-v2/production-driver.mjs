/** A bounded driver for the existing durable host, with no provider credentials
 * or signing keys. All model dispatch stays inside its admitted executor. */
import { canonical, POLICY, record, requireThat } from './contracts.mjs';
import { createDetachedAuthorityClient } from './authority-client.mjs';
import { initializeLearningHost, openLearningHost } from './host.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';

const OPEN = new Set(['reserved', 'ready', 'screenPlanned', 'provisional', 'confirmationPlanned']);
const MAX_TRANSITIONS = 3 + POLICY.attempts * 5; // Include the final read after ten activations.
function reviewPending(error) {
  let current = error;
  for (let depth = 0; current && depth < 8; depth++, current = current.cause) {
    if (current.code === 'GK_AUTHORITY_REVIEW_PENDING') return true;
  }
  return false;
}

export async function openProductionPilot({ directory, repositoryRoot, bundle: supplied,
  authority, initialize = false, fetcher, timing } = {}) {
  const bundle = verifyProductionBundle(supplied);
  record(authority, ['baseUrl', 'token'], 'detached authority connection');
  requireThat(typeof initialize === 'boolean', 'explicit initialization choice required');
  const remote = createDetachedAuthorityClient({ ...authority, trust: bundle.trust, binding: bundle.binding,
    ...(fetcher ? { fetcher } : {}) });
  const options = { directory, repositoryRoot, config: bundle.config, trust: bundle.trust,
    runtime: bundle.runtime, caseInputs: bundle.caseInputs, client: remote.client,
    authorities: remote.authorities, gateway: remote.gateway, ...(timing ? { timing } : {}) };
  const host = initialize ? await initializeLearningHost(options, { history: bundle.history }) : await openLearningHost(options);
  return createProductionDriver({ host, remote, bundle });
}

/** Trusted host composition seam; useful for the isolated qualification suite. */
export function createProductionDriver({ host, remote, bundle: supplied }) {
  const bundle = verifyProductionBundle(supplied);
  let busy = false;
  async function inspect() {
    const snapshot = await host.inspect();
    requireThat(snapshot.state.configDigest === bundle.binding.configDigest &&
      canonical(snapshot.state.history) === canonical(bundle.history), 'production journal differs from frozen bundle');
    return snapshot;
  }
  async function outcome(status, details = {}) { return { status, ...details, learning: await host.status() }; }
  async function exclusive(work) {
    requireThat(!busy, 'another production driver action is in progress'); busy = true;
    try { return await work(); } finally { busy = false; }
  }

  async function step() {
    const { state, dispatch } = await inspect();
    if (dispatch.pending || state.operations.some(item => !item.settled)) return outcome('held', {
      reason: 'existing-operation-requires-explicit-reconciliation', operationId: dispatch.pending?.operation.id ??
        state.operations.find(item => !item.settled)?.id });
    if (state.baselineError || state.baselineNonAdmission) return outcome('held', { reason: 'original-baseline-unqualified' });
    if (state.activationHistory.some(item => item.action === 'rollback')) return outcome('held', { reason: 'explicit-rollback-retained' });
    if (!state.gate) {
      await host.recordManagedGate(await remote.managedGate());
      return outcome('advanced', { action: 'managed-gate-recorded' });
    }
    if (!state.baseline) {
      await host.dispatch('baseline');
      return outcome('advanced', { action: 'original-baseline-recorded' });
    }
    const attempt = state.attempts.find(item => OPEN.has(item.status));
    if (attempt) {
      const kind = attempt.status === 'reserved' ? 'proposal' :
        ['ready', 'screenPlanned'].includes(attempt.status) ? 'screen' : 'confirmation';
      try { await host.dispatch(kind, attempt.id); }
      catch (error) {
        if (!reviewPending(error)) throw error;
        const saved = await inspect();
        requireThat(kind === 'proposal' && saved.dispatch.pending?.operation.kind === 'proposal',
          'review-pending response outside original proposal');
        return outcome('review-pending', { operationId: saved.dispatch.pending.operation.id });
      }
      return outcome('advanced', { action: `${kind}-recorded`, attemptId: attempt.id });
    }
    const promotable = state.versions.filter(item => item.confirmed && item.parent === state.activeVersionId &&
      item.origin !== 'frozen-base' && !state.activationHistory.some(record => record.versionId === item.id));
    requireThat(promotable.length <= 1, 'ambiguous confirmed activation');
    if (promotable.length) {
      const target = promotable[0];
      await host.activateVersion(target.id, await remote.activation({ versionId: target.id, action: 'activate' }));
      return outcome('advanced', { action: 'confirmed-version-activated', versionId: target.id });
    }
    if (state.attempts.length === POLICY.attempts) {
      const genuineAttempts = state.attempts.filter(attempt => state.operations.some(operation =>
        operation.kind === 'proposal' && operation.attemptId === attempt.id && operation.settled &&
        operation.actualCalls === 1)).length;
      if (genuineAttempts !== POLICY.attempts) return outcome('held', {
        reason: 'ten-reserved-attempts-are-not-ten-verified-proposal-calls', genuineAttempts });
      return outcome('complete', { genuineAttempts,
        confirmed: state.attempts.filter(item => item.status === 'confirmed').length,
        rejected: state.attempts.filter(item => item.status === 'rejected').length });
    }
    requireThat(state.attempts.length < POLICY.attempts, 'production attempt count exceeds frozen policy');
    const attemptId = `${state.config.experimentId}:attempt:${state.attempts.length + 1}`;
    await host.beginAttempt(await remote.fitFeedback({ attemptId }));
    return outcome('advanced', { action: 'attempt-reserved', attemptId });
  }

  return Object.freeze({
    status: () => host.status(),
    inspect,
    async step() { return exclusive(step); },
    async run() {
      return exclusive(async () => {
        for (let index = 0; index < MAX_TRANSITIONS; index++) {
          const result = await step();
          if (result.status !== 'advanced') return result;
        }
        return outcome('held', { reason: 'bounded-driver-transition-limit' });
      });
    },
    async resumeProposalReview({ operationId }) {
      return exclusive(async () => {
        await inspect();
        let noveltyEnvelope;
        try { noveltyEnvelope = await remote.noveltyDecision({ operationId }); }
        catch (error) {
          if (!reviewPending(error)) throw error;
          return outcome('review-pending', { operationId });
        }
        await host.resumeProposalReview({ operationId, noveltyEnvelope });
        return outcome('advanced', { action: 'proposal-review-resumed', operationId });
      });
    },
    async reconcileUsage({ operationId }) {
      return exclusive(async () => {
        await inspect();
        const response = await remote.reconcileUsage({ operationId });
        if (response?.status === 'unknown') return outcome('usage-unknown', { operationId });
        await host.reconcileOperationUsage(operationId, response);
        return outcome('usage-reconciled', { operationId });
      });
    },
    async reconcileOperation({ operationId }) {
      return exclusive(async () => {
        const saved = await inspect();
        requireThat(saved.dispatch.pending?.operation.id === operationId,
          'explicit reconciliation requires the original pending operation');
        const reconciliation = await remote.operationReconciliation({ operationId });
        record(reconciliation, ['mode', 'admissionEnvelope', 'settlementEnvelope', 'reason'], 'protected operation reconciliation');
        requireThat(['failed-execution', 'settlement-only'].includes(reconciliation.mode), 'protected reconciliation mode');
        if (reconciliation.mode === 'settlement-only') requireThat(saved.state.operations.some(item =>
          item.id === operationId && item.consumed === true),
        'original completed evidence has not been consumed; retain it for evidence resume');
        await host.recover({ operationId, admissionEnvelope: reconciliation.admissionEnvelope,
          settlementEnvelope: reconciliation.settlementEnvelope, reason: reconciliation.reason });
        return outcome('advanced', { action: 'operation-reconciled-without-retry', operationId });
      });
    },
  });
}
