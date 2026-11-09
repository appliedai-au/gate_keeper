import test from "node:test"; import assert from "node:assert/strict";
import { compareVersions as c } from "../src/semver.js";
test("equal versions", () => assert.equal(c("2.3.4", "2.3.4"), 0));
test("major wins", () => assert.equal(c("2.0.0", "1.99.99"), 1));
