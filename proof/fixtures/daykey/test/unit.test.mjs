import test from "node:test"; import assert from "node:assert/strict";
import { dayKey } from "../src/daykey.js";
test("winter afternoon", () => assert.equal(dayKey(Date.UTC(2026, 5, 1, 4, 0)), "2026-06-01"));
