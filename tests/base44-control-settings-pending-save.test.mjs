// Actual JSX, synthetic React hooks and delayed Base44 responses. No hosted
// account, external request, policy-store mutation or model call is involved.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = readFileSync(new URL(
  "../integrations/base44/components/GateKeeperControlSettings.jsx", import.meta.url), "utf8");
const profiles = JSON.parse(readFileSync(new URL(
  "../integrations/base44/data/controlProfiles.json", import.meta.url), "utf8"));
const compiled = ts.transpileModule(source, { fileName: "GateKeeperControlSettings.jsx", reportDiagnostics: true,
  compilerOptions: { jsx: ts.JsxEmit.React, allowJs: true, module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022 } });
assert.deepEqual((compiled.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error), []);
const flush = () => new Promise(resolve => setImmediate(resolve));
const plain = value => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function ui() {
  const hooks = [], effects = [], requests = [], pending = [];
  let index = 0;
  const react = {
    createElement(type, props, ...children) { return { type, props: { ...props, children } }; },
    useState(initial) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) hooks[slot] = initial;
      return [hooks[slot], next => { hooks[slot] = typeof next === "function" ? next(hooks[slot]) : next; }];
    },
    useCallback(callback) { index++; return callback; },
    useEffect(effect) {
      const slot = index++;
      if (!Object.hasOwn(hooks, slot)) { hooks[slot] = true; effects.push(effect); }
    },
  };
  const module = { exports: {} };
  vm.runInNewContext(compiled.outputText, { module, exports: module.exports,
    require(name) {
      if (name === "react") return { default: react, ...react };
      if (name === "../data/controlProfiles.json") return { default: profiles };
      if (name === "@/api/base44Client") return { base44: { functions: { invoke(functionName, command) {
        requests.push({ functionName, command: plain(command) });
        if (command.action === "load") return Promise.resolve({ data: {
          status: "draft_only", controls: { ...profiles.defaults }, revision: 4,
        } });
        const result = deferred(); pending.push(result); return result.promise;
      } } } };
      throw new Error("Unexpected dependency: " + name);
    },
  }, { timeout: 2000 });
  const render = () => { index = 0; return module.exports.default({}); };
  const walk = node => Array.isArray(node) ? node.flatMap(walk) :
    node && typeof node === "object" ? [node, ...walk(node.props?.children)] : [];
  const nodes = () => walk(render());
  const text = node => Array.isArray(node) ? node.map(text).join("") :
    node && typeof node === "object" ? text(node.props?.children) : node == null ? "" : String(node);
  const button = label => nodes().find(node => node.type === "button" && text(node) === label);
  return {
    requests,
    async mount() { render(); effects.splice(0).forEach(effect => effect()); await flush(); },
    change(field, value) {
      const inputs = nodes().filter(node => node.type === "input");
      const input = field === "vModelLevel" ? inputs.find(node => node.props.type === "range") :
        inputs.filter(node => node.props.type === "checkbox")[field === "adversarialReview" ? 0 : 1];
      input.props.onChange({ target: { value: String(value), checked: value } });
    },
    save() { const save = button("Save draft settings"); assert.equal(save.props.disabled, false); return save.props.onClick(); },
    saveDisabled() { return Boolean(button("Save draft settings").props.disabled); },
    reloadDisabled() { return Boolean(button("Reload").props.disabled); },
    form() {
      const inputs = nodes().filter(node => node.type === "input");
      return { adversarialReview: inputs[0].props.checked, vModelLevel: inputs[1].props.value,
        gateEnabled: inputs[2].props.checked };
    },
    text() { return text(render()); },
    succeed(revision) {
      const command = requests.at(-1).command;
      pending.shift().resolve({ data: { status: "saved_draft_not_applied", controls: { ...command.controls }, revision } });
    },
    reply(data) { pending.shift().resolve({ data }); },
    fail(status) { pending.shift().reject(Object.assign(new Error("synthetic failure"), { response: { status } })); },
  };
}

