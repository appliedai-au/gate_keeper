import { ProductError } from './product-client.mjs';
const clone = value => structuredClone(value);
const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const deepFreeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value); for (const item of Object.values(value)) deepFreeze(item);
  }
  return value;
};
function atom(initial) {
  let state = deepFreeze(initial); const listeners = new Set();
  return { getSnapshot: () => state,
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    set(value) { state = deepFreeze(value); for (const listener of [...listeners]) listener(); } };
}
const issue = error => ({ code: error instanceof ProductError ? error.code : 'product_unavailable',
  message: error instanceof ProductError ? error.message : 'The request could not be completed.',
  status: error instanceof ProductError ? error.status : 0,
  uncertain: error instanceof ProductError ? error.uncertain : false });

/** Replacing a request invalidates its completion even when transport ignores abort. */
export function createResource(request) {
  const state = atom({ status: 'idle', data: null, error: null }); let version = 0, controller = null;
  function clear() { version++; controller?.abort(); controller = null; state.set({ status: 'idle', data: null, error: null }); }
  async function load(input) {
    const mine = ++version; controller?.abort(); controller = new AbortController();
    const signal = controller.signal; state.set({ status: 'loading', data: null, error: null });
    try {
      const data = await request(input, { signal });
      if (mine !== version) return { applied: false };
      state.set({ status: 'ready', data: clone(data), error: null }); return { applied: true, data: clone(data) };
    } catch (error) {
      if (mine !== version) return { applied: false };
      state.set({ status: 'error', data: null, error: issue(error) }); return { applied: true, error: issue(error) };
    } finally { if (mine === version) controller = null; }
  }
  return Object.freeze({ getSnapshot: state.getSnapshot, subscribe: state.subscribe, load, clear });
}

/** save/read return {value, revision}. Drafts edited during save are never replaced. */
export function createEditor({ save, read }) {
  const empty = () => ({ status: 'empty', baseline: null, draft: null, revision: null, dirty: false, error: null });
  const state = atom(empty()); let generation = 0, editVersion = 0, pending = false, controller = null;
  function clear() { generation++; controller?.abort(); controller = null; pending = false; editVersion = 0; state.set(empty()); }
  function seed({ value, revision = null }) {
    if (pending || state.getSnapshot().status === 'readback_required') throw new Error('Use reconcile for a pending or uncertain write.');
    generation++; editVersion = 0;
    state.set({ status: 'ready', baseline: clone(value), draft: clone(value), revision, dirty: false, error: null });
  }
  function edit(value) {
    const current = state.getSnapshot(); if (current.status === 'empty') throw new Error('Load settings before editing.');
    editVersion++;
    state.set({ ...current, draft: clone(value), dirty: !equal(value, current.baseline),
      status: ['saving', 'reconciling', 'readback_required'].includes(current.status) ? current.status : 'ready' });
  }
  async function saveDraft() {
    const current = state.getSnapshot();
    if (pending || current.status === 'empty' || current.status === 'readback_required') return { blocked: true };
    if (!current.dirty) return { unchanged: true };
    const mine = generation, submitted = clone(current.draft), editAtSubmit = editVersion;
    pending = true; controller = new AbortController();
    state.set({ ...current, status: 'saving', error: null });
    try {
      const saved = await save({ value: submitted, revision: current.revision }, { signal: controller.signal });
      if (mine !== generation) return { applied: false };
      if (!saved || !Object.hasOwn(saved, 'value')) throw new ProductError('protocol_error', { uncertain: true });
      const draft = editVersion === editAtSubmit ? clone(saved.value) : state.getSnapshot().draft;
      state.set({ status: 'ready', baseline: clone(saved.value), draft, revision: saved.revision ?? null,
        dirty: !equal(draft, saved.value), error: null });
      return { applied: true };
    } catch (error) {
      if (mine !== generation) return { applied: false };
      // An unexpected adapter exception after dispatch is uncertain too.
      const safe = error instanceof ProductError ? issue(error) : issue(new ProductError('uncertain_write', { uncertain: true }));
      const needsReadback = safe.uncertain || ['revision_conflict', 'conflict'].includes(safe.code);
      state.set({ ...state.getSnapshot(), status: needsReadback ? 'readback_required' : 'error', error: safe });
      return { applied: true, error: safe };
    } finally { if (mine === generation) { pending = false; controller = null; } }
  }
  async function reconcile() {
    if (pending) return { blocked: true };
    const mine = generation; pending = true; controller = new AbortController();
    const previous = state.getSnapshot(); state.set({ ...previous, status: 'reconciling', error: null });
    try {
      const saved = await read({}, { signal: controller.signal });
      if (mine !== generation) return { applied: false };
      if (!saved || !Object.hasOwn(saved, 'value')) throw new ProductError('protocol_error');
      const draft = previous.status === 'empty' ? clone(saved.value) : state.getSnapshot().draft;
      state.set({ status: 'ready', baseline: clone(saved.value), draft, revision: saved.revision ?? null,
        dirty: !equal(draft, saved.value), error: null }); return { applied: true };
    } catch (error) {
      if (mine !== generation) return { applied: false };
      state.set({ ...state.getSnapshot(), status: 'readback_required', error: issue(error) });
      return { applied: true, error: issue(error) };
    } finally { if (mine === generation) { pending = false; controller = null; } }
  }
  return Object.freeze({ getSnapshot: state.getSnapshot, subscribe: state.subscribe, seed, edit, saveDraft, reconcile, clear });
}

