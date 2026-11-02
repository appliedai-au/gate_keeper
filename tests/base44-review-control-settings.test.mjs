import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const original = readFileSync(new URL("../integrations/base44/functions/gatekeeperControls.js", import.meta.url), "utf8");
const runnable = original.replace(/^import \{ createClientFromRequest \} from "npm:@base44\/sdk@0\.8\.20";\s*$/m, "");

function harness({ user = { id: "owner", role: "admin" }, authError = false, records = [], storeFailure = false } = {}) {
  let handler;
  const calls = [];
  const storage = records.map((row) => ({ ...row }));
  const store = {
    filter: async (query, sort, limit) => {
      calls.push("filter");
      if (storeFailure) throw Error("SECRET ERROR");
      return storage.filter((row) => row.owner_user_id === query.owner_user_id).slice(0, limit);
    },
    create: async (values) => {
      calls.push("create");
      storage.push({ ...values, id: "row-" + (storage.length + 1) });
    },
    update: async (id, values) => {
      calls.push("update");
      const existing = storage.find((row) => row.id === id);
      if (!existing) throw Error("missing");
      Object.assign(existing, values);
    },
  };
  const context = {
    Deno: { serve: (fn) => { handler = fn; } },
    createClientFromRequest: () => ({
      auth: { me: async () => {
        if (authError) throw Error("auth expired");
        return user;
      } },
      asServiceRole: { entities: { GateKeeperControlPolicy: store } },
    }),
    Request, Response, TextDecoder, Uint8Array,
  };
  runInNewContext(runnable, context, { timeout: 2000 });
  return {
    calls, storage,
    async invoke(payload, method = "POST") {
      const request = new Request("https://gatekeeper.example/functions/gatekeeperControls", {
        method,
        ...(method === "POST" ? {
          body: typeof payload === "string" ? payload : JSON.stringify(payload),
          headers: { "Content-Type": "application/json" },
        } : {}),
      });
      const response = await handler(request);
      return { status: response.status, data: await response.json(), headers: response.headers };
    },
  };
}

test("anonymous, nonadmin, invalid methods cannot read or write policy", async () => {
  for (const options of [{ user: null }, { authError: true },
    { user: { id: "viewer", role: "user" } }, { user: { role: "admin" } }]) {
    const h = harness(options);
    assert.ok([401, 403].includes((await h.invoke({ action: "load" })).status));
    assert.equal(h.calls.length, 0);
  }
  const h = harness();
  assert.equal((await h.invoke({}, "GET")).status, 405);
  assert.equal(h.calls.length, 0);
});

test("defaults, save and version conflict are truthful and always draft only", async () => {
  const h = harness();
  const load = await h.invoke({ action: "load" });
  assert.equal(load.status, 200);
  assert.deepEqual(JSON.parse(JSON.stringify(load.data.controls)),
    { adversarialReview: true, vModelLevel: 0, gateEnabled: true });
  assert.equal(load.data.revision, 0);
  assert.equal(load.data.liveEnforcementEnabled, false);
  assert.equal(load.headers.get("cache-control"), "private, no-store, max-age=0");
  const controls = { adversarialReview: false, vModelLevel: 2, gateEnabled: false };
  const save = await h.invoke({ action: "save", controls, expectedRevision: 0 });
  assert.equal(save.status, 200);
  assert.equal(save.data.status, "saved_draft_not_applied");
  assert.equal(h.storage[0].owner_user_id, "owner");
  assert.equal(h.storage[0].revision, 1);
  assert.equal((await h.invoke({ action: "save", controls, expectedRevision: 0 })).status, 409);
  const updated = await h.invoke({ action: "save", controls: { ...controls, vModelLevel: 3 }, expectedRevision: 1 });
  assert.equal(updated.status, 200);
  assert.equal(h.storage[0].v_model_level, 3);
  assert.equal(h.storage.length, 1);
});

test("rejects browser-scoped identity, forged roles, unknown fields and malformed controls", async () => {
  const h = harness();
  const controls = { adversarialReview: true, vModelLevel: 0, gateEnabled: true };
  for (const payload of [
    { action: "load", owner_user_id: "victim" },
    { action: "save", controls, expectedRevision: 0, tenantId: "victim" },
    { action: "save", controls: { ...controls, isAdmin: true }, expectedRevision: 0 },
    { action: "save", controls: { ...controls, vModelLevel: "3" }, expectedRevision: 0 },
    { action: "save", controls: { ...controls, vModelLevel: 4 }, expectedRevision: 0 },
    { action: "save", controls: { ...controls, adversarialReview: "false" }, expectedRevision: 0 },
    { action: "save", controls: { ...controls, gateEnabled: null }, expectedRevision: 0 },
    { action: "save", controls, expectedRevision: "0" },
    { action: "save", controls, expectedRevision: -1 },
    { action: "erase" },
  ]) assert.equal((await h.invoke(payload)).status, 400);
  assert.equal(h.storage.length, 0);
});

test("bounded request, unavailable storage and malformed/duplicate policy fail closed", async () => {
  const h = harness();
  assert.equal((await h.invoke("invalid-json")).status, 400);
  assert.equal((await h.invoke("x".repeat(3000))).status, 400);
  assert.equal(h.calls.length, 0);
  assert.equal((await harness({ storeFailure: true }).invoke({ action: "load" })).status, 503);
  const row = { id: "row-1", owner_user_id: "owner", revision: 1,
    adversarial_review: true, v_model_level: 0, gate_enabled: true };
  for (const records of [[row, { ...row, id: "row-2" }],
    [{ ...row, adversarial_review: "true" }],
    [{ ...row, v_model_level: 99 }], [{ ...row, revision: -1 }]]) {
    assert.equal((await harness({ records }).invoke({ action: "load" })).status, 503);
  }
});

test("private entity schema and runtime variants retain exact server-only boundary", () => {
  assert.doesNotMatch(original, /\bfetch\s*\(|InvokeLLM|createTurn|TRUEFORGE_TOKEN/);
  assert.match(original, /user\.role !== "admin"/);
  assert.match(original, /owner_user_id: user\.id/);
  assert.match(original, /liveEnforcementEnabled: false/);
  const schema = JSON.parse(readFileSync(new URL(
    "../integrations/base44/cli/base44/entities/gate-keeper-control-policy.jsonc", import.meta.url), "utf8"));
  assert.deepEqual(schema.rls, { read: false, create: false, update: false, delete: false });
  const cli = readFileSync(new URL(
    "../integrations/base44/cli/base44/functions/gatekeeper-controls/entry.ts", import.meta.url), "utf8");
  const normalized = cli.replace(/^\/\/ Base44 CLI\/sandbox handler variant\..*\n/, "")
    .replace('import { createClientFromRequest } from "npm:@base44/sdk";',
      'import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";')
    .replace("export default async function gatekeeperControls(request) {", "Deno.serve(async (request) => {")
    .replace(/\}\s*$/, "});\n");
  assert.equal(normalized, original);
});
