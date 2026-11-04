/**
 * Concrete two-pass scheduler over the pinned TrueForge SDK boundary.
 * Receipt issuers and the global budget gateway remain independent services;
 * this module has no signing key and cannot manufacture a qualified score.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { verifyEnvelope } from '../learning-trust.mjs';
import { verifyEvaluation } from './evidence.mjs';
import { POLICY, canonical, copy, digest, hash, identifier, procedure, procedureFingerprint,
  record, requireThat, text } from './contracts.mjs';
import { LEGACY_BAG_BLOB, LEGACY_RENDERER_ID, mergeReviews, parseRawReview, parseReview, renderReview } from './legacy-renderer.mjs';
import { runTrueForgeTurn, TURN_CONFIG, turnInputDigest } from './trueforge-turn.mjs';

const bytesDigest = bytes => createHash('sha256').update(bytes).digest('hex');
const references = state => [...state.history, ...state.attempts.filter(item => item.candidate).map(item =>
  ({ id: item.id, procedure: item.candidate, outcome: item.status, sourceRef: state.config.sourceCommit }))];

function signedSnapshot(envelope) {
  record(envelope, ['body', 'signature'], 'issued envelope');
  canonical(envelope);
  // Signature bytes use original insertion order. Do not canonical-copy a
  // signed body: retain its original serialization in the private archive.
  const serialized = JSON.stringify(envelope);
  return { envelope: JSON.parse(serialized), serialized };
}

function checkRuntime(runtime, caseInputs) {
  record(runtime, ['schema', 'sdkVersion', 'serverVersion', 'provider', 'memory', 'sessionMode',
    'model', 'turnConfig', 'renderer', 'bagBlob', 'caseInputsDigest'], 'runtime manifest');
  canonical(runtime);
  record(runtime.model, ['name', 'params'], 'runtime model');
  text(runtime.model.name, 'runtime model name', 200);
  requireThat(runtime.schema === 'gk-learning-v2-runtime-v1' && runtime.sdkVersion === '0.180.0' &&
    ['0.180.0', '0.182.0'].includes(runtime.serverVersion), 'unqualified SDK or server upgrade');
  requireThat(runtime.provider === 'truefoundry' && runtime.memory === 'off' &&
    runtime.sessionMode === 'inline-root-per-call', 'runtime isolation policy');
  requireThat(canonical(runtime.turnConfig) === canonical(TURN_CONFIG), 'runtime turn configuration drift');
  requireThat(runtime.renderer === LEGACY_RENDERER_ID && runtime.bagBlob === LEGACY_BAG_BLOB,
    'unqualified renderer or rule-bag identity');
  hash(runtime.caseInputsDigest, 'case input digest');
  requireThat(Array.isArray(caseInputs) && caseInputs.length >= 2 && caseInputs.length <= 128, 'case inputs size');
  canonical(caseInputs);
  const ids = new Set();
  for (const input of caseInputs) {
    record(input, ['caseId', 'prompt'], 'model-visible case input');
    identifier(input.caseId, 'caseId');
    text(input.prompt, 'case prompt', 200_000);
    requireThat(!ids.has(input.caseId), 'duplicate model-visible case');
    ids.add(input.caseId);
  }
  requireThat(digest(caseInputs) === runtime.caseInputsDigest, 'model-visible corpus drift');
  return copy(runtime);
}

function passEvidence(result, pass, originReceiptId = null) {
  requireThat(result.complete === true && result.finishReason === 'stop' && Array.isArray(result.toolCalls) &&
    result.toolCalls.length === 0 && Array.isArray(result.requiredActions) && result.requiredActions.length === 0 &&
    typeof result.text === 'string' && result.text.trim().length > 0,
  'model turn incomplete; preserve its operation for reconciliation');
  return { pass, callId: result.callId, sessionId: result.sessionId, turnId: result.turnId,
    inputDigest: result.inputDigest, outputDigest: result.outputDigest,
    status: 'complete', finishReason: 'stop', parseValid: true, empty: false, truncated: false,
    toolCalls: 0, reused: originReceiptId !== null, originReceiptId };
}

/**
 * Host-only construction. caseInputs contains already rendered development
 * task prompts, never expected answers/negative history. The independent
 * evaluator owns its frozen oracle/scorer and must verify the supplied raw
 * provider artifacts before issuing a receipt. No authority endpoint defaults
 * or self-signing fallback are supplied.
 */
