/**
 * Sponsor-credit smoke admission. The entrypoint is fail-closed: until an
 * independently issued, signed funding + gateway-budget receipt is mounted,
 * it cannot start a session or a billable model turn.
 *
 * The trusted signer's PEM fingerprint must be pinned independently, outside
 * this process. A self-signed receipt is not proof of sponsor funding.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import catalogue from "../../config/stranger-builds-catalogue.json" with { type: "json" };

const EXPECTED_ORIGIN = "https://stranger-builds.truefoundry.cloud/api/llm";
export const CHEAP_SMOKE_MODELS = Object.freeze([
  "truefoundry/deepseek-v4-flash-0731",
  "truefoundry/mimo-v2.6-flash",
]);
export const ISOLATED_RAILWAY_PROJECT = "a8f4c4a4-0f32-4166-ba92-dad9baf2b652";
export const ISOLATED_RAILWAY_ENV = "03fb9181-2f19-409b-a9b1-823cb32e56c2";
const MAX_CAP_USD = 1;

const fail = (reason) => { throw new Error("SPONSOR_SMOKE_BLOCKED: " + reason); };
const digest = (x) => createHash("sha256").update(x).digest("hex");
const exact = (v) => typeof v === "string" && v.length > 0 && v === v.trim();
const validHash = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);

export function smokePlan({ model = CHEAP_SMOKE_MODELS[0] } = {}) {
  if (!CHEAP_SMOKE_MODELS.includes(model) || !catalogue.chatModels.includes(model.split("/")[1]))
    fail("UNAPPROVED_SMOKE_MODEL");
  return Object.freeze({
    status: "HELD_UNTIL_SIGNED_SPONSOR_AND_BUDGET_RECEIPTS",
    tenant: "stranger-builds",
    upstreamProvider: "tfy-managed",
    runtimeProvider: "truefoundry",
    model,
    fixture: "01-python-utils",
    arms: ["baseline", "gate_keeper"],
    trials: 1,
    totalModelTurns: 2,
    outputTokensPerTurnMax: 500,
    maxGatewayLifetimeUsd: MAX_CAP_USD,
    paidFallback: false,
    grader: false,
    repair: false,
    learning: false,
    productionWrites: false,
  });
}

/**
 * Two claims MUST be signed by an independently trusted issuer. The signature
 * covers exactly JSON.stringify(statement), not text copied out of the UI.
 * A protected trusted key with a separately pinned fingerprint is mandatory.
 */
