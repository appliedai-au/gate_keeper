import test from "node:test"; import assert from "node:assert/strict";
import { compareVersions as c } from "../src/semver.js";
test("R1 numeric core", () => { assert.equal(c("1.10.0", "1.9.0"), 1); assert.equal(c("1.2.10", "1.2.9"), 1); assert.equal(c("1.9.0", "1.10.0"), -1); });
test("R2 pre-release below release", () => { assert.equal(c("1.0.0-rc.1", "1.0.0"), -1); assert.equal(c("1.0.0", "1.0.0-rc.1"), 1); });
test("R3 spec ordering", () => {
  const order = ["1.0.0-alpha", "1.0.0-alpha.1", "1.0.0-alpha.beta", "1.0.0-beta", "1.0.0-beta.2", "1.0.0-beta.11", "1.0.0-rc.1", "1.0.0"];
  for (let i = 0; i < order.length - 1; i++) { assert.equal(c(order[i], order[i + 1]), -1, order[i]); assert.equal(c(order[i + 1], order[i]), 1, order[i]); }
});
test("R4 build metadata ignored", () => assert.equal(c("1.0.0+20130313", "1.0.0+exp.sha.5114f85"), 0));
