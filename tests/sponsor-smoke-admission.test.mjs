import test from "node:test";
import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import {
  smokePlan, verifySponsorAdmission, requireIsolatedRailway,
  assertTrueForgeRoute,
} from "../scripts/proof/sponsor-admission.mjs";
import { runPairedSmoke, publicFixture, pollSingleTurn } from "../scripts/proof/sponsor-smoke.mjs";

const model="truefoundry/deepseek-v4-flash-0731";
const sha="a".repeat(40);
const runId="gk-sponsor-smoke-20261102-a";
const now=Date.parse("2026-11-02T01:00:00Z");
const {privateKey, publicKey}=generateKeyPairSync("ed25519");
const pem=publicKey.export({type:"spki",format:"pem"});
const fingerprint=createHash("sha256").update(pem).digest("hex");
const id="gate-keeper-smoke-test-identity";
const makeStatement=()=>({
  runId,sourceCommit:sha,tenant:"stranger-builds",provider:"tfy-managed",
  fundingSource:"sponsor-inference-credit",
  personalBillingFallbackDisabled:true,overageDisabled:true,
  sponsorCreditRemainingUsd:50,issuedAt:now-1000,expiresAt:now+3600000,
  virtualAccountId:id, model,fixture:"01-python-utils",
  gatewayBudget:{
    ruleId:"gk-only-one-dollar",subject:id,scope:"per-virtual-account",
    mode:"Enforce",period:"Lifetime",currency:"USD",limitUsd:1,remainingUsd:1,
  },
  maxTurns:2,maxOutputTokensPerTurn:500,noAutomaticRetry:true,
  allowTools:false,allowRepair:false,allowLearning:false,publicFixtureOnly:true,
});
function signed(s=makeStatement()) {
  return {statement:s,signature:sign(null,Buffer.from(JSON.stringify(s)),privateKey).toString("base64")};
}
const verifyInput=(e=signed())=>({
  evidence:e,publicKeyPem:pem,pinnedKeySha256:fingerprint,
  sourceCommit:sha,model,runId,now,
});
const provider=()=>[{
  name:"truefoundry",manifest:{
    type:"truefoundry",baseUrl:"https://stranger-builds.truefoundry.cloud/api/llm",
    models:[{name:"deepseek-v4-flash-0731",modelId:"tfy-managed/deepseek-v4-flash-0731"}],
  },
}];
const models=()=>[{name:model,provider:{name:"truefoundry"}}];

test("plan is non-spending, fixed to one public fixture, two turns",()=>{
  const p=smokePlan();
  assert.equal(p.status,"HELD_UNTIL_SIGNED_SPONSOR_AND_BUDGET_RECEIPTS");
  assert.deepEqual(p.arms,["baseline","gate_keeper"]);
  assert.equal(p.totalModelTurns,2);
  assert.equal(p.grader,false);assert.equal(p.repair,false);assert.equal(p.learning,false);
  assert.equal(publicFixture().holdout,false);
  assert.equal(publicFixture().expected.length,3);
  for(const invalid of ["truefoundry/text-embedding-3-large","anthropic/claude-sonnet-5-5","truefoundry/gpt-6-astra","https://evil.test"])
    assert.throws(()=>smokePlan({model:invalid}),/UNAPPROVED_SMOKE_MODEL/);
});

