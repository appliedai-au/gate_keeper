/** One additive continuation for the original BASE: one verified replay and
 * exactly thirteen original remaining slots. Ordinary OperationArchive finality
 * is unchanged. A new incomplete continuation is held, never re-executed. */
import { createHash } from 'node:crypto';
import { canonical, copy, digest, hash, record, requireThat } from './contracts.mjs';
import { OperationArchive } from './operation-archive.mjs';
import { renderReview, parseReview } from './legacy-renderer.mjs';
import { turnInputDigest } from './trueforge-turn.mjs';
import { verifyEvaluation } from './evidence.mjs';
import { verifyContinuationAuthorization, validateContinuationRetained } from './implementation-proof.mjs';

const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
const sha = value => createHash('sha256').update(value).digest('hex');
const LINK = 'baseline-continuation-link';
const STARTED = 'baseline-continuation-started';
const REPLAY = 'baseline-continuation-original-replay';
const capabilities = new WeakMap();

export function baselineSlots(request) {
  requireThat(request.kind === 'baseline' && request.attemptId === null && request.requiredCalls === 14 &&
    Array.isArray(request.plan?.cases) && request.plan.cases.length === 7,
  'bounded continuation requires the original seven-case two-pass BASE');
  return request.plan.cases.flatMap(item => [1, 2].map(pass => ({ pairId: request.plan.pairId,
    arm: 'base', caseId: item.caseId, pass })));
}

export function baselineCallId(operationId, slot) { return 'call-' + digest({ operationId, slot }); }

function expectedCall({ operation, request, runtime, caseInputs, originalBase }, slot, first = null) {
  const manifest = request.plan.cases.find(item => item.caseId === slot.caseId);
  const caseInput = caseInputs.find(item => item.caseId === slot.caseId);
  requireThat(manifest && caseInput, 'continuation frozen case missing');
  const rendered = renderReview({ artifact: request.prompts.base, originalBase, caseInput,
    scope: manifest.scope, pass: slot.pass,
    ...(slot.pass === 2 ? { firstFindings: parseReview(first.text, caseInput.prompt) } : {}) });
  return { callId: baselineCallId(operation.id, slot), operationId: operation.id, leaseId: operation.leaseId,
    requestDigest: operation.requestDigest, sourceCommit: request.sourceCommit, runtimeDigest: request.runtimeDigest,
    model: copy(runtime.model), instructions: rendered.instructions, message: rendered.message };
}

export function completeOriginalResult(entry) {
  requireThat(entry?.stages?.map(item => item.stage).join(',') === 'session,turn,final',
    'original BASE first call must have exactly one terminal final');
  const result = entry.stages[2].payload;
  requireThat(result.callId === entry.call.callId && result.inputDigest === turnInputDigest(entry.call) &&
    result.complete === true && result.finishReason === 'stop' &&
    Array.isArray(result.toolCalls) && result.toolCalls.length === 0 &&
    Array.isArray(result.requiredActions) && result.requiredActions.length === 0 &&
    typeof result.text === 'string' && result.text.trim().length > 0 && result.outputDigest === sha(result.text),
  'original BASE first result is not complete or differs from its input/output');
  for (const key of ['sessionId', 'turnId']) requireThat(typeof result[key] === 'string' && result[key].length > 0,
    'original BASE provider response identity absent');
  requireThat(entry.stages[0].payload.sessionId === result.sessionId &&
    entry.stages[1].payload.sessionId === result.sessionId && entry.stages[1].payload.turnId === result.turnId,
  'original BASE session/turn changed');
  return copy(result);
}

/** Build only from the actual host journals. The authority independently checks
 * its own operation/plan/provider evidence before signing eligibility. */
export function createOriginalBaselinePacket({ state, dispatch, controllerHead, dispatchHead,
  originalArchiveHead, archive, binding, runtime, caseInputs }) {
  requireThat(state.attempts.length === 0 && state.operations.length === 1 && !state.baseline &&
    !state.baselineError && !state.baselineNonAdmission && state.activationHistory.length === 0,
  'BASE continuation requires untouched learning/activation state');
  const operation = state.operations[0], pending = dispatch.pending;
  requireThat(operation.kind === 'baseline' && operation.attemptId === null && operation.maxCalls === 14 &&
    !operation.consumed && !operation.settled && operation.observedFreshCalls === 0 && !operation.evidenceComplete &&
    dispatch.entries.length === 1 && pending?.operation.id === operation.id && pending.admission !== null &&
    pending.settlement === null && pending.notAdmitted === null && pending.resolution === null &&
    !pending.baselineContinuation, 'original BASE operation is not the sole unconsumed pending lease');
  requireThat(binding.experimentId === state.config.experimentId && binding.sourceCommit === state.config.sourceCommit &&
    binding.configDigest === state.configDigest, 'BASE packet frozen binding');
  const packet = { schema: 'gk-learning-original-base-checkpoint-v1', binding: copy(binding),
    operation: copy(operation), request: copy(pending.request), controllerHead, dispatchHead,
    originalArchiveHead, archive: copy(archive) };
  validateOriginalBaselinePacket(packet, { runtime, caseInputs, originalBase: state.config.baseInstructions });
  return packet;
}

