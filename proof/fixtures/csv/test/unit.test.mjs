import test from "node:test"; import assert from "node:assert/strict";
import { csvField } from "../src/csv.js";
test("plain text is unchanged", () => { assert.equal(csvField("hello"), "hello"); assert.equal(csvField(""), ""); });
test("comma triggers quoting", () => assert.equal(csvField("a,b"), '"a,b"'));
test("quote is doubled", () => assert.equal(csvField('a"b'), '"a""b"'));
