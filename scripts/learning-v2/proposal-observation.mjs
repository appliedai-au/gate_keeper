/** A later authenticated observation of one original failed host read. No SDK,
 * admission, remote settlement, original-archive append or retry capability is
 * accepted here. The original failure remains the terminal historical record. */
import { canonical, copy, digest, hash, integer, POLICY, procedure, record, requireThat } from './contracts.mjs';
import { verifyEnvelope } from '../learning-trust.mjs';
import { turnInputDigest } from './trueforge-turn.mjs';
import { LearningController } from './controller.mjs';
import { DispatchLedger } from './dispatch-ledger.mjs';
import { OperationArchive } from './operation-archive.mjs';
import { operationRunBalance } from './run-balance.mjs';
import { continuationLink } from './baseline-continuation.mjs';
import { validateProposalObservationRetained, verifyProposalObservationStatus } from './proposal-observation-proof.mjs';

const SCHEMA = 'gk-learning-original-proposal-observation-journal-v1';
const DISPATCH = 'gk-learning-v2-dispatch-ledger-v1';
const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
const serialized = value => { canonical(value); return JSON.stringify(value); };
const readOnly = snapshot => ({ read: async () => copy(snapshot), append: async () => { throw new Error('read-only observation projection'); } });

export function originalProposalIsInvalid(value, scope) {
  try {
    let output = value.trim();
    const fence = output.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
    if (fence) output = fence[1];
    procedure(JSON.parse(output), scope);
    return false;
  } catch { return true; }
}

/** Recompute, never infer, a retained prefix head. This checks every event in
 * the original cut before allowing a narrowly enumerated new suffix. */
export function observationPrefixHead(snapshot, count = snapshot.events.length) {
  record(snapshot, ['head', 'events'], 'observation journal snapshot');
  requireThat(Array.isArray(snapshot.events), 'observation journal events');
  integer(count, 'observation prefix count', 0, snapshot.events.length);
  let head = null, prefix = null;
  for (let i = 0; i < snapshot.events.length; i++) {
    head = digest({ schema: 'gk-learning-v2-journal-record-v1', sequence: i + 1,
      previousHead: head, event: snapshot.events[i] });
    if (i + 1 === count) prefix = head;
  }
  requireThat(head === snapshot.head, 'observation journal hash chain differs');
  return prefix;
}

export async function createOriginalProposalPacket({ state, dispatch, controllerSnapshot, dispatchSnapshot,
  originalSnapshot, archive, binding, runtime }) {
  const packet = { schema: 'gk-learning-original-fourth-proposal-checkpoint-v1', binding: copy(binding),
    controllerHead: controllerSnapshot.head, controllerCount: controllerSnapshot.events.length,
    dispatchHead: dispatchSnapshot.head, dispatchCount: dispatchSnapshot.events.length,
    originalArchiveHead: originalSnapshot.head, originalArchiveCount: originalSnapshot.events.length,
    state: copy(state), dispatch: copy(dispatch), archive: copy(archive), runtime: copy(runtime) };
  observationPrefixHead(controllerSnapshot); observationPrefixHead(dispatchSnapshot); observationPrefixHead(originalSnapshot);
  same(controllerSnapshot.events.at(-1)?.state, state, 'original fourth state differs from controller journal');
  same(await new DispatchLedger({ journal: readOnly(dispatchSnapshot), experimentId: binding.experimentId,
    configDigest: binding.configDigest }).read(), dispatch, 'original fourth dispatch differs from captured journal');
  same(await new OperationArchive({ journal: readOnly(originalSnapshot) }).read(), archive,
    'original fourth archive differs from captured journal');
  validateOriginalProposalPacket(packet, { binding, runtime });
  return packet;
}

/** The authority also runs this check before it compares its independently
 * owned plan/call/settlement and performs the later read-only provider query. */
