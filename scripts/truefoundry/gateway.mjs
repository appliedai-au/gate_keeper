/**
 * Stranger Builds TrueFoundry gateway bridge for the existing TrueForge runtime.
 *
 * IMPORTANT: configuration and read-only validation only. This module NEVER
 * creates a credential, model-provider, agent, session or paid inference call.
 * A gateway virtual-account key is entered exclusively in TrueForge Settings
 * -> Models by an authorised operator after a gateway-side spend cap exists.
 */
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";
import {resolve} from "node:path";

const profile=JSON.parse(readFileSync(new URL("../../config/truefoundry-gateway.json",import.meta.url),"utf8"));
const allowedGatewayUrl="https://stranger-builds.truefoundry.cloud/api/llm";
const ROLES=["reviewer","repair","adjudicator","learning","triage"];
const unexpected=/[\r\n\u0000]/;

function fail(reason){throw Error("TRUEFOUNDRY_GATEWAY_REJECTED: "+reason);}

/** Fail closed on other organisations, hosts, schemes, paths and query-bearing URLs. */
export function validateGatewayUrl(value) {
 if(typeof value!=="string"||value!==allowedGatewayUrl)fail("pinned gateway URL mismatch");
 let u;
 try{u=new URL(value)}catch{fail("invalid gateway URL")}
 if(u.protocol!=="https:"||u.host!=="stranger-builds.truefoundry.cloud"||
    u.pathname!=="/api/llm"||u.search||u.hash||u.username||u.password)
   fail("gateway origin/scheme/path invalid");
 return u.origin+u.pathname;
}

/**
 * Operator-only provider payload. The credential must come from a dedicated
 * Gate Keeper VIRTUAL ACCOUNT, not an individual PAT or Claude subscription.
 * Never print this manifest or put it in Git, logs, build args or PR comments.
 * No network or provider mutation occurs here.
 */
export function buildProviderManifest({virtualAccountKey}={}) {
 validateGatewayUrl(profile.gatewayBaseUrl);
 if(typeof virtualAccountKey!=="string"||virtualAccountKey.length<10||
    unexpected.test(virtualAccountKey)||virtualAccountKey.trim()!==virtualAccountKey)
    fail("protected virtual-account credential required");
 if(profile.trueForgeProviderType!=="truefoundry"||profile.trueForgeProviderName!=="truefoundry"||
    profile.upstreamProviderAccount!=="tfy-managed")fail("unapproved gateway provider configuration");
 const names=profile.modelsVisibleInOwnerAccount;
 if(!Array.isArray(names)||names.length!==2||new Set(names).size!==2||
    !names.includes("claude-sonnet-5-5")||!names.includes("claude-opus-5-5"))
   fail("approved model allow-list changed");
 return {
   type:"truefoundry",
   base_url:profile.gatewayBaseUrl,
   auth:{api_key:virtualAccountKey},
   models:names.map(name=>({
     name,
     model_id:`tfy-managed/${name}`,
     properties:{},
   })),
 };
}

function modelName(m){return m&&typeof m.name==="string"?m.name:null}
function wireUrl(m){return m?.baseUrl??m?.base_url??null}
function modelId(m){return m?.modelId??m?.model_id??null}

