import test from "node:test"; import assert from "node:assert/strict";
import { paginate } from "../src/paginate.js";
test("R1 pages are 1-based", () => assert.deepEqual(paginate([1, 2, 3, 4, 5], 1, 2).items, [1, 2]));
test("R2 partial last page", () => { const p = paginate([1, 2, 3, 4, 5], 3, 2); assert.equal(p.totalPages, 3); assert.deepEqual(p.items, [5]); });
test("R3 empty list", () => { const p = paginate([], 1, 10); assert.equal(p.totalPages, 0); assert.deepEqual(p.items, []); });
