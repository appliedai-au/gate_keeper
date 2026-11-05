/** Explicit remote entry point; importing this module never commissions it. */
import { createHash, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, copy, hash, identifier, record, requireThat, text } from './contracts.mjs';
import { FileJournal } from './journal.mjs';
import { readLegacyBank, validatePrivateHost } from './readonly-preflight.mjs';
import { freezeProductionBundle, verifyProductionBundle } from './production-bundle.mjs';
import { createDetachedAuthority } from './authority-core.mjs';
import { openAuthorityCustody } from './authority-custody.mjs';
import { createAuthorityRelay } from './authority-relay.mjs';
import { createSourceGateVerifier } from './authority-source-proof.mjs';

const CUSTODY = '/data/gk-v4-authority';
export const AUTHORITY_GATE_POLICY = Object.freeze({
  targetId: 'gatekeeper-production-learning-v4',
  // SHA256 of the complete reviewed Dockerfile.qualify bytes.
  presetDigest: 'd89425eeddad71f79bcf3db105c073e22a6d2644a0e0b8c8f809363e5df9ddfe',
  // SHA256 of gate-keeper:qualification-receipt-v1:all-tests-pass:no-skips:explicit-cleanup.
  outputProfileDigest: 'ee24ee6b8cb9e3fd945c33ed3e39c639dc311e8ae6cbba1124f2f874aa004139',
});
const tokenMatches = (actual, expected) => timingSafeEqual(
  createHash('sha256').update(actual).digest(), createHash('sha256').update(expected).digest());

export function authorityConfiguration(value) {
  record(value, ['schema', 'ownerId', 'experimentId', 'sourceCommit', 'serverVersion', 'model',
    'upstreamModelId', 'gatewayId', 'reviewerId', 'legacyBankFileDigest', 'gatePolicy'],
  'protected authority configuration');
  canonical(value);
  requireThat(value.schema === 'gk-learning-authority-config-v1' &&
    value.model === 'gk-v4-authority/glm-5-3-flash' && value.upstreamModelId === 'tfy-managed/glm-5.3-flash' &&
    ['0.180.0', '0.182.0'].includes(value.serverVersion), 'unqualified authority provider/runtime');
  for (const key of ['ownerId', 'experimentId', 'gatewayId', 'reviewerId']) identifier(value[key], key);
  hash(value.sourceCommit, 'authority deployment source', 40);
  hash(value.legacyBankFileDigest, 'authority legacy bank pin');
  record(value.gatePolicy, ['targetId', 'presetDigest', 'outputProfileDigest', 'effectiveTreeDigest'],
    'protected managed gate policy');
  for (const [key, expected] of Object.entries(AUTHORITY_GATE_POLICY)) {
    requireThat(value.gatePolicy[key] === expected, 'unqualified managed gate preset or output profile');
  }
  hash(value.gatePolicy.effectiveTreeDigest, 'qualified effective tree');
  return copy(value);
}