export function createLearningExecutor({ controller, client, runtime, caseInputs, archiveFactory, authorities, timing = {} }) {
  requireThat(controller && typeof controller.state === 'function' && typeof archiveFactory === 'function',
    'controller and private archive factory required');
  requireThat(timing && typeof timing === 'object' && !Array.isArray(timing), 'timing options');
  const timingKeys = ['clock', 'pause', 'timeoutMs', 'pollIntervalMs'];
  requireThat(Reflect.ownKeys(timing).every(key => timingKeys.includes(key)), 'unexpected timing option');
  const frozenTiming = {};
  for (const key of Object.keys(timing)) {
    const descriptor = Object.getOwnPropertyDescriptor(timing, key);
    requireThat(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'timing accessor');
    if (key === 'clock' || key === 'pause') requireThat(typeof descriptor.value === 'function', 'timing callback');
    else requireThat(Number.isSafeInteger(descriptor.value) && descriptor.value > 0, 'timing limit');
    frozenTiming[key] = descriptor.value;
  }
  record(authorities, ['evaluation', 'novelty'], 'independent authorities');
  for (const role of ['evaluation', 'novelty']) {
    record(authorities[role], ['publicKeyPem', 'pinnedFingerprint', 'issue'], `${role} authority`);
    hash(authorities[role].pinnedFingerprint, `${role} authority pin`);
    text(authorities[role].publicKeyPem, `${role} public key`, 16_384);
    let verifierKey;
    try { verifierKey = createPublicKey(authorities[role].publicKeyPem); }
    catch { requireThat(false, `${role} invalid authority public key`); }
    requireThat(verifierKey.asymmetricKeyType === 'ed25519' &&
      bytesDigest(verifierKey.export({ type: 'spki', format: 'der' })) === authorities[role].pinnedFingerprint,
    `${role} authority public key does not match pin`);
    requireThat(typeof authorities[role].issue === 'function', `${role} independent issuer unavailable`);
  }
  const frozenRuntime = checkRuntime(runtime, caseInputs);
  const frozenInputs = copy(caseInputs);
  const inputs = new Map(frozenInputs.map(item => [item.caseId, item]));
  // Copy authority metadata; retain only the explicitly supplied host function.
  const issuers = Object.fromEntries(['evaluation', 'novelty'].map(role => [role, {
    publicKeyPem: authorities[role].publicKeyPem, pinnedFingerprint: authorities[role].pinnedFingerprint,
    issue: authorities[role].issue,
  }]));

  return async function execute({ request: suppliedRequest, operation: suppliedOperation, receiptContext: suppliedContext }) {
    // Freeze admitted caller data before the first await. A host callback must
    // not be able to change the request after its lease digest was checked.
    const request = copy(suppliedRequest);
    const operation = copy(suppliedOperation);
    const receiptContext = copy(suppliedContext);
    const state = await controller.state();
    const held = state.operations.find(item => item.id === operation.id);
    requireThat(held && !held.consumed && !held.settled && held.leaseId === operation.leaseId &&
      held.requestDigest === operation.requestDigest, 'operation is not durably admitted');
    requireThat(digest(request) === held.requestDigest && receiptContext?.operationId === held.id &&
      receiptContext?.requestDigest === held.requestDigest, 'execution request identity drift');
    requireThat(request.configDigest === state.configDigest && request.sourceCommit === state.config.sourceCommit &&
      request.kind === held.kind && request.attemptId === held.attemptId && request.namespace === held.namespace &&
      request.requiredCalls === held.maxCalls, 'operation context drift');
    requireThat(digest(await controller.executionRequest(held.kind, held.attemptId)) === held.requestDigest,
      'controller plan changed after admission');
    requireThat(canonical(request.authorityPins) === canonical(state.trustPins), 'authority pins drift');
    for (const role of ['evaluation', 'novelty']) {
      requireThat(issuers[role].pinnedFingerprint === request.authorityPins[role], `${role} issuer substitution`);
    }
    requireThat(request.runtimeDigest === digest(frozenRuntime) && request.model === frozenRuntime.model.name &&
      request.provider === 'truefoundry' && request.memory === 'off', 'actual runtime differs from admitted manifest');
    requireThat(request.firstPassInstructionsDigest === bytesDigest(state.config.baseInstructions),
      'original first-pass instruction bytes drift');
    requireThat(frozenInputs.length === state.config.cases.length &&
      state.config.cases.every(item => inputs.has(item.caseId)), 'case-input coverage differs from experiment');
    const archive = await archiveFactory({ operation: copy(held), request: copy(request) });
    requireThat(archive && ['claimOperation', 'claimCall', 'recordCall', 'recordArtifact', 'read']
      .every(method => typeof archive[method] === 'function'), 'private operation archive unavailable');
    await archive.claimOperation(held, request);

    const callFor = (slot, rendered) => ({
      callId: `call-${digest({ operationId: held.id, slot })}`, operationId: held.id,
      leaseId: held.leaseId, requestDigest: held.requestDigest, sourceCommit: request.sourceCommit,
      runtimeDigest: request.runtimeDigest, model: copy(frozenRuntime.model),
      instructions: rendered.instructions, message: rendered.message,
    });
    const invoke = async (slot, rendered) => {
      const call = callFor(slot, rendered);
      const result = await runTrueForgeTurn({ client, call, archive, ...frozenTiming });
      requireThat(result.callId === call.callId && result.inputDigest === turnInputDigest(call) &&
        result.outputDigest === bytesDigest(result.text), 'captured turn identity drift');
      passEvidence(result, 1); // Completion only; the actual pass is set below.
      return result;
    };

    if (held.kind === 'proposal') {
      const learner = request.learner;
      record(learner, ['instructions', 'scope', 'baselineInstructions', 'confirmedProcedures', 'fitExamples'], 'learner projection');
      const { instructions, ...visible } = learner;
      const result = await invoke({ kind: 'proposal' }, { instructions, message: canonical(visible) });
      let candidate;
      try {
        let output = result.text.trim();
        const fence = output.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
        if (fence) output = fence[1];
        candidate = procedure(JSON.parse(output), state.config.scope);
      } catch {
        await archive.recordArtifact('proposal-invalid', 'proposal', { callId: result.callId, reason: 'invalid structured procedure' });
        return { procedure: null, noveltyEnvelope: null };
      }
      const history = references(state);
      const attempt = state.attempts.find(item => item.id === held.attemptId);
      requireThat(attempt && digest(history) === attempt.historyDigest, 'novelty history drift');
      const candidateDigest = procedureFingerprint(candidate);
      if (history.some(item => procedureFingerprint(item.procedure) === candidateDigest)) {
        await archive.recordArtifact('proposal-exact-duplicate', 'proposal', { candidate, callId: result.callId });
        return { procedure: candidate, noveltyEnvelope: null };
      }
      const expected = { experimentId: request.experimentId, configDigest: request.configDigest,
        sourceCommit: request.sourceCommit, attemptId: held.attemptId, candidateDigest,
        incumbentVersionId: request.incumbentVersionId, originalVersionId: request.originalVersionId,
        historyDigest: attempt.historyDigest, policyVersion: 'gk-procedure-equivalence-v1',
        sourceScopeVerified: true, operationId: held.id, requestDigest: held.requestDigest };
      const issued = signedSnapshot(await issuers.novelty.issue({ expected: copy(expected),
        candidate: copy(candidate), priorReferences: copy(history), caseInputs: copy(frozenInputs),
        coverageManifest: state.config.cases.map(({ expectedBugs, passes, ...item }) => copy(item)),
        proposalCall: copy(result) }));
      const body = verifyEnvelope({ ...issuers.novelty, body: issued.envelope.body, signature: issued.envelope.signature });
      requireThat(body.schema === 'gk-learning-v2-novelty', 'novelty issuer schema');
      for (const [key, value] of Object.entries(expected)) {
        requireThat(canonical(body[key]) === canonical(value), `novelty issuer ${key} drift`);
      }
      await archive.recordArtifact('novelty-receipt', 'novelty', { serialized: issued.serialized });
      return { procedure: candidate, noveltyEnvelope: issued.envelope };
    }

    async function evaluateArm(unboundExpected, artifact, arm, paired = null) {
      const expected = { ...copy(unboundExpected), operationId: held.id, requestDigest: held.requestDigest };
      requireThat(digest(artifact) === expected.promptDigest, 'evaluation artifact mismatch');
      const observation = { cases: [] };
      const traces = new Map();
      for (const manifest of expected.cases) {
        const caseInput = inputs.get(manifest.caseId);
        requireThat(caseInput, 'model-visible case is absent');
        const previous = paired?.traces.get(manifest.caseId);
        const applicable = expected.applicableCaseIds.includes(manifest.caseId);
        const slot = pass => ({ pairId: expected.pairId, arm, caseId: manifest.caseId, pass });
        const firstRendered = renderReview({ artifact, originalBase: state.config.baseInstructions,
          caseInput, scope: manifest.scope, pass: 1 });
        let first;
        if (paired) {
          requireThat(previous?.first && previous.first.complete &&
            turnInputDigest(callFor(slot(1), firstRendered)) === previous.first.inputDigest,
          'paired first-pass cache is missing or differs; no fallback');
          first = previous.first;
        } else first = await invoke(slot(1), firstRendered);
        const firstFindings = parseReview(first.text, caseInput.prompt);
        const secondRendered = renderReview({ artifact, originalBase: state.config.baseInstructions,
          caseInput, scope: manifest.scope, pass: 2, firstFindings });
        let second;
        if (paired && !applicable) {
          requireThat(previous?.second && previous.second.complete &&
            turnInputDigest(callFor(slot(2), secondRendered)) === previous.second.inputDigest,
          'paired off-scope cache is missing or differs; no fallback');
          second = previous.second;
        } else second = await invoke(slot(2), secondRendered);
        const secondFindings = parseRawReview(second.text);
        const mergedFindings = mergeReviews(caseInput.prompt, firstFindings, secondFindings);
        const passes = [passEvidence(first, 1, paired?.verified.receiptId || null),
          passEvidence(second, 2, paired && !applicable ? paired.verified.receiptId : null)];
        observation.cases.push({ caseId: manifest.caseId, mergedFindings, passes,
          rawTurns: [copy(first), copy(second)] });
        traces.set(manifest.caseId, { first, second });
      }
      const artifactId = `evaluation-${digest({ pairId: expected.pairId, arm })}`;
      await archive.recordArtifact(`${artifactId}-input`, 'evaluation-input', { expected, observation });
      const issued = signedSnapshot(await issuers.evaluation.issue({ expected: copy(expected), observation: copy(observation),
        runtime: copy(frozenRuntime), sourceCommit: request.sourceCommit, configDigest: request.configDigest,
        benchmarkDigest: expected.benchmarkDigest, scorerDigest: expected.scorerDigest }));
      const trust = { publicKeyPem: issuers.evaluation.publicKeyPem, pinnedFingerprint: issuers.evaluation.pinnedFingerprint };
      const verified = verifyEvaluation(issued.envelope, trust, expected);
      for (const item of observation.cases) {
        const signedCase = verified.cases.find(value => value.caseId === item.caseId);
        requireThat(signedCase && canonical(signedCase.passes) === canonical(item.passes),
          'evaluator receipt is not bound to captured model turns');
      }
      await archive.recordArtifact(`${artifactId}-receipt`, 'evaluation', { serialized: issued.serialized });
      return { envelope: issued.envelope, verified, traces };
    }

    if (held.kind === 'baseline') {
      const result = await evaluateArm(request.plan, request.prompts.base, 'base');
      return { evaluation: result.envelope };
    }
    if (held.kind === 'screen') {
      const incumbent = await evaluateArm(request.plan.incumbent, request.prompts.incumbent, 'incumbent');
      const candidate = await evaluateArm(request.plan.candidate, request.prompts.candidate, 'candidate', incumbent);
      return { incumbent: incumbent.envelope, candidate: candidate.envelope };
    }
    requireThat(held.kind === 'confirmation' && request.plan.pairs.length === POLICY.confirmationPairs &&
      request.plan.additionalPairs === 0, 'invalid confirmation plan');
    const pairs = [];
    for (const plan of request.plan.pairs) {
      const pair = {};
      for (const arm of plan.order) {
        const result = await evaluateArm(plan.expectations[arm], request.prompts[arm], arm);
        pair[arm] = result.envelope;
      }
      pairs.push(pair);
    }
    return { pairs };
  };
}
