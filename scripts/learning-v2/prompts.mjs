import { POLICY, canonical, copy, identifier, procedure, requireThat, text } from './contracts.mjs';
import { operationRunBalance } from './run-balance.mjs';

const RETAINED_OUTCOMES = new Set(['rejected', 'unproven', 'legacy-positive', 'duplicate', 'unresolved',
  'invalid', 'noCoverage', 'ready', 'screenPlanned', 'provisional', 'confirmationPlanned', 'confirmed']);

/** Normalized procedural memory only; never raw bank records or evaluation evidence. */
function retainedProcedureMemory(references) {
  requireThat(Array.isArray(references) && references.length <= 256 + POLICY.attempts,
    'retained procedure count');
  canonical(references);
  return references.map(reference => {
    requireThat(reference && typeof reference === 'object' && !Array.isArray(reference), 'retained reference');
    requireThat(RETAINED_OUTCOMES.has(reference.outcome), 'retained procedure outcome');
    return { outcome: reference.outcome, procedure: procedure(reference.procedure, reference.procedure?.scope) };
  });
}

/**
 * Trusted-host projection; the controller authenticates confirmation and each
 * original-baseline fit example before calling it. Bank rows are never example
 * inputs. Retained normalized procedures carry only their recorded disposition;
 * source identifiers, review reasons and evaluation evidence have no output path.
 */
export function learnerRequest({ scope, activeVersion, baselineInstructions, fitExamples = [], retainedReferences = [] }) {
  text(scope, 'fault focus', 128);
  requireThat(activeVersion && activeVersion.confirmed === true && Array.isArray(activeVersion.rules),
    'confirmed version required');
  requireThat(Array.isArray(fitExamples), 'fit examples must be an array');
  return {
    instructions: 'Propose exactly one conditional code-review procedure for the supplied fault focus. ' +
      'Return JSON with scope, languages, applicability, trigger, evidence, action, and sufficientGuard. ' +
      'State a concrete evidence test and when the existing guard is sufficient. ' +
      'Use retainedProcedures to avoid repeating or paraphrasing prior proposals; propose a substantively different procedure. ' +
      'Only confirmedProcedures are active. A legacy-positive outcome is historical, not current confirmation. ' +
      'Unproven, unresolved and in-progress outcomes do not establish benefit. ' +
      'Opaque or hash-only historical markers leave the original content unknown; never invent its meaning. ' +
      'A rejected combined rule bundle records the combined outcome without establishing isolated outcomes for its components. ' +
      'Do not include task identifiers, scores, claims of novelty, or activation instructions.',
    scope,
    baselineInstructions: text(baselineInstructions, 'baseline instructions', 100_000),
    confirmedProcedures: activeVersion.rules.map(rule => procedure(rule.procedure, scope)),
    retainedProcedures: retainedProcedureMemory(retainedReferences),
    fitExamples: fitExamples.map(example => ({ code: text(example.code, 'fit code', 50_000),
      feedback: text(example.feedback, 'fit feedback', 10_000) })),
  };
}

/** First pass is always the frozen original prompt; only pass two uses rules. */
export function reviewerInstructions({ originalInstructions, activeVersion, scope, caseId, pass }) {
  text(originalInstructions, 'original instructions', 100_000);
  requireThat(pass === 1 || pass === 2, 'invalid reviewer pass');
  if (pass === 1) return originalInstructions;
  text(caseId, 'reviewed caseId', 128);
  const applicable = activeVersion.rules.filter(rule => rule.procedure.scope === scope &&
    rule.coverageCaseIds.includes(caseId));
  if (applicable.length === 0) return originalInstructions;
  return originalInstructions + '\n\n## Review procedures\n' + applicable.map(({ procedure: rule }) =>
    `\nLanguages: ${rule.languages.join(', ')}\nApplicability: ${rule.applicability}\n` +
    `Trigger: ${rule.trigger}\nEvidence: ${rule.evidence}\nAction: ${rule.action}\n` +
    `Sufficient guard (do not report when present): ${rule.sufficientGuard}\n`).join('');
}

/** Public app read model: counts and state, never private bank text or feedback. */
export function statusView(state, { pendingOperationId = null } = {}) {
  const attempts = state.attempts || [];
  const balance = operationRunBalance(state.operations);
  // Dispatch custody also covers the crash window before controller admission
  // or after execution settlement but before dispatch closure. Do not report a
  // complete accounting record while that durable intent remains unresolved.
  if (pendingOperationId !== null) {
    identifier(pendingOperationId, 'pending dispatch operationId');
    if (!state.operations.some(item => item.id === pendingOperationId && !item.settled)) {
      balance.pendingExecutionOperations++;
    }
    balance.complete = false;
  }
  const counts = { attempted: attempts.length, scored: 0, duplicate: 0, unresolved: 0,
    invalid: 0, noCoverage: 0, rejected: 0, provisional: 0, confirmed: 0, activated: 0 };
  for (const attempt of attempts) {
    if (attempt.screen) counts.scored++;
    if (Object.hasOwn(counts, attempt.status)) counts[attempt.status]++;
    if (attempt.status === 'confirmationPlanned') counts.provisional++;
  }
  counts.activated = state.activationHistory.filter(item => item.action === 'activate').length;
  return {
    schema: 'gk-learning-v2-status', experimentId: state.config.experimentId,
    sourceCommit: state.config.sourceCommit, scope: state.config.scope,
    policy: copy(state.policy), counts,
    originalVersion: state.baseVersion.id, incumbentVersion: state.activeVersionId,
    baseline: {
      status: state.baseline ? 'complete' : state.baselineError ? 'failed' :
        state.baselinePlan ? 'planned' : 'not-planned',
      failureCode: state.baselineError ? state.baselineNonAdmission ? 'not-admitted' : 'unresolved' : null,
    },
    confirmedVersions: state.versions.filter(item => item.confirmed && item.origin !== 'frozen-base').length,
    pendingOperation: pendingOperationId || state.operations.find(item => !item.settled)?.id || null,
    budget: { ceilingMicros: state.policy.programmeCeilingMicros,
      observedSpentMicros: balance.chargedMicros, observedReservedMicros: balance.reservedMicros,
      unknownCostOperations: balance.unknownCostOperations, unknownCostCalls: balance.unknownCostCalls,
      pendingExecutionOperations: balance.pendingExecutionOperations, complete: balance.complete,
      authoritative: 'external-gateway' },
    qualification: state.gate ? 'managed-source-gate-passed' : 'source-only-unqualified',
    deployment: 'not-managed-by-learning-core',
  };
}
