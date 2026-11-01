import test from "node:test"; import assert from "node:assert/strict";
import { deepMerge } from "../src/merge.js";
test("R1 nested merge keeps defaults", () => assert.deepEqual(deepMerge({ ui: { theme: "light", size: 12 }, lang: "en" }, { ui: { theme: "dark" } }), { ui: { theme: "dark", size: 12 }, lang: "en" }));
test("R2 arrays replace", () => assert.deepEqual(deepMerge({ tags: ["a", "b", "c"] }, { tags: ["z"] }), { tags: ["z"] }));
test("R3 explicit null", () => assert.deepEqual(deepMerge({ ui: { theme: "light" } }, { ui: null }), { ui: null }));
