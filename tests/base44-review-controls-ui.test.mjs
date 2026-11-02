import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import profiles from "../integrations/base44/data/controlProfiles.json" with { type: "json" };

const deck = readFileSync(new URL("../integrations/base44/components/ControlDeck.jsx", import.meta.url), "utf8");
const panel = readFileSync(new URL("../integrations/base44/components/GateKeeperControlSettings.jsx", import.meta.url), "utf8");
const page = readFileSync(new URL("../integrations/base44/pages/GateKeeper.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../integrations/base44/components/ControlDeck.css", import.meta.url), "utf8");

test("adversarial checkbox defaults to current method and independently toggles plain review", () => {
  assert.equal(profiles.defaults.adversarialReview, true);
  assert.match(deck, /useState\(CURRENT\.adversarialReview\)/);
  assert.match(deck, /id="cd-adversarial"/);
  assert.match(deck, /checked=\{adversarialReview\}/);
  assert.match(deck, /setAdversarialReview\(e\.target\.checked\)/);
  assert.match(deck, /"plain \/ lean"/);
  assert.match(deck, /not permission to skip mandatory security checks/i);
});

test("four-level strength slider is separate from the diagram inspector and starts at level 0", () => {
  assert.equal(profiles.defaults.vModelLevel, 0);
  assert.deepEqual(profiles.levels.map(p => p.id), [0,1,2,3]);
  assert.match(deck, /id="cd-v-level" type="range" min="0" max="3"/);
  assert.match(deck, /useState\(CURRENT\.vModelLevel\)/);
  assert.match(deck, /id="cd-v-stage" type="range" min="0" max="3"/);
  assert.match(deck, /Diagram inspector \(separate\)/);
  assert.match(deck, /validationLevel===0\?"reviewed"/);
  assert.match(deck, /validationLevel===3\?"qualification_held"/);
  assert.match(deck, /not yet qualified|HELD|qualified/i);
  assert.equal(profiles.levels[0].mode, "review-only");
});

test("tenant advisory opt-out cannot trigger a paid or production action", () => {
  assert.equal(profiles.defaults.gateEnabled, true);
  assert.match(deck, /!gateEnabled\?"opted_out"/);
  assert.match(deck, /Tenant opt-out changes only this simulation/);
  assert.match(deck, /No button here changes the live TrueForge agent/);
  assert.doesNotMatch(deck, /base44\.functions\.invoke|\.sessions\.create/);
});

test("Settings panel requires server-side draft store, and never pretends it changed runtime", () => {
  assert.match(page, /import GateKeeperControlSettings/);
  assert.match(page, /<GateKeeperControlSettings \/>/);
  assert.match(panel, /export default function GateKeeperControlSettings\(\{ functionName = "gatekeeperControls" \}\)/);
  assert.equal((panel.match(/base44\.functions\.invoke\(functionName,/g)||[]).length,2);
  assert.match(panel, /\}, \[functionName\]\);/);
  assert.doesNotMatch(panel, /base44\.functions\.invoke\("gatekeeperControls"/);
  assert.match(panel, /expectedRevision: state\.revision/);
  assert.match(panel, /saved_draft_not_applied/);
  assert.match(panel, /Settings backend or private policy entity is not installed/);
  assert.match(panel, /disabled=\{!state\.ready \|\| state\.saving \|\| !dirty\}/);
  assert.match(panel, /No paid inference, live execution/);
  assert.match(css, /\.cd-profile\{/);
  assert.match(css, /\.cd-check-first\{/);
  for (const label of ["reviewed","candidate","qualification_held","opted_out","evidence"]) {
    assert.ok(css.includes(".cd-status-lamp."+label), "missing status color "+label);
  }
});
