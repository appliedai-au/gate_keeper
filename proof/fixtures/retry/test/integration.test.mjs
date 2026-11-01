import test from "node:test"; import assert from "node:assert/strict";
import { retry } from "../src/retry.js";
test("uses only the injected sleep", async () => { const waits = []; await assert.rejects(retry(async () => { throw new Error("down"); }, 2, 5, async (ms) => waits.push(ms)), /down/); assert.deepEqual(waits, [5]); });
