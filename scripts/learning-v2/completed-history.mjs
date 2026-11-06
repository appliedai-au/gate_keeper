/** A separate completed-history profile at actual C. No production config
 * opener, driver, authority client, signer, bootstrap, SDK or journal writer. */
import { join } from 'node:path';
import { lstatSync, readdirSync } from 'node:fs';
import { canonical, copy, digest, hash, record, requireThat } from './contracts.mjs';
import { FileJournal } from './journal.mjs';
import { LearningController } from './controller.mjs';
import { DispatchLedger } from './dispatch-ledger.mjs';
import { OperationArchive } from './operation-archive.mjs';
import { readBaselineContinuation } from './baseline-continuation.mjs';
import { verifyProductionBundle } from './production-bundle.mjs';
import { statusView } from './prompts.mjs';
import { projectLearningStatus } from '../../integrations/base44/shared/learning-status-contract.js';
import { projectLearningHistoryResponse, validateLearningHistoryBinding } from '../../integrations/base44/shared/learning-history-contract.js';
import { historicalImplementation } from './completed-authority-export.mjs';
import { verifyClosedHostEvidence } from './completed-history-evidence.mjs';
import { createCompletedSourceVerifier, verifyCompletedOwnerPin } from './completed-history-proof.mjs';
import { bytesSha, exactDirectory, inventoryTree, isoTime, privateDirectory, readArchiveFile, readArchiveJson, same } from './completed-history-files.mjs';

export const COMPLETED_HOST_ROOT = '/var/lib/gk-v2-private-journal';
export const COMPLETED_HISTORY_DIRECTORY = COMPLETED_HOST_ROOT + '/completed-history';
const RETAINED_FILES = ['production-config.json', 'status-config.json', 'implementation-qualification.json',
  'baseline-continuation-authorization.json'];
const journalHead = snapshot => ({ head: snapshot.head, events: snapshot.events.length });

function hostRootNames(root, { closurePresent }) {
  privateDirectory(root);
  const expected = [...RETAINED_FILES, 'experiment', ...(closurePresent ? ['completed-history'] : [])];
  const names = readdirSync(root).sort();
  if (names.includes('lost+found')) {
    // The root preflight separately checks that filesystem-managed directory
    // is empty. UID 1000 cannot write it; it is never an experiment store.
    const stat = lstatSync(join(root, 'lost+found'));
    requireThat(stat.isDirectory() && !stat.isSymbolicLink() && stat.uid === 0 && stat.gid === 0 &&
      (stat.mode & 0o777) === 0o700, 'unexpected filesystem metadata custody');
    expected.push('lost+found');
  }
  same(names, expected.sort(), 'host root contains missing, unknown or pending files');
}

function retainedInventory(root) {
  return RETAINED_FILES.map(path => {
    // Every retained byte is fingerprinted, including the original private
    // config. Its connection fields never become a client or returned value.
    const bytes = readArchiveFile(join(root, path));
    const result = { path, bytes: bytes.length, sha256: bytesSha(bytes) }; bytes.fill(0); return result;
  });
}

function retainedFrozenBundle(root) {
  const original = readArchiveJson(join(root, 'production-config.json')).value;
  record(original, ['bundle', 'authority', 'readToken'], 'retained original production file');
  return verifyProductionBundle(original.bundle);
}

function experimentInventory(directory, operationIds) {
  const original = new Set(operationIds.map(id => digest({ operationId: id })));
  const baseline = digest({ operationId: operationIds[0] });
  exactDirectory(directory, ['controller', 'dispatch', 'operations', 'baseline-continuations']);
  exactDirectory(join(directory, 'operations'), [...original]);
  exactDirectory(join(directory, 'baseline-continuations'), [baseline]);
  return inventoryTree(directory, { allow: (path, directoryEntry) => {
    const parts = path.split('/');
    if (['controller', 'dispatch'].includes(parts[0])) return parts.length === 1 ? directoryEntry :
      parts.length === 2 && !directoryEntry && /^(?:\.head\.json|\d{12}\.json)$/u.test(parts[1]);
    if (!['operations', 'baseline-continuations'].includes(parts[0])) return false;
    if (parts.length === 1) return directoryEntry;
    if (!(parts[0] === 'operations' ? original.has(parts[1]) : parts[1] === baseline)) return false;
    return parts.length === 2 ? directoryEntry : parts.length === 3 && !directoryEntry &&
      /^(?:\.head\.json|\d{12}\.json)$/u.test(parts[2]);
  } });
}

