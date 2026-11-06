// Public completed-history boundary only. No journal, issuer, credential or SDK.
import { MAX_STATUS_BYTES, projectLearningStatus, validateLearningStatusBinding } from './learning-status-contract.js';

export const LEARNING_HISTORY_SCHEMA = 'gk-learning-completed-history-response-v2';
export const MAX_LEARNING_HISTORY_BYTES = MAX_STATUS_BYTES;
const TERMINAL_COUNTS = ['duplicate', 'unresolved', 'invalid', 'noCoverage', 'rejected', 'confirmed'];

const check = condition => { if (!condition) throw new Error('Invalid completed learning history'); };
function record(value, keys) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  check(Reflect.ownKeys(value).length === keys.length);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    check(field && Object.hasOwn(field, 'value') && field.enumerable);
  }
}
function hash(value, length) {
  check(typeof value === 'string' && value.length === length && /^[a-f0-9]+$/u.test(value));
  return value;
}
function timestamp(value) {
  check(typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/u.test(value));
  const time = Date.parse(value);
  check(Number.isFinite(time) && new Date(time).toISOString() === value);
  return time;
}

/** A stays frozen; original B, final D and serving C are separate owner pins. */
export function validateLearningHistoryBinding(value) {
  record(value, ['ownerId', 'experimentId', 'sourceCommit', 'servingSourceCommit',
    'originalExecutionSourceCommit', 'finalExecutionSourceCommit', 'closureDigest']);
  const original = validateLearningStatusBinding({ ownerId: value.ownerId,
    experimentId: value.experimentId, sourceCommit: value.sourceCommit });
  const servingSourceCommit = hash(value.servingSourceCommit, 40);
  const originalExecutionSourceCommit = hash(value.originalExecutionSourceCommit, 40);
  const finalExecutionSourceCommit = hash(value.finalExecutionSourceCommit, 40);
  check(new Set([original.sourceCommit, servingSourceCommit, originalExecutionSourceCommit, finalExecutionSourceCommit]).size === 4);
  return { ...original, servingSourceCommit, originalExecutionSourceCommit, finalExecutionSourceCommit,
    closureDigest: hash(value.closureDigest, 64) };
}

/** Structural/provenance projection only, for display of the fixed authenticated
 * backend response. This does not authenticate an input or establish freshness.
 * Trusted owner pins, when supplied, still match exactly; closure is proved by
 * the private reader. Device wall clocks are not part of display validation. */
export function projectLearningHistoryForDisplay(value, binding) {
  record(value, ['schema', 'checkedAt', 'serving', 'archive', 'status']);
  check(value.schema === LEARNING_HISTORY_SCHEMA);
  const checked = timestamp(value.checkedAt);
  record(value.serving, ['mode', 'sourceCommit']);
  check(value.serving.mode === 'completed-history');
  const servingSourceCommit = hash(value.serving.sourceCommit, 40);
  record(value.archive, ['experimentSourceCommit', 'originalExecutionSourceCommit', 'finalExecutionSourceCommit',
    'recovery', 'closureDigest', 'archivedAt']);
  const experimentSourceCommit = hash(value.archive.experimentSourceCommit, 40);
  const originalExecutionSourceCommit = hash(value.archive.originalExecutionSourceCommit, 40);
  const finalExecutionSourceCommit = hash(value.archive.finalExecutionSourceCommit, 40);
  record(value.archive.recovery, ['kind', 'attempt', 'additionalModelCalls']);
  check(value.archive.recovery.kind === 'original-invalid-proposal-observation' &&
    value.archive.recovery.attempt === 4 && value.archive.recovery.additionalModelCalls === 0);
  const closureDigest = hash(value.archive.closureDigest, 64);
  check(timestamp(value.archive.archivedAt) <= checked);
  check(new Set([experimentSourceCommit, originalExecutionSourceCommit, finalExecutionSourceCommit, servingSourceCommit]).size === 4);

  const fixed = binding === undefined ? null : validateLearningHistoryBinding(binding);
  if (fixed) check(fixed.sourceCommit === experimentSourceCommit &&
    fixed.originalExecutionSourceCommit === originalExecutionSourceCommit &&
    fixed.finalExecutionSourceCommit === finalExecutionSourceCommit && fixed.servingSourceCommit === servingSourceCommit &&
    fixed.closureDigest === closureDigest);
  const status = projectLearningStatus(value.status, fixed ? {
    ownerId: fixed.ownerId, experimentId: fixed.experimentId, sourceCommit: fixed.sourceCommit,
  } : undefined);
  check(status.sourceCommit === experimentSourceCommit && status.counts.attempted === 10 &&
    status.counts.provisional === 0 && status.counts.invalid >= 4 &&
    TERMINAL_COUNTS.reduce((sum, key) => sum + status.counts[key], 0) === 10 &&
    status.baseline.status === 'complete' && status.baseline.failureCode === null &&
    status.pendingOperation === null && status.dispatch.pending === null &&
    status.dispatch.completed >= 11 && status.dispatch.completed <= 31 &&
    status.budget.pendingExecutionOperations === 0 && status.budget.observedReservedMicros === 0 &&
    status.qualification === 'managed-source-gate-passed');
  // Unknown actual prices do not reopen completed execution. budget.complete
  // retains the original accounting semantics and may truthfully remain false.
  return { schema: LEARNING_HISTORY_SCHEMA, checkedAt: value.checkedAt,
    serving: { mode: 'completed-history', sourceCommit: servingSourceCommit },
    archive: { experimentSourceCommit, originalExecutionSourceCommit, finalExecutionSourceCommit,
      recovery: { kind: 'original-invalid-proposal-observation', attempt: 4, additionalModelCalls: 0 },
      closureDigest, archivedAt: value.archive.archivedAt },
    status };
}

/** Server boundary: exact structure/provenance plus freshness on its own clock.
 * There is no null/flag bypass; browser callers use the explicit display API. */
export function projectLearningHistoryResponse(value, binding, nowMs = Date.now()) {
  const response = projectLearningHistoryForDisplay(value, binding);
  const age = nowMs - Date.parse(response.checkedAt);
  check(Number.isFinite(nowMs) && age >= -5000 && age <= 60_000);
  return response;
}
