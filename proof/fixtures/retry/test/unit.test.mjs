import test from "node:test"; import assert from "node:assert/strict";
import { retry } from "../src/retry.js";
const noSleep = async () => {};
test("returns first success", async () => assert.equal(await retry(async () => 7, 3, 10, noSleep), 7));
test("retries until success", async () => { let n = 0; assert.equal(await retry(async () => { if (++n < 2) throw new Error("x"); return n; }, 3, 10, noSleep), 2); });
test("passes the attempt index", async () => { const seen = []; await retry(async (i) => { seen.push(i); if (i < 1) throw new Error("x"); }, 3, 1, noSleep); assert.deepEqual(seen, [0, 1]); });