export function validateOriginalProposalPacket(supplied, { binding, runtime }) {
  record(supplied, ['schema', 'binding', 'controllerHead', 'controllerCount', 'dispatchHead', 'dispatchCount',
    'originalArchiveHead', 'originalArchiveCount', 'state', 'dispatch', 'archive', 'runtime'], 'original fourth host checkpoint');
  const packet = copy(supplied), { state, dispatch, archive } = packet;
  requireThat(packet.schema === 'gk-learning-original-fourth-proposal-checkpoint-v1', 'original fourth packet schema');
  same(packet.binding, binding, 'original fourth packet changed frozen A');
  same(packet.runtime, runtime, 'original fourth packet changed runtime');
  same(state.policy, POLICY, 'original fourth policy changed');
  requireThat(state.schema === 'gk-learning-v2-experiment' && state.config.experimentId === binding.experimentId &&
    state.config.sourceCommit === binding.sourceCommit && state.configDigest === binding.configDigest &&
    digest({ config: state.config, policy: state.policy, trustPins: state.trustPins, history: state.history }) === binding.configDigest &&
    state.config.runtimeDigest === digest(runtime) && state.config.model === runtime.model.name,
  'original fourth frozen configuration changed');
  requireThat(state.attempts.length === 4 && state.operations.length === 5 && state.baseline && !state.baselineError &&
    !state.baselineNonAdmission && state.activationHistory.length === 0 && state.versions.length === 1 &&
    state.activeVersionId === state.baseVersion.id && state.gate && dispatch.entries.length === 5,
  'only original BASE and four proposals are eligible for later observation');
  for (let i = 0; i < 4; i++) {
    const attempt = state.attempts[i];
    requireThat(attempt.number === i + 1 && attempt.id === `${binding.experimentId}:attempt:${i + 1}` &&
      attempt.incumbentVersionId === state.baseVersion.id && attempt.candidate === null &&
      attempt.screen === null && attempt.confirmation === null && attempt.status === (i === 3 ? 'reserved' : 'invalid'),
    'original proposal prefix contains another disposition or later work');
    const prior = state.operations[i + 1], entry = dispatch.entries[i + 1];
    requireThat(prior.kind === 'proposal' && prior.attemptId === attempt.id && prior.maxCalls === 1 &&
      !prior.reconciliationOnly && entry.operation.id === prior.id && entry.operation.requestDigest === prior.requestDigest &&
      entry.admission !== null && entry.notAdmitted === null && !entry.proposalObservation,
    'original fourth proposal operation/dispatch set differs');
    if (i < 3) requireThat(prior.settled && prior.consumed && prior.actualCalls === 1 &&
      entry.settlement !== null && entry.resolution?.kind === 'settled' && entry.resolution.receiptId === prior.settlementReceiptId,
    'an earlier proposal is unconsumed or unsettled');
  }
  const baseline = state.operations[0], baseDispatch = dispatch.entries[0];
  requireThat(baseline.kind === 'baseline' && baseline.attemptId === null && baseline.settled && baseline.consumed &&
    baseline.evidenceComplete && baseline.actualCalls === 14 && baseline.maxCalls === 14 &&
    baseDispatch.operation.id === baseline.id && baseDispatch.baselineContinuation &&
    baseDispatch.resolution?.kind === 'settled' && baseDispatch.resolution.receiptId === baseline.settlementReceiptId,
  'original completed BASE and mandatory historical B continuation are required');
  const operation = state.operations[4], pending = dispatch.pending, entry = dispatch.entries[4];
  requireThat(!operation.settled && !operation.consumed && operation.observedFreshCalls === 0 && !operation.evidenceComplete &&
    pending?.operation.id === operation.id && entry.settlement === null && entry.resolution === null &&
    entry.selectionCount === 0 && entry.observations.length === 1 && entry.observations[0].kind === 'admission' &&
    entry.observations[0].serialized === entry.admission, 'original fourth must retain its sole admitted unconsumed intent');
  same(pending, entry, 'original fourth pending dispatch differs from its entry');
  const request = entry.request;
  requireThat(request.kind === 'proposal' && request.attemptId === operation.attemptId && request.requiredCalls === 1 &&
    request.experimentId === binding.experimentId && request.configDigest === binding.configDigest &&
    request.sourceCommit === binding.sourceCommit && request.runtimeDigest === digest(runtime) &&
    digest(request) === operation.requestDigest, 'original fourth request changed');
  same(archive.operation, operation, 'original fourth archive operation changed');
  same(archive.request, request, 'original fourth archive request changed');
  requireThat(packet.originalArchiveCount === 5 && archive.calls.length === 1 && archive.artifacts.length === 0,
    'original fourth requires one original failure and no substituted final/artifact');
  const held = archive.calls[0], { instructions, ...visible } = request.learner;
  same(held.call, { callId: 'call-' + digest({ operationId: operation.id, slot: { kind: 'proposal' } }),
    operationId: operation.id, leaseId: operation.leaseId, requestDigest: operation.requestDigest,
    sourceCommit: binding.sourceCommit, runtimeDigest: digest(runtime), model: runtime.model,
    instructions, message: canonical(visible) }, 'original fourth prompt/model/call changed');
  requireThat(held.stages.map(item => item.stage).join(',') === 'session,turn,failure',
    'later observation cannot replace an original final or a different failure prefix');
  const failure = held.stages[2].payload;
  requireThat(failure.code === 'TRUEFORGE_CALL_UNRESOLVED' && failure.stage === 'turn-read' &&
    failure.callId === held.call.callId && failure.operationId === operation.id &&
    failure.inputDigest === turnInputDigest(held.call) && failure.raw?.outcome === 'unresolved' &&
    typeof failure.sessionId === 'string' && typeof failure.turnId === 'string' &&
    held.stages[0].payload.sessionId === failure.sessionId && held.stages[1].payload.sessionId === failure.sessionId &&
    held.stages[1].payload.turnId === failure.turnId,
  'original fourth is not the retained unresolved original-turn read');
  const retained = { operationId: operation.id, attemptId: operation.attemptId, attemptNumber: 4,
    leaseId: operation.leaseId, requestDigest: operation.requestDigest, maxCalls: 1, additionalCalls: 0,
    controllerHead: packet.controllerHead, controllerCount: packet.controllerCount,
    dispatchHead: packet.dispatchHead, dispatchCount: packet.dispatchCount,
    originalArchiveHead: packet.originalArchiveHead, originalArchiveCount: packet.originalArchiveCount,
    originalArchiveDigest: digest(archive), hostPacketDigest: digest(packet), controllerStateDigest: digest(state),
    dispatchDigest: digest(dispatch), callId: held.call.callId, callDigest: digest(held.call),
    inputDigest: failure.inputDigest, sessionId: failure.sessionId, turnId: failure.turnId, failureDigest: digest(failure) };
  return { packet, retained: validateProposalObservationRetained(retained), operation, request, call: held.call, failure };
}

