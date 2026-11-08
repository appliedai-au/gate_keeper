import test from 'node:test';
import assert from 'node:assert/strict';
import { ProductError } from '../integrations/base44/product/product-client.mjs';
import { createEditor, createConfigurationEditor } from '../integrations/base44/product/product-state.mjs';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };

test('a failed initial settings read cannot enable edits and a successful retry initializes the draft', async () => {
  let fails = true;
  const editor = createEditor({ save: async () => { assert.fail('no write expected'); }, read: async () => {
    if (fails) throw new ProductError('network_error');
    return { value: { text: 'actual server value' }, revision: 2 };
  } });
  await editor.reconcile();
  assert.equal(editor.getSnapshot().status, 'readback_required'); assert.equal(editor.getSnapshot().baseline, null);
  assert.throws(() => editor.edit({ text: 'unseen settings' }), /Load settings/u);
  assert.deepEqual(await editor.saveDraft(), { blocked: true });
  fails = false; await editor.reconcile();
  assert.deepEqual(editor.getSnapshot().draft, { text: 'actual server value' });
  assert.deepEqual(editor.getSnapshot().baseline, editor.getSnapshot().draft);
  assert.equal(editor.getSnapshot().dirty, false); assert.equal(editor.getSnapshot().revision, 2);
});

test('an initial read in flight cannot create an editable draft before its baseline exists', async () => {
  const ack = deferred(); const editor = createEditor({ read: () => ack.promise, save: async () => ({}) });
  const pending = editor.reconcile(); assert.equal(editor.getSnapshot().status, 'reconciling');
  assert.throws(() => editor.edit({ text: 'too soon' }), /Load settings/u);
  ack.resolve({ value: { text: 'server' }, revision: 1 }); await pending;
  assert.equal(editor.getSnapshot().draft.text, 'server'); assert.equal(editor.getSnapshot().dirty, false);
});

for (const value of [undefined, null, [], 'bad']) test('malformed readback values remain unloaded: ' + String(value), async () => {
  const editor = createEditor({ read: async () => ({ value }), save: async () => ({}) }); await editor.reconcile();
  assert.equal(editor.getSnapshot().baseline, null); assert.equal(editor.getSnapshot().error.code, 'protocol_error');
  assert.throws(() => editor.edit({ text: 'blocked' }), /Load settings/u);
});
for (const value of [undefined, null, [], 'bad']) test('malformed save acknowledgement keeps draft and requires readback: ' + String(value), async () => {
  const editor = createEditor({ read: async () => ({ value: {} }), save: async () => ({ value }) });
  editor.seed({ value: { text: 'old' } }); editor.edit({ text: 'mine' }); await editor.saveDraft();
  assert.equal(editor.getSnapshot().status, 'readback_required'); assert.equal(editor.getSnapshot().draft.text, 'mine');
  assert.equal(editor.getSnapshot().error.uncertain, true);
});

for (const revision of [undefined, null, 0, -1, 1.5, '1', Number.MAX_SAFE_INTEGER + 1])
  test('configuration reads require a real server revision: ' + String(revision), async () => {
    const editor = createConfigurationEditor(async () => ({ configuration: { text: 'server' }, revision }));
    await editor.reconcile(); assert.equal(editor.getSnapshot().error.code, 'protocol_error');
    assert.equal(editor.getSnapshot().baseline, null); assert.deepEqual(await editor.saveDraft(), { blocked: true });
  });

for (const revision of [null, 0, '1']) test('revisionless configuration save is blocked before dispatch: ' + String(revision), async () => {
  let calls = 0; const editor = createConfigurationEditor(async () => { calls++; return {}; });
  editor.seed({ value: { text: 'old' }, revision }); editor.edit({ text: 'mine' }); await editor.saveDraft();
  assert.equal(calls, 0); assert.equal(editor.getSnapshot().status, 'readback_required');
  assert.equal(editor.getSnapshot().error.code, 'revision_conflict');
});

test('configuration adapter sends the exact loaded revision and retains newer edits', async () => {
  const ack = deferred(), writes = [];
  const editor = createConfigurationEditor(async (action, params) => {
    if (action === 'settings') return { configuration: { text: 'old' }, revision: 7 };
    assert.equal(action, 'saveSettings'); writes.push(params); return ack.promise;
  });
  await editor.reconcile(); editor.edit({ text: 'submitted' }); const pending = editor.saveDraft();
  editor.edit({ text: 'later' });
  ack.resolve({ configuration: { text: 'submitted' }, revision: 8 }); await pending;
  assert.deepEqual(writes, [{ section: 'configuration', value: { configuration: { text: 'submitted' }, revision: 7 } }]);
  assert.equal(editor.getSnapshot().draft.text, 'later'); assert.equal(editor.getSnapshot().revision, 8);
  assert.equal(editor.getSnapshot().dirty, true);
});

test('missing revision in a successful settings write is uncertain, not an unconditional next save', async () => {
  const editor = createConfigurationEditor(async action => action === 'settings'
    ? { configuration: { text: 'old' }, revision: 1 } : { configuration: { text: 'mine' } });
  await editor.reconcile(); editor.edit({ text: 'mine' }); await editor.saveDraft();
  assert.equal(editor.getSnapshot().status, 'readback_required'); assert.equal(editor.getSnapshot().error.uncertain, true);
  assert.equal(editor.getSnapshot().revision, 1); assert.deepEqual(await editor.saveDraft(), { blocked: true });
});
