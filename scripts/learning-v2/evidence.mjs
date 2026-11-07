/**
 * Independent evaluation evidence for Gate Keeper's v2 learning controller.
 *
 * The host supplies the verifier key, its pin, and the frozen expected manifest.
 * Neither a learner response nor a receipt can supply those trust decisions.
 * Scores describe each task/trial AFTER its two finding passes are merged; a
 * pass is evidence of completion, never another opportunity to count a bug.
 *
 * `empty: false` means the raw response was nonempty. A valid response with an
 * empty findings array (caught=0, falseAlarms=0) remains complete evidence.
 * This module neither dispatches model calls nor activates a learned version.
 */
import { createHash } from 'node:crypto';
import { verifyEnvelope } from '../learning-trust.mjs';

const SHA256 = /^[a-f0-9]{64}$/;
const SHA1 = /^[a-f0-9]{40}$/;
const MAX_CASES = 4096;
const MAX_COUNT = 1_000_000;
const ID_FIELDS = [
  'experimentId', 'sourceCommit', 'benchmarkDigest', 'scorerDigest', 'model',
  'scope', 'phase', 'namespace', 'pairId', 'promptDigest', 'operationId', 'requestDigest',
];
const BODY_FIELDS = [
  'schema', 'receiptId', ...ID_FIELDS, 'executionIndex', 'provider', 'memory',
  'complete', 'applicableCaseIds', 'cases',
];
const PASS_FIELDS = [
  'pass', 'callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest',
  'status', 'finishReason', 'parseValid', 'empty', 'truncated', 'toolCalls',
  'reused', 'originReceiptId',
];

function fail(message) {
  throw new Error(`EVIDENCE_REJECTED: ${message}`);
}

