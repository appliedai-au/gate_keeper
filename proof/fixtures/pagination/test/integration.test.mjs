import test from "node:test"; import assert from "node:assert/strict";
import { pageSummary } from "../src/paginate.js";
test("summary reflects paginate", () => assert.equal(pageSummary(["a", "b", "c"], 2, 2), "Page 2 of 2: c"));
test("summary rejects invalid pages", () => assert.throws(() => pageSummary(["a"], 0, 1), RangeError));
