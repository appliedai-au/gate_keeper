/** Separate D qualification/preparation/owner custody. The original authority
 * ledger/artifact store are read only during this protocol. Provider capability
 * here is exclusively the existing bounded read-only inspector. */
import { canonical, copy, digest, record, requireThat } from './contracts.mjs';
import { AuthorityLedger } from './authority-ledger.mjs';
import { inspectProviderCall } from './authority-provider.mjs';
import { TURN_CONFIG } from './trueforge-turn.mjs';
import { continuationLink } from './baseline-continuation.mjs';
import { validateOriginalProposalPacket, verifyOriginalProposalReceipts, originalProposalIsInvalid } from './proposal-observation.mjs';
import { PROPOSAL_OBSERVATION_PURPOSE, PROPOSAL_OBSERVATION_STATUS, verifyProposalObservationStatus } from './proposal-observation-proof.mjs';

const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
const wire = value => { canonical(value); return JSON.stringify(value); };
const receipt = (kind, value) => 'authority-proposal-observation-' + kind + '-' + digest(value);

function settledPrefix(state, packet = null) {
  requireThat(state.activeCallId === null && state.baseline && !state.baselineError && state.operations.length === 5 &&
    state.attempts.length === 4 && state.reviews.length === 0 && state.activationHistory.length === 0 && state.versions.length === 1 &&
    state.activeVersionId === state.versions[0].id, 'D preparation requires original completed BASE and exactly four settled invalid proposals');
  if (packet) {
    same(packet.state.baseline, state.baseline, 'host and authority original BASE evidence differs');
    same(packet.state.baseVersion, state.baseVersion, 'host and authority original BASE version differs');
    same(packet.state.versions, state.versions, 'host and authority version history differs');
  }
  for (const [i, op] of state.operations.entries()) {
    requireThat(!op.reconciliation && op.settlement !== null && op.calls.length === (i === 0 ? 14 : 1) &&
      op.maxCalls === (i === 0 ? 14 : 1) && op.actualCalls === (i === 0 ? 14 : 1) &&
      op.kind === (i === 0 ? 'baseline' : 'proposal') && op.evaluations.length === (i === 0 ? 1 : 0) &&
      op.calls.every(call => call.stage === 'turn-created' && call.relay?.status === 'complete' && call.evidenceDigest !== null),
    'D preparation rejects unresolved, substituted or additional authority work');
    if (i === 0) requireThat(op.complete && op.attemptId === null, 'D preparation BASE incomplete');
    else requireThat(state.attempts[i - 1].number === i && state.attempts[i - 1].status === 'invalid' &&
      state.attempts[i - 1].candidate === null && state.attempts[i - 1].id === op.attemptId,
    'D preparation contains a different proposal disposition');
    if (packet) {
      const held = packet.state.operations[i], entry = packet.dispatch.entries[i];
      requireThat(op.id === held.id && op.leaseId === held.leaseId && op.requestDigest === held.requestDigest &&
        op.lease === entry.admission && (i === 4 || op.settlement === entry.settlement),
      'host and authority original operation/lease/request/receipt sets differ');
      if (i > 0) for (const key of ['id', 'number', 'incumbentVersionId', 'historyDigest', 'candidate'])
        same(packet.state.attempts[i - 1][key], state.attempts[i - 1][key], 'host and authority original attempt ' + key + ' differs');
    }
  }
  return state.operations[4];
}

