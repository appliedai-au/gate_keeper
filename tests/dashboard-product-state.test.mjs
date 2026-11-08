import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductError } from '../integrations/base44/product/product-client.mjs';
import { createResource, createEditor, createDashboardSession } from '../integrations/base44/product/product-state.mjs';

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const identity = (id = 'user-1', admin = false) => ({ user: { id, githubId: '101', login: 'test-user' }, isAdmin: admin,
  organizations: [{ id: 'org-a', slug: 'alpha', role: 'owner' }, { id: 'org-b', slug: 'beta', role: 'member' }], commands: [] });

test('latest report wins even when the old request ignores abort', async () => {
  const first = deferred(), second = deferred(); const signals = [];
  const resource = createResource((key, { signal }) => { signals.push(signal); return key === 'first' ? first.promise : second.promise; });
  const a = resource.load('first'), b = resource.load('second'); assert.equal(signals[0].aborted, true);
  second.resolve({ org: 'second' }); await b; first.resolve({ org: 'first' }); assert.deepEqual(await a, { applied: false });
  assert.deepEqual(resource.getSnapshot().data, { org: 'second' });
});
test('clearing a view invalidates pending success and failure', async () => {
  for (const reject of [false, true]) {
    const pending = deferred(), resource = createResource(() => pending.promise), done = resource.load();
    resource.clear(); if (reject) pending.reject(new Error('private')); else pending.resolve({ private: true });
    assert.deepEqual(await done, { applied: false }); assert.equal(resource.getSnapshot().data, null);
  }
});
test('read errors clear previous data and never become successful empty records', async () => {
  let failed = false; const resource = createResource(async () => { if (failed) throw new Error('private detail'); return { count: 7 }; });
  await resource.load(); failed = true; await resource.load();
  assert.equal(resource.getSnapshot().status, 'error'); assert.equal(resource.getSnapshot().data, null);
  assert.equal(resource.getSnapshot().error.message.includes('private'), false);
});
test('snapshots retain identity until a real change and are immutable', async () => {
  const resource = createResource(async () => ({ nested: { count: 1 } }));
  let notifications = 0; const off = resource.subscribe(() => notifications++);
  const before = resource.getSnapshot(); assert.equal(before, resource.getSnapshot());
  await resource.load(); assert.equal(notifications, 2);
  assert.throws(() => { resource.getSnapshot().data.nested.count = 5; }, TypeError);
  off(); resource.clear(); assert.equal(notifications, 2);
});

test('new edits survive completion of an older save', async () => {
  const ack = deferred(), requests = [];
  const editor = createEditor({ save: (request) => { requests.push(request); return ack.promise; }, read: async () => ({ value: {}, revision: 1 }) });
  editor.seed({ value: { text: 'old' }, revision: 1 }); editor.edit({ text: 'submitted' });
  const saving = editor.saveDraft(); assert.equal(editor.getSnapshot().status, 'saving');
  editor.edit({ text: 'newer' }); assert.deepEqual(await editor.saveDraft(), { blocked: true });
  ack.resolve({ value: { text: 'submitted' }, revision: 2 }); await saving;
  assert.deepEqual(requests, [{ value: { text: 'submitted' }, revision: 1 }]);
  assert.equal(editor.getSnapshot().draft.text, 'newer'); assert.equal(editor.getSnapshot().baseline.text, 'submitted');
  assert.equal(editor.getSnapshot().dirty, true); assert.equal(editor.getSnapshot().revision, 2);
});
test('an unchanged draft adopts server-normalized settings only after acknowledgement', async () => {
  const editor = createEditor({ save: async () => ({ value: { text: 'trimmed' }, revision: 3 }), read: async () => ({ value: {} }) });
  editor.seed({ value: { text: '' }, revision: 2 }); editor.edit({ text: ' trimmed ' }); await editor.saveDraft();
  assert.equal(editor.getSnapshot().draft.text, 'trimmed'); assert.equal(editor.getSnapshot().dirty, false);
  assert.deepEqual(await editor.saveDraft(), { unchanged: true });
});
for (const kind of ['uncertain', 'conflict', 'unexpected']) test('write requires readback and cannot be replayed: ' + kind, async () => {
  let saves = 0;
  const editor = createEditor({ save: async () => { saves++;
    throw kind === 'uncertain' ? new ProductError('network_error', { uncertain: true }) :
      kind === 'conflict' ? new ProductError('revision_conflict', { status: 409 }) : new Error('private');
  }, read: async () => ({ value: { text: 'server' }, revision: 4 }) });
  editor.seed({ value: { text: 'old' }, revision: 2 }); editor.edit({ text: 'mine' }); await editor.saveDraft();
  assert.equal(editor.getSnapshot().status, 'readback_required');
  assert.deepEqual(await editor.saveDraft(), { blocked: true }); assert.equal(saves, 1);
  assert.throws(() => editor.seed({ value: {} }), /reconcile/u);
  await editor.reconcile(); assert.equal(editor.getSnapshot().baseline.text, 'server');
  assert.equal(editor.getSnapshot().draft.text, 'mine'); assert.equal(editor.getSnapshot().revision, 4);
  assert.equal(editor.getSnapshot().dirty, true);
});
test('failed readback retains uncertainty and draft', async () => {
  const editor = createEditor({ save: async () => { throw new ProductError('timeout', { uncertain: true }); },
    read: async () => { throw new ProductError('network_error'); } });
  editor.seed({ value: { text: 'old' } }); editor.edit({ text: 'mine' }); await editor.saveDraft(); await editor.reconcile();
  assert.equal(editor.getSnapshot().status, 'readback_required'); assert.equal(editor.getSnapshot().draft.text, 'mine');
  assert.deepEqual(await editor.saveDraft(), { blocked: true });
});
test('scope reset prevents an old save or readback populating a new editor', async () => {
  for (const operation of ['save', 'read']) {
    const ack = deferred(); const editor = createEditor({ save: () => ack.promise, read: () => ack.promise });
    editor.seed({ value: { private: 'old' } }); editor.edit({ private: 'draft' });
    const done = operation === 'save' ? editor.saveDraft() : editor.reconcile();
    editor.clear(); ack.resolve({ value: { private: 'old-result' }, revision: 2 });
    assert.deepEqual(await done, { applied: false }); assert.equal(editor.getSnapshot().draft, null);
  }
});
test('edits made during readback also survive', async () => {
  const ack = deferred(); const editor = createEditor({ save: async () => ({}), read: () => ack.promise });
  editor.seed({ value: { text: 'old' }, revision: 1 }); const done = editor.reconcile();
  editor.edit({ text: 'later' }); ack.resolve({ value: { text: 'server' }, revision: 2 }); await done;
  assert.equal(editor.getSnapshot().draft.text, 'later'); assert.equal(editor.getSnapshot().baseline.text, 'server');
});

