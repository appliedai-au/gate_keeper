import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { canonical, copy, digest } from '../../scripts/learning-v2/contracts.mjs';
import { FileJournal } from '../../scripts/learning-v2/journal.mjs';
import { readCompletedAuthorityArchive } from '../../scripts/learning-v2/completed-authority-export.mjs';
import { readClosedHostSnapshot } from '../../scripts/learning-v2/completed-history.mjs';
import { bytesSha } from '../../scripts/learning-v2/completed-history-files.mjs';
import { originalContinuationFixture, NOW } from './completed-history-fixture.mjs';
import { C, completedSourceFixture } from './completed-source-fixture.mjs';

const file = (path, value) => writeFileSync(path, typeof value === 'string' ? value : canonical(value), { flag: 'wx', mode: 0o600 });

/** Remote qualification only: real existing host/authority/continuation code,
 * synthetic Ed25519 roles and SDK responses, no actual model/network service.
 * Ten complete invalid/duplicate proposals establish genuine negative outcomes. */
export async function completedPilotFixture(t, { exactDuplicate = false, positiveAndUncertain = false, installClosure = true } = {}) {
  const f = await originalContinuationFixture(t);
  await f.qualify(); await f.authorize((await f.prepare()).prepared);
  f.controls.now = NOW + 4 * 3_600_000; // Original lease expired before the 13 remaining slots.
  await f.host().continueBaseline();
  if (exactDuplicate) f.controls.proposalContent = JSON.stringify(f.bundle.history[0].procedure);
  for (let index = 1; index <= 10; index++) {
    const attemptId = f.bundle.config.experimentId + ':attempt:' + index;
    await f.host().beginAttempt(await f.authority().fitFeedback({ attemptId }));
    if (positiveAndUncertain && index <= 2) {
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
        verdict: index === 1 ? 'novel' : 'uncertain', comparisons: packet.context.priorReferences.map(item => ({
          priorId: item.id, relation: index === 1 ? 'distinct' : 'uncertain', reason: 'TEST-ONLY full retained history comparison' })),
        coverageCaseIds: [caseId], coverageReasons: [{ caseId, reason: 'TEST-ONLY real retained development applicability' }] });
      await f.host().resumeProposalReview({ operationId: operation.id, noveltyEnvelope });
      if (index === 1) {
        f.controls.improveCandidate = true;
        await f.host().dispatch('screen', attemptId);
        assert.equal((await f.host().inspect()).state.attempts[0].status, 'provisional');
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
    ['confirmed', 'unresolved', ...Array(8).fill('invalid')]);
  else assert.ok(final.state.attempts.every(item => item.status === (exactDuplicate ? 'duplicate' : 'invalid')));
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
  const historical = await f.authority().implementationStatus();
  const originalStatus = { binding: { ownerId: f.bundle.binding.ownerId, experimentId: f.bundle.binding.experimentId,
    sourceCommit: f.bundle.binding.sourceCommit }, configDigest: f.bundle.binding.configDigest,
    directory: f.directory, repositoryRoot: f.repositoryRoot, readToken: 'TEST_ONLY_private_scoped_status_token_12345678', trust: f.trust };
  file(join(f.hostRoot, 'status-config.json'), originalStatus);
  file(join(f.hostRoot, 'production-config.json'), { bundle: f.bundle,
    authority: { baseUrl: 'https://TEST-ONLY.invalid', token: 'PRIVATE-DRIVER-TOKEN-CANARY' }, readToken: originalStatus.readToken });
  file(join(f.hostRoot, 'implementation-qualification.json'), JSON.stringify(historical.qualificationEnvelope));
  file(join(f.hostRoot, 'baseline-continuation-authorization.json'), JSON.stringify(historical.authorizationEnvelope));
  const capturedAt = f.controls.now + 60_000, source = completedSourceFixture(capturedAt);
  const exported = await readCompletedAuthorityArchive({ directory: authorityRoot, repositoryRoot: f.repositoryRoot,
    sourceDescriptor: source.descriptor, actualSourceCommit: C, fetcher: source.fetcher, clock: () => capturedAt });
  const capsule = exported.capsule, capsuleBytes = Buffer.from(canonical(capsule));
  const snapshot = await readClosedHostSnapshot({ root: f.hostRoot, repositoryRoot: f.repositoryRoot, capsule });
  const closure = { schema: 'gk-completed-history-closure-v1', binding: snapshot.binding,
    executionSourceCommit: capsule.executionSourceCommit, servingSourceCommit: C, archivedAt: new Date(capturedAt).toISOString(),
    authorityCapsuleSha256: bytesSha(capsuleBytes), qualificationDescriptorDigest: digest(source.descriptor),
    host: snapshot.capture, completion: snapshot.completion };
  const closureBytes = Buffer.from(canonical(closure)), closureDigest = bytesSha(closureBytes);
  const ownerPin = source.ownerPin(closure, closureDigest), closurePath = join(f.hostRoot, 'completed-history');
  if (installClosure) {
    mkdirSync(closurePath, { mode: 0o700 });
    file(join(closurePath, 'authority-capsule.json'), capsuleBytes.toString('utf8'));
    file(join(closurePath, 'closure.json'), closureBytes.toString('utf8'));
    file(join(closurePath, 'activation.json'), { schema: 'gk-completed-history-activation-v1', closureDigest,
      sourceDescriptor: source.descriptor, ownerPin });
  }
  return { ...f, source, capsule, capsuleBytes, snapshot, closure, closureBytes, closureDigest, closurePath, capturedAt, authorityRoot,
    originalStatus, ownerPin, final, async authorityState() { return copy(await f.authority().initialize()); } };
}