/** Driver transport does not expose protected decisions, relay claims or keys. */
export function createAuthorityHttpServer({ authority, token, binding }) {
  text(token, 'authority driver token', 4096);
  requireThat(token.length >= 32 && !/\s/u.test(token), 'authority driver token format');
  const methods = {
    managedGate: { keys: [], invoke: () => authority.managedGate() },
    'gateway.admit': { keys: ['operation', 'request'], invoke: args => authority.admit(args) },
    'gateway.settle': { keys: ['operationId', 'leaseId', 'requestDigest'], invoke: args => authority.settle(args) },
    'evaluation.issue': { keys: ['expected', 'observation', 'runtime', 'sourceCommit', 'configDigest',
      'benchmarkDigest', 'scorerDigest'], invoke: args => authority.issueEvaluation(args) },
    'novelty.issue': { keys: ['expected', 'candidate', 'priorReferences', 'caseInputs',
      'coverageManifest', 'proposalCall'], invoke: args => authority.issueNovelty(args) },
    fitFeedback: { keys: ['attemptId'], invoke: args => authority.fitFeedback(args) },
    activation: { keys: ['versionId', 'action'], invoke: args => authority.activation(args) },
    noveltyDecision: { keys: ['operationId'], invoke: args => authority.noveltyDecision(args) },
    reconcileUsage: { keys: ['operationId'], invoke: args => authority.reconcileUsage(args) },
    operationReconciliation: { keys: ['operationId'], invoke: args => authority.operationReconciliation(args) },
    'sessions.create': { keys: ['input'], invoke: args => authority.sdk.create(args.input) },
    'sessions.createTurn': { keys: ['sessionId', 'input'],
      invoke: args => authority.sdk.createTurn(args.sessionId, args.input) },
    'sessions.getTurn': { keys: ['sessionId', 'turnId'],
      invoke: args => authority.sdk.getTurn(args.sessionId, args.turnId) },
    'sessions.listTurnEvents': { keys: ['sessionId', 'turnId', 'input'],
      invoke: args => authority.sdk.listTurnEvents(args.sessionId, args.turnId, args.input) },
  };
  const server = createServer(async (req, res) => {
    const send = (status, body) => {
      if (res.destroyed) return;
      res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    if (req.method === 'GET' && req.url === '/healthz') { send(200, { status: 'ok' }); return; }
    if (!tokenMatches(String(req.headers.authorization || ''), 'Bearer ' + token)) {
      send(401, { error: 'GK_AUTHORITY_UNAUTHORIZED' }); return;
    }
    if (req.method === 'GET' && req.url === '/v1/gatekeeper/bootstrap') {
      send(200, authority.bundle()); return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/gatekeeper/authority' ||
      !String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) {
      send(404, { error: 'GK_AUTHORITY_ROUTE_ABSENT' }); return;
    }
    try {
      const chunks = []; let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        requireThat(size <= 8 * 1024 * 1024, 'authority request body limit');
        chunks.push(chunk);
      }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      record(input, ['binding', 'method', 'args'], 'authority RPC');
      canonical(input);
      requireThat(canonical(input.binding) === canonical(binding), 'authority RPC cross-experiment binding');
      requireThat(Object.hasOwn(methods, input.method), 'authority RPC method denied');
      const method = methods[input.method];
      record(input.args, method.keys, 'authority RPC arguments');
      const result = await method.invoke(input.args);
      send(200, { result });
    } catch (error) {
      if (error?.code === 'GK_AUTHORITY_REVIEW_PENDING') send(409, {
        error: error.code, reviewId: error.reviewId, operationId: error.operationId,
      });
      else send(409, { error: 'GK_AUTHORITY_REFUSED' });
      // SDK exceptions can contain credentials or complete task truth. Neither
      // exception text nor request bodies are emitted to public responses/logs.
    }
  });
  server.requestTimeout = 910_000;
  server.headersTimeout = 10_000;
  server.keepAliveTimeout = 5000;
  server.on('clientError', (_error, socket) => socket.destroy());
  return server;
}

async function listen(server, port) {
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '0.0.0.0', () => { server.removeListener('error', reject); resolveListen(); });
  });
}

export async function observeAuthorityServer({ baseUrl, token, expectedVersion, fetcher = fetch, observe = () => {} }) {
  const origin = validatePrivateHost(baseUrl);
  const abort = new AbortController(), timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const response = await fetcher(origin + '/healthz', { redirect: 'error', signal: abort.signal,
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' } });
    requireThat(response.ok, 'actual TrueForge health unavailable');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.byteLength; requireThat(size <= 65536, 'TrueForge health response size');
      chunks.push(Buffer.from(chunk));
    }
    const health = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    const observation = { schema: 'gk-learning-server-observation-v1',
      status: health.status === 'ok' && health.version === expectedVersion &&
        ['0.180.0', '0.182.0'].includes(health.version) ? 'ok' : 'mismatch',
      serverVersion: typeof health.version === 'string' && /^\d+\.\d+\.\d+$/u.test(health.version) ?
        health.version : null, observedAt: new Date().toISOString(), source: '/healthz' };
    observe(observation);
    requireThat(observation.status === 'ok', 'actual installed TrueForge version mismatch');
    return observation;
  } finally { clearTimeout(timer); }
}

