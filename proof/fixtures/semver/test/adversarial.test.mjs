import test from "node:test"; import assert from "node:assert/strict";
import { compareVersions as c } from "../src/semver.js";
test("T1 invalid versions throw", () => {
  for (const bad of ["1.2", "1.2.3.4", "v1.2.3", "01.2.3", "1.02.3", "1.2.3-01", "1.2.3-", "1.2.3-a..b", "", "1.2.x"]) assert.throws(() => c(bad, "1.0.0"), TypeError, bad);
  for (const bad of [null, 1, {}]) assert.throws(() => c(bad, "1.0.0"), TypeError);
});
test("T1 zero is not a leading zero", () => { assert.equal(c("0.0.0", "0.0.0"), 0); assert.equal(c("1.0.0-0", "1.0.0-1"), -1); });
