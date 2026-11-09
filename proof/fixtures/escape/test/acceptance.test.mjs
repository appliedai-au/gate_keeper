import test from "node:test"; import assert from "node:assert/strict";
import { escapeHtml, link } from "../src/html.js";
test("R1 ampersands", () => assert.equal(escapeHtml("a & b"), "a &amp; b"));
test("R2 entities preserved literally", () => assert.equal(escapeHtml("&lt;"), "&amp;lt;"));
test("R3 link escaping", () => assert.equal(link("https://x.test/?a=1&b=2", "Q&A"), '<a href="https://x.test/?a=1&amp;b=2">Q&amp;A</a>'));
test("R4 relative and mailto", () => { assert.equal(link("/docs?x=1", "d"), '<a href="/docs?x=1">d</a>'); assert.equal(link("mailto:a@b.test", "m"), '<a href="mailto:a@b.test">m</a>'); });
