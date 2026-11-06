// Execute actual compiled JSX with synthetic hooks and Base44 replies remotely.
// No browser, storage, hosted account, network or model invocation is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../integrations/base44/shared/learning-history-contract.js';
import { binding, nowMs, completedResponse } from './base44-completed-learning-fixture.mjs';

const jsx = readFileSync(new URL('../integrations/base44/components/GateKeeperLearningHistory.jsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(jsx, { fileName: 'GateKeeperLearningHistory.jsx', reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.React, allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.deepEqual((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
const flush = () => new Promise(resolve => setImmediate(resolve));

function ui(invoke) {
  const hooks = [], effects = [], cleanup = [], timers = [], requests = [];
  let index = 0;
  const react = {
    createElement(type, props, ...children) {
      const complete = { ...props, children };
      return typeof type === 'function' ? type(complete) : { type, props: complete };
    },
    useState(initial) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) hooks[slot] = typeof initial === 'function' ? initial() : initial;
      return [hooks[slot], value => { hooks[slot] = typeof value === 'function' ? value(hooks[slot]) : value; }];
    },
    useRef(initial) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) hooks[slot] = { current: initial };
      return hooks[slot];
    },
    useCallback(callback) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) hooks[slot] = callback;
      return hooks[slot];
    },
    useEffect(effect) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) { hooks[slot] = true; effects.push(effect); }
    },
  };
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [nowMs])); }
    static now() { return nowMs; }
  }
  const module = { exports: {} };
  const context = vm.createContext({ module, exports: module.exports, Date: FixedDate,
    setTimeout(callback) { const timer = { callback, active: true }; timers.push(timer); return timer; },
    clearTimeout(timer) { if (timer) timer.active = false; },
    require(name) {
      if (name === 'react') return { default: react, ...react };
      if (name === '@/api/base44Client') return { base44: { functions: { async invoke(name, command) {
        requests.push({ name, command }); return { data: await invoke() };
      } } } };
      if (name === '../shared/learning-history-contract.js') return contract;
      if (name === './GateKeeperLearningStatus.css') return {};
      throw new Error('Unexpected history UI dependency: ' + name);
    },
  });
  new vm.Script(compiled.outputText, { filename: 'history-ui.cjs' }).runInContext(context);
  const render = () => { index = 0; return module.exports.default(); };
  const walk = value => Array.isArray(value) ? value.flatMap(walk) :
    value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : [];
  const text = value => Array.isArray(value) ? value.map(text).join('') :
    value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
  return { requests, text: () => text(render()),
    async mount() { render(); for (const effect of effects.splice(0)) cleanup.push(effect()); await flush(); },
    refresh() { const button = walk(render()).find(node => node.type === 'button'); assert.ok(button); button.props.onClick(); },
    expire() { const timer = timers.findLast(value => value.active); assert.ok(timer); timer.active = false; timer.callback(); },
    unmount() { for (const callback of cleanup.splice(0)) callback?.(); },
  };
}

test('actual history UI distinguishes immutable archive, fresh read and A/B/C without claiming live learning', async () => {
  const view = ui(async () => completedResponse()); await view.mount();
  const text = view.text();
  assert.match(text, /Completed pilot/); assert.match(text, /10 of 10 completed/);
  assert.match(text, /Prices remain unknown/); assert.match(text, /Last read:/); assert.match(text, /Archive captured:/);
  assert.match(text, /does not represent new pilot activity/);
  assert.match(text, /does not apply them to ordinary private reviews/);
  for (const source of [binding.sourceCommit, binding.executionSourceCommit, binding.servingSourceCommit, binding.closureDigest])
    assert.equal(text.includes(source), true);
  assert.deepEqual(view.requests.map(item => item.name), ['gatekeeperLearningHistory']);
  assert.equal(JSON.stringify(view.requests[0].command), '{}');
  view.unmount();
});

test('partial, stale and legacy replies never produce completed labels or fallback requests', async () => {
  const partial = completedResponse(); partial.status.counts.provisional = 1;
  const stale = completedResponse(); stale.checkedAt = new Date(nowMs - 60_001).toISOString();
  const legacy = { schema: 'gk-learning-v2-status-response', checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status };
  for (const body of [partial, stale, legacy]) {
    const view = ui(async () => body); await view.mount();
    const text = view.text();
    assert.equal(text.includes('Completed pilot'), false); assert.equal(text.includes('10 of 10 completed'), false);
    assert.equal(text.includes(binding.closureDigest), false);
    assert.match(text, /could not be verified/);
    assert.deepEqual(view.requests.map(item => item.name), ['gatekeeperLearningHistory']);
    view.unmount();
  }
  const denied = ui(async () => { throw Object.assign(new Error('synthetic-private-error'), { response: { status: 401 } }); });
  await denied.mount(); assert.match(denied.text(), /Sign in to view/);
  assert.equal(denied.text().includes('synthetic-private-error'), false); denied.unmount();
});

test('refresh clears prior history and timeout/unmount prevent late replies restoring a completed snapshot', async () => {
  let count = 0, resolveLate;
  const view = ui(() => {
    count++;
    if ([1, 3].includes(count)) return Promise.resolve(completedResponse());
    return new Promise(resolve => { resolveLate = resolve; });
  });
  await view.mount(); assert.match(view.text(), /Completed pilot/);
  view.refresh(); await flush();
  assert.equal(view.text().includes('Completed pilot'), false);
  assert.equal(view.text().includes(binding.closureDigest), false);
  view.expire(); resolveLate(completedResponse()); await flush();
  assert.match(view.text(), /Pilot archive is unavailable/);
  assert.equal(view.text().includes('10 of 10 completed'), false);
  view.refresh(); await flush(); assert.match(view.text(), /Completed pilot/);
  view.refresh(); await flush(); view.unmount();
  const unmounted = view.text(); resolveLate(completedResponse()); await flush();
  assert.equal(view.text(), unmounted);
  assert.deepEqual(view.requests.map(item => item.name), Array(4).fill('gatekeeperLearningHistory'));
});
