/** Explicit C control-plane roles. Only capture/activate create files, and only
 * in the new completed-history directory. Historical A/B/D files stay read-only. */
import { constants, closeSync, fstatSync, fsyncSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, copy, hash, record, requireThat } from './contracts.mjs';
import { exportCompletedAuthority } from './completed-authority-export.mjs';
import { createCompletedSourceVerifier, verifyCompletedOwnerPin } from './completed-history-proof.mjs';
import { captureCompletedHistory, readClosedHostSnapshot, COMPLETED_HOST_ROOT, COMPLETED_HISTORY_DIRECTORY } from './completed-history.mjs';
import { bytesSha, decodeHistoryChunks, encodeHistoryChunks, exactDirectory, privateDirectory, readArchiveJson, same } from './completed-history-files.mjs';
import { assertCompletedRoleEnvironment, verifyCompletedVolume } from './completed-history-preflight.mjs';
import { startCompletedHistoryApp } from './launch-completed-history.mjs';

export const COMPLETED_TRANSFER_INPUT = '/tmp/gk-completed-history-input/authority-transfer.json';

function decodedInput(value) {
  requireThat(typeof value === 'string' && value.length > 0 && value.length <= 65536 &&
    /^[A-Za-z0-9+/]*={0,2}$/u.test(value), 'bounded completed role input required');
  const bytes = Buffer.from(value, 'base64');
  requireThat(bytes.toString('base64') === value, 'completed role input encoding');
  const result = JSON.parse(bytes.toString('utf8')); canonical(result); return result;
}

function syncDirectory(path) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Bounded create-once publication only. The configured roles below always use
 * the fixed new profile directory; the explicit directory enables isolated
 * synthetic qualification of partial-write and duplicate-publication holds. */
export function publishCompletedProfileFile({ directory, name, bytes, uid = process.getuid?.() }) {
  privateDirectory(directory, uid);
  requireThat(['authority-capsule.json', 'closure.json', 'activation.json'].includes(name) &&
    Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 32 * 1024 * 1024,
  'only new bounded completed-history files may be published');
  const fd = openSync(join(directory, name), constants.O_WRONLY | constants.O_CREAT |
    constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    const stat = fstatSync(fd);
    requireThat(stat.isFile() && stat.uid === uid && stat.nlink === 1 && (stat.mode & 0o777) === 0o600,
      'new completed-history publication custody');
    writeFileSync(fd, bytes); fsyncSync(fd);
  } finally { closeSync(fd); }
  syncDirectory(directory);
  // A partial write remains held and visible. This role never deletes, repairs,
  // replaces or blindly retries a create-once result after an interruption.
}

export async function installCapturedHistory({ env = process.env, fetcher = fetch, clock = Date.now } = {}) {
  assertCompletedRoleEnvironment(env, 'capture');
  requireThat(process.getuid?.() === 1000, 'non-root closed-history capture required');
  hash(env.GK_COMPLETED_HISTORY_CAPSULE_SHA256, 'operator-observed capsule SHA256');
  const transfer = readArchiveJson(COMPLETED_TRANSFER_INPUT, { maximum: 48 * 1024 * 1024 }).value;
  const capsule = decodeHistoryChunks(transfer, env.GK_COMPLETED_HISTORY_CAPSULE_SHA256);
  const captured = await captureCompletedHistory({ capsuleBytes: capsule.bytes,
    expectedCapsuleSha256: env.GK_COMPLETED_HISTORY_CAPSULE_SHA256,
    sourceDescriptor: decodedInput(env.GK_COMPLETED_HISTORY_SOURCE_PROOF_B64),
    actualSourceCommit: env.RAILWAY_GIT_COMMIT_SHA, fetcher, clock });
  // The historical namespace has already passed a full no-writer capture.
  // mkdir without recursive/EEXIST handling is an explicit create-once claim.
  mkdirSync(COMPLETED_HISTORY_DIRECTORY, { mode: 0o700 }); syncDirectory(COMPLETED_HOST_ROOT);
  publishCompletedProfileFile({ directory: COMPLETED_HISTORY_DIRECTORY, name: 'authority-capsule.json', bytes: captured.capsuleBytes });
  publishCompletedProfileFile({ directory: COMPLETED_HISTORY_DIRECTORY, name: 'closure.json', bytes: captured.closureBytes });
  exactDirectory(COMPLETED_HISTORY_DIRECTORY, ['authority-capsule.json', 'closure.json']);
  return { schema: 'gk-completed-history-captured-v2', servingSourceCommit: captured.closure.servingSourceCommit,
    experimentSourceCommit: captured.closure.binding.sourceCommit, originalExecutionSourceCommit: captured.closure.originalExecutionSourceCommit,
    finalExecutionSourceCommit: captured.closure.finalExecutionSourceCommit,
    authorityCapsuleSha256: bytesSha(captured.capsuleBytes), closureDigest: bytesSha(captured.closureBytes),
    qualificationDescriptorDigest: captured.source.descriptorDigest, archivedAt: captured.closure.archivedAt,
    configDigest: captured.closure.binding.configDigest, genuineAttempts: captured.closure.completion.genuineAttempts,
    recovery: copy(captured.closure.completion.recovery),
    observationQualificationDigest: captured.closure.completion.observationQualificationDigest,
    observationPreparationDigest: captured.closure.completion.observationPreparationDigest,
    observationAuthorizationDigest: captured.closure.completion.observationAuthorizationDigest,
    driver: 'unavailable', activation: 'owner-pin-required' };
}

