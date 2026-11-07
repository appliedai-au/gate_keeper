/** Read-only integration check against the actual retained bank on its existing
 * runner. No provider client, inference, signing, file writes or raw-rule output. */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { digest, requireThat } from './contracts.mjs';
import { importLegacyHistory } from './production-bundle.mjs';
import { readLegacyBank } from './readonly-preflight.mjs';

export function inspectProductionHistory(projection) {
  const imported = importLegacyHistory(projection);
  return { schema: 'gk-production-history-import-v1', fileDigest: projection.fileDigest,
    projectionDigest: imported.sourceDigest, revision: projection.revision, sourceCounts: projection.counts,
    referenceCount: imported.history.length, historyDigest: digest(imported.history),
    outcomes: Object.fromEntries(['rejected', 'unproven', 'legacy-positive'].map(outcome =>
      [outcome, imported.history.filter(item => item.outcome === outcome).length])),
    nonProcedureRecords: imported.nonProcedureRecords.length, providerCalls: 0, writes: 0 };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    requireThat(process.argv.length === 2, 'history integration arguments');
    const summary = inspectProductionHistory(readLegacyBank());
    requireThat(summary.fileDigest === '2f679a49712b9dbefc992c03a1437ec9dff7e2f989b90bcb130aa3a4dc42b7ab' &&
      summary.projectionDigest === '549a00b379e7819cd6b0ea1141f58d4ded306cb1a41c7909de186ee531f568f2' &&
      summary.referenceCount === 100 && summary.nonProcedureRecords === 1,
    'history differs from the recovered reviewed source bank');
    console.log('GK_PRODUCTION_HISTORY ' + JSON.stringify(summary));
  } catch {
    console.error(JSON.stringify({ status: 'held', code: 'GK_PRODUCTION_HISTORY_UNAVAILABLE' }));
    process.exitCode = 2;
  }
}
