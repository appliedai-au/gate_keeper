/** Add to the EXISTING admin page with its React and authenticated scope. No second provider. */
export const LEARNING_POLICY_LABEL = 'Require adversarial verification before banking lessons';
export function createLearningPolicyClient({ baseUrl, mode = 'preview', fetcher = globalThis.fetch } = {}) {
  async function request(method, input, signal) {
    if (mode !== 'live') throw new Error('preview_only');
    const url = new URL(baseUrl);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        url.pathname !== '/gatekeeper/product-v1' || baseUrl !== url.origin + url.pathname) throw new Error('setup_required');
    const timeout = AbortSignal.timeout(15000);
    const response = await fetcher(baseUrl + '/admin/learning-policy', { method, credentials: 'include',
      cache: 'no-store', redirect: 'error', signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      headers: { Accept: 'application/json', ...(method === 'PUT' ? { 'Content-Type': 'application/json', 'X-G8S-Request': '1' } : {}) },
      ...(method === 'PUT' ? { body: JSON.stringify(input) } : {}) });
    if ((response.headers.get('content-type') || '').split(';')[0] !== 'application/json') throw new Error('protocol_error');
    const reader = response.body?.getReader(); if (!reader) throw new Error('protocol_error');
    const chunks = []; let size = 0;
    try { for (;;) { const part = await reader.read(); if (part.done) break; size += part.value.byteLength;
      if (size > 16384) throw new Error('protocol_error'); chunks.push(part.value); }
    } finally { await reader.cancel().catch(() => {}); }
    const bytes = new Uint8Array(size); let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    const payload = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    if (!response.ok) throw new Error([401, 403].includes(response.status) ? 'forbidden' : response.status === 409 ? 'revision_conflict' : 'readback_required');
    const value = payload?.data;
    if (typeof value?.requireAdversarialVerification !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 1)
      throw new Error('protocol_error');
    return value;
  }
  return Object.freeze({ load: options => request('GET', null, options?.signal), save: (input, options) => request('PUT', input, options?.signal) });
}

export function createLearningPolicyController(client, { enabled = false } = {}) {
  const empty = () => Object.freeze({ status: enabled ? 'idle' : 'unavailable', value: null, revision: null,
    reason: '', error: null, automaticExecutionReady: false });
  let state = empty(), generation = 0, active = true, pending = false, abort;
  const listeners = new Set();
  const set = value => { state = Object.freeze(value); for (const fn of listeners) fn(); };
  const errorCode = error => ['forbidden', 'revision_conflict', 'preview_only'].includes(error?.message) ? error.message : 'readback_required';
  async function load() {
    if (!active || !enabled || pending) return { blocked: true };
    const mine = ++generation; abort = new AbortController(); pending = true;
    set({ ...empty(), status: 'loading' });
    try { const value = await client.load({ signal: abort.signal });
      if (!active || generation !== mine) return { applied: false };
      if (typeof value?.requireAdversarialVerification !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision < 1) throw new Error('protocol_error');
      set({ ...state, status: 'ready', value: value.requireAdversarialVerification, revision: value.revision,
        automaticExecutionReady: value.automaticExecutionReady === true }); return { applied: true };
    } catch (error) { if (active && generation === mine) set({ ...empty(), status: 'readback_required', error: errorCode(error) });
      return { applied: false };
    } finally { if (generation === mine) pending = false; }
  }
  function edit(value, reason) {
    if (!active || !enabled || pending || state.status !== 'ready' || typeof value !== 'boolean' ||
        typeof reason !== 'string' || reason.length > 500) return { blocked: true };
    set({ ...state, value, reason }); return { applied: true };
  }
  async function save() {
    if (!active || !enabled || pending || state.status !== 'ready' || typeof state.value !== 'boolean' || !state.reason.trim()) return { blocked: true };
    const mine = ++generation, input = { requireAdversarialVerification: state.value, expectedRevision: state.revision, reason: state.reason.trim() };
    abort = new AbortController(); pending = true; set({ ...state, status: 'saving', error: null });
    try { const value = await client.save(input, { signal: abort.signal });
      if (!active || generation !== mine) return { applied: false };
      if (typeof value?.requireAdversarialVerification !== 'boolean' || !Number.isSafeInteger(value.revision) || value.revision <= input.expectedRevision) throw new Error('protocol_error');
      set({ ...state, status: 'ready', value: value.requireAdversarialVerification, revision: value.revision, reason: '' }); return { applied: true };
    } catch (error) { if (active && generation === mine) set({ ...state, status: 'readback_required', error: errorCode(error) });
      return { applied: false };
    } finally { if (generation === mine) pending = false; }
  }
  return { getSnapshot: () => state, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); }, load, edit, save,
    start() { active = true; }, dispose() { active = false; generation++; abort?.abort(); pending = false; set(empty()); } };
}
export function createLearningPolicyPanel(React) {
  const { createElement: h, useMemo, useEffect, useSyncExternalStore } = React;
  return function LearningPolicyPanel({ client, isAdmin, scopeKey, mode = 'preview' }) {
    const controller = useMemo(() => createLearningPolicyController(client, { enabled: isAdmin === true && mode === 'live' }),
      [client, isAdmin, scopeKey, mode]);
    useEffect(() => { controller.start(); void controller.load(); return () => controller.dispose(); }, [controller]);
    const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
    const editable = state.status === 'ready' && typeof state.value === 'boolean';
    return h('section', { 'aria-label': 'Learning verification', 'aria-busy': ['loading', 'saving'].includes(state.status) },
      h('h2', null, 'Learning verification'),
      h('label', null, h('input', { type: 'checkbox', checked: state.value === true, disabled: !editable,
        'aria-checked': state.value === null ? 'mixed' : state.value,
        onChange: event => controller.edit(event.target.checked, state.reason) }), LEARNING_POLICY_LABEL),
      h('p', null, state.value === null ? 'Not reported. No policy is assumed.' : state.value
        ? 'Both G8S and Gitar findings and changes require independent adversarial verification.'
        : 'Adversarial verification is off. Deterministic evidence and explicit human confirmation remain mandatory.'),
      h('p', null, 'Build, type checks, tests, static analysis and secrets checks cannot be bypassed by this setting. Banking an example does not train or activate a model.'),
      h('label', null, 'Reason for policy change', h('textarea', { value: state.reason, maxLength: 500, disabled: !editable,
        onChange: event => controller.edit(state.value, event.target.value) })),
      h('button', { type: 'button', disabled: !editable || !state.reason.trim(), onClick: () => { void controller.save(); } }, 'Save verification policy'),
      h('button', { type: 'button', disabled: mode !== 'live' || isAdmin !== true || ['loading', 'saving'].includes(state.status),
        onClick: () => { void controller.load(); } }, 'Read saved policy'),
      state.error ? h('p', { role: 'alert' }, 'The change is not confirmed. Read back the saved policy before retrying.') : null,
      !state.automaticExecutionReady ? h('p', { role: 'status' }, 'Automatic verification execution is not commissioned. Unverified lessons remain blocked.') : null);
  };
}