/** Settlement authenticates operation and lease. Owner/request/call are bound
 * indirectly through that original signed admission, frozen request and call. */
export function verifyOriginalProposalReceipts(packet, preparation, trust) {
  const state = packet.state, operation = state.operations[4], entry = packet.dispatch.entries[4];
  requireThat(preparation.admissionSerialized === entry.admission, 'D proof changed original admission bytes');
  const admission = JSON.parse(preparation.admissionSerialized), settlement = JSON.parse(preparation.settlementSerialized);
  record(admission, ['body', 'signature'], 'original proposal admission'); record(settlement, ['body', 'signature'], 'original proposal settlement');
  const lease = verifyEnvelope({ ...trust.budget, ...admission }), paid = verifyEnvelope({ ...trust.budget, ...settlement });
  const common = { experimentId: state.config.experimentId, configDigest: state.configDigest, sourceCommit: state.config.sourceCommit,
    budgetId: state.config.budgetId, gatewayId: trust.budget.gatewayId, provider: 'truefoundry', global: false, ceilingMicros: null };
  const expectedLease = { ...common, schema: 'gk-learning-v2-operation-lease', ...entry.operation,
    receiptId: operation.leaseId, model: state.config.model, managedGateDigest: state.gate.digest,
    namespaceExclusive: true, providerLimitEnforced: false, maxCalls: 1, reservationMicros: operation.reservationMicros };
  for (const [key, value] of Object.entries(expectedLease)) same(lease[key], value, 'original admission ' + key + ' differs');
  const expectedSettlement = { ...common, schema: 'gk-learning-v2-operation-settlement',
    operationId: operation.id, leaseId: operation.leaseId, status: 'settled', actualCalls: 1, actualMicros: null };
  record(paid, [...Object.keys(expectedSettlement), 'receiptId'], 'original one-call settlement body');
  for (const [key, value] of Object.entries(expectedSettlement)) same(paid[key], value, 'original settlement ' + key + ' differs');
  requireThat(!state.receipts.includes(paid.receiptId) && state.receipts.includes(lease.receiptId),
    'original settlement was already consumed or original admission absent');
  const issued = Date.parse(lease.issuedAt), expires = Date.parse(lease.expiresAt);
  requireThat(Number.isFinite(issued) && Number.isFinite(expires) && expires > issued && expires - issued <= 3600000,
    'original admission validity window differs');
  requireThat(originalProposalIsInvalid(preparation.observed.text, state.config.scope) &&
    preparation.observed.modelDigest === digest(packet.archive.calls[0].call.model),
  'later original output is not invalid under unchanged whole-text parser/model');
  return { admission, settlement, settlementBody: paid };
}

