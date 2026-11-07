/**
 * Detached signing and execution authority. The production host remains the
 * coordinator; this service independently reconstructs and verifies each
 * requested phase against protected frozen inputs and previously issued facts.
 * It never accepts a driver score, completion flag, history or invented plan.
 */
import { verifyEnvelope } from '../learning-trust.mjs';
import { POLICY, canonical, copy, digest, identifier, procedure, procedureFingerprint,
  record, requireThat, text, version } from './contracts.mjs';
import { compareEvaluations, verifyEvaluation } from './evidence.mjs';
import { mergeReviews, parseRawReview, parseReview, renderReview } from './legacy-renderer.mjs';
import { TURN_CONFIG, turnInputDigest } from './trueforge-turn.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';
import { AuthorityLedger } from './authority-ledger.mjs';
import { authorityCallId, authorityIdentity, authorityReferences, initialAuthorityState,
  reconstructAuthorityRequest, scoreFrozenFindings } from './authority-plan.mjs';
import { assertInlineSession, inspectProviderCall, providerJson } from './authority-provider.mjs';
import { authorityProviderBody } from './authority-wire.mjs';
import { authorityAcceptanceView } from './authority-acceptance-view.mjs';
import { CONTINUATION_PURPOSE } from './implementation-proof.mjs';
import { validateOriginalBaselinePacket } from './baseline-continuation.mjs';
import { verifyImplementationStatus } from './implementation-proof.mjs';
import { createProposalObservationAuthority } from './proposal-observation-authority.mjs';

const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];
const sdkOptions = Object.freeze({ maxRetries: 0, timeoutInSeconds: 60 });
const serialized = envelope => JSON.stringify(envelope);
const unsignedCopy = value => copy(value);
const receiptId = (kind, context) => 'authority-' + kind + '-' + digest(context);
const same = (left, right, message) => requireThat(canonical(left) === canonical(right), message);
const retained = value => { const { calls, ...rest } = value; return copy(rest); };
const byId = (state, id) => {
  const op = state.operations.find(item => item.id === id);
  requireThat(op, 'authority operation absent');
  return op;
};
const callById = (state, id) => {
  for (const operation of state.operations) {
    const call = operation.calls.find(item => item.callId === id);
    if (call) return { operation, call };
  }
  throw new Error('GK_AUTHORITY_CALL_NOT_OWNED');
};
const pendingReview = review => Object.assign(new Error('GK_AUTHORITY_REVIEW_PENDING'), {
  code: 'GK_AUTHORITY_REVIEW_PENDING', reviewId: review.id, operationId: review.operationId,
});

function parsedProposal(output, scope) {
  try {
    let value = output.trim();
    const fence = value.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
    if (fence) value = fence[1];
    return procedure(JSON.parse(value), scope);
  } catch { return null; }
}

function passEvidence(result, pass, originReceiptId = null) {
  requireThat(result.complete, 'authority pass incomplete');
  return { pass, callId: result.callId, sessionId: result.sessionId, turnId: result.turnId,
    inputDigest: result.inputDigest, outputDigest: result.outputDigest, status: 'complete',
    finishReason: 'stop', parseValid: true, empty: false, truncated: false, toolCalls: 0,
    reused: originReceiptId !== null, originReceiptId };
}

