/**
 * ChatGPT OAuth client for LOCAL open-source Gate Keeper hosts only.
 * This code does not give hosted Railway TrueForge access to a ChatGPT plan.
 * Do not copy ChatGPT OAuth tokens into the TrueForge custom model API-key field.
 * See https://developers.openai.com/siwc/token-sharing-open-source/sign-in
 */
import {randomBytes,createHash,createPublicKey,verify as verifySignature,timingSafeEqual} from "node:crypto";

export const CHATGPT_OIDC=Object.freeze({
  issuer:"https://auth.openai.com",
  authorize:"https://auth.openai.com/api/accounts/authorize",
  token:"https://auth.openai.com/api/accounts/oauth/token",
  jwks:"https://auth.openai.com/.well-known/jwks.json",
  resource:"https://api.openai.com/v1",
});
export const CHATGPT_SCOPES=Object.freeze([
  "openid","profile","email","offline_access","resource.invoke","chatgpt.tokens.use.direct",
]);
const b64url = buffer=>Buffer.from(buffer).toString("base64url");
function fail(message){throw Error("CHATGPT_OAUTH_REJECTED: "+message);}
const equal=(a,b)=>{
 const x=Buffer.from(String(a||"")),y=Buffer.from(String(b||""));
 return x.length===y.length && timingSafeEqual(x,y);
};
export function createOAuthAttempt({
  hostId,redirectUri,clientId="dynamic_agent_client",agentName="Gate Keeper",
  state=b64url(randomBytes(32)),nonce=b64url(randomBytes(32)),
  verifier=b64url(randomBytes(48))
}) {
 if(!/^urn:uuid:[0-9a-f-]{36}$/i.test(hostId||""))fail("missing stable host ID");
 if(!/^http:\/\/127\.0\.0\.1:[0-9]{2,5}\/auth\/callback$/.test(redirectUri||""))
   fail("callback must use 127.0.0.1 and /auth/callback");
 if(!/^([a-zA-Z0-9_-]{12,128}|dynamic_agent_client)$/.test(clientId))fail("unsupported client ID");
 if(!/^[a-zA-Z0-9 _-]{4,64}$/.test(agentName))fail("invalid agent name");
 if([state,nonce,verifier].some(x=>typeof x!=="string" || x.length<32 || !/^[A-Za-z0-9_-]+$/.test(x)))
   fail("weak or malformed OAuth nonce/PKCE");
 const url=new URL(CHATGPT_OIDC.authorize);
 const params={
   response_type:"code",client_id:clientId,redirect_uri:redirectUri,
   resource:CHATGPT_OIDC.resource,scope:CHATGPT_SCOPES.join(" "),
   state,nonce,code_challenge_method:"S256",
   code_challenge:b64url(createHash("sha256").update(verifier).digest()),
   ext_agent_host_id:hostId,
 };
 if(clientId==="dynamic_agent_client")params.agent_name_hint=agentName;
 for(const [k,v] of Object.entries(params))url.searchParams.set(k,v);
 return Object.freeze({url:url.toString(),state,nonce,verifier,clientId,hostId,redirectUri});
}
export function verifyCallback({callbackUrl,attempt}) {
 const url=new URL(callbackUrl);
 const callback=new URL(attempt.redirectUri);
 if(url.origin!==callback.origin || url.pathname!==callback.pathname)fail("wrong callback origin");
 if(!equal(url.searchParams.get("state"),attempt.state))fail("state mismatch");
 if(url.searchParams.has("error"))fail("authorization denied");
 const code=url.searchParams.get("code");
 if(!code || code.length>4096)fail("authorization code absent");
 const returnedId=url.searchParams.get("client_id");
 const clientId=attempt.clientId==="dynamic_agent_client"?returnedId:attempt.clientId;
 if(!clientId || clientId==="dynamic_agent_client" || !/^[A-Za-z0-9_-]{8,128}$/.test(clientId))
   fail("issued client ID absent");
 if(attempt.clientId!=="dynamic_agent_client" && returnedId && returnedId!==attempt.clientId)
   fail("client registration mismatch");
 return {code,clientId};
}
export function validateIdToken({idToken,jwks,clientId,nonce,now=Math.floor(Date.now()/1000)}) {
 const parts=String(idToken||"").split(".");
 if(parts.length!==3 || parts.some(p=>p.length>20000))fail("malformed ID token");
 let header,claims;
 try{
  header=JSON.parse(Buffer.from(parts[0],"base64url").toString("utf8"));
  claims=JSON.parse(Buffer.from(parts[1],"base64url").toString("utf8"));
 }catch{fail("invalid JWT JSON");}
 if(header.alg!=="RS256" || typeof header.kid!=="string")fail("unsupported JWT algorithm");
 const jwk=jwks?.keys?.find(x=>x.kid===header.kid && x.kty==="RSA" && (x.use===undefined||x.use==="sig"));
 if(!jwk)fail("unknown signing key");
 let pub;
 try {pub=createPublicKey({key:jwk,format:"jwk"});}
 catch{fail("invalid signing key");}
 if(!verifySignature("RSA-SHA256",Buffer.from(parts[0]+"."+parts[1]),pub,Buffer.from(parts[2],"base64url")))
   fail("ID token signature invalid");
 const aud=claims.aud;
 const validAud=typeof aud==="string"?aud===clientId:
   Array.isArray(aud) && aud.includes(clientId) && claims.azp===clientId;
 if(claims.iss!==CHATGPT_OIDC.issuer || !validAud || !equal(claims.nonce,nonce) ||
    typeof claims.sub!=="string" || !claims.sub ||
    !Number.isFinite(claims.exp) || claims.exp<=now ||
    (claims.nbf!==undefined && (!Number.isFinite(claims.nbf) || claims.nbf>now+60)) ||
    (claims.iat!==undefined && (!Number.isFinite(claims.iat) || claims.iat>now+60)))
   fail("ID token claims invalid");
 return Object.freeze({issuer:claims.iss,subject:claims.sub,email:typeof claims.email==="string"?claims.email:"",
    name:typeof claims.name==="string"?claims.name:""});
}
export function parseGrantedScopes(scopes) {
 if(typeof scopes!=="string")return [];
 return [...new Set(scopes.split(/\s+/).filter(Boolean))];
}
export function canUseChatGPTPlan(scopes) {
 const granted=new Set(scopes);
 return granted.has("chatgpt.tokens.use.direct") && granted.has("resource.invoke");
}
