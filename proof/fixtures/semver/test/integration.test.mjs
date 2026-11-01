import test from "node:test"; import assert from "node:assert/strict";
import { newest } from "../src/semver.js";
test("newest picks the highest and leaves input alone", () => {
  const list = ["1.9.0", "1.10.0-rc.1", "1.10.0", "1.2.3"];
  assert.equal(newest(list), "1.10.0");
  assert.deepEqual(list, ["1.9.0", "1.10.0-rc.1", "1.10.0", "1.2.3"]);
});
