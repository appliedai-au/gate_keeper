import test from "node:test"; import assert from "node:assert/strict";
import { parseAmountCents } from "../src/money.js";
test("T1 malformed amounts are rejected", () => {
  for (const bad of ["1e3", "-1.00", "12.345", "0x10", "12.", "", " ", ".5", "1,000.00"])
    assert.throws(() => parseAmountCents(bad), RangeError, JSON.stringify(bad));
});
test("T2 non-strings throw TypeError", () => {
  for (const bad of [12.5, null, undefined, {}]) assert.throws(() => parseAmountCents(bad), TypeError);
});
