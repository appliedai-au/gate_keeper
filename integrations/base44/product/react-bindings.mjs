import { ProductError } from './product-client.mjs';
import { createResource, createConfigurationEditor, createDashboardSession } from './product-state.mjs';

// Auto-loading hooks are for reports only. Mutations and exports require explicit UI actions.
const REPORT_ACTIONS = Object.freeze(['overview', 'reviews', 'run', 'settings', 'repositories', 'admin']);

/** Pass the application's existing React instance; do not install a second React. */
export function createDashboardBindings(React) {
  const { createContext, createElement, useContext, useMemo, useEffect, useSyncExternalStore } = React;
  const Context = createContext(null);
  const useStore = store => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const scope = state => state.status === 'ready' ? JSON.stringify([
    state.session.user.id, state.organization?.id ?? null, state.organization?.slug ?? null, state.session.isAdmin]) : state.status;

  function Provider({ client, initialSlug, children }) {
    // A route change must start with an empty model during render, not briefly
    // expose the previous org until a passive refresh effect runs.
    const model = useMemo(() => createDashboardSession(client), [client, initialSlug]);
    useEffect(() => { void model.refreshSession(initialSlug); return () => model.reset(); }, [model, initialSlug]);
    return createElement(Context.Provider, { value: model }, children);
  }
  function useDashboard() {
    const model = useContext(Context);
    if (!model) throw new Error('Place dashboard views inside the G8S product provider.');
    const state = useStore(model);
    return { model, state, scopeKey: scope(state) };
  }
  // Captured snapshot identity also distinguishes same-org reauthentication.
  // Mount custody prevents a saved callback from reviving an unmounted view.
  function scopedCall(model, session, enabled = true) {
    const lifetime = { active: false };
    const current = () => lifetime.active && enabled && session.status === 'ready' && model.getSnapshot() === session;
    const request = (...args) => {
      if (!current()) throw new ProductError('aborted');
      return model.call(...args);
    };
    return { lifetime, current, request };
  }
  function useReport(action, params = {}, { enabled = true } = {}) {
    const { model, state: session } = useDashboard();
    if (!REPORT_ACTIONS.includes(action)) throw new ProductError('invalid_request');
    // Parameters must be small serializable UI filters, never secret/authority data.
    const serialized = JSON.stringify(params);
    const handle = useMemo(() => {
      const bound = scopedCall(model, session, enabled);
      return { ...bound, resource: createResource((input, options) => bound.request(action, input, options)) };
    }, [model, action, session, serialized, enabled]);
    const { resource } = handle;
    useEffect(() => {
      handle.lifetime.active = true;
      const untrack = model.track(resource);
      return () => { handle.lifetime.active = false; untrack(); };
    }, [model, handle, resource]);
    useEffect(() => {
      if (handle.current()) void resource.load(JSON.parse(serialized));
      else resource.clear();
      return () => resource.clear();
    }, [handle, resource, serialized]);
    const result = useStore(resource);
    return { ...result, reload: () => handle.current()
      ? resource.load(JSON.parse(serialized)) : Promise.resolve({ blocked: true }) };
  }
  function useConfigurationEditor() {
    const { model, state: session } = useDashboard();
    const handle = useMemo(() => {
      const bound = scopedCall(model, session);
      return { ...bound, editor: createConfigurationEditor(bound.request) };
    }, [model, session]);
    const { editor } = handle;
    useEffect(() => {
      handle.lifetime.active = true;
      const untrack = model.track(editor);
      return () => { handle.lifetime.active = false; untrack(); };
    }, [model, handle, editor]);
    useEffect(() => {
      if (handle.current()) void editor.reconcile();
      return () => editor.clear();
    }, [handle, editor]);
    return { ...useStore(editor),
      edit(value) { if (!handle.current()) throw new ProductError('aborted'); editor.edit(value); },
      save: () => handle.current() ? editor.saveDraft() : Promise.resolve({ blocked: true }),
      readBack: () => handle.current() ? editor.reconcile() : Promise.resolve({ blocked: true }),
    };
  }
  /** The existing UI renders the controls. No redirects or writes occur during render. */
  return Object.freeze({ Provider, useDashboard, useReport, useConfigurationEditor });
}

/** Screen-to-action map for wiring existing views, not a replacement router. */
export const SCREEN_READS = Object.freeze({
  overview: { action: 'overview' }, reviews: { action: 'reviews' }, runDetail: { action: 'run' },
  configuration: { action: 'settings', section: 'configuration' },
  organization: { action: 'settings', section: 'organization' },
  integrations: { action: 'settings', section: 'integrations' }, rules: { action: 'settings', section: 'rules' },
  audit: { action: 'settings', section: 'audit' }, billing: { action: 'settings', section: 'billing' },
  repositories: { action: 'repositories' },
  adminOverview: { action: 'admin', section: 'overview' }, adminUsers: { action: 'admin', section: 'users' },
  adminInstallations: { action: 'admin', section: 'installations' },
  adminRepositories: { action: 'admin', section: 'repositories' }, adminRuns: { action: 'admin', section: 'runs' },
  adminAudit: { action: 'admin', section: 'audit' },
});
