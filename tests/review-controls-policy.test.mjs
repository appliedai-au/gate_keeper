import test from "node:test";
import assert from "node:assert/strict";
import profiles from "../integrations/base44/data/controlProfiles.json" with { type: "json" };
import { DEFAULT_REVIEW_MODE } from "../scripts/review-mode.mjs";
import {
  CONTROL_DEFAULTS, V_MODEL_LEVELS, validateControlSettings, planReviewControls,
  resolveAdvisoryGate, evaluateControlAdmission,
} from "../scripts/execution/review-controls.mjs";

const defaults = () => ({ ...CONTROL_DEFAULTS });
const identity = () => ({ verifiedByServer: true, tenantId: "owner-tenant", actorId: "admin-1", adminVerifiedByBackend: true });
const admitted = () => ({
  sourcePinned: true, tenantScoped: true,
  trustedControllerValidated: true, sponsorFundingVerified: true,
  externalBudgetEnforced: true, modelRegistered: true,
  personalFallbackDisabled: true, sandboxIsolated: true,
  repairScopeApproved: true, testRunnerRestricted: true, originPinned: true,
});

test("exact current Gatekeeper is the default: adversarial, level zero, advisory gate on", () => {
  assert.equal(DEFAULT_REVIEW_MODE, "adversarial");
  assert.deepEqual(defaults(), { adversarialReview: true, vModelLevel: 0, gateEnabled: true });
  assert.deepEqual(profiles.defaults, defaults());
  const plan = planReviewControls();
  assert.equal(plan.reviewMode, "adversarial");
  assert.equal(plan.vModelLevel, 0);
  assert.equal(plan.validationName, "Current Gatekeeper");
  assert.deepEqual(plan.requiredEvidence, ["review"]);
  assert.equal(plan.automaticRepairEnabled, false);
  assert.equal(plan.autonomousReleaseEnabled, false);
  assert.equal(plan.releaseStatus, "HELD_UNTIL_INDEPENDENT_CONTROLLER");
});

test("four strength levels are separate from method checkbox and preserve mandatory adversarial tests", () => {
  assert.deepEqual(V_MODEL_LEVELS.map(x=>x.id), [0,1,2,3]);
  assert.deepEqual(V_MODEL_LEVELS.map(x=>x.key), ["current","enhanced","partial","full"]);
  const lean = planReviewControls({ ...defaults(), adversarialReview: false, vModelLevel: 2 });
  assert.equal(lean.reviewMode, "lean");
  assert.ok(lean.requiredEvidence.includes("adversarial"), "method off cannot waive V-level adversarial tests");
  assert.ok(lean.requiredEvidence.includes("unit"));
  assert.equal(lean.autonomousReleaseEnabled, false);
  const full = planReviewControls({ ...defaults(), vModelLevel: 3 });
  assert.ok(full.requiredEvidence.includes("independent_qualification"));
  assert.ok(full.requiredEvidence.includes("signed_budget_settlement"));
  assert.ok(full.requiredEvidence.includes("sealed_holdout"));
  assert.equal(full.automaticRepairEnabled, false);
});

test("parser rejects extra fields, absent booleans, invalid levels and type coercions", () => {
  for (const bad of [undefined, null, [], {}, { adversarialReview: false },
    { ...defaults(), vModelLevel: -1 }, { ...defaults(), vModelLevel: 4 },
    { ...defaults(), vModelLevel: 1.5 }, { ...defaults(), vModelLevel: "3" },
    { ...defaults(), adversarialReview: "false" }, { ...defaults(), gateEnabled: 1 },
    { ...defaults(), role: "admin" }, { ...defaults(), isAuthorized: true },
    { ...defaults(), owner_user_id: "another-tenant" }
  ]) assert.throws(() => validateControlSettings(bad), /CONTROL_SETTINGS_INVALID/);
  assert.deepEqual(validateControlSettings({ ...defaults(), adversarialReview: false }),
    { adversarialReview: false, vModelLevel: 0, gateEnabled: true });
});

test("tenant opt out only affects optional advisory review and requires backend identity", () => {
  assert.equal(resolveAdvisoryGate({ settings: defaults() }).reason, "TRUSTED_TENANT_IDENTITY_REQUIRED");
  assert.deepEqual(resolveAdvisoryGate({ trustedIdentity: identity(), settings: defaults() }),
    { enabled: true, reason: "ADVISORY_GATE_ENABLED" });
  assert.equal(resolveAdvisoryGate({ trustedIdentity: identity(),
    settings: { ...defaults(), gateEnabled: false } }).reason, "TENANT_OPTED_OUT");
});

