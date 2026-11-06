/**
 * Durable composition for one managed learning experiment. No CLI, environment
 * discovery, signing, deployment, automatic next-cycle loop or retry is added.
 * The host supplies the admitted SDK client and independent gateway/issuers.
 * Paths and logical operation IDs are stable across process restarts. A durable
 * dispatch intent precedes gateway admission, including its ambiguous window.
 */
import { createHash, createPublicKey } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { verifyEnvelope } from '../learning-trust.mjs';
import { canonical, configuration, copy, digest, identifier, procedure, procedureFingerprint,
  record, requireThat, text } from './contracts.mjs';
import { LearningController } from './controller.mjs';
import { DispatchLedger } from './dispatch-ledger.mjs';
import { createLearningExecutor } from './executor.mjs';
import { FileJournal } from './journal.mjs';
import { OperationArchive } from './operation-archive.mjs';
import { statusView } from './prompts.mjs';
import { dispatchManagedOperation } from './runtime.mjs';
import { turnInputDigest } from './trueforge-turn.mjs';
import { verifyImplementationStatus } from './implementation-proof.mjs';
import { createOriginalBaselinePacket, validateOriginalBaselinePacket, initializeBaselineContinuation,
  readBaselineContinuation, startBaselineContinuation } from './baseline-continuation.mjs';
import { PROPOSAL_OBSERVATION_STATUS, verifyProposalObservationStatus } from './proposal-observation-proof.mjs';
import { createOriginalProposalPacket, initializeProposalObservation, readProposalObservation,
  consumeProposalObservation } from './proposal-observation.mjs';

const KINDS = ['baseline', 'proposal', 'screen', 'confirmation'];
const sha = value => createHash('sha256').update(value).digest('hex');
const contains = (parent, child) => {
  const path = relative(parent, child);
  return path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));
};

// Signature verification uses the original body property order. Strict JSON
// validation must not canonical-copy an envelope before the verifier sees it.
function original(value) {
  canonical(value);
  return JSON.parse(JSON.stringify(value));
}

function envelope(value) {
  record(value, ['body', 'signature'], 'host receipt envelope');
  return original(value);
}

function parsedEnvelope(serialized) {
  let value;
  try { value = JSON.parse(serialized); }
  catch { requireThat(false, 'stored gateway observation is not an envelope'); }
  return envelope(value);
}

function objectFields(value, required, optional, name) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value), `${name}: expected object`);
  const keys = Reflect.ownKeys(value);
  requireThat(required.every(key => keys.includes(key)) &&
    keys.every(key => [...required, ...optional].includes(key)), `${name}: unexpected or missing fields`);
  record(value, keys, name);
}

function prepare(options) {
  objectFields(options, ['directory', 'repositoryRoot', 'config', 'trust', 'client', 'runtime',
    'caseInputs', 'authorities', 'gateway'], ['clock', 'timing', 'implementation'], 'host options');
  const config = configuration(options.config);
  const trust = copy(options.trust), runtime = copy(options.runtime), caseInputs = copy(options.caseInputs);
  requireThat(typeof options.directory === 'string' && isAbsolute(options.directory) &&
    typeof options.repositoryRoot === 'string' && isAbsolute(options.repositoryRoot), 'absolute host paths required');
  const directory = resolve(options.directory), repositoryRoot = resolve(options.repositoryRoot);
  requireThat(!contains(directory, repositoryRoot) && !contains(repositoryRoot, directory),
    'host private directory and repository must be disjoint');
  record(options.gateway, ['admit', 'settle'], 'host gateway');
  requireThat(typeof options.gateway.admit === 'function' && typeof options.gateway.settle === 'function',
    'independent gateway callbacks required');
  const clock = options.clock ?? (() => Date.now());
  requireThat(typeof clock === 'function', 'host clock required');
  record(trust, ['evaluation', 'novelty', 'budget', 'activation'], 'host trust');
  for (const role of ['evaluation', 'novelty', 'budget', 'activation']) {
    let key;
    try { key = createPublicKey(trust[role].publicKeyPem); }
    catch { requireThat(false, `${role} host public key invalid`); }
    requireThat(key.asymmetricKeyType === 'ed25519' &&
      sha(key.export({ type: 'spki', format: 'der' })) === trust[role].pinnedFingerprint,
    `${role} host public key differs from pin`);
  }
  requireThat(digest(runtime) === config.runtimeDigest && runtime.model?.name === config.model &&
    sha(config.baseInstructions) === config.firstPassInstructionsDigest, 'host runtime or BASE differs from configuration');
  requireThat(Array.isArray(caseInputs) && caseInputs.length === config.cases.length &&
    config.cases.every(item => caseInputs.some(input => input.caseId === item.caseId)), 'host case coverage differs');
  record(options.authorities, ['evaluation', 'novelty'], 'host authorities');
  const authorities = {};
  for (const role of ['evaluation', 'novelty']) {
    record(options.authorities[role], ['publicKeyPem', 'pinnedFingerprint', 'issue'], `${role} host authority`);
    const supplied = options.authorities[role];
    requireThat(supplied.pinnedFingerprint === trust[role].pinnedFingerprint &&
      supplied.publicKeyPem === trust[role].publicKeyPem, `${role} host issuer differs from trust`);
    requireThat(typeof supplied.issue === 'function', `${role} host issuer unavailable`);
    authorities[role] = { publicKeyPem: supplied.publicKeyPem,
      pinnedFingerprint: supplied.pinnedFingerprint, issue: supplied.issue };
  }
  const suppliedTiming = options.timing ?? {};
  objectFields(suppliedTiming, [], ['clock', 'pause', 'timeoutMs', 'pollIntervalMs'], 'host timing');
  const timing = Object.fromEntries(Object.keys(suppliedTiming).map(key => [key, suppliedTiming[key]]));
  let implementation = null;
  if (options.implementation) {
    record(options.implementation, ['binding', 'sourceCommit', 'status'], 'host implementation');
    const value = options.implementation;
    requireThat(value.binding.experimentId === config.experimentId && value.binding.sourceCommit === config.sourceCommit,
      'host implementation changed original experiment');
    implementation = { binding: copy(value.binding), sourceCommit: value.sourceCommit,
      status: (value.status.schema === PROPOSAL_OBSERVATION_STATUS ? verifyProposalObservationStatus : verifyImplementationStatus)(value.status, { binding: value.binding, trust,
        implementationCommit: value.sourceCommit }) };
  }
  return { directory, repositoryRoot, config, trust, runtime, caseInputs, clock,
    client: options.client, authorities, timing, implementation,
    admit: options.gateway.admit, settle: options.gateway.settle };
}

