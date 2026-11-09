import test from "node:test"; import assert from "node:assert/strict";
import { retry } from "../src/retry.js";
test("R1 at most `attempts` calls", async () => { let n = 0; await assert.rejects(retry(async () => { n++; throw new Error("x"); }, 3, 1, async () => {})); assert.equal(n, 3); });
test("R2 immediate success", async () => { let waits = 0; assert.equal(await retry(async () => "ok", 3, 1, async () => { waits++; }), "ok"); assert.equal(waits, 0); });
test("R3 last error thrown", async () => { let n = 0; await assert.rejects(retry(async () => { throw new Error("e" + ++n); }, 3, 1, async () => {}), /e3/); });
test("R4 waits only between attempts", async () => { const w = []; await assert.rejects(retry(async () => { throw new Error("x"); }, 3, 100, async (ms) => w.push(ms))); assert.deepEqual(w, [100, 200]); });
