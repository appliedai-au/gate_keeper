import test from "node:test"; import assert from "node:assert/strict";
import { createLimiter } from "../src/limiter.js";
test("steady traffic over many windows stays at the limit", () => {
  const l = createLimiter({ limit: 10, windowMs: 1000 });
  let ok = 0;
  for (let t = 0; t < 5000; t += 20) { if (l.allow("api", t)) ok++; if (t % 1000 === 0) l.sweep(t); }
  assert.equal(ok, 50);
  assert.equal(l.size(), 1);
});
