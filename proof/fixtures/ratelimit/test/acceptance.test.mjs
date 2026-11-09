import test from "node:test"; import assert from "node:assert/strict";
import { createLimiter } from "../src/limiter.js";
test("R1 rolling window", () => {
  const l = createLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(l.allow("k", 0), true); assert.equal(l.allow("k", 600), true);
  assert.equal(l.allow("k", 900), false);
  assert.equal(l.allow("k", 1100), true);
  assert.equal(l.allow("k", 1200), false);
});
test("R2 boundary is exclusive", () => {
  const l = createLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(l.allow("k", 0), true); assert.equal(l.allow("k", 999), false); assert.equal(l.allow("k", 1000), true);
});
test("R3 rejections do not count", () => {
  const l = createLimiter({ limit: 1, windowMs: 1000 });
  l.allow("k", 0); l.allow("k", 500); l.allow("k", 900);
  assert.equal(l.allow("k", 1000), true);
});
test("R4 keys independent", () => {
  const l = createLimiter({ limit: 1, windowMs: 1000 });
  assert.equal(l.allow("a", 0), true); assert.equal(l.allow("b", 0), true); assert.equal(l.allow("a", 1), false);
});
