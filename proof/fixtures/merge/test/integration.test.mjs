import test from "node:test"; import assert from "node:assert/strict";
import { effectiveSettings } from "../src/merge.js";
test("shared defaults are never modified", () => {
  const defaults = { ui: { theme: "light", panels: { left: true } }, lang: "en" };
  const snapshot = structuredClone(defaults);
  const a = effectiveSettings(defaults, '{"ui": {"theme": "dark", "panels": {"left": false}}}');
  const b = effectiveSettings(defaults, '{"lang": "fr"}');
  assert.deepEqual(defaults, snapshot);
  assert.equal(a.ui.theme, "dark"); assert.equal(a.ui.panels.left, false);
  assert.deepEqual(b, { ui: { theme: "light", panels: { left: true } }, lang: "fr" });
  assert.notEqual(b.ui, defaults.ui);
});
