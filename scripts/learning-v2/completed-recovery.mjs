/** Reusable READ-ONLY validation and non-disclosing projection of the existing
 * qualified original-fourth recovery proof (historical B, recovery E).
 *
 * Nothing here signs, initializes, appends, calls a provider/SDK, constructs a
 * live authority or logs. The existing validators remain the only authority:
 * `verifyProposalObservationStatus`, `validateOriginalProposalPacket` and
 * `verifyOriginalProposalReceipts`. An unsigned summary cannot assert that the
 * omitted private preparation was verified; `verifyCompletedRecoverySummary`
 * recomputes the summary from an independently verified private status. */
import { canonical, copy, digest, hash, record, requireThat } from './contracts.mjs';
import { AuthorityLedger } from './authority-ledger.mjs';
import { continuationLink } from './baseline-continuation.mjs';
import { observationPrefixHead, validateOriginalProposalPacket, verifyOriginalProposalReceipts }
  from './proposal-observation.mjs';
import { PROPOSAL_OBSERVATION_STATUS, verifyProposalObservationStatus } from './proposal-observation-proof.mjs';

export const COMPLETED_RECOVERY_SUMMARY = 'gk-learning-completed-recovery-summary-v1';
export const COMPLETED_RECOVERY_PROOF = 'gk-learning-completed-recovery-proof-v1';
const OBSERVATION_STATE = 'gk-learning-proposal-observation-authority-v1';
const OBSERVATION_KEYS = ['schema', 'binding', 'qualificationEvidence', 'qualification', 'preparation', 'checkpoint',
  'authorization', 'ownerEvidence'];
const SUMMARY_KEYS = ['schema', 'historicalImplementationCommit', 'recoveryImplementationCommit',
  'qualificationEnvelope', 'authorizationEnvelope', 'preparationDigest', 'retainedDigest', 'settlementDigest'];
const same = (a, b, why) => requireThat(canonical(a) === canonical(b), why);
// Signed envelopes are re-serialized, never canonicalized: key order is part of
// the bytes that were signed and later pinned by digest.
const original = value => { canonical(value); return JSON.parse(JSON.stringify(value)); };
const readOnly = (journal, name) => {
  requireThat(journal && typeof journal.read === 'function', name + ' journal unavailable');
  return Object.freeze({ read: () => journal.read(),
    append: async () => { throw new Error('LEARNING_V2_REJECTED: read-only completed recovery journal'); } });
};

/** Pure projection. The private status is verified with the real validators
 * (owner authorization and remainder both required) before anything is copied. */
export function projectCompletedRecovery(status, { binding, trust, implementationCommit }) {
  const verified = verifyProposalObservationStatus(status, { binding, trust, implementationCommit,
    requireAuthorization: true, requireRemainder: true });
  requireThat(verified.schema === PROPOSAL_OBSERVATION_STATUS && verified.preparationEnvelope !== null &&
    verified.authorizationEnvelope !== null, 'completed recovery requires qualification, preparation and authorization');
  const historical = verified.historicalImplementationStatus, prepared = verified.preparationEnvelope;
  return {
    schema: COMPLETED_RECOVERY_SUMMARY,
    historicalImplementationCommit: historical.qualificationEnvelope.body.implementationCommit,
    recoveryImplementationCommit: verified.qualificationEnvelope.body.implementationCommit,
    qualificationEnvelope: original(verified.qualificationEnvelope),
    authorizationEnvelope: original(verified.authorizationEnvelope),
    preparationDigest: digest(prepared),
    retainedDigest: digest(prepared.body.retained),
    settlementDigest: digest(prepared.body.settlementSerialized),
  };
}

/** Compare a presented summary with a fresh projection of the independently
 * verified private status. Only equality with that projection is accepted. */
export function verifyCompletedRecoverySummary(summary, status, options) {
  record(summary, SUMMARY_KEYS, 'completed recovery summary');
  requireThat(summary.schema === COMPLETED_RECOVERY_SUMMARY, 'completed recovery summary schema');
  for (const key of ['preparationDigest', 'retainedDigest', 'settlementDigest']) hash(summary[key], 'summary ' + key);
  const expected = projectCompletedRecovery(status, options);
  requireThat(JSON.stringify(summary) === JSON.stringify(expected), 'completed recovery summary differs from verified private proof');
  return original(expected);
}

