import test from "node:test"; import assert from "node:assert/strict";
import { link } from "../src/html.js";
test("link escapes href and text", () => assert.equal(link("https://x.test/a?b=<c>", "<i>"), '<a href="https://x.test/a?b=&lt;c&gt;">&lt;i&gt;</a>'));
test("unsafe URL is rejected before rendering", () => assert.throws(() => link("javascript:alert(1)", "x"), (e) => e.code === "E_UNSAFE_URL"));
