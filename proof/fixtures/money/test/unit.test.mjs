import test from "node:test"; import assert from "node:assert/strict";
import { parseAmountCents } from "../src/money.js";
test("two-decimal amounts", () => { assert.equal(parseAmountCents("12.50"), 1250); assert.equal(parseAmountCents("0.07"), 7); });
test("one-decimal amounts are tenths", () => { assert.equal(parseAmountCents("12.5"), 1250); assert.equal(parseAmountCents("0.1"), 10); });
test("whole amounts", () => { assert.equal(parseAmountCents("3"), 300); assert.equal(parseAmountCents(" 42 "), 4200); });
