import test from "node:test"; import assert from "node:assert/strict";
import { dailyTotals } from "../src/daykey.js";
test("totals across the April 2027 change to standard time", () => {
  // AEDT ends 04 Apr 2027 03:00 local (16:00 UTC 3 Apr).
  const events = [
    { ts: Date.UTC(2027, 3, 3, 13, 15), cents: 100 }, // 00:15 AEDT 4 Apr
    { ts: Date.UTC(2027, 3, 3, 12, 45), cents: 10 },  // 23:45 AEDT 3 Apr
    { ts: Date.UTC(2027, 3, 4, 13, 45), cents: 1 },   // 23:45 AEST 4 Apr
    { ts: Date.UTC(2027, 3, 4, 14, 15), cents: 1000 },// 00:15 AEST 5 Apr
  ];
  assert.deepEqual(dailyTotals(events), { "2027-04-03": 10, "2027-04-04": 101, "2027-04-05": 1000 });
});
