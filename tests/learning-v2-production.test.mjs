import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import { copy, digest } from '../scripts/learning-v2/contracts.mjs';
import { freezeProductionBundle, importLegacyHistory, verifyProductionBundle,
  PRODUCTION_CORPUS_DIGEST } from '../scripts/learning-v2/production-bundle.mjs';
import { createProductionDriver } from '../scripts/learning-v2/production-driver.mjs';
import { productionChildSpec, superviseProductionChild } from '../scripts/learning-v2/production-bootstrap.mjs';
import { fetchProductionConfig, validateBootstrapDescriptor } from '../scripts/learning-v2/production-bootstrap-config.mjs';

// Source for the isolated remote qualification suite. These histories, keys,
// host transitions and receipts are synthetic fixtures, never live proof.
const corpus = JSON.parse(readFileSync(new URL('../config/learning/concurrency-atomicity-corpus-v1.json', import.meta.url), 'utf8'));
const sha = value => createHash('sha256').update(value).digest('hex');
function legacyProjection(extra = []) {
  const records = ['harmful', 'unproven'].flatMap(group => Array.from({ length: group === 'harmful' ? 35 : 18 }, (_, index) => ({
    group, index, evidenceDigest: sha(`${group}:${index}`), faultType: 'concurrency-atomicity',
    conditional: [{ scope: { kind: 'stack', languages: ['Java'], frameworks: ['Spring'], codeTokens: ['@Transactional', 'this.'] },
      when: `Synthetic historical condition ${group} ${index}.`, evidence: 'A self-call bypasses the transactional proxy.',
      unless: 'The caller already owns a transaction covering every write.' }],
    rules: [`Synthetic retained rule ${group} ${index}.`], verdict: group === 'harmful' ? 'negative' : 'unproven',
  })));
  records.push(...extra.map((entry, index) => ({ group: 'history', index, evidenceDigest: sha(`history:${index}`),
    faultType: 'concurrency-atomicity', ...entry })));
  return { schema: 'gk-legacy-bank-projection-v1', path: '/data/gk3-rule-bank.json', fileDigest: sha('fixture bank bytes'),
    bytes: 8000, revision: 17, counts: { accepted: 0, harmful: 35, unproven: 18, history: extra.length }, records,
    authority: 'historical-observation-only; not v4 signed promotion evidence' };
}
function commissioningInput() {
  const trust = Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation'].map(role => {
    const { publicKey } = generateKeyPairSync('ed25519');
    return [role, { publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
      pinnedFingerprint: sha(publicKey.export({ type: 'spki', format: 'der' })) }];
  }));
  trust.budget.gatewayId = 'fixture-detached-gateway';
  return { ownerId: 'fixture-owner', experimentId: 'fixture-live-pilot', sourceCommit: 'c'.repeat(40),
    model: 'fixture/frozen-model', serverVersion: '0.180.0', trust, corpus: copy(corpus), legacyBank: legacyProjection(),
    gatePolicy: { targetId: 'fixture-remote-full-suite', presetDigest: sha('fixture full suite'),
      outputProfileDigest: sha('fixture output profile'), effectiveTreeDigest: sha('fixture exact source tree') } };
}

test('production corpus is the pinned historical development projection and exposes no check oracle to case inputs', () => {
  assert.equal(digest(corpus), PRODUCTION_CORPUS_DIGEST);
  const bundle = freezeProductionBundle(commissioningInput());
  assert.equal(bundle.config.cases.length, 7);
  assert.equal(bundle.config.cases.reduce((sum, item) => sum + item.expectedBugs, 0), 16);
  assert.equal(bundle.config.cases.filter(item => item.split === 'fit').length, 5);
  assert.ok(bundle.config.cases.filter(item => item.split === 'check').every(item => !item.learnerVisible));
  assert.deepEqual(bundle.caseInputs, corpus.cases.map(({ caseId, prompt }) => ({ caseId, prompt })));
  assert.equal(bundle.history.filter(item => item.outcome === 'rejected').length, 35);
  assert.equal(bundle.history.filter(item => item.outcome === 'unproven').length, 18);
  assert.match(bundle.history[0].procedure.applicability, /Spring/);
  assert.match(bundle.history[0].procedure.applicability, /@Transactional/);
  assert.match(bundle.history[0].procedure.sufficientGuard, /covering every write/);
  assert.deepEqual(verifyProductionBundle(bundle), bundle);
});

test('production initialization refuses incomplete history, corpus changes and shared authority identities', () => {
  let input = commissioningInput();
  input.legacyBank.records.pop();
  assert.throws(() => freezeProductionBundle(input), /export incomplete/);
  input = commissioningInput(); input.corpus.cases[0].expected.push(999);
  assert.throws(() => freezeProductionBundle(input), /corpus differs/);
  input = commissioningInput(); input.trust.novelty = copy(input.trust.evaluation);
  assert.throws(() => freezeProductionBundle(input), /distinct signing identities/);
  const bundle = freezeProductionBundle(commissioningInput()); bundle.history[0].outcome = 'legacy-positive';
  assert.throws(() => verifyProductionBundle(bundle), /bundle binding changed/);
});

