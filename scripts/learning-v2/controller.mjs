import { verifyEnvelope } from '../learning-trust.mjs';
import { verifyEvaluation, compareEvaluations } from './evidence.mjs';
import { POLICY, canonical, copy, digest, configuration, identifier, integer, hash,
  procedure, procedureFingerprint, record, requireThat, text, version } from './contracts.mjs';
import { learnerRequest, statusView } from './prompts.mjs';

const OPEN = new Set(['reserved', 'ready', 'screenPlanned', 'provisional', 'confirmationPlanned']);
const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];
const identity = state => ({ experimentId: state.config.experimentId, configDigest: state.configDigest,
  sourceCommit: state.config.sourceCommit });
const currentVersion = state => state.versions.find(item => item.id === state.activeVersionId);
const referenceHistory = state => [...state.history, ...state.attempts.filter(item => item.candidate).map(item =>
  ({ id: item.id, procedure: item.candidate, outcome: item.status, sourceRef: state.config.sourceCommit }))];
const referenceDigest = state => digest(referenceHistory(state));
const retainedEvidence = evaluation => {
  const { calls, ...retained } = evaluation;
  return copy(retained);
};

/**
 * Host-owned experiment state machine. No model client, network, environment
 * discovery, agent mutation, git writes, or retry loop is hidden in this module.
 * Trusted evaluator/gateway integrations supply signed, source-bound receipts.
 */
export class LearningController {
  #journal;
  #trust;
  #clock;

  constructor({ journal, trust, clock = () => Date.now() }) {
    requireThat(journal && typeof journal.read === 'function' && typeof journal.append === 'function', 'journal required');
    record(trust, ROLES, 'trust configuration');
    for (const role of ROLES) {
      record(trust[role], role === 'budget' ? ['publicKeyPem', 'pinnedFingerprint', 'gatewayId'] :
        ['publicKeyPem', 'pinnedFingerprint'], `${role} trust configuration`);
      text(trust[role].publicKeyPem, `${role} public key`, 10_000);
      hash(trust[role].pinnedFingerprint, `${role} key pin`);
    }
    identifier(trust.budget.gatewayId, 'trusted gatewayId');
    this.#journal = journal;
    this.#trust = copy(trust);
    this.#clock = clock;
  }

  #pins() { return { ...Object.fromEntries(ROLES.map(role => [role, this.#trust[role].pinnedFingerprint])),
    gatewayId: this.#trust.budget.gatewayId }; }