function invalidState(packet) {
  const state = copy(packet.state), attempt = state.attempts[3], operation = state.operations[4];
  let reason;
  try { procedure(null, state.config.scope); } catch (error) { reason = String(error.message); }
  requireThat(reason, 'unchanged invalid procedure classification unavailable');
  operation.consumed = true; attempt.status = 'invalid'; attempt.reason = reason;
  return state;
}

function settledState(packet, settlement) {
  const state = invalidState(packet), held = state.operations[4];
  held.settled = true; held.settlementReceiptId = settlement.receiptId;
  held.actualCalls = 1; held.actualMicros = null; state.receipts.push(settlement.receiptId);
  const balance = operationRunBalance(state.operations);
  state.budget = { spentMicros: balance.chargedMicros, reservedMicros: balance.reservedMicros,
    lastReceiptId: settlement.receiptId };
  return state;
}

function initialEvent(packet, status) {
  return { schema: SCHEMA, type: 'authorized-observation', packet: copy(packet),
    historicalImplementationSerialized: serialized(status.historicalImplementationStatus),
    qualificationSerialized: serialized(status.qualificationEnvelope), preparationSerialized: serialized(status.preparationEnvelope),
    authorizationSerialized: serialized(status.authorizationEnvelope) };
}

export function proposalObservationLink(event) {
  const qualification = JSON.parse(event.qualificationSerialized), preparation = JSON.parse(event.preparationSerialized),
    authorization = JSON.parse(event.authorizationSerialized);
  return { initialHead: digest({ schema: 'gk-learning-v2-journal-record-v1', sequence: 1, previousHead: null, event }),
    qualificationDigest: digest(qualification), preparationDigest: digest(preparation), authorizationDigest: digest(authorization),
    originalArchiveHead: preparation.body.retained.originalArchiveHead, implementationCommit: qualification.body.implementationCommit };
}

function guardedJournal(journal, expectedHead) {
  return { read: () => journal.read(), append: (head, event) => {
    requireThat(head === expectedHead, 'cross-journal observation cut changed before append');
    return journal.append(head, event);
  } };
}

/** Read/check every participating head and the complete allowed suffix. After
 * completion, later ordinary D history is allowed only beyond the authenticated
 * closed cut; the consume command itself refuses once attempt five exists. */
