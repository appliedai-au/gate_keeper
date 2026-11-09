import test from "node:test"; import assert from "node:assert/strict";
import { retry } from "../src/retry.js";
test("T1 invalid attempts", async () => { for (const a of [0, -1, 1.5, NaN]) { let called = false; await assert.rejects(retry(async () => { called = true; }, a, 1, async () => {}), RangeError, String(a)); assert.equal(called, false); } });
test("T2 backoff cap", async () => { const waits = []; await assert.rejects(retry(async () => { throw new Error("x"); }, 40, 1000, async (ms) => waits.push(ms))); assert.ok(waits.every((w) => w <= 30000 && Number.isFinite(w)), String(Math.max(...waits))); });
test("T3 sleep errors propagate", async () => assert.rejects(retry(async () => { throw new Error("x"); }, 3, 1, async () => { throw new Error("sleep broke"); }), /sleep broke/));
