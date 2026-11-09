import test from "node:test"; import assert from "node:assert/strict";
import { toCsv } from "../src/csv.js";
test("R1 CRLF records", () => assert.equal(toCsv(["a", "b"], [[1, 2]]), "a,b\r\n1,2\r\n"));
test("R2 quoting", () => assert.equal(toCsv(["n"], [['say "hi", ok'], ["two\nlines"]]), 'n\r\n"say ""hi"", ok"\r\n"two\nlines"\r\n'));
test("R3 empty and plain values", () => assert.equal(toCsv(["x", "y", "z"], [[null, undefined, -12.5], [true, 0, ""]]), "x,y,z\r\n,,-12.5\r\ntrue,0,\r\n"));