test("admin advisory override is scoped, justified, short-lived and never widens paid authority", () => {
  const now = Date.parse("2026-11-02T00:00:00Z");
  const override = {
    scope: "advisory_gate_only", tenantId: "owner-tenant", actorId: "admin-1",
    reason: "Tenant review gate temporarily waived", expiresAtMs: now + 10 * 60_000,
  };
  assert.equal(resolveAdvisoryGate({ trustedIdentity: identity(), now, override }).reason, "ADMIN_ADVISORY_OVERRIDE");
  for (const diff of [
    { actorId: "somebody-else" }, { tenantId: "other-tenant" },
    { reason: "" }, { scope: "all_security_checks" },
    { expiresAtMs: now - 1 }, { expiresAtMs: now + 60 * 60_000 },
  ]) assert.equal(resolveAdvisoryGate({ trustedIdentity: identity(), now,
      override: { ...override, ...diff } }).reason, "INVALID_ADMIN_OVERRIDE_HELD");
  assert.equal(resolveAdvisoryGate({ trustedIdentity: { ...identity(), adminVerifiedByBackend: false },
    now, override }).reason, "INVALID_ADMIN_OVERRIDE_HELD");
  assert.equal(evaluateControlAdmission({ settings: defaults(), action: "review", trustedIdentity: identity() }).admitted,false);
});

test("admission requires backend identity and independent spend for every live model call", () => {
  const settings = defaults();
  const good = admitted();
  for (const diff of [
    { sourcePinned: false }, { tenantScoped: false },
    { trustedControllerValidated: false }, { sponsorFundingVerified: false },
    { externalBudgetEnforced: false }, { modelRegistered: false },
    { personalFallbackDisabled: false },
  ]) {
    const outcome = evaluateControlAdmission({ settings, trustedIdentity: identity(),
      action: "review", admission: { ...good, ...diff } });
    assert.equal(outcome.admitted, false, JSON.stringify(diff));
  }
  assert.equal(evaluateControlAdmission({ settings, trustedIdentity: {
    ...identity(), verifiedByServer: false }, action: "review", admission: good }).reason, "TRUSTED_IDENTITY_REQUIRED");
  const accepted = evaluateControlAdmission({ settings, trustedIdentity: identity(), action: "review", admission: good });
  assert.equal(accepted.scope, "read_only_review");
  assert.equal(accepted.controllerRevalidationRequired, true);
  assert.equal(accepted.reviewMode, "adversarial");
  assert.equal(evaluateControlAdmission({ settings: { ...settings, gateEnabled: false },
    trustedIdentity: identity(), action: "review", admission: good }).reason, "TENANT_OPTED_OUT");
});

test("repair is impossible in current defaults and bounded to isolated candidates at levels 2–3", () => {
  const context = { trustedIdentity: identity(), admission: admitted(), action: "sandbox_candidate" };
  assert.equal(evaluateControlAdmission({ ...context, settings: defaults() }).reason, "REVIEW_ONLY_PROFILE");
  for (const broken of [
    { sandboxIsolated: false }, { repairScopeApproved: false },
    { testRunnerRestricted: false }, { originPinned: false },
  ]) {
    const p = evaluateControlAdmission({ ...context, settings: { ...defaults(), vModelLevel: 2 },
      admission: { ...admitted(), ...broken } });
    assert.equal(p.admitted, false);
    assert.equal(p.reason, "SANDBOX_SCOPE_NOT_QUALIFIED");
  }
  const accepted = evaluateControlAdmission({ ...context, settings: { ...defaults(), vModelLevel: 2 } });
  assert.equal(accepted.admitted, true);
  assert.equal(accepted.scope, "isolated_candidate_only");
  assert.equal(accepted.controllerRevalidationRequired, true);
  for (const action of ["promote","deploy"]) {
    const denied = evaluateControlAdmission({ ...context, action,
      settings: { ...defaults(), vModelLevel: 3 } });
    assert.equal(denied.admitted, false);
    assert.equal(denied.reason, "INDEPENDENT_RELEASE_CONTROLLER_REQUIRED");
  }
  assert.equal(evaluateControlAdmission({ ...context, action: "delete_production",
    settings: { ...defaults(), vModelLevel: 3 } }).reason, "UNSUPPORTED_ACTION");
});