function journalFacts(snapshot, name) {
  record(snapshot, ['head', 'events'], name + ' journal snapshot');
  requireThat(Array.isArray(snapshot.events) && snapshot.events.length > 0, name + ' journal empty');
  observationPrefixHead(snapshot); // recompute the entire hash chain
  return { head: snapshot.head, count: snapshot.events.length };
}

/** Read-only authority custody check. `bundle` is the existing frozen
 * production bundle; `originalJournal` the original B authority journal;
 * `proofJournal` the separate observation proof journal. */
export async function readCompletedRecoveryAuthority({ bundle, originalJournal, proofJournal, implementationCommit, clock = () => 0 }) {
  requireThat(bundle?.binding && bundle.trust && bundle.runtime, 'frozen bundle unavailable');
  const original0 = readOnly(originalJournal, 'original authority'), proof0 = readOnly(proofJournal, 'observation proof');
  requireThat(originalJournal !== proofJournal, 'observation proof namespace must differ from original authority');
  const originalSnapshot = await original0.read(), proofSnapshot = await proof0.read();
  const originalFacts = journalFacts(originalSnapshot, 'original authority'), proofFacts = journalFacts(proofSnapshot, 'observation proof');

  // initial:null — read() only; initialize()/change() are never called.
  const ledger = (journal, snapshot) => new AuthorityLedger({ binding: bundle.binding, initial: null, clock,
    journal: { read: async () => copy(snapshot), append: journal.append } });
  const observation = await ledger(proof0, proofSnapshot).read();
  record(observation, OBSERVATION_KEYS, 'observation proof state');
  requireThat(observation.schema === OBSERVATION_STATE, 'observation proof state schema');
  same(observation.binding, bundle.binding, 'observation proof changed frozen binding');
  for (const key of ['qualification', 'preparation', 'authorization'])
    requireThat(typeof observation[key] === 'string' && observation[key].length > 0, 'observation proof lacks ' + key);
  requireThat(observation.checkpoint && typeof observation.checkpoint === 'object' && observation.ownerEvidence,
    'observation proof lacks checkpoint or owner evidence');
  const current = await ledger(original0, originalSnapshot).read();
  requireThat(current.implementation && typeof current.implementation.qualification === 'string' &&
    typeof current.implementation.authorization === 'string', 'original authority lacks historical B envelopes');

  const status = { schema: PROPOSAL_OBSERVATION_STATUS,
    historicalImplementationStatus: { qualificationEnvelope: JSON.parse(current.implementation.qualification),
      authorizationEnvelope: JSON.parse(current.implementation.authorization) },
    qualificationEnvelope: JSON.parse(observation.qualification), preparationEnvelope: JSON.parse(observation.preparation),
    authorizationEnvelope: JSON.parse(observation.authorization) };
  const options = { binding: bundle.binding, trust: bundle.trust, implementationCommit };
  const summary = projectCompletedRecovery(status, options); // runs the real verifier
  const verified = verifyProposalObservationStatus(status, { ...options, requireAuthorization: true, requireRemainder: true });
  const prepared = verified.preparationEnvelope.body, retained = prepared.retained;

  // Saved checkpoint: real packet + receipt validators, exact digests.
  const checked = validateOriginalProposalPacket(observation.checkpoint, { binding: bundle.binding, runtime: bundle.runtime });
  same(checked.retained, retained, 'saved checkpoint differs from prepared retained cut');
  requireThat(digest(observation.checkpoint) === retained.hostPacketDigest, 'saved checkpoint digest differs from prepared host packet');
  same(checked.packet.dispatch.entries[0].baselineContinuation, continuationLink(
    verified.historicalImplementationStatus.authorizationEnvelope, verified.historicalImplementationStatus.qualificationEnvelope),
  'saved checkpoint replaced historical B BASE linkage');
  verifyOriginalProposalReceipts(checked.packet, prepared, bundle.trust);
  requireThat(digest(observation.checkpoint.dispatch) === retained.dispatchDigest &&
    digest(observation.checkpoint.state) === retained.controllerStateDigest &&
    digest(observation.checkpoint.archive) === retained.originalArchiveDigest, 'saved checkpoint component digests differ');
  // Qualification evidence identity must be the signed one, not a restated one.
  const signedQualification = verified.qualificationEnvelope.body;
  for (const [stateKey, bodyKey] of [['implementationCommit', 'implementationCommit'], ['implementationTree', 'implementationTree'],
    ['qualification', 'qualification'], ['runId', 'runId'], ['rawLogsDigest', 'rawLogsDigest'],
    ['qualificationEvidenceDigest', 'qualificationEvidenceDigest']])
    same(observation.qualificationEvidence?.[stateKey], signedQualification[bodyKey], 'qualificationEvidence ' + stateKey + ' differs from signed qualification');

  // Original fourth operation/call/lease/request/settlement at the current head.
  const op = current.operations.find(item => item.id === retained.operationId);
  requireThat(op && op.id === checked.operation.id && op.leaseId === retained.leaseId && op.requestDigest === retained.requestDigest &&
    op.lease === prepared.admissionSerialized && op.settlement === prepared.settlementSerialized &&
    digest(op) === prepared.authorityOperationDigest, 'original authority fourth operation changed after preparation');
  requireThat(op.calls.length === 1 && op.calls[0].callId === retained.callId && op.calls[0].sessionId === retained.sessionId &&
    op.calls[0].turnId === retained.turnId && op.calls[0].evidenceDigest === prepared.authorityEvidenceDigest,
  'original authority fourth call changed after preparation');
  requireThat(current.operations.filter(item => item.kind === 'proposal' && item.attemptId === retained.attemptId).length === 1,
    'replacement fourth operation present');
  const attempt = current.attempts.find(item => item.id === retained.attemptId);
  requireThat(attempt && attempt.number === 4 && attempt.status === 'invalid' && attempt.candidate === null,
    'original invalid attempt four changed');
  same(attempt, checked.packet.state.attempts[3] && { ...checked.packet.state.attempts[3], status: 'invalid', reason: attempt.reason },
    'original attempt four differs from prepared facts');

  // Prepared authorityHead is a genuine prefix of the CURRENT original journal.
  const index = originalSnapshot.events.findIndex((_, i) => observationPrefixHead(originalSnapshot, i + 1) === prepared.authorityHead);
  requireThat(index >= 0, 'prepared authority head is not a prefix of the current original authority journal');
  const prefixSnapshot = { head: prepared.authorityHead, events: originalSnapshot.events.slice(0, index + 1) };
  const prefixState = await ledger(original0, prefixSnapshot).read(); // real AuthorityLedger over the prefix
  requireThat(digest(prefixState) === prepared.authorityStateDigest, 'prepared authority state digest differs at prefix');
  const prefixOp = prefixState.operations.find(item => item.id === retained.operationId);
  requireThat(prefixOp && digest(prefixOp) === prepared.authorityOperationDigest, 'prepared authority operation digest differs at prefix');
  for (const key of ['qualification', 'authorization']) {
    requireThat(prefixState.implementation?.[key] === current.implementation[key], 'original B ' + key + ' bytes differ at prefix');
    requireThat(current.implementation[key] === JSON.stringify(status.historicalImplementationStatus[key + 'Envelope']),
      'original B ' + key + ' bytes differ from status');
  }
  same(prefixOp, op, 'original fourth operation differs between prefix and current authority');

  // Reread: a changing journal fails closed.
  const [originalAgain, proofAgain] = await Promise.all([original0.read(), proof0.read()]);
  const againOriginal = journalFacts(originalAgain, 'original authority'), againProof = journalFacts(proofAgain, 'observation proof');
  requireThat(againOriginal.head === originalFacts.head && againOriginal.count === originalFacts.count &&
    againProof.head === proofFacts.head && againProof.count === proofFacts.count, 'journals changed during completed recovery read');

  return { schema: COMPLETED_RECOVERY_PROOF, summary,
    observation: { head: proofFacts.head, count: proofFacts.count, stateDigest: digest(observation) },
    original: { head: originalFacts.head, count: originalFacts.count,
      preparedPrefix: { head: prepared.authorityHead, count: index + 1, stateDigest: prepared.authorityStateDigest,
        operationDigest: prepared.authorityOperationDigest } } };
}
