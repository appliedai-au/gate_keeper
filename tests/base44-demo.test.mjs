import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../integrations/base44/pages/GateKeeper.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../integrations/base44/pages/GateKeeper.css", import.meta.url), "utf8");
const status = readFileSync(new URL("../integrations/base44/functions/gatekeeperStatus.js", import.meta.url), "utf8");
const benchmark = readFileSync(new URL("../integrations/base44/components/GateKeeperBenchmark.jsx", import.meta.url), "utf8");

test("Base44 walkthrough prominently discloses sample-only results", () => {
  assert.match(page, /SAMPLE WALKTHROUGH/);
  assert.match(page, /not a live TrueForge review/);
  assert.ok(page.includes("GateKeeperBenchmark key={page} section={page}"));
  assert.match(benchmark, /INCONCLUSIVE|proof\.result/);
  assert.match(benchmark, /sourceCommit/);
  assert.match(page, /SAMPLE UI · NOT LIVE AI OUTPUT/);
});

test("Base44 page implements interactive navigation and finding selection", () => {
  for (const label of ["Overview", "Review", "Runs", "Evidence", "Settings"]) {
    assert.ok(page.includes('"' + label + '"'), "missing " + label);
  }
  assert.match(page, /setSelected\(next\)/);
  assert.match(page, /activeLines\.includes\(line\.number\)/);
  assert.match(page, /aria-pressed=\{active\}/);
  assert.match(page, /aria-expanded=\{showDetail\}/);
  assert.match(page, /aria-current=\{page === item/);
});

test("Base44 design works without animation and responds to mobile width", () => {
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.match(css, /max-width: 760px/);
  assert.match(css, /focus-visible/);
  assert.match(css, /grid-template-columns: minmax\(0,1fr\)/);
});

test("probe never accepts user-provided target URLs or forwards raw upstream output", () => {
  assert.match(status, /const TRUEFORGE_PROXY =/);
  assert.match(status, /const HEALTH_PATH = "\/healthz"/);
  assert.match(status, /user\.role !== "admin"/);
  assert.match(status, /Deno\.env\.get\("GATEKEEPER_PROXY_PASSWORD"\)/);
  assert.doesNotMatch(status, /request\.json\(/);
  assert.doesNotMatch(status, /upstream\.text\(/);
  assert.doesNotMatch(status, /upstream\.json\(/);
});

test("UI excludes autonomous edits, paid eval activation and unqualified review submission", () => {
  assert.match(page, /No code execution or repair/);
  assert.match(page, /Promotion disabled/);
  assert.match(page, /no AI request, repository access or billing/);
  assert.doesNotMatch(page, /\/api\/v1\/sessions/);
});
