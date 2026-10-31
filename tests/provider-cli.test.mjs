import test from "node:test";
import assert from "node:assert/strict";
import {mkdtempSync,mkdirSync,writeFileSync,chmodSync,realpathSync,rmSync,readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {spawnSync} from "node:child_process";

function sandbox(fn) {
 const home=mkdtempSync(join(realpathSync(tmpdir()),"gk-provider-cli-"));
 try{return fn(home);}finally{rmSync(home,{recursive:true,force:true});}
}
function cli(home,...args) {
 return spawnSync(process.execPath,["scripts/providers/chatgpt-login.mjs",...args],
  {cwd:resolve("."),env:{...process.env,HOME:home},encoding:"utf8",timeout:10000});
}
test("local ChatGPT OAuth status prints no credentials",()=>sandbox(home=>{
 let r=cli(home,"status");
 assert.equal(r.status,0,r.stderr);
 assert.deepEqual(JSON.parse(r.stdout).accounts,[]);
 const root=join(home,".config","gate-keeper","chatgpt-oauth");
 const record={
  email:"user@example.com",subject:"private_subject",client_id:"oaiapp_test_client_123456",
  access_token:"SECRET_ACCESS_123",refresh_token:"SECRET_REFRESH_456",
  id_token:"SECRET_ID_789",scopes:["openid"],expires_at:"2030-01-01T00:00:00Z"
 };
 const file=join(root,"account-test-record.json");
 writeFileSync(file,JSON.stringify(record),{mode:0o600});
 r=cli(home,"status");
 assert.equal(r.status,0,r.stderr);
 assert.ok(r.stdout.includes("user@example.com"));
 assert.equal(r.stdout.includes("SECRET_"),false);
 assert.equal(JSON.parse(r.stdout).accounts[0].planUsageEnabled,false);
}));
test("interactive OAuth cannot run in CI",()=>sandbox(home=>{
 const p=spawnSync(process.execPath,["scripts/providers/chatgpt-login.mjs","login"],
  {cwd:resolve("."),env:{...process.env,HOME:home,CI:"true"},encoding:"utf8",timeout:10000});
 assert.equal(p.status,2);
 assert.match(p.stderr,/interactive local OAuth is forbidden in CI/);
}));
test("provider OAuth CLI has atomic no-clobber and loopback shutdown safeguards",()=>{
 const code=readFileSync(new URL("../scripts/providers/chatgpt-login.mjs",import.meta.url),"utf8");
 assert.match(code,/linkSync\(temp,path\)/);
 assert.match(code,/finally\{try\{unlinkSync\(temp\)/);
 assert.match(code,/server\.closeAllConnections\?\.\(\)/);
 assert.match(code,/accepted=true/);
 assert.match(code,/selected\.record\.subject/);
});
