import test from "node:test"; import assert from "node:assert/strict";
import { paginate } from "../src/paginate.js";
test("T1 invalid pages throw", () => { for (const p of [0, -1, 1.5, NaN, "1", null]) assert.throws(() => paginate([1, 2, 3], p, 2), RangeError, String(p)); });
test("T2 pages beyond the end throw for non-empty lists", () => { assert.throws(() => paginate([1, 2, 3], 3, 2), RangeError); assert.throws(() => paginate([1], 99, 1), RangeError); });
test("T3 invalid sizes throw", () => { for (const s of [0, -2, 1.5]) assert.throws(() => paginate([1], 1, s), RangeError); });
