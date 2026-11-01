import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {spawnSync} from "node:child_process";
import {resolveTrueForgeModel,describeProviders} from "../scripts/providers/registry.mjs";

test("TrueForge-managed model selection needs no Gate Keeper user credentials",()=>{
 const settings={GK_MODEL_PROVIDER:"trueforge",GK_TRUEFORGE_MODEL:"anthropic/claude-sonnet-4-6"};
 assert.equal(resolveTrueForgeModel(settings),"anthropic/claude-sonnet-4-6");
 assert.equal(describeProviders(settings).trueforge.providerKeysExposedToGateKeeper,false);
});
test("managed route rejects any unconfigured or unqualified model",()=>{
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"trueforge"}),/approved TrueForge model ID missing/);
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"trueforge",GK_TRUEFORGE_MODEL:"gpt-custom"}),/approved TrueForge model ID missing/);
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"trueforge",GK_TRUEFORGE_MODEL:"../../outside"}),/approved TrueForge model ID missing/);
});
test("managed route cannot be silently overridden by another model or tier",()=>{
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"trueforge",
  GK_TRUEFORGE_MODEL:"anthropic/claude-sonnet-4-6",TF_MODEL:"openai/gpt-6"}),/TF_MODEL conflicts/);
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"trueforge",
  GK_TRUEFORGE_MODEL:"anthropic/claude-sonnet-4-6",GK_MODEL_TIER:"economy"}),/managed model tier/);
});
test("TrueForge model catalog must approve configured managed choice before syncing",()=>{
 const setup=readFileSync(new URL("../scripts/setup.ts",import.meta.url),"utf8");
 assert.match(setup,/GK_MODEL_PROVIDER==="trueforge"/);
 assert.match(setup,/Approved managed model is not registered in TrueForge/);
});
test("TrueForge is the only provider route; legacy adapter routes fail closed",()=>{
 assert.equal(resolveTrueForgeModel({}),undefined);
 for(const p of ["chatgpt","chatgpt_oauth","deepseek","openai"])
  assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:p,GK_TRUEFORGE_MODEL:"anthropic/claude-sonnet-4-6"}),/unapproved model provider/);
 const status=readFileSync(new URL("../scripts/providers/status.mjs",import.meta.url),"utf8");
 assert.match(status,/connectionPolicy:"trueforge-only"/);
 assert.doesNotMatch(status,/apiKeyPresentHere|credentialPresentLocally|connect:chatgpt/);
});

test("all TrueForge agent sync paths verify managed model before writing",()=>{
 const lib=readFileSync(new URL("../scripts/lib.ts",import.meta.url),"utf8");
 const start=lib.indexOf("export async function syncAgent(");
 const check=lib.indexOf("if (process.env.GK_MODEL_PROVIDER===\"trueforge\")",start);
 const mutations=lib.indexOf("await tf.settings.skills.createOrUpdate(",start);
 assert.ok(start>=0&&check>start&&mutations>check,"model admission occurs before any TrueForge skill mutation");
 assert.match(lib.slice(start,mutations),/models\.some\(m=>m\.name===agent\.model\.name\)/);
 assert.match(lib.slice(start,mutations),/managed model not available in TrueForge/);
});

test("provider status never reports an active managed route when configuration is rejected",()=>{
 const run=env=>spawnSync(process.execPath,["scripts/providers/status.mjs"],{
   cwd:process.cwd(),env:{PATH:process.env.PATH,...env},encoding:"utf8",timeout:10000
 });
 const blocked=run({GK_MODEL_PROVIDER:"trueforge"});
 assert.equal(blocked.status,0,blocked.stderr);
 const output=JSON.parse(blocked.stdout);
 assert.equal(output.activeRoute,"blocked");
 assert.equal(output.selectedModel,null);
 assert.match(output.selectionError,/approved TrueForge model ID missing/);
 const ready=run({GK_MODEL_PROVIDER:"trueforge",GK_TRUEFORGE_MODEL:"anthropic/claude-sonnet-4-6"});
 assert.equal(ready.status,0,ready.stderr);
 assert.equal(JSON.parse(ready.stdout).activeRoute,"trueforge-managed");
});
