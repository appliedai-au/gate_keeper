import { createResource, createConfigurationEditor, createDashboardSession } from './product-state.mjs';

/** Pass the application's existing React instance; do not install a second React. */
export function createDashboardBindings(React) {
  const { createContext, createElement, useContext, useMemo, useEffect, useSyncExternalStore } = React;
  const Context = createContext(null);
  const useStore = store => useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const scope = state => state.status === 'ready' ? JSON.stringify([
    state.session.user.id, state.organization?.id ?? null, state.organization?.slug ?? null, state.session.isAdmin]) : state.status;

  function Provider({ client, initialSlug, children }) {
    const model = useMemo(() => createDashboardSession(client), [client]);
    useEffect(() => { void model.refreshSession(initialSlug); return () => model.reset(); }, [model, initialSlug]);
    return createElement(Context.Provider, { value: model }, children);
  }
  function useDashboard() {
    const model = useContext(Context);
    if (!model) throw new Error('Place dashboard views inside the G8S product provider.');
    const state = useStore(model);
    return { model, state, scopeKey: scope(state) };
  }
  function useReport(action, params = {}, { enabled = true } = {}) {
    const { model, state: session, scopeKey } = useDashboard();
    // Parameters must be small serializable UI filters, never secret/authority data.
    const serialized = JSON.stringify(params);
    const resource = useMemo(() => createResource((input, options) => model.call(action, input, options)),
      [model, action, scopeKey, serialized, enabled]);
    useEffect(() => model.track(resource), [model, resource]);
    useEffect(() => {
      if (enabled && session.status === 'ready') void resource.load(JSON.parse(serialized));
      else resource.clear();
      return () => resource.clear();
    }, [resource, enabled, session.status, serialized]);
    const result = useStore(resource);
    return { ...result, reload: () => enabled && session.status === 'ready'
      ? resource.load(JSON.parse(serialized)) : Promise.resolve({ blocked: true }) };
  }
  function useConfigurationEditor() {
    const { model, state: session, scopeKey } = useDashboard();
    const editor = useMemo(() => createConfigurationEditor((...args) => model.call(...args)), [model, scopeKey]);
    useEffect(() => model.track(editor), [model, editor]);
    useEffect(() => {
      if (session.status === 'ready') void editor.reconcile();
      return () => editor.clear();
    }, [editor, session.status]);
    return { ...useStore(editor), edit: editor.edit, save: editor.saveDraft, readBack: editor.reconcile };
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
