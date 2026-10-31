import test from "node:test"; import assert from "node:assert/strict";
import { safeRedirect } from "../src/redirect.js";
test("plain paths", () => { assert.equal(safeRedirect("/a"), "/a"); assert.equal(safeRedirect("/a/b?c=1"), "/a/b?c=1"); });
test("defaults", () => { assert.equal(safeRedirect(undefined), "/"); assert.equal(safeRedirect(""), "/"); });
test("relative paths without a leading slash are not same-site paths", () => assert.equal(safeRedirect("evil.test"), "/"));
