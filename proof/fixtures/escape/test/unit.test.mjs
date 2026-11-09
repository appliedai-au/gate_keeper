import test from "node:test"; import assert from "node:assert/strict";
import { escapeHtml } from "../src/html.js";
test("angle brackets and ampersands", () => assert.equal(escapeHtml("<b>&</b>"), "&lt;b&gt;&amp;&lt;/b&gt;"));
test("quotes", () => assert.equal(escapeHtml(`"'`), "&quot;&#39;"));
test("non-strings are stringified", () => assert.equal(escapeHtml(5), "5"));
