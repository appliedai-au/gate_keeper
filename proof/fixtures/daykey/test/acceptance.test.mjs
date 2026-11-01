import test from "node:test"; import assert from "node:assert/strict";
import { dayKey } from "../src/daykey.js";
test("R2 summer (AEDT) midnight", () => assert.equal(dayKey(Date.UTC(2026, 9, 4, 13, 30)), "2026-10-05"));
test("R3 winter (AEST)", () => assert.equal(dayKey(Date.UTC(2026, 6, 4, 13, 30)), "2026-07-04"));
test("R1 summer late evening", () => assert.equal(dayKey(Date.UTC(2027, 0, 15, 12, 59)), "2027-01-15"));
test("R1 summer just after midnight", () => assert.equal(dayKey(Date.UTC(2027, 0, 15, 13, 0)), "2027-01-16"));
