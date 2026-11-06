// Authored for the isolated full qualifier. Actual wrapper modules and signed
// verification run against synthetic custody, source evidence and driver seams.
// No production path, real key, network, provider or model is used by this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { EventEmitter } from 'node:events';
import * as path from 'node:path';
import * as url from 'node:url';
import vm from 'node:vm';
import ts from 'typescript';
import * as contracts from '../scripts/learning-v2/contracts.mjs';
import * as bundleModule from '../scripts/learning-v2/production-bundle.mjs';
import * as implementationModule from '../scripts/learning-v2/implementation-proof.mjs';
import * as observationModule from '../scripts/learning-v2/proposal-observation-proof.mjs';
import { createProductionDriver } from '../scripts/learning-v2/production-driver.mjs';

const A = 'a'.repeat(40), B = 'b'.repeat(40), D = 'd'.repeat(40), TREE_D = 'e'.repeat(40);
const ROOT = '/var/lib/gk-v2-private-journal';
const sha = value => createHash('sha256').update(value).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value)); // Preserve signed-body key order.
const { canonical, digest } = contracts;
const corpus = JSON.parse(readFileSync(new URL('../config/learning/concurrency-atomicity-corpus-v1.json', import.meta.url)));

function fixture({ stage = 'authorized', allowRemainingExperiment = false } = {}) {
  const keys = Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation'].map(role => {
    const pair = generateKeyPairSync('ed25519');
    return [role, { ...pair, publicKeyPem: pair.publicKey.export({ type: 'spki', format: 'pem' }),
      pinnedFingerprint: sha(pair.publicKey.export({ type: 'spki', format: 'der' })) }];
  }));
  const trust = Object.fromEntries(Object.entries(keys).map(([role, key]) => [role,
    { publicKeyPem: key.publicKeyPem, pinnedFingerprint: key.pinnedFingerprint }]));
  trust.budget.gatewayId = 'TEST-ONLY-observation-gateway';
  const issue = body => ({ body, signature: sign(null, Buffer.from(JSON.stringify(body)),
    keys.evaluation.privateKey).toString('base64') });
  const records = ['harmful', 'unproven'].flatMap(group => Array.from({ length: group === 'harmful' ? 35 : 18 },
    (_, index) => ({ group, index, evidenceDigest: sha('TEST-ONLY ' + group + index),
      faultType: 'concurrency-atomicity', rules: ['TEST-ONLY retained rule ' + group + index] })));
  const bundle = bundleModule.freezeProductionBundle({ ownerId: 'TEST-ONLY-owner', experimentId: 'TEST-ONLY-observation',
    sourceCommit: A, model: 'fixture/frozen-model', serverVersion: '0.182.0', trust, corpus,
    gatePolicy: { targetId: 'TEST-ONLY-full-suite', presetDigest: sha('TEST-ONLY preset'),
      outputProfileDigest: sha('TEST-ONLY output'), effectiveTreeDigest: sha('TEST-ONLY A tree') },
    legacyBank: { schema: 'gk-legacy-bank-projection-v1', path: '/data/gk3-rule-bank.json',
      fileDigest: sha('TEST-ONLY original bank'), bytes: 8000, revision: 1,
      counts: { accepted: 0, harmful: 35, unproven: 18, history: 0 }, records,
      authority: 'historical-observation-only; not v4 signed promotion evidence' } });
  const pin = commentId => ({ commentId, bodySha256: sha('TEST-ONLY comment ' + commentId),
    authorId: 123, authorLogin: 'TEST-ONLY-owner' });
  const historicalQualification = issue({ schema: 'gk-learning-v2-qualified-implementation',
    receiptId: 'TEST-ONLY-B-qualification', purpose: implementationModule.CONTINUATION_PURPOSE,
    binding: bundle.binding, implementationCommit: B, implementationTree: 'c'.repeat(40),
    qualification: pin(101), qualificationEvidenceDigest: sha('TEST-ONLY B evidence'),
    runId: 'TEST-ONLY-B-run', rawLogsDigest: sha('TEST-ONLY B logs') });
  const baseRetained = { operationId: 'TEST-ONLY-BASE', leaseId: 'TEST-ONLY-BASE-lease',
    requestDigest: sha('TEST-ONLY BASE request'), maxCalls: 14, remainingCalls: 13,
    controllerHead: sha('TEST-ONLY BASE controller'), dispatchHead: sha('TEST-ONLY BASE dispatch'),
    originalArchiveHead: sha('TEST-ONLY BASE archive head'), originalArchiveDigest: sha('TEST-ONLY BASE archive'),
    hostPacketDigest: sha('TEST-ONLY BASE packet'), firstCallId: 'TEST-ONLY-BASE-first',
    firstResultDigest: sha('TEST-ONLY BASE result'), firstInputDigest: sha('TEST-ONLY BASE input'),
    firstOutputDigest: sha('TEST-ONLY BASE output'), sessionId: 'TEST-ONLY-BASE-session', turnId: 'TEST-ONLY-BASE-turn',
    secondCallId: 'TEST-ONLY-BASE-second', secondFailureDigest: sha('TEST-ONLY BASE failure') };
  const historicalAuthorization = issue({ schema: 'gk-learning-v2-baseline-continuation',
    receiptId: 'TEST-ONLY-B-authorization', purpose: implementationModule.CONTINUATION_PURPOSE,
    binding: bundle.binding, implementationCommit: B, implementationTree: historicalQualification.body.implementationTree,
    qualificationDigest: digest(historicalQualification), ownerAuthorizationDigest: sha('TEST-ONLY B owner evidence'),
    ownerAuthorization: { commentId: 102, bodySha256: sha('TEST-ONLY B owner') },
    preparedProofDigest: sha('TEST-ONLY B preparation'), retained: baseRetained,
    authorityPreparedHead: sha('TEST-ONLY B authority head'), authorityOperationDigest: sha('TEST-ONLY B operation'),
    originalAuthorityCalls: 1, secondIntentAbsent: true, allowCorrectedReaderRemainder: true });
  const historicalImplementationStatus = { qualificationEnvelope: historicalQualification,
    authorizationEnvelope: historicalAuthorization };
  const qualificationEnvelope = issue({ schema: 'gk-learning-qualified-proposal-observation-v1',
    receiptId: 'TEST-ONLY-D-qualification', purpose: observationModule.PROPOSAL_OBSERVATION_PURPOSE,
    binding: bundle.binding, implementationCommit: D, implementationTree: TREE_D,
    historicalImplementationCommit: B, historicalQualificationDigest: digest(historicalQualification),
    historicalAuthorizationDigest: digest(historicalAuthorization), qualification: pin(103),
    qualificationEvidenceDigest: sha('TEST-ONLY D stable authenticated facts'),
    runId: 'TEST-ONLY-D-run', rawLogsDigest: sha('TEST-ONLY D logs') });
  const retained = { operationId: 'TEST-ONLY-fourth-operation', attemptId: 'TEST-ONLY-fourth-attempt', attemptNumber: 4,
    leaseId: 'TEST-ONLY-fourth-lease', requestDigest: sha('TEST-ONLY fourth request'), maxCalls: 1, additionalCalls: 0,
    controllerHead: sha('TEST-ONLY fourth controller'), controllerCount: 20,
    dispatchHead: sha('TEST-ONLY fourth dispatch'), dispatchCount: 20,
    originalArchiveHead: sha('TEST-ONLY fourth archive head'), originalArchiveCount: 5,
    originalArchiveDigest: sha('TEST-ONLY fourth archive'), hostPacketDigest: sha('TEST-ONLY fourth packet'),
    controllerStateDigest: sha('TEST-ONLY fourth state'), dispatchDigest: sha('TEST-ONLY fourth dispatch state'),
    callId: 'TEST-ONLY-original-call', callDigest: sha('TEST-ONLY original call'), inputDigest: sha('TEST-ONLY original input'),
    sessionId: 'TEST-ONLY-original-session', turnId: 'TEST-ONLY-original-turn', failureDigest: sha('TEST-ONLY original failure') };
  const observedText = 'TEST-ONLY private invalid original proposal text';
  const preparationEnvelope = issue({ schema: 'gk-learning-proposal-observation-prepared-v1',
    receiptId: 'TEST-ONLY-D-preparation', purpose: observationModule.PROPOSAL_OBSERVATION_PURPOSE,
    binding: bundle.binding, implementationCommit: D, qualificationDigest: digest(qualificationEnvelope), retained,
    authorityHead: sha('TEST-ONLY authority head'), authorityStateDigest: sha('TEST-ONLY authority state'),
    authorityOperationDigest: sha('TEST-ONLY authority operation'), authorityEvidenceDigest: sha('TEST-ONLY original evidence'),
    admissionSerialized: JSON.stringify({ fixture: 'TEST-ONLY original admission; wrapper fixture only' }),
    settlementSerialized: JSON.stringify({ fixture: 'TEST-ONLY original B settlement; wrapper fixture only' }),
    observed: { callId: retained.callId, sessionId: retained.sessionId, turnId: retained.turnId,
      inputDigest: retained.inputDigest, outputDigest: sha(observedText), text: observedText,
      complete: true, finishReason: 'stop', observedModelCalls: 1,
      modelDigest: sha('TEST-ONLY frozen model'), classification: 'invalid' }, preparedAt: '2026-11-06T08:00:00.000Z' });
  const authorizationEnvelope = issue({ schema: 'gk-learning-proposal-observation-authorized-v1',
    receiptId: 'TEST-ONLY-D-authorization', purpose: observationModule.PROPOSAL_OBSERVATION_PURPOSE,
    binding: bundle.binding, implementationCommit: D, implementationTree: TREE_D,
    qualificationDigest: digest(qualificationEnvelope), preparedProofDigest: digest(preparationEnvelope),
    retainedDigest: digest(retained), settlementDigest: digest(preparationEnvelope.body.settlementSerialized),
    ownerAuthorization: { commentId: 104, bodySha256: sha('TEST-ONLY D owner') },
    ownerAuthorizationDigest: sha('TEST-ONLY D owner evidence'), allowRemainingExperiment });
  const status = { schema: observationModule.PROPOSAL_OBSERVATION_STATUS, historicalImplementationStatus,
    qualificationEnvelope, preparationEnvelope: stage === 'qualified' ? null : preparationEnvelope,
    authorizationEnvelope: stage === 'authorized' ? authorizationEnvelope : null };
  const sourceDescriptor = { schema: 'gk-learning-proposal-observation-source-proof-v1',
    sourceProof: { schema: 'gk-learning-proposal-observation-gate-proof-v1', repository: 'appliedai-au/gate_keeper',
      sourceCommit: D, qualification: clone(qualificationEnvelope.body.qualification) },
    gatePolicy: { ...bundle.config.gatePolicy, effectiveTreeDigest: sha('TEST-ONLY D tree') } };
  const sourceResult = { implementationCommit: D, implementationTree: TREE_D,
    qualification: clone(qualificationEnvelope.body.qualification),
    qualificationEvidenceDigest: qualificationEnvelope.body.qualificationEvidenceDigest,
    runId: qualificationEnvelope.body.runId, rawLogsDigest: qualificationEnvelope.body.rawLogsDigest };
  const config = { bundle, authority: { baseUrl: 'https://authority.fixture.invalid', token: 'TEST-ONLY-driver-'.repeat(4) },
    readToken: 'TEST-ONLY-read-'.repeat(4) };
  return { config, bundle, status, sourceDescriptor, sourceResult, preparationEnvelope, observedText, issue };
}

