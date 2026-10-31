// Gate Keeper isolated repair executor. Requires a separately provisioned,
// network-restricted disposable worker: never run this on a production host.
// It accepts an already-authorized patch; it is not an unrestricted code agent.
import { spawn } from "node:child_process";
import { mkdtemp, rm, realpath, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, relative } from "node:path";
import { executionAdmission, budgetAdmission } from "./policy.mjs";

const MAX_PATCH_BYTES=128_000;
const ALLOWED_PREFIXES=["src/","app/","lib/","server/","tests/","test/"];
const SAFE_TESTS=[
  ["npm","test","--","--runInBand"],
  ["npm","test"],
  ["npm","run","typecheck"],
  ["node","--test"],
];
function exactCommandAllowed(cmd) {
  return Array.isArray(cmd) && SAFE_TESTS.some(a=>a.length===cmd.length && a.every((v,i)=>v===cmd[i]));
}
export function validatePatch(patch) {
  if(typeof patch!=="string" || !patch || Buffer.byteLength(patch,"utf8")>MAX_PATCH_BYTES)
    throw new Error("PATCH_SIZE_REJECTED");
  if(patch.includes("\0") || patch.includes("\r"))throw new Error("PATCH_ENCODING_REJECTED");
  const files=[...patch.matchAll(/^diff --git a\/(.+?) b\/(.+)$/gm)];
  if(!files.length || files.length>12)throw new Error("PATCH_FILE_COUNT_REJECTED");
  for(const m of files){
    const a=m[1],b=m[2];
    if(a!==b || a.includes("..") || a.startsWith("/") || a.includes("\\") ||
       !ALLOWED_PREFIXES.some(p=>a.startsWith(p)) || a.includes("\n") ||
       /(?:^|\/)\./.test(a))
      throw new Error("PATCH_PATH_REJECTED");
  }
  if(/^(?:new file mode 120000|old mode 120000|new mode 160000|rename (?:from|to)|copy (?:from|to))/m.test(patch))
    throw new Error("PATCH_MODE_REJECTED");
  return files.map(m=>m[1]);
}
export function assertSafeCommand(command){
  if(!exactCommandAllowed(command))throw new Error("COMMAND_NOT_ALLOWLISTED");
  return [...command];
}
async function command(bin,args,{cwd,timeout=45_000,input,env={}}={}) {
  return await new Promise((resolve,reject)=>{
    // No shell parsing: commands and args are exact arrays.
    const child=spawn(bin,args,{cwd,env:{PATH:process.env.PATH,HOME:env.HOME||"/nonexistent",CI:"1",...env},
      stdio:["pipe","pipe","pipe"],shell:false});
    let stdout="",stderr="",settled=false;
    const stop=setTimeout(()=>{child.kill("SIGKILL");},timeout);
    const collect=(key)=>(chunk)=>{
      if(key==="stdout")stdout=(stdout+chunk).slice(-20_000);
      else stderr=(stderr+chunk).slice(-20_000);
    };
    child.stdout.on("data",collect("stdout"));
    child.stderr.on("data",collect("stderr"));
    child.on("error",finishError);
    child.on("close",code=>{
      clearTimeout(stop);
      if(settled)return;
      settled=true;
      resolve({ok:code===0,code,stdout,stderr});
    });
    function finishError(err){if(settled)return;settled=true;clearTimeout(stop);reject(err);}
    if(input)child.stdin.end(input);else child.stdin.end();
  });
}
async function mustOk(bin,args,opts) {
  const result=await command(bin,args,opts);
  if(!result.ok)throw new Error("ISOLATED_COMMAND_FAILED: "+bin+" "+args[0]+" "+result.stderr.slice(-700));
  return result.stdout.trim();
}
export async function runIsolatedRepair({
  repositoryDir, baseCommit, patch, tests=[["npm","test"]], validationPolls=3,
  admission, budget, onEvent=()=>{}, pollDelayMs=200,
}={}){
  if(process.env.GK_EXECUTOR_ISOLATED!=="1")throw new Error("ISOLATED_WORKER_REQUIRED");
  const scope=executionAdmission(admission);
  if(!scope.admitted)throw new Error(scope.reason);
  const spend=budgetAdmission(budget);
  if(!spend.admitted)throw new Error(spend.reason);
  if(typeof baseCommit!=="string" || !/^[a-f0-9]{40}$/.test(baseCommit))
    throw new Error("EXACT_COMMIT_REQUIRED");
  if(!Array.isArray(tests)||!tests.length||tests.length>5)
    throw new Error("TESTS_REQUIRED");
  for(const test of tests)assertSafeCommand(test);
  validatePatch(patch);
  if(!Number.isInteger(validationPolls) || validationPolls<2 || validationPolls>5)
    throw new Error("INVALID_POLL_COUNT");
  if(!Number.isInteger(pollDelayMs) || pollDelayMs<0 || pollDelayMs>2000)
    throw new Error("INVALID_POLL_DELAY");

  const root=await realpath(repositoryDir);
  const prefix=await mkdtemp(join(tmpdir(),"gk-repair-"));
  const workspace=resolve(prefix,"worktree");
  let mounted=false,stage="queued",testCount=0;
  const record=(next,meta={})=>{stage=next;onEvent({stage, ...meta});};
  try{
    const checked=await mustOk("git",["-C",root,"rev-parse","--show-toplevel"]);
    if(await realpath(checked)!==root)throw new Error("REPOSITORY_ROOT_REQUIRED");
    await mustOk("git",["-C",root,"cat-file","-e",baseCommit+"^{commit}"]);
    await mustOk("git",["-C",root,"worktree","add","--detach",workspace,baseCommit]);
    mounted=true;
    if(relative(prefix,workspace).startsWith(".."))throw new Error("WORKSPACE_ESCAPE");
    record("repairing");
    await mustOk("git",["apply","--check","--"],{cwd:workspace,input:patch});
    await mustOk("git",["apply","--"],{cwd:workspace,input:patch});
    record("testing");
    for(const test of tests){
      const result=await command(test[0],test.slice(1),{cwd:workspace,timeout:60_000});
      testCount++;
      if(!result.ok){record("reverted",{reason:"TEST_FAILED"});return {status:"reverted",reason:"TEST_FAILED",testCount};}
    }
    record("polling");
    // Repeated isolated checks catch non-determinism. These are not proof of
    // stability in production: staging/production polling requires another
    // isolated verifier wired into the hosted execution plane.
    for(let i=0;i<validationPolls;i++){
      if(pollDelayMs)await new Promise(r=>setTimeout(r,pollDelayMs));
      for(const test of tests){
        const result=await command(test[0],test.slice(1),{cwd:workspace,timeout:60_000});
        testCount++;
        onEvent({stage:"polling",attempt:i+1,total:validationPolls,ok:result.ok});
        if(!result.ok){record("reverted",{reason:"POLL_FAILED"});return {status:"reverted",reason:"POLL_FAILED",testCount};}
      }
    }
    const candidatePatch=await mustOk("git",["diff","--binary","--"],{cwd:workspace});
    record("kept",{testCount});
    return {status:"kept",candidatePatch,testCount,sourceCommit:baseCommit,
      promoted:false,merged:false,deployed:false};
  } catch(err){
    record("failed",{reason:String(err?.message||err).slice(0,200)});
    throw err;
  } finally {
    // Always auto-revert the disposable execution environment, including
    // when a test crashes or a patch is rejected. No production branch altered.
    if(mounted)await command("git",["-C",root,"worktree","remove","--force",workspace]).catch(()=>{});
    await rm(prefix,{recursive:true,force:true}).catch(()=>{});
  }
}
