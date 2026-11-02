import test from "node:test";
import assert from "node:assert/strict";
import { requireCommissionedPin } from "../scripts/proof/sponsor-admission.mjs";
import pin from "../config/gk-sponsor-issuer-pin.json" with { type: "json" };

const base = { status: "VERIFIED", signerPublicKeySha256: "a".repeat(64), issuerVerifiedBy: "owner" };

test("commissioned pin requires a known attestation label", () => {
  assert.throws(() => requireCommissionedPin({ ...base }), /ISSUER_ATTESTATION_UNKNOWN/);
  assert.throws(() => requireCommissionedPin({ ...base, attestation: "SELF" }), /ISSUER_ATTESTATION_UNKNOWN/);
  assert.deepEqual({ ...requireCommissionedPin({ ...base, attestation: "OWNER_ATTESTED" }) },
    { attestation: "OWNER_ATTESTED", issuerVerifiedBy: "owner" });
});

test("uncommissioned pin still blocks", () => {
  assert.throws(() => requireCommissionedPin({ status: "UNCOMMISSIONED" }), /NOT_COMMISSIONED/);
});

test("repo pin is owner-attested and its PEM matches the fingerprint", async () => {
  const { createHash } = await import("node:crypto");
  assert.equal(pin.attestation, "OWNER_ATTESTED");
  assert.equal(createHash("sha256").update(pin.signerPublicKeyPem).digest("hex"), pin.signerPublicKeySha256);
});
