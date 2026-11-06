/** Observability only: never accepts an exception, payload, URL or environment.
 * Each process/request owns an unrelated diagnostic ID, not a private operation
 * identifier. A broken log sink cannot authorize, retry, or fail an operation. */
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const COMPONENTS = new Set(['production-entrypoint', 'authority-client']);
const STAGES = new Set(['startup', 'preflight-status', 'gateway-start', 'requested-command',
  'shutdown', 'request', 'response-read', 'response-decode', 'response-contract', 'complete']);
const OUTCOMES = new Set(['started', 'finished', 'failed', 'held', 'disabled']);
const REASONS = new Set(['aborted', 'transport-unresolved', 'authority-refused', 'response-invalid',
  'response-too-large', 'response-contract-invalid', 'startup-incomplete', 'child-held']);
const METHODS = new Set(['sessions.create', 'sessions.createTurn', 'sessions.getTurn',
  'sessions.listTurnEvents', 'evaluation.issue', 'novelty.issue', 'gateway.admit', 'gateway.settle',
  'managedGate', 'fitFeedback', 'activation', 'noveltyDecision', 'reconcileUsage',
  'operationReconciliation', 'implementationStatus', 'prepareBaselineContinuation', 'prepareProposalObservation']);
const COMMANDS = new Set(['init', 'run', 'resume-review', 'reconcile-usage', 'reconcile-operation',
  'status', 'prepare-baseline', 'continue-baseline', 'prepare-proposal-observation', 'consume-proposal-observation']);

export function createOperationalDiagnostic({ component, emit = line => console.log(line) } = {}) {
  // Do not stringify unknown values, even while reporting bad input.
  if (!COMPONENTS.has(component) || typeof emit !== 'function') return () => {};
  let diagnosticId, started;
  try { diagnosticId = randomUUID(); started = performance.now(); }
  catch { return () => {}; }
  let sequence = 0;
  return (stage, outcome, fields = {}) => {
    try {
      if (!STAGES.has(stage) || !OUTCOMES.has(outcome) || sequence >= 32) return;
      const event = { schema: 'gk-operational-diagnostic-v1', component, diagnosticId,
        sequence: ++sequence, stage, outcome, at: new Date().toISOString(),
        elapsedMs: Math.max(0, Math.min(86400000, Math.floor(performance.now() - started))) };
      // Only fixed enums and bounded numbers are copied. Read each once, so a
      // changing getter cannot substitute secret text after validation. Ignore
      // error/message/stack/cause, headers, payloads and private identifiers.
      if (fields && typeof fields === 'object') {
        const { method, command, reason, httpStatus, responseBytes } = fields;
        if (METHODS.has(method)) event.method = method;
        if (COMMANDS.has(command)) event.command = command;
        if (REASONS.has(reason)) event.reason = reason;
        if (Number.isInteger(httpStatus) && httpStatus >= 100 && httpStatus <= 599)
          event.httpStatus = httpStatus;
        if (Number.isSafeInteger(responseBytes) && responseBytes >= 0)
          event.responseBytes = Math.min(responseBytes, 16 * 1024 * 1024);
      }
      const pending = emit('GK_OPERATION_DIAGNOSTIC ' + JSON.stringify(event));
      // Tests may inject an asynchronous sink; absorb its failure as well.
      if (pending && typeof pending.then === 'function') Promise.resolve(pending).catch(() => {});
    } catch { /* Diagnostics must not change application control flow. */ }
  };
}
