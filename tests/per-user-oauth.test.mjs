import test from "node:test";
import assert from "node:assert/strict";
import {createHash,randomUUID} from "node:crypto";
import {mkdtempSync,mkdirSync,writeFileSync,realpathSync,rmSync,readFileSync,symlinkSync,existsSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";
import {
 normalizeEmail,verifyExpectedAccount,accountRef,
 assertActiveAccount,requireUserScopedInference
} from "../scripts/providers/account-identity.mjs";
import {requireNoOAuthFallback} from "../scripts/providers/runtime-policy.mjs";

const host="urn:uuid:"+randomUUID();
const account=(id,sub,email)=>({
 issuer:"https://auth.openai.com",subject:sub,client_id:id,ext_agent_host_id:host,
 email,expires_at:"2030-01-01T00:00:00Z",
 scopes:["openid","resource.invoke","chatgpt.tokens.use.direct"],
 access_token:"PRIVATE_ACCESS_DO_NOT_EXPOSE",
 refresh_token:"PRIVATE_REFRESH_DO_NOT_EXPOSE",
});
const first=account("oaiapp_first_client_012345","sub-1","first@example.com");
const second=account("oaiapp_second_client_012345","sub-2","second@example.com");

test("email hint confirms only the intended signed identity",()=>{
 assert.equal(normalizeEmail(" FIRST@EXAMPLE.COM "),"first@example.com");
 assert.equal(verifyExpectedAccount(first,"FIRST@example.com").subject,"sub-1");
 assert.throws(()=>verifyExpectedAccount(first,"second@example.com"),/selected email/);
 assert.throws(()=>verifyExpectedAccount({...first,issuer:"https://impostor.example"},"first@example.com"),/identity absent/);
});
test("account identity includes issuer, subject, client registration and host",()=>{
 assert.notEqual(accountRef(first),accountRef(second));
 assert.notEqual(accountRef(first),accountRef({...first,client_id:"oaiapp_third_client_012345"}));
 assert.notEqual(accountRef(first),accountRef({...first,ext_agent_host_id:"urn:uuid:"+randomUUID()}));
});
test("account selection cannot silently borrow another user's credentials",()=>{
 const active={account_ref:accountRef(first)};
 assert.equal(assertActiveAccount(active,first,{requirePlanUsage:true,now:Date.parse("2027-01-01")}).subject,"sub-1");
 assert.throws(()=>assertActiveAccount(active,second,{requirePlanUsage:true}),/selected account mismatch/);
 assert.throws(()=>assertActiveAccount(active,{...first,scopes:["openid"]},{requirePlanUsage:true}),/not authorised/);
 assert.throws(()=>assertActiveAccount(active,{...first,expires_at:"2020-01-01T00:00:00Z"}),/expired/);
});
test("no hidden Claude or DeepSeek fallback when ChatGPT OAuth is selected",()=>{
 const identity=assertActiveAccount({account_ref:accountRef(first)},first,{requirePlanUsage:true,now:Date.parse("2027-01-01")});
 assert.throws(()=>requireUserScopedInference({account:identity,hosted:false,adapterReady:false}),/refusing fallback/);
 assert.throws(()=>requireUserScopedInference({account:identity,hosted:true,adapterReady:true}),/partner approval/);
 assert.equal(requireUserScopedInference({account:identity,hosted:false,adapterReady:true}),true);
});
const root=resolve(".");
function withHome(fn){
 const home=mkdtempSync(join(realpathSync(tmpdir()),"gk-per-user-"));
 try {
  const dir=join(home,".config","gate-keeper","chatgpt-oauth");
  mkdirSync(dir,{recursive:true,mode:0o700});
  writeFileSync(join(dir,"host.json"),JSON.stringify({hostId:host}),{mode:0o600});
  for(const [i,x] of [first,second].entries())writeFileSync(join(dir,"account-"+i+".json"),JSON.stringify(x),{mode:0o600});
  return fn(home);
 }finally{rmSync(home,{recursive:true,force:true});}
}
function cli(home,...args) {
 return spawnSync(process.execPath,["scripts/providers/chatgpt-login.mjs",...args],
 {cwd:root,env:{...process.env,HOME:home},encoding:"utf8",timeout:10000});
}
test("separate local OAuth registrations can be selected independently",()=>withHome(home=>{
 const result=cli(home,"select",first.client_id);
 assert.equal(result.status,0,result.stderr);
 const status=cli(home,"status");
 assert.equal(status.status,0,status.stderr);
 const data=JSON.parse(status.stdout);
 assert.equal(data.accounts.length,2);
 assert.equal(data.accounts.filter(x=>x.active).length,1);
 assert.equal(data.accounts.find(x=>x.client_id===first.client_id).active,true);
 assert.equal(data.accounts.find(x=>x.client_id===second.client_id).active,false);
 assert.equal(data.fallbackAllowed,false);
 assert.equal(data.policy,"chatgpt_oauth_only");
 assert.doesNotMatch(status.stdout,/PRIVATE_ACCESS|PRIVATE_REFRESH/);
 const switched=cli(home,"select",second.client_id);
 assert.equal(switched.status,0,switched.stderr);
 const status2=JSON.parse(cli(home,"status").stdout);
 assert.equal(status2.accounts.find(x=>x.client_id===second.client_id).active,true);
 assert.equal(status2.accounts.find(x=>x.client_id===first.client_id).active,false);
 const unselected=cli(home,"deselect");
 assert.equal(unselected.status,0,unselected.stderr);
 const status3=JSON.parse(cli(home,"status").stdout);
 assert.equal(status3.accounts.filter(x=>x.active).length,0);
 assert.equal(status3.accounts.length,2);
}));
test("an unknown ChatGPT account cannot be selected by email or fabricated client ID",()=>withHome(home=>{
 const result=cli(home,"select","oaiapp_rogue_client_012345");
 assert.equal(result.status,2);
 assert.match(result.stderr,/account missing|existing account/i);
 const noEmailLogin=cli(home,"select","first@example.com");
 assert.equal(noEmailLogin.status,2);
}));

test("selected local ChatGPT account blocks all implicit TrueForge fallback",()=>withHome(home=>{
 assert.equal(requireNoOAuthFallback({env:{},home}),true);
 assert.throws(()=>requireNoOAuthFallback({env:{GK_MODEL_PROVIDER:"chatgpt"},home}),/no model fallback/);
 assert.equal(cli(home,"select",first.client_id).status,0);
 assert.throws(()=>requireNoOAuthFallback({env:{},home}),/no model fallback/);
}));

test("account sign-in does not implicitly switch the default TrueForge model",()=>{
 const source=readFileSync(new URL("../scripts/providers/chatgpt-login.mjs",import.meta.url),"utf8");
 const from=source.indexOf("async function login(");
 const to=source.indexOf("function parseLoginArgs(",from);
 assert.ok(from>=0&&to>from);
 assert.doesNotMatch(source.slice(from,to),/selectAccount\(record\)/);
 assert.match(source,/cmd==="deselect"/);
});

test("credential-store setup rejects parent symlink before creating outside directories",()=>{
 const home=mkdtempSync(join(realpathSync(tmpdir()),"gk-unsafe-home-"));
 try{
   const outside=join(home,"outside");
   mkdirSync(outside,{mode:0o700});
   mkdirSync(join(home,".config"),{mode:0o700});
   symlinkSync(outside,join(home,".config","gate-keeper"),"dir");
   const result=cli(home,"status");
   assert.equal(result.status,2,result.stderr);
   assert.match(result.stderr,/invalid credential store ownership/);
   assert.equal(existsSync(join(outside,"chatgpt-oauth")),false,
     "must not traverse symlink while creating private credential store");
 }finally{rmSync(home,{recursive:true,force:true});}
});
test("dangling OAuth selection symlink fails closed instead of allowing model fallback",()=>{
 const home=mkdtempSync(join(realpathSync(tmpdir()),"gk-dangling-active-"));
 try{
   const base=join(home,".config","gate-keeper","chatgpt-oauth");
   mkdirSync(base,{recursive:true,mode:0o700});
   symlinkSync(join(base,"missing.json"),join(base,"active.json"));
   assert.throws(()=>requireNoOAuthFallback({env:{},home}),/unsafe account selection file/);
 }finally{rmSync(home,{recursive:true,force:true});}
});