test("without an independently pinned valid signature even fully plausible data is denied",()=>{
  const e=signed();
  assert.equal(verifySponsorAdmission(verifyInput(e)).hardCapUsd,1);
  assert.throws(()=>verifySponsorAdmission({...verifyInput(e),pinnedKeySha256:null}),/TRUSTED_ISSUER_KEY_NOT_PINNED/);
  assert.throws(()=>verifySponsorAdmission({...verifyInput(e),pinnedKeySha256:"b".repeat(64)}),/TRUSTED_ISSUER_KEY_NOT_PINNED/);
  assert.throws(()=>verifySponsorAdmission({...verifyInput(e),publicKeyPem:"invalid"}),/TRUSTED_ISSUER_KEY_NOT_PINNED/);
  assert.throws(()=>verifySponsorAdmission({...verifyInput(e),runId:"gk-sponsor-another-run"}),/RUN_ID_NOT_BOUND/);
  assert.throws(()=>verifySponsorAdmission({...verifyInput(e),sourceCommit:"b".repeat(40)}),/SOURCE_COMMIT_UNBOUND/);
  assert.throws(()=>verifySponsorAdmission({...verifyInput(e),now:now+86400000}),/RECEIPT_EXPIRED_OR_INVALID/);
  const tamper={...e,statement:{...e.statement,sponsorCreditRemainingUsd:100000}};
  assert.throws(()=>verifySponsorAdmission(verifyInput(tamper)),/SPONSOR_RECEIPT_SIGNATURE_INVALID/);
});

test("signed policy denies no sponsor credit, personal overage, soft/audit caps and unrelated subjects",()=>{
  const mutations=[
    (s)=>{s.fundingSource="personal-paid";},
    (s)=>{s.personalBillingFallbackDisabled=false;},
    (s)=>{s.overageDisabled=false;},
    (s)=>{s.sponsorCreditRemainingUsd=0;},
    (s)=>{s.gatewayBudget.mode="Audit";},
    (s)=>{s.gatewayBudget.mode="Soft Enforce";},
    (s)=>{s.gatewayBudget.scope="aggregate";},
    (s)=>{s.gatewayBudget.subject="another-tenant";},
    (s)=>{s.gatewayBudget.limitUsd=50;},
    (s)=>{s.gatewayBudget.remainingUsd=undefined;},
    (s)=>{s.maxTurns=3;},
    (s)=>{s.allowRepair=true;},
    (s)=>{s.allowTools=true;},
    (s)=>{s.allowLearning=true;},
    (s)=>{s.publicFixtureOnly=false;},
  ];
  for(const mutate of mutations){
    const s=makeStatement();mutate(s);
    assert.throws(()=>verifySponsorAdmission(verifyInput(signed(s))),/SPONSOR_SMOKE_BLOCKED/);
  }
});

test("the production Railway project cannot run this smoke",()=>{
  const env={RAILWAY_PROJECT_ID:"a8f4c4a4-0f32-4166-ba92-dad9baf2b652",
    RAILWAY_ENVIRONMENT_ID:"03fb9181-2f19-409b-a9b1-823cb32e56c2",
    RAILWAY_GIT_COMMIT_SHA:sha,RAILWAY_ENVIRONMENT_NAME:"qualification"};
  assert.equal(requireIsolatedRailway(env),true);
  for(const mutation of [
    {RAILWAY_PROJECT_ID:"507ae09d-7dbb-444a-bd62-a5a16405c874"},
    {RAILWAY_ENVIRONMENT_NAME:"production"},
    {RAILWAY_GIT_COMMIT_SHA:""},
    {RAILWAY_ENVIRONMENT_ID:"different"},
  ]) assert.throws(()=>requireIsolatedRailway({...env,...mutation}),/ISOLATED_RAILWAY_ENVIRONMENT_REQUIRED/);
});

test("gateway route must be exact, with a single explicitly provisioned chat model",()=>{
  assert.equal(assertTrueForgeRoute({providers:provider(),models:models(),model}).upstreamId,
    "tfy-managed/deepseek-v4-flash-0731");
  const wrongHost=provider();wrongHost[0].manifest.baseUrl="https://evil.test/api/llm";
  assert.throws(()=>assertTrueForgeRoute({providers:wrongHost,models:models(),model}),/WRONG_SPONSOR_GATEWAY/);
  const wrongId=provider();wrongId[0].manifest.models[0].modelId="provider/other";
  assert.throws(()=>assertTrueForgeRoute({providers:wrongId,models:models(),model}),/SINGLE_APPROVED_MODEL_NOT_REGISTERED/);
  const extra=provider();extra[0].manifest.models.push({name:"claude-opus-5-5",modelId:"tfy-managed/claude-opus-5-5"});
  assert.throws(()=>assertTrueForgeRoute({providers:extra,models:models(),model}),/SINGLE_APPROVED_MODEL_NOT_REGISTERED/);
  assert.throws(()=>assertTrueForgeRoute({providers:provider(),models:[{name:model,provider:{name:"anthropic"}}],model}),/MODEL_NOT_AVAILABLE_IN_TRUEFORGE/);
});

