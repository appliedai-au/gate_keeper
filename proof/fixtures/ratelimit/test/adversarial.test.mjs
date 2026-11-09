import test from "node:test"; import assert from "node:assert/strict";
import { createLimiter } from "../src/limiter.js";
test("T1 no double burst across a boundary", () => {
  const l = createLimiter({ limit: 3, windowMs: 1000 });
  let ok = 0;
  for (const t of [0, 990, 995, 1000, 1001, 1002]) if (l.allow("k", t)) ok++;
  assert.equal(ok, 4); // 0, 990, 995, then 1000 once 0 has left the window
});
test("T2 special key names behave normally", () => {
  const l = createLimiter({ limit: 1, windowMs: 1000 });
  for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty"]) {
    assert.equal(l.allow(k, 0), true, k); assert.equal(l.allow(k, 1), false, k);
  }
  assert.equal(l.size(), 4);
});
test("T3 sweep bounds memory", () => {
  const l = createLimiter({ limit: 5, windowMs: 1000 });
  for (let i = 0; i < 100; i++) l.allow("k" + i, i);
  l.allow("late", 1500);
  l.sweep(1500);
  assert.equal(l.size(), 1);
});
