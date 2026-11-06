// Remote source-gate regressions. Compile the actual JSX and supply synthetic
// hooks, storage and Base44 responses; no browser account, network or inference.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../integrations/base44/shared/review-contract.js';
import * as recovery from '../integrations/base44/shared/review-pending.js';

const sourceCommit = 'a'.repeat(40), storageKey = 'gatekeeper-review-pending-v1';
const reply = (job = null, jobs = []) => ({ version: 1, sourceCommit,
  scope: 'configured_admin_owner', enabled: true, job, jobs });
const job = (requestKey, state = 'complete') => ({
  id: randomUUID(), requestKey, file: 'test.ts', language: 'typescript', lineCount: 1,
  state, code: null, sourceCommit, createdAt: '2026-11-06T00:00:00.000Z',
  updatedAt: '2026-11-06T00:00:00.000Z', estimatedCostUsd: null, billingStatus: 'unsettled',
  findings: state === 'complete' ? [] : null,
});
const summary = value => { const { findings, ...rest } = value; return rest; };

const jsx = readFileSync(new URL('../integrations/base44/components/GateKeeperReview.jsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(jsx, { fileName: 'GateKeeperReview.jsx', reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.React, allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.deepEqual((compiled.diagnostics || []).filter(value => value.category === ts.DiagnosticCategory.Error), []);

function harness(invoke, initialPending = null) {
  const storage = new Map(initialPending ? [[storageKey, JSON.stringify(initialPending)]] : []);
  const hooks = [], effects = [], timers = [], calls = [];
  let index = 0;
  const state = initial => {
    const slot = index++;
    if (!Object.hasOwn(hooks, slot)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
    return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value; }];
  };
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState: state,
    useRef(initial) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) hooks[slot] = { current: initial };
      return hooks[slot];
    },
    useEffect(effect) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) { hooks[slot] = true; effects.push(effect); }
    },
  };
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, crypto: { randomUUID },
    sessionStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value),
      removeItem: key => storage.delete(key) },
    setTimeout(callback) { const timer = { callback, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.active = false; },
    require(name) {
      if (name === 'react') return { default: react, ...react };
      if (name === '@/api/base44Client') return { base44: { functions: { async invoke(name, command) {
        assert.equal(name, 'gatekeeperReview'); calls.push(command); return { data: await invoke(command) };
      } } } };
      if (name === '../shared/review-contract.js') return contract;
      if (name === '../shared/review-pending.js') return recovery;
      if (name === './GateKeeperReview.css') return {};
      throw new Error('Unexpected review UI dependency: ' + name);
    },
  });
  new vm.Script(compiled.outputText, { filename: 'review-ui.cjs' }).runInContext(context);
  const render = () => { index = 0; return module.exports.default(); };
  const walk = value => {
    if (Array.isArray(value)) return value.flatMap(walk);
    if (!value || typeof value !== 'object') return [];
    return [value, ...walk(value.props?.children)];
  };
  const text = value => Array.isArray(value) ? value.map(text).join('')
    : value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
  const element = predicate => {
    const found = walk(render()).find(predicate);
    assert.ok(found, 'Expected UI element is present'); return found;
  };
  return { storage, calls, render, element,
    async mount() { render(); effects.splice(0).forEach(effect => effect()); await flush(); },
    button: label => element(node => node.type === 'button' && text(node) === label),
    form: () => element(node => node.type === 'form'),
    expire() { const timer = timers.findLast(value => value.active); assert.ok(timer); timer.active = false; timer.callback(); },
  };
}
const flush = () => new Promise(resolve => setImmediate(resolve));
const event = { preventDefault() {} };
function fill(ui, code = 'const count = 1;') {
  ui.element(node => node.type === 'input' && node.props.placeholder === 'src/api/invoices.ts').props.onChange({ target: { value: 'test.ts' } });
  ui.element(node => node.type === 'textarea' && node.props.maxLength === 4000).props.onChange({ target: { value: 'Return count.' } });
  ui.element(node => node.type === 'textarea' && node.props.className === 'gk-review-code').props.onChange({ target: { value: code } });
  ui.element(node => node.type === 'input' && node.props.type === 'checkbox').props.onChange({ target: { checked: true } });
}