test("incomplete or paused turns cancel and never silently retry",async()=>{
  let cancelled=0;
  const tf={sessions:{getTurn:async()=>({data:{id:"t",state:{status:"paused"}}}),cancel:async()=>{cancelled++;}}};
  await assert.rejects(pollSingleTurn(tf,"s",{id:"t",state:{status:"running"}},{sleep:async()=>{},maxPolls:1}),/TURN_NOT_SUCCESSFUL/);
  assert.equal(cancelled,1);
});

test("no signature: zero metadata calls and zero sessions; valid synthetic receipt: exactly two turns",async()=>{
  const calls=[],published=[];
  let count=0;
  const tf={
    settings:{modelProviders:{list:async()=>{calls.push("providers.list");return{data:provider()};}}},
    models:{list:async()=>{calls.push("models.list");return{data:models()};}},
    sessions:{
      create:async ({agent,metadata})=>{
        calls.push("sessions.create");count++;
        assert.equal(agent.spec.model.name,model);
        assert.equal(agent.spec.model.params.temperature,0);
        assert.equal(agent.spec.model.params.maxTokens,500);
        assert.equal(agent.spec.config.dynamicSubAgents.enabled,false);
        assert.deepEqual(agent.spec.tools,[]);
        assert.ok(["baseline","gate_keeper"].includes(metadata.arm));
        return {data:{id:"session"+count}};
      },
      createTurn:async (id,payload,options)=>{
        calls.push("sessions.createTurn");assert.equal(options.maxRetries,0);
        assert.equal(payload.previousTurnId,"none");
        const content="\u0060\u0060\u0060json\n"+JSON.stringify({findings:[
          {line:7,category:"bug",severity:"high",comment:"incorrect range"},
          {line:12,category:"bug",severity:"medium",comment:"mutable default"},
          {line:22,category:"error-handling",severity:"medium",comment:"swallowed exception"},
        ]})+"\n\u0060\u0060\u0060";
        return {data:{id:"turn"+count,state:{
          status:"done",output:{content},metrics:{totalCostInUsd:0.0005,totalInputTokens:2000,totalOutputTokens:400},
        }}};
      },
      getTurn:async()=>{throw Error("Unexpected extra poll");},
      cancel:async()=>{calls.push("sessions.cancel");},
    },
  };
  const store={
    put:(...args)=>{published.push(args);},
    upload:async()=>({uploaded:true,reference:"private://smoke/evidence",manifest_sha256:"a".repeat(64)}),
  };
  const claimRunOnce=async()=>{calls.push("claimRunOnce");};
  const common={tf,publicKeyPem:pem,pinnedKeySha256:fingerprint,sourceCommit:sha,runId,model,now:()=>now,claimRunOnce,evidenceStore:store};
  await assert.rejects(runPairedSmoke({...common,signedEvidence:{...signed(),signature:"bad"}}),/SPONSOR_RECEIPT_SIGNATURE_INVALID/);
  assert.deepEqual(calls,[]);
  const result=await runPairedSmoke({...common,signedEvidence:signed()});
  assert.deepEqual(calls,["providers.list","models.list","claimRunOnce",
    "sessions.create","sessions.createTurn","sessions.create","sessions.createTurn"]);
  assert.equal(result.status,"INCONCLUSIVE");
  assert.equal(result.arms.length,2);
  assert.ok(result.arms.every(a=>a.caught===3&&a.missed===0&&a.gateway_billed_usd===null));
  assert.equal(result.actual_gateway_billing_usd,null);
  assert.equal(result.localBudget.calls,2);
  assert.equal(published.filter(p=>p[0].startsWith("private/reviews/")).length,2);
});
