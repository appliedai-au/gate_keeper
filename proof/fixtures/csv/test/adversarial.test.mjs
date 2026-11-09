import test from "node:test"; import assert from "node:assert/strict";
import { csvField } from "../src/csv.js";
test("T1 formula prefixes are neutralised", () => {
  assert.equal(csvField("=1+1"), "'=1+1");
  assert.equal(csvField("+61 3 9000 0000"), "'+61 3 9000 0000");
  assert.equal(csvField("-2+3"), "'-2+3");
  assert.equal(csvField("@SUM(A1)"), "'@SUM(A1)");
  assert.equal(csvField("\tcmd"), "'\tcmd");
  assert.equal(csvField("=SUM(A1,A2)"), "\"'=SUM(A1,A2)\"");
  assert.equal(csvField('=HYPERLINK("http://x")'), "\"'=HYPERLINK(\"\"http://x\"\")\"");
});
test("T2 numbers are not prefixed", () => { assert.equal(csvField(-5), "-5"); assert.equal(csvField(-0.25), "-0.25"); });