test('authentic legacy negative and unconfirmed labels retain their original meanings', () => {
  const imported = importLegacyHistory(legacyProjection([
    { kind: 'scored-rule', verdict: 'negative', status: 'harmful-in-tested-context', rules: ['Historical harmful rule.'] },
    { kind: 'scored-rule', verdict: 'unproven', status: 'unconfirmed-screen-positive', rules: ['Historical incomplete rule.'] },
  ]));
  assert.equal(imported.history.at(-2).outcome, 'rejected');
  assert.equal(imported.history.at(-1).outcome, 'unproven');
});

test('a historically harmful two-rule bundle stays one rejected reference with no isolated component verdicts', () => {
  const projection = legacyProjection();
  const entry = projection.records[0];
  delete entry.conditional;
  entry.status = 'harmful-in-tested-bundle';
  entry.rules = ['First synthetic component with its guard.', 'Second synthetic component with its guard.'];
  const imported = importLegacyHistory(projection);
  assert.equal(imported.history.length, 53);
  assert.equal(imported.history[0].outcome, 'rejected');
  assert.match(imported.history[0].procedure.action, /First synthetic component/);
  assert.match(imported.history[0].procedure.action, /Second synthetic component/);
  assert.match(imported.history[0].procedure.evidence, /without establishing isolated outcomes/);
});

test('unscored oversized or malformed historical attempts stay bound without truncation or invalid v4 procedures', () => {
  const projection = legacyProjection([
    { kind: 'unscored-proposal', proposed: ['x'.repeat(8192)] },
    { kind: 'unscored-proposal', proposed: [{ scope: { languages: ['Java'], codeTokens: ['x'.repeat(3000)] },
      when: 'Historical trigger.', evidence: 'Historical evidence.', unless: 'Historical guard.' }] },
    { kind: 'unscored-proposal', proposed: [{ unprojectable: true, reason: 'historical rejected proposal shape',
      evidenceDigest: sha('malformed original') }] },
  ]);
  const original = copy(projection), imported = importLegacyHistory(projection);
  assert.equal(imported.history.length, 53);
  assert.equal(imported.sourceDigest, digest(projection));
  assert.equal(new Set(imported.nonProcedureRecords.map(item => item.index)).size, 3);
  assert.deepEqual(projection, original);
});

function driverFixture({ negative = false, zeroLastCall = false } = {}) {
  const bundle = freezeProductionBundle(commissioningInput());
  const state = { config: bundle.config, configDigest: bundle.binding.configDigest, history: bundle.history,
    gate: null, baseline: null, attempts: [], operations: [], activationHistory: [], activeVersionId: 'fixture-base',
    versions: [{ id: 'fixture-base', confirmed: true, origin: 'frozen-base', parent: null }] };
  let pending = null;
  const calls = { dispatch: [], activation: [], feedback: [], gate: 0 };
  const host = {
    async inspect() { return copy({ state, dispatch: { pending } }); },
    async status() { return { fixtureOnly: true, attempts: state.attempts.length, activeVersionId: state.activeVersionId }; },
    async recordManagedGate(receipt) { assert.equal(receipt.fixture, 'gate'); state.gate = { digest: sha('fixture gate') }; },
    async beginAttempt(receipt) {
      const id = `${state.config.experimentId}:attempt:${state.attempts.length + 1}`;
      assert.equal(receipt.attemptId, id);
      state.attempts.push({ id, status: 'reserved' });
    },
    async dispatch(kind, attemptId = null) {
      calls.dispatch.push({ kind, attemptId });
      if (kind === 'baseline') { state.baseline = { receiptId: 'fixture-baseline' }; return; }
      const attempt = state.attempts.find(item => item.id === attemptId); assert.ok(attempt);
      if (kind === 'proposal') {
        state.operations.push({ kind, attemptId, settled: true,
          actualCalls: zeroLastCall && state.attempts.length === 10 ? 0 : 1 });
        attempt.status = negative ? 'invalid' : 'ready';
      } else if (kind === 'screen') attempt.status = 'provisional';
      else {
        assert.equal(kind, 'confirmation'); attempt.status = 'confirmed';
        state.versions.push({ id: `fixture-version-${state.attempts.length}`, parent: state.activeVersionId,
          origin: attempt.id, confirmed: true });
      }
    },
    async activateVersion(id, receipt) {
      assert.equal(receipt.versionId, id);
      assert.ok(state.versions.find(item => item.id === id && item.confirmed && item.parent === state.activeVersionId));
      state.activationHistory.push({ action: 'activate', versionId: id, previousVersionId: state.activeVersionId });
      state.activeVersionId = id;
    },
  };
  const remote = {
    async managedGate() { calls.gate++; return { fixture: 'gate' }; },
    async fitFeedback({ attemptId }) { calls.feedback.push(attemptId); return { attemptId }; },
    async activation({ versionId, action }) { calls.activation.push({ versionId, action }); return { versionId }; },
  };
  return { driver: createProductionDriver({ host, remote, bundle }), state, calls, host, remote,
    pending(operation) { pending = operation; } };
}

