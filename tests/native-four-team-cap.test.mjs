import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, sign, createHash } from "node:crypto";
import { verifyNativeFourAdmission, fixtureDigest, loadHardFixtures, STUDY_ID, MODEL, UPSTREAM } from "../scripts/proof/native-four-run.mjs";

const hash = (v) => createHash("sha256").update(v).digest("hex");
function make(overrides = {}, budget = {}) {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" });
  const sourceCommit = "a".repeat(40), runId = "gk-native-deepseek-teamcap-test";
  const issuedAt = Date.now();
  const statement = {
    study: STUDY_ID, runId, sourceCommit, fixtureDigestSha256: fixtureDigest(loadHardFixtures()),
    tenant: "stranger-builds", provider: "tfy-managed", model: MODEL, upstreamModel: UPSTREAM,
    fundingSource: "sponsor-inference-credit", personalBillingFallbackDisabled: true,
    overageDisabled: true, noTools: true, noRepair: true, noAutomaticRetry: true,
    maxReviewTurns: 8, maxLearningTurns: 6, maxTurns: 14, maxReviewTokens: 2500, maxLearningTokens: 400,
    credentialKind: "personal-access-token", tokenOwner: "owner", localHardCapUsd: 5,
    gatewayBudget: { ruleId: "synthetic-test-only", subject: "Applied_AI", scope: "team",
      mode: "Enforce", period: "Lifetime", currency: "USD", limitUsd: 50, remainingUsd: 49.9, ...budget },
    sponsorCreditRemainingUsd: 49.9, issuedAt, expiresAt: issuedAt + 60000, ...overrides,
  };
  const receipt = { statement, signature: sign(null, Buffer.from(JSON.stringify(statement), "utf8"), privateKey).toString("base64") };
  return { receipt, publicKeyPem: pem, pinnedKeySha256: hash(pem), sourceCommit, runId, now: issuedAt + 1000 };
}

test("team-capped personal token admits with a local US$5 stop and a label", () => {
  const g = verifyNativeFourAdmission(make());
  assert.equal(g.hardCapUsd, 5);
  assert.equal(g.gatewayCapUsd, 50);
  assert.equal(g.budgetEnforcement, "TEAM_GATEWAY_ENFORCE_PLUS_LOCAL_HARD_STOP");
});

test("team path rejects wrong team, soft modes, caps over US$50 and a missing local cap", () => {
  for (const [o, b] of [[{}, { subject: "Other_Team" }], [{}, { mode: "Audit" }], [{}, { limitUsd: 51, remainingUsd: 51 }],
      [{}, { remainingUsd: 4 }], [{ localHardCapUsd: 6 }, {}], [{ tokenOwner: "" }, {}], [{}, { period: "Monthly" }]])
    assert.throws(() => verifyNativeFourAdmission(make(o, b)), /TEAM_CAPPED_PERSONAL_TOKEN_BUDGET_UNVERIFIED/);
});
