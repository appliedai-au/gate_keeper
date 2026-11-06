/** Qualified C control-plane archive reader. No authority constructor, signer,
 * private-key loader, provider client, listener, bootstrap or append call.
 * Referenced private intent/evidence artifacts are read to verify retained
 * facts; only the explicit projection below leaves this process. */
import { join } from 'node:path';
import { lstatSync, readdirSync } from 'node:fs';
import { verifyEnvelope } from '../learning-trust.mjs';
import { canonical, copy, digest, hash, identifier, integer, record, requireThat } from './contracts.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';
import { FileJournal } from './journal.mjs';
import { AuthorityLedger } from './authority-ledger.mjs';
import { verifyImplementationStatus, verifyPreparedContinuation } from './implementation-proof.mjs';
import { createCompletedSourceVerifier } from './completed-history-proof.mjs';
import { bytesSha, exactDirectory, inventoryTree, isoTime, privateDirectory, readArchiveJson, same } from './completed-history-files.mjs';

export const COMPLETED_AUTHORITY_ROOT = '/data/gk-v4-authority';
const TERMINAL = ['confirmed', 'rejected', 'duplicate', 'invalid', 'noCoverage', 'unresolved'];
const OP_KEYS = ['id', 'kind', 'attemptId', 'namespace', 'requestDigest'];
const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];
const identity = binding => ({ experimentId: binding.experimentId, configDigest: binding.configDigest,
  sourceCommit: binding.sourceCommit });
const nonempty = (value, maximum, label) => requireThat(Array.isArray(value) && value.length > 0 &&
  value.length <= maximum, label);

export function originalReceipt(serialized, trust, role, schema, expected = {}) {
  requireThat(typeof serialized === 'string' && Buffer.byteLength(serialized) > 0 &&
    Buffer.byteLength(serialized) <= 4 * 1024 * 1024, 'original receipt byte bound');
  const envelope = JSON.parse(serialized);
  record(envelope, ['body', 'signature'], 'original signed envelope'); canonical(envelope);
  const body = verifyEnvelope({ ...trust[role], ...envelope });
  requireThat(body.schema === schema, 'original receipt schema'); identifier(body.receiptId, 'original receipt ID');
  for (const [key, value] of Object.entries(expected)) same(body[key], value, 'original receipt ' + key);
  return { envelope, body };
}

export function historicalImplementation(capsule, { binding, trust }) {
  record(capsule.implementation, ['qualification', 'preparation', 'authorization'], 'historical implementation');
  const qualificationEnvelope = JSON.parse(capsule.implementation.qualification);
  const authorizationEnvelope = JSON.parse(capsule.implementation.authorization);
  const status = verifyImplementationStatus({ qualificationEnvelope, authorizationEnvelope }, {
    binding, trust, implementationCommit: capsule.executionSourceCommit, requireAuthorization: true,
  });
  const preparation = verifyPreparedContinuation(JSON.parse(capsule.implementation.preparation), {
    binding, trust, implementationCommit: capsule.executionSourceCommit,
    qualificationEnvelope: status.qualificationEnvelope, retained: status.authorizationEnvelope.body.retained,
  });
  requireThat(digest(preparation) === status.authorizationEnvelope.body.preparedProofDigest,
    'historical authorization substituted preparation');
  return { ...status, preparation };
}

/** A capsule is not a signature. Authenticate its original role envelopes and
 * exact bindings here; host closure independently checks all operations and
 * call results. The external owner pin later authenticates these capsule bytes. */
