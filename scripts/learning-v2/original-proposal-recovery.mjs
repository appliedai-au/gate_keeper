/**
 * Read-only preparation for a proposal interrupted AFTER its owned root turn.
 *
 * This is NOT a retry, settlement, novelty receipt or learning command. A
 * trusted operator supplies the pinned original checkpoint and authority-owned
 * dispatch entry. Only authenticated SDK reads are used. The original failed
 * archive remains immutable; a separate CAS journal may retain the observation.
 * Source qualification and explicit host/authority consumption are separate
 * boundaries: this module cannot manufacture either one.
 */
import { canonical, copy, digest, hash, identifier, procedure, procedureFingerprint,
  record, requireThat } from './contracts.mjs';
import { assertInlineSession, inspectProviderCall, textSha256 } from './authority-provider.mjs';
import { TURN_CONFIG, turnInputDigest } from './trueforge-turn.mjs';

const SCHEMA = 'gk-original-proposal-recovery-preparation-v1';
const EVENT = 'gk-original-proposal-recovery-retained-v1';
const READS = ['get', 'getTurn', 'listTurns', 'listTurnEvents'];
const READ_FAILURES = new Set(['turn-read', 'events-read', 'poll-wait']);
const MAX_BYTES = 31 * 1024 * 1024;
const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
const bounded = value => {
  const serialized = canonical(value);
  requireThat(Buffer.byteLength(serialized) <= MAX_BYTES, 'proposal recovery evidence size');
  return JSON.parse(serialized);
};

function expectedInput(supplied) {
  record(supplied, ['binding', 'checkpointDigest', 'runtime', 'history', 'historyDigest', 'ownedEntry'],
    'proposal recovery expected context');
  const expected = bounded(supplied);
  record(expected.binding, ['ownerId', 'experimentId', 'sourceCommit', 'configDigest'], 'recovery binding');
  identifier(expected.binding.ownerId, 'recovery owner');
  identifier(expected.binding.experimentId, 'recovery experiment');
  hash(expected.binding.sourceCommit, 'recovery frozen source', 40);
  hash(expected.binding.configDigest, 'recovery configuration');
  hash(expected.checkpointDigest, 'recovery original checkpoint');
  hash(expected.historyDigest, 'recovery history');
  requireThat(Array.isArray(expected.history) && digest(expected.history) === expected.historyDigest,
    'recovery prior history differs');
  const ids = new Set();
  for (const reference of expected.history) {
    identifier(reference.id, 'recovery prior reference');
    requireThat(!ids.has(reference.id), 'recovery duplicate prior reference');
    ids.add(reference.id);
  }
  const entry = expected.ownedEntry;
  record(entry, ['callId', 'sessionId', 'turnId', 'inputDigest', 'createdBySubject',
    'sessionRequest', 'turnRequest'], 'authority-owned original call');
  identifier(entry.callId, 'recovery call');
  hash(entry.inputDigest, 'recovery original input');
  for (const key of ['sessionId', 'turnId']) requireThat(typeof entry[key] === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/u.test(entry[key]), 'recovery owned response identifier');
  return expected;
}

