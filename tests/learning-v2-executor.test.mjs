import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { verifyEnvelope } from '../scripts/learning-trust.mjs';
import { POLICY, configuration, copy, digest, procedure, version } from '../scripts/learning-v2/contracts.mjs';
import { verifyEvaluation } from '../scripts/learning-v2/evidence.mjs';
import { createLearningExecutor } from '../scripts/learning-v2/executor.mjs';
import { MemoryJournal } from '../scripts/learning-v2/journal.mjs';
import { CHAIN_ASK, LEGACY_BAG_BLOB, LEGACY_RENDERER_ID } from '../scripts/learning-v2/legacy-renderer.mjs';
import { OperationArchive } from '../scripts/learning-v2/operation-archive.mjs';
import { learnerRequest } from '../scripts/learning-v2/prompts.mjs';
import { TURN_CONFIG, turnInputDigest } from '../scripts/learning-v2/trueforge-turn.mjs';

// SOURCE ONLY pending the managed remote gate. These tests exercise the real
// executor, SDK-turn adapter, receipt verifier and CAS archive with synthetic
// SDK responses and independent fixture keys. No network or model calls occur.
const sha = value => createHash('sha256').update(value).digest('hex');
const BASE = 'Review the numbered code and return JSON findings.\n\nExtra field: quote the defective line.';
const SOURCE = 'a'.repeat(40);
const rule = label => procedure({ scope: 'concurrency', languages: ['javascript'],
  applicability: 'A JavaScript service writes a value derived from shared state.',
  trigger: 'A read determines a later write to the same shared value.',
  evidence: `Trace the revision predicate and intervening writer: ${label}.`,
  action: `Report the write only when an intervening update can be lost: ${label}.`,
  sufficientGuard: 'A compare-and-swap predicate covers the same revision and target.' }, 'concurrency');

function syntheticKey() {
  const pair = generateKeyPairSync('ed25519');
  return { trust: { publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
    pinnedFingerprint: sha(pair.publicKey.export({ type: 'spki', format: 'der' })) },
  seal: body => ({ body, signature: sign(null, Buffer.from(JSON.stringify(body)), pair.privateKey).toString('base64') }) };
}

