#!/usr/bin/env node
/**
 * Local, opt-in ChatGPT OAuth for the open-source Gate Keeper client.
 * No Railway/OIDC hosted auth or automatic model routing is configured here.
 */
import {createServer} from "node:http";
import {homedir} from "node:os";
import {join} from "node:path";
import {
  mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync,linkSync,unlinkSync,openSync,closeSync,
  fsyncSync,lstatSync,existsSync,constants,realpathSync
} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {
  createOAuthAttempt,verifyCallback,validateIdToken,parseGrantedScopes,
  canUseChatGPTPlan,CHATGPT_OIDC
} from "./chatgpt-oauth.mjs";
import {normalizeEmail,verifyExpectedAccount,accountRef} from "./account-identity.mjs";

let root; // Resolved lazily so missing HOME is handled by the CLI error boundary.
const die=message=>{console.error("CHATGPT_OAUTH_HELD: "+message);process.exitCode=2;};
function storeReady() {
  root ??= join(realpathSync(homedir()),".config","gate-keeper","chatgpt-oauth");
  mkdirSync(root,{recursive:true,mode:0o700});
  let current=realpathSync(homedir());
  for(const p of [".config","gate-keeper","chatgpt-oauth"]){
    current=join(current,p);
    const st=lstatSync(current);
    if(!st.isDirectory()||st.isSymbolicLink()||(process.getuid&&st.uid!==process.getuid()))
      throw Error("invalid credential store ownership");
    if(current===root && (st.mode&0o077))throw Error("credential store is not private");
  }
}
function findExistingClient(clientId) {
  if(!clientId)return null;
  if(!/^oaiapp_[A-Za-z0-9_-]{8,128}$/.test(clientId))
    throw Error("invalid ChatGPT OAuth client ID");
  storeReady();
  const matched=readdirSync(root).filter(n=>n.startsWith("account-")&&n.endsWith(".json"))
    .map(filename=>{
      const path=join(root,filename),st=lstatSync(path);
      if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))
        throw Error("unsafe account credential permissions");
      return {filename,record:JSON.parse(readFileSync(path,"utf8"))};
    }).filter(x=>x.record.client_id===clientId);
  if(matched.length!==1)throw Error("existing account missing or ambiguous");
  return matched[0];
}
function storeNew(filename,record,{replaceExisting=false}={}) {
  storeReady();
  if(!/^[a-zA-Z0-9-]{1,100}\.json$/.test(filename))
    throw Error("invalid credential filename");
  const path=join(root,filename);
  const temp=join(root,"tmp-"+randomUUID()+".json");
  const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try {
    try{writeFileSync(fd,JSON.stringify(record)+"\n");fsyncSync(fd);}finally{closeSync(fd);}
    if(replaceExisting){
      const old=lstatSync(path);
      if(!old.isFile()||old.isSymbolicLink()||(old.mode&0o077)||
         (process.getuid&&old.uid!==process.getuid()))
        throw Error("unsafe existing credential");
      renameSync(temp,path);
    }else{
      linkSync(temp,path); // Atomic no-clobber; EEXIST cannot overwrite.
    }
  }finally{try{unlinkSync(temp);}catch{}}
}

