import test from "node:test"; import assert from "node:assert/strict";
import { dayKey } from "../src/daykey.js";
test("T1 bad timestamps throw TypeError", () => { for (const bad of [NaN, Infinity, "1700000000000", null, undefined]) assert.throws(() => dayKey(bad), TypeError, String(bad)); });
