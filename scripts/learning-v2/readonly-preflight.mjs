/** Metadata-only commissioning probe. No model calls, provider writes or journal writes. */
import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, openSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const LEGACY_BANK_PATH = '/data/gk3-rule-bank.json';
const MAX_BANK_BYTES = 16 * 1024 * 1024;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const fail = code => { throw new Error(code); };
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max = 8192) => typeof value === 'string' && value.length <= max ? value : fail('PREFLIGHT_TEXT_INVALID');
const metadataName = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.:/ -]{0,255}$/.test(value) ? value : fail('PREFLIGHT_NAME_INVALID');

export function validatePrivateHost(value) {
  let u;
  try { u = new URL(value); } catch { fail('PREFLIGHT_HOST_INVALID'); }
  if (u.origin !== 'http://trueforge.railway.internal:8080' || u.username || u.password || u.search || u.hash || u.pathname !== '/') fail('PREFLIGHT_HOST_INVALID');
  return u.origin;
}

function dataArray(response, label) {
  // These two SDK APIs are ordinary HttpResponsePromise<{data: T[]}>, not Page.
  // A malformed/wrongly unwrapped response must never masquerade as an empty list.
  if (!isObject(response) || !Array.isArray(response.data)) fail(`PREFLIGHT_${label}_SHAPE_INVALID`);
  if (response.data.length > 10000) fail(`PREFLIGHT_${label}_TOO_LARGE`);
  return response.data;
}

export async function inspectCatalog(tf) {
  if (typeof tf?.settings?.modelProviders?.list !== 'function' || typeof tf?.models?.list !== 'function') fail('PREFLIGHT_SDK_REQUIRED');
  const [p, m] = await Promise.all([tf.settings.modelProviders.list(), tf.models.list()]);
  const providers = dataArray(p, 'PROVIDERS').map(item => {
    if (!isObject(item)) fail('PREFLIGHT_PROVIDER_INVALID');
    return { name: metadataName(item.name), type: typeof item.manifest?.type === 'string' ? metadataName(item.manifest.type) : null };
  });
  const models = dataArray(m, 'MODELS').map(item => {
    if (!isObject(item)) fail('PREFLIGHT_MODEL_INVALID');
    return { name: metadataName(item.name), provider: typeof item.provider?.name === 'string' ? metadataName(item.provider.name) : null };
  });
  return { schema: 'gk-readonly-catalog-v1', providerCount: providers.length, modelCount: models.length, providers, models, inferenceCalls: 0 };
}

function stringList(value) {
  if (!Array.isArray(value) || value.length > 100) fail('PREFLIGHT_LIST_INVALID');
  return value.map(item => text(item));
}

function scope(value) {
  if (!isObject(value)) fail('PREFLIGHT_SCOPE_INVALID');
  const out = {};
  if (value.kind !== undefined) out.kind = text(value.kind, 100);
  for (const k of ['languages', 'frameworks', 'codeTokens']) if (value[k] !== undefined) out[k] = stringList(value[k]);
  return out;
}

function condition(value) {
  if (typeof value === 'string') return text(value);
  if (!isObject(value)) fail('PREFLIGHT_CONDITION_INVALID');
  const out = {};
  for (const k of ['when', 'evidence', 'unless']) if (value[k] !== undefined) out[k] = text(value[k]);
  if (value.scope !== undefined) out.scope = scope(value.scope);
  if (value.codeTokens !== undefined) out.codeTokens = stringList(value.codeTokens);
  return out;
}

function numericFields(value, keys) {
  if (!isObject(value)) fail('PREFLIGHT_NUMBERS_INVALID');
  const out = {};
  for (const k of keys) if (value[k] !== undefined) {
    if (value[k] !== null && !Number.isFinite(value[k])) fail('PREFLIGHT_NUMBER_INVALID');
    out[k] = value[k];
  }
  return out;
}