export async function createDetachedAuthority({ bundle: suppliedBundle, signers, journal,
  artifactStore, provider, verifySourceGate, verifyRuntime, upstreamModelId, reviewerId,
  implementationCommit = null, verifyImplementationSource = null, verifyContinuationOwner = null,
  proposalObservation = null,
  clock = () => Date.now() }) {
  const bundle = verifyProductionBundle(suppliedBundle);
  requireThat(ROLES.every(role => typeof signers?.[role] === 'function'), 'protected signers absent');
  requireThat(artifactStore && ['put', 'get'].every(name => typeof artifactStore[name] === 'function'),
    'protected artifact custody absent');
  requireThat(typeof verifySourceGate === 'function', 'independent source-gate verifier absent');
  requireThat(typeof verifyRuntime === 'function', 'independent installed runtime check absent');
  text(upstreamModelId, 'frozen upstream model', 200);
  identifier(reviewerId, 'protected independent reviewer ID');
  const initial = initialAuthorityState(bundle);
  initial.activeCallId = null;
  const ledger = new AuthorityLedger({ journal, binding: bundle.binding, initial, clock });
  if (proposalObservation === null) await ledger.initialize();
  else await ledger.read(); // D can reopen only; never initialize another experiment.
  const identity = authorityIdentity(bundle);
  const actualImplementation = implementationCommit ?? bundle.config.sourceCommit;
  requireThat(/^[a-f0-9]{40}$/u.test(actualImplementation), 'actual authority implementation source');
  const sign = async (role, body) => {
    canonical(body);
    const envelope = await signers[role](body);
    record(envelope, ['body', 'signature'], 'authority signed envelope');
    same(envelope.body, body, 'signer changed authority body');
    verifyEnvelope({ ...bundle.trust[role], body: envelope.body, signature: envelope.signature });
    return JSON.parse(serialized(envelope));
  };
  const opening = await ledger.read();
  let observationAuthority = null;
  if (proposalObservation !== null) {
    record(proposalObservation, ['verifySource', 'verifyOwner', 'journalFactory', 'readOnlyJournal'], 'D authority context');
    requireThat(typeof proposalObservation.verifySource === 'function' && opening.implementation?.authorization &&
      opening.gate && opening.sourceEvidenceDigest, 'D requires original B authority history and separate source proof');
    const historicalStatus = verifyImplementationStatus({ qualificationEnvelope: JSON.parse(opening.implementation.qualification),
      authorizationEnvelope: JSON.parse(opening.implementation.authorization) }, { binding: bundle.binding, trust: bundle.trust,
      implementationCommit: JSON.parse(opening.implementation.qualification).body.implementationCommit, requireAuthorization: true });
    requireThat(actualImplementation !== bundle.binding.sourceCommit &&
      actualImplementation !== historicalStatus.qualificationEnvelope.body.implementationCommit,
    'D actual implementation must be distinct from retained A and B');
    const sourceEvidence = await proposalObservation.verifySource({ bundle: copy(bundle),
      originalEvidence: await artifactStore.get(opening.sourceEvidenceDigest), implementationCommit: actualImplementation,
      historicalImplementationStatus: historicalStatus });
    requireThat(sourceEvidence.implementationCommit === actualImplementation, 'D source verifier returned a different image');
    const originalLedger = new AuthorityLedger({ journal: proposalObservation.readOnlyJournal, binding: bundle.binding, initial: null, clock });
    observationAuthority = await createProposalObservationAuthority({ bundle, originalLedger,
      originalJournal: proposalObservation.readOnlyJournal, artifactStore, provider, sign, sourceEvidence,
      actualImplementation, historicalStatus, journalFactory: proposalObservation.journalFactory,
      verifyOwner: proposalObservation.verifyOwner, clock });
  } else if (actualImplementation === bundle.config.sourceCommit) {
    requireThat(!opening.implementation, 'frozen image cannot reopen a separately qualified implementation');
  } else {
    requireThat(opening.gate && opening.sourceEvidenceDigest && typeof verifyImplementationSource === 'function',
      'different authority image requires independently qualified implementation proof');
    const qualification = await verifyImplementationSource({ bundle: copy(bundle),
      originalEvidence: await artifactStore.get(opening.sourceEvidenceDigest), implementationCommit: actualImplementation });
    requireThat(qualification.implementationCommit === actualImplementation &&
      /^[a-f0-9]{40}$/u.test(qualification.implementationTree), 'qualified actual authority implementation identity');
    const qualificationEvidenceDigest = opening.implementation?.qualificationEvidenceDigest ??
      await artifactStore.put(qualification);
    const qualified = await sign('evaluation', { schema: 'gk-learning-v2-qualified-implementation',
      receiptId: receiptId('implementation', { binding: bundle.binding, actualImplementation, qualificationEvidenceDigest }),
      purpose: CONTINUATION_PURPOSE, binding: bundle.binding, implementationCommit: actualImplementation,
      implementationTree: qualification.implementationTree, qualification: qualification.qualification,
      qualificationEvidenceDigest, runId: qualification.runId, rawLogsDigest: qualification.rawLogsDigest });
    await ledger.change('separate-implementation-qualified', state => {
      if (state.implementation) requireThat(state.implementation.qualification === serialized(qualified),
        'implementation qualification cannot replace an original decision');
      else state.implementation = { qualification: serialized(qualified), qualificationEvidenceDigest,
        preparation: null, authorization: null, ownerAuthorizationDigest: null };
    });
  }
  const requireImplementationAuthorization = async () => {
    if (observationAuthority) { await observationAuthority.requireRemainder(); return; }
    if (actualImplementation === bundle.config.sourceCommit) return;
    const state = await ledger.read(), authorization = state.implementation?.authorization;
    requireThat(authorization && JSON.parse(authorization).body.implementationCommit === actualImplementation &&
      JSON.parse(authorization).body.allowCorrectedReaderRemainder === true,
    'qualified implementation is restricted to nondispatching prepare until owner authorization');
  };
  const planFor = op => artifactStore.get(op.planDigest);
  const entryFor = async call => ({ ...(await artifactStore.get(call.intentDigest)),
    sessionId: call.sessionId, turnId: call.turnId,
    ...(call.createdBySubject === null ? {} : { createdBySubject: call.createdBySubject }) });
  const verifyCall = async (call, requireComplete = true) => {
    requireThat(call.stage === 'turn-created' && call.relay?.status !== 'claimed' &&
      call.relay?.status !== 'forwarding', 'provider dispatch remains unresolved');
    const observed = await inspectProviderCall(provider, await entryFor(call), { requireComplete });
    // An SDK model.message can exist before an HTTP request. Only the protected
    // relay's durable claim establishes an actual outbound inference attempt.
    if (requireComplete) requireThat(call.relay?.status === 'complete' &&
      observed.observedModelCalls === 1, 'complete SDK turn lacks complete owned provider dispatch');
    if (observed.observedModelCalls > 0) requireThat(call.relay,
      'unowned model activity outside the protected provider relay');
    const artifactDigest = await artifactStore.put(observed);
    await ledger.change('provider-evidence-retained', state => {
      const held = callById(state, call.callId).call;
      same(held.relay, call.relay, 'provider dispatch changed during verification');
      if (held.evidenceDigest !== null) requireThat(held.evidenceDigest === artifactDigest,
        'provider evidence changed after terminal verification');
      held.evidenceDigest = artifactDigest;
      if (state.activeCallId === held.callId) state.activeCallId = null;
    });
    return observed;
  };
  const requireFinishedPrevious = async () => {
    const state = await ledger.read();
    if (state.activeCallId !== null) {
      const { call } = callById(state, state.activeCallId);
      await verifyCall(call, true);
    }
  };
  const expectedCall = async (op, plan, slot) => {
    let rendered;
    if (slot.kind === 'proposal') {
      const { instructions, ...visible } = plan.request.learner;
      rendered = { instructions, message: canonical(visible) };
    } else {
      const manifest = bundle.config.cases.find(item => item.caseId === slot.caseId);
      const caseInput = bundle.caseInputs.find(item => item.caseId === slot.caseId);
      let firstFindings;
      if (slot.pass === 2) {
        const firstSlot = { ...slot, pass: 1 };
        if (op.kind === 'screen' && slot.arm === 'candidate') firstSlot.arm = 'incumbent';
        const first = op.calls.find(item => item.callId === authorityCallId(op.id, firstSlot));
        requireThat(first, 'authority second pass lacks its independently owned first pass');
        const observed = await verifyCall(first, true);
        firstFindings = parseReview(observed.text, caseInput.prompt);
      }
      rendered = renderReview({ artifact: plan.request.prompts[slot.arm],
        originalBase: bundle.config.baseInstructions, caseInput, scope: manifest.scope,
        pass: slot.pass, ...(slot.pass === 2 ? { firstFindings } : {}) });
    }
    const call = { callId: authorityCallId(op.id, slot), operationId: op.id,
      leaseId: op.leaseId, requestDigest: op.requestDigest, sourceCommit: bundle.config.sourceCommit,
      runtimeDigest: bundle.config.runtimeDigest, model: copy(bundle.runtime.model),
      instructions: rendered.instructions, message: rendered.message };
    return { callId: call.callId, slot: copy(slot), inputDigest: turnInputDigest(call),
      sessionRequest: { agent: { spec: { model: copy(bundle.runtime.model),
        instructions: call.instructions, config: copy(TURN_CONFIG) } },
      metadata: { purpose: 'gk-learning-v2', callId: call.callId, operationId: op.id,
        requestDigest: op.requestDigest } },
      turnRequest: { input: [{ type: 'user.message', content: call.message }], previousTurnId: 'none' } };
  };

  async function managedGate() {
    const state = await ledger.read();
    if (state.gate !== null) return JSON.parse(state.gate);
    requireThat(state.operations.length === 0, 'source gate must precede execution');
    // The production implementation retrieves the exact owner qualification and
    // Gitar artifacts itself, using an operator-pinned proof descriptor.
    const proof = await verifySourceGate(copy(bundle));
    record(proof, ['runId', 'rawLogsDigest', 'evidence'], 'verified source gate');
    identifier(proof.runId, 'source gate run ID');
    requireThat(/^[a-f0-9]{64}$/u.test(proof.rawLogsDigest), 'source gate logs digest');
    const evidenceDigest = await artifactStore.put(proof.evidence);
    const envelope = await sign('evaluation', { schema: 'gk-learning-v2-managed-gate',
      receiptId: receiptId('gate', { identity, evidenceDigest }), ...identity, ...bundle.config.gatePolicy,
      status: 'passed', fullSuite: true, independent: true, baseCurrent: true,
      cleanupComplete: true, noSkippedChecks: true, runId: proof.runId,
      rawLogsDigest: proof.rawLogsDigest });
    return ledger.change('source-gate-verified', current => {
      if (current.gate !== null) return JSON.parse(current.gate);
      requireThat(current.operations.length === 0, 'source gate raced execution');
      current.gate = serialized(envelope);
      current.sourceEvidenceDigest = evidenceDigest;
      return envelope;
    });
  }

  function originalBaseEligible(state) {
    const op = state.operations[0];
    requireThat(actualImplementation !== bundle.config.sourceCommit && state.implementation &&
      state.operations.length === 1 && op?.kind === 'baseline' && op.attemptId === null && op.maxCalls === 14 &&
      !op.complete && op.settlement === null && !op.reconciliation && op.evaluations.length === 0 &&
      state.baseline === null && !state.baselineError && state.attempts.length === 0 &&
      state.reviews.length === 0 && state.activationHistory.length === 0 &&
      op.calls.length === 1 && op.calls[0].stage === 'turn-created' && op.calls[0].relay?.status === 'complete' &&
      (state.activeCallId === null || state.activeCallId === op.calls[0].callId),
    'continuation requires exactly one original complete owned BASE call and no second authority intent');
    return op;
  }

  /** Independent provider reads and signed absence proof; no SDK mutation,
   * dispatch claim, new lease, result consumption or settlement is performed. */
  async function prepareBaselineContinuation({ checkpoint: supplied }) {
    requireThat(!observationAuthority, 'D cannot replace or replay historical B BASE continuation');
    const checked = validateOriginalBaselinePacket(supplied, { runtime: bundle.runtime,
      caseInputs: bundle.caseInputs, originalBase: bundle.config.baseInstructions });
    same(checked.packet.binding, bundle.binding, 'continuation checkpoint changed frozen experiment');
    let state = await ledger.read(), op = originalBaseEligible(state);
    requireThat(state.implementation.authorization === null, 'BASE continuation already authorized');
    const plan = await planFor(op);
    same(checked.packet.request, plan.request, 'host continuation request differs from independently admitted plan');
    for (const key of ['id', 'kind', 'attemptId', 'namespace', 'requestDigest']) requireThat(
      checked.packet.operation[key] === op[key], 'host continuation operation differs from authority');
    requireThat(checked.packet.operation.leaseId === op.leaseId &&
      checked.retained.firstCallId === op.calls[0].callId &&
      plan.slots.length === 14 && checked.retained.secondCallId === authorityCallId(op.id, plan.slots[1]),
    'host continuation lease or deterministic slots differ');
    if (state.implementation.preparation) {
      const prior = JSON.parse(state.implementation.preparation);
      same(prior.body.retained, checked.retained, 'nondispatching BASE preparation cannot replace retained evidence');
      return prior;
    }
    const observed = await verifyCall(op.calls[0], true);
    for (const key of ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest', 'text']) requireThat(
      checked.first[key] === observed[key], 'host original first final differs from authentic provider evidence');
    const expected = await expectedCall(op, plan, plan.slots[0]);
    requireThat(observed.inputDigest === expected.inputDigest,
      'original first provider input differs from frozen authority prompt/model');
    state = await ledger.read(); op = originalBaseEligible(state);
    requireThat(state.activeCallId === null && op.calls[0].evidenceDigest !== null,
      'original first call remains ambiguous after independent verification');
    const beforeDigest = digest(state), authorityPreparedHead = (await journal.read()).head;
    const prepared = await sign('evaluation', { schema: 'gk-learning-v2-baseline-continuation-prepared',
      receiptId: receiptId('base-prepared', { identity, hostPacketDigest: checked.retained.hostPacketDigest,
        implementationCommit: actualImplementation }), purpose: CONTINUATION_PURPOSE, binding: bundle.binding,
      implementationCommit: actualImplementation, qualificationDigest: digest(JSON.parse(state.implementation.qualification)),
      retained: checked.retained, authorityPreparedHead, authorityOperationDigest: digest(op),
      originalAuthorityCalls: 1, secondIntentAbsent: true, preparedAt: new Date(clock()).toISOString() });
    const checkpointDigest = await artifactStore.put(checked.packet);
    return ledger.change('original-base-continuation-prepared-without-dispatch', current => {
      requireThat(digest(current) === beforeDigest, 'authority changed during nondispatching BASE prepare');
      current.implementation.preparation = serialized(prepared);
      current.implementation.hostCheckpointDigest = checkpointDigest;
      return prepared;
    });
  }

  /** Protected control-plane input only, never exposed as a driver RPC. */
  async function authorizeBaselineContinuation(descriptor) {
    requireThat(!observationAuthority, 'D cannot replace historical B owner authorization');
    const state = await ledger.read();
    requireThat(typeof verifyContinuationOwner === 'function' && state.implementation?.preparation,
      'independent owner authorization verifier or original prepare absent');
    if (state.implementation.authorization) {
      const prior = JSON.parse(state.implementation.authorization);
      same(prior.body.ownerAuthorization, descriptor, 'BASE owner authorization replacement denied');
      return prior;
    }
    const op = originalBaseEligible(state), preparedEnvelope = JSON.parse(state.implementation.preparation);
    requireThat(state.activeCallId === null && op.calls[0].evidenceDigest !== null &&
      digest(op) === preparedEnvelope.body.authorityOperationDigest,
    'authority original state changed after nondispatching prepare');
    const qualificationEnvelope = JSON.parse(state.implementation.qualification);
    const verified = await verifyContinuationOwner({ descriptor: copy(descriptor), preparedEnvelope,
      qualificationEnvelope, qualificationEvidence: await artifactStore.get(state.implementation.qualificationEvidenceDigest),
      bundle: copy(bundle) });
    const ownerAuthorizationDigest = await artifactStore.put(verified);
    const envelope = await sign('evaluation', { schema: 'gk-learning-v2-baseline-continuation',
      receiptId: receiptId('base-continuation', { identity, ownerAuthorizationDigest }),
      purpose: CONTINUATION_PURPOSE, binding: bundle.binding, implementationCommit: actualImplementation,
      implementationTree: qualificationEnvelope.body.implementationTree, qualificationDigest: digest(qualificationEnvelope),
      ownerAuthorizationDigest, ownerAuthorization: copy(descriptor), preparedProofDigest: digest(preparedEnvelope),
      retained: preparedEnvelope.body.retained, authorityPreparedHead: preparedEnvelope.body.authorityPreparedHead,
      authorityOperationDigest: preparedEnvelope.body.authorityOperationDigest, originalAuthorityCalls: 1,
      secondIntentAbsent: true, allowCorrectedReaderRemainder: true });
    const beforeDigest = digest(state);
    return ledger.change('original-base-continuation-owner-authorized', current => {
      requireThat(digest(current) === beforeDigest, 'authority state changed during owner authorization');
      current.implementation.authorization = serialized(envelope);
      current.implementation.ownerAuthorizationDigest = ownerAuthorizationDigest;
      return envelope;
    });
  }

  async function admit(input) {
    await requireImplementationAuthorization();
    record(input, ['operation', 'request'], 'authority admission');
    const captured = copy(input);
    const runtimeEvidence = await verifyRuntime();
    requireThat(runtimeEvidence?.status === 'ok' && runtimeEvidence.serverVersion === bundle.runtime.serverVersion,
      'actual server runtime differs from frozen version');
    const runtimeEvidenceDigest = await artifactStore.put(runtimeEvidence);
    return ledger.change('operation-admitted', async state => {
      const existing = state.operations.find(item => item.id === captured.operation.id);
      if (existing) {
        const admitted = await planFor(existing);
        same(captured, { operation: admitted.operation, request: admitted.request },
          'authority admission replay differs');
        return JSON.parse(existing.lease);
      }
      requireThat(state.activeCallId === null && state.operations.every(item => item.settlement !== null),
        'previous authority operation unresolved');
      const plan = reconstructAuthorityRequest(bundle, state, captured.operation.kind, captured.operation.attemptId);
      same(captured, { operation: plan.operation, request: plan.request }, 'untrusted driver plan differs from frozen authority plan');
      requireThat(!state.operations.some(item => item.kind === plan.operation.kind &&
        item.attemptId === plan.operation.attemptId), 'logical authority operation already admitted');
      const planDigest = await artifactStore.put(plan);
      const now = clock();
      const lease = await sign('budget', { schema: 'gk-learning-v2-operation-lease',
        receiptId: receiptId('lease', { identity, operation: plan.operation }), ...identity,
        budgetId: bundle.config.budgetId, gatewayId: bundle.trust.budget.gatewayId,
        provider: POLICY.provider, global: false, ceilingMicros: null, ...plan.operation,
        model: bundle.config.model, managedGateDigest: plan.request.managedGateDigest,
        namespaceExclusive: true, providerLimitEnforced: false, maxCalls: plan.request.requiredCalls,
        reservationMicros: 0, spentMicros: 0, reservedMicros: 0,
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() });
      if (plan.proposedAttempt) state.attempts.push(plan.proposedAttempt);
      state.operations.push({ ...plan.operation, planDigest, lease: serialized(lease), leaseId: lease.body.receiptId,
        runtimeEvidenceDigest, maxCalls: plan.request.requiredCalls, calls: [], evaluations: [],
        settlement: null, complete: false });
      return lease;
    });
  }

  async function createSession(supplied) {
    const captured = copy(supplied);
    await requireImplementationAuthorization();
    await requireFinishedPrevious();
    const state = await ledger.read();
    const op = state.operations.find(item => item.settlement === null);
    requireThat(op, 'no admitted authority operation');
    const plan = await planFor(op);
    const slot = plan.slots[op.calls.length];
    requireThat(slot, 'authority planned call limit reached');
    // The previous evaluation arm must be independently scored before a later
    // arm starts, matching the exact deterministic executor schedule.
    if (slot.kind !== 'proposal') {
      const armIndex = plan.evaluations.findIndex(item => item.arm === slot.arm && item.expected.pairId === slot.pairId);
      requireThat(op.evaluations.length === armIndex, 'authority evaluation schedule drift');
    }
    const entry = await expectedCall(op, plan, slot);
    same(captured, entry.sessionRequest, 'caller session differs from authority-rendered call');
    const intentDigest = await artifactStore.put(entry);
    await ledger.change('session-intent', current => {
      const held = byId(current, op.id);
      requireThat(held.settlement === null && current.activeCallId === null &&
        held.calls.length === op.calls.length, 'concurrent or repeated authority call');
      const prior = held.calls.at(-1);
      requireThat(!prior || prior.evidenceDigest !== null, 'prior call not independently verified');
      // The bounded, exclusive operation was admitted while its lease was
      // current. Once it starts, elapsed time cannot orphan its remaining
      // exact slots; no new lease, extra slot or repeated call is authorized.
      if (held.calls.length === 0) requireThat(clock() <= Date.parse(JSON.parse(held.lease).body.expiresAt),
        'authority lease expired before first dispatch');
      held.calls.push({ callId: entry.callId, slot: copy(slot), intentDigest, stage: 'session-intent',
        sessionId: null, turnId: null, createdBySubject: null, relay: null, evidenceDigest: null });
      current.activeCallId = entry.callId;
    });
    // No retry: a lost response leaves the durable intent unresolved.
    const response = providerJson(await provider.sessions.create(captured, sdkOptions));
    const session = response.data;
    assertInlineSession(session, { ...entry, sessionId: session?.id });
    identifier(session.id, 'created provider session');
    await ledger.change('session-created', current => {
      const held = callById(current, entry.callId).call;
      requireThat(held.stage === 'session-intent' && held.sessionId === null, 'session response replay');
      requireThat(!current.operations.some(operation => operation.calls.some(call =>
        call.callId !== held.callId && call.sessionId === session.id)), 'provider session reused');
      held.sessionId = session.id;
      held.createdBySubject = session.createdBySubject ?? null;
      held.stage = 'session-created';
    });
    return response;
  }

  async function createTurn(sessionId, supplied) {
    const captured = copy(supplied);
    await requireImplementationAuthorization();
    let entry;
    await ledger.change('turn-intent', async state => {
      const { operation, call } = callById(state, state.activeCallId);
      requireThat(operation.settlement === null && call.sessionId === sessionId &&
        call.stage === 'session-created' && call.turnId === null && call.relay === null,
      'unowned or repeated root turn');
      entry = await entryFor(call);
      same(captured, entry.turnRequest, 'caller root turn differs from authority-rendered input');
      call.stage = 'turn-intent';
    });
    // The relay can now claim this exact call while this SDK request awaits.
    const response = providerJson(await provider.sessions.createTurn(sessionId, captured, sdkOptions));
    const turn = response.data;
    identifier(turn?.id, 'created provider turn');
    requireThat(turn.sessionId === sessionId && turn.previousTurnId === null, 'created turn isolation');
    await ledger.change('turn-created', state => {
      const held = callById(state, entry.callId).call;
      requireThat(held.stage === 'turn-intent' && held.turnId === null, 'turn response replay');
      held.turnId = turn.id;
      held.stage = 'turn-created';
    });
    return response;
  }

  async function ownedRead(method, args) {
    requireThat(['getTurn', 'listTurnEvents'].includes(method), 'authority SDK read method');
    const [sessionId, turnId, request] = args;
    const state = await ledger.read();
    const owned = state.operations.flatMap(item => item.calls)
      .find(item => item.sessionId === sessionId && item.turnId === turnId && turnId !== null);
    requireThat(owned, 'unowned provider read');
    if (method === 'getTurn') return providerJson(await provider.sessions.getTurn(sessionId, turnId, sdkOptions));
    requireThat(request && request.order === 'asc' && request.limit === 100 &&
      Object.keys(request).every(key => ['order', 'limit', 'pageToken'].includes(key)) &&
      (request.pageToken === undefined || typeof request.pageToken === 'string' && request.pageToken.length <= 4096),
    'authority event page request');
    return providerJson((await provider.sessions.listTurnEvents(sessionId, turnId, request, sdkOptions)).response);
  }

  async function issueEvaluation(supplied) {
    await requireImplementationAuthorization();
    record(supplied, ['expected', 'observation', 'runtime', 'sourceCommit', 'configDigest',
      'benchmarkDigest', 'scorerDigest'], 'evaluation issuer input');
    const input = copy(supplied);
    same(input.runtime, bundle.runtime, 'evaluation runtime differs from frozen runtime');
    for (const key of ['sourceCommit', 'benchmarkDigest', 'scorerDigest']) {
      requireThat(input[key] === bundle.config[key], 'evaluation frozen identity mismatch');
    }
    requireThat(input.configDigest === bundle.binding.configDigest, 'evaluation config mismatch');
    const state = await ledger.read();
    const op = byId(state, input.expected.operationId);
    const plan = await planFor(op);
    const index = plan.evaluations.findIndex(item => item.expected.pairId === input.expected.pairId &&
      item.expected.executionIndex === input.expected.executionIndex);
    requireThat(index >= 0 && op.settlement === null, 'evaluation is not admitted');
    const scheduled = plan.evaluations[index];
    const expected = { ...scheduled.expected, operationId: op.id, requestDigest: op.requestDigest };
    same(input.expected, expected, 'evaluation request differs from frozen arm');
    const existing = op.evaluations[index];
    if (existing) return JSON.parse(existing.envelope);
    requireThat(index === op.evaluations.length, 'evaluation issuance order');
    record(input.observation, ['cases'], 'evaluation observation');
    requireThat(Array.isArray(input.observation.cases) && input.observation.cases.length === expected.cases.length,
      'evaluation observation coverage');
    const cases = [], details = [];
    const reusedArm = op.kind === 'screen' && scheduled.arm === 'candidate';
    const origin = reusedArm ? op.evaluations.find(item => item.arm === 'incumbent' &&
      item.pairId === expected.pairId) : null;
    requireThat(!reusedArm || origin, 'screening reuse lacks verified paired incumbent');
    for (const [caseIndex, manifest] of expected.cases.entries()) {
      const assertion = input.observation.cases[caseIndex];
      record(assertion, ['caseId', 'mergedFindings', 'passes', 'rawTurns'], 'evaluation case assertion');
      requireThat(assertion.caseId === manifest.caseId && Array.isArray(assertion.rawTurns) &&
        assertion.rawTurns.length === 2, 'evaluation case order or captured turns');
      const results = [], passes = [];
      for (const pass of [1, 2]) {
        const reuse = reusedArm && (pass === 1 || !expected.applicableCaseIds.includes(manifest.caseId));
        const requestedSlot = { pairId: expected.pairId, arm: scheduled.arm, caseId: manifest.caseId, pass };
        const sourceSlot = { ...requestedSlot, arm: reuse ? 'incumbent' : scheduled.arm };
        const source = op.calls.find(item => item.callId === authorityCallId(op.id, sourceSlot));
        requireThat(source, 'evaluation lacks an owned call');
        const result = await verifyCall(source, true);
        const exactInput = await expectedCall(op, plan, requestedSlot);
        requireThat(result.inputDigest === exactInput.inputDigest,
          'reused or fresh pass differs from frozen model-visible input');
        if (reuse) {
          const prior = origin.verified.cases.find(item => item.caseId === manifest.caseId)?.passes
            .find(item => item.pass === pass);
          requireThat(prior && prior.callId === result.callId && prior.inputDigest === result.inputDigest &&
            prior.outputDigest === result.outputDigest && prior.sessionId === result.sessionId &&
            prior.turnId === result.turnId, 'reuse differs from independently signed paired origin');
        }
        const asserted = assertion.rawTurns[pass - 1];
        requireThat(asserted && asserted.complete === true && asserted.finishReason === 'stop' &&
          Array.isArray(asserted.toolCalls) && asserted.toolCalls.length === 0 &&
          Array.isArray(asserted.requiredActions) && asserted.requiredActions.length === 0,
        'caller raw observation is incomplete');
        for (const key of ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest', 'text']) {
          requireThat(asserted[key] === result[key], 'caller observation differs from authentic provider artifact');
        }
        results.push(result);
        passes.push(passEvidence(result, pass, reuse ? origin.verified.receiptId : null));
      }
      const caseInput = bundle.caseInputs.find(item => item.caseId === manifest.caseId);
      const first = parseReview(results[0].text, caseInput.prompt);
      const merged = mergeReviews(caseInput.prompt, first, parseRawReview(results[1].text));
      same(assertion.mergedFindings, merged, 'caller merged findings differ from independent renderer');
      same(assertion.passes, passes, 'caller pass evidence differs from authentic artifacts');
      const oracle = bundle.corpus.cases.find(item => item.caseId === manifest.caseId);
      const score = scoreFrozenFindings(oracle, merged);
      cases.push({ caseId: manifest.caseId, caught: score.caught, falseAlarms: score.falseAlarms, passes });
      details.push({ caseId: manifest.caseId, mergedFindings: merged, ...score });
    }
    const { cases: expectedManifest, ...context } = expected;
    const envelope = await sign('evaluation', { schema: 'gk-learning-v2-evaluation',
      receiptId: receiptId('evaluation', { operationId: op.id, pairId: expected.pairId, arm: scheduled.arm }),
      ...context, provider: POLICY.provider, memory: POLICY.memory, complete: true, cases });
    const verified = retained(verifyEvaluation(envelope, bundle.trust.evaluation, expected));
    const detailsDigest = await artifactStore.put(details);
    return ledger.change('evaluation-independently-scored', current => {
      const held = byId(current, op.id);
      if (held.evaluations[index]) return JSON.parse(held.evaluations[index].envelope);
      requireThat(held.evaluations.length === index && held.settlement === null, 'concurrent evaluation issuance');
      held.evaluations.push({ arm: scheduled.arm, pairId: expected.pairId,
        envelope: serialized(envelope), verified, detailsDigest });
      if (held.evaluations.length === plan.evaluations.length) {
        requireThat(held.calls.length === held.maxCalls &&
          held.calls.every(call => call.evidenceDigest !== null), 'complete evaluation lacks all planned calls');
        held.complete = true;
        if (held.kind === 'baseline') current.baseline = verified;
        else {
          const attempt = current.attempts.find(item => item.id === held.attemptId);
          requireThat(attempt, 'evaluation attempt absent');
          if (held.kind === 'screen') {
            const control = held.evaluations[0].verified, proposed = held.evaluations[1].verified;
            const decision = compareEvaluations({ base: current.baseline, incumbent: control, candidate: proposed });
            attempt.screen = { control, proposed, decision };
            attempt.status = decision.passed ? 'provisional' : 'rejected';
            const regression = decision.gain < 0 || decision.reasons.some(reason =>
              reason.includes('below_incumbent') || reason.includes('below_base'));
            attempt.disposition = decision.passed ? 'screen-positive' : regression ? 'observed-regression' : 'unproven';
          } else {
            const results = plan.request.plan.pairs.map(pair => {
              const evaluated = Object.fromEntries(pair.order.map(arm => [arm,
                held.evaluations.find(item => item.pairId === pair.pairId && item.arm === arm).verified]));
              return { pairId: pair.pairId, order: pair.order, evaluated,
                decision: compareEvaluations({ base: evaluated.base || evaluated.incumbent,
                  incumbent: evaluated.incumbent, candidate: evaluated.candidate }) };
            });
            attempt.confirmation = results;
            const passed = results.every(item => item.decision.passed);
            attempt.status = passed ? 'confirmed' : 'rejected';
            attempt.disposition = passed ? 'confirmation-qualified' : 'not-confirmed';
            if (passed) current.versions.push({ ...copy(attempt.version), confirmed: true, origin: attempt.id,
              evidenceDigest: digest(results), configDigest: bundle.binding.configDigest });
          }
        }
      }
      return envelope;
    });
  }

  async function proposalFacts(operationId) {
    const state = await ledger.read();
    const op = byId(state, operationId);
    requireThat(op.kind === 'proposal' && op.calls.length === 1, 'owned proposal call absent');
    const plan = await planFor(op);
    const call = await verifyCall(op.calls[0], true);
    const candidate = parsedProposal(call.text, bundle.config.scope);
    const attempt = state.attempts.find(item => item.id === op.attemptId);
    requireThat(attempt, 'authority proposal attempt absent');
    // The current candidate is not one of its own historical comparisons.
    const priorState = { ...state, attempts: state.attempts.filter(item => item.id !== attempt.id) };
    const history = authorityReferences(bundle, priorState);
    requireThat(digest(history) === attempt.historyDigest, 'protected complete history changed');
    return { state, op, plan, call, candidate, attempt, history };
  }

  async function issueNovelty(supplied) {
    await requireImplementationAuthorization();
    record(supplied, ['expected', 'candidate', 'priorReferences', 'caseInputs', 'coverageManifest',
      'proposalCall'], 'novelty issuer input');
    const input = copy(supplied);
    const facts = await proposalFacts(input.expected.operationId);
    const { op, call, candidate, attempt, history } = facts;
    requireThat(candidate && op.settlement === null, 'proposal cannot receive novelty evidence');
    const expected = { ...identity, attemptId: op.attemptId, candidateDigest: procedureFingerprint(candidate),
      incumbentVersionId: attempt.incumbentVersionId, originalVersionId: facts.state.baseVersion.id,
      historyDigest: attempt.historyDigest, policyVersion: 'gk-procedure-equivalence-v1',
      sourceScopeVerified: true, operationId: op.id, requestDigest: op.requestDigest };
    same(input.expected, expected, 'novelty caller context differs from protected history');
    same(input.candidate, candidate, 'novelty caller proposal differs from authentic output');
    same(input.priorReferences, history, 'novelty caller omitted or altered prior procedures');
    same(input.caseInputs, bundle.caseInputs, 'novelty applicability corpus changed');
    const coverageManifest = bundle.config.cases.map(({ expectedBugs, passes, ...item }) => item);
    same(input.coverageManifest, coverageManifest, 'novelty applicability manifest changed');
    for (const key of ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest', 'text']) {
      requireThat(input.proposalCall?.[key] === call[key], 'novelty proposal call substitution');
    }
    const packet = { schema: 'gk-learning-authority-review-context-v1', expected, candidate,
      priorReferences: history, legacyBank: bundle.legacyBank, legacyBankDigest: bundle.legacyBankDigest,
      nonProcedureRecords: bundle.nonProcedureRecords, caseInputs: bundle.caseInputs, coverageManifest,
      proposalEvidenceDigest: digest(call), reviewerId };
    const contextDigest = digest(packet);
    const reviewId = 'review-' + contextDigest;
    const packetDigest = await artifactStore.put(packet);
    const outcome = await ledger.change('novelty-review-queued', state => {
      const existing = state.reviews.find(item => item.operationId === op.id);
      if (existing) {
        requireThat(existing.contextDigest === contextDigest, 'novelty review context changed');
        return copy(existing);
      }
      const heldAttempt = state.attempts.find(item => item.id === attempt.id);
      requireThat(heldAttempt.status === 'reserved' && !heldAttempt.candidate, 'proposal already classified');
      heldAttempt.candidate = candidate;
      heldAttempt.candidateDigest = expected.candidateDigest;
      const review = { id: reviewId, operationId: op.id, contextDigest, packetDigest,
        decisionDigest: null, envelope: null };
      state.reviews.push(review);
      return copy(review);
    });
    if (outcome.envelope !== null) return JSON.parse(outcome.envelope);
    throw pendingReview(outcome);
  }

  /** Operator-only control-plane input; deliberately absent from public RPC. */
  async function applyProtectedReview(supplied) {
    await requireImplementationAuthorization();
    record(supplied, ['schema', 'reviewId', 'contextDigest', 'reviewer', 'verdict',
      'comparisons', 'coverageCaseIds', 'coverageReasons'], 'protected novelty decision');
    const decision = copy(supplied);
    requireThat(decision.schema === 'gk-learning-authority-review-v1', 'protected review schema');
    record(decision.reviewer, ['id', 'evidenceRef'], 'protected reviewer');
    requireThat(decision.reviewer.id === reviewerId, 'independent reviewer identity mismatch');
    text(decision.reviewer.evidenceRef, 'independent review evidence reference', 2000);
    const state = await ledger.read();
    requireThat(state.activeCallId === null, 'review restart must have no active provider work');
    const review = state.reviews.find(item => item.id === decision.reviewId);
    requireThat(review && review.contextDigest === decision.contextDigest, 'protected decision names another proposal');
    const decisionDigest = digest(decision);
    if (review.decisionDigest !== null) {
      requireThat(review.decisionDigest === decisionDigest, 'protected review cannot overwrite a decision');
      return JSON.parse(review.envelope);
    }
    const packet = await artifactStore.get(review.packetDigest);
    requireThat(digest(packet) === review.contextDigest, 'stored review context integrity');
    const facts = await proposalFacts(review.operationId);
    requireThat(facts.op.settlement === null && facts.attempt.status === 'reserved' &&
      procedureFingerprint(facts.candidate) === packet.expected.candidateDigest &&
      digest(facts.history) === packet.expected.historyDigest && digest(facts.call) === packet.proposalEvidenceDigest,
    'reviewed proposal differs from independently retrieved execution');
    requireThat(['novel', 'equivalent', 'uncertain'].includes(decision.verdict) &&
      Array.isArray(decision.comparisons) && decision.comparisons.length === packet.priorReferences.length,
    'protected review does not cover complete retained history');
    const seen = new Set();
    for (const item of decision.comparisons) {
      record(item, ['priorId', 'relation', 'reason'], 'protected procedure comparison');
      requireThat(packet.priorReferences.some(prior => prior.id === item.priorId) &&
        !seen.has(item.priorId) && ['distinct', 'equivalent', 'uncertain'].includes(item.relation),
      'protected comparison identity or relation');
      seen.add(item.priorId);
      text(item.reason, 'independent semantic comparison reason', 4000);
    }
    const equivalent = decision.comparisons.some(item => item.relation === 'equivalent');
    const uncertain = decision.comparisons.some(item => item.relation === 'uncertain');
    requireThat((decision.verdict === 'equivalent') === equivalent &&
      (decision.verdict !== 'novel' || !uncertain), 'protected novelty verdict inconsistent');
    requireThat(Array.isArray(decision.coverageCaseIds) &&
      new Set(decision.coverageCaseIds).size === decision.coverageCaseIds.length &&
      decision.coverageCaseIds.every(caseId => packet.coverageManifest.some(item =>
        item.caseId === caseId && item.scope === bundle.config.scope)), 'protected applicability coverage');
    requireThat(Array.isArray(decision.coverageReasons) &&
      decision.coverageReasons.length === decision.coverageCaseIds.length, 'protected applicability reasons');
    const covered = new Set();
    for (const item of decision.coverageReasons) {
      record(item, ['caseId', 'reason'], 'protected applicability reason');
      requireThat(decision.coverageCaseIds.includes(item.caseId) && !covered.has(item.caseId),
        'protected applicability reason identity');
      covered.add(item.caseId); text(item.reason, 'independent applicability reason', 4000);
    }
    const envelope = await sign('novelty', { schema: 'gk-learning-v2-novelty',
      receiptId: receiptId('novelty', { reviewId: review.id, decisionDigest }),
      ...packet.expected, verdict: decision.verdict, comparisons: decision.comparisons,
      coverageCaseIds: decision.coverageCaseIds });
    const artifactDigest = await artifactStore.put(decision);
    return ledger.change('independent-novelty-decision', current => {
      const held = current.reviews.find(item => item.id === review.id);
      requireThat(held && held.envelope === null && current.activeCallId === null,
        'concurrent protected novelty decision');
      held.decisionDigest = decisionDigest; held.decisionArtifactDigest = artifactDigest;
      held.envelope = serialized(envelope);
      const attempt = current.attempts.find(item => item.id === facts.op.attemptId);
      attempt.novelty = copy(envelope.body);
      if (!decision.coverageCaseIds.some(caseId => bundle.config.cases.some(item =>
        item.caseId === caseId && item.split === 'fit' && item.learnerVisible))) attempt.status = 'noCoverage';
      else if (decision.verdict !== 'novel') attempt.status = equivalent ? 'duplicate' : 'unresolved';
      else {
        attempt.coverageCaseIds = copy(decision.coverageCaseIds);
        const active = current.versions.find(item => item.id === current.activeVersionId);
        requireThat(active?.id === attempt.incumbentVersionId, 'review incumbent changed');
        attempt.version = version(bundle.config.baseInstructions, [...active.rules,
          { id: attempt.id, procedure: attempt.candidate, coverageCaseIds: attempt.coverageCaseIds }], active.id);
        attempt.status = 'ready';
        byId(current, facts.op.id).complete = true;
      }
      return envelope;
    });
  }

  async function noveltyDecision({ operationId }) {
    const state = await ledger.read();
    const review = state.reviews.find(item => item.operationId === operationId);
    requireThat(review, 'novelty review queue absent');
    if (review.envelope === null) throw pendingReview(review);
    return JSON.parse(review.envelope);
  }

  async function fitFeedback({ attemptId }) {
    await requireImplementationAuthorization();
    const state = await ledger.read();
    requireThat(state.baseline && state.operations.every(item => item.settlement !== null) &&
      attemptId === bundle.config.experimentId + ':attempt:' + (state.attempts.length + 1),
    'fit feedback attempt state');
    if (state.feedback !== null) return JSON.parse(state.feedback);
    const baseline = state.operations.find(item => item.kind === 'baseline');
    const details = await artifactStore.get(baseline.evaluations[0].detailsDigest);
    const examples = bundle.corpus.cases.filter(item => item.split === 'fit').map(item => {
      const score = details.find(value => value.caseId === item.caseId);
      requireThat(score, 'frozen baseline fit evidence absent');
      return { caseId: item.caseId, code: item.prompt,
        feedback: canonical({ origin: 'original-baseline-fit-only', caught: score.caught,
          falseAlarms: score.falseAlarms, matchedExpectedLines: score.matched,
          missedExpected: item.why.filter(value => score.misses.includes(value.line)) }) };
    });
    const envelope = await sign('evaluation', { schema: 'gk-learning-v2-fit-feedback',
      receiptId: receiptId('feedback', { identity, baselineReceiptId: state.baseline.receiptId }),
      ...identity, baselineReceiptId: state.baseline.receiptId,
      origin: 'original-baseline-fit-only', examples });
    return ledger.change('baseline-fit-feedback-issued', current => {
      if (current.feedback === null) current.feedback = serialized(envelope);
      return JSON.parse(current.feedback);
    });
  }

  async function settle(input) {
    await requireImplementationAuthorization();
    record(input, ['operationId', 'leaseId', 'requestDigest'], 'authority settlement request');
    const captured = copy(input);
    let state = await ledger.read();
    let op = byId(state, captured.operationId);
    requireThat(captured.leaseId === op.leaseId && captured.requestDigest === op.requestDigest,
      'settlement operation binding');
    if (op.settlement !== null) return JSON.parse(op.settlement);
    // All calls that may have started must be terminal. A claim without a
    // complete/failed transport result remains outstanding, including restart
    // between the durable claim and the upstream POST.
    for (const call of op.calls) await verifyCall(call, false);
    let proposal = null;
    if (op.kind === 'proposal') {
      proposal = await proposalFacts(op.id);
      const duplicate = proposal.candidate && proposal.history.some(item =>
        procedureFingerprint(item.procedure) === procedureFingerprint(proposal.candidate));
      if (proposal.candidate && !duplicate) {
        const review = proposal.state.reviews.find(item => item.operationId === op.id);
        requireThat(review?.envelope !== null && review?.envelope !== undefined,
          'original paid proposal awaits independent review');
      }
      proposal.duplicate = duplicate;
    }
    state = await ledger.read(); op = byId(state, captured.operationId);
    requireThat(state.activeCallId === null && op.calls.every(call => call.evidenceDigest !== null &&
      (call.relay === null || ['complete', 'failed'].includes(call.relay.status))),
    'ambiguous provider calls remain outstanding');
    // One durable claim per owned call, with a received transport outcome.
    // Unknown prices remain null even when TrueForge supplies estimated USD.
    const actualCalls = op.calls.filter(call => call.relay !== null).length;
    requireThat(actualCalls <= op.maxCalls && (!op.complete || actualCalls === op.maxCalls),
      'settlement differs from independently enforced dispatch count');
    if (op.kind !== 'proposal') requireThat(op.complete, 'evaluation phase has no complete independent evidence');
    const envelope = await sign('budget', { schema: 'gk-learning-v2-operation-settlement',
      receiptId: receiptId('settlement', { identity, operationId: op.id, leaseId: op.leaseId }),
      ...identity, operationId: op.id, leaseId: op.leaseId, budgetId: bundle.config.budgetId,
      gatewayId: bundle.trust.budget.gatewayId, provider: POLICY.provider, global: false,
      ceilingMicros: null, status: 'settled', actualCalls, actualMicros: null });
    return ledger.change('operation-usage-settled-unknown-price', current => {
      const held = byId(current, op.id);
      if (held.settlement !== null) return JSON.parse(held.settlement);
      requireThat(current.activeCallId === null, 'provider work raced settlement');
      if (proposal) {
        const attempt = current.attempts.find(item => item.id === held.attemptId);
        if (proposal.candidate === null) attempt.status = 'invalid';
        else if (proposal.duplicate) {
          attempt.candidate = proposal.candidate;
          attempt.candidateDigest = procedureFingerprint(proposal.candidate);
          attempt.status = 'duplicate';
          attempt.novelty = { verdict: 'exact', priorIds: proposal.history.filter(item =>
            procedureFingerprint(item.procedure) === attempt.candidateDigest).map(item => item.id) };
        }
      }
      held.settlement = serialized(envelope);
      held.actualCalls = actualCalls; held.actualMicros = null;
      return envelope;
    });
  }

  async function activation(input) {
    await requireImplementationAuthorization();
    record(input, ['versionId', 'action'], 'authority activation request');
    requireThat(['activate', 'rollback'].includes(input.action), 'authority activation action');
    const captured = copy(input);
    return ledger.change('confirmed-incumbent-activation-authorized', async state => {
      const replay = state.activationHistory.at(-1);
      if (replay && replay.versionId === captured.versionId && replay.action === captured.action &&
        state.activeVersionId === captured.versionId) {
        const latest = JSON.parse(replay.renewals?.at(-1) || replay.envelope);
        if (Date.parse(latest.body.expiresAt) > clock()) return latest;
        requireThat(state.activeCallId === null && state.operations.every(item => item.settlement !== null) &&
          state.attempts.every(item => !['reserved', 'ready', 'provisional'].includes(item.status)),
        'activation renewal while new work remains open');
        const original = JSON.parse(replay.envelope), now = clock();
        // A renewed envelope retains the original previous-incumbent condition.
        // The host cannot consume it again if it already advanced to the target.
        // Only authorization time/ID changes; no evaluation or pointer changes.
        const renewal = await sign('activation', { ...original.body,
          receiptId: receiptId('activation-renewal', { originalReceiptId: original.body.receiptId,
            sequence: (replay.renewals?.length || 0) + 1 }),
          issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() });
        if (!replay.renewals) replay.renewals = [];
        replay.renewals.push(serialized(renewal));
        return renewal;
      }
      requireThat(state.activeCallId === null && state.operations.every(item => item.settlement !== null) &&
        state.attempts.every(item => !['reserved', 'ready', 'provisional'].includes(item.status)),
      'activation while provider or candidate work remains open');
      const target = state.versions.find(item => item.id === captured.versionId && item.confirmed);
      requireThat(target && target.id !== state.activeVersionId, 'activation requires a confirmed different version');
      if (captured.action === 'activate') requireThat(target.parent === state.activeVersionId,
        'activation must extend the current confirmed incumbent');
      else requireThat(target.id === state.baseVersion.id ||
        state.activationHistory.some(item => item.versionId === target.id), 'rollback target was never active');
      const now = clock();
      const envelope = await sign('activation', { schema: 'gk-learning-v2-activation',
        receiptId: receiptId('activation', { identity, ...captured, previous: state.activeVersionId,
          sequence: state.activationHistory.length }), ...identity, ...captured,
        incumbentVersionId: state.activeVersionId, originalVersionId: state.baseVersion.id,
        evidenceDigest: target.evidenceDigest || null, purpose: 'experiment-incumbent-only',
        issuedAt: new Date(now).toISOString(), expiresAt: new Date(now + 3_600_000).toISOString() });
      state.activationHistory.push({ ...captured, previousVersionId: state.activeVersionId,
        envelope: serialized(envelope) });
      state.activeVersionId = target.id;
      return envelope;
    });
  }

  /** Explicit protected accounting recovery; never authorizes another call. */
  async function applyProtectedReconciliation(supplied) {
    await requireImplementationAuthorization();
    record(supplied, ['schema', 'mode', 'operationId', 'leaseId', 'requestDigest', 'reason'],
      'protected operation reconciliation');
    const input = copy(supplied);
    if (observationAuthority) requireThat(input.operationId !==
      (await observationAuthority.status()).preparationEnvelope?.body.retained.operationId,
    'D original fourth observation cannot be reclassified by generic reconciliation');
    requireThat(input.schema === 'gk-learning-authority-reconciliation-v1', 'operation reconciliation schema');
    requireThat(['failed-execution', 'settlement-only'].includes(input.mode), 'protected reconciliation mode');
    text(input.reason, 'operation reconciliation reason', 2000);
    let state = await ledger.read(), op = byId(state, input.operationId);
    requireThat(!state.implementation?.authorization || op.kind !== 'baseline',
      'authorized original BASE continuation cannot be downgraded by generic reconciliation');
    requireThat(op.leaseId === input.leaseId && op.requestDigest === input.requestDigest,
      'protected reconciliation binding');
    if (op.reconciliation) {
      requireThat(op.reconciliation.inputDigest === digest(input), 'protected reconciliation replacement denied');
      return { admissionEnvelope: JSON.parse(op.lease), settlementEnvelope: JSON.parse(op.settlement),
        reason: op.reconciliation.reason, mode: op.reconciliation.mode };
    }
    if (op.complete || op.settlement !== null) {
      requireThat(input.mode === 'settlement-only', 'completed operation requires original-evidence consumption');
      // This is an ordinary completed operation whose response may have been
      // lost. Reuse its authentic settlement; do not downgrade its result.
      await settle({ operationId: op.id, leaseId: op.leaseId, requestDigest: op.requestDigest });
    } else {
      requireThat(input.mode === 'failed-execution', 'settlement-only requires complete original evidence');
      requireThat(op.settlement === null, 'operation already settled without this reconciliation');
      const verified = [];
      for (const call of op.calls) verified.push(await verifyCall(call, false));
      state = await ledger.read(); op = byId(state, input.operationId);
      requireThat(state.activeCallId === null && op.calls.every(call =>
        call.stage === 'turn-created' && call.evidenceDigest !== null &&
        (call.relay === null || ['complete', 'failed'].includes(call.relay.status))),
      'ambiguous SDK or provider intent cannot be reconciled');
      if (op.kind === 'proposal' && verified.some(call => call.complete)) {
        // Complete proposals need their original structured-output/novelty
        // disposition. They cannot disappear through an accounting shortcut.
        throw new Error('GK_AUTHORITY_COMPLETE_PROPOSAL_REQUIRES_ORIGINAL_REVIEW');
      }
      const actualCalls = op.calls.filter(call => call.relay !== null).length;
      requireThat(actualCalls <= op.maxCalls, 'reconciled dispatch count exceeds owned plan');
      const settlement = await sign('budget', { schema: 'gk-learning-v2-operation-settlement',
        receiptId: receiptId('settlement', { identity, operationId: op.id, leaseId: op.leaseId }),
        ...identity, operationId: op.id, leaseId: op.leaseId, budgetId: bundle.config.budgetId,
        gatewayId: bundle.trust.budget.gatewayId, provider: POLICY.provider, global: false,
        ceilingMicros: null, status: 'settled', actualCalls,
        actualMicros: op.calls.length === 0 ? 0 : null });
      await ledger.change('failed-operation-accounted-without-retry', current => {
        const held = byId(current, op.id);
        requireThat(held.settlement === null && current.activeCallId === null &&
          held.calls.length === op.calls.length, 'operation raced protected reconciliation');
        held.settlement = serialized(settlement);
        held.actualCalls = actualCalls; held.actualMicros = settlement.body.actualMicros;
        held.reconciliation = { inputDigest: digest(input), reason: input.reason, mode: input.mode };
        held.failureReason = input.reason;
        if (held.kind === 'baseline') current.baselineError = input.reason;
        else {
          const attempt = current.attempts.find(item => item.id === held.attemptId);
          requireThat(attempt, 'reconciled attempt absent');
          attempt.status = 'unresolved'; attempt.reason = input.reason;
        }
      });
    }
    return ledger.change('protected-reconciliation-retained', current => {
      const held = byId(current, input.operationId);
      requireThat(held.settlement !== null, 'protected reconciliation settlement absent');
      held.reconciliation = { inputDigest: digest(input), reason: input.reason, mode: input.mode };
      return { admissionEnvelope: JSON.parse(held.lease), settlementEnvelope: JSON.parse(held.settlement),
        reason: input.reason, mode: input.mode };
    });
  }

  /** Called only by the private relay, never by the public driver RPC. */
  async function claimProviderDispatch({ body, requestDigest }) {
    await requireImplementationAuthorization();
    const captured = copy(body);
    requireThat(captured.model === upstreamModelId && /^[a-f0-9]{64}$/u.test(requestDigest),
      'provider relay model or request identity drift');
    return ledger.change('provider-dispatch-claimed', async state => {
      requireThat(state.activeCallId !== null, 'provider request has no admitted active call');
      const { operation, call } = callById(state, state.activeCallId);
      requireThat(operation.settlement === null && ['turn-intent', 'turn-created'].includes(call.stage) &&
        call.relay === null, 'repeated or unowned provider dispatch denied');
      const expected = authorityProviderBody(await entryFor(call), upstreamModelId);
      same(captured, expected, 'provider HTTP body differs from the exact owned prompt, model or parameters');
      const requestArtifactDigest = await artifactStore.put({ body: captured, requestDigest });
      // Claim is durable before the relay attempts its one upstream POST.
      call.relay = { status: 'claimed', requestDigest, claimedAt: new Date(clock()).toISOString(),
        requestArtifactDigest, resultDigest: null, httpStatus: null };
      return { callId: call.callId, operationId: operation.id };
    });
  }
  async function finishProviderDispatch({ callId, status, resultDigest, httpStatus }) {
    await requireImplementationAuthorization();
    requireThat(['complete', 'failed'].includes(status) && /^[a-f0-9]{64}$/u.test(resultDigest) &&
      Number.isSafeInteger(httpStatus) && httpStatus >= 0 && httpStatus <= 599, 'provider relay result');
    return ledger.change('provider-dispatch-finished', state => {
      const call = callById(state, callId).call;
      requireThat(call.relay?.status === 'claimed', 'provider dispatch result replay');
      call.relay.status = status; call.relay.resultDigest = resultDigest; call.relay.httpStatus = httpStatus;
      // Do not clear activeCallId on caller abort or relay completion. Only an
      // independent terminal SDK read can close the owned call.
    });
  }

  return Object.freeze({
    bundle: () => copy(bundle),
    initialize: () => ledger.read(),
    managedGate, admit, settle, issueEvaluation, issueNovelty, fitFeedback, activation, noveltyDecision,
    applyProtectedReview, applyProtectedReconciliation, authorizeBaselineContinuation, prepareBaselineContinuation,
    prepareProposalObservation: input => {
      requireThat(observationAuthority, 'qualified D observation authority absent');
      return observationAuthority.prepare(input);
    },
    authorizeProposalObservation: descriptor => {
      requireThat(observationAuthority, 'qualified D observation authority absent');
      return observationAuthority.authorize(descriptor);
    },
    implementationStatus: async () => {
      if (observationAuthority) return observationAuthority.status();
      const state = await ledger.read();
      requireThat(state.implementation, 'separately qualified implementation absent');
      return { qualificationEnvelope: JSON.parse(state.implementation.qualification),
        authorizationEnvelope: state.implementation.authorization ? JSON.parse(state.implementation.authorization) : null };
    },
    operationReconciliation: async ({ operationId }) => {
      const op = byId(await ledger.read(), operationId);
      requireThat(op.reconciliation && op.settlement !== null, 'protected reconciliation absent');
      return { admissionEnvelope: JSON.parse(op.lease), settlementEnvelope: JSON.parse(op.settlement),
        reason: op.reconciliation.reason, mode: op.reconciliation.mode };
    },
    operatorStatus: async () => {
      const state = await ledger.read();
      const observationStatus = observationAuthority ? await observationAuthority.status() : null;
      const active = state.activeCallId === null ? null : callById(state, state.activeCallId).call;
      return { schema: 'gk-learning-authority-operator-status-v1', binding: bundle.binding,
        implementation: { frozenExperimentCommit: bundle.binding.sourceCommit, actualPlatformCommit: actualImplementation,
          ...(observationStatus ? { historicalImplementationCommit: observationStatus.qualificationEnvelope.body.historicalImplementationCommit,
            historicalQualificationReceiptId: JSON.parse(state.implementation.qualification).body.receiptId,
            proposalObservation: observationStatus } : {}),
          qualificationReceiptId: observationStatus ? observationStatus.qualificationEnvelope.body.receiptId :
            state.implementation ? JSON.parse(state.implementation.qualification).body.receiptId : null,
          continuationReceiptId: state.implementation?.authorization ?
            JSON.parse(state.implementation.authorization).body.receiptId : null,
          preparedProof: state.implementation?.preparation ? JSON.parse(state.implementation.preparation) : null },
        acceptance: authorityAcceptanceView(bundle, state),
        activeVersionId: state.activeVersionId, activeCallId: state.activeCallId,
        activeCall: active ? { callId: active.callId, stage: active.stage,
          sessionId: active.sessionId, turnId: active.turnId, relayStatus: active.relay?.status || 'unclaimed' } : null,
        operations: state.operations.map(op => ({ operationId: op.id, kind: op.kind, attemptId: op.attemptId,
          leaseId: op.leaseId, requestDigest: op.requestDigest, maxCalls: op.maxCalls, complete: op.complete,
          callStates: Object.fromEntries(['session-intent', 'session-created', 'turn-intent', 'turn-created']
            .map(stage => [stage, op.calls.filter(call => call.stage === stage).length])),
          relayStates: Object.fromEntries(['unclaimed', 'claimed', 'complete', 'failed']
            .map(stage => [stage, op.calls.filter(call => (call.relay?.status || 'unclaimed') === stage).length])),
          definiteHttpDispatches: op.calls.filter(call => ['complete', 'failed'].includes(call.relay?.status)).length,
          ambiguousDispatchClaims: op.calls.filter(call => call.relay?.status === 'claimed').length,
          unverifiedSdkCalls: op.calls.filter(call => call.evidenceDigest === null).length,
          settlementReceiptId: op.settlement ? JSON.parse(op.settlement).body.receiptId : null,
          actualCalls: op.actualCalls ?? null, actualMicros: op.actualMicros ?? null })),
        reviews: state.reviews.map(review => ({ reviewId: review.id, operationId: review.operationId,
          contextDigest: review.contextDigest, decided: review.envelope !== null })),
        activationHistory: state.activationHistory.map(item => ({ action: item.action, versionId: item.versionId,
          previousVersionId: item.previousVersionId, originalReceiptId: JSON.parse(item.envelope).body.receiptId,
          renewalCount: item.renewals?.length || 0 })) };
    },
    reviewPacket: async operationId => {
      const state = await ledger.read();
      requireThat(state.activeCallId === null, 'review export while provider work is active');
      const review = state.reviews.find(item => item.operationId === operationId);
      requireThat(review, 'review export absent');
      return { reviewId: review.id, contextDigest: review.contextDigest,
        context: await artifactStore.get(review.packetDigest) };
    },
    reconcileUsage: async ({ operationId }) => {
      const op = byId(await ledger.read(), operationId);
      requireThat(op.settlement !== null, 'usage reconciliation before settlement');
      return { status: 'unknown', operationId, actualCalls: op.actualCalls, actualMicros: null,
        reason: 'The retained provider artifacts expose estimated cost only; no actual billing receipt is available.' };
    },
    sdk: { create: createSession, createTurn, getTurn: (...args) => ownedRead('getTurn', args),
      listTurnEvents: (...args) => ownedRead('listTurnEvents', args) },
    claimProviderDispatch, finishProviderDispatch,
  });
}
