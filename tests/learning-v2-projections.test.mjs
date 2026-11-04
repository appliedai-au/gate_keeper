/** Source prepared for the complete managed remote gate; do not run locally. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  POLICY, canonical, copy, digest, procedure, procedureFingerprint, record, version,
} from '../scripts/learning-v2/contracts.mjs';
import {
  learnerRequest, reviewerInstructions, statusView,
} from '../scripts/learning-v2/prompts.mjs';

const BASE = 'Frozen original instructions.\nReturn the required findings JSON.\n';
const FOCUS = 'concurrency-atomicity';
const PRIVATE_CANARY = 'HOST_ONLY_REJECTED_PROCEDURE_7e1b90';
const UNPROVEN_CANARY = 'HOST_ONLY_UNPROVEN_MATCH_REASON_31fa20';
const SCORE_CANARY = 'HOST_ONLY_NEGATIVE_SCORE_FEEDBACK_f9f8b0';
const PROCEDURE_KEYS = [
  'scope', 'languages', 'applicability', 'trigger', 'evidence', 'action', 'sufficientGuard',
].sort();

function proposal(overrides = {}) {
  return {
    scope: FOCUS,
    languages: ['kotlin'],
    applicability: 'A Spring JPA transaction updates a shared database row.',
    trigger: 'Two transactions can read the same row version before either commits.',
    evidence: 'Trace the read version and update predicate on the same row.',
    action: 'Report a lost update only when conflicting writes can both commit.',
    sufficientGuard: 'A version predicate plus a checked affected-row count rejects the stale writer.',
    ...overrides,
  };
}

function scopedRule(overrides = {}) {
  return {
    id: 'reviewed-jpa-procedure',
    procedure: procedure(proposal(), FOCUS),
    coverageCaseIds: ['spring-jpa-fit', 'spring-jpa-check'],
    ...overrides,
  };
}

function confirmedVersion(rules = [scopedRule()]) {
  return { ...version(BASE, rules), confirmed: true };
}

function excludesPrivate(value) {
  const bytes = typeof value === 'string' ? value : JSON.stringify(value);
  for (const canary of [PRIVATE_CANARY, UNPROVEN_CANARY, SCORE_CANARY]) {
    assert.equal(bytes.includes(canary), false, `private canary leaked: ${canary}`);
  }
}

test('procedures normalize only their declared fields and preserve exact identity', () => {
  const first = procedure(proposal({ languages: ['KOTLIN', 'Java'], trigger: '  Read\n shared   state.  ' }), FOCUS);
  const second = procedure(proposal({ languages: ['java', 'kotlin'], trigger: 'Read shared state.' }), FOCUS);
  assert.deepEqual(Object.keys(first).sort(), PROCEDURE_KEYS);
  assert.deepEqual(first.languages, ['java', 'kotlin']);
  assert.equal(first.trigger, 'Read shared state.');
  assert.equal(procedureFingerprint(first), procedureFingerprint(second));
});

test('a different sufficient guard or applicability is a different exact procedure', () => {
  const original = procedure(proposal(), FOCUS);
  const guarded = procedure(proposal({
    sufficientGuard: 'Compare the object generation as well as its value to reject an ABA transition.',
  }), FOCUS);
  const differentStack = procedure(proposal({
    languages: ['python'], applicability: 'An asyncio task updates a local in-memory generation counter.',
  }), FOCUS);
  assert.notEqual(procedureFingerprint(original), procedureFingerprint(guarded));
  assert.notEqual(procedureFingerprint(original), procedureFingerprint(differentStack));
  // Exact fingerprints make no claim about semantic equivalence. The signed
  // host review must decide that separately, including these guard/scope facts.
});

test('procedure schema rejects diagnostic fields, missing guards and scope drift', () => {
  for (const extra of ['score', 'negativeFeedback', 'novelty', 'activate']) {
    assert.throws(() => procedure(proposal({ [extra]: PRIVATE_CANARY }), FOCUS), /unexpected or missing fields/);
  }
  const missing = proposal();
  delete missing.sufficientGuard;
  assert.throws(() => procedure(missing, FOCUS), /unexpected or missing fields/);
  assert.throws(() => procedure(proposal({ scope: 'authorization' }), FOCUS), /outside frozen fault focus/);
  assert.throws(() => procedure(proposal({ languages: ['Java', 'java'] }), FOCUS), /duplicate language/);
  assert.throws(() => procedure(proposal({ action: 'unsafe\u0000text' }), FOCUS), /invalid text/);
});

test('procedure validation never invokes an object or language-array accessor', () => {
  let reads = 0;
  const objectAccessor = proposal();
  Object.defineProperty(objectAccessor, 'action', {
    enumerable: true, get() { reads += 1; return PRIVATE_CANARY; },
  });
  assert.throws(() => procedure(objectAccessor, FOCUS), /LEARNING_V2_REJECTED:/);
  const arrayAccessor = ['kotlin'];
  Object.defineProperty(arrayAccessor, '0', {
    enumerable: true, get() { reads += 1; return 'kotlin'; },
  });
  assert.throws(() => procedure(proposal({ languages: arrayAccessor }), FOCUS), /LEARNING_V2_REJECTED:/);
  const decorated = ['kotlin'];
  Object.defineProperty(decorated, 'map', { value() { reads += 1; return ['kotlin']; } });
  assert.throws(() => procedure(proposal({ languages: decorated }), FOCUS), /LEARNING_V2_REJECTED:/);
  assert.equal(reads, 0);
});

test('canonical JSON identity is independent of object order and copies defensively', () => {
  const input = { z: [false, null, { b: 2, a: 1 }], a: 'safe' };
  const reordered = { a: 'safe', z: [false, null, { a: 1, b: 2 }] };
  assert.equal(canonical(input), canonical(reordered));
  assert.equal(digest(input), digest(reordered));
  const cloned = copy(input);
  cloned.z[2].a = 99;
  assert.equal(input.z[2].a, 1);
  const plainDictionary = Object.create(null);
  plainDictionary.value = 'safe';
  assert.equal(canonical(plainDictionary), '{"value":"safe"}');
});

test('JSON identity rejects hidden fields, unsafe parsed keys and executable coercion', () => {
  let invoked = false;
  const accessor = {};
  Object.defineProperty(accessor, 'payload', {
    enumerable: true, get() { invoked = true; return 'untrusted'; },
  });
  const coercion = {};
  Object.defineProperty(coercion, 'toJSON', {
    value() { invoked = true; return { accepted: true }; },
  });
  const hidden = { allowed: true };
  Object.defineProperty(hidden, 'diagnostic', { value: PRIVATE_CANARY });
  const symbol = { allowed: true, [Symbol('diagnostic')]: PRIVATE_CANARY };
  const cycle = {};
  cycle.self = cycle;
  const values = [
    accessor, coercion, hidden, symbol, cycle, { value: undefined }, { value: NaN },
    { value: Infinity }, { value: 1n }, { value: () => true }, { value: new Date() },
    { value: new Map() }, { value: [, 'sparse'] },
    JSON.parse('{"__proto__":{"polluted":true}}'),
    JSON.parse('{"constructor":{"prototype":{"polluted":true}}}'),
    JSON.parse('{"prototype":{"polluted":true}}'),
  ];
  for (const value of values) assert.throws(() => canonical(value), /LEARNING_V2_REJECTED:/);
  assert.throws(() => record(hidden, ['allowed'], 'example'), /unexpected or missing fields/);
  assert.throws(() => record(symbol, ['allowed'], 'example'), /unexpected or missing fields/);
  assert.throws(() => record(accessor, ['payload'], 'example'), /non-data property/);
  assert.equal(invoked, false);
  assert.equal({}.polluted, undefined);
});

test('deep JSON is rejected before unbounded recursive processing', () => {
  let value = { leaf: true };
  for (let depth = 0; depth < 70; depth += 1) value = { child: value };
  assert.throws(() => canonical(value), /nesting exceeds limit/);
});

test('prompt identity binds reviewed case coverage and excludes wrapper diagnostics', () => {
  const firstRule = scopedRule({
    matchReasons: PRIVATE_CANARY, scores: SCORE_CANARY, diagnostics: UNPROVEN_CANARY,
  });
  const first = version(BASE, [firstRule]);
  const differentCoverage = version(BASE, [scopedRule({ coverageCaseIds: ['python-async-fit'] })]);
  assert.notEqual(first.promptDigest, differentCoverage.promptDigest);
  assert.deepEqual(first.artifact.rules[0].coverageCaseIds, ['spring-jpa-fit', 'spring-jpa-check']);
  excludesPrivate(first.artifact);
  firstRule.coverageCaseIds.push('changed-after-construction');
  firstRule.procedure.action = 'changed-after-construction';
  assert.deepEqual(first.artifact.rules[0].coverageCaseIds, ['spring-jpa-fit', 'spring-jpa-check']);
  assert.notEqual(first.artifact.rules[0].procedure.action, firstRule.procedure.action);
});

test('learner input contains only confirmed procedure fields and approved example text', () => {
  const activeVersion = confirmedVersion([scopedRule({
    outcome: PRIVATE_CANARY, matchReasons: UNPROVEN_CANARY, scores: SCORE_CANARY,
  })]);
  activeVersion.negativeBank = [{ feedback: PRIVATE_CANARY }];
  activeVersion.unprovenBank = [{ procedure: UNPROVEN_CANARY }];
  const input = learnerRequest({
    scope: FOCUS, activeVersion, baselineInstructions: BASE,
    history: [{ procedure: PRIVATE_CANARY, score: SCORE_CANARY }],
    rejectedProcedures: [PRIVATE_CANARY], unresolvedReasons: [UNPROVEN_CANARY],
    fitExamples: [{ caseId: 'host-only-case-id', code: 'row.value = nextValue;',
      feedback: 'The original baseline missed the unguarded read-modify-write.',
      diagnostics: SCORE_CANARY }],
  });
  excludesPrivate(input);
  assert.deepEqual(Object.keys(input).sort(), [
    'baselineInstructions', 'confirmedProcedures', 'fitExamples', 'instructions', 'scope',
  ]);
  assert.equal(input.baselineInstructions, BASE);
  assert.deepEqual(Object.keys(input.confirmedProcedures[0]).sort(), PROCEDURE_KEYS);
  assert.deepEqual(Object.keys(input.fitExamples[0]).sort(), ['code', 'feedback']);
  assert.equal(JSON.stringify(input).includes('host-only-case-id'), false);
  assert.match(input.confirmedProcedures[0].action, /lost update/);
});

test('learner rejects provisional versions and diagnostic fields inside a procedure', () => {
  assert.throws(() => learnerRequest({ scope: FOCUS, baselineInstructions: BASE,
    activeVersion: { ...version(BASE, [scopedRule()]), confirmed: false } }), /confirmed version required/);
  const activeVersion = confirmedVersion();
  activeVersion.rules[0].procedure.negativeFeedback = PRIVATE_CANARY;
  assert.throws(() => learnerRequest({ scope: FOCUS, activeVersion, baselineInstructions: BASE }), /unexpected or missing fields/);
});

test('historical bank getters are not consulted by either prompt projection', () => {
  let bankReads = 0;
  const activeVersion = confirmedVersion();
  const request = { scope: FOCUS, activeVersion, baselineInstructions: BASE };
  for (const target of [request, activeVersion, activeVersion.rules[0]]) {
    Object.defineProperty(target, 'history', {
      get() { bankReads += 1; throw new Error(PRIVATE_CANARY); },
    });
  }
  excludesPrivate(learnerRequest(request));
  excludesPrivate(reviewerInstructions({ ...request, originalInstructions: BASE,
    caseId: 'spring-jpa-fit', pass: 2 }));
  assert.equal(bankReads, 0);
});

test('first-pass instructions stay byte-identical and do not read candidate rules', () => {
  let ruleReads = 0;
  const activeVersion = {};
  Object.defineProperty(activeVersion, 'rules', {
    get() { ruleReads += 1; throw new Error(PRIVATE_CANARY); },
  });
  assert.equal(reviewerInstructions({ originalInstructions: BASE, activeVersion,
    scope: FOCUS, pass: 1 }), BASE);
  assert.equal(ruleReads, 0);
});

test('candidate second-pass rules route only to reviewed cases, even within the same fault focus', () => {
  const candidate = { ...version(BASE, [scopedRule({
    diagnostics: PRIVATE_CANARY, matchReasons: UNPROVEN_CANARY, scoreFeedback: SCORE_CANARY,
  })]), confirmed: false };
  const matched = reviewerInstructions({ originalInstructions: BASE, activeVersion: candidate,
    scope: FOCUS, caseId: 'spring-jpa-fit', pass: 2 });
  assert.match(matched, /Spring JPA transaction/);
  assert.match(matched, /checked affected-row count/);
  excludesPrivate(matched);
  // A Python/asyncio task can have the same atomicity fault label. It still
  // must not receive a JPA-specific procedure without reviewed code coverage.
  assert.equal(reviewerInstructions({ originalInstructions: BASE, activeVersion: candidate,
    scope: FOCUS, caseId: 'python-async-fit', pass: 2 }), BASE);
  assert.equal(reviewerInstructions({ originalInstructions: BASE, activeVersion: candidate,
    scope: 'authorization', caseId: 'spring-jpa-fit', pass: 2 }), BASE);
});

test('second pass requires an explicit case and only the two declared passes exist', () => {
  const request = { originalInstructions: BASE, activeVersion: confirmedVersion(), scope: FOCUS };
  assert.throws(() => reviewerInstructions({ ...request, pass: 2 }), /reviewed caseId/);
  for (const pass of [0, 3, '2', null]) {
    assert.throws(() => reviewerInstructions({ ...request, pass, caseId: 'spring-jpa-fit' }), /invalid reviewer pass/);
  }
});

test('app status exposes counts and state without private procedures or diagnostic feedback', () => {
  const base = { ...confirmedVersion([]), origin: 'frozen-base' };
  const state = {
    config: { experimentId: 'projection-test', sourceCommit: 'a'.repeat(40), scope: FOCUS },
    policy: copy(POLICY), baseVersion: base, activeVersionId: base.id,
    versions: [base, { confirmed: false, rules: [{ procedure: PRIVATE_CANARY }] }],
    history: [{ procedure: PRIVATE_CANARY, matchReasons: UNPROVEN_CANARY }],
    attempts: [
      { status: 'duplicate', reason: PRIVATE_CANARY, novelty: { reason: UNPROVEN_CANARY } },
      { status: 'rejected', screen: { feedback: SCORE_CANARY }, candidate: PRIVATE_CANARY },
      { status: 'unresolved', reason: UNPROVEN_CANARY },
    ],
    activationHistory: [], operations: [{ id: 'pending-admitted-operation', settled: false,
      diagnostics: SCORE_CANARY }], budget: { spentMicros: 1250, reservedMicros: 500 }, gate: null,
  };
  const result = statusView(state);
  excludesPrivate(result);
  assert.equal(result.counts.attempted, 3);
  assert.equal(result.counts.scored, 1);
  assert.equal(result.counts.duplicate, 1);
  assert.equal(result.counts.rejected, 1);
  assert.equal(result.counts.unresolved, 1);
  assert.equal(result.counts.activated, 0);
  assert.equal(result.incumbentVersion, base.id);
  assert.equal(result.confirmedVersions, 0);
  assert.equal(result.pendingOperation, 'pending-admitted-operation');
  assert.equal(result.qualification, 'source-only-unqualified');
  assert.equal(result.deployment, 'not-managed-by-learning-core');
  assert.equal(result.budget.authoritative, 'external-gateway');
});

test('public baseline status uses fixed enums without raw failure or non-admission receipt details', () => {
  const base = { ...confirmedVersion([]), origin: 'frozen-base' };
  const privateReceiptId = 'BASELINE_NON_ADMISSION_RECEIPT_PRIVATE_8af2';
  const privateOperationId = 'BASELINE_NON_ADMISSION_OPERATION_PRIVATE_49c1';
  const privateDigest = digest('private original non-admission envelope bytes');
  const common = {
    config: { experimentId: 'baseline-projection-test', sourceCommit: 'a'.repeat(40), scope: FOCUS },
    policy: copy(POLICY), baseVersion: base, activeVersionId: base.id,
    versions: [base], attempts: [], activationHistory: [], operations: [],
    budget: { spentMicros: 1250, reservedMicros: 0 }, gate: null, baseline: null,
  };
  const planned = { baselinePlan: { privateRequest: PRIVATE_CANARY } };
  const cases = [
    { state: {}, expected: { status: 'not-planned', failureCode: null } },
    { state: planned, expected: { status: 'planned', failureCode: null } },
    { state: { ...planned, baseline: { receiptId: privateReceiptId, bodyDigest: privateDigest, raw: SCORE_CANARY } },
      expected: { status: 'complete', failureCode: null } },
    { state: { ...planned, baselineError: PRIVATE_CANARY },
      expected: { status: 'failed', failureCode: 'unresolved' } },
    { state: { ...planned, baselineError: UNPROVEN_CANARY, baselineNonAdmission: {
      operationId: privateOperationId, requestDigest: privateDigest, receiptId: privateReceiptId,
      receiptDigest: privateDigest, rawEnvelope: SCORE_CANARY,
    } }, expected: { status: 'failed', failureCode: 'not-admitted' } },
  ];
  for (const { state, expected } of cases) {
    const result = statusView({ ...common, ...state });
    assert.deepEqual(result.baseline, expected);
    assert.deepEqual(Object.keys(result.baseline).sort(), ['failureCode', 'status']);
    excludesPrivate(result);
    const serialized = JSON.stringify(result);
    for (const secret of [privateReceiptId, privateOperationId, privateDigest]) {
      assert.equal(serialized.includes(secret), false, 'private baseline evidence leaked');
    }
  }
});
