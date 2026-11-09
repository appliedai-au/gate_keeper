import test from "node:test"; import assert from "node:assert/strict";
import { planExtraction } from "../src/extract.js";
test("plan for a clean archive", () => assert.deepEqual(planExtraction("/tmp/out", ["a", "b/c"]).map((x) => x.dest), ["/tmp/out/a", "/tmp/out/b/c"]));
test("one bad entry rejects the whole archive", () => assert.throws(() => planExtraction("/tmp/out", ["ok.txt", "../../evil"]), (e) => e.code === "E_ZIP_SLIP"));
