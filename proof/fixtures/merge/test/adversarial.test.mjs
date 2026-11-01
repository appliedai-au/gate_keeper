import test from "node:test"; import assert from "node:assert/strict";
import { deepMerge, effectiveSettings } from "../src/merge.js";
test("T1 __proto__ cannot pollute", () => {
  const r = effectiveSettings({ a: 1 }, '{"__proto__": {"polluted": true}}');
  assert.equal(({}).polluted, undefined); assert.equal(r.polluted, undefined);
});
test("T1 constructor.prototype cannot pollute", () => {
  effectiveSettings({ a: 1 }, '{"constructor": {"prototype": {"isAdmin": true}}}');
  assert.equal(({}).isAdmin, undefined);
});
test("T1 nested __proto__ cannot pollute", () => {
  const r = effectiveSettings({ ui: { theme: "light" } }, '{"ui": {"__proto__": {"admin": true}}}');
  assert.equal(r.ui.admin, undefined); assert.equal(({}).admin, undefined);
});
test("T2 inherited source keys ignored", () => {
  const src = Object.create({ inherited: 1 }); src.own = 2;
  assert.deepEqual(deepMerge({}, src), { own: 2 });
});