export async function readProposalObservation({ controllerJournal, dispatchJournal, originalJournal, observationJournal,
  binding, trust, runtime, implementationCommit, status, allowLater = true }) {
  const verified = verifyProposalObservationStatus(status, { binding, trust, implementationCommit, requireAuthorization: true });
  const [c, d, o, s] = await Promise.all([controllerJournal.read(), dispatchJournal.read(), originalJournal.read(), observationJournal.read()]);
  for (const snapshot of [c, d, o, s]) observationPrefixHead(snapshot);
  requireThat(s.events.length >= 1 && s.events.length <= 2, 'mandatory original-proposal observation sidecar absent or excessive');
  const opened = s.events[0];
  record(opened, ['schema', 'type', 'packet', 'historicalImplementationSerialized', 'qualificationSerialized',
    'preparationSerialized', 'authorizationSerialized'], 'original-proposal observation opener');
  requireThat(opened.schema === SCHEMA && opened.type === 'authorized-observation', 'observation opener schema');
  same(opened, initialEvent(opened.packet, verified), 'observation sidecar proof bytes or original packet changed');
  const checked = validateOriginalProposalPacket(opened.packet, { binding, runtime }), r = checked.retained;
  same(opened.packet.dispatch.entries[0].baselineContinuation, continuationLink(
    verified.historicalImplementationStatus.authorizationEnvelope, verified.historicalImplementationStatus.qualificationEnvelope),
  'D observation replaced historical B BASE linkage');
  same(r, verified.preparationEnvelope.body.retained, 'later observation substituted original checkpoint');
  const receipts = verifyOriginalProposalReceipts(opened.packet, verified.preparationEnvelope.body, trust);
  requireThat(observationPrefixHead(c, r.controllerCount) === r.controllerHead &&
    observationPrefixHead(d, r.dispatchCount) === r.dispatchHead && o.head === r.originalArchiveHead && o.events.length === 5,
  'original immutable journal prefix was replaced');
  same(c.events[r.controllerCount - 1].state, opened.packet.state, 'original controller snapshot changed');
  const originalDispatch = await new DispatchLedger({ journal: readOnly({ head: r.dispatchHead, events: d.events.slice(0, r.dispatchCount) }),
    experimentId: binding.experimentId, configDigest: binding.configDigest }).read();
  same(originalDispatch, opened.packet.dispatch, 'original dispatch prefix changed');
  same(await new OperationArchive({ journal: readOnly(o) }).read(), opened.packet.archive, 'original terminal failure archive changed');
  const link = proposalObservationLink(opened), settlement = verified.preparationEnvelope.body.settlementSerialized;
  const expectedDispatch = [
    { schema: DISPATCH, type: 'proposal-observation-linked', operationId: r.operationId, link },
    { schema: DISPATCH, type: 'observed', operationId: r.operationId, kind: 'settlement', serializedEnvelope: settlement },
    { schema: DISPATCH, type: 'completed', operationId: r.operationId,
      resolution: { kind: 'settled', receiptId: receipts.settlementBody.receiptId }, observationDigest: digest(settlement) },
  ];
  const expectedStates = [invalidState(opened.packet), settledState(opened.packet, receipts.settlementBody)];
  const cTail = c.events.slice(r.controllerCount), dTail = d.events.slice(r.dispatchCount);
  const complete = s.events.length === 2;
  requireThat(complete || cTail.length <= 2 && dTail.length <= 3, 'observation prefix contains unexpected later history');
  requireThat(!complete || cTail.length >= 2 && dTail.length >= 3, 'completed observation lacks its full cross-journal cut');
  for (let i = 0; i < Math.min(dTail.length, 3); i++) same(dTail[i], expectedDispatch[i], 'observation dispatch suffix differs');
  for (let i = 0; i < Math.min(cTail.length, 2); i++) {
    record(cTail[i], ['schema', 'reason', 'recordedAt', 'state'], 'observation controller suffix');
    requireThat(cTail[i].schema === 'gk-learning-v2-state' && cTail[i].reason === ['proposal-recorded', 'operation-settled'][i] &&
      Number.isFinite(Date.parse(cTail[i].recordedAt)) && Date.parse(cTail[i].recordedAt) >= Date.parse(verified.preparationEnvelope.body.preparedAt) &&
      (i === 0 || Date.parse(cTail[i].recordedAt) >= Date.parse(cTail[i - 1].recordedAt)),
    'observation controller transition/time differs');
    same(cTail[i].state, expectedStates[i], 'observation controller state differs from exact invalid consumption/settlement');
  }
  const prefix = `${Math.min(cTail.length, 2)}:${Math.min(dTail.length, 3)}`;
  requireThat(['0:0', '0:1', '0:2', '1:2', '2:2', '2:3'].includes(prefix), 'observation cross-journal order differs');
  if (complete) {
    same(s.events[1], { schema: SCHEMA, type: 'completed-observation', initialHead: link.initialHead,
      controllerHead: observationPrefixHead(c, r.controllerCount + 2), dispatchHead: observationPrefixHead(d, r.dispatchCount + 3),
      settlementReceiptId: receipts.settlementBody.receiptId, originalArchiveHead: r.originalArchiveHead },
    'observation completion cut differs');
    requireThat(prefix === '2:3', 'observation completion precedes genuine consumed state');
  }
  const currentState = await new LearningController({ journal: readOnly(c), trust }).state();
  const currentDispatch = await new DispatchLedger({ journal: readOnly(d), experimentId: binding.experimentId,
    configDigest: binding.configDigest }).read();
  if (!allowLater) requireThat(currentState.attempts.length === 4 && cTail.length <= 2 && dTail.length <= 3,
    'bounded consume refuses after any later proposal/history');
  if (complete) {
    same(currentState.attempts[3], expectedStates[1].attempts[3], 'later history replaced recovered fourth disposition');
    same(currentState.operations[4], expectedStates[1].operations[4], 'later history replaced original fourth accounting');
    same(currentDispatch.entries[4], (await new DispatchLedger({ journal: readOnly({
      head: observationPrefixHead(d, r.dispatchCount + 3), events: d.events.slice(0, r.dispatchCount + 3) }),
      experimentId: binding.experimentId, configDigest: binding.configDigest }).read()).entries[4],
    'later history replaced original fourth dispatch link');
  }
  // Fresh reads detect a racing mutation or incomplete publication; no cached
  // successful observation survives a changed original or suffix head.
  const after = await Promise.all([controllerJournal.read(), dispatchJournal.read(), originalJournal.read(), observationJournal.read()]);
  for (const [i, before] of [c, d, o, s].entries()) requireThat(after[i].head === before.head, 'observation journals changed during validation');
  return { complete, prefix, snapshots: { controller: c, dispatch: d, original: o, sidecar: s },
    packet: opened.packet, retained: r, link, status: verified, receipts, state: currentState, dispatch: currentDispatch };
}

