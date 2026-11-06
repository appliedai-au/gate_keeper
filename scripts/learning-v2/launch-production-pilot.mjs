/** Explicit commands only. This child receives no provider or database secrets. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, hash, identifier, requireThat } from './contracts.mjs';
import { openProductionPilot } from './production-driver.mjs';
import { PRODUCTION_DIRECTORY, PRODUCTION_REPOSITORY_ROOT, publishProductionStatus,
  readProductionConfig, parseProductionProposalObservationDescriptor, PRODUCTION_COMMANDS,
  verifyProductionImplementationForCommand, verifyProductionProposalObservationSource } from './production-config.mjs';
import { PROPOSAL_OBSERVATION_STATUS } from './proposal-observation-proof.mjs';

export async function productionCommand({ command, operationId = null, sourceCommit,
  proposalObservationProof, fetcher }) {
  requireThat(PRODUCTION_COMMANDS.includes(command), 'production command');
  requireThat(['resume-review', 'reconcile-usage', 'reconcile-operation'].includes(command) ? operationId !== null : operationId === null,
    'production operation argument');
  if (operationId !== null) identifier(operationId, 'production operationId');
  const config = readProductionConfig(sourceCommit);
  const implementation = verifyProductionImplementationForCommand({ bundle: config.bundle, sourceCommit, command,
    status: config.implementation?.status ?? null });
  const observation = implementation?.schema === PROPOSAL_OBSERVATION_STATUS;
  const descriptor = parseProductionProposalObservationDescriptor(proposalObservationProof);
  if (observation) await verifyProductionProposalObservationSource({ bundle: config.bundle, sourceCommit,
    status: implementation, descriptor, fetcher });
  else requireThat(descriptor === null, 'D source descriptor cannot substitute for A or historical B');
  const driver = await openProductionPilot({ directory: PRODUCTION_DIRECTORY,
    repositoryRoot: PRODUCTION_REPOSITORY_ROOT, bundle: config.bundle, authority: config.authority,
    initialize: command === 'init', implementation: config.implementation ?? null, ...(fetcher ? { fetcher } : {}) });
  // D reopens the original host/status configuration. Its read and recovery
  // commands never republish the original A/B commissioning files.
  if (!observation) await publishProductionStatus(config, driver);
  if (command === 'init') return { status: 'initialized', learning: await driver.status() };
  if (command === 'run') return driver.run();
  if (command === 'prepare-baseline') return driver.prepareBaselineContinuation();
  if (command === 'continue-baseline') return driver.continueBaseline();
  if (command === 'prepare-proposal-observation') return driver.prepareProposalObservation();
  if (command === 'consume-proposal-observation') return driver.consumeProposalObservation();
  if (command === 'resume-review') {
    const result = await driver.resumeProposalReview({ operationId });
    return result.status === 'advanced' ? driver.run() : result;
  }
  if (command === 'reconcile-usage') return driver.reconcileUsage({ operationId });
  if (command === 'reconcile-operation') return driver.reconcileOperation({ operationId });
  return { status: 'observed', learning: await driver.status(), implementation: observation ? {
    frozenExperimentCommit: config.bundle.binding.sourceCommit,
    historicalImplementationCommit: implementation.historicalImplementationStatus.qualificationEnvelope.body.implementationCommit,
    actualPlatformCommit: sourceCommit,
    historicalQualificationReceiptId: implementation.historicalImplementationStatus.qualificationEnvelope.body.receiptId,
    historicalContinuationReceiptId: implementation.historicalImplementationStatus.authorizationEnvelope.body.receiptId,
    qualificationReceiptId: implementation.qualificationEnvelope.body.receiptId,
    preparationReceiptId: implementation.preparationEnvelope?.body.receiptId ?? null,
    observationAuthorizationReceiptId: implementation.authorizationEnvelope?.body.receiptId ?? null,
    allowRemainingExperiment: implementation.authorizationEnvelope?.body.allowRemainingExperiment === true,
  } : {
    frozenExperimentCommit: config.bundle.binding.sourceCommit, actualPlatformCommit: sourceCommit,
    qualificationReceiptId: config.implementation?.status.qualificationEnvelope.body.receiptId ?? null,
    continuationReceiptId: config.implementation?.status.authorizationEnvelope?.body.receiptId ?? null } };
}

/** Only public digests leave the prepare command's private control-plane sink.
 * The complete signed later-read proof remains in protected custody. */
export function productionLogResult(command, result) {
  if (command !== 'prepare-proposal-observation') return result;
  requireThat(result?.status === 'prepared' && result.action === 'original-fourth-observed-without-new-calls' &&
    result.preparedProof?.body?.schema === 'gk-learning-proposal-observation-prepared-v1',
  'D prepare returned an unexpected result');
  const prepared = result.preparedProof;
  hash(prepared.body.qualificationDigest, 'D prepare qualification digest');
  return { status: 'prepared', action: 'original-fourth-observed-without-new-calls',
    qualificationDigest: prepared.body.qualificationDigest, preparedProofDigest: digest(prepared),
    retainedDigest: digest(prepared.body.retained), settlementDigest: digest(prepared.body.settlementSerialized),
    additionalModelCalls: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireThat(process.argv.length >= 3 && process.argv.length <= 4, 'production command argument count');
    const result = await productionCommand({ command: process.argv[2], operationId: process.argv[3] ?? null,
      sourceCommit: process.env.GK_PRODUCTION_SOURCE_COMMIT,
      proposalObservationProof: process.env.GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF });
    console.log('GK_PRODUCTION_PILOT ' + JSON.stringify(productionLogResult(process.argv[2], result)));
    if (['held', 'review-pending'].includes(result.status)) process.exitCode = 2;
  } catch {
    // Exception objects can carry HTTP authorization and provider data. The
    // durable private journals hold the operation identity for reconciliation.
    console.error(JSON.stringify({ status: 'held', code: 'GK_PRODUCTION_COMMAND_INCOMPLETE' }));
    process.exitCode = 2;
  }
}
