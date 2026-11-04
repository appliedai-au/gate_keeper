import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifyEvaluation, compareEvaluations } from '../scripts/learning-v2/evidence.mjs';

// These fixtures generate independent test keys only when the managed test
// runner executes this suite. No production key, model call, or holdout is used.
const keys = generateKeyPairSync('ed25519');
const trust = {
  publicKeyPem: keys.publicKey.export({ type: 'spki', format: 'pem' }),
  pinnedFingerprint: createHash('sha256')
    .update(keys.publicKey.export({ type: 'spki', format: 'der' })).digest('hex'),
};
const hash = value => createHash('sha256').update(value).digest('hex');
const seal = body => ({ body, signature: sign(null, Buffer.from(JSON.stringify(body)), keys.privateKey).toString('base64') });

function fixture(phase = 'screen') {
  const expected = {
    experimentId: 'experiment-1',
    sourceCommit: '1'.repeat(40),
    benchmarkDigest: hash('training manifest'),
    scorerDigest: hash('independent scorer'),
    model: 'tfy-managed/test-model',
    scope: 'concurrency',
    phase,
    namespace: `experiment-1/${phase}/1`,
    pairId: 'pair-1',
    promptDigest: hash('frozen prompt'),
    operationId: 'operation-1',
    requestDigest: hash('frozen execution request'),
    executionIndex: 1,
    applicableCaseIds: ['fit-1', 'check-1'],
    cases: [
      { caseId: 'fit-1', split: 'fit', scope: 'concurrency', expectedBugs: 3, passes: 2 },
      { caseId: 'check-1', split: 'check', scope: 'concurrency', expectedBugs: 2, passes: 2 },
    ],
  };
  const body = {
    schema: 'gk-learning-v2-evaluation',
    receiptId: 'receipt-1',
    ...Object.fromEntries(Object.entries(expected).filter(([field]) => field !== 'cases')),
    applicableCaseIds: [...expected.applicableCaseIds],
    provider: 'truefoundry',
    memory: 'off',
    complete: true,
    cases: expected.cases.map((item, index) => ({
      caseId: item.caseId,
      caught: index === 0 ? 2 : 1,
      falseAlarms: index === 0 ? 1 : 0,
      passes: [1, 2].map(pass => ({
        pass,
        callId: `${item.caseId}-call-${pass}`,
        sessionId: `${item.caseId}-session`,
        turnId: `${item.caseId}-turn-${pass}`,
        inputDigest: hash(`${item.caseId}-input-${pass}`),
        outputDigest: hash(`${item.caseId}-output-${pass}`),
        status: 'complete',
        finishReason: 'stop',
        parseValid: true,
        empty: false,
        truncated: false,
        toolCalls: 0,
        reused: false,
        originReceiptId: null,
      })),
    })),
  };
  return { expected, body };
}

function rejectsChange(change, pattern = /EVIDENCE_REJECTED/) {
  const { expected, body } = fixture();
  change(body, expected);
  assert.throws(() => verifyEvaluation(seal(body), trust, expected), pattern);
}

test('signed complete evidence scores merged cases once and derives both splits', () => {
  const { expected, body } = fixture();
  const result = verifyEvaluation(seal(body), trust, expected);
  assert.deepEqual(result.totals, { caught: 3, falseAlarms: 1, net: 2 });
  assert.deepEqual(result.splits.fit, { caught: 2, falseAlarms: 1, net: 1 });
  assert.deepEqual(result.splits.check, { caught: 1, falseAlarms: 0, net: 1 });
  assert.equal(result.calls.length, 4);
  assert.equal(result.executionIndex, 1);
  assert.equal(result.bodyDigest, hash(JSON.stringify(body)));
});

test('a valid nonempty response containing zero findings is complete', () => {
  const { expected, body } = fixture('confirmation');
  for (const item of body.cases) {
    item.caught = 0;
    item.falseAlarms = 0;
  }
  const result = verifyEvaluation(seal(body), trust, expected);
  assert.deepEqual(result.totals, { caught: 0, falseAlarms: 0, net: 0 });
});

test('every experiment, source, evaluation, prompt and ordering identity is bound', () => {
  for (const field of [
    'experimentId', 'sourceCommit', 'benchmarkDigest', 'scorerDigest', 'model',
    'scope', 'phase', 'namespace', 'pairId', 'promptDigest', 'operationId', 'requestDigest',
  ]) {
    rejectsChange(body => { body[field] = `${body[field]}-different`; }, new RegExp(field));
  }
  rejectsChange(body => { body.executionIndex += 1; }, /executionIndex/);
  rejectsChange(body => { body.applicableCaseIds.reverse(); }, /applicableCaseIds/);
  rejectsChange(body => { body.provider = 'direct-provider'; }, /TrueFoundry/);
  rejectsChange(body => { body.memory = 'enabled'; }, /memory/);
  rejectsChange(body => { body.schema = 'unverified-score'; }, /schema/);
});

