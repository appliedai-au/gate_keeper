/** Browser-only adapter. No provider credentials, storage, logging or automatic retries. */
export const PRODUCT_PATH = '/gatekeeper/product-v1';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const GITHUB_ID = /^[1-9][0-9]{0,19}$/u;
const SLUG = /^[a-z0-9][a-z0-9-]{0,79}$/u;
const SECTIONS = ['configuration', 'organization', 'integrations', 'rules', 'audit', 'billing'];
const ADMIN_SECTIONS = ['overview', 'users', 'installations', 'repositories', 'runs', 'audit'];
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const messages = Object.freeze({
  preview_only: 'This preview does not connect, sign in or save changes.',
  setup_required: 'The dashboard API is not configured or is not enabled.',
  invalid_request: 'Check the selected filters and values.',
  unauthenticated: 'Sign in with GitHub to continue.',
  forbidden: 'This account cannot access that resource.',
  not_found: 'This resource is not available to your account.',
  revision_conflict: 'Saved settings changed elsewhere. Read back and compare before saving.',
  conflict: 'The saved state conflicts with this action. Read back before trying again.',
  installation_not_authorized: 'GitHub has not confirmed access to that installation.',
  installation_already_claimed: 'That installation is linked to another account.',
  github_access_denied: 'GitHub did not grant the required access.',
  github_not_found: 'The GitHub resource is no longer available.',
  github_unavailable: 'GitHub is unavailable. Read the current state before trying again.',
  quota_exceeded: 'The run allowance has been reached.',
  runs_paused: 'New review runs are paused.',
  rate_limited: 'Requests are temporarily limited. Try the read again later.',
  export_too_large: 'Choose a shorter date range for the export.',
  aborted: 'The read was cancelled.', timeout: 'The read timed out. Try again.',
  network_error: 'The service could not be reached. Check the connection.',
  protocol_error: 'The service returned an unexpected response.',
  uncertain_write: 'The result of this change is unknown. Read back the saved state; do not submit it again automatically.',
  product_unavailable: 'The service could not complete this request.',
});
export class ProductError extends Error {
  constructor(code, { status = 0, uncertain = false } = {}) {
    const safeCode = Object.hasOwn(messages, code) ? code : 'product_unavailable';
    super(messages[uncertain ? 'uncertain_write' : safeCode]);
    this.name = 'ProductError'; this.code = safeCode; this.status = status; this.uncertain = uncertain;
  }
}
const invalid = () => { throw new ProductError('invalid_request'); };
const segment = (value, pattern) => typeof value === 'string' && pattern.test(value) ? value : invalid();
const orgPath = p => '/orgs/' + segment(p.slug, SLUG);
const page = value => Number.isInteger(value) && value >= 0 && value <= 10000 ? value : invalid();
const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(value) &&
  Number.isFinite(Date.parse(value + 'T00:00:00Z')) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function reportFilters(input = {}, now = new Date()) {
  if (!record(input) || Object.keys(input).some(k => !['repository', 'from', 'to', 'groupBy', 'merged', 'page', 'window'].includes(k))) invalid();
  const to = input.to ?? now.toISOString().slice(0, 10);
  if (!date(to)) invalid();
  const from = input.from ?? new Date(Date.parse(to) - 29 * 86400000).toISOString().slice(0, 10);
  if (!date(from) || from > to || Date.parse(to) - Date.parse(from) > 366 * 86400000) invalid();
  const result = { repository: input.repository ?? 'all', from, to, groupBy: input.groupBy ?? 'daily',
    page: page(input.page ?? 0), window: input.window ?? 30 };
  if (result.repository !== 'all') segment(result.repository, GITHUB_ID);
  if (!['daily', 'weekly'].includes(result.groupBy) || ![7, 30].includes(result.window)) invalid();
  if (input.merged !== undefined && input.merged !== null) {
    if (typeof input.merged !== 'boolean') invalid(); result.merged = input.merged;
  }
  return result;
}
function repositoryFilters(input = {}) {
  if (!record(input) || Object.keys(input).some(k => !['search', 'enabled', 'page'].includes(k))) invalid();
  const search = input.search ?? '', enabled = input.enabled ?? 'all';
  if (typeof search !== 'string' || search.length > 200 || /[\u0000-\u001f]/u.test(search) ||
      !['all', 'true', 'false'].includes(enabled)) invalid();
  return { search, enabled, page: page(input.page ?? 0) };
}
const json = value => record(value) ? value : invalid();
function route(action, p, now) {
  if (!record(p)) invalid();
  switch (action) {
    case 'session': return { path: '/session' };
    case 'logout': return { path: '/auth/logout', method: 'POST', body: {} };
    case 'overview': case 'reviews': return { path: orgPath(p) + '/' + action, filters: reportFilters(p.filters, now) };
    case 'run': return { path: orgPath(p) + '/runs/' + segment(p.id, UUID) };
    case 'finding':
      if (!['open', 'closed'].includes(p.status)) invalid();
      return { path: orgPath(p) + '/findings/' + segment(p.id, UUID), method: 'PUT', body: { status: p.status } };
    case 'settings':
      if (!SECTIONS.includes(p.section)) invalid();
      return { path: orgPath(p) + '/settings/' + p.section,
        filters: p.section === 'audit' ? { page: page(p.page ?? 0) } : undefined };
    case 'saveSettings':
      if (!['configuration', 'organization', 'rules'].includes(p.section)) invalid();
      return { path: orgPath(p) + '/settings/' + p.section, method: 'PUT', body: json(p.value) };
    case 'repositories': return { path: orgPath(p) + '/repositories', filters: repositoryFilters(p.filters) };
    case 'saveRepository': return { path: orgPath(p) + '/repositories/' + segment(p.id, GITHUB_ID), method: 'PATCH', body: json(p.value) };
    case 'refreshRepositories': return { path: orgPath(p) + '/repositories/refresh', method: 'POST', body: {} };
    case 'disableAllRepositories':
      if (p.confirmed !== true) invalid();
      return { path: orgPath(p) + '/repositories/disable-all', method: 'POST', body: {} };
    case 'saveMember': return { path: orgPath(p) + '/members/' + segment(p.id, UUID), method: 'PATCH', body: json(p.value) };
    case 'removeMember':
      if (p.confirmed !== true) invalid();
      return { path: orgPath(p) + '/members/' + segment(p.id, UUID), method: 'DELETE', body: {} };
    case 'auditExport': return { path: orgPath(p) + '/audit/export', filters: reportFilters(p.filters, now), csv: true };
    case 'admin':
      if (!ADMIN_SECTIONS.includes(p.section)) invalid();
      return { path: '/admin/' + p.section, filters: reportFilters(p.filters, now) };
    case 'saveLimits': return { path: '/admin/users/' + segment(p.id, UUID) + '/limits', method: 'PUT', body: json(p.value) };
    case 'savePause':
      if (p.confirmed !== true || typeof p.paused !== 'boolean' || typeof p.reason !== 'string' ||
          p.reason.trim().length === 0 || p.reason.length > 500) invalid();
      return { path: '/admin/controls', method: 'PUT', body: { paused: p.paused, reason: p.reason } };
    default: return invalid();
  }
}
function apiBase(value) {
  try {
    if (typeof value !== 'string') throw new Error();
    const stripped = value.endsWith('/') ? value.slice(0, -1) : value, url = new URL(stripped);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== PRODUCT_PATH || stripped !== url.origin + PRODUCT_PATH) throw new Error();
    return stripped;
  } catch { throw new ProductError('setup_required'); }
}
async function responseText(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new ProductError('protocol_error');
  const decoder = new TextDecoder('utf-8', { fatal: true }); let result = '', bytes = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.byteLength;
      if (bytes > 2 * 1024 * 1024) throw new ProductError('protocol_error');
      result += decoder.decode(item.value, { stream: true });
    }
    return result + decoder.decode();
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}

