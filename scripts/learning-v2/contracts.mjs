import { createHash } from 'node:crypto';

export const POLICY = Object.freeze({
  schema: 'gk-learning-v2-policy', version: 4, attempts: 10,
  minimumGain: 1, confirmationPairs: 3, additionalPairs: 0,
  confirmationDecision: 'every-pair-passes', passes: 2,
  programmeCeilingMicros: null, usageMode: 'per-run-receipted', provider: 'truefoundry', memory: 'off',
});

export function requireThat(condition, message) {
  if (!condition) throw new Error(`LEARNING_V2_REJECTED: ${message}`);
}

/** Canonical JSON is an identity format, never an executable serialization. */
export function canonical(value) {
  const ancestors = new Set();
  function visit(item, depth = 0) {
    requireThat(depth <= 64, 'JSON nesting exceeds limit');
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') {
      requireThat(Number.isFinite(item), 'nonfinite JSON number');
      return item;
    }
    requireThat(typeof item === 'object' && item !== null, 'non-JSON value');
    requireThat(!ancestors.has(item), 'cyclic JSON value');
    requireThat(Array.isArray(item) || Object.getPrototypeOf(item) === Object.prototype ||
      Object.getPrototypeOf(item) === null, 'non-plain JSON object');
    requireThat(Object.getOwnPropertySymbols(item).length === 0, 'symbol JSON property');
    ancestors.add(item);
    let result;
    if (Array.isArray(item)) {
      requireThat(Object.getPrototypeOf(item) === Array.prototype &&
        Object.getOwnPropertyNames(item).length === item.length + 1, 'sparse or decorated array');
      result = [];
      for (let index = 0; index < item.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        requireThat(descriptor && Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'array accessor');
        result.push(visit(descriptor.value, depth + 1));
      }
    } else {
      result = Object.create(null);
      for (const key of Object.getOwnPropertyNames(item).sort()) {
        requireThat(!['__proto__', 'constructor', 'prototype'].includes(key), 'unsafe JSON key');
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        requireThat(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, 'object accessor or hidden property');
        result[key] = visit(descriptor.value, depth + 1);
      }
    }
    ancestors.delete(item);
    return result;
  }
  return JSON.stringify(visit(value));
}

export const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
export const copy = value => JSON.parse(canonical(value));
export function record(value, keys, name) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), `${name}: expected object`);
  requireThat(Reflect.ownKeys(value).length === keys.length &&
    keys.every(key => Object.hasOwn(value, key)), `${name}: unexpected or missing fields`);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireThat(Object.hasOwn(descriptor, 'value') && descriptor.enumerable, `${name}: non-data property`);
  }
}
export function text(value, name, max = 4000) {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= max &&
    !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value), `${name}: invalid text`);
  return value;
}
export function identifier(value, name) {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(value),
    `${name}: invalid identifier`);
  return value;
}
export function hash(value, name, length = 64) {
  requireThat(typeof value === 'string' && new RegExp(`^[a-f0-9]{${length}}$`).test(value),
    `${name}: invalid digest`);
  return value;
}
export function integer(value, name, min = 0, max = Number.MAX_SAFE_INTEGER) {
  requireThat(Number.isSafeInteger(value) && value >= min && value <= max, `${name}: invalid integer`);
  return value;
}

export function procedure(value, expectedScope) {
  record(value, ['scope', 'languages', 'applicability', 'trigger', 'evidence', 'action', 'sufficientGuard'], 'procedure');
  canonical(value);
  identifier(value.scope, 'procedure scope');
  requireThat(value.scope === expectedScope, 'procedure outside frozen fault focus');
  requireThat(Array.isArray(value.languages) && value.languages.length > 0 && value.languages.length <= 8,
    'procedure languages');
  const languages = value.languages.map(language => identifier(language, 'language').toLowerCase()).sort();
  requireThat(new Set(languages).size === languages.length, 'duplicate language');
  const output = { scope: value.scope, languages };
  for (const key of ['applicability', 'trigger', 'evidence', 'action', 'sufficientGuard']) {
    output[key] = text(value[key], key, 2000).trim().replace(/\s+/gu, ' ');
  }
  return output;
}

/** Exact normalized identity only. Semantic equivalence needs a host review. */
export const procedureFingerprint = value => digest(value);

export function configuration(input) {
  record(input, ['experimentId', 'sourceCommit', 'benchmarkDigest', 'scorerDigest', 'model',
    'scope', 'baseInstructions', 'firstPassInstructionsDigest', 'runtimeDigest', 'gatePolicy',
    'cases', 'budgetId'], 'configuration');
  canonical(input);
  identifier(input.experimentId, 'experimentId');
  requireThat(input.experimentId.length <= 48, 'experimentId leaves insufficient namespace space');
  hash(input.sourceCommit, 'sourceCommit', 40);
  hash(input.benchmarkDigest, 'benchmarkDigest');
  hash(input.scorerDigest, 'scorerDigest');
  text(input.model, 'model', 200);
  identifier(input.scope, 'scope');
  identifier(input.budgetId, 'budgetId');
  text(input.baseInstructions, 'baseInstructions', 100_000);
  hash(input.firstPassInstructionsDigest, 'firstPassInstructionsDigest');
  hash(input.runtimeDigest, 'runtimeDigest');
  record(input.gatePolicy, ['targetId', 'presetDigest', 'outputProfileDigest', 'effectiveTreeDigest'], 'gatePolicy');
  identifier(input.gatePolicy.targetId, 'gate targetId');
  for (const key of ['presetDigest', 'outputProfileDigest', 'effectiveTreeDigest']) hash(input.gatePolicy[key], key);
  requireThat(Array.isArray(input.cases) && input.cases.length >= 2 && input.cases.length <= 128,
    'evaluation case count');
  const ids = new Set();
  for (const item of input.cases) {
    record(item, ['caseId', 'split', 'scope', 'expectedBugs', 'passes', 'learnerVisible'], 'evaluation case');
    identifier(item.caseId, 'caseId');
    requireThat(!ids.has(item.caseId), 'duplicate evaluation case');
    ids.add(item.caseId);
    requireThat(['fit', 'check'].includes(item.split), 'only development fit/check cases are admitted');
    identifier(item.scope, 'case scope');
    integer(item.expectedBugs, 'expectedBugs', 0, 100_000);
    requireThat(item.passes === POLICY.passes, 'two passes required');
    requireThat(typeof item.learnerVisible === 'boolean' &&
      (item.split === 'fit' || item.learnerVisible === false), 'check truth cannot be learner-visible');
  }
  requireThat(input.cases.some(item => item.split === 'fit') &&
    input.cases.some(item => item.split === 'check'), 'both fit and check required');
  requireThat(input.cases.some(item => item.scope === input.scope), 'no coverage for frozen fault focus');
  return copy(input);
}

export function promptArtifact(baseInstructions, rules) {
  return { schema: 'gk-learning-v2-prompt', baseInstructions,
    rules: rules.map(item => ({ id: item.id, procedure: copy(item.procedure),
      coverageCaseIds: copy(item.coverageCaseIds) })) };
}

export function version(baseInstructions, rules, parent = null) {
  const artifact = promptArtifact(baseInstructions, rules);
  const promptDigest = digest(artifact);
  return { id: promptDigest, parent, promptDigest, rules: copy(rules), artifact };
}