test('signature, verifier pin and payload tampering fail closed', () => {
  const { expected, body } = fixture();
  const envelope = seal(body);
  assert.throws(() => verifyEvaluation(envelope, { ...trust, pinnedFingerprint: '0'.repeat(64) }, expected), /signature/);
  assert.throws(() => verifyEvaluation({ ...envelope, signature: 'invalid' }, trust, expected), /signature/);
  body.cases[0].caught = 3;
  assert.throws(() => verifyEvaluation(envelope, trust, expected), /signature/);
});

test('missing trust or extra envelope fields cannot fall through to unsigned evaluation', () => {
  const { expected, body } = fixture();
  assert.throws(() => verifyEvaluation(seal(body), undefined, expected), /EVIDENCE_REJECTED/);
  assert.throws(() => verifyEvaluation({ ...seal(body), trusted: true }, trust, expected), /unexpected fields/);
  assert.throws(() => verifyEvaluation(seal(body), { ...trust, publicKeyPem: {} }, expected), /public key/);
});

test('unknown receipt, case and pass fields cannot smuggle self-approval', () => {
  rejectsChange(body => { body.approved = true; }, /unexpected fields/);
  rejectsChange(body => { body.cases[0].net = 1_000; }, /unexpected fields/);
  rejectsChange(body => { body.cases[0].passes[0].valid = true; }, /unexpected fields/);
  rejectsChange(body => { delete body.cases[0].passes[0].originReceiptId; }, /missing/);
  rejectsChange(body => { body.receiptId = ' receipt '; }, /receiptId/);
});

test('record accessors are rejected before they can alter signed content', () => {
  const { expected, body } = fixture();
  const envelope = seal(body);
  let accessed = false;
  Object.defineProperty(body.cases[0], 'caught', {
    enumerable: true,
    get() { accessed = true; return 3; },
  });
  assert.throws(() => verifyEvaluation(envelope, trust, expected), /data property/);
  assert.equal(accessed, false);
});

