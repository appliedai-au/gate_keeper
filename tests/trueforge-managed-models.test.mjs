import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
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
test("managed provider is preferred, but existing default remains and local OAuth is optional",()=>{
 assert.equal(resolveTrueForgeModel({}),undefined);
 const status=readFileSync(new URL("../scripts/providers/status.mjs",import.meta.url),"utf8");
 assert.match(status,/connectionPolicy:"trueforge-first"/);
 assert.match(status,/localOpenSourcePlanConnection:"OPT_IN"/);
 assert.match(status,/hostedInference:"NOT_AUTHORISED"/);
 assert.doesNotMatch(status,/credentialPresentLocally/);
 assert.doesNotMatch(status,/apiKeyPresentHere/);
});
test("per-user ChatGPT plan must never be treated as managed TrueForge credentials",()=>{
 assert.throws(()=>resolveTrueForgeModel({GK_MODEL_PROVIDER:"chatgpt",
   GK_TRUEFORGE_MODEL:"anthropic/claude-sonnet-4-6"}),/unapproved model provider/);
});
