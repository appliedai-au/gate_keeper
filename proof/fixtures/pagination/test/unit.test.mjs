import test from "node:test"; import assert from "node:assert/strict";
import { paginate } from "../src/paginate.js";
const xs = [1, 2, 3, 4, 5, 6, 7];
test("first and middle pages", () => { assert.deepEqual(paginate(xs, 1, 3).items, [1, 2, 3]); assert.deepEqual(paginate(xs, 2, 3).items, [4, 5, 6]); });
test("total pages rounds up", () => { assert.equal(paginate(xs, 1, 3).totalPages, 3); assert.equal(paginate(xs, 1, 7).totalPages, 1); });
test("non-array items throw TypeError", () => assert.throws(() => paginate("x", 1, 2), TypeError));