function originalCheckpoint(supplied, expected) {
  record(supplied, ['controllerHead', 'dispatchHead', 'archiveHead', 'archive'], 'original proposal checkpoint');
  const checkpoint = bounded(supplied);
  requireThat(digest(checkpoint) === expected.checkpointDigest, 'original proposal checkpoint changed');
  for (const key of ['controllerHead', 'dispatchHead', 'archiveHead']) hash(checkpoint[key], 'original journal head');
  const archived = checkpoint.archive;
  record(archived, ['operation', 'request', 'calls', 'artifacts'], 'original proposal archive');
  const op = archived.operation, request = archived.request;
  requireThat(op?.kind === 'proposal' && op.maxCalls === 1 && op.consumed === false && op.settled === false &&
    op.observedFreshCalls === 0 && op.evidenceComplete === false, 'only an unconsumed original proposal can prepare');
  identifier(op.id, 'original operation'); identifier(op.leaseId, 'original lease');
  identifier(op.attemptId, 'original attempt');
  requireThat(request?.schema === 'gk-learning-v2-execution-request' && request.kind === 'proposal' &&
    request.requiredCalls === 1 && request.attemptId === op.attemptId && request.namespace === op.namespace &&
    digest(request) === op.requestDigest && request.experimentId === expected.binding.experimentId &&
    request.sourceCommit === expected.binding.sourceCommit && request.configDigest === expected.binding.configDigest &&
    request.runtimeDigest === digest(expected.runtime) && request.model === expected.runtime.model?.name &&
    request.provider === 'truefoundry' && request.memory === 'off', 'original proposal request binding differs');
  const learner = request.learner;
  record(learner, ['instructions', 'scope', 'baselineInstructions', 'confirmedProcedures',
    'retainedProcedures', 'fitExamples'], 'original proposal learner');
  identifier(learner.scope, 'original proposal scope');
  const { instructions, ...visible } = learner;
  const call = { callId: `call-${digest({ operationId: op.id, slot: { kind: 'proposal' } })}`,
    operationId: op.id, leaseId: op.leaseId, requestDigest: op.requestDigest,
    sourceCommit: request.sourceCommit, runtimeDigest: request.runtimeDigest,
    model: expected.runtime.model, instructions, message: canonical(visible) };
  requireThat(Array.isArray(archived.calls) && archived.calls.length === 1 &&
    Array.isArray(archived.artifacts) && archived.artifacts.length === 0,
    'recovery requires one original call without a final disposition');
  same(archived.calls[0].call, call, 'original proposal call differs from frozen request');
  const stages = archived.calls[0].stages;
  requireThat(Array.isArray(stages) && stages.map(item => item.stage).join(',') === 'session,turn,failure',
    'recovery requires exactly the preserved session, turn and read failure');
  const [session, turn, failure] = stages.map(item => item.payload);
  const entry = expected.ownedEntry, inputDigest = turnInputDigest(call);
  requireThat(entry.callId === call.callId && entry.inputDigest === inputDigest,
    'authority-owned call differs from original host call');
  const sessionRequest = { agent: { spec: { model: call.model, instructions,
    config: copy(TURN_CONFIG) } }, metadata: { purpose: 'gk-learning-v2', callId: call.callId,
    operationId: call.operationId, requestDigest: call.requestDigest } };
  const turnRequest = { input: [{ type: 'user.message', content: call.message }], previousTurnId: 'none' };
  same(entry.sessionRequest, sessionRequest, 'authority original session input differs');
  same(entry.turnRequest, turnRequest, 'authority original turn input differs');
  same(session.request, sessionRequest, 'archived session request differs');
  same(turn.request, turnRequest, 'archived turn request differs');
  assertInlineSession(session.response, entry);
  requireThat(session.inputDigest === inputDigest && session.sessionId === entry.sessionId &&
    turn.inputDigest === inputDigest && turn.sessionId === entry.sessionId && turn.turnId === entry.turnId &&
    turn.response?.id === entry.turnId && turn.response.sessionId === entry.sessionId &&
    turn.response.previousTurnId === null, 'original response identity differs');
  requireThat(failure?.code === 'TRUEFORGE_CALL_UNRESOLVED' && READ_FAILURES.has(failure.stage) &&
    failure.callId === call.callId && failure.operationId === op.id && failure.inputDigest === inputDigest &&
    failure.sessionId === entry.sessionId && failure.turnId === entry.turnId,
    'only an original read interruption is eligible; ambiguous writes remain held');
  for (const reference of expected.history) procedure(reference.procedure, learner.scope);
  return { checkpoint, call, scope: learner.scope, entry };
}

function disposition(result, history, scope) {
  let candidate;
  try {
    let output = result.text.trim();
    const fence = output.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
    if (fence) output = fence[1];
    candidate = procedure(JSON.parse(output), scope);
  } catch {
    return { kind: 'invalid', candidate: null, candidateDigest: null, duplicateIds: [] };
  }
  const candidateDigest = procedureFingerprint(candidate);
  const duplicateIds = history.filter(item => procedureFingerprint(item.procedure) === candidateDigest)
    .map(item => item.id);
  return { kind: duplicateIds.length ? 'exact-duplicate' : 'independent-review-required',
    candidate, candidateDigest, duplicateIds };
}