/** mode is explicit: a missing or unknown mode cannot silently enable the preview. */
export function createProductClient({ baseUrl, mode = 'preview', fetcher = globalThis.fetch,
  timeoutMs = 15000, now = () => new Date() } = {}) {
  const ready = () => {
    if (mode !== 'live') throw new ProductError('preview_only');
    if (typeof fetcher !== 'function' || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000)
      throw new ProductError('setup_required');
    return apiBase(baseUrl);
  };
  async function call(action, params = {}, { signal } = {}) {
    const base = ready(), spec = route(action, params, now()), method = spec.method ?? 'GET';
    const writing = method !== 'GET';
    const query = spec.filters ? '?' + new URLSearchParams(Object.entries(spec.filters).map(([k, v]) => [k, String(v)])) : '';
    let body;
    if (writing) {
      try { body = JSON.stringify(spec.body); } catch { invalid(); }
      if (new TextEncoder().encode(body).byteLength > 128 * 1024) invalid();
    }
    if (signal?.aborted) throw new ProductError('aborted');
    const abort = new AbortController(); let timedOut = false, dispatched = false, status = 0;
    const onAbort = () => abort.abort(); signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; abort.abort(); }, timeoutMs);
    try {
      dispatched = true;
      const response = await fetcher(base + spec.path + query, { method, credentials: 'include', cache: 'no-store',
        redirect: 'error', referrerPolicy: 'no-referrer', signal: abort.signal,
        headers: { Accept: spec.csv ? 'text/csv' : 'application/json', ...(writing ? {
          'Content-Type': 'application/json', 'X-G8S-Request': '1' } : {}) }, ...(writing ? { body } : {}) });
      status = response.status;
      if (response.redirected || response.type === 'opaqueredirect') throw new ProductError('protocol_error');
      const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      if (spec.csv && response.ok) {
        if (type !== 'text/csv') throw new ProductError('protocol_error');
        return { filename: 'g8s-audit.csv', text: await responseText(response) };
      }
      if (type !== 'application/json') throw new ProductError('protocol_error');
      let payload; try { payload = JSON.parse(await responseText(response)); }
      catch { throw new ProductError('protocol_error'); }
      if (!response.ok) throw new ProductError(record(payload?.error) ? payload.error.code : 'product_unavailable',
        { status, uncertain: writing && status >= 500 });
      if (!record(payload) || !Object.hasOwn(payload, 'data') || Object.hasOwn(payload, 'error') || !record(payload.data))
        throw new ProductError('protocol_error');
      return payload.data;
    } catch (error) {
      const code = status === 401 ? 'unauthenticated' : status === 403 ? 'forbidden' :
        error instanceof ProductError ? error.code : timedOut ? 'timeout' : abort.signal.aborted ? 'aborted' : 'network_error';
      const uncertain = writing && dispatched && (status === 0 || status >= 500 || status >= 200 && status < 300);
      throw new ProductError(code, { status, uncertain });
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', onAbort); abort.abort(); }
  }
  function navigation(action, { slug } = {}) {
    const base = ready();
    if (action === 'signin') return base + '/auth/github/start';
    if (action === 'install') return base + '/auth/github/install?org=' + segment(slug, SLUG);
    invalid();
  }
  return Object.freeze({ call, navigation });
}

export function costDisplay(usage) {
  const money = value => typeof value === 'number' && Number.isFinite(value) && value >= 0;
  if (!record(usage)) return { label: 'Unavailable', value: null };
  if (money(usage.modelSpendUsd)) return { label: 'Reconciled spend (USD)', value: usage.modelSpendUsd };
  if (usage.costComplete === true && money(usage.estimatedModelCostUsd))
    return { label: 'Estimated cost (USD)', value: usage.estimatedModelCostUsd };
  if (money(usage.knownEstimatedModelCostUsd))
    return { label: 'Known estimated subtotal (USD) — incomplete', value: usage.knownEstimatedModelCostUsd };
  return { label: 'Unavailable', value: null };
}
export function githubPullRequestHref(value) {
  try {
    const url = new URL(value);
    return url.origin === 'https://github.com' && !url.username && !url.password &&
      /^\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/pull\/[1-9][0-9]*$/u.test(url.pathname)
      ? url.origin + url.pathname : null;
  } catch { return null; }
}