/** This shared collector always uses actual read-only FileJournal instances.
 * Tests may supply their own private roots; configured production entrypoints
 * below independently pin the exact existing mount and repository paths. */
export async function readClosedHostSnapshot({ root, repositoryRoot, capsule, closurePresent = false }) {
  hostRootNames(root, { closurePresent });
  const retainedFiles = retainedInventory(root);
  const config = readArchiveJson(join(root, 'status-config.json'), { maximum: 16384 }).value;
  record(config, ['binding', 'configDigest', 'directory', 'readToken', 'repositoryRoot', 'trust'], 'original read-only status config');
  requireThat(config.directory === join(root, 'experiment') && config.repositoryRoot === repositoryRoot,
    'original status config roots changed');
  const binding = { ...copy(config.binding), configDigest: config.configDigest }, directory = config.directory;
  const journalFor = relative => new FileJournal({ directory: join(directory, relative), repositoryRoot,
    create: false, readOnly: true });
  const controllerJournal = journalFor('controller'), dispatchJournal = journalFor('dispatch');
  const controllerSnapshot = await controllerJournal.read(), dispatchSnapshot = await dispatchJournal.read();
  const state = await new LearningController({ journal: controllerJournal, trust: config.trust }).state();
  // The fixed original file necessarily contains credential bytes. Validate
  // only its bundle, then discard the enclosing object. Never invoke the
  // B-bound production opener or retain/use its connection/token properties.
  const frozen = retainedFrozenBundle(root);
  requireThat(digest(frozen) === capsule.frozen.bundleDigest, 'full original frozen bundle differs across custody');
  same(frozen.binding, binding, 'original frozen bundle binding changed'); same(frozen.trust, config.trust, 'original frozen bundle pins changed');
  same(frozen.config, state.config, 'original frozen bundle configuration changed'); same(frozen.history, state.history, 'original frozen history changed');
  const dispatch = await new DispatchLedger({ journal: dispatchJournal, experimentId: binding.experimentId,
    configDigest: binding.configDigest }).read();
  requireThat(state.operations.length >= 11 && state.operations[0]?.kind === 'baseline', 'closed operation set absent');
  const files = experimentInventory(directory, state.operations.map(item => item.id));
  const historical = historicalImplementation(capsule, { binding, trust: config.trust });
  const sidecarQualification = readArchiveJson(join(root, 'implementation-qualification.json')).value;
  const sidecarAuthorization = readArchiveJson(join(root, 'baseline-continuation-authorization.json')).value;
  // No actual-C equality is requested of historical B receipts. These are
  // objects being verified, never an authorization for C to execute learning.
  same(sidecarQualification, historical.qualificationEnvelope, 'retained B qualification file changed');
  same(sidecarAuthorization, historical.authorizationEnvelope, 'retained B owner authorization file changed');
  const baselineId = state.operations[0].id, baselineEntry = dispatch.entries[0];
  requireThat(baselineEntry?.operation.id === baselineId && baselineEntry.baselineContinuation,
    'completed BASE has no mandatory durable continuation linkage');
  const originalJournal = journalFor('operations/' + digest({ operationId: baselineId }));
  const continuationJournal = journalFor('baseline-continuations/' + digest({ operationId: baselineId }));
  const continuationSnapshot = await continuationJournal.read();
  const continuation = await readBaselineContinuation({ originalJournal, continuationJournal,
    link: baselineEntry.baselineContinuation, binding, trust: config.trust,
    implementationCommit: capsule.executionSourceCommit, requireComplete: true });
  const archives = Object.create(null), operationHeads = [];
  for (const operation of state.operations) {
    const journal = journalFor('operations/' + digest({ operationId: operation.id }));
    const snapshot = await journal.read();
    const original = await new OperationArchive({ journal }).read();
    archives[operation.id] = operation.kind === 'baseline' ? continuation.archive : original;
    operationHeads.push({ operationId: operation.id, ...journalHead(snapshot) });
  }
  const completion = verifyClosedHostEvidence({ state, controllerSnapshot, dispatch, archives, continuation,
    capsule, binding, trust: config.trust });
  const status = projectLearningStatus({ ...statusView(state), dispatch: { pending: null, completed: dispatch.entries.length } }, config.binding);
  const capture = { controller: journalHead(controllerSnapshot), dispatch: journalHead(dispatchSnapshot),
    operations: operationHeads, continuation: { operationId: baselineId, ...journalHead(continuationSnapshot),
      link: copy(baselineEntry.baselineContinuation) }, retainedFiles, files };
  // Recheck every head and named byte inventory after semantic validation. A
  // lock, missing sidecar, extra store or changed tail never produces status.
  same(await controllerJournal.read(), controllerSnapshot, 'controller advanced during closed read');
  same(await dispatchJournal.read(), dispatchSnapshot, 'dispatch advanced during closed read');
  same(await continuationJournal.read(), continuationSnapshot, 'continuation advanced during closed read');
  for (const held of operationHeads) same(journalHead(await journalFor('operations/' + digest({ operationId: held.operationId })).read()),
    { head: held.head, events: held.events }, 'operation advanced during closed read');
  same(experimentInventory(directory, state.operations.map(item => item.id)), files, 'experiment bytes changed during closed read');
  same(retainedInventory(root), retainedFiles, 'original host configuration/proofs changed during closed read');
  hostRootNames(root, { closurePresent });
  return { capture, completion, status, config, binding, historical };
}