export function validateOriginalBaselinePacket(supplied, { runtime, caseInputs, originalBase }) {
  record(supplied, ['schema', 'binding', 'operation', 'request', 'controllerHead', 'dispatchHead',
    'originalArchiveHead', 'archive'], 'original BASE host checkpoint');
  const packet = copy(supplied), { operation, request, archive } = packet;
  requireThat(packet.schema === 'gk-learning-original-base-checkpoint-v1', 'original BASE packet schema');
  for (const key of ['controllerHead', 'dispatchHead', 'originalArchiveHead']) hash(packet[key], 'original BASE ' + key);
  requireThat(operation.kind === 'baseline' && operation.attemptId === null && operation.maxCalls === 14 &&
    operation.consumed === false && operation.settled === false && operation.observedFreshCalls === 0 &&
    operation.evidenceComplete === false && digest(request) === operation.requestDigest &&
    request.experimentId === packet.binding.experimentId && request.configDigest === packet.binding.configDigest &&
    request.sourceCommit === packet.binding.sourceCommit && request.runtimeDigest === digest(runtime),
  'original BASE host operation/request mismatch');
  same(archive.operation, operation, 'original BASE claimed operation changed');
  same(archive.request, request, 'original BASE archived request changed');
  requireThat(archive.calls.length === 2 && archive.artifacts.length === 0,
    'continuation requires exactly the original first final and second failure');
  const slots = baselineSlots(request), context = { operation, request, runtime, caseInputs, originalBase };
  const first = completeOriginalResult(archive.calls[0]);
  same(archive.calls[0].call, expectedCall(context, slots[0]), 'original BASE first prompt/model differs');
  same(archive.calls[1].call, expectedCall(context, slots[1], first), 'original BASE second prompt/model differs');
  const second = archive.calls[1];
  requireThat(second.stages.length === 1 && second.stages[0].stage === 'failure',
    'original second call has a session/turn intent or nonterminal host observation');
  const failure = second.stages[0].payload;
  requireThat(failure.stage === 'session-request' && failure.callId === second.call.callId &&
    failure.operationId === operation.id && failure.inputDigest === turnInputDigest(second.call) &&
    failure.sessionId === null && failure.turnId === null,
  'original second failure must precede any host session or turn response');
  const retained = { operationId: operation.id, leaseId: operation.leaseId, requestDigest: operation.requestDigest,
    maxCalls: 14, remainingCalls: 13, controllerHead: packet.controllerHead, dispatchHead: packet.dispatchHead,
    originalArchiveHead: packet.originalArchiveHead, originalArchiveDigest: digest(archive), hostPacketDigest: digest(packet),
    firstCallId: archive.calls[0].call.callId, firstResultDigest: digest(first), firstInputDigest: first.inputDigest,
    firstOutputDigest: first.outputDigest, sessionId: first.sessionId, turnId: first.turnId,
    secondCallId: second.call.callId, secondFailureDigest: digest(failure) };
  return { packet, retained: validateContinuationRetained(retained), first };
}

function checkedOriginal(original, head, retained) {
  requireThat(head === retained.originalArchiveHead && digest(original) === retained.originalArchiveDigest &&
    original.operation?.id === retained.operationId && original.operation.leaseId === retained.leaseId &&
    original.operation.requestDigest === retained.requestDigest && digest(original.request) === retained.requestDigest &&
    original.calls.length === 2 && original.artifacts.length === 0, 'immutable original BASE archive/head changed');
  const first = completeOriginalResult(original.calls[0]), second = original.calls[1];
  requireThat(digest(first) === retained.firstResultDigest && first.inputDigest === retained.firstInputDigest &&
    first.outputDigest === retained.firstOutputDigest && first.sessionId === retained.sessionId &&
    first.turnId === retained.turnId && original.calls[0].call.callId === retained.firstCallId &&
    second.call.callId === retained.secondCallId && second.stages.length === 1 && second.stages[0].stage === 'failure' &&
    digest(second.stages[0].payload) === retained.secondFailureDigest, 'immutable original BASE result/failure changed');
  return first;
}

