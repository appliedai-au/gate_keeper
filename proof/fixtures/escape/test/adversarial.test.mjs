import test from "node:test"; import assert from "node:assert/strict";
import { link } from "../src/html.js";
const unsafe = (e) => e instanceof Error && e.code === "E_UNSAFE_URL";
test("T1 attribute breakout is neutralised", () => {
  const out = link('https://x.test/" onmouseover="alert(1)', `t' onclick='x`);
  assert.ok(!out.includes('" onmouseover') && !out.includes("' onclick"), out);
});
test("T2 script schemes are rejected", () => { for (const u of ["javascript:alert(1)", "data:text/html,<b>", "vbscript:x"]) assert.throws(() => link(u, "x"), unsafe, u); });
test("T3 obfuscated schemes are rejected", () => { for (const u of ["  JaVaScRiPt:alert(1)", "java\tscript:x", "\u0000javascript:x", "JAVASCRIPT&colon;x".replace("&colon;", ":")]) assert.throws(() => link(u, "x"), unsafe, JSON.stringify(u)); });