export async function captureCompletedHistory({ root = COMPLETED_HOST_ROOT, repositoryRoot = '/app', capsuleBytes,
  expectedCapsuleSha256, sourceDescriptor, actualSourceCommit = process.env.RAILWAY_GIT_COMMIT_SHA,
  fetcher = fetch, clock = Date.now } = {}) {
  requireThat(root === COMPLETED_HOST_ROOT && repositoryRoot === '/app', 'fixed completed host roots required');
  hash(expectedCapsuleSha256, 'pinned private authority export');
  requireThat(Buffer.isBuffer(capsuleBytes) && capsuleBytes.length <= 32 * 1024 * 1024 &&
    bytesSha(capsuleBytes) === expectedCapsuleSha256, 'authority capsule bytes differ from control-plane export');
  const capsule = JSON.parse(capsuleBytes.toString('utf8'));
  requireThat(canonical(capsule) === capsuleBytes.toString('utf8'), 'authority capsule serialization changed');
  const snapshot = await readClosedHostSnapshot({ root, repositoryRoot, capsule });
  const source = await createCompletedSourceVerifier({ descriptor: sourceDescriptor, fetcher })({ actualSourceCommit,
    binding: snapshot.binding, historicalQualification: snapshot.historical.qualificationEnvelope.body });
  requireThat(capsule.provenance.exportSourceCommit === actualSourceCommit &&
    capsule.provenance.qualificationDescriptorDigest === source.descriptorDigest, 'capsule exporter is not this independently qualified C');
  const archivedAt = new Date(clock()).toISOString();
  requireThat(Date.parse(archivedAt) >= Date.parse(capsule.provenance.capturedAt) &&
    Date.parse(archivedAt) >= Date.parse(snapshot.completion.lastHostEventAt), 'closure capture time precedes historical evidence');
  const closure = { schema: 'gk-completed-history-closure-v1', binding: snapshot.binding,
    executionSourceCommit: capsule.executionSourceCommit, servingSourceCommit: actualSourceCommit,
    archivedAt, authorityCapsuleSha256: expectedCapsuleSha256, qualificationDescriptorDigest: source.descriptorDigest,
    host: snapshot.capture, completion: snapshot.completion };
  const after = await readClosedHostSnapshot({ root, repositoryRoot, capsule });
  same(after.capture, snapshot.capture, 'host advanced during source qualification/capture');
  return { capsule, capsuleBytes, closure, closureBytes: Buffer.from(canonical(closure)), source, sourceDescriptor: copy(sourceDescriptor) };
}

/** Activate only after independently authenticating C and a concrete owner
 * closure pin. Every serving read reopens all original evidence; no last-good
 * state, mutation, repair or legacy fallback is retained. */
