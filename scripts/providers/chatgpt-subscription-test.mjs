#!/usr/bin/env node
/** Deliberately local-only ChatGPT subscription smoke. No TrueForge adapter. */
import {existsSync,lstatSync,readFileSync,readdirSync,realpathSync} from "node:fs";
import {join} from "node:path";
import {homedir} from "node:os";
import {accountRef,assertActiveAccount,normalizeEmail} from "./account-identity.mjs";
import {listChatGPTPlanModels,runChatGPTPlanSmoke} from "./chatgpt-plan-smoke.mjs";

function fail(msg){throw Error("CHATGPT_SUBSCRIPTION_TEST_HELD: "+msg);}
function readPrivate(file){
 const st=lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||
    (process.getuid&&st.uid!==process.getuid()))fail("credential permissions");
 const raw=readFileSync(file,"utf8");
 if(raw.length>40000)fail("invalid credential size");
 return JSON.parse(raw);
}
function readSelected(home=homedir()){
 const base=join(realpathSync(home),".config","gate-keeper","chatgpt-oauth");
 const current=readPrivate(join(base,"active.json"));
 if(current.provider_policy!=="chatgpt_oauth_only"||current.fallback_allowed!==false)
   fail("ChatGPT-only account not selected");
 const host=readPrivate(join(base,"host.json")).hostId;
 const matches=readdirSync(base).filter(n=>/^account-[a-f0-9]{64}\.json$/.test(n))
  .map(n=>readPrivate(join(base,n))).filter(x=>accountRef(x)===current.account_ref);
 if(matches.length!==1)fail("selected account missing or ambiguous");
 if(matches[0].ext_agent_host_id!==host)fail("credential moved to another host");
 const account=assertActiveAccount(current,matches[0],{requirePlanUsage:true});
 return {account,token:matches[0].access_token};
}
function flags(values){
 const result={confirm:false,email:null,model:null};
 for(let i=0;i<values.length;i++){
   if(values[i]==="--confirm"){
     if(result.confirm)fail("duplicate consent flag");
     result.confirm=true;
   }else if(values[i]==="--email"){
     if(result.email!==null||!values[i+1])fail("expected email missing");
     result.email=normalizeEmail(values[++i]);
   }else if(values[i]==="--model"){
     if(result.model!==null||!values[i+1])fail("expected model missing");
     result.model=values[++i];
   }else fail("unrecognised argument");
 }
 return result;
}
export async function main(argv=process.argv.slice(2)){
 const opts=flags(argv);
 if(!opts.confirm)fail("explicit --confirm is required to use the selected user's ChatGPT plan");
 if(process.env.CI||process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
   fail("the local subscription smoke test cannot run in CI or on Railway");
 const {account,token}=readSelected();
 if(opts.email&&opts.email!==normalizeEmail(account.email))
   fail("selected ChatGPT account does not match the specified email");
 const models=await listChatGPTPlanModels({accessToken:token});
 if(!models.length)fail("the selected account has no available plan models");
 const selected=opts.model?models.find(x=>x.id===opts.model):models[0];
 if(!selected)fail("requested model is not in this account's catalog");
 // Exactly ONE tiny, fixed, tool-free, stateless request using this user's
 // approved plan. No repo files, prompts, secrets or conversation are sent.
 const verdict=await runChatGPTPlanSmoke({accessToken:token,model:selected.id});
 if(!verdict.completed)fail("inference did not complete");
 console.log(JSON.stringify({provider:"chatgpt_subscription",
   model:selected.id,completed:true,outputMatchesExpected:verdict.outputMatchesExpected,
   noFallback:true,trueForgeAdapter:"NOT_CONFIGURED"},null,2));
}
if(process.argv[1]?.endsWith("/chatgpt-subscription-test.mjs")){
 try{await main();}
 catch(err){
   console.error(String(err?.message||"ChatGPT subscription test failed").replace(/Bearer\s+\S+/g,"Bearer [REDACTED]"));
   process.exitCode=2;
 }
}
