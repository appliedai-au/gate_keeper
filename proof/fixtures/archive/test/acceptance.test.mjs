import test from "node:test"; import assert from "node:assert/strict";
import { entryDestination, planExtraction } from "../src/extract.js";
test("R1 entries resolve inside destDir", () => assert.equal(entryDestination("/tmp/out", "docs/readme.md"), "/tmp/out/docs/readme.md"));
test("R2 normalised names inside destDir are allowed", () => assert.equal(entryDestination("/tmp/out", "a/../b.txt"), "/tmp/out/b.txt"));
test("R3 escaping entries reject the archive", () => assert.throws(() => planExtraction("/tmp/out", ["../x"]), (e) => e.code === "E_ZIP_SLIP"));
