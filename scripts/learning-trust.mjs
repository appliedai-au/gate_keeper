/**
 * Gate Keeper phase 2: trust contract for offline baseline evidence and
 * pre-paid TrueForge budget admission. No signing key or provider API here.
 * The independent verifier / billing gateway owns signing and settlement.
 */
import {createHash, createPublicKey, verify} from "node:crypto";

const SHA256=/^[0-9a-f]{64}$/;
const SHA1=/^[0-9a-f]{40}$/;
const IDENT=/^[A-Za-z0-9][A-Za-z0-9_.:/-]{5,127}$/;
export const digest = value => createHash("sha256").update(value).digest("hex");

function fail(message) {throw new Error("TRUST_REJECTED: "+message);}

export function verifyEnvelope({body,signature,publicKeyPem,pinnedFingerprint}) {
  if(!body || typeof body!=="object" || Array.isArray(body)) fail("missing envelope");
  if(!SHA256.test(pinnedFingerprint||"")) fail("trusted fingerprint missing");
  let key,der;
  try {key=createPublicKey(publicKeyPem);der=key.export({type:"spki",format:"der"});}
  catch {fail("invalid verifier key");}
  if(digest(der)!==pinnedFingerprint) fail("untrusted signer");
  if(typeof signature!=="string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) fail("signature encoding");
  const bytes=Buffer.from(signature,"base64");
  if(bytes.length!==64 || !verify(null,Buffer.from(JSON.stringify(body)),key,bytes)) fail("signature mismatch");
  return body;
}

/** Admission does NOT replace a live provider-side limit; it proves only that
 * a separately authenticated budget controller signed an enforceable lease.
 * Refuse expired/off-repository/wrong-action or unknown gateway claims.
 */
export function verifyBudgetLease({body,signature,publicKeyPem,pinnedFingerprint,expected,now=Date.now()}) {
  const lease=verifyEnvelope({body,signature,publicKeyPem,pinnedFingerprint});
  if(lease.schema!=="gk-trueforge-lease-v1" || lease.provider!=="trueforge") fail("wrong lease schema/provider");
  if(!["eval","improve"].includes(lease.action) || lease.action!==expected.action) fail("wrong action");
  if(!SHA1.test(lease.source_commit||"") || lease.source_commit!==expected.source_commit) fail("source drift");
  if(!SHA256.test(lease.benchmark_sha256||"") || lease.benchmark_sha256!==expected.benchmark_sha256) fail("benchmark drift");
  if(!IDENT.test(lease.gateway_lease_id||"") || !IDENT.test(lease.gateway_id||"") ||
     !expected.gateway_id || lease.gateway_id!==expected.gateway_id) fail("untrusted gateway identity");
  if(lease.provider_limit_enforced!==true) fail("no provider-enforced budget");
  if(!Number.isSafeInteger(lease.max_calls) || lease.max_calls<1 || lease.max_calls>20 ||
     !Number.isFinite(lease.max_usd) || lease.max_usd<=0 || lease.max_usd>10) fail("invalid budget ceiling");
  const starts=Date.parse(lease.issued_at),ends=Date.parse(lease.expires_at);
  if(!Number.isFinite(starts) || !Number.isFinite(ends) || starts>now+60000 ||
     ends<=now || ends-starts>3600000 || starts>ends) fail("expired/invalid lease");
  if(!IDENT.test(lease.model||"") || lease.model!==expected.model) fail("model drift");
  if(!expected.purpose || lease.purpose!==expected.purpose) fail("unbound purpose");
  return Object.freeze({max_calls:lease.max_calls,max_usd:lease.max_usd,
    lease_id:lease.gateway_lease_id,expires_at:lease.expires_at});
}

/** Only a detached scorer can attest evaluation results. The learner sees the
 * transcript and feedback but cannot manufacture an accepted baseline record.
 */
export function verifyBaselineReceipt({body,signature,publicKeyPem,pinnedFingerprint,expected}) {
  const receipt=verifyEnvelope({body,signature,publicKeyPem,pinnedFingerprint});
  if(receipt.schema!=="gk-baseline-receipt-v1" || receipt.verdict!=="settled") fail("unsettled baseline");
  if(!Number.isSafeInteger(receipt.run) || receipt.run<1 || receipt.run!==expected.run) fail("run mismatch");
  if(!SHA1.test(receipt.source_commit||"") || receipt.source_commit!==expected.source_commit) fail("source mismatch");
  for(const key of ["benchmark_sha256","score_sha256","results_sha256","scorer_sha256"]) {
    if(!SHA256.test(receipt[key]||"") || receipt[key]!==expected[key]) fail(key+" mismatch");
  }
  if(!IDENT.test(receipt.session_id||"") || receipt.session_id!==expected.session_id) fail("session mismatch");
  if(receipt.independent!==true || receipt.complete!==true ||
    !Number.isFinite(receipt.cost_usd) || receipt.cost_usd<0) fail("incomplete independent evidence");
  return Object.freeze({run:receipt.run, source_commit:receipt.source_commit,
    benchmark_sha256:receipt.benchmark_sha256, session_id:receipt.session_id});
}