/** Protected operator export only; numbered byte chunks survive bounded logs. */
export function emitAuthorityStatus(status, emit = console.log) {
  const bytes = Buffer.from(JSON.stringify(status));
  const sha256 = createHash('sha256').update(bytes).digest('hex'), statusId = sha256;
  const parts = Math.ceil(bytes.length / 6000);
  emit('GK_AUTHORITY_OPERATION_STATUS ' + JSON.stringify({ statusId,
    activeVersionId: status.activeVersionId, activeCallId: status.activeCallId,
    operations: status.operations.length, reviews: status.reviews.length }));
  emit('GK_AUTHORITY_STATUS_BEGIN ' + JSON.stringify({ statusId, binding: status.binding,
    bytes: bytes.length, parts, sha256 }));
  for (let index = 0; index < parts; index++) emit('GK_AUTHORITY_STATUS_PART ' + JSON.stringify({
    statusId, index, data: bytes.subarray(index * 6000, (index + 1) * 6000).toString('base64') }));
  emit('GK_AUTHORITY_STATUS_END ' + JSON.stringify({ statusId, parts, sha256 }));
}

export async function startAuthorityService({ env = process.env, repositoryRoot = '/app', emit = console.log } = {}) {
  requireThat(['initialize', 'serve'].includes(env.GK_AUTHORITY_MODE), 'explicit authority mode required');
  const config = authorityConfiguration(JSON.parse(env.GK_AUTHORITY_CONFIG || 'null'));
  requireThat(env.RAILWAY_GIT_COMMIT_SHA === config.sourceCommit, 'authority deployed source differs from frozen source');
  text(env.TRUEFORGE_TOKEN, 'existing authorized TrueForge credential', 4096);
  const baseUrl = validatePrivateHost(env.TRUEFORGE_BASE_URL);
  const verifyRuntime = () => observeAuthorityServer({ baseUrl, token: env.TRUEFORGE_TOKEN,
    expectedVersion: config.serverVersion,
    observe: observation => emit('GK_AUTHORITY_SERVER_OBSERVED ' + JSON.stringify(observation)) });
  await verifyRuntime();
  const initializing = env.GK_AUTHORITY_MODE === 'initialize';
  const custody = openAuthorityCustody({ directory: CUSTODY, repositoryRoot, initialize: initializing,
    gatewayId: config.gatewayId });
  const corpus = JSON.parse(readFileSync(resolve(repositoryRoot,
    'config/learning/concurrency-atomicity-corpus-v1.json'), 'utf8'));
  const legacyBank = readLegacyBank();
  requireThat(legacyBank.fileDigest === config.legacyBankFileDigest, 'actual historical bank changed');
  const bundle = freezeProductionBundle({ ownerId: config.ownerId, experimentId: config.experimentId,
    sourceCommit: config.sourceCommit, model: config.model, serverVersion: config.serverVersion,
    gatePolicy: config.gatePolicy, trust: custody.trust, corpus, legacyBank });
  if (initializing) custody.writeBundle(bundle);
  else requireThat(canonical(verifyProductionBundle(custody.readBundle())) === canonical(bundle),
    'protected frozen bundle cannot be replaced');
  const trustPins = { ...Object.fromEntries(['evaluation', 'novelty', 'budget', 'activation']
    .map(role => [role, bundle.trust[role].pinnedFingerprint])), gatewayId: bundle.trust.budget.gatewayId };
  emit('GK_AUTHORITY_PUBLIC_CONFIG ' + JSON.stringify({ binding: bundle.binding,
    legacyBankFileDigest: bundle.legacyBank.fileDigest, legacyBankDigest: bundle.legacyBankDigest, trustPins }));
  if (initializing) return { initialized: true };

  const driverToken = env.GK_AUTHORITY_DRIVER_TOKEN;
  text(driverToken, 'authority driver token', 4096);
  text(env.GK_TFY_PAT, 'existing authorized provider credential', 4096);
  const { TrueForge } = await import('@truefoundry/trueforge-sdk');
  const provider = new TrueForge({ baseUrl, token: env.TRUEFORGE_TOKEN,
    timeoutInSeconds: 60, maxRetries: 0 });
  const authority = await createDetachedAuthority({ bundle, signers: custody.signers,
    journal: new FileJournal({ directory: custody.ledgerDirectory, repositoryRoot }),
    artifactStore: custody.artifactStore, provider, upstreamModelId: config.upstreamModelId,
    reviewerId: config.reviewerId, verifyRuntime,
    verifySourceGate: createSourceGateVerifier({ descriptor: JSON.parse(env.GK_AUTHORITY_SOURCE_PROOF || 'null') }) });
  const snapshot = await authority.initialize();
  // A controlled review restart is safe only after independent terminal reads
  // closed the last provider call. Startup never retries a durable open intent.
  if (env.GK_AUTHORITY_REVIEW_DECISION) {
    requireThat(snapshot.activeCallId === null, 'protected review restart has active provider work');
    await authority.applyProtectedReview(JSON.parse(env.GK_AUTHORITY_REVIEW_DECISION));
    emit('GK_AUTHORITY_REVIEW_APPLIED');
  }
  if (env.GK_AUTHORITY_RECONCILIATION) {
    await authority.applyProtectedReconciliation(JSON.parse(env.GK_AUTHORITY_RECONCILIATION));
    emit('GK_AUTHORITY_OPERATION_RECONCILED');
  }
  if (env.GK_AUTHORITY_EXPORT_REVIEW) {
    const packet = await authority.reviewPacket(env.GK_AUTHORITY_EXPORT_REVIEW);
    // Explicit signed-in operator control-plane export; no private keys,
    // credential, provider rawResponse, headers or hidden check oracle.
    const bytes = Buffer.from(JSON.stringify(packet)), sha256 = createHash('sha256').update(bytes).digest('hex');
    const parts = Math.ceil(bytes.length / 6000);
    emit('GK_AUTHORITY_REVIEW_BEGIN ' + JSON.stringify({ reviewId: packet.reviewId,
      contextDigest: packet.contextDigest, bytes: bytes.length, parts, sha256 }));
    for (let index = 0; index < parts; index++) emit('GK_AUTHORITY_REVIEW_PART ' + JSON.stringify({
      reviewId: packet.reviewId, index, data: bytes.subarray(index * 6000, (index + 1) * 6000).toString('base64') }));
    emit('GK_AUTHORITY_REVIEW_END ' + JSON.stringify({ reviewId: packet.reviewId, parts, sha256 }));
  }
  if (env.GK_AUTHORITY_EXPORT_STATUS === '1') {
    emitAuthorityStatus(await authority.operatorStatus(), emit);
  }
  const relay = createAuthorityRelay({ authority, prefix: custody.relayPrefix,
    providerToken: env.GK_TFY_PAT, upstreamModelId: config.upstreamModelId });
  await listen(relay, 8787);
  try {
    const route = 'http://gk-native-runner.railway.internal:8787/' + custody.relayPrefix + '/api/llm';
    const manifest = { type: 'custom', name: 'gk-v4-authority', baseUrl: route,
      auth: { apiKey: env.GK_TFY_PAT }, models: [{ name: 'glm-5-3-flash',
        modelId: config.upstreamModelId, properties: {} }] };
    if (env.GK_AUTHORITY_REGISTER_PROVIDER === '1' && snapshot.operations.length === 0) {
      await provider.settings.modelProviders.createOrUpdate({ manifest },
        { maxRetries: 0, timeoutInSeconds: 60 });
    }
    const catalog = await provider.settings.modelProviders.list({ maxRetries: 0, timeoutInSeconds: 60 });
    requireThat(Array.isArray(catalog?.data), 'authority provider catalogue shape');
    const own = catalog.data.find(item => item.name === 'gk-v4-authority');
    requireThat(own?.manifest?.type === 'custom' && own.manifest.baseUrl === route &&
      Array.isArray(own.manifest.models) && own.manifest.models.length === 1 &&
      own.manifest.models[0].name === 'glm-5-3-flash' &&
      own.manifest.models[0].modelId === config.upstreamModelId, 'scoped provider route or model drift');
    const server = createAuthorityHttpServer({ authority, token: driverToken, binding: bundle.binding });
    await listen(server, Number(env.PORT || 8080));
    emit('GK_AUTHORITY_READY');
    return { authority, server, relay };
  } catch (error) { relay.closeAllConnections(); relay.close(); throw error; }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const running = await startAuthorityService();
    if (running.server) {
      let stopping = false;
      const shutdown = () => {
        if (stopping) return;
        stopping = true;
        running.server.close();
        running.relay.close();
        const deadline = setTimeout(() => {
          running.server.closeAllConnections();
          running.relay.closeAllConnections();
        }, 30_000);
        deadline.unref();
      };
      process.once('SIGTERM', shutdown);
      process.once('SIGINT', shutdown);
    }
  } catch {
    console.error('GK_AUTHORITY_START_REFUSED');
    process.exitCode = 2;
  }
}
