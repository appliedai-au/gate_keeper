import test from "node:test"; import assert from "node:assert/strict";
import { entryDestination } from "../src/extract.js";
test("simple entries", () => assert.equal(entryDestination("/tmp/out", "a.txt"), "/tmp/out/a.txt"));
test("empty names throw TypeError", () => assert.throws(() => entryDestination("/tmp/out", ""), TypeError));
test("escaping entries throw E_ZIP_SLIP", () => assert.throws(() => entryDestination("/tmp/out", "../x"), (e) => e.code === "E_ZIP_SLIP"));
