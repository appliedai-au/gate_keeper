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
import { canonical, configuration, copy, digest, identifier, record, requireThat, text } from './contracts.mjs';
import { LearningController } from './controller.mjs';
import { DispatchLedger } from './dispatch-ledger.mjs';
import { createLearningExecutor } from './executor.mjs';
import { FileJournal } from './journal.mjs';
import { OperationArchive } from './operation-archive.mjs';
import { statusView } from './prompts.mjs';
import { dispatchManagedOperation } from './runtime.mjs';

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
    'caseInputs', 'authorities', 'gateway'], ['clock', 'timing'], 'host options');
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
  return { directory, repositoryRoot, config, trust, runtime, caseInputs, clock,
    client: options.client, authorities, timing,
    admit: options.gateway.admit, settle: options.gateway.settle };
}

function compose(prepared, createDirectories) {
  const p = prepared;
  const controllerJournal = new FileJournal({ directory: join(p.directory, 'controller'),
    repositoryRoot: p.repositoryRoot, create: createDirectories });
  const dispatchJournal = new FileJournal({ directory: join(p.directory, 'dispatch'),
    repositoryRoot: p.repositoryRoot, create: createDirectories });
  const controller = new LearningController({ journal: controllerJournal, trust: p.trust, clock: p.clock });
  const operationId = (kind, attemptId) => `operation-${digest({ experimentId: p.config.experimentId, kind, attemptId })}`;
  const archiveFor = (id, create = false) => new OperationArchive({ journal: new FileJournal({
    directory: join(p.directory, 'operations', digest({ operationId: id })), repositoryRoot: p.repositoryRoot, create,
  }) });
  let ledger = null, busy = false;

  async function bound() {
    const state = await controller.state();
    requireThat(canonical(state.config) === canonical(p.config), 'host configuration changed on reopen');
    ledger ??= new DispatchLedger({ journal: dispatchJournal,
      experimentId: p.config.experimentId, configDigest: state.configDigest });
    const dispatch = await ledger.read();
    for (const operation of state.operations) {
      const entry = dispatch.entries.find(item => item.operation.id === operation.id);
      requireThat(entry && entry.operation.requestDigest === operation.requestDigest,
        'controller operation has no matching durable dispatch intent');
      if (operation.settled && !operation.reconciliationOnly &&
          (operation.evidenceComplete || operation.observedFreshCalls > 0 || operation.actualCalls > 0)) {
        const archived = await archiveFor(operation.id).read();
        requireThat(archived.operation?.id === operation.id && archived.operation.leaseId === operation.leaseId &&
          archived.operation.requestDigest === operation.requestDigest &&
          digest(archived.request) === operation.requestDigest,
        'recorded execution archive is missing or differs from the operation');
      }
    }
    for (const entry of dispatch.entries.filter(item => item.resolution)) {
      const held = state.operations.find(item => item.id === entry.operation.id);
      requireThat(entry.resolution.kind === 'not-admitted' ? !held :
        held?.settled && held.settlementReceiptId === entry.resolution.receiptId,
      'dispatch resolution disagrees with controller evidence');
    }
    return { state, dispatch };
  }

  async function status() {
    const { state, dispatch } = await bound();
    const pending = dispatch.pending;
    const stage = pending ? pending.notAdmitted ? 'not-admitted-observed' :
      pending.settlement ? 'settlement-observed' : pending.admission ? 'admission-observed' : 'admission-intent' : null;
    return { ...statusView(state), pendingOperation: pending?.operation.id ||
      state.operations.find(item => !item.settled)?.id || null,
    dispatch: { pending: pending ? { operationId: pending.operation.id, kind: pending.operation.kind, stage } : null,
      completed: dispatch.entries.filter(item => item.resolution).length } };
  }

  async function exclusive(work) {
    requireThat(!busy, 'another host mutation is in progress');
    busy = true;
    try { return await work(); }
    finally { busy = false; }
  }

  async function idle() {
    const result = await bound();
    requireThat(!result.dispatch.pending && !result.state.operations.some(item => !item.settled),
      'dispatch or billing unresolved; inspect and reconcile without retry');
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
      gatewayId: state.trustPins.gatewayId, provider: 'truefoundry', global: true,
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

  const host = Object.freeze({
    status,
    async inspect() { return copy(await bound()); },
    async inspectOperation(id) {
      identifier(id, 'operationId');
      const { dispatch } = await bound();
      requireThat(dispatch.entries.some(item => item.operation.id === id), 'unknown dispatch operation');
      try {
        const archive = await archiveFor(id).read();
        return { operationId: id, status: archive.operation ? 'recorded' : 'unclaimed', archive };
      } catch (error) {
        if (error.code === 'JOURNAL_DIRECTORY_MISSING') return { operationId: id, status: 'missing', archive: null };
        throw error;
      }
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
    async dispatch(kind, attemptId = null) {
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
      objectFields(value, ['operationId', 'reason'], ['admissionEnvelope', 'settlementEnvelope'], 'host recovery');
      const recovery = original(value);
      identifier(recovery.operationId, 'recovery operationId'); text(recovery.reason, 'recovery reason', 2000);
      return exclusive(async () => {
        let { state, dispatch } = await bound();
        const entry = dispatch.pending;
        requireThat(entry?.operation.id === recovery.operationId, 'matching pending dispatch required');
        let held = state.operations.find(item => item.id === recovery.operationId);
        const admission = recovery.admissionEnvelope ?? (entry.admission ? parsedEnvelope(entry.admission) : null);
        requireThat(admission, 'independent admission reconciliation receipt required');
        const checked = gatewayReceipt(admission, 'gk-learning-v2-operation-lease', state, {
          ...entry.operation, model: state.config.model, managedGateDigest: state.gate?.digest,
          namespaceExclusive: true, providerLimitEnforced: true,
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
              namespaceExclusive: true, providerLimitEnforced: true,
            });
            authenticated = true;
          } catch { /* An unauthenticated observation never establishes a reservation. */ }
          requireThat(!authenticated, 'an authenticated admission requires settlement, not non-admission');
        }
        await observe(entry.operation.id, 'not-admitted', checked.signed);
        if (entry.operation.attemptId !== null) {
          const attempt = state.attempts.find(item => item.id === entry.operation.attemptId);
          requireThat(attempt, 'non-admitted attempt missing');
          if (attempt.status !== 'unresolved') await controller.abandonAttempt(attempt.id,
            'Independent gateway confirmed that this request was not admitted.');
        }
        await ledger.complete(entry.operation.id, { kind: 'not-admitted', receiptId: checked.body.receiptId });
        return status();
      });
    },
  });
  return { host, controller, controllerJournal, dispatchJournal, bound };
}

/** Create the two durable stores once, then reopen with directory creation off. */
export async function initializeLearningHost(options, initial) {
  objectFields(initial, ['budgetEnvelope'], ['history'], 'host initialization');
  const captured = original(initial), prepared = prepare(options);
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