/** Read-only catalogue verdict. No role is silently replaced or downgraded. */
export function assessGatewayReadiness({providers=[],models=[]}={}) {
 validateGatewayUrl(profile.gatewayBaseUrl);
 const blockers=[];
 const existing=Array.isArray(providers)?
   providers.find(p=>p?.name==="truefoundry"||p?.manifest?.type==="truefoundry"):null;
 if(!existing)blockers.push("TRUEFOUNDRY_PROVIDER_NOT_REGISTERED");
 else{
   if(existing.name!=="truefoundry"||existing.manifest?.type!=="truefoundry")
     blockers.push("TRUEFOUNDRY_PROVIDER_IDENTITY_MISMATCH");
   if(wireUrl(existing.manifest)!==profile.gatewayBaseUrl)
     blockers.push("TRUEFOUNDRY_ENDPOINT_MISMATCH");
   const registered=existing.manifest?.models||[];
   for(const name of profile.modelsVisibleInOwnerAccount){
     const found=Array.isArray(registered)&&registered.find(m=>modelName(m)===name);
     if(!found||modelId(found)!==`tfy-managed/${name}`)
       blockers.push(`UPSTREAM_MODEL_UNVERIFIED:${name}`);
   }
 }
 const catalog=new Set(Array.isArray(models)?
   models.filter(m=>m?.provider?.name==="truefoundry").map(modelName):[]);
 const mapped={};
 for(const role of ROLES){
   const expected=profile.activeRoleMappings?.[role];
   if(!expected){
     mapped[role]={status:"BLOCKED_UNQUALIFIED",model:null};
     if(role!=="triage")blockers.push(`ROLE_UNQUALIFIED:${role}`);
   }else if(!/^truefoundry\/[A-Za-z0-9_.-]+$/.test(expected)||
             !catalog.has(expected)){
     mapped[role]={status:"BLOCKED_UNREGISTERED",model:expected};
     blockers.push(`ROLE_MODEL_UNREGISTERED:${role}`);
   }else mapped[role]={status:"AVAILABLE_NOT_QUALIFIED",model:expected};
 }
 if(profile.release?.active!==false||profile.release?.productionChangeApproved!==false||
    profile.release?.allowSilentFallback!==false||profile.release?.allowPaidInferenceInSetup!==false)
   blockers.push("UNSAFE_RELEASE_DEFAULTS");
 blockers.push(
   "SPONSOR_CREDITS_AND_INFERENCE_BILLING_NOT_ATTESTED",
   "DEDICATED_VIRTUAL_ACCOUNT_AND_GATEWAY_CUMULATIVE_BUDGET_NOT_ATTESTED",
   "NO_INDEPENDENT_SIGNED_MODEL_AND_LEARNING_QUALIFICATION",
   "PRODUCTION_CUTOVER_NOT_AUTHORISED",
 );
 return {
   schema:profile.schema,
   organisation:profile.organisation,
   gatewayHost:"stranger-builds.truefoundry.cloud",
   trueForgeProvider:"truefoundry",
   configuredProviderSeen:!!existing,
   mappedRoles:mapped,
   blockers:[...new Set(blockers)],
   status:"HELD",
   productionReady:false,
   source:"read_only_trueforge_provider_and_model_catalog",
 };
}

/** Call only two TrueForge metadata LIST APIs; NEVER start a model call. */
export async function inspectGatewayReadOnly(tf){
 if(typeof tf?.settings?.modelProviders?.list!=="function"||typeof tf?.models?.list!=="function")
  fail("TrueForge SDK model provider read API unavailable");
 const [providersResponse,modelsResponse]=await Promise.all([
   tf.settings.modelProviders.list(),tf.models.list(),
 ]);
 return assessGatewayReadiness({
   providers:providersResponse?.data,
   models:modelsResponse?.data,
 });
}

function checkHost(value){
 let url;
 try{url=new URL(value)}catch{fail("TRUEFORGE_BASE_URL missing/invalid")}
 if(url.username||url.password||url.search||url.hash)
   fail("TrueForge URL must not include credentials, query or fragment");
 const localRailway=url.hostname.endsWith(".railway.internal");
 if((url.protocol!=="https:"&&! (url.protocol==="http:"&&localRailway))||
    (url.pathname!=="/"&&url.pathname!==""))
   fail("approved HTTPS TrueForge URL required");
 return url.origin;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
   const baseUrl=process.env.TRUEFORGE_BASE_URL;
   if(!baseUrl){
     const status=assessGatewayReadiness();
     console.log(JSON.stringify(status,null,2));
     process.exitCode=3;
   }else{
     const {TrueForge}=await import("@truefoundry/trueforge-sdk");
     const tf=new TrueForge({baseUrl:checkHost(baseUrl),token:process.env.TRUEFORGE_TOKEN||undefined,timeoutInSeconds:20});
     const status=await inspectGatewayReadOnly(tf);
     console.log(JSON.stringify(status,null,2));
     // Even a registered provider cannot authorise a spend or production cutover.
     process.exitCode=3;
   }
 }catch(e){
   console.error(JSON.stringify({status:"HELD",reason:String(e?.message||e).slice(0,170)}));
   process.exitCode=2;
 }
}
