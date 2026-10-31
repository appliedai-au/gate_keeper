/** A learning proposal may use feedback only from an independently sealed
 * evaluation. This module verifies evidence, not the TrueForge model.
 */
import {readFileSync} from "node:fs";
import {createHash,createPublicKey,verify} from "node:crypto";
import {verifyBaselineReceipt} from "./learning-trust.mjs";
const H64=/^[a-f0-9]{64}$/;
const hash=bytes=>createHash("sha256").update(bytes).digest("hex");
function fail(msg){throw new Error("BASELINE_REJECTED: "+msg);}
export function validateSealedBaseline({
 scoreBytes,resultsBytes,receiptBytes,scorerBytes,
 publicKeyPem,pinnedFingerprint,sourceCommit,benchmarkDigest,run
}) {
 if(!scoreBytes||!resultsBytes||!receiptBytes||!scorerBytes||!sourceCommit) fail("missing evidence");
 if(!H64.test(benchmarkDigest||"")) fail("invalid benchmark identity");
 let score,receipt;
 try {score=JSON.parse(scoreBytes.toString());receipt=JSON.parse(receiptBytes.toString());}
 catch {fail("invalid JSON evidence");}
 if(!score || score.run!==run || score.agent_commit!==sourceCommit ||
    score.benchmark_sha256!==benchmarkDigest ||
    typeof score.session_id!=="string" || score.session_id.length<6 ||
    score.qualification!=="benchmark_frozen_only") fail("evaluation identity mismatch");
 if(!receipt || !receipt.body || typeof receipt.signature!=="string") fail("signed receipt absent");
 const expected={run,source_commit:sourceCommit,benchmark_sha256:benchmarkDigest,
   score_sha256:hash(scoreBytes),results_sha256:hash(resultsBytes),
   scorer_sha256:hash(scorerBytes),session_id:score.session_id};
 const verified=verifyBaselineReceipt({body:receipt.body,signature:receipt.signature,
   publicKeyPem,pinnedFingerprint,expected});
 return Object.freeze({verified:true,run:verified.run,session_id:verified.session_id,
   source_commit:verified.source_commit,benchmark_sha256:verified.benchmark_sha256});
}
