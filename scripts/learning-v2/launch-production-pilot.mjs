/** Explicit commands only. This child receives no provider or database secrets. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { identifier, requireThat } from './contracts.mjs';
import { openProductionPilot } from './production-driver.mjs';
import { PRODUCTION_DIRECTORY, PRODUCTION_REPOSITORY_ROOT, publishProductionStatus,
  readProductionConfig } from './production-config.mjs';

export async function productionCommand({ command, operationId = null, sourceCommit }) {
  requireThat(['init', 'run', 'resume-review', 'reconcile-usage', 'reconcile-operation', 'status'].includes(command), 'production command');
  requireThat(['resume-review', 'reconcile-usage', 'reconcile-operation'].includes(command) ? operationId !== null : operationId === null,
    'production operation argument');
  if (operationId !== null) identifier(operationId, 'production operationId');
  const config = readProductionConfig(sourceCommit);
  const driver = await openProductionPilot({ directory: PRODUCTION_DIRECTORY,
    repositoryRoot: PRODUCTION_REPOSITORY_ROOT, bundle: config.bundle, authority: config.authority,
    initialize: command === 'init' });
  await publishProductionStatus(config, driver);
  if (command === 'init') return { status: 'initialized', learning: await driver.status() };
  if (command === 'run') return driver.run();
  if (command === 'resume-review') {
    const result = await driver.resumeProposalReview({ operationId });
    return result.status === 'advanced' ? driver.run() : result;
  }
  if (command === 'reconcile-usage') return driver.reconcileUsage({ operationId });
  if (command === 'reconcile-operation') return driver.reconcileOperation({ operationId });
  return { status: 'observed', learning: await driver.status() };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireThat(process.argv.length >= 3 && process.argv.length <= 4, 'production command argument count');
    const result = await productionCommand({ command: process.argv[2], operationId: process.argv[3] ?? null,
      sourceCommit: process.env.GK_PRODUCTION_SOURCE_COMMIT });
    console.log('GK_PRODUCTION_PILOT ' + JSON.stringify(result));
    if (['held', 'review-pending'].includes(result.status)) process.exitCode = 2;
  } catch {
    // Exception objects can carry HTTP authorization and provider data. The
    // durable private journals hold the operation identity for reconciliation.
    console.error(JSON.stringify({ status: 'held', code: 'GK_PRODUCTION_COMMAND_INCOMPLETE' }));
    process.exitCode = 2;
  }
}