function record(value, fields, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be a record`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    fail(`${label} has an unsupported prototype`);
  }
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => !fields.includes(key))) {
    fail(`${label} has missing or unexpected fields`);
  }
  for (const key of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail(`${label}.${key} must be an enumerable data property`);
    }
  }
}

function text(value, label) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 256 ||
      value.trim() !== value || /[\u0000-\u001f\u007f]/u.test(value)) {
    fail(`${label} is invalid`);
  }
}

function integer(value, label, maximum = MAX_COUNT) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    fail(`${label} must be a bounded nonnegative integer`);
  }
}

function digest(value, label, pattern = SHA256) {
  if (typeof value !== 'string' || !pattern.test(value)) fail(`${label} is invalid`);
}

function boundedArray(value, label, minimum, maximum) {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    fail(`${label} has invalid coverage`);
  }
  if (Object.getPrototypeOf(value) !== Array.prototype) {
    fail(`${label} must be a plain array`);
  }
  // Sparse arrays and array properties are not part of this signed schema.
  const keys = Reflect.ownKeys(value);
  if (keys.length !== value.length + 1 || keys.at(-1) !== 'length') {
    fail(`${label} must be a dense plain array`);
  }
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) {
      fail(`${label} must contain data properties`);
    }
  }
}

function validateContext(expected) {
  record(expected, [...ID_FIELDS, 'executionIndex', 'applicableCaseIds', 'cases'], 'expected context');
  for (const field of ID_FIELDS) text(expected[field], `expected ${field}`);
  digest(expected.sourceCommit, 'expected sourceCommit', SHA1);
  for (const field of ['benchmarkDigest', 'scorerDigest', 'promptDigest', 'requestDigest']) {
    digest(expected[field], `expected ${field}`);
  }
  if (!['baseline', 'screen', 'confirmation'].includes(expected.phase)) {
    fail('expected phase is invalid');
  }
  integer(expected.executionIndex, 'expected executionIndex', Number.MAX_SAFE_INTEGER);
  boundedArray(expected.cases, 'expected cases', 2, MAX_CASES);
  const cases = new Map();
  const splits = new Set();
  let hasFocusedCase = false;
  for (const item of expected.cases) {
    record(item, ['caseId', 'split', 'scope', 'expectedBugs', 'passes'], 'expected case');
    text(item.caseId, 'expected caseId');
    text(item.scope, 'expected case scope');
    if (!['fit', 'check'].includes(item.split)) fail('expected case split is invalid');
    integer(item.expectedBugs, 'expected case bug count');
    if (item.passes !== 2) fail('each expected case requires exactly two finding passes');
    if (cases.has(item.caseId)) fail('duplicate expected case');
    cases.set(item.caseId, item);
    splits.add(item.split);
    if (item.scope === expected.scope) hasFocusedCase = true;
  }
  if (splits.size !== 2) fail('both fit and check coverage are required');
  if (!hasFocusedCase) fail('the selected scope has no coverage');
  boundedArray(expected.applicableCaseIds, 'expected applicableCaseIds', 1, cases.size);
  const applicable = new Set();
  for (const caseId of expected.applicableCaseIds) {
    text(caseId, 'expected applicable caseId');
    if (applicable.has(caseId) || cases.get(caseId)?.scope !== expected.scope) {
      fail('applicableCaseIds must name distinct known cases within the selected scope');
    }
    applicable.add(caseId);
  }
  return cases;
}

function emptyMetrics() {
  return { caught: 0, falseAlarms: 0, net: 0 };
}

function addMetrics(target, caught, falseAlarms) {
  target.caught += caught;
  target.falseAlarms += falseAlarms;
  target.net = target.caught - target.falseAlarms;
  if (!Number.isSafeInteger(target.net) || !Number.isSafeInteger(target.caught) ||
      !Number.isSafeInteger(target.falseAlarms)) fail('score arithmetic overflow');
}

/**
 * Verify one independently signed, fully bound evaluation receipt.
 *
 * Screening reuse is structurally eligible only for pass 1 or a pass 2 outside
 * the signed applicableCaseIds. Fault-category overlap alone does not make a
 * procedure applicable to another language, stack, or sufficient guard. The
 * controller must additionally prove exact input/output identity
 * against the named, already verified incumbent receipt in the same pair.
 * Baseline and confirmation receipts cannot reuse any call. Cross-arm call
 * uniqueness, global receipt replay, and scheduled execution order also belong
 * to the controller, which has the full ledger rather than a single receipt.
 */
export function verifyEvaluation(envelope, trust, expected) {
  record(envelope, ['body', 'signature'], 'envelope');
  record(trust, ['publicKeyPem', 'pinnedFingerprint'], 'verifier trust');
  const { publicKeyPem, pinnedFingerprint } = trust;
  if (typeof publicKeyPem !== 'string' || publicKeyPem.length < 1 || publicKeyPem.length > 16_384) {
    fail('verifier public key is invalid');
  }
  digest(pinnedFingerprint, 'verifier fingerprint');
  const expectedCases = validateContext(expected);
  const body = envelope.body;
  record(body, BODY_FIELDS, 'receipt');
  if (body.schema !== 'gk-learning-v2-evaluation') fail('unsupported receipt schema');
  text(body.receiptId, 'receiptId');
  for (const field of ID_FIELDS) {
    if (body[field] !== expected[field]) fail(`${field} does not match the frozen context`);
  }
  integer(body.executionIndex, 'executionIndex', Number.MAX_SAFE_INTEGER);
  if (body.executionIndex !== expected.executionIndex) fail('executionIndex mismatch');
  if (body.provider !== 'truefoundry') fail('the provider must be TrueFoundry');
  if (body.memory !== 'off') fail('evaluation memory must be off');
  if (body.complete !== true) fail('evaluation is incomplete');
  boundedArray(body.applicableCaseIds, 'applicableCaseIds', expected.applicableCaseIds.length,
    expected.applicableCaseIds.length);
  if (!body.applicableCaseIds.every((caseId, index) => caseId === expected.applicableCaseIds[index])) {
    fail('applicableCaseIds do not match the frozen context');
  }
  boundedArray(body.cases, 'receipt cases', expectedCases.size, expectedCases.size);

  const seenCases = new Set();
  const seenCalls = new Set();
  const seenTurns = new Set();
  const normalizedCases = [];
  const calls = [];
  const totals = emptyMetrics();
  const splits = { fit: emptyMetrics(), check: emptyMetrics() };

  for (const item of body.cases) {
    record(item, ['caseId', 'caught', 'falseAlarms', 'passes'], 'case');
    text(item.caseId, 'caseId');
    const manifest = expectedCases.get(item.caseId);
    if (!manifest || seenCases.has(item.caseId)) fail('unknown or duplicate case');
    seenCases.add(item.caseId);
    integer(item.caught, 'caught count', manifest.expectedBugs);
    integer(item.falseAlarms, 'false-alarm count');
    boundedArray(item.passes, 'finding passes', 2, 2);
    const seenPasses = new Set();
    const normalizedPasses = [];

    for (const pass of item.passes) {
      record(pass, PASS_FIELDS, 'pass');
      if (![1, 2].includes(pass.pass) || seenPasses.has(pass.pass)) {
        fail('missing or duplicate finding pass');
      }
      seenPasses.add(pass.pass);
      for (const field of ['callId', 'sessionId', 'turnId']) text(pass[field], field);
      digest(pass.inputDigest, 'inputDigest');
      digest(pass.outputDigest, 'outputDigest');
      if (pass.status !== 'complete' || pass.finishReason !== 'stop' ||
          pass.parseValid !== true || pass.empty !== false || pass.truncated !== false ||
          pass.toolCalls !== 0) fail('finding pass lacks complete valid output');
      if (typeof pass.reused !== 'boolean') fail('reused must be explicit');
      if (pass.reused) {
        if (body.phase !== 'screen') fail('only screening may reuse a call');
        if (pass.pass !== 1 && expected.applicableCaseIds.includes(item.caseId)) {
          fail('the applicable second pass must be fresh');
        }
        text(pass.originReceiptId, 'originReceiptId');
        if (pass.originReceiptId === body.receiptId) fail('a receipt cannot reuse itself');
      } else if (pass.originReceiptId !== null) {
        fail('fresh calls must have a null originReceiptId');
      }
      if (seenCalls.has(pass.callId)) fail('duplicate callId within receipt');
      seenCalls.add(pass.callId);
      // JSON tuple encoding avoids ambiguous concatenation of user-chosen IDs.
      const turnKey = JSON.stringify([pass.sessionId, pass.turnId]);
      if (seenTurns.has(turnKey)) fail('duplicate session/turn within receipt');
      seenTurns.add(turnKey);
      const normalized = Object.freeze(Object.fromEntries(PASS_FIELDS.map(field => [field, pass[field]])));
      normalizedPasses.push(normalized);
      calls.push(Object.freeze({ caseId: item.caseId, scope: manifest.scope, ...normalized }));
    }

    normalizedPasses.sort((left, right) => left.pass - right.pass);
    normalizedCases.push(Object.freeze({
      caseId: item.caseId,
      split: manifest.split,
      scope: manifest.scope,
      caught: item.caught,
      falseAlarms: item.falseAlarms,
      passes: Object.freeze(normalizedPasses),
    }));
    addMetrics(totals, item.caught, item.falseAlarms);
    addMetrics(splits[manifest.split], item.caught, item.falseAlarms);
  }

  // Schema validation precedes signature verification so accessors, toJSON,
  // unsupported objects, and unbounded payloads cannot alter the signed bytes.
  try {
    verifyEnvelope({
      body,
      signature: envelope.signature,
      publicKeyPem,
      pinnedFingerprint,
    });
  } catch {
    fail('independent signature or pinned verifier is invalid');
  }

  return Object.freeze({
    receiptId: body.receiptId,
    namespace: body.namespace,
    pairId: body.pairId,
    phase: body.phase,
    executionIndex: body.executionIndex,
    promptDigest: body.promptDigest,
    operationId: body.operationId,
    requestDigest: body.requestDigest,
    applicableCaseIds: Object.freeze([...body.applicableCaseIds]),
    cases: Object.freeze(normalizedCases),
    totals: Object.freeze(totals),
    splits: Object.freeze({ fit: Object.freeze(splits.fit), check: Object.freeze(splits.check) }),
    calls: Object.freeze(calls),
    // This is the digest of the exact JSON serialization verified above.
    bodyDigest: createHash('sha256').update(JSON.stringify(body)).digest('hex'),
  });
}

function validateMetrics(result, label) {
  if (!result || typeof result !== 'object') fail(`${label} evaluation is absent`);
  const blocks = [result.totals, result.splits?.fit, result.splits?.check];
  for (const block of blocks) {
    record(block, ['caught', 'falseAlarms', 'net'], `${label} metrics`);
    integer(block.caught, `${label} caught`, MAX_CASES * MAX_COUNT);
    integer(block.falseAlarms, `${label} false alarms`, MAX_CASES * MAX_COUNT);
    if (!Number.isSafeInteger(block.net) || block.net !== block.caught - block.falseAlarms) {
      fail(`${label} metrics are inconsistent`);
    }
  }
  for (const metric of ['caught', 'falseAlarms', 'net']) {
    if (result.totals[metric] !== result.splits.fit[metric] + result.splits.check[metric]) {
      fail(`${label} split totals are inconsistent`);
    }
  }
}

/** A comparison is a decision input, never an activation or promotion. */
export function compareEvaluations({ base, incumbent, candidate }, { minimumGain = 1 } = {}) {
  if (!Number.isSafeInteger(minimumGain) || minimumGain < 1) {
    fail('minimumGain must be a positive integer');
  }
  for (const [label, result] of Object.entries({ base, incumbent, candidate })) {
    validateMetrics(result, label);
  }
  const gain = candidate.totals.net - incumbent.totals.net;
  const baseGain = candidate.totals.net - base.totals.net;
  const reasons = [];
  if (gain < minimumGain) reasons.push('gain_below_threshold');
  if (baseGain < 0) reasons.push('net_below_base');
  for (const split of ['fit', 'check']) {
    if (candidate.splits[split].net < incumbent.splits[split].net) {
      reasons.push(`${split}_below_incumbent`);
    }
    if (candidate.splits[split].net < base.splits[split].net) {
      reasons.push(`${split}_below_base`);
    }
  }
  return Object.freeze({ passed: reasons.length === 0, reasons: Object.freeze(reasons), gain, baseGain });
}