test('all ten confirmed attempts reach complete after the final activation, with no eleventh dispatch', async () => {
  const f = driverFixture(), result = await f.driver.run();
  assert.equal(result.status, 'complete'); assert.equal(result.genuineAttempts, 10); assert.equal(result.confirmed, 10);
  assert.equal(f.calls.gate, 1); assert.equal(f.calls.feedback.length, 10); assert.equal(f.calls.activation.length, 10);
  assert.equal(f.calls.dispatch.filter(item => item.kind === 'baseline').length, 1);
  for (const kind of ['proposal', 'screen', 'confirmation']) assert.equal(f.calls.dispatch.filter(item => item.kind === kind).length, 10);
  const count = f.calls.dispatch.length;
  assert.equal((await f.driver.run()).status, 'complete'); assert.equal(f.calls.dispatch.length, count);
});

test('ten negative real proposals complete without inventing promotion; a zero-call attempt cannot claim completion', async () => {
  const negative = driverFixture({ negative: true });
  assert.equal((await negative.driver.run()).status, 'complete');
  assert.equal(negative.calls.activation.length, 0);
  assert.equal(negative.calls.dispatch.filter(item => item.kind === 'proposal').length, 10);
  const incomplete = driverFixture({ negative: true, zeroLastCall: true });
  const result = await incomplete.driver.run();
  assert.equal(result.status, 'held'); assert.equal(result.genuineAttempts, 9);
  assert.equal(incomplete.calls.dispatch.filter(item => item.kind === 'proposal').length, 10);
});

test('an ambiguous existing dispatch prevents admission, feedback and model work', async () => {
  const f = driverFixture(); f.pending({ operation: { id: 'fixture-held-operation', kind: 'proposal' } });
  const result = await f.driver.run(); assert.equal(result.status, 'held');
  assert.equal(result.operationId, 'fixture-held-operation');
  assert.equal(f.calls.gate, 0); assert.deepEqual(f.calls.dispatch, []); assert.deepEqual(f.calls.feedback, []);
});

test('settlement-only recovery cannot abandon completed evidence that the original host has not consumed', async () => {
  const f = driverFixture(), operationId = 'fixture-completed-operation', recoveries = [];
  f.pending({ operation: { id: operationId, kind: 'baseline' } });
  f.state.operations.push({ id: operationId, kind: 'baseline', consumed: false, settled: false });
  const receipts = { admissionEnvelope: { fixture: 'original-lease' },
    settlementEnvelope: { fixture: 'original-settlement' }, reason: 'Fixture lost settlement response.' };
  f.remote.operationReconciliation = async input => {
    assert.equal(input.operationId, operationId); return { mode: 'settlement-only', ...receipts };
  };
  f.host.recover = async input => { recoveries.push(input); f.state.operations[0].settled = true; f.pending(null); };
  await assert.rejects(f.driver.reconcileOperation({ operationId }), /original completed evidence has not been consumed/);
  assert.equal(recoveries.length, 0); assert.equal(f.state.operations[0].consumed, false);
  assert.equal((await f.driver.inspect()).dispatch.pending.operation.id, operationId);
  assert.deepEqual(f.calls.dispatch, []); assert.deepEqual(f.calls.feedback, []);
  f.state.operations[0].consumed = true;
  assert.equal((await f.driver.reconcileOperation({ operationId })).status, 'advanced');
  assert.deepEqual(recoveries, [{ operationId, ...receipts }], 'mode is not passed into the existing host API');
  assert.deepEqual(f.calls.dispatch, []);
});

test('failed-execution reconciliation retains admission-crash recovery without dispatching work', async () => {
  const f = driverFixture(), operationId = 'fixture-admission-only', recoveries = [];
  f.pending({ operation: { id: operationId, kind: 'baseline' } });
  const receipts = { admissionEnvelope: { fixture: 'original-lease' },
    settlementEnvelope: { fixture: 'verified-zero-dispatch' }, reason: 'Fixture admitted but never dispatched.' };
  f.remote.operationReconciliation = async () => ({ mode: 'failed-execution', ...receipts });
  f.host.recover = async input => { recoveries.push(input); f.pending(null); };
  assert.equal((await f.driver.reconcileOperation({ operationId })).status, 'advanced');
  assert.deepEqual(recoveries, [{ operationId, ...receipts }]);
  assert.deepEqual(f.calls.dispatch, []); assert.equal(f.state.operations.length, 0);
});

