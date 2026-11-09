import test from "node:test"; import assert from "node:assert/strict";
import { resolveUpload, UPLOAD_ROOT } from "../src/files.js";
const traversal = (e) => e instanceof Error && e.code === "E_TRAVERSAL";
test("T1 traversal is rejected", () => {
  for (const p of ["../etc/passwd", "a/../../etc/shadow", "reports/../../..", "..", "./../x"]) assert.throws(() => resolveUpload(p), traversal, p);
});
test("T2 absolute paths are rejected", () => {
  for (const p of ["/etc/passwd", "/srv/uploads/../etc"]) assert.throws(() => resolveUpload(p), traversal, p);
});
test("T3 NUL bytes are rejected", () => assert.throws(() => resolveUpload("a.txt\u0000.png"), traversal));
test("T4 tricky but safe names stay inside the root", () => {
  for (const p of ["....//x", "..foo/bar", "a/./b"]) {
    const r = resolveUpload(p); assert.ok(r.startsWith(UPLOAD_ROOT + "/"), p + " -> " + r);
  }
});
