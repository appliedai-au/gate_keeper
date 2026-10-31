import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,sign,randomUUID} from "node:crypto";
import {
 createOAuthAttempt,verifyCallback,validateIdToken,parseGrantedScopes,
 canUseChatGPTPlan,CHATGPT_OIDC
} from "../scripts/providers/chatgpt-oauth.mjs";
import {resolveTrueForgeModel,DEEPSEEK,CHATGPT} from "../scripts/providers/registry.mjs";
const host="urn:uuid:"+randomUUID();
const redirectUri="http://127.0.0.1:1455/auth/callback";
const attempt=createOAuthAttempt({hostId:host,redirectUri});
test("PKCE OAuth request uses exact loopback and OpenAI endpoint",()=>{
 const u=new URL(attempt.url);
 assert.equal(u.origin,"https://auth.openai.com");
 assert.equal(u.pathname,"/api/accounts/authorize");
 assert.equal(u.searchParams.get("client_id"),"dynamic_agent_client");
 assert.equal(u.searchParams.get("redirect_uri"),redirectUri);
 assert.equal(u.searchParams.get("resource"),"https://api.openai.com/v1");
 assert.equal(u.searchParams.get("code_challenge_method"),"S256");
 assert.ok(u.searchParams.get("code_challenge"));
 assert.ok(u.searchParams.get("scope").includes("chatgpt.tokens.use.direct"));
 assert.equal(u.searchParams.has("code_verifier"),false);
});
test("OAuth refuses public callback and invalid host",()=>{
 assert.throws(()=>createOAuthAttempt({hostId:host,redirectUri:"https://example.com/auth/callback"}),/callback/);
 assert.throws(()=>createOAuthAttempt({hostId:"user@example.com",redirectUri}),/host ID/);
});
test("callback requires state and issued dynamic client",()=>{
 const valid=redirectUri+"?state="+attempt.state+"&code=abc123&client_id=oaiapp_test_client_012345";
 assert.deepEqual(verifyCallback({callbackUrl:valid,attempt}),
   {code:"abc123",clientId:"oaiapp_test_client_012345"});
 assert.throws(()=>verifyCallback({callbackUrl:redirectUri+"?state=bad&code=x&client_id=oaiapp_example",attempt}),/state mismatch/);
 assert.throws(()=>verifyCallback({callbackUrl:redirectUri+"?state="+attempt.state+"&code=x",attempt}),/issued client ID/);
});
test("returning account cannot change its registered client ID",()=>{
 const a=createOAuthAttempt({hostId:host,redirectUri,clientId:"oaiapp_test_client_123456"});
 assert.throws(()=>verifyCallback({callbackUrl:redirectUri+"?state="+a.state+"&code=x&client_id=oaiapp_fake_client_123456",attempt:a}),/client registration mismatch/);
});
const key=generateKeyPairSync("rsa",{modulusLength:2048});
const jwk=key.publicKey.export({format:"jwk"});
const now=Math.floor(Date.now()/1000);
const clientId="oaiapp_test_client_123456";
const makeJwt=(claims,priv=key.privateKey,alg="RS256")=>{
 const header={alg,typ:"JWT",kid:"testkey"};
 const a=Buffer.from(JSON.stringify(header)).toString("base64url");
 const b=Buffer.from(JSON.stringify(claims)).toString("base64url");
 const sig=sign("RSA-SHA256",Buffer.from(a+"."+b),priv).toString("base64url");
 return a+"."+b+"."+sig;
};
const claims={iss:CHATGPT_OIDC.issuer,aud:clientId,sub:"subject-1",nonce:attempt.nonce,
 email:"user@example.com",iat:now-2,exp:now+600};
const check=(token=makeJwt(claims))=>validateIdToken({idToken:token,jwks:{keys:[{...jwk,kid:"testkey",use:"sig"}]},clientId,nonce:attempt.nonce,now});
test("valid ID token requires pinned issuer audience nonce and signature",()=>{
 assert.equal(check().subject,"subject-1");
 assert.throws(()=>check(makeJwt({...claims,aud:"other_client"})),/claims invalid/);
 assert.throws(()=>check(makeJwt({...claims,nonce:"wrong"})),/claims invalid/);
 assert.throws(()=>check(makeJwt({...claims,iss:"https://attacker.example"})),/claims invalid/);
 assert.throws(()=>check(makeJwt({...claims,exp:now-1})),/claims invalid/);
 const rogue=generateKeyPairSync("rsa",{modulusLength:2048});
 assert.throws(()=>check(makeJwt(claims,rogue.privateKey)),/signature invalid/);
});
test("JWT algorithm cannot be changed by issuer input",()=>{
 assert.throws(()=>check(makeJwt(claims,key.privateKey,"none")) ,/algorithm/);
});
test("inference consent is separate from identity login",()=>{
 assert.equal(canUseChatGPTPlan(parseGrantedScopes("openid profile email")),false);
 assert.equal(canUseChatGPTPlan(parseGrantedScopes("openid profile resource.invoke chatgpt.tokens.use.direct")),true);
});
test("DeepSeek official models and endpoint",()=>{
 assert.equal(DEEPSEEK.baseUrl,"https://api.deepseek.com");
 assert.equal(DEEPSEEK.models.economy,"deepseek-flash");
 assert.equal(DEEPSEEK.models.advanced,"deepseek-v4-pro");
});
test("DeepSeek routing requires TrueForge-confirmed names",()=>{
 assert.equal(resolveTrueForgeModel({}),undefined);
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"deepseek",GK_DEEPSEEK_CODE_SHARING_APPROVED:"1"}),/configured TrueForge model/);
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"deepseek",
  GK_TRUEFORGE_DEEPSEEK_ECONOMY_MODEL:"custom/deepseek-flash"}),/source-sharing approval/);
 assert.equal(resolveTrueForgeModel({GK_MODEL_PROVIDER:"deepseek",
  GK_DEEPSEEK_CODE_SHARING_APPROVED:"1",
  GK_TRUEFORGE_DEEPSEEK_ECONOMY_MODEL:"custom/deepseek-flash"}),"custom/deepseek-flash");
 assert.equal(resolveTrueForgeModel({GK_MODEL_PROVIDER:"deepseek",GK_MODEL_TIER:"advanced",
  GK_DEEPSEEK_CODE_SHARING_APPROVED:"1",
  GK_TRUEFORGE_DEEPSEEK_ADVANCED_MODEL:"custom/deepseek-v4-pro"}),"custom/deepseek-v4-pro");
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"chatgpt"}),/unapproved model provider/);
});
test("ChatGPT OAuth is local-only and not a TrueForge API key",()=>{
 assert.equal(CHATGPT.localOpenSourceOnly,true);
 assert.equal(CHATGPT.trueForgeAdapter,"NOT_CONFIGURED");
});
