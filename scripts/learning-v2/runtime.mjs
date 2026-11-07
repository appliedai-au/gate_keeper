import { copy, digest, identifier, requireThat, record } from './contracts.mjs';

/**
 * Transport-neutral integration seam for the existing managed runner.
 * All three callbacks are trusted HOST capabilities, not agent/model tools.
 * They must not be implemented by signing the learner's own claims.
 *
 * admit: independent gateway reserves the complete operation globally.
 * execute: admitted runner invokes TrueForge/TrueFoundry with the frozen
 *          request and obtains independent novelty/evaluation receipts.
 * settle: independent gateway reconciles actual usage for that reservation.
 *
 * No default endpoint, provider client, key discovery, or retry exists here.
 * An ambiguous admission, execution or settlement needs operator reconciliation.
 */
export async function dispatchManagedOperation({
  controller, kind, attemptId = null, operationId, admit, execute, settle,
}) {
  identifier(operationId, 'operationId');
  requireThat(['baseline', 'proposal', 'screen', 'confirmation'].includes(kind), 'operation kind');
  requireThat(typeof admit === 'function' && typeof execute === 'function' && typeof settle === 'function',
    'all managed host capabilities are required');
  const request = await controller.executionRequest(kind, attemptId);
  const operation = { id: operationId, kind, attemptId, namespace: request.namespace,
    requestDigest: digest(request) };

  // The gateway must reject a duplicate logical phase across processes/volumes,
  // and admit must not start any model calls. The durable local intent precedes
  // execute. Copies stop callbacks from mutating the admitted local manifest.
  const lease = await admit({ operation: copy(operation), request: copy(request) });
  const reserved = await controller.reserveOperation(operation, lease);
  let output;
  try {
    output = await execute({ request: copy(request), operation: copy(reserved),
      receiptContext: { operationId, requestDigest: operation.requestDigest } });
  } catch (cause) {
    // Leave the reservation intact. Never settle with fabricated zero usage,
    // reissue a call, or replace a timed-out attempt with a hidden new attempt.
    throw new Error(`MANAGED_OPERATION_UNRESOLVED: ${operationId}; reconcile execution and billing`, { cause });
  }

  try {
    if (kind === 'baseline') {
      record(output, ['evaluation'], 'baseline output');
      await controller.recordBaseline(output.evaluation);
    } else if (kind === 'proposal') {
      record(output, ['procedure', 'noveltyEnvelope'], 'proposal output');
      await controller.recordProposal(attemptId, output.procedure, output.noveltyEnvelope);
    } else if (kind === 'screen') {
      record(output, ['incumbent', 'candidate'], 'screen output');
      await controller.recordScreen(attemptId, output);
    } else {
      record(output, ['pairs'], 'confirmation output');
      await controller.recordConfirmation(attemptId, output.pairs);
    }
  } catch (cause) {
    throw new Error(`MANAGED_OPERATION_UNRESOLVED: ${operationId}; evidence was not consumed`, { cause });
  }

  // A failed qualification still incurred real costs. Only the independent
  // gateway's receipt can release the unresolved billing reservation.
  const settlement = await settle({ operationId, leaseId: reserved.leaseId,
    requestDigest: operation.requestDigest });
  await controller.settleOperation(operationId, settlement);
  return controller.status();
}
