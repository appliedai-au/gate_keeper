// Public completed-history boundary only. No journal, issuer, credential or SDK.
import { MAX_STATUS_BYTES, projectLearningStatus, validateLearningStatusBinding } from './learning-status-contract.js';

export const LEARNING_HISTORY_SCHEMA = 'gk-learning-completed-history-response-v1';
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

/** A remains the experiment binding; B and C cannot substitute for its source. */
export function validateLearningHistoryBinding(value) {
  record(value, ['ownerId', 'experimentId', 'sourceCommit', 'servingSourceCommit',
    'executionSourceCommit', 'closureDigest']);
  const original = validateLearningStatusBinding({ ownerId: value.ownerId,
    experimentId: value.experimentId, sourceCommit: value.sourceCommit });
  const servingSourceCommit = hash(value.servingSourceCommit, 40);
  const executionSourceCommit = hash(value.executionSourceCommit, 40);
  check(new Set([original.sourceCommit, servingSourceCommit, executionSourceCommit]).size === 3);
  return { ...original, servingSourceCommit, executionSourceCommit,
    closureDigest: hash(value.closureDigest, 64) };
}

/** Copy only verified public fields. The private reader proves actual closure. */
export function projectLearningHistoryResponse(value, binding, nowMs = Date.now()) {
  record(value, ['schema', 'checkedAt', 'serving', 'archive', 'status']);
  check(value.schema === LEARNING_HISTORY_SCHEMA);
  const checked = timestamp(value.checkedAt);
  check(Number.isFinite(nowMs) && nowMs - checked >= -5000 && nowMs - checked <= 60_000);
  record(value.serving, ['mode', 'sourceCommit']);
  check(value.serving.mode === 'completed-history');
  const servingSourceCommit = hash(value.serving.sourceCommit, 40);
  record(value.archive, ['experimentSourceCommit', 'executionSourceCommit', 'closureDigest', 'archivedAt']);
  const experimentSourceCommit = hash(value.archive.experimentSourceCommit, 40);
  const executionSourceCommit = hash(value.archive.executionSourceCommit, 40);
  const closureDigest = hash(value.archive.closureDigest, 64);
  check(timestamp(value.archive.archivedAt) <= checked);
  check(new Set([experimentSourceCommit, executionSourceCommit, servingSourceCommit]).size === 3);

  const fixed = binding === undefined ? null : validateLearningHistoryBinding(binding);
  if (fixed) check(fixed.sourceCommit === experimentSourceCommit &&
    fixed.executionSourceCommit === executionSourceCommit && fixed.servingSourceCommit === servingSourceCommit &&
    fixed.closureDigest === closureDigest);
  const status = projectLearningStatus(value.status, fixed ? {
    ownerId: fixed.ownerId, experimentId: fixed.experimentId, sourceCommit: fixed.sourceCommit,
  } : undefined);
  check(status.sourceCommit === experimentSourceCommit && status.counts.attempted === 10 &&
    status.counts.provisional === 0 && TERMINAL_COUNTS.reduce((sum, key) => sum + status.counts[key], 0) === 10 &&
    status.baseline.status === 'complete' && status.baseline.failureCode === null &&
    status.pendingOperation === null && status.dispatch.pending === null &&
    status.dispatch.completed >= 11 && status.dispatch.completed <= 31 &&
    status.budget.pendingExecutionOperations === 0 && status.budget.observedReservedMicros === 0 &&
    status.qualification === 'managed-source-gate-passed');
  // Unknown actual prices do not reopen completed execution. budget.complete
  // retains the original accounting semantics and may truthfully remain false.
  return { schema: LEARNING_HISTORY_SCHEMA, checkedAt: value.checkedAt,
    serving: { mode: 'completed-history', sourceCommit: servingSourceCommit },
    archive: { experimentSourceCommit, executionSourceCommit, closureDigest, archivedAt: value.archive.archivedAt },
    status };
}
