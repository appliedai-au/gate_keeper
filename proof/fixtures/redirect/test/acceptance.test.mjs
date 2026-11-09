import test from "node:test"; import assert from "node:assert/strict";
import { safeRedirect } from "../src/redirect.js";
test("R1 query and fragment kept", () => assert.equal(safeRedirect("/account?tab=2#x"), "/account?tab=2#x"));
test("R2 default", () => assert.equal(safeRedirect(null), "/"));
test("R3 non-paths fall back without throwing", () => assert.equal(safeRedirect("ftp://x"), "/"));
