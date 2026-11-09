import test from "node:test"; import assert from "node:assert/strict";
import { readUpload } from "../src/files.js";
test("allowed path reaches fs with the resolved location", () => {
  const seen = []; const fs = { readFileSync: (p) => (seen.push(p), "ok") };
  assert.equal(readUpload(fs, "docs/a.md"), "ok"); assert.deepEqual(seen, ["/srv/uploads/docs/a.md"]);
});
test("rejected path never reaches fs", () => {
  const seen = []; const fs = { readFileSync: (p) => (seen.push(p), "leak") };
  assert.throws(() => readUpload(fs, "../../etc/passwd")); assert.deepEqual(seen, []);
});