test('matching submission keys recover lost IDs; unrelated terminal history cannot clear custody hints', () => {
  const key = randomUUID(), pending = { key, jobId: null }, saved = job(key), unrelated = job(randomUUID());
  assert.deepEqual(recovery.pendingAfterReply(pending, reply(unrelated)), pending);
  assert.equal(recovery.pendingAfterReply(pending, reply(saved)), null);
  assert.equal(recovery.pendingAfterReply(pending, reply(null, [summary(saved)])), null);
  const running = { ...saved, state: 'running', findings: null };
  assert.deepEqual(recovery.pendingAfterReply(pending, reply(null, [summary(running)])), { key, jobId: saved.id });
  assert.deepEqual(recovery.pendingAfterReply({ key: null, jobId: saved.id }, reply(saved)), null);
  assert.equal(recovery.parsePendingRequest('{"key":"invalid","jobId":null}'), null);
});

test('actual UI recovers a matching terminal request by history without reposting ambiguous or edited input', async () => {
  let saved;
  const ui = harness(async command => {
    if (command.action === 'info') return reply();
    if (command.action === 'submit') { saved = job(command.idempotencyKey); throw new Error('review_unavailable'); }
    if (command.action === 'list') return reply(null, [summary(saved)]);
    assert.fail('Recovery must not dispatch: ' + command.action);
  });
  await ui.mount(); fill(ui);
  await ui.form().props.onSubmit(event);
  assert.deepEqual(JSON.parse(ui.storage.get(storageKey)), { key: saved.requestKey, jobId: null });
  fill(ui, 'const changed = 2;');
  assert.equal(ui.button('Start review').props.disabled, true);
  await ui.form().props.onSubmit(event); // Guard also covers a programmatic submit.
  assert.equal(ui.calls.filter(command => command.action === 'submit').length, 1);
  await ui.button('Find saved submission').props.onClick();
  assert.equal(ui.storage.has(storageKey), false);
  assert.equal(ui.button('Start review').props.disabled, false);
  assert.deepEqual(ui.calls.map(command => command.action), ['info', 'submit', 'list']);
});

test('explicit new draft performs no request, uses a fresh key later, and rejects a late old acknowledgement', async () => {
  let resolveOld, oldSaved, newSaved;
  const ui = harness(command => {
    if (command.action === 'info') return reply();
    if (command.action === 'submit' && !oldSaved) {
      oldSaved = job(command.idempotencyKey, 'queued');
      return new Promise(resolve => { resolveOld = resolve; });
    }
    if (command.action === 'submit') { newSaved = job(command.idempotencyKey, 'queued'); return reply(newSaved); }
    if (command.action === 'start') { assert.equal(command.jobId, newSaved.id); return reply({ ...newSaved, state: 'session_dispatch' }); }
    assert.fail('Unexpected UI action: ' + command.action);
  });
  await ui.mount(); fill(ui);
  const first = ui.form().props.onSubmit(event);
  ui.expire(); await flush(); await first;
  const before = ui.calls.length;
  ui.button('Prepare a new review').props.onClick();
  assert.equal(ui.calls.length, before, 'reset is local and never retries/cancels the saved request');
  assert.equal(ui.storage.has(storageKey), false);
  fill(ui, 'const replacement = 2;');
  await ui.form().props.onSubmit(event);
  assert.notEqual(newSaved.requestKey, oldSaved.requestKey);
  const current = ui.storage.get(storageKey);
  resolveOld(reply(oldSaved)); await flush();
  assert.equal(ui.storage.get(storageKey), current, 'late acknowledgement cannot replace the new pending reference');
  assert.equal(ui.calls.filter(command => command.action === 'submit' && command.idempotencyKey === oldSaved.requestKey).length, 1);
  assert.equal(ui.calls.filter(command => command.action === 'start').length, 1);
  assert.equal(ui.calls.find(command => command.action === 'start').jobId, newSaved.id);
});