  #attest(role, envelope, schema, expected, { timely = false } = {}) {
    record(envelope, ['body', 'signature'], `${role} envelope`);
    // Validate data properties before invoking the legacy JSON signing helper.
    canonical(envelope);
    const body = verifyEnvelope({ ...this.#trust[role], body: envelope.body, signature: envelope.signature });
    requireThat(body.schema === schema, `${role} receipt schema`);
    identifier(body.receiptId, `${role} receiptId`);
    for (const [key, value] of Object.entries(expected)) {
      requireThat(canonical(body[key]) === canonical(value), `${role} receipt ${key} mismatch`);
    }
    if (timely) {
      const issued = Date.parse(body.issuedAt), expires = Date.parse(body.expiresAt), now = this.#clock();
      requireThat(Number.isFinite(issued) && Number.isFinite(expires) && issued <= now &&
        expires > now && expires > issued && expires - issued <= 3_600_000, `${role} receipt expiry`);
    }
    return copy(body);
  }

  async #snapshot() {
    const snapshot = await this.#journal.read();
    requireThat(snapshot.events.length > 0, 'experiment not initialized');
    const last = snapshot.events.at(-1);
    requireThat(last.schema === 'gk-learning-v2-state' && last.state.schema === 'gk-learning-v2-experiment',
      'unknown state schema');
    requireThat(canonical(last.state.trustPins) === canonical(this.#pins()), 'trusted signer changed');
    requireThat(canonical(last.state.policy) === canonical(POLICY), 'policy changed; new experiment required');
    return { head: snapshot.head, state: copy(last.state) };
  }

  async #change(reason, change) {
    const { head, state } = await this.#snapshot();
    const result = change(state);
    await this.#journal.append(head, { schema: 'gk-learning-v2-state', reason,
      recordedAt: new Date(this.#clock()).toISOString(), state });
    return copy(result === undefined ? statusView(state) : result);
  }

  async state() { return (await this.#snapshot()).state; }
  async status() { return statusView(await this.state()); }

  async initialize(input, { history = [], budgetEnvelope }) {
    const config = configuration(input);
    const existing = await this.#journal.read();
    requireThat(existing.head === null && existing.events.length === 0, 'experiment already exists');
    requireThat(Array.isArray(history) && history.length <= 256, 'history size');
    canonical(history);
    const ids = new Set();
    const imported = history.map(item => {
      record(item, ['id', 'procedure', 'outcome', 'sourceRef'], 'historical reference');
      identifier(item.id, 'historical id');
      requireThat(!ids.has(item.id), 'duplicate historical id');
      ids.add(item.id);
      requireThat(['rejected', 'unproven', 'legacy-positive'].includes(item.outcome), 'unqualified history outcome');
      text(item.sourceRef, 'historical sourceRef', 1000);
      return { ...copy(item), procedure: procedure(item.procedure, item.procedure.scope) };
    });
    const trustPins = this.#pins();
    const configDigest = digest({ config, policy: POLICY, trustPins, history: imported });
    const base = { ...version(config.baseInstructions, []), confirmed: true, origin: 'frozen-base' };
    const state = { schema: 'gk-learning-v2-experiment', config, configDigest,
      trustPins, policy: copy(POLICY), history: imported, baseVersion: base,
      activeVersionId: base.id, versions: [base], attempts: [], baseline: null,
      namespaces: [], receipts: [], observedCalls: [], operations: [], activationHistory: [],
      budget: { spentMicros: 0, reservedMicros: 0, lastReceiptId: null }, gate: null };
    const budget = this.#attest('budget', budgetEnvelope, 'gk-learning-v2-budget-state', {
      ...identity(state), budgetId: config.budgetId, gatewayId: this.#trust.budget.gatewayId,
      provider: POLICY.provider, global: true, ceilingMicros: POLICY.programmeCeilingMicros,
    }, { timely: true });
    this.#budget(state, budget);
    state.receipts.push(budget.receiptId);
    await this.#journal.append(null, { schema: 'gk-learning-v2-state', reason: 'initialized',
      recordedAt: new Date(this.#clock()).toISOString(), state });
    return statusView(state);
  }

  #budget(state, body) {
    integer(body.spentMicros, 'global spentMicros', 0, POLICY.programmeCeilingMicros);
    integer(body.reservedMicros, 'global reservedMicros', 0, POLICY.programmeCeilingMicros);
    requireThat(body.spentMicros >= state.budget.spentMicros, 'cumulative spend went backwards');
    requireThat(body.spentMicros + body.reservedMicros <= POLICY.programmeCeilingMicros, 'programme budget exceeded');
    state.budget = { spentMicros: body.spentMicros, reservedMicros: body.reservedMicros, lastReceiptId: body.receiptId };
  }

  #attempt(state, id, statuses) {
    const attempt = state.attempts.find(item => item.id === id);
    requireThat(attempt && statuses.includes(attempt.status), 'invalid attempt transition');
    requireThat(attempt.incumbentVersionId === state.activeVersionId, 'incumbent changed during attempt');
    return attempt;
  }

  #consume(state, kind, attemptId) {
    const operation = state.operations.find(item => item.kind === kind && item.attemptId === attemptId);
    requireThat(state.gate && operation && !operation.consumed, 'matching admitted operation required');
    operation.consumed = true;
    return operation;
  }

