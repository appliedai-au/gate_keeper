import test from "node:test";
import assert from "node:assert/strict";
import {assessHostPreflight,queryHostReadOnly} from "../scripts/trueforge/native-preflight.mjs";

const model="anthropic/claude-sonnet-5-5";
const eligible={models:[{name:model}],capabilities:{skill:{enabled:true}}};
test("host preflight treats a healthy model and skill catalog as incomplete qualification",()=>{
 const result=assessHostPreflight(eligible);
 assert.equal(result.checks.model,true);
 assert.equal(result.checks.sandboxFeature,true);
 assert.equal(result.checks.githubConnector,false);
 assert.equal(result.checks.independentGateway,false);
 assert.equal(result.releaseReady,false);
 assert.ok(result.blockers.includes("real_sandbox_provision_not_tested"));
 assert.ok(result.blockers.includes("independent_spend_settlement_not_tested"));
});
test("host preflight still does not claim release on all positive assertions",()=>{
 const result=assessHostPreflight({...eligible,verifiedGithubConnector:true,verifiedGateway:true});
 assert.equal(result.nativeConfigEligible,true);
 assert.equal(result.releaseReady,false);
 assert.ok(result.blockers.includes("end_to_end_readonly_review_not_tested"));
});
test("host preflight rejects missing or untrusted feature/data",()=>{
 for(const data of [undefined,{}, {models:[],capabilities:{skill:{enabled:false}}},
   {models:[{}],capabilities:{skill:{enabled:"true"}}}]){
  const result=assessHostPreflight(data);
  assert.equal(result.releaseReady,false);
  assert.equal(result.checks.model,false);
  assert.equal(result.checks.sandboxFeature,false);
 }
});
test("preflight queries only models and capabilities, not sessions or agent mutations",async()=>{
 let calls=[];
 const result=await queryHostReadOnly({
  models:{list:async()=>{calls.push("models.list");return {data:eligible.models};}},
  server:{getCapabilities:async()=>{calls.push("server.getCapabilities");return {data:eligible.capabilities};}},
  agents:{create:()=>{throw Error("MUTATION")},update:()=>{throw Error("MUTATION")}},
  sessions:{create:()=>{throw Error("MODEL_CALL")}},
 });
 assert.deepEqual(calls.sort(),["models.list","server.getCapabilities"]);
 assert.equal(result.releaseReady,false);
});
