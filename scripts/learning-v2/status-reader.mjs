/**
 * Read-only projection of an already initialized v2 experiment.
 *
 * The reader accepts only pinned public authorities and a fixed experiment
 * binding. It neither initializes state nor receives an SDK, private issuer,
 * gateway, activation, or write capability. A missing/corrupt store is a 503
 * in the authenticated HTTP adapter, never an empty-success experiment.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { POLICY, canonical, copy, digest, record, requireThat } from './contracts.mjs';
import { LearningController } from './controller.mjs';
import { DispatchLedger } from './dispatch-ledger.mjs';
import { FileJournal } from './journal.mjs';
import { OperationArchive } from './operation-archive.mjs';
import { statusView } from './prompts.mjs';
import { projectLearningStatus, validateLearningStatusBinding } from '../../integrations/base44/shared/learning-status-contract.js';

const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];
const keyFingerprint = key => createHash('sha256').update(
  createPublicKey(key).export({ type: 'spki', format: 'der' })).digest('hex');

/**
 * Return a read-only () => PublicLearningStatus capability.
 * No caller input selects source/owner/experiment. Never create any directory.
 */
export function createReadOnlyLearningStatusReader({ directory, repositoryRoot, binding, trust } = {}) {
  requireThat(typeof directory === 'string' && isAbsolute(directory) &&
    typeof repositoryRoot === 'string' && isAbsolute(repositoryRoot),
  'read-only status requires absolute existing storage and repository roots');
  const fixed = Object.freeze(validateLearningStatusBinding(binding));
  record(trust, ROLES, 'read-only status trust');
  for (const role of ROLES) {
    record(trust[role], role === 'budget' ?
      ['publicKeyPem', 'pinnedFingerprint', 'gatewayId'] :
      ['publicKeyPem', 'pinnedFingerprint'], 'read-only public trust');
    let fingerprint;
    try { fingerprint = keyFingerprint(trust[role].publicKeyPem); }
    catch { requireThat(false, 'invalid read-only authority public key'); }
    requireThat(fingerprint === trust[role].pinnedFingerprint,
      'read-only authority public key does not match pinned fingerprint');
  }
  const pinnedTrust = copy(trust);
  const controller = new LearningController({
    journal: new FileJournal({ directory: join(directory, 'controller'), repositoryRoot, create: false }),
    trust: pinnedTrust,
  });
  const archiveFor = id => new OperationArchive({ journal: new FileJournal({
    directory: join(directory, 'operations', digest({ operationId: id })),
    repositoryRoot, create: false,
  }) });

  return async function readStatus() {
    const state = await controller.state();
    requireThat(state.config.experimentId === fixed.experimentId &&
      state.config.sourceCommit === fixed.sourceCommit,
    'read-only experiment/source binding mismatch');
    requireThat(canonical(state.policy) === canonical(POLICY),
      'read-only policy differs from qualified version');
    const ledger = new DispatchLedger({
      journal: new FileJournal({ directory: join(directory, 'dispatch'), repositoryRoot, create: false }),
      experimentId: fixed.experimentId, configDigest: state.configDigest,
    });
    const dispatch = await ledger.read();
    if (state.baselineNonAdmission) {
      const marker = state.baselineNonAdmission;
      record(marker, ['operationId', 'requestDigest', 'receiptId', 'receiptDigest'],
        'baseline non-admission marker');
      const entry = dispatch.entries.find(item => item.operation.id === marker.operationId);
      requireThat(state.baselineError && !state.baseline &&
        !state.operations.some(item => item.kind === 'baseline') &&
        entry?.operation.kind === 'baseline' && entry.operation.attemptId === null &&
        entry.operation.requestDigest === marker.requestDigest &&
        entry.observations.some(item => item.kind === 'not-admitted' &&
          digest(item.serialized) === marker.receiptDigest) &&
        state.receipts.includes(marker.receiptId),
      'baseline non-admission lacks retained evidence');
      requireThat(!entry.resolution || (entry.resolution.kind === 'not-admitted' &&
        entry.resolution.receiptId === marker.receiptId && entry.notAdmitted !== null &&
        digest(entry.notAdmitted) === marker.receiptDigest),
      'baseline non-admission resolution mismatch');
    }
    for (const operation of state.operations) {
      const entry = dispatch.entries.find(item => item.operation.id === operation.id);
      requireThat(entry && entry.operation.requestDigest === operation.requestDigest,
        'controller operation lacks durable dispatch identity');
      if (operation.settled && !operation.reconciliationOnly &&
          (operation.evidenceComplete || operation.observedFreshCalls > 0 || operation.actualCalls > 0)) {
        const archived = await archiveFor(operation.id).read();
        requireThat(archived.operation?.id === operation.id &&
          archived.operation.leaseId === operation.leaseId &&
          archived.operation.requestDigest === operation.requestDigest &&
          digest(archived.request) === operation.requestDigest,
        'recorded execution archive is missing or differs');
      }
    }
    for (const entry of dispatch.entries.filter(item => item.resolution)) {
      const held = state.operations.find(item => item.id === entry.operation.id);
      requireThat(entry.resolution.kind === 'not-admitted' ? !held :
        held?.settled && held.settlementReceiptId === entry.resolution.receiptId,
      'dispatch resolution disagrees with controller evidence');
      if (entry.resolution.kind === 'not-admitted' && entry.operation.kind === 'baseline') {
        requireThat(state.baselineNonAdmission?.operationId === entry.operation.id &&
          state.baselineNonAdmission.receiptId === entry.resolution.receiptId,
        'baseline non-admission lacks controller disposition');
      }
    }
    const pending = dispatch.pending;
    const stage = pending ? pending.notAdmitted ? 'not-admitted-observed' :
      pending.settlement ? 'settlement-observed' :
        pending.admission ? 'admission-observed' : 'admission-intent' : null;
    const projected = { ...statusView(state),
      pendingOperation: pending?.operation.id || state.operations.find(item => !item.settled)?.id || null,
      dispatch: { pending: pending ?
        { operationId: pending.operation.id, kind: pending.operation.kind, stage } : null,
        completed: dispatch.entries.filter(item => item.resolution).length } };
    return projectLearningStatus(projected, fixed);
  };
}