function compose(prepared, createDirectories) {
  const p = prepared;
  const observationImplementation = p.implementation?.status.schema === PROPOSAL_OBSERVATION_STATUS;
  const historicalImplementation = observationImplementation ? {
    status: p.implementation.status.historicalImplementationStatus,
    sourceCommit: p.implementation.status.historicalImplementationStatus.qualificationEnvelope.body.implementationCommit,
  } : p.implementation;
  const controllerJournal = new FileJournal({ directory: join(p.directory, 'controller'),
    repositoryRoot: p.repositoryRoot, create: createDirectories });
  const dispatchJournal = new FileJournal({ directory: join(p.directory, 'dispatch'),
    repositoryRoot: p.repositoryRoot, create: createDirectories });
  const controller = new LearningController({ journal: controllerJournal, trust: p.trust, clock: p.clock });
  const operationId = (kind, attemptId) => `operation-${digest({ experimentId: p.config.experimentId, kind, attemptId })}`;
  const originalJournalFor = (id, create = false) => new FileJournal({
    directory: join(p.directory, 'operations', digest({ operationId: id })), repositoryRoot: p.repositoryRoot, create,
  });
  const archiveFor = (id, create = false) => new OperationArchive({ journal: originalJournalFor(id, create) });
  const continuationJournalFor = (id, create = false) => new FileJournal({
    directory: join(p.directory, 'baseline-continuations', digest({ operationId: id })),
    repositoryRoot: p.repositoryRoot, create,
  });
  const continuationOptions = (id, link, create = false) => ({ originalJournal: originalJournalFor(id),
    continuationJournal: continuationJournalFor(id, create), link, binding: p.implementation?.binding,
    trust: p.trust, implementationCommit: historicalImplementation?.sourceCommit });
  const observationJournalFor = (id, create = false) => new FileJournal({
    directory: join(p.directory, 'proposal-observations', digest({ operationId: id })),
    repositoryRoot: p.repositoryRoot, create,
  });
  const observationOptions = (id, create = false) => ({ controllerJournal, dispatchJournal,
    originalJournal: originalJournalFor(id), observationJournal: observationJournalFor(id, create),
    binding: p.implementation.binding, trust: p.trust, runtime: p.runtime,
    implementationCommit: p.implementation.sourceCommit, status: p.implementation.status, clock: p.clock });
  function authorizedImplementation() {
    if (observationImplementation) verifyProposalObservationStatus(p.implementation.status, {
      binding: p.implementation.binding, trust: p.trust, implementationCommit: p.implementation.sourceCommit,
      requireAuthorization: true, requireRemainder: true });
    else if (p.implementation) requireThat(p.implementation.status.authorizationEnvelope !== null,
      'qualified host implementation allows prepare/status only until owner continuation authorization');
  }
  let ledger = null, busy = false;

  async function bound() {
    const state = await controller.state();
    requireThat(canonical(state.config) === canonical(p.config), 'host configuration changed on reopen');
    ledger ??= new DispatchLedger({ journal: dispatchJournal,
      experimentId: p.config.experimentId, configDigest: state.configDigest });
    const dispatch = await ledger.read();
    if (p.implementation) requireThat(p.implementation.binding.configDigest === state.configDigest,
      'host implementation differs from original frozen configuration');
    if (state.baselineNonAdmission) {
      const marker = state.baselineNonAdmission;
      record(marker, ['operationId', 'requestDigest', 'receiptId', 'receiptDigest'],
        'baseline non-admission marker');
      const entry = dispatch.entries.find(item => item.operation.id === marker.operationId);
      requireThat(state.baselineError && !state.baseline &&
        !state.operations.some(item => item.kind === 'baseline') &&
        entry?.operation.kind === 'baseline' && entry.operation.attemptId === null &&
        entry.operation.requestDigest === marker.requestDigest &&
        entry.observations.some(item => item.kind === 'not-admitted' &&
          digest(item.serialized) === marker.receiptDigest) &&
        state.receipts.includes(marker.receiptId),
      'baseline non-admission marker lacks matching retained evidence');
      requireThat(!entry.resolution || (entry.resolution.kind === 'not-admitted' &&
        entry.resolution.receiptId === marker.receiptId && entry.notAdmitted !== null &&
        digest(entry.notAdmitted) === marker.receiptDigest), 'baseline non-admission resolution mismatch');
    }
    for (const operation of state.operations) {
      const entry = dispatch.entries.find(item => item.operation.id === operation.id);
      requireThat(entry && entry.operation.requestDigest === operation.requestDigest,
        'controller operation has no matching durable dispatch intent');
      let continuation = null;
      if (entry.baselineContinuation) {
        requireThat(historicalImplementation?.status.authorizationEnvelope,
          'continued BASE requires its qualified actual implementation on reopen');
        continuation = await readBaselineContinuation({ ...continuationOptions(operation.id, entry.baselineContinuation),
          requireComplete: operation.consumed || operation.settled });
        requireThat(digest(continuation.authorizationEnvelope) === digest(historicalImplementation.status.authorizationEnvelope),
          'host BASE continuation authorization differs from actual implementation');
        if (operation.settled) requireThat(operation.actualCalls === 14 && operation.evidenceComplete,
          'continued BASE settlement must consume all fourteen original calls');
      }
      if (operation.settled && !operation.reconciliationOnly &&
          (operation.evidenceComplete || operation.observedFreshCalls > 0 || operation.actualCalls > 0)) {
        const archived = continuation?.archive ?? await archiveFor(operation.id).read();
        requireThat(archived.operation?.id === operation.id && archived.operation.leaseId === operation.leaseId &&
          archived.operation.requestDigest === operation.requestDigest &&
          digest(archived.request) === operation.requestDigest,
        'recorded execution archive is missing or differs from the operation');
        requireThat(!archived.calls.some(call => call.stages.at(-1)?.stage === 'failure') || !operation.evidenceComplete,
          'failed original archive cannot stand in for complete continued evidence');
      }
    }
    for (const entry of dispatch.entries.filter(item => item.resolution)) {
      const held = state.operations.find(item => item.id === entry.operation.id);
      requireThat(entry.resolution.kind === 'not-admitted' ? !held :
        held?.settled && held.settlementReceiptId === entry.resolution.receiptId,
      'dispatch resolution disagrees with controller evidence');
      if (entry.resolution.kind === 'not-admitted' && entry.operation.kind === 'baseline') {
        requireThat(state.baselineNonAdmission?.operationId === entry.operation.id &&
          state.baselineNonAdmission.receiptId === entry.resolution.receiptId,
        'baseline non-admission resolution lacks controller disposition');
      }
    }
    let observation = null;
    if (observationImplementation) {
      const id = operationId('proposal', p.config.experimentId + ':attempt:4');
      let stored = null;
      try { stored = await observationJournalFor(id).read(); }
      catch (error) { if (error.code !== 'JOURNAL_DIRECTORY_MISSING') throw error; }
      if (stored?.events.length) observation = await readProposalObservation(observationOptions(id));
      else {
        requireThat(!dispatch.entries.some(entry => entry.proposalObservation), 'mandatory D sidecar missing after durable link');
        // Before consumption only the exact original four-attempt hold can
        // exist. Missing custody can never become a successful later history.
        const originalSnapshot = await originalJournalFor(id).read();
        const packet = await createOriginalProposalPacket({ state, dispatch,
          controllerSnapshot: await controllerJournal.read(), dispatchSnapshot: await dispatchJournal.read(), originalSnapshot,
          archive: await archiveFor(id).read(), binding: p.implementation.binding, runtime: p.runtime });
        if (p.implementation.status.preparationEnvelope) requireThat(
          digest(packet) === p.implementation.status.preparationEnvelope.body.retained.hostPacketDigest,
        'D original host cut changed after signed observation');
      }
      if (observation) requireThat(digest(state) === digest(observation.state) && digest(dispatch) === digest(observation.dispatch),
        'host changed while checking mandatory D linkage');
    } else requireThat(!dispatch.entries.some(entry => entry.proposalObservation),
      'historical B cannot reopen D observation history as its own implementation');
    return { state, dispatch, ...(observationImplementation ? { observation: observation ? {
      complete: observation.complete, originalArchiveHead: observation.retained.originalArchiveHead,
      qualificationDigest: observation.link.qualificationDigest, authorizationDigest: observation.link.authorizationDigest,
      preparationDigest: observation.link.preparationDigest, additionalModelCalls: 0 } : null } : {}) };
  }

  async function status() {
    const { state, dispatch } = await bound();
    const pending = dispatch.pending;
    const stage = pending ? pending.notAdmitted ? 'not-admitted-observed' :
      pending.settlement ? 'settlement-observed' : pending.admission ? 'admission-observed' : 'admission-intent' : null;
    return { ...statusView(state, { pendingOperationId: pending?.operation.id || null }),
    dispatch: { pending: pending ? { operationId: pending.operation.id, kind: pending.operation.kind, stage } : null,
      completed: dispatch.entries.filter(item => item.resolution).length } };
  }

  async function exclusive(work, { observationOnly = false } = {}) {
    requireThat(!busy, 'another host mutation is in progress');
    busy = true;
    try {
      if (observationImplementation && !observationOnly) {
        authorizedImplementation();
        requireThat((await bound()).observation?.complete, 'ordinary D mutation requires completed original fourth observation linkage');
      }
      return await work();
    }
    finally { busy = false; }
  }

  async function idle() {
    authorizedImplementation();
    const result = await bound();
    requireThat(!result.dispatch.pending && !result.state.operations.some(item => !item.settled),
      'dispatch or execution unresolved; inspect and reconcile without retry');
    return result;
  }

  async function observe(id, kind, receipt) {
    const serialized = JSON.stringify(receipt);
    const saved = await ledger.read();
    const entry = saved.entries.find(item => item.operation.id === id);
    requireThat(entry && !entry.resolution, 'pending dispatch observation required');
    // Reading an acknowledged observation is harmless; an ambiguous append is
    // never retried here. A later explicit recovery can inspect the saved bytes.
    const prior = entry.observations.findIndex(item => item.kind === kind && item.serialized === serialized);
    if (prior < 0) {
      await ledger.observe(id, kind, serialized);
    } else if (entry[kind === 'not-admitted' ? 'notAdmitted' : kind] !== serialized) {
      // An explicit recovery may select an earlier authentic receipt after a
      // later unusable observation. Keep both bytes and append the selection.
      await ledger.select(id, kind, prior);
    }
  }

  function gatewayReceipt(value, schema, state, expected) {
    const signed = envelope(value);
    const body = verifyEnvelope({ ...p.trust.budget, ...signed });
    identifier(body.receiptId, 'gateway receiptId');
    const binding = { schema, experimentId: state.config.experimentId, configDigest: state.configDigest,
      sourceCommit: state.config.sourceCommit, budgetId: state.config.budgetId,
      gatewayId: state.trustPins.gatewayId, provider: 'truefoundry', global: false,
      ceilingMicros: state.policy.programmeCeilingMicros, ...expected };
    for (const [key, value] of Object.entries(binding)) {
      requireThat(canonical(body[key]) === canonical(value), `host gateway ${key} mismatch`);
    }
    return { signed, body };
  }

  const execute = createLearningExecutor({ controller, client: p.client, runtime: p.runtime,
    caseInputs: p.caseInputs, authorities: p.authorities, timing: p.timing,
    archiveFactory: async ({ operation, request }) => {
      const { dispatch } = await bound();
      requireThat(dispatch.pending?.operation.id === operation.id &&
        dispatch.pending.operation.requestDigest === digest(request), 'archive lacks pending dispatch identity');
      return archiveFor(operation.id, true);
    } });

  async function originalBaselineCheckpoint() {
    requireThat(!observationImplementation, 'D cannot prepare historical B BASE continuation');
    requireThat(p.implementation, 'nondispatching BASE prepare requires separately qualified actual image');
    const beforeController = (await controllerJournal.read()).head, beforeDispatch = (await dispatchJournal.read()).head;
    const { state, dispatch } = await bound(), id = dispatch.pending?.operation.id;
    requireThat(id, 'original pending BASE absent');
    const originalJournal = originalJournalFor(id), beforeArchive = (await originalJournal.read()).head;
    const archive = await archiveFor(id).read();
    requireThat((await controllerJournal.read()).head === beforeController &&
      (await dispatchJournal.read()).head === beforeDispatch && (await originalJournal.read()).head === beforeArchive,
    'original host journals changed during nondispatching BASE prepare');
    return createOriginalBaselinePacket({ state, dispatch, controllerHead: beforeController, dispatchHead: beforeDispatch,
      originalArchiveHead: beforeArchive, archive, binding: p.implementation.binding, runtime: p.runtime, caseInputs: p.caseInputs });
  }

  const host = Object.freeze({
    status,
    async inspect() {
      const snapshot = await bound();
      return copy({ ...snapshot, ...(p.implementation ? { implementation: {
        frozenExperimentCommit: p.config.sourceCommit, actualPlatformCommit: p.implementation.sourceCommit,
        qualificationReceiptId: p.implementation.status.qualificationEnvelope.body.receiptId,
        continuationReceiptId: historicalImplementation.status.authorizationEnvelope?.body.receiptId ?? null,
        ...(observationImplementation ? { historicalImplementationCommit: historicalImplementation.sourceCommit,
          proposalObservationReceiptId: p.implementation.status.authorizationEnvelope?.body.receiptId ?? null } : {}) } } : {}) });
    },
    async inspectOperation(id) {
      identifier(id, 'operationId');
      const { dispatch } = await bound();
      requireThat(dispatch.entries.some(item => item.operation.id === id), 'unknown dispatch operation');
      try {
        const entry = dispatch.entries.find(item => item.operation.id === id);
        if (entry.baselineContinuation) {
          const continuation = await readBaselineContinuation(continuationOptions(id, entry.baselineContinuation));
          return { operationId: id, status: 'continued', archive: continuation.archive,
            originalArchive: continuation.original, continuation: continuation.link };
        }
        const archive = await archiveFor(id).read();
        return { operationId: id, status: archive.operation ? 'recorded' : 'unclaimed', archive };
      } catch (error) {
        if (error.code === 'JOURNAL_DIRECTORY_MISSING') return { operationId: id, status: 'missing', archive: null };
        throw error;
      }
    },
    /** Read-only host capture followed by an independent authority prepare. */
    async prepareBaselineContinuation() { return exclusive(originalBaselineCheckpoint); },
    async requireProposalObservationComplete() {
      if (!observationImplementation) return;
      authorizedImplementation();
      requireThat((await bound()).observation?.complete, 'D remainder requires complete original fourth consumed-state proof');
    },
    async prepareProposalObservation() {
      return exclusive(async () => {
        requireThat(observationImplementation, 'qualified actual D required for original fourth prepare');
        const { state, dispatch } = await bound();
        const id = operationId('proposal', p.config.experimentId + ':attempt:4');
        const c = await controllerJournal.read(), d = await dispatchJournal.read(), o = await originalJournalFor(id).read();
        const packet = await createOriginalProposalPacket({ state, dispatch, controllerSnapshot: c, dispatchSnapshot: d,
          originalSnapshot: o, archive: await archiveFor(id).read(), binding: p.implementation.binding, runtime: p.runtime });
        requireThat((await controllerJournal.read()).head === c.head && (await dispatchJournal.read()).head === d.head &&
          (await originalJournalFor(id).read()).head === o.head, 'original fourth host changed during read-only capture');
        return packet;
      }, { observationOnly: true });
    },
    async consumeProposalObservation() {
      return exclusive(async () => {
        requireThat(observationImplementation, 'qualified actual D required for original fourth consumption');
        const checked = verifyProposalObservationStatus(p.implementation.status, { binding: p.implementation.binding,
          trust: p.trust, implementationCommit: p.implementation.sourceCommit, requireAuthorization: true });
        const { state, dispatch } = await bound(), id = checked.preparationEnvelope.body.retained.operationId;
        let stored = null;
        try { stored = await observationJournalFor(id).read(); }
        catch (error) { if (error.code !== 'JOURNAL_DIRECTORY_MISSING') throw error; }
        if (!stored?.events.length) {
          const packet = await createOriginalProposalPacket({ state, dispatch, controllerSnapshot: await controllerJournal.read(),
            dispatchSnapshot: await dispatchJournal.read(), originalSnapshot: await originalJournalFor(id).read(),
            archive: await archiveFor(id).read(), binding: p.implementation.binding, runtime: p.runtime });
          await initializeProposalObservation(observationOptions(id, true), packet);
        }
        return consumeProposalObservation(observationOptions(id));
      }, { observationOnly: true });
    },
    async continueBaseline() {
      return exclusive(async () => {
        requireThat(!observationImplementation, 'D cannot replay historical B BASE continuation');
        authorizedImplementation();
        requireThat(p.implementation?.status.authorizationEnvelope, 'owner-authorized implementation required');
        const { qualificationEnvelope, authorizationEnvelope } = p.implementation.status;
        const retained = authorizationEnvelope.body.retained, id = retained.operationId;
        let { state, dispatch } = await bound();
        let held = state.operations.find(item => item.id === id), entry = dispatch.entries.find(item => item.operation.id === id);
        requireThat(held?.kind === 'baseline' && held.leaseId === retained.leaseId &&
          held.requestDigest === retained.requestDigest && held.maxCalls === 14 && entry,
        'continuation must retain the original BASE operation/lease/request');
        if (!entry.baselineContinuation) {
          const packet = await originalBaselineCheckpoint();
          const checked = validateOriginalBaselinePacket(packet, { runtime: p.runtime,
            caseInputs: p.caseInputs, originalBase: p.config.baseInstructions });
          requireThat(canonical(checked.retained) === canonical(retained),
            'actual original host checkpoint differs from independently owner-authorized state');
          const link = await initializeBaselineContinuation({ ...continuationOptions(id, null, true),
            qualificationEnvelope, authorizationEnvelope });
          requireThat((await controllerJournal.read()).head === retained.controllerHead,
            'host controller changed before durable continuation linkage');
          await ledger.linkBaselineContinuation(id, link, retained.dispatchHead);
          ({ state, dispatch } = await bound());
          held = state.operations.find(item => item.id === id); entry = dispatch.entries.find(item => item.operation.id === id);
        }
        const options = continuationOptions(id, entry.baselineContinuation);
        let saved = await readBaselineContinuation(options);
        if (entry.resolution) {
          requireThat(saved.evaluation && held.consumed && held.settled && held.actualCalls === 14 &&
            entry.resolution.kind === 'settled' && entry.resolution.receiptId === held.settlementReceiptId,
          'completed continuation replay lacks original fourteen-call settlement');
          return status(); // A replay performs no additional SDK or gateway call.
        }
        requireThat(dispatch.pending?.operation.id === id && state.attempts.length === 0,
          'another operation or attempt conflicts with original BASE continuation');
        if (!saved.started) {
          requireThat(!held.consumed && !held.settled && (await controllerJournal.read()).head === retained.controllerHead,
            'host original state changed before first continuation dispatch');
          const capability = await startBaselineContinuation(options);
          const continuationExecutor = createLearningExecutor({ controller, client: p.client, runtime: p.runtime,
            caseInputs: p.caseInputs, authorities: p.authorities, timing: p.timing,
            archiveFactory: async () => { throw new Error('GK_BASE_CONTINUATION_ARCHIVE_FALLBACK_DENIED'); },
            baselineContinuation: capability });
          await continuationExecutor({ operation: copy(held), request: copy(saved.original.request),
            receiptContext: { operationId: id, requestDigest: held.requestDigest } });
          saved = await readBaselineContinuation({ ...options, requireComplete: true });
        }
        // A restart may consume an already retained complete receipt. It may
        // never re-enter an incomplete continuation executor or retry a call.
        requireThat(saved.evaluation, 'incomplete started BASE continuation remains held without retry');
        if (!held.consumed) {
          await controller.recordBaseline(saved.evaluation);
          state = await controller.state(); held = state.operations.find(item => item.id === id);
        }
        requireThat(held.consumed && held.evidenceComplete && held.observedFreshCalls === 14,
          'continued BASE did not consume fourteen original fresh logical calls');
        const settlement = entry.settlement ? parsedEnvelope(entry.settlement) :
          envelope(await p.settle({ operationId: id, leaseId: held.leaseId, requestDigest: held.requestDigest }));
        const checked = gatewayReceipt(settlement, 'gk-learning-v2-operation-settlement', state,
          { operationId: id, leaseId: held.leaseId, status: 'settled', actualCalls: 14 });
        await observe(id, 'settlement', checked.signed);
        if (!held.settled) await controller.settleOperation(id, checked.signed);
        else requireThat(held.settlementReceiptId === checked.body.receiptId && held.actualCalls === 14,
          'continuation settlement differs from original retained receipt');
        await ledger.complete(id, { kind: 'settled', receiptId: checked.body.receiptId }, digest(JSON.stringify(checked.signed)));
        return status();
      });
    },
    async recordManagedGate(value) {
      const signed = envelope(value);
      return exclusive(async () => { await idle(); await controller.recordManagedGate(signed); return status(); });
    },
    async beginAttempt(value = null) {
      const signed = value === null ? null : envelope(value);
      return exclusive(async () => { await idle(); return controller.beginAttempt(signed); });
    },
    async abandonAttempt(id, reason) {
      identifier(id, 'attemptId'); text(reason, 'attempt abandonment reason', 2000);
      return exclusive(async () => { await idle(); await controller.abandonAttempt(id, reason); return status(); });
    },
    async activateVersion(id, value, action = 'activate') {
      const signed = envelope(value);
      return exclusive(async () => { await idle(); await controller.activateVersion(id, signed, action); return status(); });
    },
    async reconcileOperationUsage(id, value) {
      authorizedImplementation();
      identifier(id, 'usage operationId');
      requireThat(!observationImplementation || id !== p.implementation.status.preparationEnvelope?.body.retained.operationId,
        'original fourth closed observation retains its signed unknown-price settlement');
      const signed = envelope(value);
      // Accounting may catch up while an unrelated dispatch awaits recovery.
      // This cannot admit, settle, retry, or complete any dispatch operation.
      return exclusive(async () => {
        await bound();
        await controller.reconcileOperationUsage(id, signed);
        return status();
      });
    },
    /** Consume a delayed independent review of the original archived proposal.
     * This explicit recovery path neither admits nor invokes an executor. The
     * first receipt bytes and original call survive every settlement crash. */
    async resumeProposalReview(value) {
      authorizedImplementation();
      record(value, ['operationId', 'noveltyEnvelope'], 'proposal review resume');
      identifier(value.operationId, 'review operationId');
      const id = value.operationId, signed = envelope(value.noveltyEnvelope);
      return exclusive(async () => {
        let { state, dispatch } = await bound();
        const entry = dispatch.entries.find(item => item.operation.id === id);
        let held = state.operations.find(item => item.id === id);
        requireThat(entry && held?.kind === 'proposal' && held.maxCalls === 1,
          'recorded proposal operation required');
        requireThat(entry.resolution || dispatch.pending?.operation.id === id,
          'proposal review cannot replace another pending dispatch');
        const attempt = state.attempts.find(item => item.id === held.attemptId);
        requireThat(attempt, 'proposal attempt missing');
        const archive = archiveFor(id), saved = await archive.read();
        const request = saved.request;
        requireThat(saved.operation?.id === id && saved.operation.leaseId === held.leaseId &&
          saved.operation.requestDigest === held.requestDigest && digest(request) === held.requestDigest &&
          entry.operation.requestDigest === held.requestDigest && request.kind === 'proposal' &&
          request.attemptId === attempt.id && request.requiredCalls === 1 &&
          request.experimentId === state.config.experimentId && request.configDigest === state.configDigest &&
          request.sourceCommit === state.config.sourceCommit && request.runtimeDigest === state.config.runtimeDigest &&
          request.originalVersionId === state.baseVersion.id && request.incumbentVersionId === attempt.incumbentVersionId &&
          canonical(request.authorityPins) === canonical(state.trustPins) &&
          canonical(request.learner) === canonical(attempt.learner),
        'archived proposal request differs from frozen state');
        if (!held.consumed) requireThat(digest(await controller.executionRequest('proposal', attempt.id)) === held.requestDigest,
          'pending proposal plan changed');
        const { instructions, ...visible } = request.learner;
        const expectedCall = { callId: `call-${digest({ operationId: id, slot: { kind: 'proposal' } })}`,
          operationId: id, leaseId: held.leaseId, requestDigest: held.requestDigest,
          sourceCommit: state.config.sourceCommit, runtimeDigest: state.config.runtimeDigest,
          model: p.runtime.model, instructions, message: canonical(visible) };
        requireThat(saved.calls.length === 1 && canonical(saved.calls[0].call) === canonical(expectedCall),
          'one original proposal call required');
        const stages = saved.calls[0].stages, result = stages.at(-1)?.payload;
        requireThat(stages.length === 3 && stages.map(item => item.stage).join(',') === 'session,turn,final' &&
          result.callId === expectedCall.callId && result.inputDigest === turnInputDigest(expectedCall) &&
          result.complete === true && result.finishReason === 'stop' &&
          Array.isArray(result.toolCalls) && result.toolCalls.length === 0 &&
          Array.isArray(result.requiredActions) && result.requiredActions.length === 0 &&
          typeof result.text === 'string' && result.text.trim().length > 0 &&
          result.outputDigest === sha(result.text), 'complete original proposal output required');
        let output = result.text.trim();
        const fence = output.match(/^```(?:json)?\s*\n([\s\S]*?)\n```$/u);
        if (fence) output = fence[1];
        const candidate = procedure(JSON.parse(output), state.config.scope);
        const candidateDigest = procedureFingerprint(candidate);
        const references = [...state.history, ...state.attempts.filter(item => item.number < attempt.number && item.candidate)
          .map(item => ({ id: item.id, procedure: item.candidate, outcome: item.status, sourceRef: state.config.sourceCommit }))];
        requireThat(digest(references) === attempt.historyDigest &&
          !references.some(item => procedureFingerprint(item.procedure) === candidateDigest),
        'proposal review history differs or candidate is an exact duplicate');
        const body = verifyEnvelope({ ...p.trust.novelty, ...signed });
        identifier(body.receiptId, 'novelty receiptId');
        const expected = { schema: 'gk-learning-v2-novelty', experimentId: state.config.experimentId,
          configDigest: state.configDigest, sourceCommit: state.config.sourceCommit, attemptId: attempt.id,
          candidateDigest, incumbentVersionId: attempt.incumbentVersionId, originalVersionId: state.baseVersion.id,
          historyDigest: attempt.historyDigest, policyVersion: 'gk-procedure-equivalence-v1',
          sourceScopeVerified: true, operationId: id, requestDigest: held.requestDigest };
        for (const [key, expectedValue] of Object.entries(expected)) requireThat(
          canonical(body[key]) === canonical(expectedValue), `proposal review ${key} mismatch`);
        requireThat(['novel', 'equivalent', 'uncertain'].includes(body.verdict) &&
          Array.isArray(body.comparisons) && body.comparisons.length === references.length,
        'proposal review comparison coverage');
        const reviewed = new Set();
        for (const comparison of body.comparisons) {
          record(comparison, ['priorId', 'relation', 'reason'], 'proposal review comparison');
          requireThat(references.some(item => item.id === comparison.priorId) && !reviewed.has(comparison.priorId) &&
            ['distinct', 'equivalent', 'uncertain'].includes(comparison.relation), 'proposal review prior binding');
          text(comparison.reason, 'proposal review reason', 4000); reviewed.add(comparison.priorId);
        }
        const equivalent = body.comparisons.some(item => item.relation === 'equivalent');
        requireThat((body.verdict === 'equivalent') === equivalent &&
          (body.verdict !== 'novel' || !body.comparisons.some(item => item.relation !== 'distinct')),
        'proposal review verdict contradicts comparisons');
        requireThat(Array.isArray(body.coverageCaseIds) && new Set(body.coverageCaseIds).size === body.coverageCaseIds.length &&
          body.coverageCaseIds.every(caseId => state.config.cases.some(item => item.caseId === caseId &&
            item.scope === state.config.scope)), 'proposal review case coverage');
        const prior = saved.artifacts.find(item => item.id === 'novelty-receipt');
        const serialized = JSON.stringify(signed);
        let retained = signed;
        if (prior) {
          requireThat(prior.kind === 'novelty' && typeof prior.payload.serialized === 'string',
            'proposal review archive shape');
          retained = parsedEnvelope(prior.payload.serialized);
          const firstBody = verifyEnvelope({ ...p.trust.novelty, ...retained });
          requireThat(canonical(firstBody) === canonical(body), 'proposal review differs from first retained receipt');
        }
        else {
          requireThat(!held.consumed && !entry.resolution && saved.artifacts.length === 0,
            'proposal already disposed without this review');
          requireThat(!state.receipts.includes(body.receiptId), 'proposal review receipt replay');
          await archive.recordArtifact('novelty-receipt', 'novelty', { serialized });
        }
        if (!held.consumed) {
          requireThat(!state.receipts.includes(body.receiptId), 'proposal review receipt replay');
          await controller.recordProposal(attempt.id, candidate, retained);
          state = await controller.state(); held = state.operations.find(item => item.id === id);
        }
        const recorded = state.attempts.find(item => item.id === attempt.id);
        requireThat(held.consumed && recorded.candidateDigest === candidateDigest &&
          canonical(recorded.novelty) === canonical(body) && state.receipts.includes(body.receiptId),
        'proposal review was not retained as the original disposition');
        if (entry.resolution) {
          requireThat(held.settled && entry.resolution.kind === 'settled' &&
            entry.resolution.receiptId === held.settlementReceiptId, 'proposal review resolution mismatch');
          return status();
        }
        const settlement = entry.settlement ? parsedEnvelope(entry.settlement) :
          envelope(await p.settle({ operationId: id, leaseId: held.leaseId, requestDigest: held.requestDigest }));
        const checked = gatewayReceipt(settlement, 'gk-learning-v2-operation-settlement', state,
          { operationId: id, leaseId: held.leaseId, status: 'settled', actualCalls: 1 });
        await observe(id, 'settlement', checked.signed);
        if (held.settled) requireThat(checked.body.receiptId === held.settlementReceiptId &&
          checked.body.actualCalls === held.actualCalls && checked.body.actualMicros === held.actualMicros,
        'proposal review settlement differs from original evidence');
        else await controller.settleOperation(id, checked.signed);
        await ledger.complete(id, { kind: 'settled', receiptId: checked.body.receiptId });
        return status();
      });
    },
    async dispatch(kind, attemptId = null) {
      authorizedImplementation();
      requireThat(KINDS.includes(kind), 'host operation kind');
      if (kind === 'baseline') requireThat(attemptId === null, 'baseline attempt must be null');
      else identifier(attemptId, 'attemptId');
      return exclusive(async () => {
        const { state, dispatch } = await idle();
        requireThat(state.gate, 'source has no matching full managed gate receipt');
        requireThat(!state.operations.some(item => item.kind === kind && item.attemptId === attemptId) &&
          !dispatch.entries.some(item => item.operation.kind === kind && item.operation.attemptId === attemptId),
        'logical phase already attempted; no new admission or dispatch');
        if (kind === 'baseline' && !state.baselinePlan) await controller.planBaseline();
        const attempt = state.attempts.find(item => item.id === attemptId);
        if (kind === 'screen' && attempt?.status === 'ready') await controller.planScreen(attemptId);
        if (kind === 'confirmation' && attempt?.status === 'provisional') await controller.planConfirmation(attemptId);
        const expectedRequest = await controller.executionRequest(kind, attemptId);
        const id = operationId(kind, attemptId);
        await dispatchManagedOperation({ controller, kind, attemptId, operationId: id,
          admit: async ({ operation, request }) => {
            requireThat(operation.id === id && digest(request) === digest(expectedRequest), 'host admission plan changed');
            await ledger.claim(operation, request); // Durable before the gateway can reserve anything.
            const signed = envelope(await p.admit({ operation: copy(operation), request: copy(request) }));
            await observe(id, 'admission', signed);
            return signed;
          },
          execute,
          settle: async context => {
            const signed = envelope(await p.settle(copy(context)));
            await observe(id, 'settlement', signed);
            return signed;
          },
        });
        const completed = (await controller.state()).operations.find(item => item.id === id);
        requireThat(completed?.settled, 'controller settlement incomplete');
        await ledger.complete(id, { kind: 'settled', receiptId: completed.settlementReceiptId });
        return status();
      });
    },
    async recover(value) {
      authorizedImplementation();
      objectFields(value, ['operationId', 'reason'], ['admissionEnvelope', 'settlementEnvelope'], 'host recovery');
      const recovery = original(value);
      identifier(recovery.operationId, 'recovery operationId'); text(recovery.reason, 'recovery reason', 2000);
      return exclusive(async () => {
        let { state, dispatch } = await bound();
        const entry = dispatch.pending;
        requireThat(entry?.operation.id === recovery.operationId, 'matching pending dispatch required');
        requireThat(!entry.baselineContinuation, 'continued BASE cannot use generic abandonment/recovery');
        requireThat(!entry.proposalObservation && (!observationImplementation || entry.operation.attemptId !== p.config.experimentId + ':attempt:4'),
          'original fourth later observation cannot use generic abandonment/recovery');
        let held = state.operations.find(item => item.id === recovery.operationId);
        const admission = recovery.admissionEnvelope ?? (entry.admission ? parsedEnvelope(entry.admission) : null);
        requireThat(admission, 'independent admission reconciliation receipt required');
        const checked = gatewayReceipt(admission, 'gk-learning-v2-operation-lease', state, {
          ...entry.operation, model: state.config.model, managedGateDigest: state.gate?.digest,
          namespaceExclusive: true, providerLimitEnforced: false,
        });
        if (held) requireThat(checked.body.receiptId === held.leaseId && checked.body.maxCalls === held.maxCalls &&
          checked.body.reservationMicros === held.reservationMicros, 'recovery lease differs from recorded reservation');
        await observe(held?.id ?? entry.operation.id, 'admission', checked.signed);
        const settlement = recovery.settlementEnvelope ?? (entry.settlement ? parsedEnvelope(entry.settlement) : null);
        if (!held) {
          if (!settlement) return status();
          const settled = gatewayReceipt(settlement, 'gk-learning-v2-operation-settlement', state, {
            operationId: entry.operation.id, leaseId: checked.body.receiptId, status: 'settled',
          });
          await observe(entry.operation.id, 'settlement', settled.signed);
          await controller.reconcileAdmission(copy(entry.operation), checked.signed, settled.signed, recovery.reason);
          await ledger.complete(entry.operation.id, { kind: 'settled', receiptId: settled.body.receiptId });
          return status();
        }
        if (!held.consumed) await controller.abandonOperation(held.id, recovery.reason);
        state = await controller.state(); held = state.operations.find(item => item.id === held.id);
        if (!settlement) return status(); // The reservation remains held; never infer zero usage.
        const settled = gatewayReceipt(settlement, 'gk-learning-v2-operation-settlement', state, {
          operationId: held.id, leaseId: held.leaseId, status: 'settled',
        });
        await observe(held.id, 'settlement', settled.signed);
        if (held.settled) requireThat(settled.body.receiptId === held.settlementReceiptId &&
          settled.body.actualCalls === held.actualCalls && settled.body.actualMicros === held.actualMicros,
        'recovery settlement differs from recorded evidence');
        else await controller.settleOperation(held.id, settled.signed);
        await ledger.complete(held.id, { kind: 'settled', receiptId: settled.body.receiptId });
        return status();
      });
    },
    async recordNotAdmitted(value) {
      authorizedImplementation();
      const signed = envelope(value);
      return exclusive(async () => {
        const { state, dispatch } = await bound();
        const entry = dispatch.pending;
        requireThat(entry && !state.operations.some(item => item.id === entry.operation.id),
          'non-admission requires a pending intent without a controller reservation');
        const checked = gatewayReceipt(signed, 'gk-learning-v2-operation-not-admitted', state, {
          operationId: entry.operation.id, requestDigest: entry.operation.requestDigest,
          status: 'not-admitted', reservationExists: false, actualCalls: 0, actualMicros: 0,
        });
        for (const observation of entry.observations.filter(item => item.kind === 'admission')) {
          let authenticated = false;
          try {
            gatewayReceipt(parsedEnvelope(observation.serialized), 'gk-learning-v2-operation-lease', state, {
              ...entry.operation, model: state.config.model, managedGateDigest: state.gate?.digest,
              namespaceExclusive: true, providerLimitEnforced: false,
            });
            authenticated = true;
          } catch { /* An unauthenticated observation never establishes a reservation. */ }
          requireThat(!authenticated, 'an authenticated admission requires settlement, not non-admission');
        }
        if (entry.operation.attemptId === null && state.baselineNonAdmission) {
          const expected = { operationId: entry.operation.id, requestDigest: entry.operation.requestDigest,
            receiptId: checked.body.receiptId, receiptDigest: digest(JSON.stringify(checked.signed)) };
          requireThat(canonical(state.baselineNonAdmission) === canonical(expected),
            'baseline non-admission differs from recorded disposition');
        }
        await observe(entry.operation.id, 'not-admitted', checked.signed);
        if (entry.operation.attemptId !== null) {
          const attempt = state.attempts.find(item => item.id === entry.operation.attemptId);
          requireThat(attempt, 'non-admitted attempt missing');
          if (attempt.status !== 'unresolved') await controller.abandonAttempt(attempt.id,
            'Independent gateway confirmed that this request was not admitted.');
        } else if (!state.baselineNonAdmission) {
          await controller.recordBaselineNotAdmitted(copy(entry.operation), checked.signed);
        }
        await ledger.complete(entry.operation.id, { kind: 'not-admitted', receiptId: checked.body.receiptId },
          entry.operation.attemptId === null ? digest(JSON.stringify(checked.signed)) : undefined);
        return status();
      });
    },
  });
  return { host, controller, controllerJournal, dispatchJournal, bound };
}

