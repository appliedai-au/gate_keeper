import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const from=(path)=>readFileSync(new URL("../"+path,import.meta.url),"utf8");
const id="gk-playground-deepseek-20261102-a";
const proof=JSON.parse(from("proof/submissions/"+id+"/summary.json"));
const original=from("proof/submissions/"+id+"/report.md");
const publicUi=JSON.parse(from("integrations/base44/data/cheapestSmoke.json"));
const component=from("integrations/base44/components/GateKeeperBenchmark.jsx");
const fixture=JSON.parse(from("evals/tasks/01-python-utils.json"));

test("live Playground A/B has 2 gateway calls on exactly the same model and public fixture",()=>{
 assert.equal(proof.result,"INCONCLUSIVE");
 assert.equal(publicUi.result,"INCONCLUSIVE");
 assert.equal(proof.run_id,publicUi.runId);
 assert.equal(proof.execution.channel,"TrueFoundry Playground");
 assert.equal(proof.execution.trueforge_sdk_executed,false);
 assert.equal(proof.execution.gateway_request_count,2);
 assert.equal(proof.execution.temperature,0);
 assert.equal(proof.execution.effective_max_output_tokens,2500);
 assert.equal(proof.execution.trials,1);
 assert.equal(proof.execution.identical_user_fixture,true);
 assert.equal(proof.source.fixture,"evals/tasks/"+fixture.id+".json");
 assert.equal(fixture.holdout,false);
 assert.deepEqual(fixture.expected.map(e=>e.line),[7,12,22]);
 assert.equal(Object.keys(proof.arms).length,2);
 assert.equal(publicUi.arms.length,2);
 assert.equal(publicUi.model,proof.execution.upstream_provider+"/"+proof.execution.model);
});

test("published numbers are copied from trace evidence, not list-price estimates or independent claims",()=>{
 const arms=[proof.arms.baseline,proof.arms.gate_keeper];
 assert.deepEqual(arms.map(x=>x.detected_known_issues),[2,3]);
 assert.deepEqual(arms.map(x=>x.reported_findings),[2,3]);
 assert.deepEqual(arms.map(x=>x.gateway_latency_ms),[3140,2620]);
 assert.equal(arms[0].reported_total_tokens_approx,529);
 assert.equal(arms[1].reported_total_tokens_approx,1200);
 assert.equal(arms[0].gateway_reported_cost_usd,0.00009408);
 assert.equal(arms[1].gateway_reported_cost_usd,0.00018522);
 const sum=arms.reduce((n,a)=>n+a.gateway_reported_cost_usd,0);
 assert.ok(Math.abs(sum-0.00027930)<1e-12);
 assert.equal(proof.totals.gateway_reported_cost_usd,0.00027930);
 assert.equal(publicUi.totalGatewayChargeUsd,0.00027930);
 publicUi.arms.forEach((row,i)=>{
   assert.equal(row.knownIssuesDetected,arms[i].detected_known_issues);
   assert.equal(row.reportedTokensApprox,arms[i].reported_total_tokens_approx);
   assert.equal(row.gatewayReportedChargeUsd,arms[i].gateway_reported_cost_usd);
   assert.equal(row.latencyMs,arms[i].gateway_latency_ms);
 });
 assert.equal(proof.billing.sponsor_credit_deduction_verified,false);
 assert.equal(proof.billing.credit_balance_verified,false);
 assert.equal(publicUi.liveModelExecutionAvailableOnSite,false);
});

test("incorrect zero-step subsidiary explanation is transparently disclosed",()=>{
 assert.equal(proof.arms.gate_keeper.unsupported_subclaims.length,1);
 assert.match(proof.arms.gate_keeper.unsupported_subclaims[0].correction,/ValueError/);
 assert.match(publicUi.highlights[1],/incorrect/i);
 assert.match(original,/size=0/i);
 assert.match(original,/ValueError/);
 assert.match(component,/ValueError/);
 assert.match(component,/not a native TrueForge SDK/i);
 assert.match(component,/smoke\.gatewayReportedCostUsd|smoke\.totalGatewayChargeUsd/);
});

test("Base44 proof links are immutable and no public inference is enabled",()=>{
 const prefix="https://github.com/appliedai-au/gate_keeper/blob/af012932ad19c39d912a9be924de8ed0c2e10861/proof/submissions/"+id+"/";
 assert.equal(publicUi.githubReportUrl,prefix+"report.md");
 assert.equal(publicUi.githubSummaryUrl,prefix+"summary.json");
 assert.match(component,/cheapestSmoke\.json/);
 assert.match(component,/smoke\.arms\.map/);
 assert.doesNotMatch(component,/sessions\.create|createTurn|base44\.functions\.invoke|fetch\(/);
 assert.match(original,/INCONCLUSIVE/);
 assert.match(original,/TrueFoundry Playground/);
});
