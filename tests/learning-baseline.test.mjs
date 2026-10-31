import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {digest} from "../scripts/learning-trust.mjs";
import {validateSealedBaseline} from "../scripts/learning-baseline.mjs";

const key=generateKeyPairSync("ed25519");
const publicKeyPem=key.publicKey.export({type:"spki",format:"pem"});
const pinnedFingerprint=digest(key.publicKey.export({type:"spki",format:"der"}));
const sourceCommit="a".repeat(40),benchmarkDigest="b".repeat(64),run=1;
const scorerBytes=Buffer.from("export const score = 1;\n");
const scoreBytes=Buffer.from(JSON.stringify({run,agent_commit:sourceCommit,
 benchmark_sha256:benchmarkDigest,session_id:"session-0123456789",
 qualification:"benchmark_frozen_only"})+"\n");
const resultsBytes=Buffer.from('[{"task_id":"known","score":0.5}]\n');
const receipt={schema:"gk-baseline-receipt-v1",verdict:"settled",run,
 source_commit:sourceCommit,benchmark_sha256:benchmarkDigest,
 score_sha256:digest(scoreBytes),results_sha256:digest(resultsBytes),
 scorer_sha256:digest(scorerBytes),session_id:"session-0123456789",
 independent:true,complete:true,cost_usd:0.17};
const signature=body=>sign(null,Buffer.from(JSON.stringify(body)),key.privateKey).toString("base64");
const evidence=body=>Buffer.from(JSON.stringify({body,signature:signature(body)}));
const check=(overrides={})=>validateSealedBaseline({scoreBytes,resultsBytes,
 receiptBytes:evidence(receipt),scorerBytes,publicKeyPem,pinnedFingerprint,
 sourceCommit,benchmarkDigest,run,...overrides});
test("independent signed baseline admitted",()=>assert.equal(check().verified,true));
test("modified scoring bytes cannot be accepted",()=>assert.throws(()=>check({scoreBytes:Buffer.from(scoreBytes.toString()+" ")}),/score_sha256 mismatch/));
test("modified findings cannot be accepted",()=>assert.throws(()=>check({resultsBytes:Buffer.from("[]")}),/results_sha256 mismatch/));
test("modified scorer cannot be accepted",()=>assert.throws(()=>check({scorerBytes:Buffer.from("modified")}),/scorer_sha256 mismatch/));
test("source and benchmark changes rejected",()=>{
 assert.throws(()=>check({sourceCommit:"c".repeat(40)}),/identity mismatch/);
 assert.throws(()=>check({benchmarkDigest:"c".repeat(64)}),/identity mismatch/);
});
test("unsigned receipt rejected",()=>assert.throws(()=>check({receiptBytes:Buffer.from(JSON.stringify({body:receipt,signature:""}))}),/signature encoding/));
test("untrusted verifier rejected",()=>assert.throws(()=>check({pinnedFingerprint:"f".repeat(64)}),/untrusted signer/));
test("unfrozen benchmark denied",()=>{
 const altered={...JSON.parse(scoreBytes.toString()),qualification:"unqualified"};
 assert.throws(()=>check({scoreBytes:Buffer.from(JSON.stringify(altered))}),/evaluation identity mismatch/);
});
