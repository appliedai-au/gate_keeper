/** Frozen commissioning data. No provider access, signing, model calls or writes. */
import { createHash, createPublicKey } from 'node:crypto';
import { POLICY, canonical, configuration, copy, digest, hash, identifier, integer,
  procedure, record, requireThat, text } from './contracts.mjs';
import { LEGACY_BAG_BLOB, LEGACY_RENDERER_ID } from './legacy-renderer.mjs';
import { TURN_CONFIG } from './trueforge-turn.mjs';

export const PRODUCTION_CORPUS_DIGEST = 'eac6553e0fc669d2a648ba460d492325cae3a45e1770bad10d02a8d36f9a79b3';
const ROLES = ['evaluation', 'novelty', 'budget', 'activation'];
const GROUPS = ['accepted', 'harmful', 'unproven', 'history'];
const sha = value => createHash('sha256').update(value).digest('hex');

function historicalLanguages(scope) {
  const aliases = { 'c#': 'csharp', 'c++': 'cpp', '.net': 'dotnet', 'c-sharp': 'csharp' };
  const source = scope?.languages ?? [];
  requireThat(Array.isArray(source), 'historical scope languages');
  // Empty legacy languages means no language restriction, not missing data.
  // The full original framework/token scope is retained in applicability.
  return source.length ? [...new Set(source.map(value => {
    text(value, 'historical language', 100);
    return identifier(aliases[value.toLowerCase()] ?? value.toLowerCase(), 'historical language');
  }))] : ['any'];
}

/** The source projection is mandatory and remains available in full to the
 * independent novelty reviewer. Normalization never upgrades an old verdict. */
