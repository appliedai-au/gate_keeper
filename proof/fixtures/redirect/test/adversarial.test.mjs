import test from "node:test"; import assert from "node:assert/strict";
import { safeRedirect } from "../src/redirect.js";
const bad = ["https://evil.test", "http://evil.test/x", "//evil.test", "/\\evil.test", "\\\\evil.test", "/%2F%2Fevil.test", "/%5Cevil.test", "javascript:alert(1)", " JaVaScRiPt:x", "/\tevil", "/\nx"];
test("T1-T3 unsafe targets fall back to /", () => { for (const n of bad) assert.equal(safeRedirect(n), "/", JSON.stringify(n)); });
test("safe-but-odd paths survive", () => { assert.equal(safeRedirect("/a//b"), "/a//b"); assert.equal(safeRedirect("/search?q=//x"), "/search?q=//x"); });
