/**
 * Per-user ChatGPT OAuth account policy for local open-source Gate Keeper.
 * Email is only an account-selection hint; issuer+subject+issued client ID
 * are the trusted identity. Never use a global account or share token records.
 */
import {createHash,timingSafeEqual} from "node:crypto";
const ISSUER="https://auth.openai.com";
const CLIENT=/^oaiapp_[A-Za-z0-9_-]{8,128}$/;
const HOST=/^urn:uuid:[0-9a-f-]{36}$/i;
const fail=reason=>{throw new Error("CHATGPT_ACCOUNT_REJECTED: "+reason);};
export function normalizeEmail(value) {
 if(value===undefined||value===null||value==="")return null;
 if(typeof value!=="string")fail("invalid account email hint");
 const email=value.trim().toLowerCase();
 if(email.length>254||!/^\S+@\S+\.\S+$/.test(email))fail("invalid account email hint");
 return email;
}
export function verifyExpectedAccount(identity,expectedEmail) {
 const expected=normalizeEmail(expectedEmail);
 if(!identity || identity.issuer!==ISSUER || typeof identity.subject!=="string" || !identity.subject)
   fail("verified OpenAI identity absent");
 if(expected && normalizeEmail(identity.email)!==expected)
   fail("authorized account does not match selected email");
 return {issuer:identity.issuer,subject:identity.subject,email:normalizeEmail(identity.email)};
}
export function accountRef(record) {
 if(!record || record.issuer!==ISSUER || typeof record.subject!=="string" || !record.subject ||
    !CLIENT.test(record.client_id||"") || !HOST.test(record.ext_agent_host_id||""))
   fail("invalid OAuth registration");
 return createHash("sha256").update(
    record.issuer+"\u0000"+record.subject+"\u0000"+record.client_id+"\u0000"+record.ext_agent_host_id
 ).digest("hex");
}
export function assertActiveAccount(active,record,{requirePlanUsage=false,now=Date.now()}={}) {
 if(!active||!record || active.account_ref!==accountRef(record))fail("selected account mismatch");
 const expiry=Date.parse(record.expires_at);
 if(!Number.isFinite(expiry)||expiry<=now)fail("selected OAuth token expired");
 const scopes=new Set(Array.isArray(record.scopes)?record.scopes:[]);
 if(requirePlanUsage && (!scopes.has("chatgpt.tokens.use.direct")||!scopes.has("resource.invoke")))
   fail("selected account has not authorised plan inference");
 return Object.freeze({account_ref:active.account_ref,
   client_id:record.client_id,subject:record.subject,email:normalizeEmail(record.email),
   planUsageEnabled:scopes.has("chatgpt.tokens.use.direct")&&scopes.has("resource.invoke")});
}
export function requireUserScopedInference({account,hosted,adapterReady}={}) {
 if(hosted)fail("hosted OAuth adapter requires separate partner approval");
 if(!account?.planUsageEnabled)fail("user OAuth plan use not authorised");
 if(adapterReady!==true)fail("TrueForge OAuth inference adapter not configured; refusing fallback");
 return true;
}