export function importLegacyHistory(projection) {
  record(projection, ['schema', 'path', 'fileDigest', 'bytes', 'revision', 'counts', 'records', 'authority'],
    'legacy bank projection');
  canonical(projection);
  requireThat(projection.schema === 'gk-legacy-bank-projection-v1' &&
    projection.path === '/data/gk3-rule-bank.json' &&
    projection.authority === 'historical-observation-only; not v4 signed promotion evidence',
  'historical bank provenance');
  hash(projection.fileDigest, 'historical bank file digest');
  integer(projection.bytes, 'historical bank bytes', 1, 16 * 1024 * 1024);
  if (projection.revision !== null) integer(projection.revision, 'historical bank revision');
  record(projection.counts, GROUPS, 'historical bank counts');
  for (const group of GROUPS) integer(projection.counts[group], `historical ${group} count`, 0, 10000);
  requireThat(projection.counts.harmful >= 35 && projection.counts.unproven >= 18,
    'historical bank predates the retained ten-attempt run');
  requireThat(Array.isArray(projection.records) && projection.records.length ===
    GROUPS.reduce((total, group) => total + projection.counts[group], 0), 'historical bank export incomplete');
  const seen = new Set(), history = [], nonProcedureRecords = [];
  for (const entry of projection.records) {
    requireThat(entry && GROUPS.includes(entry.group), 'historical bank record group');
    integer(entry.index, 'historical bank record index', 0, projection.counts[entry.group] - 1);
    hash(entry.evidenceDigest, 'historical record evidence digest');
    const key = `${entry.group}:${entry.index}`;
    requireThat(!seen.has(key), 'duplicate historical bank record'); seen.add(key);
    const originalConditions = entry.conditional ?? entry.proposed ?? entry.rules ?? [];
    requireThat(Array.isArray(originalConditions), 'historical condition collection');
    const testedBundle = entry.status === 'harmful-in-tested-bundle';
    if (testedBundle) requireThat(originalConditions.length > 0 && originalConditions.every(item => typeof item === 'string'),
      'historical tested bundle requires its complete original rule list');
    // The old bank rejected these rules together. It did not establish an
    // isolated negative outcome for each component of the tested bundle.
    const conditions = testedBundle ? [originalConditions.map((rule, index) => `Rule ${index + 1}: ${rule}`).join('\n')] :
      originalConditions;
    let mapped = 0;
    for (const [conditionIndex, condition] of conditions.entries()) {
      // Rejected malformed proposals have no valid procedure to compare. Their
      // source record and digest remain frozen; they are never silently dropped.
      if (condition && typeof condition === 'object' && condition.unprojectable === true) {
        requireThat(entry.group === 'history', 'unprojectable retained rule-bank procedure');
        nonProcedureRecords.push({ group: entry.group, index: entry.index, conditionIndex,
          evidenceDigest: entry.evidenceDigest, disposition: 'retained-unprojectable-historical-attempt' });
        continue;
      }
      const structured = condition && typeof condition === 'object' && !Array.isArray(condition) &&
        ['when', 'evidence', 'unless'].every(field => typeof condition[field] === 'string' && condition[field].trim());
      if (!structured && typeof condition !== 'string') {
        requireThat(entry.group === 'history', 'incomplete retained rule-bank procedure');
        nonProcedureRecords.push({ group: entry.group, index: entry.index, conditionIndex,
          evidenceDigest: entry.evidenceDigest, disposition: 'retained-unprojectable-historical-attempt' });
        continue;
      }
      let normalized;
      try {
        const scope = (structured ? condition.scope : null) ?? entry.scope ??
          { kind: 'historical-unspecified', languages: [], frameworks: [], codeTokens: [] };
        canonical(scope);
        const legacyScope = entry.faultType || 'legacy-unspecified';
        identifier(legacyScope, 'historical fault family');
        const raw = typeof condition === 'string' ? text(condition, 'historical procedure', 2000) : null;
        const action = structured && Array.isArray(entry.rules) && entry.rules[conditionIndex] ?
          entry.rules[conditionIndex] : raw ?? 'Report only when this trigger and evidence hold and the sufficient guard is absent.';
        normalized = procedure({ scope: legacyScope, languages: historicalLanguages(scope),
          applicability: `Retain all historical scope restrictions: ${canonical({ entryScope: entry.scope ?? null,
            conditionScope: structured ? condition.scope ?? null : null,
            codeTokens: structured ? condition.codeTokens ?? null : null })}`,
          trigger: structured ? condition.when : testedBundle ? 'Apply this entire historical rule bundle together in its stated scope.' :
            'Apply the retained historical procedure only in its stated scope.',
          evidence: structured ? condition.evidence : testedBundle ?
            'The historical negative observation applies to this combined bundle, without establishing isolated outcomes for its components.' :
            'The original retained procedure text supplies its required evidence.',
          action,
          sufficientGuard: structured ? condition.unless : 'Honor every guard and exclusion stated in the retained procedure text.' }, legacyScope);
      } catch (error) {
        if (entry.group !== 'history' || entry.kind !== 'unscored-proposal') throw error;
        nonProcedureRecords.push({ group: entry.group, index: entry.index, conditionIndex,
          evidenceDigest: entry.evidenceDigest, disposition: 'retained-unprojectable-historical-attempt' });
        continue;
      }
      const id = `legacy-${digest({ fileDigest: projection.fileDigest, group: entry.group,
        index: entry.index, evidenceDigest: entry.evidenceDigest, conditionIndex })}`;
      const outcome = entry.group === 'harmful' ? 'rejected' : entry.group === 'accepted' ? 'legacy-positive' :
        ['harmful', 'rejected', 'negative'].includes(entry.verdict) ||
          ['harmful-in-tested-context', 'harmful-in-tested-bundle'].includes(entry.status) ? 'rejected' : 'unproven';
      history.push({ id, procedure: normalized, outcome,
        sourceRef: `legacy-bank:${projection.fileDigest}/${entry.group}/${entry.index}/${entry.evidenceDigest}/${conditionIndex}` });
      mapped++;
    }
    if (mapped === 0) {
      requireThat(entry.group === 'history', 'historical bank procedure cannot be normalized without losing meaning');
      nonProcedureRecords.push({ group: entry.group, index: entry.index, evidenceDigest: entry.evidenceDigest,
        disposition: 'retained-unprojectable-historical-attempt' });
    }
  }
  requireThat(history.length > 0 && history.length <= 256, 'historical reference capacity');
  return copy({ history, sourceDigest: digest(projection), nonProcedureRecords });
}