/** One atomic opener avoids a separate claim/LINK artifact window. Its original
 * checkpoint and all proof strings are verified before this first new append. */
export async function initializeProposalObservation(options, packet) {
  const status = verifyProposalObservationStatus(options.status, { binding: options.binding, trust: options.trust,
    implementationCommit: options.implementationCommit, requireAuthorization: true });
  const checked = validateOriginalProposalPacket(packet, options);
  same(packet.dispatch.entries[0].baselineContinuation, continuationLink(status.historicalImplementationStatus.authorizationEnvelope,
    status.historicalImplementationStatus.qualificationEnvelope), 'D initialization replaced historical B BASE linkage');
  same(checked.retained, status.preparationEnvelope.body.retained, 'observation initialization changed prepared original cut');
  verifyOriginalProposalReceipts(packet, status.preparationEnvelope.body, options.trust);
  const saved = await options.observationJournal.read(); observationPrefixHead(saved);
  if (saved.events.length) return readProposalObservation({ ...options, allowLater: false });
  const [c, d, o] = await Promise.all([options.controllerJournal.read(), options.dispatchJournal.read(), options.originalJournal.read()]);
  for (const snapshot of [c, d, o]) observationPrefixHead(snapshot);
  requireThat(c.head === checked.retained.controllerHead && d.head === checked.retained.dispatchHead &&
    o.head === checked.retained.originalArchiveHead && c.events.length === checked.retained.controllerCount &&
    d.events.length === checked.retained.dispatchCount && o.events.length === 5,
  'observation initialization original journals changed');
  same(c.events.at(-1).state, packet.state, 'observation initialization controller changed');
  same(await new DispatchLedger({ journal: readOnly(d), experimentId: options.binding.experimentId,
    configDigest: options.binding.configDigest }).read(), packet.dispatch, 'observation initialization dispatch changed');
  same(await new OperationArchive({ journal: readOnly(o) }).read(), packet.archive, 'observation initialization original failure changed');
  await options.observationJournal.append(null, initialEvent(packet, status));
  return readProposalObservation({ ...options, allowLater: false });
}

/** Finish only missing deterministic local metadata/consumption transitions.
 * Any acknowledged-prefix crash is resumable after full revalidation. Ambiguous
 * journals, different proofs, a new call or a changed cut remain held. */
export async function consumeProposalObservation(options) {
  for (;;) {
    const checked = await readProposalObservation({ ...options, allowLater: false });
    if (checked.complete) return { recovered: true, attemptNumber: 4, disposition: 'invalid', additionalModelCalls: 0 };
    const { snapshots, retained: r } = checked;
    const ledger = new DispatchLedger({ journal: guardedJournal(options.dispatchJournal, snapshots.dispatch.head),
      experimentId: options.binding.experimentId, configDigest: options.binding.configDigest });
    const controller = new LearningController({ journal: guardedJournal(options.controllerJournal, snapshots.controller.head),
      trust: options.trust, clock: options.clock });
    if (checked.prefix === '0:0') await ledger.linkProposalObservation(r.operationId, checked.link, snapshots.dispatch.head);
    else if (checked.prefix === '0:1') await ledger.observe(r.operationId, 'settlement', checked.status.preparationEnvelope.body.settlementSerialized);
    else if (checked.prefix === '0:2') await controller.recordProposal(r.attemptId, null, null);
    else if (checked.prefix === '1:2') await controller.settleOperation(r.operationId, checked.receipts.settlement);
    else if (checked.prefix === '2:2') await ledger.complete(r.operationId,
      { kind: 'settled', receiptId: checked.receipts.settlementBody.receiptId }, digest(checked.status.preparationEnvelope.body.settlementSerialized));
    else if (checked.prefix === '2:3') await options.observationJournal.append(snapshots.sidecar.head,
      { schema: SCHEMA, type: 'completed-observation', initialHead: checked.link.initialHead,
        controllerHead: snapshots.controller.head, dispatchHead: snapshots.dispatch.head,
        settlementReceiptId: checked.receipts.settlementBody.receiptId, originalArchiveHead: r.originalArchiveHead });
    else requireThat(false, 'unknown original-proposal observation prefix');
  }
}
