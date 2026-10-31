#!/usr/bin/env node
/**
 * Local, opt-in ChatGPT OAuth for the open-source Gate Keeper client.
 * No Railway/OIDC hosted auth or automatic model routing is configured here.
 */
import {createServer} from "node:http";
import {homedir} from "node:os";
import {join} from "node:path";
import {
  mkdirSync,readFileSync,readdirSync,writeFileSync,renameSync,openSync,closeSync,
  fsyncSync,lstatSync,existsSync,constants,realpathSync
} from "node:fs";
import {createHash,randomUUID} from "node:crypto";
import {
  createOAuthAttempt,verifyCallback,validateIdToken,parseGrantedScopes,
  canUseChatGPTPlan,CHATGPT_OIDC
} from "./chatgpt-oauth.mjs";

const root=join(homedir(),".config","gate-keeper","chatgpt-oauth");
const die=message=>{console.error("CHATGPT_OAUTH_HELD: "+message);process.exitCode=2;};
function storeReady() {
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
function storeNew(filename,record) {
  storeReady();
  const path=join(root,filename);
  if(!/^[a-zA-Z0-9-]{1,100}\.json$/.test(filename))throw Error("invalid credential filename");
  const payload=JSON.stringify(record)+"\n";
  const temp=join(root,"tmp-"+randomUUID()+".json");
  const fd=openSync(temp,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
  try{writeFileSync(fd,payload);fsyncSync(fd);}finally{closeSync(fd);}
  if(existsSync(path))throw Error("existing registration requires explicit account selection");
  renameSync(temp,path);
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
  console.log(JSON.stringify({accounts:records,hostedProviderActive:false},null,2));
}
async function fetchLimited(url,options={}) {
  const res=await fetch(url,{...options,redirect:"error",signal:AbortSignal.timeout(15000)});
  if(!res.ok)throw Error("OpenAI authorization endpoint returned HTTP "+res.status);
  const text=await res.text();
  if(text.length>350000)throw Error("authorization response too large");
  return JSON.parse(text);
}
async function login(){
  if(process.env.RAILWAY_PROJECT_ID||process.env.RAILWAY_ENVIRONMENT_ID)
    throw Error("hosted Railway OAuth is not eligible for the local loopback flow");
  if(process.env.CI)throw Error("interactive local OAuth is forbidden in CI");
  const host=hostId();
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
    const attempt=createOAuthAttempt({hostId:host,redirectUri});
    const callback=new Promise((resolve,reject)=>{
      const timeout=setTimeout(()=>reject(Error("authorization expired")),180000);
      timeout.unref();
      server.once("request",(req,res)=>{
        try{
          if(req.method!=="GET"||req.headers.host!=="127.0.0.1:"+addr.port)
            throw Error("wrong callback host");
          const url=new URL(req.url||"/",redirectUri);
          const verified=verifyCallback({callbackUrl:url.toString(),attempt});
          res.writeHead(200,{"Content-Type":"text/plain; charset=utf-8","Cache-Control":"no-store"});
          res.end("Gate Keeper authorization received. Return to the terminal.");
          clearTimeout(timeout);resolve(verified);
        }catch(err){
          res.writeHead(400,{"Content-Type":"text/plain","Cache-Control":"no-store"});
          res.end("Authorization rejected.");
          // Wrong callbacks must NOT terminate the intended pending request.
        }
      });
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
    const scopes=parseGrantedScopes(token.scope);
    const key=createHash("sha256").update(clientId+"\0"+account.issuer+"\0"+account.subject).digest("hex");
    const expiresAt=new Date(Date.now()+(Number(token.expires_in)||3600)*1000).toISOString();
    storeNew("account-"+key+".json",{
      issuer:account.issuer,subject:account.subject,email:account.email,
      client_id:clientId,ext_agent_host_id:host,
      id_token:token.id_token,access_token:token.access_token,
      refresh_token:token.refresh_token||null,scopes,
      expires_at:expiresAt,saved_at:new Date().toISOString(),
    });
    console.log("ChatGPT identity connected locally.");
    console.log(canUseChatGPTPlan(scopes)?"ChatGPT plan usage permission granted; TrueForge adapter still disabled.":"Identity connected, but ChatGPT plan usage was NOT granted.");
  }finally{await new Promise(resolve=>server.close(()=>resolve()));}
}
const cmd=process.argv[2]||"status";
try{
 if(cmd==="status")status();
 else if(cmd==="login")await login();
 else throw Error("Usage: npm run connect:chatgpt -- login | status");
}catch(err){die(err instanceof Error?err.message:"connection failed");}