test("pending acknowledgement preserves later edits and the next save uses the new revision", async () => {
  const view = ui(); await view.mount();
  view.change("adversarialReview", false);
  const first = view.save();
  assert.equal(view.saveDisabled(), true);
  assert.equal(view.reloadDisabled(), true);
  view.change("vModelLevel", 3); view.change("gateEnabled", false);
  assert.deepEqual(view.requests.at(-1).command.controls,
    { adversarialReview: false, vModelLevel: 0, gateEnabled: true });
  view.succeed(5); await first;
  assert.deepEqual(view.form(), { adversarialReview: false, vModelLevel: 3, gateEnabled: false });
  assert.match(view.text(), /Newer edits are still unsaved/);
  assert.equal(view.saveDisabled(), false);
  const second = view.save();
  assert.deepEqual(view.requests.at(-1).command, { action: "save", expectedRevision: 5,
    controls: { adversarialReview: false, vModelLevel: 3, gateEnabled: false } });
  view.succeed(6); await second;
  assert.equal(view.saveDisabled(), true);
  assert.doesNotMatch(view.text(), /still unsaved/);
});

test("a pending edit back to the previously loaded value remains unsaved against the acknowledged draft", async () => {
  const view = ui(); await view.mount();
  view.change("adversarialReview", false); const save = view.save();
  view.change("adversarialReview", true);
  view.succeed(5); await save;
  assert.equal(view.form().adversarialReview, true);
  assert.equal(view.saveDisabled(), false);
  assert.match(view.text(), /Newer edits are still unsaved/);
});

test("edits that end at the acknowledged values do not leave a false unsaved notice", async () => {
  const view = ui(); await view.mount();
  view.change("vModelLevel", 1); const save = view.save();
  view.change("vModelLevel", 3); view.change("vModelLevel", 1);
  view.succeed(5); await save;
  assert.equal(view.form().vModelLevel, 1);
  assert.equal(view.saveDisabled(), true);
  assert.doesNotMatch(view.text(), /still unsaved/);
});

for (const status of [409, 503]) test(`failed save (${status}) retains all local edits`, async () => {
  const view = ui(); await view.mount();
  view.change("vModelLevel", 1); const save = view.save();
  view.change("vModelLevel", 2); view.fail(status); await save;
  assert.equal(view.form().vModelLevel, 2);
  assert.equal(view.saveDisabled(), false);
  assert.doesNotMatch(view.text(), /Draft saved|Submitted draft saved/);
  if (status === 409) assert.match(view.text(), /newer draft exists/);
});

test("save without intervening edits still acknowledges normally", async () => {
  const view = ui(); await view.mount();
  view.change("gateEnabled", false); const save = view.save(); view.succeed(5); await save;
  assert.equal(view.form().gateEnabled, false);
  assert.equal(view.saveDisabled(), true);
  assert.match(view.text(), /Draft saved\. No change to the live TrueForge agent/);
});

test("malformed success replies are rejected before a state updater can read their controls", async () => {
  const valid = { adversarialReview: true, vModelLevel: 1, gateEnabled: true };
  for (const data of [
    { status: "saved_draft_not_applied", revision: 5 },
    ...[null, {}, [], { ...valid, gateEnabled: "true" }, { ...valid, vModelLevel: 4 },
      { ...valid, unexpected: true }].map(controls => ({ status: "saved_draft_not_applied", controls, revision: 5 })),
    ...[-1, 4, 6, 5.5].map(revision => ({ status: "saved_draft_not_applied", controls: valid, revision })),
  ]) {
    const view = ui(); await view.mount();
    view.change("vModelLevel", 1); const save = view.save();
    view.change("gateEnabled", false); view.reply(data); await save;
    assert.deepEqual(view.form(), { ...valid, gateEnabled: false });
    assert.equal(view.saveDisabled(), false);
    assert.match(view.text(), /Draft was not saved/);
    assert.doesNotMatch(view.text(), /Draft saved|Submitted draft saved/);
  }
});