export function freezeProductionBundle(input) {
  record(input, ['ownerId', 'experimentId', 'sourceCommit', 'model', 'serverVersion',
    'gatePolicy', 'trust', 'corpus', 'legacyBank'], 'production commissioning input');
  canonical(input);
  identifier(input.ownerId, 'production ownerId'); identifier(input.experimentId, 'production experimentId');
  hash(input.sourceCommit, 'production source commit', 40);
  text(input.model, 'production catalog model', 200);
  requireThat(['0.180.0', '0.182.0'].includes(input.serverVersion), 'production server version not qualified');
  const corpus = copy(input.corpus);
  requireThat(digest(corpus) === PRODUCTION_CORPUS_DIGEST, 'frozen production corpus differs from reviewed source');
  requireThat(corpus.cases.every(item => /^t[456]-/.test(item.caseId) &&
    item.split === (item.caseId.startsWith('t6-') ? 'check' : 'fit')), 'only retained development inputs permitted');
  const imported = importLegacyHistory(input.legacyBank);
  const trust = copy(input.trust);
  record(trust, ROLES, 'production trust');
  const fingerprints = new Set();
  for (const role of ROLES) {
    record(trust[role], role === 'budget' ? ['publicKeyPem', 'pinnedFingerprint', 'gatewayId'] :
      ['publicKeyPem', 'pinnedFingerprint'], `production ${role} trust`);
    text(trust[role].publicKeyPem, 'production public key', 10000);
    hash(trust[role].pinnedFingerprint, 'production public key pin');
    const key = createPublicKey(trust[role].publicKeyPem);
    requireThat(key.asymmetricKeyType === 'ed25519' &&
      sha(key.export({ type: 'spki', format: 'der' })) === trust[role].pinnedFingerprint,
    `production ${role} public key mismatch`);
    requireThat(!fingerprints.has(trust[role].pinnedFingerprint), 'production authority roles require distinct signing identities');
    fingerprints.add(trust[role].pinnedFingerprint);
  }
  identifier(trust.budget.gatewayId, 'production gatewayId');
  const caseInputs = corpus.cases.map(({ caseId, prompt }) => ({ caseId, prompt }));
  const runtime = { schema: 'gk-learning-v2-runtime-v1', sdkVersion: '0.180.0', serverVersion: input.serverVersion,
    provider: 'truefoundry', memory: 'off', sessionMode: 'inline-root-per-call',
    model: { name: input.model, params: copy(corpus.modelParameters) }, turnConfig: copy(TURN_CONFIG),
    renderer: LEGACY_RENDERER_ID, bagBlob: LEGACY_BAG_BLOB, caseInputsDigest: digest(caseInputs) };
  const config = configuration({ experimentId: input.experimentId, sourceCommit: input.sourceCommit,
    benchmarkDigest: digest(corpus), scorerDigest: digest(corpus.scoring), model: input.model,
    scope: corpus.scope, baseInstructions: corpus.baseInstructions,
    firstPassInstructionsDigest: sha(corpus.baseInstructions), runtimeDigest: digest(runtime),
    gatePolicy: copy(input.gatePolicy), budgetId: `${input.experimentId}:usage`,
    cases: corpus.cases.map(item => ({ caseId: item.caseId, split: item.split, scope: item.scope,
      expectedBugs: item.expected.length, passes: 2, learnerVisible: item.split === 'fit' })) });
  const trustPins = { ...Object.fromEntries(ROLES.map(role => [role, trust[role].pinnedFingerprint])),
    gatewayId: trust.budget.gatewayId };
  const configDigest = digest({ config, policy: POLICY, trustPins, history: imported.history });
  return copy({ schema: 'gk-learning-production-bundle-v1',
    binding: { ownerId: input.ownerId, experimentId: input.experimentId, sourceCommit: input.sourceCommit, configDigest },
    config, trust, runtime, caseInputs, history: imported.history, corpus,
    legacyBank: input.legacyBank, legacyBankDigest: imported.sourceDigest,
    nonProcedureRecords: imported.nonProcedureRecords });
}

/** Recompute from source inputs on every open; a bundle is data, not authority. */
export function verifyProductionBundle(bundle) {
  record(bundle, ['schema', 'binding', 'config', 'trust', 'runtime', 'caseInputs', 'history',
    'corpus', 'legacyBank', 'legacyBankDigest', 'nonProcedureRecords'], 'production bundle');
  canonical(bundle);
  requireThat(bundle.schema === 'gk-learning-production-bundle-v1', 'production bundle schema');
  const rebuilt = freezeProductionBundle({ ownerId: bundle.binding.ownerId, experimentId: bundle.config.experimentId,
    sourceCommit: bundle.config.sourceCommit, model: bundle.config.model, serverVersion: bundle.runtime.serverVersion,
    gatePolicy: bundle.config.gatePolicy, trust: bundle.trust, corpus: bundle.corpus, legacyBank: bundle.legacyBank });
  requireThat(canonical(bundle) === canonical(rebuilt), 'production bundle binding changed');
  return rebuilt;
}
