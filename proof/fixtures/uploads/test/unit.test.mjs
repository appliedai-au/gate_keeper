import test from "node:test"; import assert from "node:assert/strict";
import { resolveUpload } from "../src/files.js";
test("simple and nested names", () => {
  assert.equal(resolveUpload("a.txt"), "/srv/uploads/a.txt");
  assert.equal(resolveUpload("x/y/z.bin"), "/srv/uploads/x/y/z.bin");
});
test("empty or non-string input throws TypeError", () => {
  assert.throws(() => resolveUpload(""), TypeError); assert.throws(() => resolveUpload(7), TypeError);
});
test("escaping input throws with E_TRAVERSAL", () => {
  assert.throws(() => resolveUpload("../x"), (e) => e.code === "E_TRAVERSAL");
});
