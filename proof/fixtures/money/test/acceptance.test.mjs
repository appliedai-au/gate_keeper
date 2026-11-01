import test from "node:test"; import assert from "node:assert/strict";
import { parseAmountCents, invoiceTotalCents } from "../src/money.js";
test("R1 invoice total", () => assert.equal(invoiceTotalCents([{ amount: "12.5", qty: 2 }, { amount: "0.99", qty: 1 }]), 2599));
test("R2 equivalent whole forms", () => { for (const s of ["3", "3.0", "3.00"]) assert.equal(parseAmountCents(s), 300); });
test("R3 tenths", () => assert.equal(parseAmountCents("0.5"), 50));
