// Read-only qualification of the current TrueForge host.
// Never creates agents, changes providers, starts sessions or invokes a model.
// Sandbox readiness and independent gateway proof remain external release gates.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

const dir=resolve(dirname(fileURLToPath(import.meta.url)),"../..");
const manifest=JSON.parse(readFileSync(resolve(dir,"agent","native-trueforge-profile.json"),"utf8"));
const reviewer=JSON.parse(readFileSync(resolve(dir,"agent","agent.json"),"utf8"));

export function assessHostPreflight({capabilities,models,verifiedGithubConnector=false,verifiedGateway=false}={}){
  const checks={
    model: Array.isArray(models) && models.some(m=>m && m.name===reviewer.model.name),
    sandboxFeature: capabilities?.skill?.enabled===true,
    githubConnector: verifiedGithubConnector===true,
    independentGateway: verifiedGateway===true,
  };
  const unresolved=Object.entries(checks).filter(([,ok])=>!ok).map(([key])=>key);
  // A capability flag indicates the feature exists; it does NOT prove a
  // sandbox can be provisioned or that an MCP credential is authorized.
  const blockers=[...unresolved,"real_sandbox_provision_not_tested","end_to_end_authorization_not_tested",
    "end_to_end_readonly_review_not_tested","independent_spend_settlement_not_tested"];
  return {
    profile:manifest.agent_name,
    model:reviewer.model.name,
    releaseReady:false,
    nativeConfigEligible:unresolved.length===0,
    checks,blockers,
    evidenceClass:"read_only_catalog_preflight",
  };
}

export async function queryHostReadOnly(tf){
  if(!tf || typeof tf.models?.list!=="function" || typeof tf.server?.getCapabilities!=="function")
    throw new Error("TRUEFORGE_SDK_REQUIRED");
  const [modelResponse,capResponse]=await Promise.all([tf.models.list(),tf.server.getCapabilities()]);
  return assessHostPreflight({models:modelResponse?.data,capabilities:capResponse?.data});
}

const invoked=process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(invoked){
  try{
    const baseUrl=process.env.TRUEFORGE_BASE_URL;
    if(!baseUrl || !/^https:\/\/[a-z0-9.-]+(?::\d+)?\/?$/.test(baseUrl))
      throw new Error("TRUEFORGE_HTTPS_URL_REQUIRED");
    const {TrueForge}=await import("@truefoundry/trueforge-sdk");
    const tf=new TrueForge({baseUrl,token:process.env.TRUEFORGE_TOKEN||undefined,timeoutInSeconds:20});
    const result=await queryHostReadOnly(tf);
    console.log(JSON.stringify(result,null,2));
    // Return nonzero whenever a mandatory actual qualification remains.
    process.exitCode=3;
  }catch(e){
    console.error(JSON.stringify({status:"HELD",reason:String(e?.message||e).slice(0,220)}));
    process.exitCode=2;
  }
}
