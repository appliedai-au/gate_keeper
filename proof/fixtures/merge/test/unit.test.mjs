import test from "node:test"; import assert from "node:assert/strict";
import { deepMerge } from "../src/merge.js";
test("flat override", () => assert.deepEqual(deepMerge({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 }));
test("new keys are added", () => assert.deepEqual(deepMerge({}, { x: { y: 1 } }), { x: { y: 1 } }));