export function projectLegacyBank(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_BANK_BYTES) fail('PREFLIGHT_BANK_SIZE_INVALID');
  let bank;
  try { bank = JSON.parse(bytes.toString('utf8')); } catch { fail('PREFLIGHT_BANK_JSON_INVALID'); }
  if (!isObject(bank) || bank.version !== 1) fail('PREFLIGHT_BANK_VERSION_INVALID');
  const groups = ['accepted', 'harmful', 'unproven', 'history'];
  for (const k of groups) if (!Array.isArray(bank[k]) || bank[k].length > 10000) fail('PREFLIGHT_BANK_GROUP_INVALID');
  const records = groups.flatMap(group => bank[group].map((entry, index) => {
    if (!isObject(entry)) fail('PREFLIGHT_BANK_ENTRY_INVALID');
    // Explicit projection: exclude raw responses, prompts, task answers, fit feedback,
    // confirmation traces and every unknown field. The source file stays untouched.
    const out = { group, index, evidenceDigest: sha256(JSON.stringify(entry)) };
    for (const k of ['id', 'status', 'verdict', 'faultType', 'model', 'source', 'kind', 'reason']) if (entry[k] !== undefined) out[k] = text(entry[k]);
    Object.assign(out, numericFields(entry, ['round', 'coveredTasks', 'netChange', 'caughtChange', 'falseAlarmChange', 'fitChange', 'checkChange']));
    if (entry.rules !== undefined) out.rules = stringList(entry.rules);
    if (entry.scope !== undefined) out.scope = scope(entry.scope);
    for (const k of ['conditional', 'proposed']) if (entry[k] !== undefined) {
      if (!Array.isArray(entry[k]) || entry[k].length > 100) fail('PREFLIGHT_CONDITIONS_INVALID');
      out[k] = entry[k].map(condition);
    }
    for (const k of ['baseline', 'candidate']) if (isObject(entry[k])) out[k] = numericFields(entry[k], ['net', 'caught', 'falseAlarms', 'fa', 'fit', 'check', 'unparsed']);
    if (entry.confirmation !== undefined && entry.confirmation !== null) {
      if (!isObject(entry.confirmation) || typeof entry.confirmation.confirmed !== 'boolean') fail('PREFLIGHT_CONFIRMATION_INVALID');
      out.confirmation = { confirmed: entry.confirmation.confirmed, ...numericFields(entry.confirmation, ['repeats', 'netChange', 'fitChange', 'checkChange']) };
    }
    if (JSON.stringify(out).length > 48000) fail('PREFLIGHT_ENTRY_TOO_LARGE');
    return out;
  }));
  return { schema: 'gk-legacy-bank-projection-v1', path: LEGACY_BANK_PATH, fileDigest: sha256(bytes), bytes: bytes.length,
    revision: Number.isSafeInteger(bank.revision) ? bank.revision : null,
    counts: Object.fromEntries(groups.map(k => [k, bank[k].length])), records,
    authority: 'historical-observation-only; not v4 signed promotion evidence' };
}

export function readLegacyBank() {
  const fd = openSync(LEGACY_BANK_PATH, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = fstatSync(fd);
    if (!before.isFile() || before.nlink !== 1 || before.size > MAX_BANK_BYTES) fail('PREFLIGHT_BANK_FILE_INVALID');
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) fail('PREFLIGHT_BANK_CHANGED');
    return projectLegacyBank(bytes);
  } finally { closeSync(fd); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const mode = process.argv[2];
    if (!['catalog', 'history'].includes(mode) || process.argv.length !== 3) fail('PREFLIGHT_MODE_REQUIRED');
    if (mode === 'catalog') {
      const baseUrl = validatePrivateHost(process.env.TRUEFORGE_BASE_URL);
      const { TrueForge } = await import('@truefoundry/trueforge-sdk');
      const tf = new TrueForge({ baseUrl, token: process.env.TRUEFORGE_TOKEN || undefined, timeoutInSeconds: 20, maxRetries: 0 });
      console.log('GK_PREFLIGHT_CATALOG ' + JSON.stringify(await inspectCatalog(tf)));
    } else {
      const { records, ...summary } = readLegacyBank();
      console.log('GK_PREFLIGHT_BANK ' + JSON.stringify(summary));
      for (const record of records) console.log('GK_PREFLIGHT_BANK_RECORD ' + JSON.stringify(record));
      console.log('GK_PREFLIGHT_BANK_END ' + JSON.stringify({ fileDigest: summary.fileDigest, records: records.length }));
    }
  } catch (error) {
    // SDK exceptions can contain response headers/bodies. Never print them.
    const code = /^PREFLIGHT_[A-Z_]+$/.test(error?.message) ? error.message : 'PREFLIGHT_READ_FAILED';
    console.error(JSON.stringify({ status: 'unavailable', code }));
    process.exitCode = 2;
  }
}
