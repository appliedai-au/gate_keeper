/** Source prepared for the complete managed remote gate; do not run locally. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { POLICY, version } from '../scripts/learning-v2/contracts.mjs';
import { statusView } from '../scripts/learning-v2/prompts.mjs';
import {
  LEARNING_STATUS_PATH, MAX_STATUS_BYTES, projectLearningStatus,
  projectLearningStatusResponse, validateLearningStatusBinding,
} from '../integrations/base44/shared/learning-status-contract.js';

const SOURCE = 'a'.repeat(40);
const CHECKED_AT = '2026-11-04T12:34:56.789Z';
const PRIVATE = 'HOST_PRIVATE_RECEIPT_RULE_BANK_AND_DIAGNOSTICS_7b81';
const STATUS_KEYS = [
  'schema', 'experimentId', 'sourceCommit', 'scope', 'policy', 'counts',
  'originalVersion', 'incumbentVersion', 'baseline', 'confirmedVersions',
  'pendingOperation', 'budget', 'qualification', 'deployment', 'dispatch',
].sort();
const COUNT_KEYS = ['attempted', 'scored', 'duplicate', 'unresolved', 'invalid',
  'noCoverage', 'rejected', 'provisional', 'confirmed', 'activated'];
const clone = value => structuredClone(value);

function binding() {
  return { ownerId: 'status-owner', experimentId: 'status-contract', sourceCommit: SOURCE };
}

function status() {
  const base = { ...version('Frozen reviewer instructions.', []), confirmed: true, origin: 'frozen-base' };
  const state = {
    config: { experimentId: 'status-contract', sourceCommit: SOURCE, scope: 'concurrency' },
    policy: clone(POLICY), baseVersion: base, activeVersionId: base.id, versions: [base],
    attempts: [], activationHistory: [], operations: [], baseline: null,
    budget: { spentMicros: 0, reservedMicros: 0, lastReceiptId: PRIVATE }, gate: null,
    history: [{ procedure: PRIVATE, diagnostics: PRIVATE }],
    receipts: [PRIVATE], observedCalls: [{ response: PRIVATE }],
  };
  // This is the real controller projection with the exact host.status wrapper.
  // No authority, journal, SDK client or live host is constructed by this suite.
  return { ...statusView(state), dispatch: { pending: null, completed: 0 } };
}

function pendingStatus() {
  const value = status();
  value.baseline = { status: 'planned', failureCode: null };
  value.qualification = 'managed-source-gate-passed';
  value.pendingOperation = 'baseline:pending';
  value.budget.pendingExecutionOperations = 1;
  value.budget.complete = false;
  value.dispatch.pending = {
    operationId: value.pendingOperation, kind: 'baseline', stage: 'admission-intent',
  };
  return value;
}

function response(value = status()) {
  return { schema: 'gk-learning-v2-status-response', checkedAt: CHECKED_AT, status: value };
}

const RECORDS = [
  ['status', value => value], ['policy', value => value.policy],
  ['counts', value => value.counts], ['baseline', value => value.baseline],
  ['budget', value => value.budget], ['dispatch', value => value.dispatch],
  ['dispatch.pending', value => value.dispatch.pending],
];

test('shared route and transport byte ceiling remain explicit constants', () => {
  assert.equal(LEARNING_STATUS_PATH, '/gatekeeper/learning-v2/status');
  assert.equal(MAX_STATUS_BYTES, 16_384);
  // The transport enforces its byte ceiling; the pure projector validates data.
  assert.ok(Buffer.byteLength(JSON.stringify(response()), 'utf8') < MAX_STATUS_BYTES);
});

test('shared contract accepts the current controller projection and exact host wrapper', () => {
  const current = status();
  const result = projectLearningStatus(current, binding());
  assert.deepEqual(result, current);
  assert.deepEqual(Object.keys(result).sort(), STATUS_KEYS);
  assert.deepEqual(Object.keys(result.counts).sort(), [...COUNT_KEYS].sort());
  assert.deepEqual(Object.keys(result.baseline).sort(), ['failureCode', 'status']);
  assert.deepEqual(Object.keys(result.budget).sort(), [
    'authoritative', 'ceilingMicros', 'complete', 'observedReservedMicros', 'observedSpentMicros',
    'pendingExecutionOperations', 'unknownCostCalls', 'unknownCostOperations',
  ]);
  assert.deepEqual(Object.keys(result.dispatch).sort(), ['completed', 'pending']);
  assert.deepEqual(result.policy, POLICY);
  assert.equal(result.confirmedVersions, 0, 'the frozen original is not a learned improvement');
  assert.equal(result.pendingOperation, null);
  assert.deepEqual(result.dispatch, { pending: null, completed: 0 });
  assert.equal(JSON.stringify(result).includes(PRIVATE), false);
});

test('status projection copies every nested record and accepts frozen data without mutation', () => {
  const input = pendingStatus(), before = clone(input);
  const first = projectLearningStatus(input, binding());
  const second = projectLearningStatus(input, binding());
  for (const [label, select] of RECORDS) {
    assert.notStrictEqual(select(first), select(input), `${label} aliases caller input`);
    assert.notStrictEqual(select(first), select(second), `${label} aliases another projection`);
  }
  first.policy.attempts = 99;
  first.counts.activated = 999;
  first.baseline.failureCode = PRIVATE;
  first.budget.observedSpentMicros = 999;
  first.dispatch.pending.stage = PRIVATE;
  first.dispatch.completed = 999;
  assert.deepEqual(input, before);
  assert.deepEqual(second, before);
  input.scope = 'different-scope';
  input.dispatch.pending.operationId = 'changed:caller';
  assert.equal(second.scope, before.scope);
  assert.equal(second.dispatch.pending.operationId, before.dispatch.pending.operationId);

  const frozen = pendingStatus();
  for (const [, select] of [...RECORDS].reverse()) Object.freeze(select(frozen));
  assert.deepEqual(projectLearningStatus(frozen), before);
});

test('binding validation copies exact identities and rejects invalid or extra fields', () => {
  const input = binding(), before = clone(input);
  const result = validateLearningStatusBinding(input);
  assert.deepEqual(result, before);
  assert.notStrictEqual(result, input);
  result.ownerId = 'changed-owner';
  assert.deepEqual(input, before);
  assert.deepEqual(validateLearningStatusBinding({
    ownerId: 'x'.repeat(128), experimentId: 'e'.repeat(48), sourceCommit: '0'.repeat(40),
  }), { ownerId: 'x'.repeat(128), experimentId: 'e'.repeat(48), sourceCommit: '0'.repeat(40) });

  for (const key of ['ownerId', 'experimentId', 'sourceCommit']) {
    const missing = binding(); delete missing[key];
    assert.throws(() => validateLearningStatusBinding(missing), undefined, `missing ${key}`);
  }
  for (const [key, value] of [
    ['ownerId', ''], ['ownerId', '../other-owner'], ['ownerId', 'x'.repeat(129)],
    ['ownerId', 1], ['experimentId', 'e'.repeat(49)], ['experimentId', 'with space'],
    ['sourceCommit', 'A'.repeat(40)], ['sourceCommit', 'a'.repeat(39)], ['sourceCommit', null],
  ]) {
    assert.throws(() => validateLearningStatusBinding({ ...binding(), [key]: value }), undefined, key);
  }
  assert.throws(() => validateLearningStatusBinding({ ...binding(), token: PRIVATE }));
  for (const invalid of [null, [], 'owner', new Date(0)]) {
    assert.throws(() => validateLearningStatusBinding(invalid));
  }
});

test('optional binding pins status and response to the selected experiment and source', () => {
  assert.deepEqual(projectLearningStatus(status()), status());
  for (const expected of [
    { ...binding(), experimentId: 'another-experiment' },
    { ...binding(), sourceCommit: 'b'.repeat(40) },
  ]) {
    assert.throws(() => projectLearningStatus(status(), expected));
    assert.throws(() => projectLearningStatusResponse(response(), expected));
  }
  // Owner identity belongs to authenticated server selection, not status data.
  assert.deepEqual(projectLearningStatus(status(), { ...binding(), ownerId: 'another-valid-owner' }), status());
  assert.throws(() => projectLearningStatus({ ...status(), ownerId: binding().ownerId }, binding()));
  for (const invalid of [null, {}, { ...binding(), ownerId: '../owner' }]) {
    assert.throws(() => projectLearningStatus(status(), invalid));
    assert.throws(() => projectLearningStatusResponse(response(), invalid));
  }
});

test('response projection retains canonical check time and independently copies the status', () => {
  const input = response(pendingStatus()), before = clone(input);
  const first = projectLearningStatusResponse(input, binding());
  const second = projectLearningStatusResponse(input, binding());
  assert.deepEqual(first, before);
  assert.deepEqual(Object.keys(first).sort(), ['checkedAt', 'schema', 'status']);
  assert.notStrictEqual(first, input);
  for (const [label, select] of RECORDS) {
    assert.notStrictEqual(select(first.status), select(input.status), `${label} aliases response input`);
    assert.notStrictEqual(select(first.status), select(second.status), `${label} aliases another response`);
  }
  first.status.counts.activated = 100;
  first.status.dispatch.pending.stage = PRIVATE;
  first.checkedAt = PRIVATE;
  assert.deepEqual(input, before);
  assert.deepEqual(second, before);
  assert.equal(JSON.stringify(second).includes(PRIVATE), false);
});

test('response envelope rejects missing or unknown keys and noncanonical UTC times', () => {
  for (const key of ['schema', 'checkedAt', 'status']) {
    const missing = response(); delete missing[key];
    assert.throws(() => projectLearningStatusResponse(missing), undefined, key);
  }
  assert.throws(() => projectLearningStatusResponse({ ...response(), schema: 'another-schema' }));
  assert.throws(() => projectLearningStatusResponse({ ...response(), rawEnvelope: PRIVATE }));
  assert.throws(() => projectLearningStatusResponse({ ...response(), status: { ...status(), history: PRIVATE } }));
  for (const checkedAt of [
    '', null, 0, new Date(CHECKED_AT), '2026-11-04T12:34:56Z',
    '2026-11-04T12:34:56.789+00:00', '2026-11-04T13:34:56.789+01:00',
    '2026-02-30T12:34:56.789Z', '2026-11-04T12:34:56.789Z\n', 'not-a-date',
  ]) {
    assert.throws(() => projectLearningStatusResponse({ ...response(), checkedAt }));
  }
});

test('every status record rejects private additions and missing required keys', () => {
  for (const [label, select] of RECORDS) {
    const extended = pendingStatus(); select(extended).rawEnvelope = PRIVATE;
    assert.throws(() => projectLearningStatus(extended), undefined, `${label} private field`);
    for (const key of Object.keys(select(pendingStatus()))) {
      const missing = pendingStatus(); delete select(missing)[key];
      assert.throws(() => projectLearningStatus(missing), undefined, `${label}.${key} missing`);
    }
  }
  for (const key of ['history', 'rules', 'baselineError', 'baselineNonAdmission', 'receipts', 'config']) {
    assert.throws(() => projectLearningStatus({ ...status(), [key]: PRIVATE }), undefined, key);
  }
});

test('accessors and serialization hooks are rejected without invoking caller code', () => {
  let reads = 0;
  for (const [label, select] of RECORDS) {
    const input = pendingStatus(), target = select(input), key = Object.keys(target)[0];
    Object.defineProperty(target, key, { enumerable: true, get() { reads++; return PRIVATE; } });
    assert.throws(() => projectLearningStatus(input), undefined, label);
    const hooked = pendingStatus();
    select(hooked).toJSON = () => { reads++; return {}; };
    assert.throws(() => projectLearningStatus(hooked), undefined, `${label} toJSON`);
  }
  for (const [input, project, key] of [
    [binding(), validateLearningStatusBinding, 'ownerId'],
    [response(), projectLearningStatusResponse, 'checkedAt'],
  ]) {
    Object.defineProperty(input, key, { enumerable: true, get() { reads++; return PRIVATE; } });
    assert.throws(() => project(input));
  }
  assert.equal(reads, 0);
});

test('symbols hidden properties and inherited records never enter the public projection', () => {
  for (const [label, select] of RECORDS) {
    const symbol = pendingStatus(); select(symbol)[Symbol('private')] = PRIVATE;
    assert.throws(() => projectLearningStatus(symbol), undefined, `${label} symbol`);
    const hidden = pendingStatus(), target = select(hidden), key = Object.keys(target)[0];
    Object.defineProperty(target, key, { value: target[key], enumerable: false });
    assert.throws(() => projectLearningStatus(hidden), undefined, `${label} hidden field`);
    const inherited = pendingStatus(); Object.setPrototypeOf(select(inherited), { privateReceipt: PRIVATE });
    assert.throws(() => projectLearningStatus(inherited), undefined, `${label} inherited record`);
  }
  for (const [make, project] of [[binding, validateLearningStatusBinding], [response, projectLearningStatusResponse]]) {
    const hidden = make(); Object.defineProperty(hidden, 'privateReceipt', { value: PRIVATE });
    assert.throws(() => project(hidden));
    const symbol = make(); symbol[Symbol('private')] = PRIVATE;
    assert.throws(() => project(symbol));
    const inherited = make(); Object.setPrototypeOf(inherited, { privateReceipt: PRIVATE });
    assert.throws(() => project(inherited));
  }
});

test('non-record inputs and decorated primitive values are refused without coercion', () => {
  let coercions = 0;
  const decorated = { toString() { coercions++; return 'status-contract'; },
    valueOf() { coercions++; return 0; } };
  for (const value of [null, undefined, [], 'status', 0, new Date(0), () => status()]) {
    assert.throws(() => projectLearningStatus(value));
    assert.throws(() => projectLearningStatusResponse(value));
  }
  for (const key of ['policy', 'counts', 'baseline', 'budget', 'dispatch']) {
    for (const value of [null, [], new Date(0)]) {
      assert.throws(() => projectLearningStatus({ ...status(), [key]: value }), undefined, key);
    }
  }
  assert.throws(() => projectLearningStatus({ ...status(), experimentId: decorated }));
  assert.throws(() => projectLearningStatus({ ...status(), confirmedVersions: decorated }));
  assert.throws(() => projectLearningStatusResponse({ ...response(), checkedAt: decorated }));
  assert.equal(coercions, 0);
});

test('shared fixed policy remains identical to controller policy and refuses each changed constant', () => {
  assert.deepEqual(projectLearningStatus(status()).policy, POLICY);
  for (const [key, current] of Object.entries(POLICY)) {
    const value = status();
    value.policy[key] = typeof current === 'number' ? current + 1 : `${current}-changed`;
    assert.throws(() => projectLearningStatus(value), undefined, `changed policy ${key}`);
  }
});

test('attempt counters are safe bounded integers while activation history can exceed ten', () => {
  for (const key of COUNT_KEYS) {
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '1', null]) {
      const value = status(); value.counts.attempted = 10; value.counts[key] = invalid;
      assert.throws(() => projectLearningStatus(value), undefined, `invalid counter ${key}`);
    }
    if (key !== 'activated') {
      const value = status(); value.counts.attempted = 10; value.counts[key] = 11;
      assert.throws(() => projectLearningStatus(value), undefined, `${key} exceeds ten`);
    }
    if (!['attempted', 'activated'].includes(key)) {
      const value = status(); value.counts[key] = 1;
      assert.throws(() => projectLearningStatus(value), undefined, `${key} exceeds attempted`);
    }
  }
  const overlapping = status();
  overlapping.counts.attempted = 10;
  overlapping.counts.scored = 10;
  overlapping.counts.confirmed = 10;
  overlapping.counts.activated = Number.MAX_SAFE_INTEGER;
  overlapping.confirmedVersions = 10;
  assert.deepEqual(projectLearningStatus(overlapping).counts, overlapping.counts);
  assert.equal(projectLearningStatus(overlapping).confirmedVersions, 10);
  for (const invalid of [-1, 11, 0.5, NaN, Infinity, '0', null]) {
    assert.throws(() => projectLearningStatus({ ...status(), confirmedVersions: invalid }));
  }
});

test('v4 status permits verified per-run charges above the former aggregate cap', () => {
  assert.equal(POLICY.version, 4);
  assert.equal(POLICY.programmeCeilingMicros, null);
  assert.equal(POLICY.usageMode, 'per-run-receipted');
  for (const [spent, reserved] of [
    [0, 0], [60_000_000, 0], [130_000_000, 100_000_000],
  ]) {
    const value = status();
    value.budget.observedSpentMicros = spent;
    value.budget.observedReservedMicros = reserved;
    assert.deepEqual(projectLearningStatus(value).budget, value.budget);
  }
  for (const key of ['observedSpentMicros', 'observedReservedMicros']) {
    for (const invalid of [-1, 0.5, NaN, Infinity, '0', null]) {
      const value = status(); value.budget[key] = invalid;
      assert.throws(() => projectLearningStatus(value), undefined, key);
    }
  }
  const overflow = status();
  overflow.budget.observedSpentMicros = Number.MAX_SAFE_INTEGER;
  overflow.budget.observedReservedMicros = 1;
  assert.throws(() => projectLearningStatus(overflow), undefined, 'precision');
  const changedCeiling = status(); changedCeiling.budget.ceilingMicros = 50_000_000;
  assert.throws(() => projectLearningStatus(changedCeiling));
  const changedAuthority = status(); changedAuthority.budget.authoritative = 'model-estimate';
  assert.throws(() => projectLearningStatus(changedAuthority));
});

test('public accounting distinguishes known zero unpriced calls and unknown zero-call fees', () => {
  for (const unknownCostCalls of [0, 4]) {
    const value = status();
    value.budget.unknownCostOperations = 1;
    value.budget.unknownCostCalls = unknownCostCalls;
    value.budget.complete = false;
    assert.deepEqual(projectLearningStatus(value).budget, value.budget);
    const falselyComplete = clone(value); falselyComplete.budget.complete = true;
    assert.throws(() => projectLearningStatus(falselyComplete));
  }
  const knownZero = projectLearningStatus(status()).budget;
  assert.equal(knownZero.observedSpentMicros, 0);
  assert.equal(knownZero.complete, true);
  for (const key of ['unknownCostOperations', 'unknownCostCalls', 'pendingExecutionOperations']) {
    for (const invalid of [-1, 0.5, NaN, Infinity, '0', null, Number.MAX_SAFE_INTEGER + 1]) {
      const value = status(); value.budget[key] = invalid;
      assert.throws(() => projectLearningStatus(value), undefined, key);
    }
  }
  const callsWithoutUnknownOperation = status(); callsWithoutUnknownOperation.budget.unknownCostCalls = 1;
  assert.throws(() => projectLearningStatus(callsWithoutUnknownOperation));
  for (const complete of [null, 0, 'true', false]) {
    const value = status(); value.budget.complete = complete;
    assert.throws(() => projectLearningStatus(value));
  }
});

test('pending custody cannot disappear from the balance or report complete accounting', () => {
  const valid = pendingStatus();
  assert.equal(projectLearningStatus(valid).budget.pendingExecutionOperations, 1);
  for (const change of [{ pendingExecutionOperations: 0 }, { pendingExecutionOperations: 2 }, { complete: true }]) {
    const value = clone(valid); Object.assign(value.budget, change);
    assert.throws(() => projectLearningStatus(value));
  }
  const phantom = status(); phantom.budget.pendingExecutionOperations = 1; phantom.budget.complete = false;
  assert.throws(() => projectLearningStatus(phantom));
});

test('status identity and version fields reject malformed values without normalizing them', () => {
  for (const key of ['experimentId', 'scope', 'pendingOperation']) {
    for (const invalid of ['', ' leading', '../other', 'line\nbreak', 'x'.repeat(129), 7, {}]) {
      assert.throws(() => projectLearningStatus({ ...status(), [key]: invalid }), undefined, key);
    }
  }
  assert.throws(() => projectLearningStatus({ ...status(), experimentId: 'e'.repeat(49) }));
  for (const [key, length] of [['sourceCommit', 40], ['originalVersion', 64], ['incumbentVersion', 64]]) {
    for (const invalid of ['A'.repeat(length), 'g'.repeat(length), 'a'.repeat(length - 1),
      'a'.repeat(length + 1), null, 1]) {
      assert.throws(() => projectLearningStatus({ ...status(), [key]: invalid }), undefined, key);
    }
  }
  for (const [key, invalid] of [
    ['schema', 'gk-learning-v1-status'], ['qualification', 'passed'],
    ['qualification', 'running'], ['deployment', 'deployed'],
  ]) assert.throws(() => projectLearningStatus({ ...status(), [key]: invalid }), undefined, key);
});

test('baseline status accepts only coherent fixed failure codes', () => {
  for (const baselineState of ['not-planned', 'planned', 'complete', 'failed']) {
    for (const failureCode of [null, 'not-admitted', 'unresolved']) {
      const value = status(); value.baseline = { status: baselineState, failureCode };
      const valid = baselineState === 'failed' ? failureCode !== null : failureCode === null;
      if (valid) assert.deepEqual(projectLearningStatus(value).baseline, value.baseline);
      else assert.throws(() => projectLearningStatus(value));
    }
  }
  for (const baseline of [
    { status: 'running', failureCode: null }, { status: 'failed', failureCode: PRIVATE },
    { status: null, failureCode: null }, { status: 'complete', failureCode: undefined },
  ]) assert.throws(() => projectLearningStatus({ ...status(), baseline }));
});

test('dispatch accepts exact kinds and stages with a matching pending operation', () => {
  for (const kind of ['baseline', 'proposal', 'screen', 'confirmation']) {
    for (const stage of ['admission-intent', 'admission-observed', 'settlement-observed', 'not-admitted-observed']) {
      const value = pendingStatus();
      if (kind !== 'baseline') {
        value.baseline = { status: 'complete', failureCode: null };
        value.counts.attempted = 1;
      }
      value.pendingOperation = `${kind}:pending`;
      value.dispatch.pending = { operationId: value.pendingOperation, kind, stage };
      assert.deepEqual(projectLearningStatus(value).dispatch, value.dispatch);
    }
  }
  const fallback = status(); fallback.pendingOperation = 'controller:unsettled';
  fallback.budget.pendingExecutionOperations = 1;
  fallback.budget.complete = false;
  assert.deepEqual(projectLearningStatus(fallback).dispatch, { pending: null, completed: 0 });
  assert.equal(projectLearningStatus(fallback).pendingOperation, fallback.pendingOperation);
  for (const [key, invalid] of [
    ['kind', 'retry'], ['kind', null], ['stage', 'complete'], ['stage', null],
    ['operationId', '../private-operation'], ['operationId', 'another:operation'],
  ]) {
    const value = pendingStatus(); value.dispatch.pending[key] = invalid;
    assert.throws(() => projectLearningStatus(value), undefined, key);
  }
  const missingOperation = pendingStatus(); missingOperation.pendingOperation = null;
  assert.throws(() => projectLearningStatus(missingOperation));
  for (const invalid of [[], '', new Date(0)]) {
    const value = status(); value.dispatch.pending = invalid;
    assert.throws(() => projectLearningStatus(value));
  }
});

test('completed dispatch count permits safe history growth and refuses invalid numbers', () => {
  for (const completed of [0, 1, 31, Number.MAX_SAFE_INTEGER]) {
    const value = status(); value.dispatch.completed = completed;
    assert.equal(projectLearningStatus(value).dispatch.completed, completed);
  }
  for (const completed of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, NaN, Infinity, '0', null]) {
    const value = status(); value.dispatch.completed = completed;
    assert.throws(() => projectLearningStatus(value));
  }
});
