import test from "node:test"; import assert from "node:assert/strict";
import { entryDestination } from "../src/extract.js";
const slip = (e) => e instanceof Error && e.code === "E_ZIP_SLIP";
test("T1 traversal", () => { for (const n of ["../../etc/cron.d/x", "a/../../x", ".."]) assert.throws(() => entryDestination("/tmp/out", n), slip, n); });
test("T2 absolute and backslash forms", () => { for (const n of ["/etc/passwd", "..\\..\\x", "C:\\x"]) assert.throws(() => entryDestination("/tmp/out", n), slip, n); });
test("T3 NUL bytes", () => assert.throws(() => entryDestination("/tmp/out", "a\u0000b"), slip));
test("T4 safe-but-odd names stay inside", () => { for (const n of ["....//x", "..data/y"]) assert.ok(entryDestination("/tmp/out", n).startsWith("/tmp/out/"), n); });