async function loadActual(name, dependencies, fakeProcess, fetcher) {
  const sourceUrl = new URL('../scripts/learning-v2/' + name + '.mjs', import.meta.url);
  const source = readFileSync(sourceUrl, 'utf8').replaceAll('import.meta.url', JSON.stringify(sourceUrl.href));
  const compiled = ts.transpileModule(source, { fileName: name + '.js', reportDiagnostics: true,
    compilerOptions: { allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  assert.deepEqual((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
  const module = { exports: {} };
  // Same realm preserves real bundle, signature and typed-status validation.
  // Filesystem/process/driver I/O and the full independent source-verifier
  // factory are controlled seams. Mandatory core tests cover that real GitHub
  // validator; these tests check the wrappers' agreement with its returned facts.
  const initialise = new vm.Script('(async function(module, exports, require, process, fetch, console) {\n' +
    compiled.outputText + '\n})', { filename: name + '-actual.cjs' }).runInThisContext();
  await initialise(module, module.exports, dependency => {
    assert.ok(Object.hasOwn(dependencies, dependency), 'unexpected wrapper dependency ' + dependency);
    return dependencies[dependency];
  }, fakeProcess, fetcher, { log() { assert.fail('exported wrapper tests do not invoke CLI'); },
    error() { assert.fail('exported wrapper tests do not invoke CLI'); } });
  return module.exports;
}

async function harness(f, { installed = false, sourceResult = f.sourceResult, failSource = false, realDriver = null } = {}) {
  const files = new Map(), writes = [], reads = [], trace = [], sourceCalls = [], spawns = [], driverCalls = [];
  const put = (name, value) => files.set(ROOT + '/' + name, JSON.stringify(value) + '\n');
  put('production-config.json', f.config);
  put('implementation-qualification.json', f.status.historicalImplementationStatus.qualificationEnvelope);
  put('baseline-continuation-authorization.json', f.status.historicalImplementationStatus.authorizationEnvelope);
  if (installed) {
    put('proposal-observation-qualification.json', f.status.qualificationEnvelope);
    if (f.status.preparationEnvelope) put('proposal-observation-preparation.json', f.status.preparationEnvelope);
    if (f.status.authorizationEnvelope) put('proposal-observation-authorization.json', f.status.authorizationEnvelope);
  }
  const originalBytes = new Map(files);
  const fetcher = async () => assert.fail('wrapper fixture cannot make any actual HTTP request');
  const fakeProcess = Object.assign(new EventEmitter(), { getuid: () => 1000, argv: [], env: {}, execPath: '/TEST-ONLY/node' });
  const base = { 'node:url': url, 'node:path': path, './contracts.mjs': contracts,
    './production-bundle.mjs': bundleModule, './implementation-proof.mjs': implementationModule,
    './proposal-observation-proof.mjs': { ...observationModule,
      createProposalObservationSourceVerifier({ descriptor, fetcher: suppliedFetcher }) {
        assert.equal(suppliedFetcher, fetcher); assert.deepEqual(descriptor, f.sourceDescriptor);
        return async input => {
          trace.push('source'); sourceCalls.push(input);
          assert.deepEqual(input.historicalImplementationStatus, f.status.historicalImplementationStatus);
          assert.equal(input.implementationCommit, D);
          assert.equal(Object.hasOwn(input, 'originalEvidence'), false, 'host cannot invent original A source evidence');
          if (failSource) throw new Error('TEST-ONLY independent source refused');
          return clone(sourceResult);
        };
      } },
    './private-publication.mjs': {
      readPrivatePublishedJson(file, options) {
        reads.push({ file, options }); assert.equal(options.strictReadOnly, true);
        assert.equal(options.directory, ROOT); assert.equal(options.uid, 1000);
        if (!files.has(file)) throw Object.assign(new Error('TEST-ONLY absent'), { code: 'ENOENT' });
        return JSON.parse(files.get(file));
      },
      publishPrivateJsonOnce(file, value) {
        trace.push('publish');
        if (files.has(file)) {
          assert.equal(canonical(JSON.parse(files.get(file))), canonical(value), 'existing private publication differs; replacement forbidden');
          return;
        }
        writes.push(file); files.set(file, JSON.stringify(value) + '\n');
      },
    } };
  const config = await loadActual('production-config', base, fakeProcess, fetcher);
  const driver = realDriver ?? Object.fromEntries(['status', 'inspect', 'run', 'resumeProposalReview', 'reconcileUsage',
    'reconcileOperation', 'prepareBaselineContinuation', 'continueBaseline', 'prepareProposalObservation',
    'consumeProposalObservation'].map(name => [name, async () => {
    driverCalls.push(name);
    if (name === 'prepareProposalObservation') return { status: 'prepared',
      action: 'original-fourth-observed-without-new-calls', preparedProof: clone(f.preparationEnvelope) };
    if (name === 'consumeProposalObservation') return { status: 'recovered', recovered: true,
      attemptNumber: 4, disposition: 'invalid', additionalModelCalls: 0 };
    if (name === 'status') return { TEST_ONLY: true, attempted: 4, invalid: 4, pending: null };
    return { status: 'TEST-ONLY-unexpected-method' };
  }]));
  const dependencies = { ...base, './production-config.mjs': config,
    'node:child_process': { spawn() { assert.fail('only the injected child may be spawned'); } },
    './production-bootstrap-config.mjs': {
      bindBootstrapConfig() { assert.fail('D cannot rebind bootstrap data'); },
      fetchProductionConfig() { assert.fail('D cannot fetch replacement configuration'); },
      validateBootstrapDescriptor() { assert.fail('D cannot install commissioning seeds'); },
    },
    './authority-client.mjs': { createDetachedAuthorityClient() {
      return { implementationStatus: async () => { trace.push('remote-status'); return clone(f.status); } };
    } },
    './production-driver.mjs': { openProductionPilot: async options => {
      trace.push('open'); assert.equal(options.initialize, false);
      assert.equal(options.implementation.sourceCommit, D);
      assert.deepEqual(options.implementation.status, f.status);
      return driver;
    } },
  };
  const bootstrap = await loadActual('production-bootstrap', dependencies, fakeProcess, fetcher);
  const launcher = await loadActual('launch-production-pilot', dependencies, fakeProcess, fetcher);
  const proof = JSON.stringify(f.sourceDescriptor);
  return { config, bootstrap, launcher, files, put, originalBytes, writes, reads, trace, sourceCalls, spawns, driverCalls, fetcher, proof,
    async start(command, overrides = {}) {
      return bootstrap.startProductionPilot({ env: { GK_PRODUCTION_COMMAND: command, RAILWAY_GIT_COMMIT_SHA: D,
        GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: proof, ...overrides }, fetcher,
        spawnChild(executable, args, options) {
          trace.push('spawn'); spawns.push({ executable, args, options });
          const child = Object.assign(new EventEmitter(), { kill() { return true; } });
          queueMicrotask(() => child.emit('close', 0, null)); return child;
        } });
    },
    command(command, extra = {}) { return launcher.productionCommand({ command, sourceCommit: D,
      proposalObservationProof: proof, fetcher, ...extra }); },
  };
}

test('both command gates retain original B and distinguish D prepare, recovery and remaining execution', async () => {
  const f = fixture({ stage: 'qualified' }), h = await harness(f);
  const gate = (command, status = f.status, sourceCommit = D) => h.config.verifyProductionImplementationForCommand({
    bundle: f.bundle, sourceCommit, command, status });
  for (const command of ['status', 'prepare-proposal-observation']) assert.equal(gate(command).authorizationEnvelope, null);
  for (const command of ['consume-proposal-observation', 'run', 'resume-review', 'reconcile-usage', 'reconcile-operation'])
    assert.throws(() => gate(command), /owner authorization|remaining experiment/);
  for (const command of ['init', 'prepare-baseline', 'continue-baseline']) assert.throws(() => gate(command));
  assert.throws(() => gate('status', null), /lacks independent implementation/);
  assert.throws(() => gate('status', f.status, B), /actual image|historical B/);
  assert.throws(() => gate('status', f.status, A), /original image/);
  assert.throws(() => gate('consume-proposal-observation', f.status.historicalImplementationStatus, B), /actual D proof/);
  assert.equal(gate('continue-baseline', f.status.historicalImplementationStatus, B).qualificationEnvelope.body.implementationCommit, B);
});

test('D sidecars publish in order without changing a byte of original configuration or B evidence', async () => {
  const f = fixture(), h = await harness(f);
  const installed = h.config.installProductionProposalObservation(f.status, D);
  assert.deepEqual(installed.implementation.status, f.status);
  assert.deepEqual(h.writes.map(file => path.basename(file)), ['proposal-observation-qualification.json',
    'proposal-observation-preparation.json', 'proposal-observation-authorization.json']);
  for (const [file, bytes] of h.originalBytes) assert.equal(h.files.get(file), bytes);
  h.config.installProductionProposalObservation(f.status, D); assert.equal(h.writes.length, 3);
  assert.throws(() => h.config.readProductionConfig(B)); assert.throws(() => h.config.readProductionConfig(A));
  const changed = clone(f.status); changed.preparationEnvelope.signature = 'invalid';
  assert.throws(() => h.config.installProductionProposalObservation(changed, D)); assert.equal(h.writes.length, 3);
  assert.throws(() => h.config.installProductionImplementation(f.status.historicalImplementationStatus, B), /installed D/);
});

test('D qualification, preparation and owner authorization advance create-once sidecars without replacing earlier stages', async () => {
  const f = fixture(), h = await harness(f);
  const qualified = { ...f.status, preparationEnvelope: null, authorizationEnvelope: null };
  const prepared = { ...f.status, authorizationEnvelope: null };
  for (const [status, expectedWrites] of [[qualified, 1], [prepared, 2], [f.status, 3]]) {
    assert.deepEqual(h.config.installProductionProposalObservation(status, D).implementation.status, status);
    assert.equal(h.writes.length, expectedWrites);
    for (const [file, bytes] of h.originalBytes) assert.equal(h.files.get(file), bytes);
  }
});

test('missing or substituted B/D sidecars never fall back to an old serving identity', async () => {
  const f = fixture();
  for (const mutate of [
    h => h.files.delete(ROOT + '/implementation-qualification.json'),
    h => h.files.delete(ROOT + '/baseline-continuation-authorization.json'),
    h => h.put('proposal-observation-authorization.json', f.status.authorizationEnvelope),
    h => h.put('proposal-observation-preparation.json', f.status.preparationEnvelope),
  ]) {
    const h = await harness(f); mutate(h);
    assert.throws(() => h.config.readProductionConfig(D)); assert.equal(h.writes.length, 0);
  }
  for (const name of ['proposal-observation-preparation.json', 'proposal-observation-authorization.json']) {
    const h = await harness(f);
    h.put(name, name.includes('preparation') ? f.status.preparationEnvelope : f.status.authorizationEnvelope);
    assert.throws(() => h.config.installProductionProposalObservation(f.status, D), /lack their qualification/);
    assert.equal(h.writes.length, 0, 'installation cannot repair an orphan proof namespace');
  }
  const h = await harness(f);
  const otherB = clone(f.status.historicalImplementationStatus.qualificationEnvelope.body);
  otherB.receiptId = 'TEST-ONLY-another-B-qualification';
  h.put('implementation-qualification.json', f.issue(otherB));
  assert.throws(() => h.config.installProductionProposalObservation(f.status, D), /retained original B/);
  assert.equal(h.writes.length, 0);
});

test('D refuses an empty configuration volume without publishing files or starting a child', async () => {
  const f = fixture(), h = await harness(f); h.files.clear();
  await assert.rejects(h.start('status'), /absent/);
  await assert.rejects(h.command('status'), /absent/);
  assert.equal(h.writes.length, 0); assert.equal(h.spawns.length, 0);
  assert.equal(h.trace.includes('remote-status'), false); assert.equal(h.trace.includes('open'), false);
});

test('actual D cannot start or open a driver without its proof, with wrong proof, or before its command authorization', async () => {
  for (const command of ['status', 'prepare-proposal-observation', 'consume-proposal-observation']) {
    const f = fixture(), h = await harness(f);
    await assert.rejects(h.start(command, { GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: undefined }));
    assert.equal(h.writes.length, 0); assert.equal(h.spawns.length, 0);
  }
  for (const command of ['consume-proposal-observation', 'run']) {
    const f = fixture({ stage: 'qualified' }), h = await harness(f, { installed: true });
    await assert.rejects(h.start(command)); await assert.rejects(h.command(command));
    assert.equal(h.writes.length, 0); assert.equal(h.spawns.length, 0); assert.equal(h.sourceCalls.length, 0);
    assert.equal(h.trace.includes('open'), false);
  }
  const f = fixture(), h = await harness(f, { installed: true });
  await assert.rejects(h.command('consume-proposal-observation', { proposalObservationProof: undefined }));
  assert.equal(h.trace.includes('open'), false);
});

test('parent independently matches every signed D source fact before sidecars or child spawn', async () => {
  for (const key of ['implementationCommit', 'implementationTree', 'qualification', 'qualificationEvidenceDigest', 'runId', 'rawLogsDigest']) {
    const f = fixture(), changed = clone(f.sourceResult);
    changed[key] = key === 'qualification' ? { ...changed.qualification, commentId: 999 } : 'different-' + key;
    const h = await harness(f, { sourceResult: changed });
    await assert.rejects(h.start('consume-proposal-observation'), /differs from signed qualification/);
    assert.equal(h.writes.length, 0); assert.equal(h.spawns.length, 0);
  }
  const f = fixture(), h = await harness(f, { failSource: true });
  await assert.rejects(h.start('status'), /independent source refused/);
  assert.equal(h.writes.length, 0); assert.equal(h.spawns.length, 0);
});

test('parent and child each verify D before one bounded recovery, with no automatic run or attempt five', async () => {
  const f = fixture(), h = await harness(f);
  assert.equal((await h.start('consume-proposal-observation')).status, 'finished');
  assert.equal(h.sourceCalls.length, 1); assert.ok(h.trace.indexOf('source') < h.trace.indexOf('publish'));
  assert.ok(h.trace.indexOf('publish') < h.trace.indexOf('spawn'));
  const result = await h.command('consume-proposal-observation');
  assert.deepEqual(result, { status: 'recovered', recovered: true, attemptNumber: 4,
    disposition: 'invalid', additionalModelCalls: 0 });
  assert.equal(h.sourceCalls.length, 2, 'child does not trust parent network verification');
  assert.deepEqual(h.driverCalls, ['consumeProposalObservation']);
  assert.equal(h.trace.filter(item => item === 'open').length, 1);
  for (const [file, bytes] of h.originalBytes) assert.equal(h.files.get(file), bytes);
  const before = h.driverCalls.length;
  await assert.rejects(h.command('run'), /remaining experiment/);
  assert.equal(h.driverCalls.length, before, 'recovery permission never authorizes remainder');
});

test('child refuses freshly changed D source even when parent already installed valid proof', async () => {
  const f = fixture(), h = await harness(f, { installed: true, failSource: true });
  await assert.rejects(h.command('consume-proposal-observation'), /independent source refused/);
  assert.equal(h.trace.includes('open'), false); assert.equal(h.writes.length, 0); assert.deepEqual(h.driverCalls, []);
});

test('D whitelist forwards only the public proof and actual image; command selectors and seeds are refused', async () => {
  const f = fixture(), h = await harness(f);
  const env = { GK_PRODUCTION_COMMAND: 'consume-proposal-observation', RAILWAY_GIT_COMMIT_SHA: D,
    GK_PRODUCTION_SOURCE_COMMIT: A, GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: h.proof,
    TRUEFORGE_API_KEY: 'TEST-ONLY-provider-secret', DATABASE_URL: 'TEST-ONLY-database-secret',
    GK_TFY_PAT: 'TEST-ONLY-relay-secret', NODE_OPTIONS: '--require=untrusted' };
  const spec = h.bootstrap.productionChildSpec(env);
  assert.deepEqual(spec.options.env, { PATH: '/usr/local/bin:/usr/bin:/bin', NODE_ENV: 'production',
    GK_PRODUCTION_SOURCE_COMMIT: D, GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: h.proof });
  assert.equal(spec.options.shell, false); assert.equal(spec.args.at(-1), 'consume-proposal-observation');
  for (const extra of [{ GK_PRODUCTION_OPERATION_ID: 'TEST-ONLY-another-operation' },
    { GK_PRODUCTION_CONFIG_B64: 'AAAA' }, { GK_PRODUCTION_BOOTSTRAP_B64: 'AAAA' },
    { GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: 'x'.repeat(32769) },
    { GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: '{invalid' },
    { GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: JSON.stringify({ ...f.sourceDescriptor, privateToken: 'TEST-ONLY-private' }) },
    { RAILWAY_GIT_COMMIT_SHA: B }]) assert.throws(() => h.bootstrap.productionChildSpec({ ...env, ...extra }));
  for (const command of ['init', 'prepare-baseline', 'continue-baseline'])
    assert.throws(() => h.bootstrap.productionChildSpec({ ...env, GK_PRODUCTION_COMMAND: command }));
  await assert.rejects(h.command('consume-proposal-observation', { operationId: 'TEST-ONLY-selector' }), /operation argument/);
  assert.equal(h.bootstrap.productionChildSpec({ GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF: h.proof }), null);
});

test('qualification-only prepare does not publish old status files and logs no original text or runtime IDs', async () => {
  const f = fixture({ stage: 'qualified' }), h = await harness(f);
  assert.equal((await h.start('prepare-proposal-observation')).status, 'finished');
  assert.deepEqual(h.writes, [ROOT + '/proposal-observation-qualification.json']);
  const result = await h.command('prepare-proposal-observation');
  assert.deepEqual(h.driverCalls, ['prepareProposalObservation']); assert.equal(h.writes.length, 1);
  assert.equal(h.sourceCalls.length, 2);
  for (const [file, bytes] of h.originalBytes) assert.equal(h.files.get(file), bytes);
  const publicResult = h.launcher.productionLogResult('prepare-proposal-observation', result);
  assert.deepEqual(publicResult, { status: 'prepared', action: 'original-fourth-observed-without-new-calls',
    qualificationDigest: f.preparationEnvelope.body.qualificationDigest,
    preparedProofDigest: digest(f.preparationEnvelope), retainedDigest: digest(f.preparationEnvelope.body.retained),
    settlementDigest: digest(f.preparationEnvelope.body.settlementSerialized), additionalModelCalls: 0 });
  const output = JSON.stringify(publicResult);
  for (const marker of [f.observedText, f.preparationEnvelope.signature, 'TEST-ONLY-original-session',
    'TEST-ONLY-original-turn', 'TEST-ONLY-fourth-operation', f.config.authority.token, f.config.readToken])
    assert.equal(output.includes(marker), false);
  const malformed = clone(result); malformed.preparedProof.body.qualificationDigest = f.observedText;
  assert.throws(() => h.launcher.productionLogResult('prepare-proposal-observation', malformed), /qualification digest/);
});

test('authorized remainder still fails in the actual driver before ordinary work when local observation linkage is incomplete', async () => {
  const f = fixture({ allowRemainingExperiment: true }), calls = [];
  const host = { async requireProposalObservationComplete() { calls.push('link'); throw new Error('TEST-ONLY linkage incomplete'); },
    async inspect() { assert.fail('ordinary host inspection must follow completed linkage'); },
    async status() { assert.fail('ordinary outcome cannot precede completed linkage'); } };
  const remote = new Proxy({}, { get() { assert.fail('no remote capability may be read before completed linkage'); } });
  const driver = createProductionDriver({ host, remote, bundle: f.bundle,
    implementation: { binding: f.bundle.binding, sourceCommit: D, status: f.status } });
  const h = await harness(f, { installed: true, realDriver: driver });
  await assert.rejects(h.command('run'), /linkage incomplete/);
  assert.deepEqual(calls, ['link']); assert.equal(h.writes.length, 0);
  assert.equal(h.sourceCalls.length, 1); assert.equal(h.trace.filter(item => item === 'open').length, 1);
});
