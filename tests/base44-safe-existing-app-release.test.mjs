import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path) => readFileSync(new URL("../" + path, import.meta.url), "utf8");
const doc = read("docs/review-control-settings.md");
const readme = read("integrations/base44/README.md");
const panel = read("integrations/base44/components/GateKeeperControlSettings.jsx");
const page = read("integrations/base44/pages/GateKeeper.jsx");
const schema = JSON.parse(read("integrations/base44/cli/base44/entities/gate-keeper-control-policy.jsonc"));
const cli = read("integrations/base44/cli/base44/functions/gatekeeper-controls/entry.ts");
const editor = read("integrations/base44/functions/gatekeeperControls.js");

test("existing app deployment warns of destructive schema sync and requires app-specific inventory", () => {
  for (const s of [doc, readme]) {
    assert.match(s, /6ae577c8f34f21f5eebe75d9/);
    assert.match(s, /secure-authentic-gate-flow\.base44\.app/);
    assert.match(s, /entities push/);
    assert.match(s, /remote entit(?:y|ies).*absent|remote entity schemas absent|remote entity missing/si);
    assert.match(s, /scaffold --app-id 6ae577c8f34f21f5eebe75d9/);
    assert.match(s, /never.*base44 create|Do not create a second app/i);
    assert.match(s, /--force/);
  }
  assert.match(doc, /create-one-entity-schema/);
  assert.match(doc, /complete.*prechange schema inventory/);
  assert.match(doc, /zero unrelated removals/);
  assert.match(doc, /rollback checkpoint/);
});

test("one private owner draft entity is fail-closed under RLS", () => {
  assert.equal(schema.name, "GateKeeperControlPolicy");
  assert.deepEqual(schema.rls, { read: false, create: false, update: false, delete: false });
  assert.ok(schema.required.includes("owner_user_id"));
  assert.ok(editor.includes("asServiceRole.entities.GateKeeperControlPolicy"));
  assert.ok(editor.includes('user.role !== "admin"'));
  assert.doesNotMatch(editor, /\bfetch\s*\(|createTurn|InvokeLLM/);
});

test("editor camelCase and CLI kebab-case control function routes are explicit", () => {
  assert.match(panel, /GateKeeperControlSettings\(\{ functionName = "gatekeeperControls" \}\)/);
  assert.equal((panel.match(/base44\.functions\.invoke\(functionName,/g) || []).length, 2);
  assert.match(panel, /\}, \[functionName\]\);/);
  assert.match(page, /<GateKeeperControlSettings \/>/);
  assert.match(cli, /export default async function gatekeeperControls\(request\)/);
  assert.match(readme, /functionName="gatekeeper-controls"/);
  assert.match(doc, /functionName="gatekeeper-controls"/);
  assert.match(readme, /functionName="gatekeeper-status"/);
  assert.match(doc, /functionName="gatekeeper-status"/);
});

test("no speculative site-publication or live authority claim", () => {
  assert.match(doc, /not an assertion that an authenticated Base44 deployment has occurred/);
  assert.match(doc, /not a capability grant/);
  assert.match(readme, /not evidence of a deployed site|not an installed Base44 app/);
  assert.match(panel, /saved_draft_not_applied/);
  assert.doesNotMatch(panel, /session\.create|createTurn/);
});
