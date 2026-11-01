import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const from = (path) => readFileSync(new URL("../"+path, import.meta.url), "utf8");
const catalogue = JSON.parse(from("config/stranger-builds-catalogue.json"));
const uiCatalogue = JSON.parse(from("integrations/base44/data/modelCatalogue.json"));
const display = JSON.parse(from("integrations/base44/data/firstBenchmark.json"));
const truth = JSON.parse(from("proof/submissions/gk-live-20261101-g/summary.json"));
const report = from("proof/submissions/gk-live-20261101-g/report.md");
const page = from("integrations/base44/pages/GateKeeper.jsx");
const component = from("integrations/base44/components/GateKeeperBenchmark.jsx");

test("catalogue covers the twenty active chat models and excludes embeddings from generation", () => {
  assert.equal(catalogue.chatModels.length, 20);
  assert.equal(catalogue.embeddingModels.length, 2);
  assert.deepEqual(uiCatalogue.chatModels, catalogue.chatModels);
  assert.deepEqual(uiCatalogue.embeddingModels, catalogue.embeddingModels);
  assert.equal(new Set([...catalogue.chatModels,...catalogue.embeddingModels]).size,22);
  assert.equal(uiCatalogue.creditsVerified,false);
  assert.equal(uiCatalogue.metadataOnly,true);
  assert.ok(catalogue.chatModels.includes("gpt-6-luna"));
  assert.ok(!catalogue.chatModels.some(name=>name.includes("embedding")));
});

test("published benchmark references locked run and never upgrades its qualified status", () => {
  assert.equal(display.runId, truth.run_id);
  const expectedSource="https://github.com/appliedai-au/gate_keeper/blob/9d9e08a6d28687c2d55099f65718deec37245454/proof/submissions/"+display.runId+"/";
  assert.equal(display.reportUrl,expectedSource+"report.md");
  assert.equal(display.summaryUrl,expectedSource+"summary.json");

  assert.equal(display.result, truth.result);
  assert.equal(display.result,"INCONCLUSIVE");
  assert.equal(display.sourceCommit,truth.source.gate_keeper_commit);
  assert.equal(display.modelProviderAtRun,truth.environment.provider);
  assert.equal(display.sponsorCreditAttribution,"UNVERIFIED");
  assert.equal(display.independentQualification,"BLOCKED");
  assert.equal(truth.loop.independent_qualification,"BLOCKED");
  assert.equal(display.tasks,12);
  assert.equal(display.trials,truth.arms.baseline.trials);
  assert.equal(display.expectedDefects,48);
  const m = {
    "baseline-haiku":truth.arms["baseline@anthropic/claude-haiku-5-5"],
    "keeper-haiku":truth.arms["gate_keeper@anthropic/claude-haiku-5-5"],
    "baseline-sonnet":truth.arms.baseline,
    "keeper-sonnet":truth.arms.gate_keeper,
    "keeper-opus":truth.arms["gate_keeper@anthropic/claude-opus-5-5"]
  };
  assert.equal(display.arms.length,5);
  for (const row of display.arms) {
    const item=m[row.id]; assert.ok(item,"unknown row "+row.id);
    assert.equal(row.detected,Math.round(item.defect_recall*48));
    assert.equal(row.precision,item.precision);
    assert.equal(row.medianLatencyMs,item.median_latency_ms);
    assert.equal(item.actual_cost_usd,null,"historical billing is NOT actual cost");
    assert.ok(report.includes(row.model),"source report missing model "+row.model);
  }
  assert.ok(display.limitations.some(x=>/invoice|invoiced/i.test(x)));
});

test("Base44 public site exposes historical evidence and model selection without billable actions", () => {
  assert.ok(page.includes("GateKeeperBenchmark key={page} section={page}"));
  assert.match(component,/catalogue\.chatModels\.map/);
  assert.match(component,/proof\.arms\.map/);
  assert.match(component,/INCONCLUSIVE|proof\.result/);
  assert.match(component,/No paid requests will be sent from this page/);
  assert.doesNotMatch(component,/sessions\.create|sessions\.createTurn|api\/v1\/sessions|base44\.functions\.invoke|fetch\(/);
  assert.doesNotMatch(JSON.stringify(display),/private_reference|session_id|api_key|SECRET_/);
});
