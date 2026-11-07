// Existing Base44 app: administrator-only DRAFT control settings.
// Requires a PRIVATE GateKeeperControlPolicy entity (see docs/review-control-settings.md).
// Deliberately no LLM, TrueForge, GitHub, lease signing, or production writes.
// An authenticated Base44 ADMIN user, not a caller-supplied tenant ID, owns the row.
import { createClientFromRequest } from "npm:@base44/sdk@0.8.20";

const DEFAULTS = Object.freeze({ adversarialReview: true, vModelLevel: 0, gateEnabled: true });
const MAX_BYTES = 2048;
const FIELDS = ["adversarialReview", "gateEnabled", "vModelLevel"];
const noStore = { "Cache-Control": "private, no-store, max-age=0", "X-Content-Type-Options": "nosniff" };
const json = (value, status = 200) => Response.json(value, { status, headers: noStore });
const safe = (x) => x && typeof x === "object" && !Array.isArray(x);
const keysAre = (x, expected) => safe(x) &&
  Object.keys(x).sort().join(",") === expected.slice().sort().join(",");
const validControls = (x) => keysAre(x, FIELDS) &&
  typeof x.adversarialReview === "boolean" &&
  typeof x.gateEnabled === "boolean" &&
  Number.isInteger(x.vModelLevel) && x.vModelLevel >= 0 && x.vModelLevel <= 3;

async function parseBody(request) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error("invalid_body");
  const chunks = [];
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.length;
      if (bytes > MAX_BYTES) throw new Error("body_too_large");
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }
  const joined = new Uint8Array(bytes);
  let offset = 0;
  for (const value of chunks) { joined.set(value, offset); offset += value.length; }
  return JSON.parse(new TextDecoder().decode(joined));
}

function fromRow(row) {
  if (!row) return { ...DEFAULTS };
  const out = {
    adversarialReview: row.adversarial_review,
    vModelLevel: row.v_model_level,
    gateEnabled: row.gate_enabled,
  };
  if (!validControls(out)) throw new Error("stored_policy_invalid");
  return out;
}

Deno.serve(async (request) => {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  let sdk, user;
  try {
    sdk = createClientFromRequest(request);
    user = await sdk.auth.me();
  } catch { return json({ error: "unauthorized" }, 401); }
  if (!user || typeof user.id !== "string" || !user.id)
    return json({ error: "unauthorized" }, 401);
  if (user.role !== "admin") return json({ error: "forbidden" }, 403);

  let payload;
  try { payload = await parseBody(request); }
  catch { return json({ error: "invalid_request" }, 400); }
  if (!safe(payload) || !["load", "save"].includes(payload.action))
    return json({ error: "invalid_action" }, 400);
  if (payload.action === "load" && !keysAre(payload, ["action"]))
    return json({ error: "invalid_request" }, 400);
  if (payload.action === "save" && (!keysAre(payload, ["action", "controls", "expectedRevision"]) ||
      !validControls(payload.controls) ||
      !Number.isSafeInteger(payload.expectedRevision) || payload.expectedRevision < 0))
    return json({ error: "invalid_controls" }, 400);

  // App owner scope until tenant membership is independently implemented.
  // NEVER accept owner_user_id, role, tenant_id or another scope from JSON.
  let rows;
  try {
    rows = await sdk.asServiceRole.entities.GateKeeperControlPolicy.filter({
      owner_user_id: user.id,
    }, "-created_date", 2);
  } catch { return json({ error: "policy_store_unavailable" }, 503); }
  if (!Array.isArray(rows) || rows.length > 1 ||
      rows.some((row) => row.owner_user_id !== user.id))
    return json({ error: "policy_store_inconsistent" }, 503);

  const existing = rows[0] ?? null;
  let revision;
  let controls;
  try {
    revision = existing ? existing.revision : 0;
    if (!Number.isSafeInteger(revision) || revision < 0)
      throw new Error("invalid_revision");
    controls = fromRow(existing);
  } catch { return json({ error: "stored_policy_invalid" }, 503); }

  if (payload.action === "load") return json({
    status: "draft_only", controls, revision, scope: "authenticated_admin_owner",
    liveEnforcementEnabled: false, independentSpendingGateRequired: true,
  });

  if (payload.expectedRevision !== revision)
    return json({ error: "revision_conflict", revision }, 409);
  const nextRevision = revision + 1;
  if (!Number.isSafeInteger(nextRevision))
    return json({ error: "revision_exhausted" }, 409);
  const values = {
    adversarial_review: payload.controls.adversarialReview,
    v_model_level: payload.controls.vModelLevel,
    gate_enabled: payload.controls.gateEnabled,
    revision: nextRevision,
  };
  try {
    if (existing) {
      if (typeof existing.id !== "string" || !existing.id)
        return json({ error: "stored_policy_invalid" }, 503);
      await sdk.asServiceRole.entities.GateKeeperControlPolicy.update(existing.id, values);
    } else {
      await sdk.asServiceRole.entities.GateKeeperControlPolicy.create({
        owner_user_id: user.id, ...values,
      });
    }
  } catch { return json({ error: "policy_save_failed" }, 503); }
  return json({
    status: "saved_draft_not_applied",
    controls: { ...payload.controls }, revision: nextRevision,
    scope: "authenticated_admin_owner", liveEnforcementEnabled: false,
    independentSpendingGateRequired: true,
  });
});