  #request(state, kind, attemptId) {
    let plan, namespace, requiredCalls, prompts, learner = null;
    if (kind === 'baseline') {
      requireThat(attemptId === null && state.baselinePlan && !state.baseline, 'baseline request state');
      plan = state.baselinePlan;
      namespace = plan.namespace;
      requiredCalls = state.config.cases.length * POLICY.passes;
      prompts = { base: state.baseVersion.artifact };
    } else {
      const statuses = { proposal: ['reserved'], screen: ['screenPlanned'], confirmation: ['confirmationPlanned'] };
      requireThat(Object.hasOwn(statuses, kind), 'unknown operation kind');
      const attempt = this.#attempt(state, attemptId, statuses[kind]);
      prompts = { base: state.baseVersion.artifact, incumbent: currentVersion(state).artifact };
      if (kind === 'proposal') {
        namespace = `${attempt.id}:proposal`;
        plan = { attemptId, historyDigest: attempt.historyDigest };
        requiredCalls = 1;
        // Only this field is passed to the proposer. The host request/plan
        // and historyDigest are scheduling evidence, never model messages.
        learner = copy(attempt.learner);
      } else {
        prompts.candidate = attempt.version.artifact;
        if (kind === 'screen') {
          plan = attempt.screenPlan;
          namespace = plan.candidate.namespace;
          requiredCalls = state.config.cases.length * POLICY.passes + attempt.coverageCaseIds.length;
        } else {
          plan = attempt.confirmationPlan;
          namespace = plan.namespace;
          requiredCalls = plan.pairs.reduce((sum, pair) => sum + pair.order.length *
            state.config.cases.length * POLICY.passes, 0);
        }
      }
    }
    return copy({ schema: 'gk-learning-v2-execution-request', ...identity(state), kind, attemptId, namespace,
      provider: POLICY.provider, memory: POLICY.memory, model: state.config.model,
      runtimeDigest: state.config.runtimeDigest, firstPassInstructionsDigest: state.config.firstPassInstructionsDigest,
      policy: state.policy, authorityPins: state.trustPins,
      originalVersionId: state.baseVersion.id, incumbentVersionId: state.activeVersionId,
      managedGateDigest: state.gate?.digest || null, requiredCalls, plan, prompts, learner });
  }

  /** Host manifest, not a model prompt. Historical rejected/unresolved rules
   * are excluded; only the current proposal is included for its own evaluation. */
  async executionRequest(kind, attemptId = null) {
    return this.#request(await this.state(), kind, attemptId);
  }

  #namespace(state, namespace) {
    identifier(namespace, 'namespace');
    requireThat(!state.namespaces.includes(namespace), 'namespace already claimed');
    state.namespaces.push(namespace);
    return namespace;
  }

  #expected(state, { phase, namespace, pairId, promptDigest, executionIndex, applicableCaseIds }) {
    return { experimentId: state.config.experimentId, sourceCommit: state.config.sourceCommit,
      benchmarkDigest: state.config.benchmarkDigest, scorerDigest: state.config.scorerDigest,
      model: state.config.model, scope: state.config.scope, phase, namespace, pairId,
      promptDigest, executionIndex, applicableCaseIds: applicableCaseIds ||
        state.config.cases.filter(item => item.scope === state.config.scope).map(item => item.caseId),
      cases: state.config.cases.map(({ learnerVisible, ...item }) => item) };
  }

  #evaluate(state, envelope, expected, operation) {
    const result = verifyEvaluation(envelope, this.#trust.evaluation, { ...expected,
      operationId: operation.id, requestDigest: operation.requestDigest });
    requireThat(!state.receipts.includes(result.receiptId), 'evaluation receipt replay');
    state.receipts.push(result.receiptId);
    return result;
  }

  #fresh(state, evaluation, operation) {
    for (const call of evaluation.calls) {
      requireThat(call.reused === false && call.originReceiptId === null, 'fresh call required');
      requireThat(!state.observedCalls.some(previous => previous.callId === call.callId ||
        (previous.sessionId === call.sessionId && previous.turnId === call.turnId)), 'model call replay');
      state.observedCalls.push({ callId: call.callId, sessionId: call.sessionId, turnId: call.turnId });
      operation.observedFreshCalls++;
    }
  }

  #complete(operation) {
    requireThat(operation.observedFreshCalls === operation.maxCalls, 'complete evidence call count differs from admitted plan');
    operation.evidenceComplete = true;
  }

  #screenPair(state, incumbent, candidate, applicableCaseIds, operation) {
    this.#fresh(state, incumbent, operation);
    for (const result of candidate.cases) {
      if (!applicableCaseIds.includes(result.caseId)) {
        const original = incumbent.cases.find(item => item.caseId === result.caseId);
        requireThat(original && result.caught === original.caught && result.falseAlarms === original.falseAlarms,
          'unchanged off-scope outputs have inconsistent scores');
      }
    }
    for (const call of candidate.calls) {
      const original = incumbent.calls.find(item => item.caseId === call.caseId && item.pass === call.pass);
      const mustReuse = call.pass === 1 || !applicableCaseIds.includes(call.caseId);
      if (mustReuse) {
        requireThat(original && call.reused === true && call.originReceiptId === incumbent.receiptId &&
          call.callId === original.callId && call.sessionId === original.sessionId && call.turnId === original.turnId &&
          call.inputDigest === original.inputDigest && call.outputDigest === original.outputDigest,
        'missing or mismatched paired screening cache; no fresh fallback');
      } else {
        this.#fresh(state, { receiptId: candidate.receiptId, calls: [call] }, operation);
      }
    }
  }

  async planBaseline() {
    return this.#change('baseline-planned', state => {
      requireThat(!state.baseline && !state.baselinePlan, 'baseline already planned');
      const namespace = this.#namespace(state, `${state.config.experimentId}:baseline`);
      state.baselinePlan = this.#expected(state, { phase: 'baseline', namespace, pairId: namespace,
        promptDigest: state.baseVersion.promptDigest, executionIndex: 0 });
      return state.baselinePlan;
    });
  }

  async recordBaseline(envelope) {
    return this.#change('baseline-recorded', state => {
      requireThat(state.baselinePlan && !state.baseline, 'baseline not ready');
      const operation = this.#consume(state, 'baseline', null);
      try {
        const evaluation = this.#evaluate(state, envelope, state.baselinePlan, operation);
        this.#fresh(state, evaluation, operation);
        this.#complete(operation);
        state.baseline = retainedEvidence(evaluation);
      } catch (error) { state.baselineError = String(error.message); }
    });
  }

  async beginAttempt(feedbackEnvelope = null) {
    return this.#change('attempt-reserved', state => {
      requireThat(state.baseline, 'complete baseline required');
      requireThat(!state.attempts.some(item => OPEN.has(item.status)), 'another attempt is open');
      requireThat(!state.operations.some(item => !item.settled), 'operation or billing unresolved');
      requireThat(state.attempts.length < POLICY.attempts, 'ten attempt limit reached');
      const number = state.attempts.length + 1;
      const id = `${state.config.experimentId}:attempt:${number}`;
      requireThat(!state.history.some(item => item.id === id), 'historical identifier collision');
      const attempt = { id, number, status: 'reserved', incumbentVersionId: state.activeVersionId,
        historyDigest: referenceDigest(state), candidate: null, screen: null, confirmation: null,
        learner: this.#learner(state, feedbackEnvelope) };
      state.attempts.push(attempt);
      return { attemptId: id, number, historyDigest: attempt.historyDigest };
    });
  }

  /** Invalid proposals, duplicate procedures and uncertain reviews consume the attempt. */
  async recordProposal(attemptId, proposed, noveltyEnvelope) {
    return this.#change('proposal-recorded', state => {
      const attempt = this.#attempt(state, attemptId, ['reserved']);
      const operation = this.#consume(state, 'proposal', attemptId);
      const references = referenceHistory(state);
      try { attempt.candidate = procedure(proposed, state.config.scope); }
      catch (error) { attempt.status = 'invalid'; attempt.reason = String(error.message); return; }
      attempt.candidateDigest = procedureFingerprint(attempt.candidate);
      const matches = references.filter(item => procedureFingerprint(item.procedure) === attempt.candidateDigest);
      if (matches.length) {
        attempt.status = 'duplicate';
        attempt.novelty = { verdict: 'exact', priorIds: matches.map(item => item.id) };
        return;
      }
      try {
        const body = this.#attest('novelty', noveltyEnvelope, 'gk-learning-v2-novelty', {
          ...identity(state), attemptId, candidateDigest: attempt.candidateDigest,
          incumbentVersionId: attempt.incumbentVersionId, originalVersionId: state.baseVersion.id,
          historyDigest: attempt.historyDigest, policyVersion: 'gk-procedure-equivalence-v1',
          sourceScopeVerified: true, operationId: operation.id, requestDigest: operation.requestDigest,
        });
        requireThat(!state.receipts.includes(body.receiptId), 'novelty receipt replay');
        requireThat(['novel', 'equivalent', 'uncertain'].includes(body.verdict), 'novelty verdict');
        requireThat(Array.isArray(body.comparisons) && body.comparisons.length === references.length,
          'novelty comparison coverage');
        const reviewed = new Set();
        for (const comparison of body.comparisons) {
          record(comparison, ['priorId', 'relation', 'reason'], 'procedure comparison');
          requireThat(references.some(item => item.id === comparison.priorId) && !reviewed.has(comparison.priorId),
            'unknown or repeated prior procedure');
          reviewed.add(comparison.priorId);
          requireThat(['distinct', 'equivalent', 'uncertain'].includes(comparison.relation), 'procedure relation');
          text(comparison.reason, 'procedure comparison reason', 4000);
        }
        requireThat(Array.isArray(body.coverageCaseIds) && new Set(body.coverageCaseIds).size === body.coverageCaseIds.length,
          'scope coverage ids');
        requireThat(body.coverageCaseIds.every(id => state.config.cases.some(item => item.caseId === id &&
          item.scope === state.config.scope)), 'scope outside supplied code');
        state.receipts.push(body.receiptId);
        attempt.novelty = copy(body);
        if (!body.coverageCaseIds.some(id => state.config.cases.some(item => item.caseId === id &&
          item.split === 'fit' && item.learnerVisible))) { attempt.status = 'noCoverage'; return; }
        const equivalent = body.comparisons.some(item => item.relation === 'equivalent');
        const uncertain = body.comparisons.some(item => item.relation === 'uncertain');
        requireThat((body.verdict === 'equivalent') === equivalent, 'inconsistent equivalence verdict');
        requireThat(body.verdict !== 'novel' || (!equivalent && !uncertain), 'unresolved novelty comparison');
        if (body.verdict !== 'novel') {
          attempt.status = equivalent ? 'duplicate' : 'unresolved';
          return;
        }
        attempt.coverageCaseIds = copy(body.coverageCaseIds);
        const rule = { id: attempt.id, procedure: attempt.candidate, coverageCaseIds: copy(body.coverageCaseIds) };
        attempt.version = version(state.config.baseInstructions, [...currentVersion(state).rules, rule], state.activeVersionId);
        attempt.status = 'ready';
        operation.evidenceComplete = true;
      } catch (error) { attempt.status = 'unresolved'; attempt.reason = String(error.message); }
    });
  }

  async planScreen(attemptId) {
    return this.#change('screen-planned', state => {
      const attempt = this.#attempt(state, attemptId, ['ready']);
      const namespace = this.#namespace(state, `${state.config.experimentId}:screen:${attempt.number}`);
      attempt.screenPlan = {
        incumbent: this.#expected(state, { phase: 'screen', namespace, pairId: namespace,
          promptDigest: currentVersion(state).promptDigest, executionIndex: 0 }),
        candidate: this.#expected(state, { phase: 'screen', namespace, pairId: namespace,
          promptDigest: attempt.version.promptDigest, executionIndex: 1,
          applicableCaseIds: attempt.coverageCaseIds }),
      };
      attempt.status = 'screenPlanned';
      return attempt.screenPlan;
    });
  }

  async recordScreen(attemptId, { incumbent, candidate }) {
    return this.#change('screen-recorded', state => {
      const attempt = this.#attempt(state, attemptId, ['screenPlanned']);
      const operation = this.#consume(state, 'screen', attemptId);
      try {
        const control = this.#evaluate(state, incumbent, attempt.screenPlan.incumbent, operation);
        const proposed = this.#evaluate(state, candidate, attempt.screenPlan.candidate, operation);
        this.#screenPair(state, control, proposed, attempt.coverageCaseIds, operation);
        this.#complete(operation);
        const decision = compareEvaluations({ base: state.baseline, incumbent: control, candidate: proposed },
          { minimumGain: POLICY.minimumGain });
        attempt.screen = { control: retainedEvidence(control), proposed: retainedEvidence(proposed), decision };
        attempt.status = decision.passed ? 'provisional' : 'rejected';
        const observedRegression = decision.gain < 0 || decision.reasons.some(reason =>
          reason.includes('below_incumbent') || reason.includes('below_base'));
        attempt.disposition = decision.passed ? 'screen-positive' : observedRegression ? 'observed-regression' : 'unproven';
      } catch (error) { attempt.status = 'unresolved'; attempt.reason = String(error.message); }
    });
  }

  async planConfirmation(attemptId) {
    return this.#change('confirmation-planned', state => {
      const attempt = this.#attempt(state, attemptId, ['provisional']);
      const namespace = this.#namespace(state, `${state.config.experimentId}:confirmation:${attempt.number}`);
      const sameBase = state.activeVersionId === state.baseVersion.id;
      const forward = sameBase ? ['incumbent', 'candidate'] : ['base', 'incumbent', 'candidate'];
      attempt.confirmationPlan = {
        namespace, pairs: [], decision: POLICY.confirmationDecision, additionalPairs: 0,
      };
      for (let index = 0; index < POLICY.confirmationPairs; index++) {
        const pairId = `${namespace}:pair:${index + 1}`;
        const order = index % 2 === 0 ? forward : [...forward].reverse();
        const expectations = {};
        for (const [executionIndex, arm] of order.entries()) {
          const target = arm === 'base' ? state.baseVersion : arm === 'incumbent' ? currentVersion(state) : attempt.version;
          expectations[arm] = this.#expected(state, { phase: 'confirmation', namespace, pairId,
            promptDigest: target.promptDigest, executionIndex,
            applicableCaseIds: arm === 'candidate' ? attempt.coverageCaseIds : undefined });
        }
        attempt.confirmationPlan.pairs.push({ pairId, order, expectations });
      }
      attempt.status = 'confirmationPlanned';
      return attempt.confirmationPlan;
    });
  }

  async recordConfirmation(attemptId, pairs) {
    return this.#change('confirmation-recorded', state => {
      const attempt = this.#attempt(state, attemptId, ['confirmationPlanned']);
      const operation = this.#consume(state, 'confirmation', attemptId);
      try {
        requireThat(Array.isArray(pairs) && pairs.length === POLICY.confirmationPairs, 'exactly three confirmation pairs required');
        const results = [];
        for (const [index, pair] of pairs.entries()) {
          const plan = attempt.confirmationPlan.pairs[index];
          record(pair, plan.order, 'confirmation pair arms');
          const evaluated = {};
          for (const arm of plan.order) {
            evaluated[arm] = this.#evaluate(state, pair[arm], plan.expectations[arm], operation);
            this.#fresh(state, evaluated[arm], operation);
            evaluated[arm] = retainedEvidence(evaluated[arm]);
          }
          const base = evaluated.base || evaluated.incumbent;
          const decision = compareEvaluations({ base, incumbent: evaluated.incumbent, candidate: evaluated.candidate },
            { minimumGain: POLICY.minimumGain });
          results.push({ pairId: plan.pairId, order: plan.order, evaluated, decision });
        }
        attempt.confirmation = results;
        this.#complete(operation);
        const passed = results.every(result => result.decision.passed);
        attempt.status = passed ? 'confirmed' : 'rejected';
        attempt.disposition = passed ? 'confirmation-qualified' : 'not-confirmed';
        if (passed) {
          state.versions.push({ ...copy(attempt.version), confirmed: true, origin: attempt.id,
            evidenceDigest: digest(results), configDigest: state.configDigest });
        }
        // A confirmed artifact is reviewable. The active pointer changes only
        // through activateVersion with a separate operator authorization.
      } catch (error) { attempt.status = 'unresolved'; attempt.reason = String(error.message); }
    });
  }

  async abandonAttempt(attemptId, reason) {
    return this.#change('attempt-unresolved', state => {
      const attempt = this.#attempt(state, attemptId, [...OPEN]);
      // Closing the attempt first would remove the operation's recovery path:
      // abandonOperation needs an open attempt to preserve settlement custody.
      requireThat(!state.operations.some(item => item.attemptId === attemptId && !item.consumed),
        'abandon the pending operation instead; it must remain settleable');
      attempt.status = 'unresolved';
      attempt.reason = text(reason, 'unresolved reason', 2000);
    });
  }

  async activateVersion(versionId, envelope, action = 'activate') {
    return this.#change('version-activated', state => {
      requireThat(['activate', 'rollback'].includes(action), 'activation action');
      requireThat(!state.attempts.some(item => OPEN.has(item.status)) &&
        !state.operations.some(item => !item.settled), 'activation while work is pending');
      const target = state.versions.find(item => item.id === versionId && item.confirmed);
      requireThat(target && target.id !== state.activeVersionId, 'confirmed different version required');
      if (action === 'activate') requireThat(target.parent === state.activeVersionId, 'activation parent mismatch');
      else requireThat(target.id === state.baseVersion.id ||
        state.activationHistory.some(item => item.versionId === target.id), 'rollback target was never active');
      const approval = this.#attest('activation', envelope, 'gk-learning-v2-activation', {
        ...identity(state), action, versionId, incumbentVersionId: state.activeVersionId,
        originalVersionId: state.baseVersion.id, evidenceDigest: target.evidenceDigest || null,
        purpose: 'experiment-incumbent-only',
      }, { timely: true });
      requireThat(!state.receipts.includes(approval.receiptId), 'activation receipt replay');
      state.receipts.push(approval.receiptId);
      state.activationHistory.push({ action, versionId, previousVersionId: state.activeVersionId,
        receiptId: approval.receiptId });
      state.activeVersionId = target.id;
    });
  }

  #learner(state, feedbackEnvelope) {
    let examples = [];
    if (feedbackEnvelope) {
      requireThat(state.baseline, 'baseline required for feedback');
      const body = this.#attest('evaluation', feedbackEnvelope, 'gk-learning-v2-fit-feedback', {
        ...identity(state), baselineReceiptId: state.baseline.receiptId, origin: 'original-baseline-fit-only',
      });
      requireThat(Array.isArray(body.examples) && body.examples.length <= state.config.cases.length, 'fit example count');
      const seen = new Set();
      for (const example of body.examples) {
        record(example, ['caseId', 'code', 'feedback'], 'fit example');
        requireThat(!seen.has(example.caseId) && state.config.cases.some(item => item.caseId === example.caseId &&
          item.split === 'fit' && item.learnerVisible && item.scope === state.config.scope), 'excluded learner example');
        seen.add(example.caseId);
      }
      examples = body.examples;
    }
    return learnerRequest({ scope: state.config.scope, activeVersion: currentVersion(state),
      baselineInstructions: state.config.baseInstructions, fitExamples: examples });
  }

  async learnerInput(feedbackEnvelope = null) {
    return this.#learner(await this.state(), feedbackEnvelope);
  }

  async recordManagedGate(envelope) {
    return this.#change('managed-gate-recorded', state => {
      requireThat(!state.gate && state.operations.length === 0, 'managed gate already frozen');
      const body = this.#attest('evaluation', envelope, 'gk-learning-v2-managed-gate', {
        ...identity(state), ...state.config.gatePolicy, status: 'passed', fullSuite: true, independent: true,
        baseCurrent: true, cleanupComplete: true, noSkippedChecks: true,
      });
      identifier(body.targetId, 'managed targetId');
      identifier(body.runId, 'managed runId');
      hash(body.effectiveTreeDigest, 'managed effective tree');
      hash(body.rawLogsDigest, 'managed raw logs');
      requireThat(!state.receipts.includes(body.receiptId), 'gate receipt replay');
      state.receipts.push(body.receiptId);
      state.gate = { receiptId: body.receiptId, digest: digest(body), targetId: body.targetId, runId: body.runId };
    });
  }

  /** Reserve and persist before invoking a trusted managed executor. This is
   * an audit/admission boundary, not an implementation of global billing. */
  async reserveOperation(operation, envelope) {
    return this.#change('operation-reserved', state => {
      record(operation, ['id', 'kind', 'attemptId', 'namespace', 'requestDigest'], 'operation');
      identifier(operation.id, 'operation id');
      hash(operation.requestDigest, 'requestDigest');
      requireThat(state.gate, 'source has no matching full managed gate receipt');
      requireThat(!state.operations.some(item => !item.settled || item.id === operation.id ||
        (item.kind === operation.kind && item.attemptId === operation.attemptId)), 'operation pending or reused');
      const request = this.#request(state, operation.kind, operation.attemptId);
      requireThat(operation.requestDigest === digest(request), 'operation request differs from frozen plan');
      let expectedNamespace;
      if (operation.kind === 'baseline') {
        requireThat(operation.attemptId === null && state.baselinePlan && !state.baseline, 'baseline operation state');
        expectedNamespace = state.baselinePlan.namespace;
      } else {
        const statuses = { proposal: ['reserved'], screen: ['screenPlanned'], confirmation: ['confirmationPlanned'] };
        requireThat(Object.hasOwn(statuses, operation.kind), 'unknown operation kind');
        const attempt = this.#attempt(state, operation.attemptId, statuses[operation.kind]);
        expectedNamespace = operation.kind === 'proposal' ? `${attempt.id}:proposal` :
          operation.kind === 'screen' ? attempt.screenPlan.candidate.namespace : attempt.confirmationPlan.namespace;
      }
      requireThat(operation.namespace === expectedNamespace, 'operation namespace mismatch');
      const lease = this.#attest('budget', envelope, 'gk-learning-v2-operation-lease', {
        ...identity(state), ...operation, budgetId: state.config.budgetId, gatewayId: this.#trust.budget.gatewayId,
        provider: POLICY.provider, model: state.config.model, global: true,
        ceilingMicros: POLICY.programmeCeilingMicros, managedGateDigest: state.gate.digest,
        namespaceExclusive: true, providerLimitEnforced: true,
      }, { timely: true });
      requireThat(!state.receipts.includes(lease.receiptId), 'lease replay');
      integer(lease.maxCalls, 'lease maxCalls', 1, 1_000_000);
      requireThat(lease.maxCalls === request.requiredCalls, 'lease must cover exactly the complete planned call count');
      integer(lease.reservationMicros, 'lease reservationMicros', 1, POLICY.programmeCeilingMicros);
      requireThat(lease.reservedMicros >= lease.reservationMicros, 'reservation absent from global total');
      this.#budget(state, lease);
      state.receipts.push(lease.receiptId);
      const reserved = { ...copy(operation), leaseId: lease.receiptId, maxCalls: lease.maxCalls,
        reservationMicros: lease.reservationMicros, settled: false, consumed: false,
        observedFreshCalls: 0, evidenceComplete: false };
      state.operations.push(reserved);
      return reserved;
    });
  }

  /** Recover the admission/recording crash window without creating execution
   * authority. Both historical admission and final settlement are mandatory.
   * An elapsed lease may be accounted for here, never renewed or dispatched. */
  async reconcileAdmission(operation, admissionEnvelope, settlementEnvelope, reason) {
    return this.#change('admission-reconciled', state => {
      record(operation, ['id', 'kind', 'attemptId', 'namespace', 'requestDigest'], 'reconciled operation');
      identifier(operation.id, 'reconciled operation id');
      hash(operation.requestDigest, 'reconciled requestDigest');
      requireThat(state.gate, 'source has no matching full managed gate receipt');
      requireThat(!state.operations.some(item => !item.settled || item.id === operation.id ||
        (item.kind === operation.kind && item.attemptId === operation.attemptId)), 'operation pending or reused');
      const request = this.#request(state, operation.kind, operation.attemptId);
      requireThat(operation.namespace === request.namespace && operation.requestDigest === digest(request),
        'recovery request differs from frozen plan');
      const admission = this.#attest('budget', admissionEnvelope, 'gk-learning-v2-operation-lease', {
        ...identity(state), ...operation, budgetId: state.config.budgetId, gatewayId: this.#trust.budget.gatewayId,
        provider: POLICY.provider, model: state.config.model, global: true,
        ceilingMicros: POLICY.programmeCeilingMicros, managedGateDigest: state.gate.digest,
        namespaceExclusive: true, providerLimitEnforced: true,
      });
      const issued = Date.parse(admission.issuedAt), expires = Date.parse(admission.expiresAt);
      requireThat(Number.isFinite(issued) && Number.isFinite(expires) && issued <= this.#clock() &&
        expires > issued && expires - issued <= 3_600_000, 'historical admission validity window');
      requireThat(!state.receipts.includes(admission.receiptId), 'historical admission receipt replay');
      integer(admission.maxCalls, 'historical maxCalls', 1, 1_000_000);
      requireThat(admission.maxCalls === request.requiredCalls, 'historical admission call count differs from plan');
      integer(admission.reservationMicros, 'historical reservationMicros', 1, POLICY.programmeCeilingMicros);
      integer(admission.spentMicros, 'historical spentMicros', 0, POLICY.programmeCeilingMicros);
      integer(admission.reservedMicros, 'historical reservedMicros', 0, POLICY.programmeCeilingMicros);
      requireThat(admission.reservedMicros >= admission.reservationMicros &&
        admission.spentMicros + admission.reservedMicros <= POLICY.programmeCeilingMicros,
      'historical programme reservation invalid');
      const settlement = this.#attest('budget', settlementEnvelope, 'gk-learning-v2-operation-settlement', {
        ...identity(state), operationId: operation.id, leaseId: admission.receiptId, budgetId: state.config.budgetId,
        gatewayId: this.#trust.budget.gatewayId, provider: POLICY.provider, global: true,
        ceilingMicros: POLICY.programmeCeilingMicros, status: 'settled',
      });
      requireThat(!state.receipts.includes(settlement.receiptId) && settlement.receiptId !== admission.receiptId,
        'historical settlement receipt replay');
      integer(settlement.actualCalls, 'reconciled actualCalls', 0, admission.maxCalls);
      integer(settlement.actualMicros, 'reconciled actualMicros', 0, admission.reservationMicros);
      requireThat(settlement.spentMicros >= Math.max(state.budget.spentMicros, admission.spentMicros) + settlement.actualMicros,
        'historical settlement omitted spend');
      this.#budget(state, settlement);
      const failureReason = text(reason, 'admission reconciliation reason', 2000);
      const reconciled = { ...copy(operation), leaseId: admission.receiptId, maxCalls: admission.maxCalls,
        reservationMicros: admission.reservationMicros, settled: true, consumed: true,
        observedFreshCalls: 0, evidenceComplete: false, reconciliationOnly: true, failureReason,
        settlementReceiptId: settlement.receiptId, actualCalls: settlement.actualCalls, actualMicros: settlement.actualMicros };
      state.operations.push(reconciled);
      state.receipts.push(admission.receiptId, settlement.receiptId);
      if (operation.attemptId === null) state.baselineError = failureReason;
      else {
        const attempt = state.attempts.find(item => item.id === operation.attemptId);
        requireThat(attempt && OPEN.has(attempt.status), 'reconciled attempt state');
        attempt.status = 'unresolved'; attempt.reason = failureReason;
      }
      return reconciled;
    });
  }

  async settleOperation(operationId, envelope) {
    return this.#change('operation-settled', state => {
      const operation = state.operations.find(item => item.id === operationId && !item.settled);
      requireThat(operation, 'unsettled operation required');
      requireThat(operation.consumed, 'record evidence or explicitly abandon the operation before settlement');
      const receipt = this.#attest('budget', envelope, 'gk-learning-v2-operation-settlement', {
        ...identity(state), operationId, leaseId: operation.leaseId, budgetId: state.config.budgetId,
        gatewayId: this.#trust.budget.gatewayId, provider: POLICY.provider, global: true,
        ceilingMicros: POLICY.programmeCeilingMicros, status: 'settled',
      });
      requireThat(!state.receipts.includes(receipt.receiptId), 'settlement replay');
      integer(receipt.actualCalls, 'actualCalls', 0, operation.maxCalls);
      integer(receipt.actualMicros, 'actualMicros', 0, operation.reservationMicros);
      requireThat(receipt.actualCalls >= operation.observedFreshCalls &&
        (!operation.evidenceComplete || receipt.actualCalls === operation.maxCalls),
      'billing call count contradicts verified execution evidence');
      requireThat(receipt.spentMicros >= state.budget.spentMicros + receipt.actualMicros, 'settlement omitted spend');
      this.#budget(state, receipt);
      state.receipts.push(receipt.receiptId);
      operation.settled = true;
      operation.settlementReceiptId = receipt.receiptId;
      operation.actualCalls = receipt.actualCalls;
      operation.actualMicros = receipt.actualMicros;
    });
  }

  /** Close an ambiguous phase without inventing a result or freeing its budget.
   * Gateway reconciliation is still required before another operation. */
  async abandonOperation(operationId, reason) {
    return this.#change('operation-unresolved', state => {
      const operation = state.operations.find(item => item.id === operationId && !item.consumed && !item.settled);
      requireThat(operation, 'unconsumed unsettled operation required');
      operation.consumed = true;
      operation.failureReason = text(reason, 'operation failure reason', 2000);
      if (operation.attemptId === null) state.baselineError = operation.failureReason;
      else {
        const attempt = state.attempts.find(item => item.id === operation.attemptId);
        requireThat(attempt && OPEN.has(attempt.status), 'operation attempt state');
        attempt.status = 'unresolved';
        attempt.reason = operation.failureReason;
      }
    });
  }
}
