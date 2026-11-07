// Shared public boundary only. Safe to include in the browser and Deno bundles.
// No host state, credentials, model clients, prompts or journal imports belong here.
export const LEARNING_STATUS_PATH = '/gatekeeper/learning-v2/status';
export const PUBLIC_LEARNING_STATUS_PATH = '/gatekeeper/learning-v3/status';
export const MAX_STATUS_BYTES = 16_384;

const POLICY = Object.freeze({
  schema: 'gk-learning-v2-policy', version: 4, attempts: 10,
  minimumGain: 1, confirmationPairs: 3, additionalPairs: 0,
  confirmationDecision: 'every-pair-passes', passes: 2,
  programmeCeilingMicros: null, usageMode: 'per-run-receipted', provider: 'truefoundry', memory: 'off',
});
const COUNT_KEYS = ['attempted', 'scored', 'duplicate', 'unresolved', 'invalid',
  'noCoverage', 'rejected', 'provisional', 'confirmed', 'activated'];
const STATUS_KEYS = ['schema', 'experimentId', 'sourceCommit', 'scope', 'policy', 'counts',
  'originalVersion', 'incumbentVersion', 'baseline', 'confirmedVersions', 'pendingOperation',
  'budget', 'qualification', 'deployment', 'dispatch'];
const BINDING_KEYS = ['ownerId', 'experimentId', 'sourceCommit'];

function check(condition) {
  if (!condition) throw new Error('Invalid learning status');
}

// Reject hidden fields and accessors before reading values. Unknown/private
// fields are refused, not silently spread into a response or React state.
function record(value, keys) {
  check(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  check(Reflect.ownKeys(value).length === keys.length);
  for (const key of keys) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    check(field && Object.hasOwn(field, 'value') && field.enumerable);
  }
}

function identifier(value, maximum = 128) {
  check(typeof value === 'string' && value.length <= maximum &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value));
  return value;
}

function hash(value, length) {
  check(typeof value === 'string' && value.length === length && /^[a-f0-9]+$/.test(value));
  return value;
}

function integer(value, maximum = Number.MAX_SAFE_INTEGER) {
  check(Number.isSafeInteger(value) && value >= 0 && value <= maximum);
  return value;
}

function choice(value, allowed) {
  check(allowed.includes(value));
  return value;
}

export function validateLearningStatusBinding(value) {
  record(value, BINDING_KEYS);
  return {
    ownerId: identifier(value.ownerId),
    experimentId: identifier(value.experimentId, 48),
    sourceCommit: hash(value.sourceCommit, 40),
  };
}

/** A newly allocated, bounded public projection of host.status(), never inspect(). */
export function projectLearningStatus(value, binding) {
  record(value, STATUS_KEYS);
  check(value.schema === 'gk-learning-v2-status');
  const experimentId = identifier(value.experimentId, 48);
  const sourceCommit = hash(value.sourceCommit, 40);
  if (binding !== undefined) {
    const fixed = validateLearningStatusBinding(binding);
    check(experimentId === fixed.experimentId && sourceCommit === fixed.sourceCommit);
  }
  const scope = identifier(value.scope);
  record(value.policy, Object.keys(POLICY));
  for (const [key, expected] of Object.entries(POLICY)) check(value.policy[key] === expected);

  record(value.counts, COUNT_KEYS);
  const attempted = integer(value.counts.attempted, POLICY.attempts);
  const counts = {};
  for (const key of COUNT_KEYS) {
    // Activation history can contain reactivation events after a rollback.
    counts[key] = integer(value.counts[key], key === 'activated' ? Number.MAX_SAFE_INTEGER : attempted);
  }

  const originalVersion = hash(value.originalVersion, 64);
  const incumbentVersion = hash(value.incumbentVersion, 64);
  record(value.baseline, ['status', 'failureCode']);
  const baselineStatus = choice(value.baseline.status, ['not-planned', 'planned', 'complete', 'failed']);
  const failureCode = choice(value.baseline.failureCode, [null, 'not-admitted', 'unresolved']);
  check(baselineStatus === 'failed' ? failureCode !== null : failureCode === null);
  const confirmedVersions = integer(value.confirmedVersions, POLICY.attempts);
  const pendingOperation = value.pendingOperation === null ? null : identifier(value.pendingOperation);

  record(value.budget, ['ceilingMicros', 'observedSpentMicros', 'observedReservedMicros',
    'unknownCostOperations', 'unknownCostCalls', 'pendingExecutionOperations', 'complete', 'authoritative']);
  check(value.budget.ceilingMicros === POLICY.programmeCeilingMicros);
  const observedSpentMicros = integer(value.budget.observedSpentMicros);
  const observedReservedMicros = integer(value.budget.observedReservedMicros);
  check(Number.isSafeInteger(observedSpentMicros + observedReservedMicros));
  const unknownCostOperations = integer(value.budget.unknownCostOperations);
  const unknownCostCalls = integer(value.budget.unknownCostCalls);
  const pendingExecutionOperations = integer(value.budget.pendingExecutionOperations, 1);
  check(unknownCostOperations !== 0 || unknownCostCalls === 0);
  check((pendingOperation === null) === (pendingExecutionOperations === 0));
  const complete = unknownCostOperations === 0 && pendingExecutionOperations === 0;
  check(value.budget.complete === complete);
  check(value.budget.authoritative === 'external-gateway');
  const qualification = choice(value.qualification, ['managed-source-gate-passed', 'source-only-unqualified']);
  check(value.deployment === 'not-managed-by-learning-core');

  record(value.dispatch, ['pending', 'completed']);
  let pending = null;
  if (value.dispatch.pending !== null) {
    record(value.dispatch.pending, ['operationId', 'kind', 'stage']);
    pending = {
      operationId: identifier(value.dispatch.pending.operationId),
      kind: choice(value.dispatch.pending.kind, ['baseline', 'proposal', 'screen', 'confirmation']),
      stage: choice(value.dispatch.pending.stage, ['admission-intent', 'admission-observed',
        'settlement-observed', 'not-admitted-observed']),
    };
    check(pending.operationId === pendingOperation);
  }
  const completed = integer(value.dispatch.completed);
  return {
    schema: 'gk-learning-v2-status', experimentId, sourceCommit, scope,
    policy: { ...POLICY }, counts, originalVersion, incumbentVersion,
    baseline: { status: baselineStatus, failureCode }, confirmedVersions, pendingOperation,
    budget: { ceilingMicros: POLICY.programmeCeilingMicros, observedSpentMicros,
      observedReservedMicros, unknownCostOperations, unknownCostCalls,
      pendingExecutionOperations, complete, authoritative: 'external-gateway' },
    qualification, deployment: 'not-managed-by-learning-core', dispatch: { pending, completed },
  };
}

export function projectLearningStatusResponse(value, binding) {
  record(value, ['schema', 'checkedAt', 'status']);
  check(value.schema === 'gk-learning-v2-status-response');
  check(typeof value.checkedAt === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.checkedAt));
  const milliseconds = Date.parse(value.checkedAt);
  check(Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value.checkedAt);
  return { schema: 'gk-learning-v2-status-response', checkedAt: value.checkedAt,
    status: projectLearningStatus(value.status, binding) };
}

