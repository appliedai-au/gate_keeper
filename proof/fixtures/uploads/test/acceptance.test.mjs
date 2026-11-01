import test from "node:test"; import assert from "node:assert/strict";
import { resolveUpload } from "../src/files.js";
test("R1 nested paths", () => assert.equal(resolveUpload("reports/2026/q3.pdf"), "/srv/uploads/reports/2026/q3.pdf"));
test("R2 normalised paths inside the root are allowed", () => assert.equal(resolveUpload("a/../b.txt"), "/srv/uploads/b.txt"));
test("R3 escaping paths are rejected with E_TRAVERSAL", () => assert.throws(() => resolveUpload("../secret"), (e) => e.code === "E_TRAVERSAL"));