export function continuationLink(authorizationEnvelope, qualificationEnvelope) {
  return { authorizationDigest: digest(authorizationEnvelope), qualificationDigest: digest(qualificationEnvelope),
    originalArchiveHead: authorizationEnvelope.body.retained.originalArchiveHead,
    implementationCommit: authorizationEnvelope.body.implementationCommit };
}

export async function initializeBaselineContinuation({ originalJournal, continuationJournal, authorizationEnvelope,
  qualificationEnvelope, binding, trust, implementationCommit }) {
  const authorization = verifyContinuationAuthorization(authorizationEnvelope,
    { binding, trust, implementationCommit, qualificationEnvelope });
  const originalArchive = new OperationArchive({ journal: originalJournal }), original = await originalArchive.read();
  checkedOriginal(original, (await originalJournal.read()).head, authorization.body.retained);
  const continuation = new OperationArchive({ journal: continuationJournal });
  const saved = await continuation.read();
  const expectedLink = { id: LINK, kind: 'base-continuation-authorization', payload: {
    qualificationSerialized: JSON.stringify(qualificationEnvelope), authorizationSerialized: JSON.stringify(authorization),
  } };
  // Only metadata-only initialization prefixes are resumable. A durable call
  // claim or any STARTED/replay/evaluation/unknown artifact remains held, even
  // if no provider response is present. Validate the entire prefix before any
  // append; an existing LINK must preserve its exact signed-envelope strings.
  requireThat(saved.calls.length === 0, 'BASE continuation initialization has a call intent; hold without retry');
  if (saved.operation === null) {
    requireThat(saved.request === null && saved.artifacts.length === 0,
      'BASE continuation empty initialization prefix differs');
  } else {
    same(saved.operation, original.operation, 'BASE continuation initialization changed original operation or lease');
    same(saved.request, original.request, 'BASE continuation initialization changed original request');
    requireThat(saved.artifacts.length <= 1, 'BASE continuation initialization already started or has extra artifacts');
    if (saved.artifacts.length === 1) same(saved.artifacts[0], expectedLink,
      'BASE continuation initialization LINK differs or execution already started');
  }
  // Finish only a missing claim/LINK. The host separately checks its original
  // controller head and CAS-links the dispatch journal before starting execution.
  if (saved.operation === null) await continuation.claimOperation(original.operation, original.request);
  if (saved.artifacts.length === 0) await continuation.recordArtifact(expectedLink.id, expectedLink.kind, expectedLink.payload);
  return continuationLink(authorization, qualificationEnvelope);
}

/** A mandatory linked read. No missing-sidecar fallback to the failed archive. */
export async function readBaselineContinuation({ originalJournal, continuationJournal, link, binding, trust,
  implementationCommit = link.implementationCommit, requireComplete = false }) {
  record(link, ['authorizationDigest', 'qualificationDigest', 'originalArchiveHead', 'implementationCommit'],
    'durable BASE continuation link');
  const original = await new OperationArchive({ journal: originalJournal }).read();
  const saved = await new OperationArchive({ journal: continuationJournal }).read();
  const artifact = saved.artifacts.find(item => item.id === LINK);
  requireThat(artifact?.kind === 'base-continuation-authorization', 'mandatory BASE continuation archive/link absent');
  record(artifact.payload, ['qualificationSerialized', 'authorizationSerialized'], 'BASE continuation signed link');
  const qualificationEnvelope = JSON.parse(artifact.payload.qualificationSerialized);
  const authorizationEnvelope = verifyContinuationAuthorization(JSON.parse(artifact.payload.authorizationSerialized),
    { binding, trust, implementationCommit, qualificationEnvelope });
  same(link, continuationLink(authorizationEnvelope, qualificationEnvelope), 'durable BASE continuation link changed');
  const first = checkedOriginal(original, (await originalJournal.read()).head, authorizationEnvelope.body.retained);
  same(saved.operation, original.operation, 'continuation replaced original operation or lease');
  same(saved.request, original.request, 'continuation replaced original request');
  const slots = baselineSlots(saved.request);
  requireThat(saved.calls.length <= 13, 'continuation added a fourteenth new call');
  for (const [index, entry] of saved.calls.entries()) {
    requireThat(entry.call.callId === baselineCallId(saved.operation.id, slots[index + 1]),
      'continuation dispatched outside original remaining slot order');
    same(entry.call.model, original.calls[0].call.model, 'continuation model parameters changed');
  }
  const started = saved.artifacts.find(item => item.id === STARTED);
  const replay = saved.artifacts.find(item => item.id === REPLAY);
  requireThat(!saved.calls.length || started && replay, 'continuation SDK calls lack durable start/replay reference');
  if (started) same(started.payload, link, 'continuation start differs from its authorization');
  if (replay) same(replay.payload, { callId: first.callId, resultDigest: digest(first),
    originalArchiveHead: link.originalArchiveHead, authorizationDigest: link.authorizationDigest },
  'continuation original replay reference changed');
  const receiptId = 'evaluation-' + digest({ pairId: saved.request.plan.pairId, arm: 'base' }) + '-receipt';
  const receipt = saved.artifacts.find(item => item.id === receiptId);
  let evaluation = null;
  if (receipt) {
    requireThat(receipt.kind === 'evaluation' && saved.calls.length === 13 && started && replay,
      'continuation evaluation lacks its thirteen new calls and replay reference');
    const results = [first, ...saved.calls.map(completeOriginalResult)];
    evaluation = JSON.parse(receipt.payload.serialized);
    const verified = verifyEvaluation(evaluation, trust.evaluation, { ...copy(saved.request.plan),
      operationId: saved.operation.id, requestDigest: saved.operation.requestDigest });
    for (const [index, result] of results.entries()) {
      const slot = slots[index], pass = verified.cases.find(item => item.caseId === slot.caseId)?.passes
        .find(item => item.pass === slot.pass);
      requireThat(pass && pass.reused === false && pass.originReceiptId === null &&
        ['callId', 'sessionId', 'turnId', 'inputDigest', 'outputDigest'].every(key => pass[key] === result[key]),
      'continued BASE receipt differs from fourteen original logical fresh calls');
    }
  }
  requireThat(!requireComplete || evaluation !== null, 'BASE continuation lacks complete independent evaluation');
  return { original, saved, first, link: copy(link), qualificationEnvelope, authorizationEnvelope, evaluation,
    started: Boolean(started), archive: { operation: saved.operation, request: saved.request,
      calls: [original.calls[0], ...saved.calls], artifacts: saved.artifacts } };
}

