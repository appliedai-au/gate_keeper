/** Public product contracts. This module contains no credentials or reviewer source. */
export const PRODUCT_PATH = '/gatekeeper/product-v1';
export const COMMANDS = Object.freeze([
  { command: '@g8s review', description: 'Queue a fresh review of the current pull request.' },
  { command: '@g8s explain <finding-id>', description: 'Show the saved evidence for one finding on this pull request.' },
  { command: '@g8s help', description: 'List the available commands and their scope.' },
]);
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
export const SHA = /^[0-9a-f]{40}$/u;
export const GITHUB_ID = /^[1-9][0-9]{0,19}$/u;
export const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/u;
// GitHub App bot actors use a literal [bot] suffix; they are not OAuth users.
export const ACTOR_LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,94})(?:\[bot\])?$/u;
export const SLUG = /^[a-z0-9](?:[a-z0-9-]{0,79})$/u;
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export const bounded = (value, max, min = 0) => typeof value === 'string' && value.length >= min &&
  value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/u.test(value);
export const exactKeys = (value, required, optional = []) => record(value) &&
  required.every(key => Object.hasOwn(value, key)) &&
  Object.keys(value).every(key => [...required, ...optional].includes(key));
export const numericId = value => (typeof value === 'string' && GITHUB_ID.test(value)) ||
  (Number.isSafeInteger(value) && value > 0);

/** Intentionally bounded commands, never an arbitrary instruction/repair channel. */
export function parseCommand(body) {
  if (typeof body !== 'string' || body.length > 512) return null;
  const lines = body.replace(/\r\n?/gu, '\n').split('\n').map(line => line.trim());
  if (lines.length !== 1) return null;
  if (lines[0] === '@g8s review') return { command: 'review', findingId: null };
  if (lines[0] === '@g8s help') return { command: 'help', findingId: null };
  const match = /^@g8s explain ([0-9a-f-]{36})$/u.exec(lines[0]);
  return match && UUID.test(match[1]) ? { command: 'explain', findingId: match[1] } : null;
}

export function validPath(file) {
  return bounded(file, 512, 1) && !file.startsWith('/') && !file.includes('\\') &&
    !file.split('/').some(part => part === '..' || part === '.' || !part) &&
    !/[\u0000-\u001f\u007f]/u.test(file);
}

export function parseFilters(searchParams, now = new Date()) {
  const allowed = ['repository', 'from', 'to', 'groupBy', 'merged', 'page', 'window'];
  for (const key of searchParams.keys()) if (!allowed.includes(key) || searchParams.getAll(key).length !== 1)
    throw Object.assign(new Error('invalid_request'), { code: 'invalid_request', status: 400 });
  const to = searchParams.get('to') || now.toISOString().slice(0, 10);
  const validDate = x => /^\d{4}-\d{2}-\d{2}$/u.test(x) &&
    Number.isFinite(Date.parse(x + 'T00:00:00Z')) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x;
  if (!validDate(to)) throw Object.assign(new Error('invalid_request'), { code: 'invalid_request', status: 400 });
  const from = searchParams.get('from') || new Date(Date.parse(to + 'T00:00:00Z') - 29 * 86400000).toISOString().slice(0, 10);
  const repository = searchParams.get('repository') || 'all';
  const groupBy = searchParams.get('groupBy') || 'daily';
  const page = Number(searchParams.get('page') || '0');
  const merged = searchParams.get('merged');
  const window = Number(searchParams.get('window') || '30');
  if (!validDate(from) || !validDate(to) || from > to ||
      Date.parse(to) - Date.parse(from) > 366 * 86400000 ||
      (repository !== 'all' && !GITHUB_ID.test(repository)) ||
      !['daily', 'weekly'].includes(groupBy) || !Number.isInteger(page) || page < 0 || page > 10000 ||
      (merged !== null && !['true', 'false'].includes(merged)) || ![7, 30].includes(window))
    throw Object.assign(new Error('invalid_request'), { code: 'invalid_request', status: 400 });
  return { repository, from, to, groupBy, merged: merged === null ? null : merged === 'true', page, window };
}

export const CONFIGURATION_DEFAULTS = Object.freeze({
  skipDraftPRs: true, autoFillSummaries: false, blockMergeSeverity: 'off', autoApprove: false,
  autoApproveMaxRisk: 'low', allowedAuthors: [], excludedAuthors: [], allowedBots: [],
  allowedBranches: [], excludedBranches: [], customInstructions: '', summaryInstructions: '',
  riskInstructions: '',
});
const list = value => Array.isArray(value) && value.length <= 100 && value.every(x => bounded(x, 200, 1));
export function validConfiguration(value, partial = false) {
  if (!record(value) || (!partial && !Object.keys(CONFIGURATION_DEFAULTS).every(key => Object.hasOwn(value, key)))) return false;
  return Object.entries(value).every(([key, entry]) => {
    if (!Object.hasOwn(CONFIGURATION_DEFAULTS, key)) return false;
    if (['skipDraftPRs', 'autoFillSummaries', 'autoApprove'].includes(key)) return typeof entry === 'boolean';
    if (key === 'blockMergeSeverity') return ['off', 'low', 'medium', 'high', 'critical'].includes(entry);
    if (key === 'autoApproveMaxRisk') return ['low', 'medium', 'high'].includes(entry);
    if (['allowedAuthors', 'excludedAuthors', 'allowedBots', 'allowedBranches', 'excludedBranches'].includes(key)) return list(entry);
    return bounded(entry, 16000);
  });
}

/** Case-insensitive identities; exact branch matching avoids regex injection. */
export function inReviewScope(pr, config) {
  const author = pr.user?.login?.toLowerCase();
  const contains = (values, value) => values.some(x => x.toLowerCase() === value);
  if (!author || !bounded(pr.base?.ref, 200, 1)) return false;
  if (config.skipDraftPRs && pr.draft) return false;
  if (contains(config.excludedAuthors, author)) return false;
  if (config.allowedAuthors.length && !contains(config.allowedAuthors, author)) return false;
  if (pr.user?.type === 'Bot' && !contains(config.allowedBots, author)) return false;
  if (config.excludedBranches.includes(pr.base.ref)) return false;
  if (config.allowedBranches.length && !config.allowedBranches.includes(pr.base.ref)) return false;
  return pr.state === 'open';
}

export const severityRank = severity => ({ low: 1, medium: 2, high: 3, critical: 4 })[severity] || 0;
export const riskRank = risk => ({ low: 1, medium: 2, high: 3 })[risk] || 0;
export function greaterRisk(first, second) {
  return riskRank(first) >= riskRank(second) ? first : second;
}