test('production child receives only the explicit environment and exact source binding', () => {
  const sourceCommit = 'e'.repeat(40);
  const spec = productionChildSpec({ GK_PRODUCTION_COMMAND: 'run', RAILWAY_GIT_COMMIT_SHA: sourceCommit,
    DATABASE_URL: 'DATABASE_SECRET_CANARY', TRUEFORGE_API_KEY: 'PROVIDER_SECRET_CANARY',
    GK3_BOOTSTRAP_CMD: 'OLD_BOOTSTRAP_CANARY', NODE_OPTIONS: '--require=untrusted',
    GK_PRODUCTION_CONFIG_B64: 'SCOPED_CONFIG_CANARY' });
  assert.deepEqual(spec.options.env, { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production',
    GK_PRODUCTION_SOURCE_COMMIT: sourceCommit });
  assert.equal(spec.options.shell, false);
  assert.equal(productionChildSpec({ DATABASE_URL: 'unused' }), null);
  assert.throws(() => productionChildSpec({ GK_PRODUCTION_COMMAND: 'run' }), /source commit/);
});

test('authenticated bundle fetch pins source, bank and public authorities before accepting server data', async () => {
  const bundle = freezeProductionBundle(commissioningInput());
  const descriptor = { schema: 'gk-learning-production-bootstrap-v1', binding: bundle.binding,
    legacyBankFileDigest: bundle.legacyBank.fileDigest, legacyBankDigest: bundle.legacyBankDigest,
    trustPins: { ...Object.fromEntries(Object.entries(bundle.trust).map(([role, value]) => [role, value.pinnedFingerprint])),
      gatewayId: bundle.trust.budget.gatewayId },
    authority: { baseUrl: 'https://authority-fixture.example', token: 'fixture-driver-token-'.repeat(4) },
    readToken: 'fixture-status-token-'.repeat(4) };
  let requests = 0;
  const fetcher = async (url, options) => {
    requests++; assert.equal(url, 'https://authority-fixture.example/v1/gatekeeper/bootstrap');
    assert.equal(options.method, 'GET'); assert.equal(options.redirect, 'error');
    assert.equal(options.headers.authorization, `Bearer ${descriptor.authority.token}`);
    return new Response(JSON.stringify(bundle), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  const config = await fetchProductionConfig(descriptor, { fetcher, sourceCommit: bundle.binding.sourceCommit });
  assert.deepEqual(config.bundle, bundle); assert.equal(requests, 1);
  const changed = copy(descriptor); changed.legacyBankFileDigest = sha('different bank');
  await assert.rejects(fetchProductionConfig(changed, { fetcher, sourceCommit: bundle.binding.sourceCommit }),
    /bootstrap bundle provenance mismatch/);
  await assert.rejects(fetchProductionConfig(descriptor, { fetcher, sourceCommit: 'd'.repeat(40) }),
    /bootstrap source differs from platform image/);
  assert.equal(requests, 2, 'wrong source must fail before the network request');
  for (const readToken of ['x'.repeat(32) + '=', 'x'.repeat(32) + '+', 'x'.repeat(257)]) {
    assert.throws(() => validateBootstrapDescriptor({ ...descriptor, readToken }, bundle.binding.sourceCommit),
      /separate scoped credentials/);
  }
});

test('production supervisor forwards termination and waits for child close, not only exit', async () => {
  const child = new EventEmitter(), signals = new EventEmitter(), received = [];
  child.kill = signal => { received.push(signal); return true; };
  let completed = false;
  const running = superviseProductionChild(child, { signals, shutdownGraceMs: 1000 }).then(result => {
    completed = true; return result;
  });
  signals.emit('SIGTERM'); assert.deepEqual(received, ['SIGTERM']);
  child.emit('exit', 0); await Promise.resolve(); assert.equal(completed, false);
  child.emit('close', null, 'SIGTERM');
  assert.equal((await running).status, 'held');
  assert.equal(signals.listenerCount('SIGTERM'), 0); assert.equal(signals.listenerCount('SIGINT'), 0);
});

test('production supervisor kills a nonclosing child after the bounded grace', async () => {
  const child = new EventEmitter(), signals = new EventEmitter(), received = [];
  child.kill = signal => {
    received.push(signal);
    if (signal === 'SIGKILL') queueMicrotask(() => child.emit('close', null, 'SIGKILL'));
    return true;
  };
  const abort = new AbortController();
  const running = superviseProductionChild(child, { signals, abortSignal: abort.signal, shutdownGraceMs: 5 });
  abort.abort();
  assert.equal((await running).status, 'held');
  assert.deepEqual(received, ['SIGTERM', 'SIGKILL']);
});