/** Mint only after a signed link is durable in dispatch. Neither the executor nor
 * an arbitrary options object can construct this one-use internal capability. */
export async function startBaselineContinuation(options) {
  const verified = await readBaselineContinuation(options);
  requireThat(!verified.started && verified.saved.calls.length === 0 && verified.saved.artifacts.length === 1,
    'BASE continuation already started; incomplete continuations stay held');
  const archive = new OperationArchive({ journal: options.continuationJournal });
  await archive.recordArtifact(STARTED, 'base-continuation-start', verified.link);
  const capability = Object.freeze({});
  capabilities.set(capability, { verified, archive, replayed: false, claimed: false });
  return capability;
}

export function baselineContinuationArchive(capability) {
  const held = capabilities.get(capability);
  requireThat(held, 'unverified BASE continuation capability');
  return Object.freeze({
    async claimOperation(operation, request) {
      requireThat(!held.claimed, 'BASE continuation executor already claimed');
      same(operation, held.verified.original.operation, 'continuation executor changed original lease');
      same(request, held.verified.original.request, 'continuation executor changed original plan');
      held.claimed = true;
    },
    async claimCall(call) {
      requireThat(held.claimed && held.replayed, 'continuation must replay only the verified first result before any SDK mutation');
      const saved = await held.archive.read(), slots = baselineSlots(saved.request);
      requireThat(saved.calls.length < 13 && call.callId === baselineCallId(saved.operation.id, slots[saved.calls.length + 1]),
        'continuation SDK call is not the exact next original remaining slot');
      return held.archive.claimCall(call);
    },
    recordCall: (...args) => held.archive.recordCall(...args),
    recordArtifact: (...args) => held.archive.recordArtifact(...args),
    read: () => held.archive.read(),
  });
}

/** Return the first result directly: runTrueForgeTurn is never entered for it. */
export async function replayOriginalBaselineResult(capability, call) {
  const held = capabilities.get(capability);
  requireThat(held && held.claimed, 'unverified or unclaimed BASE replay capability');
  if (call.callId !== held.verified.first.callId) {
    requireThat(held.replayed, 'continuation skipped the original first result');
    return null;
  }
  requireThat(!held.replayed, 'original BASE result replayed twice');
  same(call, held.verified.original.calls[0].call, 'original BASE replay prompt/model changed');
  await held.archive.recordArtifact(REPLAY, 'base-continuation-original-result', {
    callId: call.callId, resultDigest: digest(held.verified.first),
    originalArchiveHead: held.verified.link.originalArchiveHead,
    authorizationDigest: held.verified.link.authorizationDigest });
  held.replayed = true;
  return copy(held.verified.first);
}
