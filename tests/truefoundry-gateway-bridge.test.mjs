import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {
  validateGatewayUrl,validateTrueForgeHost,buildProviderManifest,assessGatewayReadiness,inspectGatewayReadOnly,selectableChatModels,
} from "../scripts/truefoundry/gateway.mjs";

const gateway="https://stranger-builds.truefoundry.cloud/api/llm";
const key="this-is-only-a-fake-test-token-not-valid";
const provider={
 name:"truefoundry",
 manifest:{
   type:"truefoundry",baseUrl:gateway,
   auth:{apiKey:"<redacted>"},
   models:[
     {name:"claude-sonnet-5-5",modelId:"tfy-managed/claude-sonnet-5-5",properties:{}},
     {name:"claude-opus-5-5",modelId:"tfy-managed/claude-opus-5-5",properties:{}},
   ],
 },
};
const models=[
 {name:"truefoundry/claude-sonnet-5-5",provider:{name:"truefoundry"}},
 {name:"truefoundry/claude-opus-5-5",provider:{name:"truefoundry"}},
];
test("only the pinned HTTPS Stranger Builds gateway endpoint is accepted",()=>{
 assert.equal(validateGatewayUrl(gateway),gateway);
 for(const attempt of [
  "https://stranger-builds.truefoundry.cloud/api/llm/",
  "http://stranger-builds.truefoundry.cloud/api/llm",
  "https://stranger-builds.truefoundry.cloud.evil.test/api/llm",
  "https://stranger-builds.truefoundry.cloud/api/llm?override=1",
  "https://stranger-builds.truefoundry.cloud/api/llm#frag",
  "https://stranger-builds.truefoundry.cloud@evil.test/api/llm",
  "https://stranger-builds.truefoundry.cloud/",
  "",null,
 ])assert.throws(()=>validateGatewayUrl(attempt),/TRUEFOUNDRY_GATEWAY_REJECTED/);
});
test("the provider payload uses TrueForge's native type and upstream tfy-managed IDs",()=>{
 const m=buildProviderManifest({virtualAccountKey:key});
 assert.deepEqual(m,{
   type:"truefoundry",
   base_url:gateway,
   auth:{api_key:key},
   models:[
    {name:"claude-sonnet-5-5",model_id:"tfy-managed/claude-sonnet-5-5",properties:{}},
    {name:"claude-opus-5-5",model_id:"tfy-managed/claude-opus-5-5",properties:{}},
   ],
 });
 assert.notEqual(m.type,"anthropic");
 assert.equal(m.models.length,2,"default remains the original conservative subset");
 assert.equal(selectableChatModels.length,20);
 const all=buildProviderManifest({virtualAccountKey:key,selectedModels:selectableChatModels});
 assert.equal(all.models.length,20,"all observed chat models are individually selectable");
 assert.equal(all.models.every(m=>m.model_id==="tfy-managed/"+m.name),true);
 assert.deepEqual(buildProviderManifest({virtualAccountKey:key,selectedModels:["gpt-6-luna"]}).models,
   [{name:"gpt-6-luna",model_id:"tfy-managed/gpt-6-luna",properties:{}}]);
 for(const invalid of [
   ["text-embedding-3-large"],["arbitrary-unregistered-model"],[],["gpt-6-luna","gpt-6-luna"],
 ])assert.throws(()=>buildProviderManifest({virtualAccountKey:key,selectedModels:invalid}),/model selection outside tenant chat catalogue/);
});
test("no credential or individual account means no provider payload",()=>{
 for(const virtualAccountKey of [undefined,"", "too-short","with\nnewline-credential", " space-at-end ",null])
   assert.throws(()=>buildProviderManifest({virtualAccountKey}),/credential required/);
});
test("provider must exactly match endpoint, type and upstream model identity",()=>{
 const good=assessGatewayReadiness({providers:[provider],models});
 assert.equal(good.configuredProviderSeen,true);
 assert.deepEqual(good.mappedRoles.reviewer,{status:"AVAILABLE_NOT_QUALIFIED",model:"truefoundry/claude-sonnet-5-5"});
 assert.deepEqual(good.mappedRoles.adjudicator,{status:"AVAILABLE_NOT_QUALIFIED",model:"truefoundry/claude-opus-5-5"});
 assert.ok(good.blockers.includes("ADJUDICATOR_CALIBRATION_PENDING"));
 assert.equal(good.productionReady,false);
 assert.equal(good.status,"HELD");
 assert.equal(good.selectableModels.length,20);
 assert.equal(good.embeddingModelsExcludedFromReview,2);
 assert.equal(good.selectableModels.find(m=>m.model==="truefoundry/claude-sonnet-5-5").registeredInTrueForge,true);
 assert.equal(good.selectableModels.find(m=>m.model==="truefoundry/gpt-6-luna").registeredInTrueForge,false);
 const badOrigin=assessGatewayReadiness({
   providers:[{...provider,manifest:{...provider.manifest,baseUrl:"https://attacker.example/api/llm"}}],models,
 });
 assert.ok(badOrigin.blockers.includes("TRUEFOUNDRY_ENDPOINT_MISMATCH"));
 const badType=assessGatewayReadiness({
   providers:[{...provider,manifest:{...provider.manifest,type:"custom"}}],models,
 });
 assert.ok(badType.blockers.includes("TRUEFOUNDRY_PROVIDER_IDENTITY_MISMATCH"));
 const badIds=assessGatewayReadiness({
   providers:[{...provider,manifest:{...provider.manifest,models:[{name:"claude-sonnet-5-5",modelId:"other/sonnet"}]}}],models,
 });
 assert.ok(badIds.blockers.some(b=>b.includes("UPSTREAM_MODEL_UNVERIFIED")));
});
test("catalogue names are required under TrueForge's own provider, not direct Anthropic",()=>{
 const onlyAnthropic=assessGatewayReadiness({
  providers:[provider],models:models.map(x=>({...x,name:x.name.replace("truefoundry/","anthropic/"),provider:{name:"anthropic"}})),
 });
 assert.equal(onlyAnthropic.mappedRoles.reviewer.status,"BLOCKED_UNREGISTERED");
 const none=assessGatewayReadiness();
 assert.ok(none.blockers.includes("TRUEFOUNDRY_PROVIDER_NOT_REGISTERED"));
 assert.equal(none.configuredProviderSeen,false);
 assert.equal(none.productionReady,false);
});
test("preflight strictly reads provider and model catalogues: no model usage or writes",async()=>{
 const calls=[];
 const tf={
   settings:{modelProviders:{
     list:async()=>{calls.push("settings.modelProviders.list");return {data:[provider]};},
     create:()=>{throw Error("CREDENTIAL_MUTATION");},
   }},
   models:{list:async()=>{calls.push("models.list");return {data:models};}},
   sessions:{create:()=>{throw Error("PAID_MODEL_CALL");}},
   agents:{create:()=>{throw Error("AGENT_MUTATION");}},
 };
 const result=await inspectGatewayReadOnly(tf);
 assert.deepEqual(calls.sort(),["models.list","settings.modelProviders.list"]);
 assert.equal(result.productionReady,false);
 assert.equal(JSON.stringify(result).includes(key),false);
 assert.deepEqual(result.blockers.slice(-4),[
 "SPONSOR_CREDITS_AND_INFERENCE_BILLING_NOT_ATTESTED",
 "DEDICATED_VIRTUAL_ACCOUNT_AND_GATEWAY_CUMULATIVE_BUDGET_NOT_ATTESTED",
 "NO_INDEPENDENT_SIGNED_MODEL_AND_LEARNING_QUALIFICATION",
 "PRODUCTION_CUTOVER_NOT_AUTHORISED",
 ]);
});
test("the grader is replaced only by a recorded owner decision that stays held until calibrated against Fable",()=>{
 const profile=JSON.parse(readFileSync(new URL("../config/truefoundry-gateway.json",import.meta.url),"utf8"));
 const roles=JSON.parse(readFileSync(new URL("../agent/models.json",import.meta.url),"utf8")).roles;
 assert.equal(roles.adjudicator.model,"truefoundry/claude-opus-5-5");
 assert.equal(profile.activeRoleMappings.adjudicator,roles.adjudicator.model,"profile and role file agree; no silent substitution");
 assert.notEqual(roles.adjudicator.model,roles.reviewer.model,"the grader is never the model under test");
 assert.equal(roles.adjudicator.status,"pending_calibration");
 assert.match(roles.adjudicator.calibration,/Fable 5\.1/);
 assert.match(profile.adjudicatorCalibration,/calibrated against the Fable 5\.1 judgements/);
 assert.ok(assessGatewayReadiness().blockers.includes("ADJUDICATOR_CALIBRATION_PENDING"));
 assert.equal(profile.release.active,false);
 assert.equal(profile.release.allowSilentFallback,false);
 assert.equal(profile.release.allowPaidInferenceInSetup,false);
 assert.equal(profile.release.productionChangeApproved,false);
});

test("TrueForge metadata preflight refuses arbitrary hosts before sending a token",()=>{
 const approved=["trueforge.example.com"];
 assert.equal(validateTrueForgeHost("http://trueforge.railway.internal:8080"),"http://trueforge.railway.internal:8080");
 assert.equal(validateTrueForgeHost("https://trueforge.example.com",{
  approvedHosts:approved,tokenPresent:true,
 }),"https://trueforge.example.com");
 for(const value of [
  "https://evil.example.com", "http://evil.railway.internal:8080",
  "http://trueforge.railway.internal:8888","https://trueforge.example.com@evil.example.com",
  "https://trueforge.example.com/?token=123",
  "https://trueforge.example.com/private", "file:///etc/passwd",
  "https://trueforge.example.com#frag",
 ]){
   assert.throws(()=>validateTrueForgeHost(value,{approvedHosts:approved,tokenPresent:true}),
       /TRUEFOUNDRY_GATEWAY_REJECTED/,value);
 }
 assert.throws(()=>validateTrueForgeHost("https://trueforge.example.com",{
  approvedHosts:approved,tokenPresent:false,
 }),/TRUEFOUNDRY_GATEWAY_REJECTED/);
});
