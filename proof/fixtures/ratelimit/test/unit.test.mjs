import test from "node:test"; import assert from "node:assert/strict";
import { createLimiter } from "../src/limiter.js";
test("first requests up to the limit pass", () => {
  const l = createLimiter({ limit: 2, windowMs: 1000 });
  assert.equal(l.allow("k", 0), true); assert.equal(l.allow("k", 1), true); assert.equal(l.allow("k", 2), false);
});