const administrative = action => ['admin', 'saveLimits', 'savePause'].includes(action);
const sessionShape = value => value && value.user && typeof value.user.id === 'string' &&
  typeof value.isAdmin === 'boolean' && Array.isArray(value.organizations) &&
  value.organizations.every(org => org && typeof org.id === 'string' && typeof org.slug === 'string' &&
    /^[a-z0-9][a-z0-9-]{0,79}$/u.test(org.slug) && ['owner', 'admin', 'member'].includes(org.role));

/** One instance per live app root; no persistent browser storage or inferred admin. */
export function createDashboardSession(client) {
  const blank = status => ({ status, session: null, organization: null, error: null });
  const state = atom(blank('idle')), resources = new Set(), requests = new Set(); let epoch = 0, refreshing = 0;
  function invalidate() {
    epoch++; for (const request of requests) request.abort(); requests.clear();
    for (const resource of resources) resource.clear();
  }
  function reset() { refreshing++; invalidate(); state.set(blank('idle')); }
  async function refreshSession(preferredSlug) {
    const ticket = ++refreshing; invalidate(); state.set(blank('loading'));
    const controller = new AbortController(); requests.add(controller);
    try {
      const session = await client.call('session', {}, { signal: controller.signal });
      if (ticket !== refreshing) return { applied: false };
      if (!sessionShape(session)) throw new ProductError('protocol_error');
      const organization = preferredSlug === undefined ? session.organizations[0] ?? null :
        session.organizations.find(org => org.slug === preferredSlug) ?? null;
      if (preferredSlug !== undefined && !organization) throw new ProductError('forbidden', { status: 403 });
      state.set({ status: 'ready', session: clone(session), organization: clone(organization), error: null });
      return { applied: true };
    } catch (error) {
      if (ticket !== refreshing) return { applied: false };
      invalidate(); state.set({ ...blank('error'), error: issue(error) }); return { applied: true, error: issue(error) };
    } finally { requests.delete(controller); }
  }
  function selectOrganization(slug) {
    const current = state.getSnapshot(), organization = current.session?.organizations.find(org => org.slug === slug);
    if (current.status !== 'ready' || !organization) throw new ProductError('forbidden', { status: 403 });
    invalidate(); state.set({ ...current, organization: clone(organization), error: null });
  }
  async function call(action, params = {}, { signal } = {}) {
    const current = state.getSnapshot(), mine = epoch;
    if (current.status !== 'ready') throw new ProductError('unauthenticated', { status: 401 });
    if (administrative(action) && current.session.isAdmin !== true) throw new ProductError('forbidden', { status: 403 });
    const scoped = !administrative(action) && action !== 'logout';
    if (scoped && (!current.organization || params.slug !== undefined && params.slug !== current.organization.slug))
      throw new ProductError('forbidden', { status: 403 });
    const controller = new AbortController(), cancel = () => controller.abort(); requests.add(controller);
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    try {
      const value = await client.call(action, { ...params, ...(scoped ? { slug: current.organization.slug } : {}) }, { signal: controller.signal });
      if (mine !== epoch) throw new ProductError('aborted');
      return value;
    } catch (error) {
      if (mine !== epoch) throw new ProductError('aborted');
      if ([401, 403].includes(error.status)) {
        refreshing++; invalidate(); state.set({ ...blank('error'), error: issue(error) });
      }
      throw error;
    } finally { signal?.removeEventListener('abort', cancel); requests.delete(controller); }
  }
  function track(resource) { resources.add(resource); return () => { resource.clear(); resources.delete(resource); }; }
  async function logout() {
    // Clear private views before dispatch, including if the network result is unknown.
    refreshing++; invalidate(); state.set(blank('signing_out'));
    const ticket = refreshing;
    try {
      const value = await client.call('logout');
      if (ticket === refreshing) state.set(blank('signed_out')); return value;
    } catch (error) {
      if (ticket === refreshing) state.set({ ...blank('error'), error: issue(error) }); throw error;
    }
  }
  function navigation(action) {
    if (action === 'signin') return client.navigation('signin');
    const current = state.getSnapshot();
    if (action !== 'install' || current.status !== 'ready' || !current.organization) throw new ProductError('forbidden');
    return client.navigation('install', { slug: current.organization.slug });
  }
  return Object.freeze({ getSnapshot: state.getSnapshot, subscribe: state.subscribe,
    refreshSession, selectOrganization, call, track, logout, reset, navigation });
}