test('organization change clears all tracked private state before late result arrives', async () => {
  const ack = deferred(), requests = []; const session = createDashboardSession({
    call: async (action, params) => { if (action === 'session') return identity(); requests.push(params); return ack.promise; } });
  await session.refreshSession('alpha');
  const resource = createResource((params, options) => session.call('overview', params, options)); session.track(resource);
  const done = resource.load({}); session.selectOrganization('beta'); assert.equal(resource.getSnapshot().data, null);
  ack.resolve({ org: 'alpha' }); assert.deepEqual(await done, { applied: false });
  assert.equal(session.getSnapshot().organization.slug, 'beta'); assert.equal(requests[0].slug, 'alpha');
});
test('forged scope and ordinary-user admin requests never reach the transport', async () => {
  let count = 0; const session = createDashboardSession({ call: async action => { if (action === 'session') return identity(); count++; return {}; } });
  await session.refreshSession();
  await assert.rejects(session.call('overview', { slug: 'foreign' }), { code: 'forbidden' });
  for (const action of ['admin', 'saveLimits', 'savePause']) await assert.rejects(session.call(action, {}), { code: 'forbidden' });
  assert.throws(() => session.selectOrganization('foreign'), { code: 'forbidden' }); assert.equal(count, 0);
});
for (const status of [401, 403]) test('authoritative denial clears every private view: ' + status, async () => {
  const session = createDashboardSession({ call: async action => {
    if (action === 'session') return identity('owner', true);
    throw new ProductError(status === 401 ? 'unauthenticated' : 'forbidden', { status });
  } });
  await session.refreshSession(); const resource = createResource(async () => ({ secret: 'private record' }));
  session.track(resource); await resource.load();
  await assert.rejects(session.call('overview'), { status });
  assert.equal(session.getSnapshot().session, null); assert.equal(resource.getSnapshot().data, null);
});
test('stale denial for the previous organization cannot clear the newly selected scope', async () => {
  const ack = deferred(); const session = createDashboardSession({ call: action => action === 'session' ? Promise.resolve(identity()) : ack.promise });
  await session.refreshSession(); const done = session.call('overview'); session.selectOrganization('beta');
  ack.reject(new ProductError('forbidden', { status: 403 })); await assert.rejects(done, { code: 'aborted' });
  assert.equal(session.getSnapshot().status, 'ready'); assert.equal(session.getSnapshot().organization.slug, 'beta');
});
test('late session response cannot restore a signed-out identity', async () => {
  const ack = deferred(); const session = createDashboardSession({ call: action => action === 'session' ? ack.promise : Promise.resolve({ signedOut: true }) });
  const refresh = session.refreshSession(); await session.logout(); ack.resolve(identity()); await refresh;
  assert.equal(session.getSnapshot().status, 'signed_out'); assert.equal(session.getSnapshot().session, null);
});
test('uncertain logout clears local private data but does not falsely claim server logout', async () => {
  const session = createDashboardSession({ call: async action => {
    if (action === 'session') return identity(); throw new ProductError('network_error', { uncertain: true });
  } });
  await session.refreshSession(); await assert.rejects(session.logout(), { uncertain: true });
  assert.equal(session.getSnapshot().session, null); assert.equal(session.getSnapshot().status, 'error');
  assert.equal(session.getSnapshot().error.uncertain, true);
});
test('malformed session cannot infer administrator or organization authority', async () => {
  for (const data of [{}, { ...identity(), isAdmin: 'true' }, { ...identity(), organizations: [{ slug: '../admin' }] }]) {
    const session = createDashboardSession({ call: async () => data }); await session.refreshSession();
    assert.equal(session.getSnapshot().status, 'error'); assert.equal(session.getSnapshot().session, null);
  }
});
test('a missing requested organization is forbidden rather than silently showing another', async () => {
  const session = createDashboardSession({ call: async () => identity() }); await session.refreshSession('foreign');
  assert.equal(session.getSnapshot().error.code, 'forbidden'); assert.equal(session.getSnapshot().organization, null);
});
test('navigation requires current organization for install and never auto-navigates', async () => {
  const calls = []; const session = createDashboardSession({ call: async () => identity(), navigation: (action, params) => { calls.push({ action, params }); return 'test-only-navigation'; } });
  assert.throws(() => session.navigation('install'), { code: 'forbidden' });
  assert.equal(calls.length, 0); await session.refreshSession('beta');
  assert.equal(session.navigation('install'), 'test-only-navigation'); assert.equal(calls[0].params.slug, 'beta');
});