export function verifyAuthorityCapsule(supplied, { binding, trust, config, history }) {
  record(supplied, ['schema', 'binding', 'executionSourceCommit', 'frozen', 'provenance', 'gate',
    'implementation', 'attempts', 'operations', 'reviews', 'activations', 'baselineDigest',
    'activeVersionId', 'versionsDigest'], 'completed authority capsule');
  const capsule = copy(supplied);
  requireThat(capsule.schema === 'gk-completed-authority-capsule-v1', 'completed authority schema');
  same(capsule.binding, binding, 'completed authority frozen binding');
  hash(capsule.executionSourceCommit, 'historical implementation', 40);
  requireThat(capsule.executionSourceCommit !== binding.sourceCommit, 'completed history requires historical continuation B');
  record(capsule.frozen, ['bundleDigest', 'trustDigest', 'configDigest', 'historyDigest', 'legacyBankDigest',
    'runtime', 'caseManifestDigest'], 'completed frozen provenance');
  for (const key of ['bundleDigest', 'trustDigest', 'configDigest', 'historyDigest', 'legacyBankDigest', 'caseManifestDigest'])
    hash(capsule.frozen[key], 'completed frozen ' + key);
  requireThat(capsule.frozen.trustDigest === digest(trust) && capsule.frozen.configDigest === binding.configDigest &&
    capsule.frozen.historyDigest === digest(history) && digest(capsule.frozen.runtime) === config.runtimeDigest &&
    capsule.frozen.caseManifestDigest === digest(config.cases), 'completed frozen inputs differ');
  record(capsule.provenance, ['authorityHead', 'events', 'stateDigest', 'lastEventAt', 'capturedAt',
    'exportSourceCommit', 'qualificationDescriptorDigest', 'files'], 'completed authority provenance');
  for (const key of ['authorityHead', 'stateDigest', 'qualificationDescriptorDigest']) hash(capsule.provenance[key], key);
  integer(capsule.provenance.events, 'authority event count', 1, 100000);
  isoTime(capsule.provenance.lastEventAt, 'authority last event time');
  isoTime(capsule.provenance.capturedAt, 'authority capture time');
  hash(capsule.provenance.exportSourceCommit, 'actual C export image', 40);
  requireThat(Date.parse(capsule.provenance.lastEventAt) <= Date.parse(capsule.provenance.capturedAt) &&
    ![binding.sourceCommit, capsule.executionSourceCommit].includes(capsule.provenance.exportSourceCommit),
  'authority capture precedes final event or impersonates A/B');
  nonempty(capsule.provenance.files, 100000, 'authority artifact inventory');
  const fileNames = new Set();
  for (const item of capsule.provenance.files) {
    record(item, ['path', 'bytes', 'sha256'], 'authority artifact identity');
    requireThat(typeof item.path === 'string' && /^(?:frozen-bundle\.json|public-identities\.json|ledger\/(?:\.head\.json|\d{12}\.json)|artifacts\/[a-f0-9]{64}\.json)$/u.test(item.path) &&
      !fileNames.has(item.path), 'authority inventory path or duplicate'); fileNames.add(item.path);
    integer(item.bytes, 'authority artifact bytes', 1, 32 * 1024 * 1024); hash(item.sha256, 'authority artifact hash');
    if (item.path.startsWith('artifacts/')) requireThat(item.sha256 === item.path.slice(10, -5),
      'authority artifact content address changed');
  }
  requireThat(fileNames.has('frozen-bundle.json') && fileNames.has('public-identities.json') &&
    fileNames.has('ledger/.head.json'), 'authority inventory omits retained roots');
  const implementation = historicalImplementation(capsule, { binding, trust });
  const gate = originalReceipt(capsule.gate, trust, 'evaluation', 'gk-learning-v2-managed-gate', {
    ...identity(binding), ...config.gatePolicy, status: 'passed', fullSuite: true, independent: true,
    baseCurrent: true, cleanupComplete: true, noSkippedChecks: true,
  }).body;
  hash(gate.rawLogsDigest, 'original gate log digest');
  requireThat(Array.isArray(capsule.attempts) && capsule.attempts.length === 10, 'exactly ten genuine attempts required');
  const attemptIds = new Set();
  for (const [index, attempt] of capsule.attempts.entries()) {
    record(attempt, ['id', 'number', 'status', 'incumbentVersionId', 'historyDigest', 'candidateDigest'], 'closed authority attempt');
    requireThat(attempt.id === binding.experimentId + ':attempt:' + (index + 1) && attempt.number === index + 1 &&
      TERMINAL.includes(attempt.status) && !attemptIds.has(attempt.id), 'authority attempt sequence or terminal status');
    attemptIds.add(attempt.id); hash(attempt.incumbentVersionId, 'attempt incumbent'); hash(attempt.historyDigest, 'attempt history');
    if (attempt.candidateDigest !== null) hash(attempt.candidateDigest, 'attempt candidate');
  }
  nonempty(capsule.operations, 31, 'authority operation count');
  const ids = new Set(), leases = new Set(), calls = new Set(), turns = new Set(), receipts = new Set([gate.receiptId]);
  for (const operation of capsule.operations) {
    record(operation, [...OP_KEYS, 'maxCalls', 'complete', 'lease', 'settlement', 'calls', 'evaluations'], 'closed authority operation');
    requireThat(['baseline', 'proposal', 'screen', 'confirmation'].includes(operation.kind) &&
      !ids.has(operation.id) && operation.id === 'operation-' + digest({ experimentId: binding.experimentId,
        kind: operation.kind, attemptId: operation.attemptId }), 'authority operation identity or duplicate');
    ids.add(operation.id); hash(operation.requestDigest, 'authority request'); identifier(operation.namespace, 'authority namespace');
    requireThat(operation.kind === 'baseline' ? operation.attemptId === null : attemptIds.has(operation.attemptId),
      'authority operation references an absent attempt');
    integer(operation.maxCalls, 'authority exact slots', 1, 126);
    requireThat(typeof operation.complete === 'boolean' && (operation.kind === 'proposal' || operation.complete),
      'evaluation phase is not complete');
    const lease = originalReceipt(operation.lease, trust, 'budget', 'gk-learning-v2-operation-lease', {
      ...identity(binding), ...Object.fromEntries(OP_KEYS.map(key => [key, operation[key]])),
      budgetId: config.budgetId, gatewayId: trust.budget.gatewayId, model: config.model,
      provider: 'truefoundry', global: false, ceilingMicros: null, managedGateDigest: digest(gate),
      namespaceExclusive: true, providerLimitEnforced: false, maxCalls: operation.maxCalls,
    }).body;
    requireThat(!leases.has(lease.receiptId) && !receipts.has(lease.receiptId), 'authority lease reused');
    leases.add(lease.receiptId); receipts.add(lease.receiptId);
    const settled = originalReceipt(operation.settlement, trust, 'budget', 'gk-learning-v2-operation-settlement', {
      ...identity(binding), operationId: operation.id, leaseId: lease.receiptId,
      budgetId: config.budgetId, gatewayId: trust.budget.gatewayId, provider: 'truefoundry', global: false,
      ceilingMicros: null, status: 'settled', actualCalls: operation.maxCalls,
    }).body;
    if (settled.actualMicros !== null) integer(settled.actualMicros, 'retained charged cost');
    requireThat(!receipts.has(settled.receiptId), 'authority settlement reused'); receipts.add(settled.receiptId);
    requireThat(Array.isArray(operation.calls) && operation.calls.length === operation.maxCalls,
      'settled authority operation lacks every original call');
    for (const call of operation.calls) {
      record(call, ['callId', 'slot', 'sessionId', 'turnId', 'stage', 'intentDigest', 'evidenceDigest',
        'inputDigest', 'outputDigest', 'modelDigest', 'complete', 'observedModelCalls', 'relay'], 'closed owned call');
      requireThat(call.callId === 'call-' + digest({ operationId: operation.id, slot: call.slot }) &&
        !calls.has(call.callId) && call.stage === 'turn-created' && call.complete === true &&
        call.observedModelCalls === 1, 'closed call is ambiguous, repeated or nonterminal');
      calls.add(call.callId); identifier(call.sessionId, 'closed session'); identifier(call.turnId, 'closed turn');
      const turn = canonical([call.sessionId, call.turnId]); requireThat(!turns.has(turn), 'closed turn reused'); turns.add(turn);
      for (const key of ['intentDigest', 'evidenceDigest', 'inputDigest', 'outputDigest', 'modelDigest']) hash(call[key], key);
      requireThat(fileNames.has('artifacts/' + call.intentDigest + '.json') &&
        fileNames.has('artifacts/' + call.evidenceDigest + '.json') &&
        call.modelDigest === digest(capsule.frozen.runtime.model), 'call evidence, intent or model differs');
      record(call.relay, ['status', 'requestDigest', 'resultDigest', 'httpStatus', 'claimedAt'], 'closed relay');
      requireThat(call.relay.status === 'complete', 'relay did not receive a complete terminal result');
      hash(call.relay.requestDigest, 'relay request'); hash(call.relay.resultDigest, 'relay result');
      integer(call.relay.httpStatus, 'relay status', 200, 299); isoTime(call.relay.claimedAt, 'relay original claim time');
    }
    requireThat(Array.isArray(operation.evaluations) && operation.evaluations.length <= 9,
      'evaluation envelope collection');
    for (const item of operation.evaluations) {
      record(item, ['arm', 'pairId', 'envelope'], 'original evaluation');
      const body = originalReceipt(item.envelope, trust, 'evaluation', 'gk-learning-v2-evaluation', {
        experimentId: binding.experimentId, sourceCommit: binding.sourceCommit, operationId: operation.id,
        requestDigest: operation.requestDigest, phase: operation.kind, pairId: item.pairId,
      }).body;
      requireThat(!receipts.has(body.receiptId), 'evaluation receipt reused'); receipts.add(body.receiptId);
    }
    if (operation.kind === 'proposal') requireThat(operation.maxCalls === 1 && operation.evaluations.length === 0,
      'proposal must be exactly one actual original call');
  }
  requireThat(capsule.operations.filter(item => item.kind === 'baseline').length === 1 &&
    capsule.operations[0].kind === 'baseline' && capsule.operations[0].maxCalls === 14,
  'original fourteen-call BASE absent');
  for (const attempt of capsule.attempts) requireThat(capsule.operations.filter(item =>
    item.kind === 'proposal' && item.attemptId === attempt.id).length === 1, 'attempt lacks one settled proposal');
  requireThat(Array.isArray(capsule.reviews) && capsule.reviews.length <= 10, 'closed novelty review collection');
  const reviewed = new Set();
  for (const review of capsule.reviews) {
    record(review, ['operationId', 'envelope'], 'closed novelty review');
    const operation = capsule.operations.find(item => item.id === review.operationId && item.kind === 'proposal');
    requireThat(operation && !reviewed.has(review.operationId), 'novelty review owner or duplicate'); reviewed.add(review.operationId);
    originalReceipt(review.envelope, trust, 'novelty', 'gk-learning-v2-novelty', {
      ...identity(binding), operationId: operation.id, requestDigest: operation.requestDigest, attemptId: operation.attemptId,
    });
  }
  requireThat(Array.isArray(capsule.activations) && capsule.activations.length <= 100, 'closed activation collection');
  for (const activation of capsule.activations) {
    record(activation, ['action', 'versionId', 'previousVersionId', 'envelope', 'renewals'], 'closed activation');
    requireThat(['activate', 'rollback'].includes(activation.action) && Array.isArray(activation.renewals) &&
      activation.renewals.length <= 100, 'closed activation action or renewals');
    for (const serialized of [activation.envelope, ...activation.renewals]) originalReceipt(serialized, trust,
      'activation', 'gk-learning-v2-activation', { ...identity(binding), action: activation.action,
        versionId: activation.versionId, incumbentVersionId: activation.previousVersionId,
        purpose: 'experiment-incumbent-only' });
  }
  for (const key of ['baselineDigest', 'activeVersionId', 'versionsDigest']) hash(capsule[key], key);
  return { capsule, implementation, gate };
}

