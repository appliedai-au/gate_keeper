/**
 * Fail-closed model selection for a local ChatGPT OAuth account.
 * A local OAuth login is NOT a TrueForge model adapter. Until an approved
 * adapter exists, it is unsafe to run a different model behind the user's back.
 */
import {lstatSync,readFileSync} from "node:fs";
import {homedir} from "node:os";
import {join} from "node:path";

export function requireNoOAuthFallback({
 env=process.env,home=homedir(),
}={}) {
 const explicit=env.GK_MODEL_PROVIDER==="chatgpt"||env.GK_MODEL_PROVIDER==="chatgpt_oauth";
 const path=join(home,".config","gate-keeper","chatgpt-oauth","active.json");
 let selected=false;
 // existsSync follows symlinks. A dangling selector would appear absent and
 // silently fall back to another billing provider; lstat must decide.
 let st;
 try{st=lstatSync(path);}
 catch(err){
   if(err?.code!=="ENOENT")throw Error("CHATGPT_OAUTH_HELD: selector unreadable");
 }
 if(st){
   if(st.isSymbolicLink()||!st.isFile()||(st.mode&0o077)||
      (process.getuid&&st.uid!==process.getuid()))
     throw Error("CHATGPT_OAUTH_HELD: unsafe account selection file");
   let current;
   try{current=JSON.parse(readFileSync(path,"utf8"));}
   catch{throw Error("CHATGPT_OAUTH_HELD: invalid account selection file");}
   if(current.provider_policy!=="chatgpt_oauth_only"||
      current.fallback_allowed!==false||
      !/^[a-f0-9]{64}$/.test(current.account_ref||""))
     throw Error("CHATGPT_OAUTH_HELD: malformed account-specific no-fallback policy");
   selected=true;
 }
 if(explicit||selected)
   throw Error("CHATGPT_OAUTH_HELD: local account selected, but the TrueForge OAuth inference adapter is not configured; no model fallback allowed");
 return true;
}