export async function createProposalObservationAuthority({ bundle, originalLedger, originalJournal, artifactStore,
  provider, sign, sourceEvidence, actualImplementation, historicalStatus, journalFactory, verifyOwner, clock = () => Date.now() }) {
  requireThat(typeof journalFactory === 'function' && typeof verifyOwner === 'function', 'D separate proof custody/owner verifier absent');
  // The caller authenticated actual D before this factory can create a new
  // namespace. Its journal is never the original experiment authority journal.
  const originalBefore = await originalJournal.read(), opening = await originalLedger.read();
  same(historicalStatus, { qualificationEnvelope: JSON.parse(opening.implementation.qualification),
    authorizationEnvelope: JSON.parse(opening.implementation.authorization) }, 'D replaced historical B proof objects');
  const qualifiedBody = evidence => ({ schema: 'gk-learning-qualified-proposal-observation-v1',
    receiptId: receipt('qualification', { binding: bundle.binding, implementationCommit: actualImplementation,
      qualificationEvidenceDigest: evidence.qualificationEvidenceDigest }),
    purpose: PROPOSAL_OBSERVATION_PURPOSE, binding: bundle.binding, implementationCommit: actualImplementation,
    implementationTree: evidence.implementationTree,
    historicalImplementationCommit: historicalStatus.qualificationEnvelope.body.implementationCommit,
    historicalQualificationDigest: digest(historicalStatus.qualificationEnvelope),
    historicalAuthorizationDigest: digest(historicalStatus.authorizationEnvelope), qualification: evidence.qualification,
    qualificationEvidenceDigest: evidence.qualificationEvidenceDigest, runId: evidence.runId, rawLogsDigest: evidence.rawLogsDigest });
  const separateJournal = await journalFactory();
  requireThat(separateJournal !== originalJournal, 'D proof namespace must differ from original authority ledger');
  const first = await separateJournal.read();
  let initial = null;
  if (first.events.length === 0) {
    settledPrefix(opening);
    initial = { schema: 'gk-learning-proposal-observation-authority-v1', binding: bundle.binding,
      qualificationEvidence: copy(sourceEvidence), qualification: wire(await sign('evaluation', qualifiedBody(sourceEvidence))),
      preparation: null, checkpoint: null, authorization: null, ownerEvidence: null };
  }
  const ledger = new AuthorityLedger({ journal: separateJournal, binding: bundle.binding, initial, clock });
  if (initial) await ledger.initialize();
  const saved = await ledger.read();
  record(saved, ['schema', 'binding', 'qualificationEvidence', 'qualification', 'preparation', 'checkpoint', 'authorization', 'ownerEvidence'],
    'separate D authority proof state');
  requireThat(saved.schema === 'gk-learning-proposal-observation-authority-v1', 'D proof custody schema');
  same(saved.binding, bundle.binding, 'D proof changed frozen binding');
  // Fresh GitHub transport metadata can evolve; the retained authenticated
  // qualification receipt and its exact source/run/log/owner facts cannot.
  for (const key of ['implementationCommit', 'implementationTree', 'qualification', 'qualificationPullRequest', 'owner', 'runId', 'rawLogsDigest',
    'qualificationEvidenceDigest'])
    same(saved.qualificationEvidence[key], sourceEvidence[key], 'actual D qualification changed on reopen');
  same(JSON.parse(saved.qualification).body, qualifiedBody(saved.qualificationEvidence), 'D retained qualification evidence changed');
  requireThat((await originalJournal.read()).head === originalBefore.head, 'D qualification changed original authority journal');

  const statusFrom = value => ({ schema: PROPOSAL_OBSERVATION_STATUS, historicalImplementationStatus: historicalStatus,
    qualificationEnvelope: JSON.parse(value.qualification), preparationEnvelope: value.preparation ? JSON.parse(value.preparation) : null,
    authorizationEnvelope: value.authorization ? JSON.parse(value.authorization) : null });
  async function status() {
    const value = await ledger.read();
    const checked = verifyProposalObservationStatus(statusFrom(value), { binding: bundle.binding, trust: bundle.trust,
      implementationCommit: actualImplementation });
    const current = await originalLedger.read();
    same(current.implementation.qualification, wire(historicalStatus.qualificationEnvelope), 'D original B qualification changed');
    same(current.implementation.authorization, wire(historicalStatus.authorizationEnvelope), 'D original B authorization changed');
    if (checked.preparationEnvelope) {
      const prepared = checked.preparationEnvelope.body;
      requireThat(value.checkpoint && digest(value.checkpoint) === prepared.retained.hostPacketDigest,
        'D preparation lost its original host packet');
      const op = current.operations.find(item => item.id === prepared.retained.operationId);
      requireThat(op && digest(op) === prepared.authorityOperationDigest && op.settlement === prepared.settlementSerialized &&
        op.lease === prepared.admissionSerialized, 'D original authority proposal changed after observation');
    }
    return checked;
  }
  await status();

  async function prepare({ checkpoint }) {
    const checked = validateOriginalProposalPacket(checkpoint, { binding: bundle.binding, runtime: bundle.runtime });
    same(checked.packet.dispatch.entries[0].baselineContinuation, continuationLink(historicalStatus.authorizationEnvelope,
      historicalStatus.qualificationEnvelope), 'D preparation changed original B BASE continuation link');
    const value = await ledger.read();
    requireThat(value.authorization === null, 'D observation already owner-authorized');
    const before = await originalJournal.read(), state = await originalLedger.read(), op = settledPrefix(state, checked.packet);
    if (value.preparation) {
      const prior = JSON.parse(value.preparation);
      same(prior.body.retained, checked.retained, 'D preparation cannot substitute original host cut');
      requireThat(prior.body.authorityHead === before.head && prior.body.authorityStateDigest === digest(state),
        'original authority changed after D preparation');
      return prior;
    }
    const plan = await artifactStore.get(op.planDigest), held = op.calls[0];
    same(plan.operation, checked.packet.dispatch.entries[4].operation, 'D original authority operation differs');
    same(plan.request, checked.request, 'D original authority learner request differs');
    requireThat(plan.slots.length === 1 && plan.slots[0].kind === 'proposal' && held.callId === checked.retained.callId &&
      held.sessionId === checked.retained.sessionId && held.turnId === checked.retained.turnId,
    'D later read is not the original sole owned fourth call');
    const intent = await artifactStore.get(held.intentDigest), evidence = await artifactStore.get(held.evidenceDigest);
    requireThat(digest(intent) === held.intentDigest && digest(evidence) === held.evidenceDigest &&
      intent.callId === checked.retained.callId && intent.inputDigest === checked.retained.inputDigest,
    'D original provider intent/evidence digest differs');
    same(intent, { callId: checked.retained.callId, slot: { kind: 'proposal' }, inputDigest: checked.retained.inputDigest,
      sessionRequest: { agent: { spec: { model: bundle.runtime.model, instructions: checked.call.instructions, config: TURN_CONFIG } },
        metadata: { purpose: 'gk-learning-v2', callId: checked.retained.callId, operationId: op.id, requestDigest: op.requestDigest } },
      turnRequest: { input: [{ type: 'user.message', content: checked.call.message }], previousTurnId: 'none' } },
    'original owned provider intent differs from complete frozen prompt/model/root-turn request');
    const owned = { ...intent, sessionId: held.sessionId, turnId: held.turnId,
      ...(held.createdBySubject === null ? {} : { createdBySubject: held.createdBySubject }) };
    // Only GET/list reads. Calling the old verifyCall would append to the B
    // journal/artifacts, so this separate preparation deliberately does not.
    const observed = await inspectProviderCall(provider, owned, { requireComplete: true });
    requireThat(digest(observed) === held.evidenceDigest && originalProposalIsInvalid(observed.text, bundle.config.scope),
      'later provider observation differs from genuine original invalid settlement evidence');
    const body = { schema: 'gk-learning-proposal-observation-prepared-v1',
      receiptId: receipt('prepared', { binding: bundle.binding, implementationCommit: actualImplementation,
        hostPacketDigest: checked.retained.hostPacketDigest, authorityHead: before.head }),
      purpose: PROPOSAL_OBSERVATION_PURPOSE, binding: bundle.binding, implementationCommit: actualImplementation,
      qualificationDigest: digest(JSON.parse(value.qualification)), retained: checked.retained,
      authorityHead: before.head, authorityStateDigest: digest(state), authorityOperationDigest: digest(op),
      authorityEvidenceDigest: held.evidenceDigest, admissionSerialized: op.lease, settlementSerialized: op.settlement,
      observed: { callId: observed.callId, sessionId: observed.sessionId, turnId: observed.turnId,
        inputDigest: observed.inputDigest, outputDigest: observed.outputDigest, text: observed.text,
        complete: observed.complete, finishReason: observed.finishReason, observedModelCalls: observed.observedModelCalls,
        modelDigest: digest(bundle.runtime.model), classification: 'invalid' }, preparedAt: new Date(clock()).toISOString() };
    verifyOriginalProposalReceipts(checked.packet, body, bundle.trust);
    requireThat((await originalJournal.read()).head === before.head && digest(await originalLedger.read()) === digest(state),
      'original authority changed during later read');
    const signed = await sign('evaluation', body);
    await ledger.change('original-fourth-observed-without-dispatch', current => {
      requireThat(current.preparation === null && current.authorization === null && current.qualification === value.qualification,
        'D preparation raced another decision');
      current.preparation = wire(signed); current.checkpoint = checked.packet;
    });
    requireThat((await originalJournal.read()).head === before.head, 'D preparation mutated original authority history');
    return signed;
  }

  async function authorize(descriptor) {
    const value = await ledger.read(), checked = await status();
    requireThat(checked.preparationEnvelope, 'D owner authorization requires actual prepared observation');
    if (value.authorization) {
      same(JSON.parse(value.authorization).body.ownerAuthorization, descriptor, 'D owner decision replacement denied');
      return JSON.parse(value.authorization);
    }
    const before = await originalJournal.read(), current = await originalLedger.read(), prepared = checked.preparationEnvelope.body;
    settledPrefix(current, value.checkpoint);
    requireThat(before.head === prepared.authorityHead && digest(current) === prepared.authorityStateDigest,
      'original authority changed after D preparation');
    const verifiedOwner = await verifyOwner({ descriptor: copy(descriptor), status: checked,
      qualificationEvidence: value.qualificationEvidence, bundle: copy(bundle) });
    const body = { schema: 'gk-learning-proposal-observation-authorized-v1',
      receiptId: receipt('authorized', { binding: bundle.binding, implementationCommit: actualImplementation, ownerEvidenceDigest: digest(verifiedOwner) }),
      purpose: PROPOSAL_OBSERVATION_PURPOSE, binding: bundle.binding, implementationCommit: actualImplementation,
      implementationTree: checked.qualificationEnvelope.body.implementationTree,
      qualificationDigest: digest(checked.qualificationEnvelope), preparedProofDigest: digest(checked.preparationEnvelope),
      retainedDigest: digest(prepared.retained), settlementDigest: digest(prepared.settlementSerialized),
      ownerAuthorization: copy(descriptor), ownerAuthorizationDigest: digest(verifiedOwner),
      allowRemainingExperiment: verifiedOwner.authorization.allowRemainingExperiment };
    requireThat((await originalJournal.read()).head === before.head, 'original authority changed during owner retrieval');
    const signed = await sign('evaluation', body);
    await ledger.change('original-fourth-observation-owner-authorized', saved => {
      requireThat(saved.preparation === value.preparation && saved.authorization === null, 'D owner decision raced');
      saved.ownerEvidence = copy(verifiedOwner); saved.authorization = wire(signed);
    });
    requireThat((await originalJournal.read()).head === before.head, 'D owner authorization mutated original authority history');
    return signed;
  }

  return Object.freeze({ status, prepare, authorize,
    requireRemainder: async () => verifyProposalObservationStatus(await status(), { binding: bundle.binding, trust: bundle.trust,
      implementationCommit: actualImplementation, requireAuthorization: true, requireRemainder: true }) });
}
