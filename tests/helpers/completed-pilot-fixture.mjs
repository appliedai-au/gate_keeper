import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, copy, digest } from '../../scripts/learning-v2/contracts.mjs';
import { FileJournal } from '../../scripts/learning-v2/journal.mjs';
import { readCompletedAuthorityArchive } from '../../scripts/learning-v2/completed-authority-export.mjs';
import { readClosedHostSnapshot } from '../../scripts/learning-v2/completed-history.mjs';
import { bytesSha } from '../../scripts/learning-v2/completed-history-files.mjs';
import { completedObservationFixture } from './completed-observation-fixture.mjs';
import { C, completedSourceFixture } from './completed-source-fixture.mjs';

const file = (path, value) => writeFileSync(path, typeof value === 'string' ? value : canonical(value), { flag: 'wx', mode: 0o600 });

/** Remote qualification only: real existing host/authority/continuation code,
 * synthetic Ed25519 roles and SDK responses, no actual model/network service.
 * Four original invalid outcomes include the unchanged fourth failure plus
 * authenticated D observation; six later real D proposals close the ten. */
export async function completedPilotFixture(t, { exactDuplicate = false, positiveAndUncertain = false, installClosure = true,
  successor = false } = {}) {
  const f = await completedObservationFixture(t, { successor });
  f.controls.proposalContent = '{"findings":[]}';
  if (exactDuplicate) f.controls.proposalContent = JSON.stringify(f.bundle.history[0].procedure);
  for (let index = 5; index <= 10; index++) {
    const attemptId = f.bundle.config.experimentId + ':attempt:' + index;
    await f.host().beginAttempt(await f.authority().fitFeedback({ attemptId }));
    if (positiveAndUncertain && index <= 6) {
      f.controls.proposalContent = JSON.stringify({ scope: f.bundle.config.scope, languages: ['python'],
        applicability: 'TEST-ONLY database transfer fixture ' + index, trigger: 'Two transfers read an unlocked balance ' + index,
        evidence: 'TEST-ONLY independently compared conditional procedure ' + index,
        action: 'Require an atomic conditional debit in the retained transfer fixture ' + index,
        sufficientGuard: 'An equivalent atomic conditional update already prevents the lost debit ' + index });
      await assert.rejects(f.host().dispatch('proposal', attemptId));
      const operation = (await f.host().inspect()).state.operations.find(item => item.kind === 'proposal' && item.attemptId === attemptId);
      const packet = await f.authority().reviewPacket(operation.id), caseId = f.bundle.config.cases[0].caseId;
      const noveltyEnvelope = await f.authority().applyProtectedReview({ schema: 'gk-learning-authority-review-v1',
        reviewId: packet.reviewId, contextDigest: packet.contextDigest,
        reviewer: { id: 'TEST-ONLY-reviewer', evidenceRef: 'TEST-ONLY authentic synthetic review ' + index },
        verdict: index === 5 ? 'novel' : 'uncertain', comparisons: packet.context.priorReferences.map(item => ({
          priorId: item.id, relation: index === 5 ? 'distinct' : 'uncertain', reason: 'TEST-ONLY full retained history comparison' })),
        coverageCaseIds: [caseId], coverageReasons: [{ caseId, reason: 'TEST-ONLY real retained development applicability' }] });
      await f.host().resumeProposalReview({ operationId: operation.id, noveltyEnvelope });
      if (index === 5) {
        f.controls.improveCandidate = true;
        await f.host().dispatch('screen', attemptId);
        assert.equal((await f.host().inspect()).state.attempts[4].status, 'provisional');
        await f.host().dispatch('confirmation', attemptId);
        const target = (await f.host().inspect()).state.versions.find(item => item.origin === attemptId);
        assert.ok(target);
        const initial = await f.authority().activation({ versionId: target.id, action: 'activate' });
        f.controls.now += 2 * 3_600_000;
        const renewed = await f.authority().activation({ versionId: target.id, action: 'activate' });
        assert.notEqual(initial.body.receiptId, renewed.body.receiptId);
        await f.host().activateVersion(target.id, renewed);
      }
    } else {
      if (positiveAndUncertain) f.controls.proposalContent = '{"findings":[]}';
      await f.host().dispatch('proposal', attemptId);
    }
  }
  const expectedCalls = positiveAndUncertain ? 123 : 24;
  assert.equal(f.controls.turns, expectedCalls); assert.equal(f.controls.dispatches, expectedCalls);
  const final = await f.host().inspect();
  assert.equal(final.dispatch.pending, null); assert.equal(final.state.attempts.length, 10);
  if (positiveAndUncertain) assert.deepEqual(final.state.attempts.map(item => item.status),
    [...Array(4).fill('invalid'), 'confirmed', 'unresolved', ...Array(4).fill('invalid')]);
  else assert.deepEqual(final.state.attempts.map(item => item.status),
    [...Array(4).fill('invalid'), ...Array(6).fill(exactDuplicate ? 'duplicate' : 'invalid')]);
  await f.assertOriginal();
  const authorityRoot = join(f.root, 'authority'); mkdirSync(authorityRoot, { mode: 0o700 });
  for (const name of ['keys', 'artifacts']) mkdirSync(join(authorityRoot, name), { mode: 0o700 });
  // Invalid key bytes prove this role never invokes the authority key loader.
  for (const role of ['evaluation', 'novelty', 'budget', 'activation']) file(join(authorityRoot, 'keys', role + '.pem'), 'PRIVATE-KEY-CANARY-NEVER-READ');
  file(join(authorityRoot, 'relay-prefix'), 'PRIVATE-RELAY-PREFIX-NEVER-READ');
  file(join(authorityRoot, 'frozen-bundle.json'), f.bundle);
  file(join(authorityRoot, 'public-identities.json'), f.trust);
  for (const [id, value] of f.artifacts) file(join(authorityRoot, 'artifacts', id + '.json'), value);
  const authorityJournal = new FileJournal({ directory: join(authorityRoot, 'ledger'), repositoryRoot: f.repositoryRoot });
  let prior = null;
  for (const event of (await f.journal.read()).events) prior = (await authorityJournal.append(prior, event)).head;
  const implementation = await f.authority().implementationStatus(), historical = implementation.historicalImplementationStatus;
  const observationAuthorityJournal = new FileJournal({ directory: join(authorityRoot, 'proposal-observation'), repositoryRoot: f.repositoryRoot });
  let proofHead = null;
  for (const event of (await f.proofJournal.read()).events) proofHead = (await observationAuthorityJournal.append(proofHead, event)).head;
  const originalStatus = { binding: { ownerId: f.bundle.binding.ownerId, experimentId: f.bundle.binding.experimentId,
    sourceCommit: f.bundle.binding.sourceCommit }, configDigest: f.bundle.binding.configDigest,
    directory: f.directory, repositoryRoot: f.repositoryRoot, readToken: 'TEST_ONLY_private_scoped_status_token_12345678', trust: f.trust };
  file(join(f.hostRoot, 'status-config.json'), originalStatus);
  file(join(f.hostRoot, 'production-config.json'), { bundle: f.bundle,
    authority: { baseUrl: 'https://TEST-ONLY.invalid', token: 'PRIVATE-DRIVER-TOKEN-CANARY' }, readToken: originalStatus.readToken });
  file(join(f.hostRoot, 'implementation-qualification.json'), JSON.stringify(historical.qualificationEnvelope));
  file(join(f.hostRoot, 'baseline-continuation-authorization.json'), JSON.stringify(historical.authorizationEnvelope));
  for (const [name, envelope] of [['proposal-observation-qualification.json', implementation.qualificationEnvelope],
    ['proposal-observation-preparation.json', implementation.preparationEnvelope],
    ['proposal-observation-authorization.json', implementation.authorizationEnvelope]]) file(join(f.hostRoot, name), JSON.stringify(envelope));
  const capturedAt = f.controls.now + 60_000, source = completedSourceFixture(capturedAt, {
    finalExecutionSourceCommit: f.recoveryCommit, finalExecutionTree: f.recoveryTree });
  const exported = await readCompletedAuthorityArchive({ directory: authorityRoot, repositoryRoot: f.repositoryRoot,
    sourceDescriptor: source.descriptor, actualSourceCommit: C, fetcher: source.fetcher, clock: () => capturedAt });
  const capsule = exported.capsule, capsuleBytes = Buffer.from(canonical(capsule));
  const snapshot = await readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot, capsule });
  const closure = { schema: 'gk-completed-history-closure-v2', binding: snapshot.binding,
    originalExecutionSourceCommit: capsule.originalExecutionSourceCommit, finalExecutionSourceCommit: capsule.finalExecutionSourceCommit,
    servingSourceCommit: C, archivedAt: new Date(capturedAt).toISOString(),
    authorityCapsuleSha256: bytesSha(capsuleBytes), qualificationDescriptorDigest: digest(source.descriptor),
    host: snapshot.capture, completion: snapshot.completion };
  const closureBytes = Buffer.from(canonical(closure)), closureDigest = bytesSha(closureBytes);
  const ownerPin = source.ownerPin(closure, closureDigest), closurePath = join(f.hostRoot, 'completed-history');
  if (installClosure) {
    mkdirSync(closurePath, { mode: 0o700 });
    file(join(closurePath, 'authority-capsule.json'), capsuleBytes.toString('utf8'));
    file(join(closurePath, 'closure.json'), closureBytes.toString('utf8'));
    file(join(closurePath, 'activation.json'), { schema: 'gk-completed-history-activation-v2', closureDigest,
      sourceDescriptor: source.descriptor, ownerPin });
  }
  return { ...f, source, capsule, capsuleBytes, snapshot, closure, closureBytes, closureDigest, closurePath, capturedAt, authorityRoot,
    originalStatus, ownerPin, final, observationAuthorityJournal, authorityJournal, async authorityState() { return copy(await f.authority().initialize()); } };
}
