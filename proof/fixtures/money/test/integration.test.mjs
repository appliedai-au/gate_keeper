import test from "node:test"; import assert from "node:assert/strict";
import { invoiceTotalCents } from "../src/money.js";
test("invoice total composes line parsing", () => {
  assert.equal(invoiceTotalCents([{ amount: "1.5", qty: 3 }, { amount: "2.25", qty: 2 }]), 900);
  assert.equal(invoiceTotalCents([]), 0);
});
