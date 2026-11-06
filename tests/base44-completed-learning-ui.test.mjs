// Execute actual compiled JSX with synthetic hooks and Base44 replies remotely.
// No browser, storage, hosted account, network or model invocation is involved.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import * as contract from '../integrations/base44/shared/learning-history-contract.js';
import { binding, nowMs, completedResponse, legacyCompletedResponse } from './base44-completed-learning-fixture.mjs';

const jsx = readFileSync(new URL('../integrations/base44/components/GateKeeperLearningHistory.jsx', import.meta.url), 'utf8');
const compiled = ts.transpileModule(jsx, { fileName: 'GateKeeperLearningHistory.jsx', reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.React, allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
assert.deepEqual((compiled.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
function compileContract(path) {
  const result = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    fileName: path.split('/').at(-1), reportDiagnostics: true,
    compilerOptions: { allowJs: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.deepEqual((result.diagnostics || []).filter(item => item.category === ts.DiagnosticCategory.Error), []);
  return result.outputText;
}
const compiledStatus = compileContract('../integrations/base44/shared/learning-status-contract.js');
const compiledHistory = compileContract('../integrations/base44/shared/learning-history-contract.js');
const flush = () => new Promise(resolve => setImmediate(resolve));

function ui(invoke, { browserNowMs = nowMs } = {}) {
  const hooks = [], effects = [], cleanup = [], timers = [], requests = [];
  let index = 0, elapsed = 0;
  function advance(milliseconds) {
    elapsed += milliseconds;
    for (const timer of timers) if (timer.active && timer.due <= elapsed) {
      timer.active = false; timer.callback();
    }
  }
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
    constructor(...args) { super(...(args.length ? args : [browserNowMs])); }
    static now() { return browserNowMs; }
  }
  const module = { exports: {} };
  let statusContract, historyContract, parseBrowserJSON;
  const context = vm.createContext({ module, exports: module.exports, Date: FixedDate,
    setTimeout(callback, milliseconds) {
      assert.ok(Number.isSafeInteger(milliseconds) && milliseconds >= 0);
      const timer = { callback, active: true, due: elapsed + milliseconds };
      timers.push(timer); return timer;
    },
    clearTimeout(timer) { if (timer) timer.active = false; },
    require(name) {
      if (name === 'react') return { default: react, ...react };
      if (name === '@/api/base44Client') return { base44: { functions: { async invoke(name, command) {
        requests.push({ name, command }); return parseBrowserJSON(JSON.stringify({ data: await invoke() }));
      } } } };
      if (name === './learning-status-contract.js') return statusContract;
      if (name === '../shared/learning-history-contract.js') return historyContract;
      if (name === './GateKeeperLearningStatus.css') return {};
      throw new Error('Unexpected history UI dependency: ' + name);
    },
  });
  // Evaluate the real contracts with the JSX on the browser's clock, including
  // any projector's default Date.now. Synthetic SDK JSON is parsed in this same
  // realm so strict plain-record validation matches actual browser objects.
  function loadContract(source, filename) {
    const loaded = { exports: {} };
    const initialise = new vm.Script('(function(module, exports, require) {\n' + source + '\n})',
      { filename }).runInContext(context);
    initialise(loaded, loaded.exports, context.require);
    return loaded.exports;
  }
  statusContract = loadContract(compiledStatus, 'learning-status-contract.cjs');
  historyContract = loadContract(compiledHistory, 'learning-history-contract.cjs');
  parseBrowserJSON = vm.runInContext('JSON.parse', context);
  new vm.Script(compiled.outputText, { filename: 'history-ui.cjs' }).runInContext(context);
  const render = () => { index = 0; return module.exports.default(); };
  const walk = value => Array.isArray(value) ? value.flatMap(walk) :
    value && typeof value === 'object' ? [value, ...walk(value.props?.children)] : [];
  const text = value => Array.isArray(value) ? value.map(text).join('') :
    value && typeof value === 'object' ? text(value.props?.children) : value == null ? '' : String(value);
  return { requests, advance, text: () => text(render()),
    async mount() { render(); for (const effect of effects.splice(0)) cleanup.push(effect()); await flush(); },
    refresh() { const button = walk(render()).find(node => node.type === 'button'); assert.ok(button); button.props.onClick(); },
    expire() { const timer = timers.findLast(value => value.active); assert.ok(timer); advance(timer.due - elapsed); },
    unmount() { for (const callback of cleanup.splice(0)) callback?.(); },
  };
}

test('actual history UI distinguishes immutable archive, fresh read and all source roles without claiming live learning', async () => {
  const view = ui(async () => completedResponse()); await view.mount();
  const text = view.text();
  assert.match(text, /Completed pilot/); assert.match(text, /10 of 10 completed/);
  assert.match(text, /Prices remain unknown/); assert.match(text, /Last read:/); assert.match(text, /Archive captured:/);
  assert.match(text, /does not represent new pilot activity/);
  assert.match(text, /does not apply them to ordinary private reviews/);
  for (const source of [binding.sourceCommit, binding.originalExecutionSourceCommit, binding.finalExecutionSourceCommit,
    binding.servingSourceCommit, binding.closureDigest])
    assert.equal(text.includes(source), true);
  assert.match(text, /Earlier Learning implementation \(B\)/);
  assert.match(text, /Recovery and final Learning implementation/);
  assert.match(text, /The recovery implementation later verified/);
  assert.doesNotMatch(text, /implementation \([DE]\)|[DE] later verified/);
  assert.match(text, /already-dispatched fourth proposal's original result/);
  assert.match(text, /Additional model calls for recovery0/);
  assert.match(text, /original model call is counted once/);
  assert.match(text, /unknown prices remain unknown/);
  assert.match(text, /do not claim a model improvement/);
  assert.deepEqual(view.requests.map(item => item.name), ['gatekeeperLearningHistory']);
  assert.equal(JSON.stringify(view.requests[0].command), '{}');
  view.unmount();
});

test('server-verified history renders identically with slow or fast browser clocks', async () => {
  const verified = contract.projectLearningHistoryResponse(completedResponse(), binding, nowMs);
  const reference = ui(async () => verified); await reference.mount();
  const expected = reference.text(); reference.unmount();
  for (const skew of [-86_400_000, -6000, 60_001, 86_400_000]) {
    const view = ui(async () => verified, { browserNowMs: nowMs + skew });
    await view.mount();
    assert.equal(view.text(), expected, 'device time cannot reject or rewrite server-verified timestamps');
    assert.match(view.text(), /Completed pilot/); assert.match(view.text(), /10 of 10 completed/);
    assert.equal(view.text().includes(binding.closureDigest), true);
    assert.deepEqual(view.requests.map(item => item.name), ['gatekeeperLearningHistory']);
    assert.equal(JSON.stringify(view.requests[0].command), '{}');
    view.unmount();
  }
});

test('partial, malformed-time and legacy replies never produce completed labels or fallback requests', async () => {
  const partial = completedResponse(); partial.status.counts.provisional = 1;
  const invalidTime = completedResponse(); invalidTime.checkedAt = '2026-02-30T00:00:00.000Z';
  const invalidOrder = completedResponse(); invalidOrder.archive.archivedAt = new Date(nowMs + 1).toISOString();
  const legacy = { schema: 'gk-learning-v2-status-response', checkedAt: new Date(nowMs).toISOString(), status: completedResponse().status };
  const missingFinal = completedResponse(); delete missingFinal.archive.finalExecutionSourceCommit;
  const inventedCall = completedResponse(); inventedCall.archive.recovery.additionalModelCalls = 1;
  const tooFewInvalid = completedResponse(); tooFewInvalid.status.counts.invalid = 3; tooFewInvalid.status.counts.noCoverage = 4;
  const hybrid = completedResponse(); hybrid.archive = legacyCompletedResponse().archive;
  for (const body of [partial, invalidTime, invalidOrder, legacy, legacyCompletedResponse(), missingFinal,
    inventedCall, tooFewInvalid, hybrid]) {
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

test('server freshness refusal remains unavailable on either skewed client clock', async () => {
  for (const skew of [-86_400_000, 86_400_000]) {
    const view = ui(async () => ({ error: 'learning_history_unavailable' }), { browserNowMs: nowMs + skew });
    await view.mount();
    assert.match(view.text(), /Pilot archive is unavailable/);
    assert.equal(view.text().includes('Completed pilot'), false);
    assert.equal(view.text().includes(binding.closureDigest), false);
    assert.deepEqual(view.requests.map(item => item.name), ['gatekeeperLearningHistory']);
    view.unmount();
  }
});

test('actual UI waits through the 60-second server budget and rejects a reply at its 75-second deadline', async () => {
  let resolveReply;
  const view = ui(() => new Promise(resolve => { resolveReply = resolve; }));
  await view.mount();
  view.advance(20_000);
  assert.match(view.text(), /Verifying the completed checkpoint/);
  assert.doesNotMatch(view.text(), /Pilot archive is unavailable/);
  view.advance(40_000);
  assert.match(view.text(), /Verifying the completed checkpoint/);
  resolveReply(completedResponse()); await flush();
  assert.match(view.text(), /Completed pilot/);
  view.refresh(); await flush();
  assert.equal(view.text().includes(binding.closureDigest), false);
  view.advance(74_999);
  assert.match(view.text(), /Verifying the completed checkpoint/);
  view.advance(1);
  assert.match(view.text(), /Pilot archive is unavailable/);
  resolveReply(completedResponse()); await flush();
  assert.doesNotMatch(view.text(), /Completed pilot|10 of 10 completed/);
  assert.equal(view.text().includes(binding.closureDigest), false);
  assert.deepEqual(view.requests.map(item => item.name), Array(2).fill('gatekeeperLearningHistory'));
  view.unmount();
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
