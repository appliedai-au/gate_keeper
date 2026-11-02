// Canonical Gate Keeper review-controls policy, source-only until a trusted
// tenant controller and the existing Base44 app install the server adapter.
// None of these helpers performs inference, writes code or grants permissions.
import profiles from "../../integrations/base44/data/controlProfiles.json" with { type: "json" };
import { DEFAULT_REVIEW_MODE } from "../review-mode.mjs";

export const CONTROL_SCHEMA = profiles.schema;
export const CONTROL_DEFAULTS = Object.freeze({ ...profiles.defaults });
export const V_MODEL_LEVELS = Object.freeze(profiles.levels.map((p) => Object.freeze({
  ...p, requires: Object.freeze([...p.requires]),
})));
const FIELDS = Object.keys(CONTROL_DEFAULTS).sort();
const fail = (reason) => { throw new Error("CONTROL_SETTINGS_INVALID:" + reason); };

if (CONTROL_DEFAULTS.adversarialReview !== (DEFAULT_REVIEW_MODE === "adversarial") ||
    CONTROL_DEFAULTS.vModelLevel !== 0 ||
    V_MODEL_LEVELS.length !== 4 || V_MODEL_LEVELS.some((p, i) => p.id !== i))
  throw new Error("CONTROL_DEFAULTS_DIVERGED");

export function validateControlSettings(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("OBJECT_REQUIRED");
  const keys = Object.keys(value).sort();
  if (keys.length !== FIELDS.length || keys.some((key, i) => key !== FIELDS[i]))
    fail("EXACT_FIELDS_REQUIRED");
  if (typeof value.adversarialReview !== "boolean" || typeof value.gateEnabled !== "boolean")
    fail("BOOLEAN_REQUIRED");
  if (!Number.isInteger(value.vModelLevel) || value.vModelLevel < 0 ||
      value.vModelLevel >= V_MODEL_LEVELS.length)
    fail("INVALID_V_LEVEL");
  return Object.freeze({
    adversarialReview: value.adversarialReview,
    vModelLevel: value.vModelLevel,
    gateEnabled: value.gateEnabled,
  });
}

export function planReviewControls(value = CONTROL_DEFAULTS) {
  const settings = validateControlSettings(value);
  const level = V_MODEL_LEVELS[settings.vModelLevel];
  return Object.freeze({
    settings,
    reviewMode: settings.adversarialReview ? "adversarial" : "lean",
    vModelLevel: level.id,
    validationName: level.label,
    requiredEvidence: Object.freeze([...level.requires]),
    // Adversarial *review method* is optional. At partial/full V strength,
    // adversarial tests remain mandatory even with the reviewer method off.
    advisoryGateEnabled: settings.gateEnabled,
    automaticRepairEnabled: false,
    autonomousReleaseEnabled: false,
    independentBudgetRequiredForPaidCalls: true,
    isolatedSandboxRequiredForRepair: true,
    signedQualificationRequiredForPromotion: true,
    releaseStatus: "HELD_UNTIL_INDEPENDENT_CONTROLLER",
  });
}

// A tenant may opt out of the optional review gate. An administrator may grant
// a time-bounded advisory-gate override with a reason. Neither action can
// enable billable calls, sandbox repair, promotion or production writes.
export function resolveAdvisoryGate({
  settings = CONTROL_DEFAULTS, trustedIdentity, override = null, now = Date.now(),
} = {}) {
  const plan = planReviewControls(settings);
  if (typeof trustedIdentity?.tenantId !== "string" || !trustedIdentity.tenantId ||
      typeof trustedIdentity?.actorId !== "string" || !trustedIdentity.actorId)
    return { enabled: false, reason: "TRUSTED_TENANT_IDENTITY_REQUIRED" };
  if (!plan.advisoryGateEnabled)
    return { enabled: false, reason: "TENANT_OPTED_OUT" };
  if (override !== null) {
    if (trustedIdentity?.adminVerifiedByBackend !== true ||
        override?.scope !== "advisory_gate_only" ||
        override?.tenantId !== trustedIdentity.tenantId ||
        override?.actorId !== trustedIdentity.actorId ||
        typeof override?.reason !== "string" || override.reason.trim().length < 12 ||
        !Number.isFinite(override.expiresAtMs) ||
        !Number.isFinite(now) || override.expiresAtMs <= now ||
        override.expiresAtMs - now > 15 * 60_000)
      return { enabled: false, reason: "INVALID_ADMIN_OVERRIDE_HELD" };
    return { enabled: false, reason: "ADMIN_ADVISORY_OVERRIDE", expiresAtMs: override.expiresAtMs };
  }
  return { enabled: true, reason: "ADVISORY_GATE_ENABLED" };
}

// Source-level preflight only. An actual SDK API call MUST use the independent
// issuer to authenticate budgets, signatures and model routing; the agent and
// a browser cannot set these assertions and self-certify admission.
export function evaluateControlAdmission({
  settings = CONTROL_DEFAULTS, trustedIdentity, action, admission = {},
} = {}) {
  const plan = planReviewControls(settings);
  if (!trustedIdentity?.tenantId || !trustedIdentity?.actorId ||
      trustedIdentity.verifiedByServer !== true)
    return { admitted: false, reason: "TRUSTED_IDENTITY_REQUIRED" };
  if (!["review", "sandbox_candidate", "promote", "deploy"].includes(action))
    return { admitted: false, reason: "UNSUPPORTED_ACTION" };
  if (action === "promote" || action === "deploy")
    return { admitted: false, reason: "INDEPENDENT_RELEASE_CONTROLLER_REQUIRED" };
  if (plan.settings.gateEnabled === false && action === "review")
    return { admitted: false, reason: "TENANT_OPTED_OUT" };
  if (admission.sourcePinned !== true || admission.tenantScoped !== true)
    return { admitted: false, reason: "SOURCE_OR_TENANT_BOUNDARY_REQUIRED" };
  if (admission.trustedControllerValidated !== true ||
      admission.sponsorFundingVerified !== true ||
      admission.externalBudgetEnforced !== true ||
      admission.modelRegistered !== true ||
      admission.personalFallbackDisabled !== true)
    return { admitted: false, reason: "INDEPENDENT_SPENDING_ADMISSION_REQUIRED" };
  if (action === "sandbox_candidate") {
    if (plan.vModelLevel < 2)
      return { admitted: false, reason: "REVIEW_ONLY_PROFILE" };
    if (admission.sandboxIsolated !== true || admission.repairScopeApproved !== true ||
        admission.testRunnerRestricted !== true || admission.originPinned !== true)
      return { admitted: false, reason: "SANDBOX_SCOPE_NOT_QUALIFIED" };
    // Even when admission is complete, this does not authorise writes to a
    // protected repository, tenants, release controllers or production.
    return { admitted: true, scope: "isolated_candidate_only", controllerRevalidationRequired: true,
      checks: plan.requiredEvidence };
  }
  return { admitted: true, scope: "read_only_review", controllerRevalidationRequired: true,
    reviewMode: plan.reviewMode, checks: plan.requiredEvidence };
}