/** Create the two durable stores once, then reopen with directory creation off. */
export async function initializeLearningHost(options, initial) {
  objectFields(initial, [], ['history', 'budgetEnvelope'], 'host initialization');
  const captured = original(initial), prepared = prepare(options);
  requireThat(prepared.implementation?.status.schema !== PROPOSAL_OBSERVATION_STATUS,
    'D cannot initialize another host experiment');
  const created = compose(prepared, true);
  const controllerBefore = await created.controllerJournal.read();
  const dispatchBefore = await created.dispatchJournal.read();
  requireThat(controllerBefore.head === null && controllerBefore.events.length === 0 &&
    dispatchBefore.head === null && dispatchBefore.events.length === 0, 'host experiment already exists or initialization is incomplete');
  await created.controller.initialize(prepared.config, { history: captured.history ?? [], budgetEnvelope: captured.budgetEnvelope });
  const state = await created.controller.state();
  await new DispatchLedger({ journal: created.dispatchJournal,
    experimentId: prepared.config.experimentId, configDigest: state.configDigest }).initialize();
  const opened = compose(prepared, false);
  await opened.bound();
  return opened.host;
}

/** Existing state is mandatory. Missing stores are never silently recreated. */
export async function openLearningHost(options) {
  const opened = compose(prepare(options), false);
  await opened.bound();
  return opened.host;
}