export function verifySponsorAdmission({
  evidence, publicKeyPem, pinnedKeySha256, sourceCommit, model, runId,
  now = Date.now(),
} = {}) {
  smokePlan({ model });
  if (!validHash(pinnedKeySha256) || typeof publicKeyPem !== "string" || publicKeyPem.length === 0 ||
      digest(publicKeyPem) !== pinnedKeySha256) fail("TRUSTED_ISSUER_KEY_NOT_PINNED");
  if (!evidence || typeof evidence !== "object" ||
      !evidence.statement || typeof evidence.signature !== "string" ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(evidence.signature)) fail("SIGNED_RECEIPT_MISSING");
  let key;
  try { key = createPublicKey(publicKeyPem); } catch { fail("TRUSTED_KEY_INVALID"); }
  if (key.asymmetricKeyType !== "ed25519") fail("TRUSTED_KEY_NOT_ED25519");
  const bytes = Buffer.from(JSON.stringify(evidence.statement), "utf8");
  let valid = false;
  try { valid = verify(null, bytes, key, Buffer.from(evidence.signature, "base64")); } catch {}
  if (!valid) fail("SPONSOR_RECEIPT_SIGNATURE_INVALID");
  const s = evidence.statement;
  if (!/^[a-f0-9]{40}$/.test(sourceCommit || "") || s.sourceCommit !== sourceCommit)
    fail("SOURCE_COMMIT_UNBOUND");
  if (s.tenant !== "stranger-builds" || s.provider !== "tfy-managed" ||
      s.fundingSource !== "sponsor-inference-credit" ||
      s.personalBillingFallbackDisabled !== true || s.overageDisabled !== true)
    fail("SPONSOR_FUNDING_UNATTESTED");
  if (s.model !== model || s.fixture !== "01-python-utils")
    fail("MODEL_OR_FIXTURE_MISMATCH");
  if (!/^gk-sponsor-[a-zA-Z0-9_-]{8,65}$/.test(runId || "") || s.runId !== runId)
    fail("RUN_ID_NOT_BOUND");
  if (!exact(s.virtualAccountId) || !/^gate-keeper-smoke-[a-zA-Z0-9-]+$/.test(s.virtualAccountId))
    fail("DEDICATED_VIRTUAL_ACCOUNT_REQUIRED");
  if (!Number.isFinite(s.sponsorCreditRemainingUsd) || s.sponsorCreditRemainingUsd <= 0)
    fail("CREDIT_BALANCE_NOT_CONFIRMED");
  if (!Number.isFinite(s.issuedAt) || !Number.isFinite(s.expiresAt) ||
      s.issuedAt > now || s.expiresAt <= now || s.expiresAt - s.issuedAt > 86400000 ||
      now - s.issuedAt > 86400000)
    fail("RECEIPT_EXPIRED_OR_INVALID");
  const p = s.gatewayBudget;
  if (!p || !exact(p.ruleId) || p.subject !== s.virtualAccountId ||
      p.scope !== "per-virtual-account" || p.mode !== "Enforce" ||
      p.period !== "Lifetime" || p.currency !== "USD" ||
      !Number.isFinite(p.limitUsd) || p.limitUsd <= 0 || p.limitUsd > MAX_CAP_USD ||
      !Number.isFinite(p.remainingUsd) || p.remainingUsd <= 0 || p.remainingUsd > p.limitUsd)
    fail("GATEWAY_BUDGET_NOT_ENFORCED");
  if (s.maxTurns !== 2 || s.maxOutputTokensPerTurn !== 500 ||
      s.noAutomaticRetry !== true || s.allowTools !== false ||
      s.allowRepair !== false || s.allowLearning !== false || s.publicFixtureOnly !== true)
    fail("CALL_SCOPE_NOT_APPROVED");
  return Object.freeze({
    status: "SIGNED_RECEIPT_VALID_STRUCTURE_AND_SIGNATURE",
    // This does not independently verify the issuer's entitlement or the
    // gateway's live counters; that must be established before trusting the key.
    virtualAccountId: s.virtualAccountId,
    model, sourceCommit, hardCapUsd: p.limitUsd, evidenceSha256: digest(bytes),
    expiresAt: s.expiresAt, offlineCreditAttestedUsd: s.sponsorCreditRemainingUsd,
  });
}

/** Refuse to create any inference sessions outside the separately provisioned
 * qualification project/environment, even if receipts or tokens are present. */
export function requireIsolatedRailway(env = {}) {
  if (env.RAILWAY_PROJECT_ID !== ISOLATED_RAILWAY_PROJECT ||
      env.RAILWAY_ENVIRONMENT_ID !== ISOLATED_RAILWAY_ENV ||
      !env.RAILWAY_GIT_COMMIT_SHA ||
      env.RAILWAY_ENVIRONMENT_NAME !== "qualification" ||
      env.RAILWAY_PROJECT_ID === "507ae09d-7dbb-444a-bd62-a5a16405c874")
    fail("ISOLATED_RAILWAY_ENVIRONMENT_REQUIRED");
  return true;
}

/** Read-only preflight. Require matching provider, pinned origin and exact
 * upstream model ID; a catalogue listing by itself grants no runtime access. */
export function assertTrueForgeRoute({ providers, models, model }) {
  smokePlan({ model });
  if (!Array.isArray(providers) || !Array.isArray(models)) fail("RUNTIME_CATALOGUE_UNAVAILABLE");
  const matches = providers.filter((p) => p?.name === "truefoundry");
  if (matches.length !== 1 || matches[0]?.manifest?.type !== "truefoundry")
    fail("TRUEFOUNDRY_PROVIDER_UNAVAILABLE");
  const manifest = matches[0].manifest;
  const url = manifest.baseUrl ?? manifest.base_url;
  if (url !== EXPECTED_ORIGIN) fail("WRONG_SPONSOR_GATEWAY");
  const target = model.split("/")[1];
  const upstream = manifest.models || [];
  if (!Array.isArray(upstream) || upstream.length !== 1 ||
      upstream[0]?.name !== target ||
      (upstream[0]?.modelId ?? upstream[0]?.model_id) !== "tfy-managed/" + target)
    fail("SINGLE_APPROVED_MODEL_NOT_REGISTERED");
  if (!models.some((m) => m?.name === model && m?.provider?.name === "truefoundry"))
    fail("MODEL_NOT_AVAILABLE_IN_TRUEFORGE");
  return { model, upstreamId: "tfy-managed/" + target, gateway: EXPECTED_ORIGIN };
}