function freeze(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

function codeInput(caseId) {
  const lines = caseId.endsWith('python') ? [
    `fixture_name = "${caseId}"`, 'before = shared.count', 'inspect(before)',
    'next_value = before + 1', 'count += 1', 'audit(next_value)', 'publish(next_value)',
  ] : [
    `const fixtureName = "${caseId}";`, 'const before = shared.count;', 'inspect(before);',
    'const next = before + 1;', 'count += 1;', 'audit(next);', 'publish(next);',
  ];
  return { caseId, prompt: `Review this code.\n\`\`\`${caseId.endsWith('python') ? 'python' : 'javascript'}\n` +
    lines.map((line, index) => `${index + 1} | ${line}`).join('\n') + '\n```' };
}

function fixture({ kind = 'baseline', extraCase = false, confirmed = false, privateHistory = false, reply = null } = {}) {
  const caseIds = ['fit-js', 'check-js', ...(extraCase ? ['fit-python'] : [])];
  const applicableCaseIds = ['fit-js', 'check-js'];
  const caseInputs = caseIds.map(codeInput);
  const runtime = { schema: 'gk-learning-v2-runtime-v1', sdkVersion: '0.180.0', serverVersion: '0.180.0',
    provider: 'truefoundry', memory: 'off', sessionMode: 'inline-root-per-call',
    model: { name: 'tfy-direct/test-model', params: { temperature: 0, maxTokens: 1500 } },
    turnConfig: copy(TURN_CONFIG), renderer: LEGACY_RENDERER_ID, bagBlob: LEGACY_BAG_BLOB,
    caseInputsDigest: digest(caseInputs) };
  const keys = { evaluation: syntheticKey(), novelty: syntheticKey() };
  const trustPins = { evaluation: keys.evaluation.trust.pinnedFingerprint,
    novelty: keys.novelty.trust.pinnedFingerprint, budget: sha('fixture budget key'),
    activation: sha('fixture activation key'), gatewayId: 'fixture-global-gateway' };
  const config = configuration({ experimentId: 'executor-fixture', sourceCommit: SOURCE,
    benchmarkDigest: sha('fixture development corpus and oracle'), scorerDigest: sha('fixture line-membership scorer'),
    model: runtime.model.name, scope: 'concurrency', baseInstructions: BASE,
    firstPassInstructionsDigest: sha(BASE), runtimeDigest: digest(runtime), budgetId: 'fixture-programme',
    gatePolicy: { targetId: 'fixture-target', presetDigest: sha('fixture preset'),
      outputProfileDigest: sha('fixture profile'), effectiveTreeDigest: sha('fixture tree') },
    cases: caseIds.map(caseId => ({ caseId, split: caseId.startsWith('check') ? 'check' : 'fit',
      scope: 'concurrency', expectedBugs: 3, passes: 2, learnerVisible: !caseId.startsWith('check') })) });
  const base = { ...version(BASE, []), confirmed: true };
  const incumbent = confirmed ? { ...version(BASE, [{ id: 'confirmed-rule', procedure: rule('CONFIRMED_POSITIVE'),
    coverageCaseIds: applicableCaseIds }], base.id), confirmed: true } : base;
  const proposed = rule('NEW_RULE_CANARY');
  const candidate = version(BASE, [...incumbent.rules,
    { id: 'candidate-rule', procedure: proposed, coverageCaseIds: applicableCaseIds }], incumbent.id);
  const history = privateHistory ? ['rejected', 'unproven'].map(outcome => ({ id: `historical-${outcome}`, outcome,
    sourceRef: 'fixture-history-source', procedure: rule(`${outcome.toUpperCase()}_RULE_CANARY`) })) : [];
  const earlierAttempts = privateHistory ? [{ id: 'earlier-attempt', status: 'unresolved',
    candidate: rule('ABANDONED_RULE_CANARY'), reason: 'PRIVATE_FAILURE_REASON_CANARY' }] : [];
  const priorReferences = [...history, ...earlierAttempts.map(item => ({ id: item.id,
    procedure: item.candidate, outcome: item.status, sourceRef: SOURCE }))];
  const configDigest = digest({ config, policy: POLICY, trustPins, history });
  const attemptId = kind === 'baseline' ? null : 'executor-fixture:attempt:1';
  const namespace = `executor-fixture:${kind}`;
  const expected = (phase, artifact, pairId, executionIndex, applicable = caseIds) => ({
    experimentId: config.experimentId, sourceCommit: SOURCE, benchmarkDigest: config.benchmarkDigest,
    scorerDigest: config.scorerDigest, model: config.model, scope: config.scope, phase,
    namespace, pairId, promptDigest: digest(artifact), executionIndex, applicableCaseIds: applicable,
    cases: config.cases.map(({ learnerVisible, ...item }) => item),
  });
  const prompts = kind === 'baseline' ? { base: base.artifact } :
    { base: base.artifact, incumbent: incumbent.artifact, ...(kind === 'proposal' ? {} : { candidate: candidate.artifact }) };
  let plan, requiredCalls;
  if (kind === 'baseline') {
    plan = expected(kind, base.artifact, namespace, 0); requiredCalls = caseIds.length * 2;
  } else if (kind === 'proposal') {
    plan = { attemptId, historyDigest: digest(priorReferences) }; requiredCalls = 1;
  } else if (kind === 'screen') {
    plan = { incumbent: expected(kind, incumbent.artifact, namespace, 0),
      candidate: expected(kind, candidate.artifact, namespace, 1, applicableCaseIds) };
    requiredCalls = caseIds.length * 2 + applicableCaseIds.length;
  } else {
    const forward = confirmed ? ['base', 'incumbent', 'candidate'] : ['incumbent', 'candidate'];
    plan = { namespace, decision: POLICY.confirmationDecision, additionalPairs: 0,
      pairs: Array.from({ length: POLICY.confirmationPairs }, (_, index) => {
        const pairId = `${namespace}:pair:${index + 1}`;
        const order = index % 2 ? [...forward].reverse() : [...forward];
        return { pairId, order, expectations: Object.fromEntries(order.map((arm, executionIndex) =>
          [arm, expected(kind, prompts[arm], pairId, executionIndex, arm === 'candidate' ? applicableCaseIds : caseIds)])) };
      }) };
    requiredCalls = POLICY.confirmationPairs * forward.length * caseIds.length * 2;
  }
  const learner = kind === 'proposal' ? learnerRequest({ scope: config.scope, activeVersion: incumbent,
    baselineInstructions: BASE, fitExamples: [{ code: 'FROZEN_FIT_CODE_CANARY', feedback: 'FROZEN_FIT_FEEDBACK_CANARY',
      expectedAnswer: 'WRAPPER_ORACLE_CANARY', rejectedRule: 'WRAPPER_NEGATIVE_CANARY' }] }) : null;
  const request = freeze(copy({ schema: 'gk-learning-v2-execution-request', experimentId: config.experimentId,
    configDigest, sourceCommit: SOURCE, kind, attemptId, namespace, provider: 'truefoundry', memory: 'off',
    model: config.model, runtimeDigest: config.runtimeDigest, firstPassInstructionsDigest: config.firstPassInstructionsDigest,
    policy: POLICY, authorityPins: trustPins, originalVersionId: base.id, incumbentVersionId: incumbent.id,
    managedGateDigest: sha('fixture admitted managed gate'), requiredCalls, plan, prompts, learner }));
  const operation = freeze({ id: `fixture:operation:${kind}`, kind, attemptId, namespace, requestDigest: digest(request),
    leaseId: `fixture:lease:${kind}`, maxCalls: requiredCalls, reservationMicros: 1_000_000,
    settled: false, consumed: false, observedFreshCalls: 0, evidenceComplete: false });
  const state = freeze(copy({ config, configDigest, trustPins, history, baseVersion: base, activeVersionId: incumbent.id,
    versions: confirmed ? [base, incumbent] : [base], operations: [operation], attempts: [...earlierAttempts,
      ...(attemptId ? [{ id: attemptId, candidate: kind === 'proposal' ? null : proposed,
        historyDigest: digest(priorReferences), status: kind === 'proposal' ? 'reserved' : `${kind}Planned` }] : [])] }));
  // This is a frozen host admission fixture, not a second controller engine.
  const controller = { state: async () => copy(state), executionRequest: async (requestedKind, requestedAttempt) => {
    assert.equal(requestedKind, kind); assert.equal(requestedAttempt, attemptId); return copy(request);
  } };
  const journal = new MemoryJournal(), archive = new OperationArchive({ journal });
  const sessions = [], turns = [], timeline = [], sdkOptions = [];
  const bySession = new Map();
  const client = { sessions: {
    async create(value, options) {
      sdkOptions.push(options);
      const sessionId = `session:${sessions.length + 1}`;
      const item = { sessionId, request: copy(value) };
      sessions.push(item); bySession.set(sessionId, item);
      return { data: { id: sessionId, metadata: copy(value.metadata) } };
    },
    async createTurn(sessionId, value, options) {
      sdkOptions.push(options);
      const session = bySession.get(sessionId), instructions = session.request.agent.spec.instructions;
      const message = value.input[0].content;
      const pass = message.includes(CHAIN_ASK.split('%LIST%')[0]) ? 2 : 1;
      const info = { index: turns.length, sessionId, instructions, message, pass,
        candidate: instructions.includes('NEW_RULE_CANARY') };
      const fallback = kind === 'proposal' ? { text: JSON.stringify(proposed) } : {
        text: JSON.stringify({ findings: (pass === 1 ? [2] : info.candidate ? [5, 7] : [5])
          .map(line => ({ line, comment: `fixture defect at ${line}` })) }),
      };
      const response = reply ? reply(info, fallback) : fallback;
      const output = { id: `message:${turns.length + 1}`, type: 'model.message', threadId: 'main', role: 'assistant',
        createdAt: '2026-11-04T00:00:00Z', content: response.text, finishReason: response.finishReason ?? 'stop' };
      const turn = { id: `turn:${turns.length + 1}`, sessionId, previousTurnId: null,
        createdAt: '2026-11-04T00:00:00Z', state: { status: 'done', completedAt: '2026-11-04T00:00:01Z',
          output, requiredActions: [], metrics: { totalCostInUsd: 0.002, totalInputTokens: 50, totalOutputTokens: 10 } } };
      session.turn = turn; turns.push({ ...info, turn: copy(turn), request: copy(value) });
      timeline.push(`turn:${info.candidate ? 'candidate' : 'control'}`);
      return { data: copy(turn) };
    },
    async getTurn() { assert.fail('terminal fixture turns must not be polled'); },
    async listTurnEvents(sessionId, turnId, _query, options) {
      sdkOptions.push(options);
      const turn = bySession.get(sessionId).turn; assert.equal(turn.id, turnId);
      return { response: { data: [copy(turn.state.output)], pagination: { limit: 100 } },
        rawResponse: { headers: { authorization: 'TRANSPORT_SECRET_CANARY' } } };
    },
  } };
  // Frozen fixture truth belongs to this independent issuer, never model input.
  const oracle = new Map(caseIds.map(caseId => [caseId, new Set([2, 5, 7])]));
  const evaluationIssues = [], noveltyIssues = [];
  const authorities = {
    evaluation: { ...keys.evaluation.trust, async issue(input) {
      evaluationIssues.push(copy(input)); timeline.push('issue:evaluation');
      const { cases: manifest, ...identity } = input.expected;
      assert.deepEqual(input.observation.cases.map(item => item.caseId), manifest.map(item => item.caseId));
      const cases = input.observation.cases.map(item => {
        const known = oracle.get(item.caseId), reported = new Set(item.mergedFindings.map(finding => finding.start));
        for (const [index, pass] of item.passes.entries()) {
          const raw = item.rawTurns[index];
          assert.equal(pass.callId, raw.callId); assert.equal(pass.sessionId, raw.sessionId);
          assert.equal(pass.turnId, raw.turnId); assert.equal(pass.inputDigest, raw.inputDigest);
          assert.equal(pass.outputDigest, sha(raw.text)); assert.equal(raw.complete, true);
        }
        return { caseId: item.caseId, caught: [...reported].filter(line => known.has(line)).length,
          falseAlarms: [...reported].filter(line => !known.has(line)).length, passes: copy(item.passes) };
      });
      return keys.evaluation.seal({ schema: 'gk-learning-v2-evaluation', receiptId: `fixture-evaluation:${evaluationIssues.length}`,
        ...identity, provider: 'truefoundry', memory: 'off', complete: true, cases });
    } },
    novelty: { ...keys.novelty.trust, async issue(input) {
      noveltyIssues.push(copy(input)); timeline.push('issue:novelty');
      return keys.novelty.seal({ schema: 'gk-learning-v2-novelty', receiptId: 'fixture-novelty:1', ...input.expected,
        verdict: 'novel', comparisons: input.priorReferences.map(item => ({ priorId: item.id,
          relation: 'distinct', reason: 'Distinct synthetic fixture procedures.' })), coverageCaseIds: applicableCaseIds });
    } },
  };
  const makeExecutor = overrides => createLearningExecutor({ controller, client, runtime, caseInputs,
    archiveFactory: async () => archive, authorities,
    timing: { clock: () => 0, pause: async () => {}, timeoutMs: 1000, pollIntervalMs: 1 }, ...overrides });
  const dispatch = () => ({ request: copy(request), operation: copy(operation),
    receiptContext: { operationId: operation.id, requestDigest: operation.requestDigest } });
  const verify = (envelope, expectation) => verifyEvaluation(envelope, keys.evaluation.trust,
    { ...expectation, operationId: operation.id, requestDigest: operation.requestDigest });
  return { request, operation, state, runtime, caseInputs, controller, client, archive, journal, authorities,
    sessions, turns, timeline, sdkOptions, evaluationIssues, noveltyIssues, priorReferences,
    makeExecutor, dispatch, verify, keys, proposed };
}

test('baseline freezes admitted input and archives both fresh passes, raw IDs and verifiable original receipt bytes', async () => {
  const f = fixture(), input = f.dispatch();
  f.controller.state = async () => {
    input.request.prompts.base.baseInstructions = 'CALLER_MUTATION_CANARY';
    input.operation.id = 'mutated-operation'; input.receiptContext.operationId = 'mutated-context';
    return copy(f.state);
  };
  const result = await f.makeExecutor()(input);
  const verified = f.verify(result.evaluation, f.request.plan), saved = await f.archive.read();
  assert.deepEqual(verified.totals, { caught: 4, falseAlarms: 0, net: 4 });
  assert.deepEqual(verified.calls.map(item => item.pass), [1, 2, 1, 2]);
  assert.equal(f.turns.length, 4); assert.equal(f.evaluationIssues.length, 1);
  assert.deepEqual(saved.request, f.request); assert.deepEqual(saved.operation, f.operation);
  for (const [index, entry] of saved.calls.entries()) {
    assert.deepEqual(entry.stages.map(item => item.stage), ['session', 'turn', 'final']);
    const raw = entry.stages.at(-1).payload;
    assert.equal(raw.sessionId, `session:${index + 1}`); assert.equal(raw.turnId, `turn:${index + 1}`);
    assert.equal(raw.raw.events[0].id, `message:${index + 1}`);
    assert.equal(raw.inputDigest, turnInputDigest(entry.call)); assert.equal(raw.outputDigest, sha(raw.text));
    assert.equal(raw.complete, true); assert.deepEqual(raw.toolCalls, []); assert.deepEqual(raw.requiredActions, []);
    assert.equal(verified.calls[index].callId, entry.call.callId); assert.equal(verified.calls[index].reused, false);
    assert.deepEqual(f.sessions[index].request.agent.spec.config, TURN_CONFIG);
    assert.equal(f.turns[index].request.previousTurnId, 'none');
  }
  const stored = saved.artifacts.find(item => item.kind === 'evaluation');
  assert.equal(stored.payload.serialized, JSON.stringify(result.evaluation));
  assert.equal(f.verify(JSON.parse(stored.payload.serialized), f.request.plan).bodyDigest, verified.bodyDigest);
  assert.ok(f.sdkOptions.every(item => item.maxRetries === 0));
  assert.doesNotMatch(JSON.stringify(saved), /CALLER_MUTATION_CANARY|TRANSPORT_SECRET_CANARY|rawResponse/);
  // The second reply must reach the joint BAG merge without pre-deduplication:
  // pre-processing [2, 3] first would discard 3, then first-pass line 1 removes 2.
  const adjacent = fixture({ reply: ({ pass }) => ({ text: JSON.stringify({ findings:
    (pass === 1 ? [1] : [2, 3]).map(line => ({ line, comment: `adjacent fixture ${line}` })) }) }) });
  await adjacent.makeExecutor()(adjacent.dispatch());
  for (const item of adjacent.evaluationIssues[0].observation.cases) {
    assert.deepEqual(item.mergedFindings.map(finding => finding.start), [1, 3]);
  }
});

test('screen finishes the incumbent before candidate calls and reuses exact first-pass and nonapplicable evidence', async () => {
  const f = fixture({ kind: 'screen', extraCase: true });
  const result = await f.makeExecutor()(f.dispatch());
  const control = f.verify(result.incumbent, f.request.plan.incumbent);
  const candidate = f.verify(result.candidate, f.request.plan.candidate);
  assert.equal(f.request.requiredCalls, 8); assert.equal(f.turns.length, 8);
  assert.deepEqual(f.timeline, [...Array(6).fill('turn:control'), 'issue:evaluation',
    'turn:candidate', 'turn:candidate', 'issue:evaluation']);
  assert.deepEqual(control.totals, { caught: 6, falseAlarms: 0, net: 6 });
  assert.deepEqual(candidate.totals, { caught: 8, falseAlarms: 0, net: 8 });
  for (const item of candidate.calls) {
    const prior = control.calls.find(old => old.caseId === item.caseId && old.pass === item.pass);
    if (item.pass === 1 || item.caseId === 'fit-python') {
      for (const key of ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest']) assert.equal(item[key], prior[key]);
      assert.equal(item.reused, true); assert.equal(item.originReceiptId, control.receiptId);
    } else {
      assert.equal(item.reused, false); assert.equal(item.originReceiptId, null); assert.notEqual(item.callId, prior.callId);
    }
  }
  const offscope = candidate.cases.find(item => item.caseId === 'fit-python');
  assert.equal(offscope.scope, 'concurrency'); assert.equal(offscope.caught, 2); assert.equal(offscope.falseAlarms, 0);
  assert.deepEqual(f.evaluationIssues[1].observation.cases[2].mergedFindings,
    f.evaluationIssues[0].observation.cases[2].mergedFindings);
  assert.equal((await f.archive.read()).calls.length, f.operation.maxCalls);
});

test('confirmation uses three alternating blocks with fresh calls, including a separate original-base arm when required', async () => {
  for (const confirmed of [false, true]) {
    const f = fixture({ kind: 'confirmation', confirmed });
    const result = await f.makeExecutor()(f.dispatch());
    const expectedOrders = confirmed ? [
      ['base', 'incumbent', 'candidate'], ['candidate', 'incumbent', 'base'], ['base', 'incumbent', 'candidate'],
    ] : [['incumbent', 'candidate'], ['candidate', 'incumbent'], ['incumbent', 'candidate']];
    assert.deepEqual(f.request.plan.pairs.map(item => item.order), expectedOrders);
    assert.equal(result.pairs.length, 3); assert.equal(f.turns.length, confirmed ? 36 : 24);
    const all = [];
    for (const [index, pair] of result.pairs.entries()) {
      const planned = f.request.plan.pairs[index]; assert.deepEqual(Object.keys(pair).sort(), [...planned.order].sort());
      for (const arm of planned.order) all.push(f.verify(pair[arm], planned.expectations[arm]));
    }
    assert.deepEqual(f.evaluationIssues.map(item => [item.expected.pairId, item.expected.executionIndex, item.expected.promptDigest]),
      all.map(item => [item.pairId, item.executionIndex, item.promptDigest]));
    const calls = all.flatMap(item => item.calls);
    assert.equal(calls.length, f.operation.maxCalls);
    assert.equal(new Set(calls.map(item => item.callId)).size, calls.length);
    assert.equal(new Set(calls.map(item => `${item.sessionId}/${item.turnId}`)).size, calls.length);
    assert.ok(calls.every(item => !item.reused && item.originReceiptId === null));
    assert.equal((await f.archive.read()).calls.length, calls.length);
  }
});

test('an incomplete or malformed first pass stops before a second dispatch or evaluator issuance and retains the hold', async () => {
  for (const response of [{ text: '{"findings":[]}', finishReason: 'length' }, { text: '{"findings":[null]}' }]) {
    const f = fixture({ reply: () => response }), before = copy(f.state);
    await assert.rejects(f.makeExecutor()(f.dispatch()), /LEARNING_V2_REJECTED/);
    assert.equal(f.turns.length, 1); assert.equal(f.sessions.length, 1);
    assert.deepEqual(f.evaluationIssues, []); assert.deepEqual(f.noveltyIssues, []);
    const saved = await f.archive.read(); assert.equal(saved.calls.length, 1); assert.deepEqual(saved.artifacts, []);
    assert.equal(saved.calls[0].stages.at(-1).stage, 'final');
    assert.equal(saved.calls[0].stages.at(-1).payload.text, response.text);
    assert.deepEqual(f.state, before); assert.equal(saved.operation.settled, false);
    assert.equal(saved.operation.reservationMicros, 1_000_000);
  }
});

test('runtime, corpus, authority and timing substitution refuse before any SDK call or archive claim', async () => {
  for (const variant of ['runtime', 'corpus', 'oracle-field', 'authority-pin', 'authority-key', 'timing']) {
    const f = fixture(), overrides = {};
    if (variant === 'runtime') {
      overrides.runtime = copy(f.runtime); overrides.runtime.model.params.temperature = 0.5;
    } else if (variant === 'corpus' || variant === 'oracle-field') {
      overrides.caseInputs = copy(f.caseInputs);
      if (variant === 'corpus') overrides.caseInputs[0].prompt += '\nchanged';
      else overrides.caseInputs[0].expectedBugs = ['ORACLE_MUST_NOT_REACH_MODEL'];
    } else if (variant === 'authority-pin' || variant === 'authority-key') {
      const replacement = syntheticKey().trust;
      overrides.authorities = { ...f.authorities, evaluation: { ...f.authorities.evaluation,
        publicKeyPem: replacement.publicKeyPem,
        pinnedFingerprint: variant === 'authority-pin' ? replacement.pinnedFingerprint : f.authorities.evaluation.pinnedFingerprint } };
    } else overrides.timing = { client: f.client };
    await assert.rejects(async () => f.makeExecutor(overrides)(f.dispatch()), /LEARNING_V2_REJECTED/);
    assert.deepEqual(f.sessions, []); assert.deepEqual(f.turns, []); assert.deepEqual(f.evaluationIssues, []);
    assert.equal((await f.archive.read()).operation, null); assert.equal((await f.journal.read()).head, null);
  }
});

test('an already claimed operation cannot be reopened or dispatched and its private journal remains unchanged', async () => {
  const f = fixture(); await f.archive.claimOperation(f.operation, f.request);
  const before = await f.journal.read();
  await assert.rejects(f.makeExecutor()(f.dispatch()), /archive operation already claimed/);
  assert.deepEqual(f.sessions, []); assert.deepEqual(f.turns, []); assert.deepEqual(f.evaluationIssues, []);
  assert.deepEqual(await f.journal.read(), before);
});

test('a malformed structured proposal is archived as invalid without a novelty receipt', async () => {
  const f = fixture({ kind: 'proposal', reply: () => ({ text: '{"scope":"concurrency","action":"not a complete procedure"}' }) });
  assert.deepEqual(await f.makeExecutor()(f.dispatch()), { procedure: null, noveltyEnvelope: null });
  assert.equal(f.turns.length, 1); assert.deepEqual(f.noveltyIssues, []); assert.deepEqual(f.evaluationIssues, []);
  const saved = await f.archive.read();
  assert.equal(saved.calls.length, 1); assert.equal(saved.calls[0].stages.at(-1).payload.complete, true);
  assert.deepEqual(saved.artifacts, [{ id: 'proposal-invalid', kind: 'proposal',
    payload: { callId: saved.calls[0].call.callId, reason: 'invalid structured procedure' } }]);
});

test('proposal projection exposes frozen fit feedback and confirmed procedures while private history goes only to the host reviewer', async () => {
  const f = fixture({ kind: 'proposal', confirmed: true, privateHistory: true });
  const result = await f.makeExecutor()(f.dispatch());
  assert.deepEqual(result.procedure, f.proposed); assert.equal(f.turns.length, 1); assert.equal(f.noveltyIssues.length, 1);
  const visible = JSON.parse(f.turns[0].message);
  assert.deepEqual(Object.keys(visible).sort(), ['baselineInstructions', 'confirmedProcedures', 'fitExamples', 'scope']);
  assert.deepEqual(visible.fitExamples, [{ code: 'FROZEN_FIT_CODE_CANARY', feedback: 'FROZEN_FIT_FEEDBACK_CANARY' }]);
  assert.deepEqual(visible.confirmedProcedures, [rule('CONFIRMED_POSITIVE')]);
  assert.equal(visible.baselineInstructions, BASE); assert.equal(f.turns[0].instructions, f.request.learner.instructions);
  assert.doesNotMatch(f.turns[0].instructions + f.turns[0].message,
    /REJECTED_RULE_CANARY|UNPROVEN_RULE_CANARY|ABANDONED_RULE_CANARY|PRIVATE_FAILURE_REASON_CANARY|WRAPPER_ORACLE_CANARY|WRAPPER_NEGATIVE_CANARY|check-js|historyDigest/);
  const reviewed = f.noveltyIssues[0]; assert.deepEqual(reviewed.priorReferences, f.priorReferences);
  assert.equal(reviewed.expected.historyDigest, digest(f.priorReferences));
  assert.deepEqual(reviewed.caseInputs, f.caseInputs);
  assert.ok(reviewed.coverageManifest.every(item => !Object.hasOwn(item, 'expectedBugs') && !Object.hasOwn(item, 'passes')));
  const body = verifyEnvelope({ ...f.keys.novelty.trust, ...result.noveltyEnvelope });
  assert.equal(body.operationId, f.operation.id); assert.equal(body.requestDigest, f.operation.requestDigest);
  assert.equal(body.comparisons.length, f.priorReferences.length);
  const stored = (await f.archive.read()).artifacts.find(item => item.kind === 'novelty');
  assert.equal(stored.payload.serialized, JSON.stringify(result.noveltyEnvelope));
  assert.equal(verifyEnvelope({ ...f.keys.novelty.trust, ...JSON.parse(stored.payload.serialized) }).verdict, 'novel');
});
