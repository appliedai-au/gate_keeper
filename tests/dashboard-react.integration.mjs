// Actual React DOM with a synthetic DOM and transport. Not hosted/browser OAuth acceptance.
// Kept outside *.test.mjs: only the separate dashboard React recipe installs these test dependencies.
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { JSDOM } from 'jsdom';
import { renderToString } from 'react-dom/server';
import { createDashboardBindings } from '../integrations/base44/product/react-bindings.mjs';
import { createProductClient, ProductError } from '../integrations/base44/product/product-client.mjs';

const { createElement: h, act, StrictMode } = React;
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identity = (admin = false) => ({ user: { id: 'synthetic-user', githubId: '101', login: 'synthetic-owner' }, isAdmin: admin,
  organizations: [{ id: 'synthetic-alpha', slug: 'alpha', role: 'owner' }, { id: 'synthetic-beta', slug: 'beta', role: 'owner' }] });
let dom, createRoot;
const globals = new Map();
before(async () => {
  dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'https://g8s.test' });
  const values = { window: dom.window, document: dom.window.document, HTMLElement: dom.window.HTMLElement,
    Node: dom.window.Node, Event: dom.window.Event, MouseEvent: dom.window.MouseEvent,
    IS_REACT_ACT_ENVIRONMENT: true, fetch: () => { throw new Error('External transport forbidden in React fixtures'); } };
  for (const [name, value] of Object.entries(values)) {
    globals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  }
  ({ createRoot } = await import('react-dom/client'));
});
after(() => {
  dom.window.close();
  for (const [name, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
  }
});

async function mount(t, client, makeView, initial = {}) {
  const api = createDashboardBindings(React), View = makeView(api);
  const container = document.createElement('div'); document.body.appendChild(container);
  const root = createRoot(container); let closed = false;
  let configuration = { client, slug: 'alpha', props: {}, strict: false, ...initial };
  async function render(next = {}) {
    configuration = { ...configuration, ...next };
    const tree = h(api.Provider, { client: configuration.client, initialSlug: configuration.slug }, h(View, configuration.props));
    await act(async () => { root.render(configuration.strict ? h(StrictMode, null, tree) : tree); });
  }
  async function unmount() {
    if (closed) return; closed = true;
    await act(async () => { root.unmount(); }); container.remove();
  }
  t.after(unmount); await render(); return { container, render, unmount };
}
const click = async (container, selector) => {
  const element = container.querySelector(selector); assert.ok(element, selector);
  await act(async () => { element.dispatchEvent(new MouseEvent('click', { bubbles: true })); });
};

for (const action of ['finding', 'saveSettings', 'saveRepository', 'refreshRepositories', 'disableAllRepositories',
  'saveMember', 'removeMember', 'saveLimits', 'savePause', 'logout', 'session', 'auditExport', 'unknown']) {
  test('report hook rejects non-report action before render/effects: ' + action, () => {
    const api = createDashboardBindings(React); let calls = 0;
    function InvalidReport() { api.useReport(action, { confirmed: true }); return h('span', null, 'unexpected'); }
    assert.throws(() => renderToString(h(api.Provider, { client: { call() { calls++; return {}; } } }, h(InvalidReport))),
      { code: 'invalid_request' });
    assert.equal(calls, 0);
  });
}

test('changing the routed organization never renders prior-scope data, even before passive effects', async t => {
  const frames = [];
  const client = { call: async (action, p) => action === 'session' ? identity() : { scope: p.slug } };
  const host = await mount(t, client, api => function View({ route }) {
    const session = api.useDashboard(), report = api.useReport('overview');
    frames.push({ route, org: session.state.organization?.slug, value: report.data?.scope });
    return h('output', null, report.data?.scope ?? session.state.status);
  }, { props: { route: 'alpha' } });
  assert.equal(host.container.textContent, 'alpha');
  await host.render({ slug: 'beta', props: { route: 'beta' } });
  assert.equal(host.container.textContent, 'beta');
  const changedFrames = frames.filter(frame => frame.route === 'beta');
  assert.ok(changedFrames.length > 0);
  assert.equal(changedFrames.some(frame => frame.org === 'alpha' || frame.value === 'alpha'), false);
});

test('a retained report callback cannot query a newly selected organization', async t => {
  const calls = []; let current;
  const host = await mount(t, { call: async (action, p) => {
    if (action === 'session') return identity(); calls.push({ action, ...p }); return { scope: p.slug };
  } }, api => function View() {
    current = { dashboard: api.useDashboard(), report: api.useReport('overview') };
    return h('output', null, current.report.data?.scope ?? 'loading');
  });
  const oldReload = current.report.reload;
  await act(async () => { current.dashboard.model.selectOrganization('beta'); });
  assert.equal(host.container.textContent, 'beta');
  const before = calls.length; let result;
  await act(async () => { result = await oldReload(); });
  assert.deepEqual(result, { blocked: true }); assert.equal(calls.length, before);
});

test('disabling or unmounting a report invalidates its previously returned reload callback', async t => {
  let report, reads = 0;
  const host = await mount(t, { call: async action => action === 'session' ? identity() : { count: ++reads } },
    api => function View({ enabled }) { report = api.useReport('overview', {}, { enabled }); return h('output', null, report.data?.count ?? 'empty'); },
    { props: { enabled: true } });
  const oldReload = report.reload;
  await host.render({ props: { enabled: false } });
  assert.equal(host.container.textContent, 'empty');
  const before = reads; let result;
  await act(async () => { result = await oldReload(); });
  assert.deepEqual(result, { blocked: true }); assert.equal(reads, before);
  await host.render({ props: { enabled: true } });
  const lastReload = report.reload, beforeUnmount = reads;
  await host.unmount(); assert.deepEqual(await lastReload(), { blocked: true }); assert.equal(reads, beforeUnmount);
});

test('latest filters win in a rendered report when an aborted transport resolves late', async t => {
  const slow = deferred(); let slowSignal;
  const host = await mount(t, { call: async (action, p, options) => {
    if (action === 'session') return identity();
    if (p.filters.page === 1) { slowSignal = options.signal; return slow.promise; }
    return { page: p.filters.page };
  } }, api => function View({ page }) {
    const report = api.useReport('overview', { filters: { page } });
    return h('output', null, report.data?.page ?? report.status);
  }, { props: { page: 1 } });
  await host.render({ props: { page: 2 } });
  assert.equal(slowSignal.aborted, true); assert.equal(host.container.textContent, '2');
  await act(async () => { slow.resolve({ page: 1 }); });
  assert.equal(host.container.textContent, '2');
});

test('StrictMode replays mounts without writes, loops or resurrection of an aborted session', async t => {
  const sessions = [], operations = []; let report;
  const host = await mount(t, { call: async (action, p) => {
    operations.push(action);
    if (action === 'session') { const value = deferred(); sessions.push(value); return value.promise; }
    return { scope: p.slug };
  } }, api => function View() { report = api.useReport('overview'); return h('output', null, report.data?.scope ?? report.status); },
  { strict: true });
  assert.equal(sessions.length, 2);
  await act(async () => { sessions[1].resolve(identity()); });
  assert.equal(host.container.textContent, 'alpha');
  await act(async () => { sessions[0].resolve({ ...identity(), organizations: [{ id: 'wrong', slug: 'wrong', role: 'owner' }] }); });
  assert.equal(host.container.textContent, 'alpha');
  assert.ok(operations.length < 10); assert.ok(operations.every(action => ['session', 'overview'].includes(action)));
});

test('rendered settings require real first read, preserve later edits and send the exact revision once', async t => {
  const ack = deferred(), writes = []; let form;
  const host = await mount(t, { call: async (action, p) => {
    if (action === 'session') return identity();
    if (action === 'settings') return { configuration: { text: 'original' }, revision: 4 };
    assert.equal(action, 'saveSettings'); writes.push(p); return ack.promise;
  } }, api => function View() {
    form = api.useConfigurationEditor();
    return h('section', null,
      h('output', null, JSON.stringify({ status: form.status, draft: form.draft, baseline: form.baseline })),
      h('button', { id: 'edit', disabled: form.baseline === null, onClick: () => form.edit({ text: 'submitted' }) }, 'Edit'),
      h('button', { id: 'save', disabled: !form.dirty || form.status === 'saving', onClick: () => { void form.save(); } }, 'Save'),
      h('button', { id: 'later', disabled: form.baseline === null, onClick: () => form.edit({ text: 'later' }) }, 'Edit again'));
  });
  assert.equal(form.draft.text, 'original');
  await click(host.container, '#edit'); await click(host.container, '#save'); await click(host.container, '#later');
  assert.equal(writes.length, 1); assert.equal(writes[0].value.revision, 4); assert.equal(writes[0].slug, 'alpha');
  await act(async () => { ack.resolve({ configuration: { text: 'submitted' }, revision: 5 }); });
  assert.equal(form.draft.text, 'later'); assert.equal(form.baseline.text, 'submitted'); assert.equal(form.revision, 5);
  assert.equal(form.dirty, true); assert.equal(writes.length, 1);
});

test('failed initial settings read recovers and old editor callbacks cannot target a later organization', async t => {
  let form, model, fail = true; const requests = [];
  const host = await mount(t, { call: async (action, p) => {
    if (action === 'session') return identity(); requests.push({ action, ...p });
    if (fail) throw new ProductError('network_error');
    return { configuration: { scope: p.slug }, revision: 1 };
  } }, api => function View() {
    model = api.useDashboard().model; form = api.useConfigurationEditor();
    return h('output', null, form.draft?.scope ?? form.status);
  });
  assert.equal(form.status, 'readback_required'); assert.equal(form.draft, null);
  assert.throws(() => form.edit({ scope: 'never-loaded' }));
  fail = false; await act(async () => { await form.readBack(); });
  assert.equal(host.container.textContent, 'alpha');
  const staleRead = form.readBack, staleSave = form.save;
  await act(async () => { model.selectOrganization('beta'); });
  assert.equal(host.container.textContent, 'beta'); const before = requests.length;
  let readResult, saveResult;
  await act(async () => { readResult = await staleRead(); saveResult = await staleSave(); });
  assert.deepEqual(readResult, { blocked: true }); assert.deepEqual(saveResult, { blocked: true });
  assert.equal(requests.length, before);
});

test('same-scope session refresh creates usable new bindings and invalidates old callbacks', async t => {
  let current, reads = 0;
  const host = await mount(t, { call: async action => action === 'session' ? identity() : { value: ++reads } },
    api => function View() { current = { ...api.useDashboard(), report: api.useReport('overview') }; return h('output', null, current.report.data?.value ?? 'empty'); });
  const old = current.report.reload; await act(async () => { await current.model.refreshSession('alpha'); });
  assert.equal(current.report.status, 'ready'); const before = reads;
  assert.deepEqual(await old(), { blocked: true }); assert.equal(reads, before);
  await act(async () => { await current.report.reload(); });
  assert.equal(reads, before + 1); assert.equal(host.container.textContent, String(reads));
});

test('authoritative denial removes rendered private data and ordinary users make no admin reads', async t => {
  let current, deny = false; const actions = [];
  const host = await mount(t, { call: async action => {
    if (action === 'session') return identity(); actions.push(action);
    if (deny) throw new ProductError('unauthenticated', { status: 401 }); return { title: 'private-synthetic-title' };
  } }, api => function View() {
    const dashboard = api.useDashboard(); current = api.useReport('overview');
    const admin = api.useReport('admin', { section: 'overview' }, { enabled: dashboard.state.session?.isAdmin === true });
    return h('output', null, current.data?.title ?? dashboard.state.status, admin.data ? 'unexpected-admin' : '');
  });
  assert.match(host.container.textContent, /private-synthetic-title/u); deny = true;
  await act(async () => { await current.reload(); });
  assert.equal(host.container.textContent.includes('private-synthetic-title'), false);
  assert.equal(actions.includes('admin'), false);
});

test('preview React tree stays network-inert and performs no automatic navigation', async t => {
  let requests = 0, current;
  const client = createProductClient({ mode: 'preview', fetcher: async () => { requests++; throw new Error('must not fetch'); } });
  const host = await mount(t, client, api => function View() {
    current = api.useDashboard(); const report = api.useReport('overview');
    return h('output', null, current.state.error?.code ?? report.status);
  }, { strict: true });
  assert.equal(host.container.textContent, 'preview_only'); assert.equal(requests, 0);
  assert.throws(() => current.model.navigation('signin'), { code: 'preview_only' }); assert.equal(requests, 0);
});