/** Pure projection used by the read-only exporter and synthetic qualification.
 * getArtifact verifies the named private content address; raw artifacts never
 * enter the returned object. It supplies no provider/network capability. */
export async function projectCompletedAuthority({ bundle, state, snapshot, files, getArtifact,
  exportSourceCommit, qualificationDescriptorDigest, capturedAt }) {
  requireThat(state.schema === 'gk-detached-authority-state-v1' && state.activeCallId === null &&
    !state.baselineError && state.baseline && state.operations.every(item => item.settlement !== null && !item.reconciliation) &&
    state.reviews.every(item => typeof item.envelope === 'string') && state.implementation?.authorization,
  'authority retains pending, ambiguous, reconciled or incomplete work');
  same(state.binding, bundle.binding, 'authority state frozen binding');
  const implementation = state.implementation;
  const executionSourceCommit = JSON.parse(implementation.qualification).body.implementationCommit;
  const operations = [];
  for (const op of state.operations) {
    const calls = [];
    for (const call of op.calls) {
      requireThat(call.stage === 'turn-created' && call.relay?.status === 'complete' && call.evidenceDigest,
        'authority owned call remains pending');
      const intent = await getArtifact(call.intentDigest), observed = await getArtifact(call.evidenceDigest);
      requireThat(digest(intent) === call.intentDigest && digest(observed) === call.evidenceDigest &&
        intent.callId === call.callId && observed.callId === call.callId && observed.sessionId === call.sessionId &&
        observed.turnId === call.turnId && observed.inputDigest === intent.inputDigest &&
        typeof observed.text === 'string' && observed.outputDigest === bytesSha(observed.text) &&
        observed.complete === true && observed.observedModelCalls === 1 && observed.finishReason === 'stop',
      'retained provider evidence does not prove the original complete owned call');
      same(intent.slot, call.slot, 'owned call slot changed');
      same(intent.sessionRequest.agent.spec.model, bundle.runtime.model, 'owned model changed');
      calls.push({ callId: call.callId, slot: copy(call.slot), sessionId: call.sessionId, turnId: call.turnId,
        stage: call.stage, intentDigest: call.intentDigest, evidenceDigest: call.evidenceDigest,
        inputDigest: observed.inputDigest, outputDigest: observed.outputDigest,
        modelDigest: digest(intent.sessionRequest.agent.spec.model), complete: observed.complete,
        observedModelCalls: observed.observedModelCalls, relay: { status: call.relay.status,
          requestDigest: call.relay.requestDigest, resultDigest: call.relay.resultDigest,
          httpStatus: call.relay.httpStatus, claimedAt: call.relay.claimedAt } });
    }
    operations.push({ ...Object.fromEntries(OP_KEYS.map(key => [key, op[key]])), maxCalls: op.maxCalls,
      complete: op.complete, lease: op.lease, settlement: op.settlement, calls,
      evaluations: op.evaluations.map(item => ({ arm: item.arm, pairId: item.pairId, envelope: item.envelope })) });
  }
  const capsule = {
    schema: 'gk-completed-authority-capsule-v1', binding: copy(bundle.binding), executionSourceCommit,
    frozen: { bundleDigest: digest(bundle), trustDigest: digest(bundle.trust), configDigest: bundle.binding.configDigest,
      historyDigest: digest(bundle.history), legacyBankDigest: bundle.legacyBankDigest,
      runtime: copy(bundle.runtime), caseManifestDigest: digest(bundle.config.cases) },
    provenance: { authorityHead: snapshot.head, events: snapshot.events.length, stateDigest: digest(state),
      lastEventAt: snapshot.events.at(-1).recordedAt, capturedAt, exportSourceCommit, qualificationDescriptorDigest, files: copy(files) },
    gate: state.gate, implementation: { qualification: implementation.qualification,
      preparation: implementation.preparation, authorization: implementation.authorization },
    attempts: state.attempts.map(item => ({ id: item.id, number: item.number, status: item.status,
      incumbentVersionId: item.incumbentVersionId, historyDigest: item.historyDigest, candidateDigest: item.candidateDigest ?? null })),
    operations, reviews: state.reviews.map(item => ({ operationId: item.operationId, envelope: item.envelope })),
    activations: state.activationHistory.map(item => ({ action: item.action, versionId: item.versionId,
      previousVersionId: item.previousVersionId, envelope: item.envelope, renewals: copy(item.renewals ?? []) })),
    baselineDigest: digest(state.baseline), activeVersionId: state.activeVersionId, versionsDigest: digest(state.versions),
  };
  verifyAuthorityCapsule(capsule, { binding: bundle.binding, trust: bundle.trust, config: bundle.config, history: bundle.history });
  return capsule;
}