/** readOriginal and expected are trusted operator capabilities, not browser
 * input. No received observation is an authorization to consume or settle it. */
export async function prepareOriginalProposalRecovery({ readOriginal, provider, expected: supplied }) {
  const expected = expectedInput(supplied); // Freeze before the first await.
  requireThat(typeof readOriginal === 'function', 'original checkpoint reader required');
  const sessions = provider?.sessions;
  requireThat(READS.every(name => typeof sessions?.[name] === 'function'), 'original provider readers required');
  // The verifier receives no create/createTurn/update/delete capability.
  const readonly = { sessions: Object.fromEntries(READS.map(name => [name, sessions[name].bind(sessions)])) };
  const { checkpoint, call, scope, entry } = originalCheckpoint(await readOriginal(), expected);
  const observed = await inspectProviderCall(readonly, entry, { requireComplete: true });
  requireThat(observed.callId === call.callId && observed.inputDigest === entry.inputDigest &&
    observed.sessionId === entry.sessionId && observed.turnId === entry.turnId &&
    observed.outputDigest === textSha256(observed.text) && observed.observedModelCalls === 1,
    'verified original output binding differs');
  originalCheckpoint(await readOriginal(), expected);
  const result = bounded({ schema: SCHEMA, binding: expected.binding,
    expectedDigest: digest(expected), checkpointDigest: expected.checkpointDigest,
    controllerHead: checkpoint.controllerHead, dispatchHead: checkpoint.dispatchHead, archiveHead: checkpoint.archiveHead,
    operationId: call.operationId, leaseId: call.leaseId, requestDigest: call.requestDigest,
    classification: disposition(observed, expected.history, scope), observed,
    providerMutations: 0, originalJournalWrites: 0, actualMicros: null,
    status: 'prepared-not-consumed', authorityReceipt: false });
  return { preparation: result, preparationDigest: digest(result) };
}

/** A separate private FileJournal/MemoryJournal only. A caller must NOT pass an
 * original controller, dispatch or operation journal here. One CAS append;
 * ambiguous acknowledgement is inspected on explicit reentry, never retried. */
export async function retainOriginalProposalPreparation({ journal, prepared: supplied, expectedDigest }) {
  record(supplied, ['preparation', 'preparationDigest'], 'prepared original proposal');
  const prepared = bounded(supplied);
  hash(expectedDigest, 'explicit preparation pin');
  requireThat(prepared.preparation.schema === SCHEMA && prepared.preparation.status === 'prepared-not-consumed' &&
    prepared.preparation.authorityReceipt === false && prepared.preparation.providerMutations === 0 &&
    prepared.preparation.originalJournalWrites === 0 && prepared.preparation.actualMicros === null &&
    digest(prepared.preparation) === prepared.preparationDigest && prepared.preparationDigest === expectedDigest,
    'prepared observation identity differs');
  requireThat(typeof journal?.read === 'function' && typeof journal?.append === 'function',
    'separate recovery CAS journal required');
  const event = { schema: EVENT, prepared };
  const prior = await journal.read();
  record(prior, ['head', 'events'], 'recovery journal snapshot');
  requireThat(Array.isArray(prior.events), 'recovery journal events');
  if (prior.events.length) {
    hash(prior.head, 'recovery retained head');
    requireThat(prior.events.length === 1, 'unexpected recovery journal history');
    same(prior.events[0], event, 'retained original proposal cannot be replaced');
    return { status: 'retained', preparationDigest: expectedDigest, appended: false };
  }
  requireThat(prior.head === null, 'empty recovery journal head differs');
  await journal.append(null, event);
  const saved = await journal.read();
  requireThat(saved.events?.length === 1, 'recovery publication readback incomplete');
  same(saved.events[0], event, 'recovery publication readback differs');
  hash(saved.head, 'recovery published head');
  return { status: 'retained', preparationDigest: expectedDigest, appended: true };
}