export async function openCompletedHistoryReader({ root, repositoryRoot, actualSourceCommit, fetcher = fetch, clock = Date.now } = {}) {
  const path = join(root, 'completed-history');
  exactDirectory(path, ['authority-capsule.json', 'closure.json', 'activation.json']);
  const savedCapsule = readArchiveJson(join(path, 'authority-capsule.json'));
  const savedClosure = readArchiveJson(join(path, 'closure.json'));
  const savedActivation = readArchiveJson(join(path, 'activation.json'), { maximum: 65536 });
  const closure = savedClosure.value, activation = savedActivation.value, capsule = savedCapsule.value;
  record(closure, ['schema', 'binding', 'executionSourceCommit', 'servingSourceCommit', 'archivedAt',
    'authorityCapsuleSha256', 'qualificationDescriptorDigest', 'host', 'completion'], 'immutable completed closure');
  record(activation, ['schema', 'closureDigest', 'sourceDescriptor', 'ownerPin'], 'completed activation config');
  requireThat(closure.schema === 'gk-completed-history-closure-v1' && activation.schema === 'gk-completed-history-activation-v1' &&
    canonical(closure) === savedClosure.bytes.toString('utf8') && canonical(capsule) === savedCapsule.bytes.toString('utf8') &&
    activation.closureDigest === bytesSha(savedClosure.bytes) && closure.authorityCapsuleSha256 === bytesSha(savedCapsule.bytes) &&
    closure.servingSourceCommit === actualSourceCommit && capsule.provenance.exportSourceCommit === actualSourceCommit &&
    capsule.executionSourceCommit === closure.executionSourceCommit,
  'completed profile changed source, capsule, closure or serialization');
  isoTime(closure.archivedAt, 'immutable archive capture time');
  requireThat(Date.parse(closure.archivedAt) >= Date.parse(capsule.provenance.capturedAt) && Date.parse(closure.archivedAt) <= clock(),
    'immutable capture time is invalid');
  const initial = await readClosedHostSnapshot({ root, repositoryRoot, capsule, closurePresent: true });
  const source = await createCompletedSourceVerifier({ descriptor: activation.sourceDescriptor, fetcher })({
    actualSourceCommit, binding: initial.binding, historicalQualification: initial.historical.qualificationEnvelope.body });
  requireThat(source.descriptorDigest === closure.qualificationDescriptorDigest &&
    capsule.provenance.qualificationDescriptorDigest === source.descriptorDigest, 'completed C qualification identity changed');
  await verifyCompletedOwnerPin({ pin: activation.ownerPin, closure, closureDigest: activation.closureDigest, sourceEvidence: source, fetcher });
  const binding = validateLearningHistoryBinding({ ...initial.config.binding, servingSourceCommit: actualSourceCommit,
    executionSourceCommit: capsule.executionSourceCommit, closureDigest: activation.closureDigest });
  const assertClosure = snapshot => {
    same(snapshot.binding, closure.binding, 'closed frozen binding drift'); same(snapshot.capture, closure.host, 'pinned immutable host head or file drift');
    same(snapshot.completion, closure.completion, 'closed acceptance facts drift');
  };
  assertClosure(initial);
  const fixedFiles = [savedCapsule, savedClosure, savedActivation].map(item => bytesSha(item.bytes));
  const checkOwnFiles = () => {
    exactDirectory(path, ['authority-capsule.json', 'closure.json', 'activation.json']);
    const hashes = ['authority-capsule.json', 'closure.json', 'activation.json'].map(name => bytesSha(readArchiveFile(join(path, name))));
    same(hashes, fixedFiles, 'completed history profile files changed');
  };
  checkOwnFiles();
  return Object.freeze({ binding, readToken: initial.config.readToken, sourceCommit: actualSourceCommit,
    async readStatus() {
      checkOwnFiles();
      const snapshot = await readClosedHostSnapshot({ root, repositoryRoot, capsule, closurePresent: true });
      assertClosure(snapshot); checkOwnFiles();
      const now = clock();
      return projectLearningHistoryResponse({ schema: 'gk-learning-completed-history-response-v1',
        checkedAt: new Date(now).toISOString(), serving: { mode: 'completed-history', sourceCommit: actualSourceCommit },
        archive: { experimentSourceCommit: closure.binding.sourceCommit, executionSourceCommit: closure.executionSourceCommit,
          closureDigest: activation.closureDigest, archivedAt: closure.archivedAt }, status: snapshot.status }, binding, now);
    } });
}

/** Only this fixed-root wrapper is used by actual app startup. The read-only
 * lower-level factory also supports private synthetic qualification fixtures. */
export async function createCompletedHistoryReader({ actualSourceCommit = process.env.RAILWAY_GIT_COMMIT_SHA,
  fetcher = fetch, clock = Date.now } = {}) {
  requireThat(process.getuid?.() === 1000, 'completed serving requires fixed non-root production custody');
  return openCompletedHistoryReader({ root: COMPLETED_HOST_ROOT, repositoryRoot: '/app', actualSourceCommit, fetcher, clock });
}