function custodyInventory(directory) {
  exactDirectory(directory, ['artifacts', 'frozen-bundle.json', 'keys', 'ledger', 'public-identities.json', 'relay-prefix']);
  // Inspect secret custody names/types only. Never open key or relay bytes.
  exactDirectory(join(directory, 'keys'), ROLES.map(role => role + '.pem'));
  for (const path of [join(directory, 'relay-prefix'), ...ROLES.map(role => join(directory, 'keys', role + '.pem'))]) {
    const stat = lstatSync(path);
    requireThat(stat.isFile() && !stat.isSymbolicLink() && stat.uid === process.getuid() &&
      stat.nlink === 1 && (stat.mode & 0o777) === 0o600, 'retained secret custody or pending publication changed');
  }
  const roots = ['frozen-bundle.json', 'public-identities.json'];
  const files = roots.map(path => { const { bytes } = readArchiveJson(join(directory, path));
    return { path, bytes: bytes.length, sha256: bytesSha(bytes) }; });
  for (const group of ['ledger', 'artifacts']) {
    const list = inventoryTree(join(directory, group), { allow: (path, isDirectory) => !isDirectory &&
      (group === 'ledger' ? /^(?:\.head\.json|\d{12}\.json)$/u.test(path) : /^[a-f0-9]{64}\.json$/u.test(path)) });
    files.push(...list.map(item => ({ ...item, path: group + '/' + item.path })));
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

export async function readCompletedAuthorityArchive({ directory, repositoryRoot,
  sourceDescriptor, actualSourceCommit, fetcher = fetch, clock = Date.now } = {}) {
  privateDirectory(directory);
  const before = custodyInventory(directory);
  const bundle = verifyProductionBundle(readArchiveJson(join(directory, 'frozen-bundle.json')).value);
  same(readArchiveJson(join(directory, 'public-identities.json')).value, bundle.trust, 'retained public pins changed');
  const journal = new FileJournal({ directory: join(directory, 'ledger'), repositoryRoot, create: false, readOnly: true });
  const snapshot = await journal.read();
  // AuthorityLedger.read verifies the chain, not arbitrary semantic fields.
  // The independent capsule validator below supplies those missing checks.
  const ledger = new AuthorityLedger({ journal, binding: bundle.binding, initial: null });
  const state = await ledger.read();
  requireThat(state.implementation?.qualification, 'historical B qualification absent');
  const historical = historicalImplementation({ executionSourceCommit: JSON.parse(state.implementation.qualification).body.implementationCommit,
    implementation: { qualification: state.implementation.qualification, preparation: state.implementation.preparation,
      authorization: state.implementation.authorization } }, { binding: bundle.binding, trust: bundle.trust });
  const source = await createCompletedSourceVerifier({ descriptor: sourceDescriptor, fetcher })({
    actualSourceCommit, historicalQualification: historical.qualificationEnvelope.body, binding: bundle.binding });
  const getArtifact = async key => {
    hash(key, 'retained authority artifact'); const found = readArchiveJson(join(directory, 'artifacts', key + '.json'));
    requireThat(bytesSha(found.bytes) === key && digest(found.value) === key, 'retained authority artifact changed');
    return found.value;
  };
  const capsule = await projectCompletedAuthority({ bundle, state, snapshot, files: before, getArtifact,
    exportSourceCommit: actualSourceCommit, qualificationDescriptorDigest: source.descriptorDigest,
    capturedAt: new Date(clock()).toISOString() });
  same(await journal.read(), snapshot, 'authority journal advanced during export');
  same(custodyInventory(directory), before, 'authority files advanced during export');
  return { capsule, source };
}

/** The control-plane role pins both roots independently of operator input. */
export async function exportCompletedAuthority({ sourceDescriptor,
  actualSourceCommit = process.env.RAILWAY_GIT_COMMIT_SHA, fetcher = fetch, clock = Date.now } = {}) {
  return readCompletedAuthorityArchive({ directory: COMPLETED_AUTHORITY_ROOT, repositoryRoot: '/app',
    sourceDescriptor, actualSourceCommit, fetcher, clock });
}
