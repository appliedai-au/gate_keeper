import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign} from "node:crypto";
import {verifyBudgetLease,verifyBaselineReceipt,digest} from "../scripts/learning-trust.mjs";
const pair=generateKeyPairSync("ed25519");
const publicKeyPem=pair.publicKey.export({type:"spki",format:"pem"});
const pinnedFingerprint=digest(pair.publicKey.export({type:"spki",format:"der"}));
const sha1="a".repeat(40),sha256="b".repeat(64),now=Date.parse("2026-10-31T03:30:00Z");
const lease={schema:"gk-trueforge-lease-v1",provider:"trueforge",action:"eval",
 source_commit:sha1,benchmark_sha256:sha256,model:"anthropic/claude-sonnet-4-6",
 gateway_id:"trusted-gateway-01",gateway_lease_id:"lease-01234567890",
 provider_limit_enforced:true,max_calls:5,max_usd:3,purpose:"private_eval",
 issued_at:"2026-10-31T03:00:00Z",expires_at:"2026-10-31T04:00:00Z"};
const expected={action:"eval",source_commit:sha1,benchmark_sha256:sha256,
 model:lease.model,gateway_id:lease.gateway_id,purpose:"private_eval"};
const signed=body=>sign(null,Buffer.from(JSON.stringify(body)),pair.privateKey).toString("base64");
const check=(body=lease,pin=pinnedFingerprint,exp=expected)=>verifyBudgetLease({
 body,signature:signed(body),publicKeyPem,pinnedFingerprint:pin,expected:exp,now});
test("genuine lease accepted",()=>assert.equal(check().max_calls,5));
test("missing fingerprint fails",()=>assert.throws(()=>check(lease,undefined),/trusted fingerprint/));
test("rogue signer fails",()=>{
 const rogue=generateKeyPairSync("ed25519");
 assert.throws(()=>verifyBudgetLease({body:lease,signature:sign(null,Buffer.from(JSON.stringify(lease)),rogue.privateKey).toString("base64"),
 publicKeyPem:rogue.publicKey.export({type:"spki",format:"pem"}),pinnedFingerprint,expected,now}),/untrusted signer/);
});
test("source and benchmark drift rejected",()=>{
 assert.throws(()=>check({...lease,source_commit:"c".repeat(40)}),/source drift/);
 assert.throws(()=>check({...lease,benchmark_sha256:"c".repeat(64)}),/benchmark drift/);
});
test("no external spending control rejected",()=>assert.throws(()=>check({...lease,provider_limit_enforced:false}),/provider-enforced/));
test("expired and unbounded leases rejected",()=>{
 assert.throws(()=>check({...lease,expires_at:"2026-10-31T02:30:00Z"}),/expired/);
 assert.throws(()=>check({...lease,max_usd:99}),/budget ceiling/);
});
test("wrong model purpose and gateway rejected",()=>{
 assert.throws(()=>check({...lease,model:"anthropic/other-model"}),/model drift/);
 assert.throws(()=>check({...lease,purpose:"private_improve"}),/purpose/);
 assert.throws(()=>check({...lease,gateway_id:"rogue-gateway-01"}),/gateway/);
});
test("missing signature rejected",()=>assert.throws(()=>verifyBudgetLease({body:lease,
 signature:"",publicKeyPem,pinnedFingerprint,expected,now}),/signature encoding/));
const receipt={schema:"gk-baseline-receipt-v1",verdict:"settled",run:1,source_commit:sha1,
 benchmark_sha256:sha256,score_sha256:sha256,results_sha256:sha256,scorer_sha256:sha256,
 session_id:"session-0123456789",independent:true,complete:true,cost_usd:0.1};
const baselineExpected={run:1,source_commit:sha1,benchmark_sha256:sha256,score_sha256:sha256,
 results_sha256:sha256,scorer_sha256:sha256,session_id:receipt.session_id};
const verifyReceipt=(body,signature=signed(body))=>verifyBaselineReceipt({body,signature,publicKeyPem,pinnedFingerprint,expected:baselineExpected});
test("signed baseline receipt accepted",()=>assert.equal(verifyReceipt(receipt).run,1));
test("forged baseline result rejected",()=>{
 assert.throws(()=>verifyReceipt({...receipt,results_sha256:"c".repeat(64)}),/results_sha256 mismatch/);
});
test("tampered baseline signature rejected",()=>{
 assert.throws(()=>verifyReceipt({...receipt,cost_usd:0.0},signed(receipt)),/signature mismatch/);
});