export async function installCompletedActivation({ env = process.env, fetcher = fetch } = {}) {
  assertCompletedRoleEnvironment(env, 'activate');
  requireThat(process.getuid?.() === 1000, 'non-root completed activation required');
  exactDirectory(COMPLETED_HISTORY_DIRECTORY, ['authority-capsule.json', 'closure.json']);
  const capsule = readArchiveJson(join(COMPLETED_HISTORY_DIRECTORY, 'authority-capsule.json'));
  const saved = readArchiveJson(join(COMPLETED_HISTORY_DIRECTORY, 'closure.json')), closure = saved.value;
  record(closure, ['schema', 'binding', 'originalExecutionSourceCommit', 'finalExecutionSourceCommit', 'servingSourceCommit', 'archivedAt',
    'authorityCapsuleSha256', 'qualificationDescriptorDigest', 'host', 'completion'], 'closed activation manifest');
  requireThat(closure.schema === 'gk-completed-history-closure-v2' && closure.servingSourceCommit === env.RAILWAY_GIT_COMMIT_SHA &&
    closure.authorityCapsuleSha256 === bytesSha(capsule.bytes) && canonical(closure) === saved.bytes.toString('utf8') &&
    canonical(capsule.value) === capsule.bytes.toString('utf8'), 'closed activation source or capsule changed');
  const sourceDescriptor = decodedInput(env.GK_COMPLETED_HISTORY_SOURCE_PROOF_B64);
  const ownerPin = decodedInput(env.GK_COMPLETED_HISTORY_OWNER_PIN_B64);
  const snapshot = await readClosedHostSnapshot({ root: COMPLETED_HOST_ROOT, repositoryRoot: '/app', capsule: capsule.value, closurePresent: true });
  same(snapshot.binding, closure.binding, 'closed activation frozen binding changed');
  same(snapshot.capture, closure.host, 'closed activation original files/heads changed');
  same(snapshot.completion, closure.completion, 'closed activation acceptance changed');
  const source = await createCompletedSourceVerifier({ descriptor: sourceDescriptor, fetcher })({
    actualSourceCommit: env.RAILWAY_GIT_COMMIT_SHA, binding: snapshot.binding,
    originalQualification: snapshot.historical.qualificationEnvelope.body,
    finalQualification: snapshot.observation.status.qualificationEnvelope.body });
  requireThat(source.descriptorDigest === closure.qualificationDescriptorDigest &&
    capsule.value.provenance.exportSourceCommit === env.RAILWAY_GIT_COMMIT_SHA &&
    capsule.value.provenance.qualificationDescriptorDigest === source.descriptorDigest &&
    closure.originalExecutionSourceCommit === capsule.value.originalExecutionSourceCommit &&
    closure.finalExecutionSourceCommit === capsule.value.finalExecutionSourceCommit,
  'closed activation differs from qualified actual-C exporter');
  const closureDigest = bytesSha(saved.bytes);
  await verifyCompletedOwnerPin({ pin: ownerPin, closure, closureDigest, sourceEvidence: source, fetcher });
  const after = await readClosedHostSnapshot({ root: COMPLETED_HOST_ROOT, repositoryRoot: '/app', capsule: capsule.value, closurePresent: true });
  same(after.capture, snapshot.capture, 'host advanced during owner verification');
  requireThat(bytesSha(readArchiveJson(join(COMPLETED_HISTORY_DIRECTORY, 'closure.json')).bytes) === closureDigest &&
    bytesSha(readArchiveJson(join(COMPLETED_HISTORY_DIRECTORY, 'authority-capsule.json')).bytes) === closure.authorityCapsuleSha256,
  'closure changed during owner verification');
  exactDirectory(COMPLETED_HISTORY_DIRECTORY, ['authority-capsule.json', 'closure.json']);
  publishCompletedProfileFile({ directory: COMPLETED_HISTORY_DIRECTORY, name: 'activation.json',
    bytes: Buffer.from(canonical({ schema: 'gk-completed-history-activation-v2', closureDigest,
      sourceDescriptor: copy(sourceDescriptor), ownerPin: copy(ownerPin) })) });
  return { schema: 'gk-completed-history-activated-v2', servingSourceCommit: env.RAILWAY_GIT_COMMIT_SHA,
    closureDigest, driver: 'unavailable' };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length === 3 && process.argv[2] === 'preflight') {
      verifyCompletedVolume();
      console.log('GK_COMPLETED_HISTORY_PREFLIGHT ' + JSON.stringify({ ready: true, prepared: false }));
    } else {
      requireThat(process.argv.length === 2, 'completed role accepts no source/path/driver arguments');
      const role = assertCompletedRoleEnvironment(process.env, process.env.GK_COMPLETED_HISTORY_ROLE);
      if (role === 'authority-export') {
        const { capsule } = await exportCompletedAuthority({
          sourceDescriptor: decodedInput(process.env.GK_COMPLETED_HISTORY_SOURCE_PROOF_B64),
          actualSourceCommit: process.env.RAILWAY_GIT_COMMIT_SHA });
        for (const line of encodeHistoryChunks(capsule)) console.log('GK_COMPLETED_HISTORY_TRANSFER ' + JSON.stringify(line));
      } else if (role === 'capture') console.log('GK_COMPLETED_HISTORY_CAPTURE ' + JSON.stringify(await installCapturedHistory()));
      else if (role === 'activate') console.log('GK_COMPLETED_HISTORY_ACTIVATION ' + JSON.stringify(await installCompletedActivation()));
      else await startCompletedHistoryApp();
    }
  } catch {
    // Fixed diagnostic only: private IDs, provider bodies, paths and credentials
    // have no error-output path. No last-good closure or automatic recovery.
    console.error('GK_COMPLETED_HISTORY_UNAVAILABLE'); process.exitCode = 2;
  }
}
