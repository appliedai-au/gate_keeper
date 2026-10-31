import test from "node:test";
import assert from "node:assert/strict";
import { buildNativeTrueForgeSpec, nativeProfileReadiness, validateApprovalTools } from "../scripts/trueforge/native-profile.mjs";

const accepted={
  registeredGithubConnector:"github",
  sandboxProviderVerified:true,
  independentGatewayVerified:true,
};

test("native profile is held without independent sandbox, gateway and connector prerequisites",()=>{
  for(const args of [{},{...accepted,sandboxProviderVerified:false},
    {...accepted,independentGatewayVerified:false},
    {...accepted,registeredGithubConnector:"unverified"}]){
    assert.throws(()=>buildNativeTrueForgeSpec(args),/NATIVE_PROFILE_HELD/);
  }
});

test("native profile uses TrueForge sandbox and subagents, never a bespoke coordinator",()=>{
  const {name,manifest,release}=buildNativeTrueForgeSpec(accepted);
  assert.equal(name,"gate-keeper-native");
  assert.equal(release,"HELD_PENDING_LIVE_QUALIFICATION");
  assert.equal(manifest.config.sandbox.enabled,true);
  assert.equal(manifest.config.sandbox.file_downloads,false);
  assert.equal(manifest.config.dynamic_sub_agents.enabled,true);
  assert.equal(manifest.config.iteration_limit,50);
  assert.equal(manifest.mcp_servers.length,1);
  assert.deepEqual(manifest.mcp_servers[0].enable_tools,["@read-only"]);
  assert.deepEqual(manifest.mcp_servers[0].require_approval_for_tools,["@write","@destructive"]);
  assert.equal(manifest.mcp_servers[0].preload,false);
  assert.match(manifest.instructions,/second coordinator service/i);
  assert.match(manifest.instructions,/Architect/);
  assert.match(manifest.instructions,/No human in the loop/);
  assert.match(manifest.instructions,/shared|same configured/i);
});

test("native profile reuses the reviewer model and declares no live write authority",()=>{
  const current=nativeProfileReadiness();
  const spec=buildNativeTrueForgeSpec(accepted).manifest;
  assert.equal(spec.model.name,"anthropic/claude-sonnet-4-6");
  assert.equal(current.liveWrites,false);
  assert.equal(current.newServicesRequired,0);
  assert.equal(current.status,"HELD");
  assert.ok(!spec.mcp_servers.some(s=>s.enable_tools.includes("@all")));
});

test("native approval policy rejects omissions and unexpected tool labels",()=>{
  for(const value of [undefined,null,[],["@write"],["@destructive"],
    ["@all"],["@write","@write"],["@write","@destructive","@all"],
    "write,destructive"]){
    assert.throws(()=>validateApprovalTools(value),/NATIVE_PROFILE_REJECTED/);
  }
  const original=["@destructive","@write"];
  const checked=validateApprovalTools(original);
  assert.deepEqual(checked,original);
  assert.notEqual(checked,original,"manifest must not alias mutable input array");
});