test('non-finite, fractional, negative and impossible counts cannot be scored', () => {
  for (const value of [NaN, Infinity, -1, 0.5, 4, Number.MAX_SAFE_INTEGER]) {
    rejectsChange(body => { body.cases[0].caught = value; }, /caught count/);
  }
  for (const value of [NaN, Infinity, -1, 0.5, 1_000_001]) {
    rejectsChange(body => { body.cases[0].falseAlarms = value; }, /false-alarm count/);
  }
  for (const value of [-1, NaN, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    rejectsChange(body => { body.executionIndex = value; }, /executionIndex/);
  }
});

test('the frozen manifest requires distinct cases, two passes, both splits and focused coverage', () => {
  rejectsChange((body, expected) => { expected.cases[1].caseId = expected.cases[0].caseId; }, /duplicate expected case/);
  rejectsChange((body, expected) => { expected.cases[1].split = 'fit'; }, /fit and check/);
  rejectsChange((body, expected) => { expected.cases[1].split = 'holdout'; }, /split/);
  rejectsChange((body, expected) => { expected.cases[0].passes = 1; }, /exactly two/);
  rejectsChange((body, expected) => { expected.cases[0].expectedBugs = -1; }, /bug count/);
  rejectsChange((body, expected) => { for (const item of expected.cases) item.scope = 'other'; }, /no coverage/);
  rejectsChange((body, expected) => { expected.cases[0].holdout = true; }, /unexpected fields/);
  rejectsChange((body, expected) => { expected.cases = []; }, /coverage/);
});

test('signed applicability must be nonempty, unique, known and within the selected fault scope', () => {
  rejectsChange((body, expected) => { expected.applicableCaseIds = []; }, /applicableCaseIds/);
  rejectsChange((body, expected) => { expected.applicableCaseIds = ['fit-1', 'fit-1']; }, /distinct known cases/);
  rejectsChange((body, expected) => { expected.applicableCaseIds = ['unknown']; }, /distinct known cases/);
  rejectsChange((body, expected) => { expected.cases[1].scope = 'other-fault'; }, /distinct known cases/);
});

test('missing, extra, duplicate and unknown cases cannot pass as complete', () => {
  rejectsChange(body => { body.cases.pop(); }, /coverage/);
  rejectsChange(body => { body.cases.push(structuredClone(body.cases[0])); }, /coverage/);
  rejectsChange(body => { body.cases[1].caseId = body.cases[0].caseId; }, /duplicate case/);
  rejectsChange(body => { body.cases[1].caseId = 'unplanned-case'; }, /unknown/);
  rejectsChange(body => { delete body.cases[0]; }, /dense plain array/);
});

test('array prototypes, accessors and oversized manifests are rejected before signing semantics change', () => {
  const { expected, body } = fixture();
  const envelope = seal(body);
  Object.setPrototypeOf(body.cases, { toJSON() { return []; } });
  assert.throws(() => verifyEvaluation(envelope, trust, expected), /plain array/);
  rejectsChange((value, context) => { context.cases = Array.from({ length: 4097 }, () => context.cases[0]); }, /coverage/);
  const other = fixture();
  const otherEnvelope = seal(other.body);
  let accessed = false;
  Object.defineProperty(other.body.cases, '0', {
    enumerable: true,
    get() { accessed = true; return {}; },
  });
  assert.throws(() => verifyEvaluation(otherEnvelope, trust, other.expected), /data properties/);
  assert.equal(accessed, false);
});

test('every case requires distinct first and second passes', () => {
  rejectsChange(body => { body.cases[0].passes.pop(); }, /coverage/);
  rejectsChange(body => { body.cases[0].passes[1].pass = 1; }, /duplicate finding pass/);
  rejectsChange(body => { body.cases[0].passes[1].pass = 3; }, /finding pass/);
  rejectsChange(body => { body.cases[0].passes.push(structuredClone(body.cases[0].passes[0])); }, /coverage/);
});

test('truncation, empty raw output, tool calls and invalid parsing stay unscored', () => {
  const mutations = [
    ['status', 'failed'], ['finishReason', 'length'], ['parseValid', false],
    ['empty', true], ['truncated', true], ['toolCalls', 1],
  ];
  for (const [field, value] of mutations) {
    rejectsChange(body => { body.cases[0].passes[0][field] = value; }, /complete valid output/);
  }
  rejectsChange(body => { body.complete = false; }, /incomplete/);
});

test('screening permits first-pass reuse but requires a fresh applicable second pass', () => {
  const { expected, body } = fixture();
  body.cases[0].passes[0].reused = true;
  body.cases[0].passes[0].originReceiptId = 'incumbent-receipt';
  const result = verifyEvaluation(seal(body), trust, expected);
  assert.equal(result.calls[0].originReceiptId, 'incumbent-receipt');
  rejectsChange(value => {
    value.cases[0].passes[1].reused = true;
    value.cases[0].passes[1].originReceiptId = 'incumbent-receipt';
  }, /applicable second pass/);
});

test('screening can reuse an off-scope second pass; provenance is retained for the controller', () => {
  const { expected, body } = fixture();
  expected.cases[1].scope = 'input-validation';
  expected.applicableCaseIds = ['fit-1'];
  body.applicableCaseIds = ['fit-1'];
  body.cases[1].passes[1].reused = true;
  body.cases[1].passes[1].originReceiptId = 'incumbent-receipt';
  const result = verifyEvaluation(seal(body), trust, expected);
  const reused = result.calls.find(call => call.reused);
  assert.equal(reused.scope, 'input-validation');
  assert.equal(reused.pass, 2);
});

test('a same-fault case outside the reviewed applicability set may reuse its second pass', () => {
  const { expected, body } = fixture();
  expected.applicableCaseIds = ['fit-1'];
  body.applicableCaseIds = ['fit-1'];
  body.cases[1].passes[1].reused = true;
  body.cases[1].passes[1].originReceiptId = 'incumbent-receipt';
  const result = verifyEvaluation(seal(body), trust, expected);
  assert.equal(result.calls.find(call => call.reused).scope, 'concurrency');
  assert.deepEqual(result.applicableCaseIds, ['fit-1']);
});

test('baseline and confirmation receipts reject every reuse declaration', () => {
  for (const phase of ['baseline', 'confirmation']) {
    const { expected, body } = fixture(phase);
    body.cases[0].passes[0].reused = true;
    body.cases[0].passes[0].originReceiptId = 'earlier-receipt';
    assert.throws(() => verifyEvaluation(seal(body), trust, expected), /only screening/);
  }
});

test('reuse provenance cannot be absent, self-referential or attached to a fresh call', () => {
  rejectsChange(body => { body.cases[0].passes[0].reused = true; }, /originReceiptId/);
  rejectsChange(body => {
    body.cases[0].passes[0].reused = true;
    body.cases[0].passes[0].originReceiptId = body.receiptId;
  }, /reuse itself/);
  rejectsChange(body => { body.cases[0].passes[0].originReceiptId = 'earlier-receipt'; }, /fresh calls/);
  rejectsChange(body => { body.cases[0].passes[0].reused = 'false'; }, /explicit/);
});

test('aliases of a call or of the same provider turn cannot fill missing coverage', () => {
  rejectsChange(body => { body.cases[1].passes[0].callId = body.cases[0].passes[0].callId; }, /duplicate callId/);
  rejectsChange(body => {
    body.cases[1].passes[0].sessionId = body.cases[0].passes[0].sessionId;
    body.cases[1].passes[0].turnId = body.cases[0].passes[0].turnId;
  }, /duplicate session\/turn/);
});

test('normalized evidence is detached and frozen through nested metrics and pass records', () => {
  const { expected, body } = fixture();
  const result = verifyEvaluation(seal(body), trust, expected);
  body.cases[0].passes[0].callId = 'later-mutation';
  body.cases[0].caught = 0;
  assert.equal(result.cases[0].caught, 2);
  assert.equal(result.cases[0].passes[0].callId, 'fit-1-call-1');
  assert.throws(() => { result.splits.fit.net = 100; }, TypeError);
  assert.throws(() => { result.calls[0].callId = 'changed'; }, TypeError);
  assert.throws(() => { result.cases.push({}); }, TypeError);
});

function metrics(fitCaught, fitFalseAlarms, checkCaught, checkFalseAlarms) {
  const fit = { caught: fitCaught, falseAlarms: fitFalseAlarms, net: fitCaught - fitFalseAlarms };
  const check = { caught: checkCaught, falseAlarms: checkFalseAlarms, net: checkCaught - checkFalseAlarms };
  return {
    splits: { fit, check },
    totals: {
      caught: fitCaught + checkCaught,
      falseAlarms: fitFalseAlarms + checkFalseAlarms,
      net: fit.net + check.net,
    },
  };
}

test('one net gain and nonregressing fit/check splits pass comparison without promoting', () => {
  const result = compareEvaluations({
    base: metrics(3, 1, 2, 0),
    incumbent: metrics(3, 1, 2, 0),
    candidate: metrics(4, 1, 2, 0),
  });
  assert.deepEqual(result, { passed: true, reasons: [], gain: 1, baseGain: 1 });
  assert.equal(Object.hasOwn(result, 'active'), false);
});

test('a tie is not a successful learning attempt', () => {
  const unchanged = metrics(3, 1, 2, 0);
  const result = compareEvaluations({ base: unchanged, incumbent: unchanged, candidate: unchanged });
  assert.equal(result.passed, false);
  assert.deepEqual(result.reasons, ['gain_below_threshold']);
});

test('a larger total cannot hide regression on either split or against original BASE', () => {
  const fitRegression = compareEvaluations({
    base: metrics(3, 0, 2, 0), incumbent: metrics(3, 0, 2, 0), candidate: metrics(2, 0, 5, 0),
  });
  assert.equal(fitRegression.passed, false);
  assert.ok(fitRegression.reasons.includes('fit_below_incumbent'));
  assert.ok(fitRegression.reasons.includes('fit_below_base'));
  const checkRegression = compareEvaluations({
    base: metrics(3, 0, 3, 0), incumbent: metrics(2, 0, 2, 0), candidate: metrics(5, 0, 2, 0),
  });
  assert.equal(checkRegression.passed, false);
  assert.deepEqual(checkRegression.reasons, ['check_below_base']);
  const baseRegression = compareEvaluations({
    base: metrics(4, 0, 4, 0), incumbent: metrics(1, 0, 1, 0), candidate: metrics(2, 0, 2, 0),
  });
  assert.ok(baseRegression.reasons.includes('net_below_base'));
});

test('comparison refuses weak thresholds and manufactured score arithmetic', () => {
  const value = metrics(3, 0, 2, 0);
  for (const minimumGain of [0, -1, NaN, Infinity, 0.5]) {
    assert.throws(() => compareEvaluations({ base: value, incumbent: value, candidate: value }, { minimumGain }), /minimumGain/);
  }
  const inconsistent = structuredClone(value);
  inconsistent.totals.net = 100;
  assert.throws(() => compareEvaluations({ base: value, incumbent: value, candidate: inconsistent }), /inconsistent/);
  const wrongSplits = structuredClone(value);
  wrongSplits.totals.caught += 1;
  wrongSplits.totals.net += 1;
  assert.throws(() => compareEvaluations({ base: value, incumbent: value, candidate: wrongSplits }), /split totals/);
});