function hostId() {
  storeReady();
  const file=join(root,"host.json");
  if(existsSync(file)){
    const st=lstatSync(file);
    if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o077))
      throw Error("unsafe host identifier storage");
    const id=JSON.parse(readFileSync(file,"utf8")).hostId;
    if(!/^urn:uuid:[a-f0-9-]{36}$/i.test(id))throw Error("invalid saved host identifier");
    return id;
  }
  const id="urn:uuid:"+randomUUID();
  const fd=openSync(file,constants.O_CREAT|constants.O_EXCL|constants.O_WRONLY|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,JSON.stringify({hostId:id})+"\n");fsyncSync(fd);}finally{closeSync(fd);}
  return id;
}
function selectedRecord() {
  storeReady();
  const file=join(root,"active.json");
  if(!existsSync(file))return null;
  const st=lstatSync(file);
  if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077)||
     (process.getuid&&st.uid!==process.getuid()))
    throw Error("unsafe active account selector");
  const record=JSON.parse(readFileSync(file,"utf8"));
  if(!/^[0-9a-f]{64}$/.test(record.account_ref||""))throw Error("invalid account selector");
  return record;
}
function selectAccount(record) {
  if(record.ext_agent_host_id!==hostId())
    throw Error("ChatGPT registration belongs to a different local host");
  const recordRef=accountRef(record);
  const activeFile=join(root,"active.json");
  storeNew("active.json",{account_ref:recordRef,provider_policy:"chatgpt_oauth_only",
    fallback_allowed:false,selected_at:new Date().toISOString()},
    {replaceExisting:existsSync(activeFile)});
}
function selectClient(clientId) {
  const selected=findExistingClient(clientId);
  if(!selected)throw Error("Select a registered ChatGPT account");
  selectAccount(selected.record);
  console.log("Selected local ChatGPT account. OAuth inference through TrueForge remains disabled.");
}
function status(){
  storeReady();
  const accounts=readdirSync(root).filter(n=>n.startsWith("account-")&&n.endsWith(".json"));
  // Never print stored access tokens, refresh tokens, ID tokens, auth hints.
  const records=accounts.map(n=>{
    const file=join(root,n),st=lstatSync(file);
    if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o077))
      throw Error("unsafe account credential permissions");
    const o=JSON.parse(readFileSync(file,"utf8"));
    return {account:o.email||"(email not provided)",client_id:o.client_id,
      planUsageEnabled:canUseChatGPTPlan(o.scopes||[]),
      expires_at:o.expires_at,provider:"chatgpt-oauth-local"};
  });
  const selected=selectedRecord();
  const accountsWithSelection=records.map(r=>({...r,
    active:!!selected && selected.account_ref===accountRef(
      // Account identity is only read from protected local credential records.
      recordForClientId(r.client_id)
    )}));
  if(selected && !accountsWithSelection.some(r=>r.active))
    throw Error("active account is no longer registered; select an owned account");
  console.log(JSON.stringify({accounts:accountsWithSelection,
    hostedProviderActive:false,modelProvider:"chatgpt-oauth-local",
    trueForgeInference:"DISABLED_PENDING_ADAPTER",
    policy:selected?.provider_policy||"chatgpt_oauth_only",fallbackAllowed:false},null,2));
}
function recordForClientId(clientId) {
  const chosen=findExistingClient(clientId);
  if(!chosen)throw Error("selected ChatGPT registration not found");
  return chosen.record;
}
async function fetchLimited(url,options={}) {
  const res=await fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error("OpenAI authorization endpoint returned HTTP "+res.status);
  const text=await res.text();
  if(text.length>350000)throw Error("authorization response too large");
  return JSON.parse(text);
}
async function login(existingClientId,expectedEmail){
  const selectedEmail=normalizeEmail(expectedEmail);
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("hosted Railway OAuth is not eligible for the local loopback flow");
  if(process.env.CI)throw Error("interactive local OAuth is forbidden in CI");
  const host=hostId();
  const selected=findExistingClient(existingClientId);
  // Bind exclusively to local loopback; no public callback, no external tunnel.
  const server=createServer();
  try{
    await new Promise((resolve,reject)=>{
      server.once("error",reject);
      server.listen(0,"127.0.0.1",resolve);
    });
    const addr=server.address();
    if(!addr||typeof addr==="string")throw Error("invalid loopback listener");
    const redirectUri="http://127.0.0.1:"+addr.port+"/auth/callback";
    const attempt=createOAuthAttempt({hostId:host,redirectUri,clientId:selected?.record.client_id||"dynamic_agent_client"});
    const callback=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error("authorization expired")),180000);
      timeout.unref();
      let accepted=false;
      const onCallback=(req,res)=>{
        if(accepted){
          res.writeHead(410,{"Content-Type":"text/plain","Connection":"close"});
          res.end("Authorization already handled.");
          return;
        }
        try{
          if(req.method!=="GET"||req.headers.host!=="127.0.0.1:"+addr.port)
            throw Error("wrong callback host");
          const url=new URL(req.url||"/",redirectUri);
          const verified=verifyCallback({callbackUrl:url.toString(),attempt});
          res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
          res.end("Gate Keeper authorization received. Return to the terminal.");
          clearTimeout(timeout);
          accepted=true;
          resolve(verified);
        }catch(err){
          res.writeHead(400,{"Content-Type":"text/plain","Cache-Control":"no-store"});
          res.end("Authorization rejected.");
          // Wrong callbacks must NOT consume the legitimate pending attempt.
        }
      };
      server.on("request",onCallback);
    });
    console.log("Open this URL in your local browser to authorise Gate Keeper:");
    console.log(attempt.url); // only state/nonce/PKCE challenge; no tokens or secrets
    const {code,clientId}=await callback;
    const token=await fetchLimited(CHATGPT_OIDC.token,{
      method:"POST",
      headers:{"Content-Type":"application/x-www-form-urlencoded"},
      body:new URLSearchParams({
        grant_type:"authorization_code",client_id:clientId,code,
        redirect_uri:redirectUri,code_verifier:attempt.verifier,
        resource:CHATGPT_OIDC.resource,
      }),
    });
    if(!token.id_token||!token.access_token)throw Error("no valid token response");
    const jwks=await fetchLimited(CHATGPT_OIDC.jwks);
    const account=validateIdToken({idToken:token.id_token,jwks,clientId,nonce:attempt.nonce});
    // Email selects the intended user in the browser; verified issuer + subject
    // and issued client ID remain the real account security identity.
    verifyExpectedAccount(account,selectedEmail);
    if(selected && (account.subject!==selected.record.subject ||
        account.issuer!==selected.record.issuer || clientId!==selected.record.client_id))
      throw Error("reconnected OAuth identity does not match selected account");
    const scopes=parseGrantedScopes(token.scope);
    const key=createHash("sha256").update(clientId+"\0"+account.issuer+"\0"+account.subject).digest("hex");
    const expiresAt=new Date(Date.now()+(Number(token.expires_in)||3600)*1000).toISOString();
    const record={
      issuer:account.issuer,subject:account.subject,email:account.email,
      client_id:clientId,ext_agent_host_id:host,
      id_token:token.id_token,access_token:token.access_token,
      refresh_token:token.refresh_token||null,scopes,
      expires_at:expiresAt,saved_at:new Date().toISOString(),
    };
    if(selected && selected.filename!=="account-"+key+".json")
      throw Error("existing OAuth account identity changed");
    storeNew("account-"+key+".json",record,{replaceExisting:!!selected});
    // The selected profile belongs to this local OS user only; no global
    // credentials or shared default account are created for other users.
    console.log("ChatGPT identity connected locally. Use select <client_id> to activate ChatGPT-only mode.");
    console.log(canUseChatGPTPlan(scopes)?"ChatGPT plan usage permission granted; TrueForge adapter still disabled.":"Identity connected, but ChatGPT plan usage was NOT granted.");
  }finally{
    server.closeAllConnections?.();
    await new Promise(resolve=>server.close(()=>resolve()));
  }
}
function parseLoginArgs(values){
  let existingClientId=null,expectedEmail=null;
  for(let i=0;i<values.length;i++){
    const a=values[i];
    if(a==="--email"){
      if(expectedEmail!==null || !values[i+1])throw Error("--email requires a single account email hint");
      expectedEmail=normalizeEmail(values[++i]);
    }else if(a.startsWith("oaiapp_") && !existingClientId){
      existingClientId=a;
    }else throw Error("Unknown ChatGPT login argument");
  }
  return {existingClientId,expectedEmail};
}
const cmd=process.argv[2]||"status";
try{
 if(cmd==="status"){
   if(process.argv.length>3)throw Error("Status takes no arguments");
   status();
 }else if(cmd==="login"){
   const args=parseLoginArgs(process.argv.slice(3));
   await login(args.existingClientId,args.expectedEmail);
 }else if(cmd==="select"){
   if(process.argv.length!==4)throw Error("Select requires one issued client ID");
   selectClient(process.argv[3]);
 }else throw Error("Usage: npm run connect:chatgpt -- login [existing_client_id] [--email your@email] | select <client_id> | status");
}catch(err){die(err instanceof Error?err.message:"connection failed");}
