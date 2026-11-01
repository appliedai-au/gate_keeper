import test from "node:test"; import assert from "node:assert/strict";
import { toCsv } from "../src/csv.js";
test("header and rows compose field encoding", () => assert.equal(toCsv(["name", "note"], [["Ann", "=cmd"], ["Bo, Jr", null]]), "name,note\r\nAnn,'=cmd\r\n\"Bo, Jr\",\r\n"));
test("no rows still ends the header", () => assert.equal(toCsv(["a"], []), "a\r\n"));
