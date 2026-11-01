import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  MODEL, TASK_IDS, PARAMETERS, ARMS, CHANNEL,
  initialStudy, progress, fixtureForRound, prepareRound, recordObservedPair, prepareSelfReflection,
} from "../scripts/proof/four-rounds.mjs";

const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const state = () => initialStudy();
function fakeOwnFeedback(study, arm, priorRound) {
  const prev = study.rounds[priorRound - 1].arms[arm];
  return {
    arm, afterRound: priorRound, sourceProof: prev.sourceProof,
    priorTraceIdSuffix: prev.traceIdSuffix,
    model: MODEL, origin: "same_model_self_reflection",
    evaluatorChecked: true,
    learningTurnId: "synthetic-learning-" + priorRound + "-" + arm,
    lesson: arm === "baseline"
      ? "Recheck error-handling branches and silent fallback behavior."
      : "Verify edge-case language semantics before asserting loops or hangs.",
  };
}
function nextRound(study, n) {
  const feedback = Object.fromEntries(ARMS.map(arm => [
    arm, fakeOwnFeedback(study, arm, n - 1),
  ]));
  return { feedback, bundle: prepareRound(study, n, feedback) };
}
function mockEvidence(bundle, round) {
  return Object.fromEntries(ARMS.map((arm, i) => [arm, {
    provider: "tfy-managed", model: MODEL,
    fixtureId: TASK_IDS[round - 1],
    temperature: PARAMETERS.temperature,
    maxOutputTokens: PARAMETERS.maxOutputTokens,
    gatewayTraceRef: "mock-only-round-" + round + "-" + arm,
    rawOutputSha256: sha256("synthetic test transcript " + round + "-" + arm),
    found: i + 1,
    gatewayReportedCostUsd: 0.0001 + i * 0.0001,
  }]));
}

test("the initial ledger acknowledges just TWO actual Playground calls, not eight", () => {
  const s = state(), p = progress(s);
  assert.equal(s.conclusion,"INCOMPLETE_EXPLORATORY_PROMPT_LEARNING");
  assert.equal(s.channel,CHANNEL);
  assert.equal(s.model,MODEL);
  assert.deepEqual(s.rounds.map(r=>r.fixtureId), TASK_IDS);
  assert.deepEqual(s.rounds.map(r=>[r.arms.baseline?.status||null,r.arms.gate_keeper?.status||null]),[
    ["OBSERVED_PLAYGROUND","OBSERVED_PLAYGROUND"],[null,null],[null,null],[null,null],
  ]);
  assert.deepEqual(p.byArm.baseline,{observed:1,total:4,missing:3});
  assert.deepEqual(p.byArm.gate_keeper,{observed:1,total:4,missing:3});
  assert.equal(p.observedGatewayTurns,2);
  assert.equal(p.missingGatewayTurns,6);
  assert.equal(p.gatewayReportedCostUsd,0.00027930);
  assert.equal(p.nativeTrueForgeExecutionVerified,false);
  assert.equal(p.learningQualified,false);
  assert.equal(s.learning.baseline.length,0);
  assert.equal(s.learning.gate_keeper.length,0);
});

test("public schedule has four unique non-holdout fixtures with three seeded issues each", () => {
  assert.equal(new Set(TASK_IDS).size,4);
  const sealed=JSON.parse(readFileSync(new URL("../evals/tasks/04-ts-fetch.json",import.meta.url),"utf8"));
  assert.equal(sealed.holdout,true,"never reveal or repurpose a protected holdout");
  assert.equal(TASK_IDS.includes(sealed.id),false,"sealed holdout cannot be a public study fixture");

  for(let n=1;n<=4;n++) {
    const t=fixtureForRound(n);
    assert.equal(t.id,TASK_IDS[n-1]);
    assert.equal(t.holdout,false);
    assert.equal(t.expected.length,3);
    assert.ok(t.code.length>=15);
  }
  for(const x of [0,5,-1,1.1,"2"])
    assert.throws(()=>fixtureForRound(x),/ROUND_OUT_OF_BOUNDS/);
});

test("round 2 refuses to start until BOTH arms independently produce verified own feedback",()=>{
  const s=state();
  assert.throws(()=>prepareRound(s,2,{}),/INDEPENDENT_OWN_FEEDBACK_REQUIRED:baseline/);
  const baseline=fakeOwnFeedback(s,"baseline",1);
  assert.throws(()=>prepareRound(s,2,{baseline}),/INDEPENDENT_OWN_FEEDBACK_REQUIRED:gate_keeper/);
  const forged={...baseline,arm:"gate_keeper"};
  assert.throws(()=>prepareRound(s,2,{baseline,gate_keeper:forged}),/INDEPENDENT_OWN_FEEDBACK_REQUIRED:gate_keeper/);
  const unverified={...baseline,evaluatorChecked:false};
  assert.throws(()=>prepareRound(s,2,{baseline:unverified,gate_keeper:fakeOwnFeedback(s,"gate_keeper",1)}),/INDEPENDENT_OWN_FEEDBACK_REQUIRED:baseline/);
  const wrongModel={...baseline,model:"truefoundry/deepseek-v4-flash-0731"};
  assert.throws(()=>prepareRound(s,2,{baseline:wrongModel,gate_keeper:fakeOwnFeedback(s,"gate_keeper",1)}),/INDEPENDENT_OWN_FEEDBACK_REQUIRED:baseline/);
  assert.throws(()=>prepareRound(s,3,{}),/PREVIOUS_ROUND_INCOMPLETE_OR_DUPLICATE/);
});

test("the paired round-2 payloads share the exact code, model and settings but NEVER mix lessons",()=>{
  const s=state(),{bundle,feedback}=nextRound(s,2);
  const [plain,keeper]=ARMS.map(a=>bundle[a]);
  assert.deepEqual(plain.parameters,keeper.parameters);
  assert.equal(plain.model,keeper.model);
  assert.equal(plain.model,MODEL);
  assert.equal(plain.userPrompt,keeper.userPrompt);
  assert.equal(plain.userSha256,keeper.userSha256);
  assert.notEqual(plain.systemSha256,keeper.systemSha256);
  assert.ok(plain.systemPrompt.includes(feedback.baseline.lesson));
  assert.ok(!plain.systemPrompt.includes(feedback.gate_keeper.lesson));
  assert.ok(keeper.systemPrompt.includes(feedback.gate_keeper.lesson));
  assert.ok(!keeper.systemPrompt.includes(feedback.baseline.lesson));
  assert.equal(plain.lessonSha256.length,1);
  assert.ok(plain.noTools&&keeper.noTools);
  assert.ok(plain.noRetry&&keeper.noRetry);
  assert.ok(plain.systemPrompt.includes("Benchmark output contract"));
  assert.ok(keeper.systemPrompt.includes("Benchmark output contract"));
  for(const p of [plain,keeper]){
    assert.ok(p.userPrompt.includes(fixtureForRound(2).filename));
    assert.ok(!p.userPrompt.includes("expected"));
    assert.ok(!p.userPrompt.includes("why"));
    assert.ok(!p.userPrompt.includes("python-deploy"));
    assert.ok(!p.userPrompt.includes("05-ts-task-pagination"));
  }
});

test("after Round 1 each agent gets its OWN historical critique in a symmetric self-reflection turn",()=>{
  const s=state();
  const plain=prepareSelfReflection(s,1,"baseline");
  const keeper=prepareSelfReflection(s,1,"gate_keeper");
  assert.equal(plain.model,keeper.model);
  assert.deepEqual(plain.parameters,keeper.parameters);
  assert.equal(plain.systemPrompt,keeper.systemPrompt);
  assert.equal(plain.systemSha256,keeper.systemSha256);
  assert.ok(plain.userPrompt.includes("one error-handling defect was missed"));
  assert.ok(keeper.userPrompt.includes("zero step in Python range was incorrect"));
  assert.ok(!plain.userPrompt.includes("zero step in Python range was incorrect"));
  assert.ok(!keeper.userPrompt.includes("one error-handling defect was missed"));
  assert.ok(plain.provenance.includes("sanitised historical"));
  assert.equal(plain.noTools,true);
  assert.equal(keeper.noAutoRetry,true);
  assert.ok(!plain.userPrompt.includes("03-python-deploy"));
  assert.ok(!keeper.userPrompt.includes("05-ts-task-pagination"));
  assert.throws(()=>prepareSelfReflection(s,4,"baseline"),/SELF_REFLECTION_SCOPE_INVALID/);
});

test("later self-reflection refuses uncorrelated private review transcripts",()=>{
  const original=state(),{bundle,feedback}=nextRound(original,2);
  const staged=recordObservedPair(original,2,bundle,mockEvidence(bundle,2),feedback);
  assert.throws(()=>prepareSelfReflection(staged,2,"baseline"),/PRIVATE_PRIOR_REPLY_AND_ADJUDICATION_REQUIRED/);
  assert.throws(()=>prepareSelfReflection(staged,2,"baseline",{
    ownReviewText:"wrong raw transcript",ownPriorAdjudication:"missed one category",
  }),/PRIVATE_PRIOR_REPLY_AND_ADJUDICATION_REQUIRED/);
  const ownReviewText="synthetic test transcript 2-baseline";
  const r=prepareSelfReflection(staged,2,"baseline",{
    ownReviewText,ownPriorAdjudication:"missed a prior category",
  });
  assert.ok(r.userPrompt.includes(ownReviewText));
  assert.ok(r.userPrompt.includes("missed a prior category"));
  assert.ok(!r.userPrompt.includes("synthetic test transcript 2-gate_keeper"));
  assert.equal(r.parameters.maxOutputTokens,180);
});

test("lesson budget is bounded, single-reviewer, self-reflection-only",()=>{
  const s=state();
  const bad=fakeOwnFeedback(s,"baseline",1);
  bad.lesson="unbounded ".repeat(50);
  assert.throws(()=>prepareRound(s,2,{baseline:bad,gate_keeper:fakeOwnFeedback(s,"gate_keeper",1)}),/LESSON_UNBOUNDED/);
  const fake={...fakeOwnFeedback(s,"baseline",1),origin:"other_agent_or_operator"};
  assert.throws(()=>prepareRound(s,2,{baseline:fake,gate_keeper:fakeOwnFeedback(s,"gate_keeper",1)}),/INDEPENDENT_OWN_FEEDBACK_REQUIRED/);
});

test("new rounds cannot be recorded without independently correlated traces; duplicate or swapped models fail",()=>{
  const s=state(), {bundle,feedback}=nextRound(s,2);
  const evidence=mockEvidence(bundle,2);
  assert.throws(()=>recordObservedPair(s,2,bundle,{},feedback),/NEW_GATEWAY_TRACE_NOT_CORRELATED/);
  assert.throws(()=>recordObservedPair(s,2,bundle,
    {...evidence,gate_keeper:{...evidence.gate_keeper,model:"truefoundry/deepseek-v4-flash-0731"}},feedback),
    /NEW_GATEWAY_TRACE_NOT_CORRELATED/);
  assert.throws(()=>recordObservedPair(s,2,bundle,
    {...evidence,gate_keeper:{...evidence.gate_keeper,gatewayTraceRef:evidence.baseline.gatewayTraceRef}},feedback),
    /NEW_GATEWAY_TRACE_NOT_CORRELATED/);
  const corrupted=structuredClone(bundle);
  corrupted.baseline.userSha256="b".repeat(64);
  assert.throws(()=>recordObservedPair(s,2,corrupted,evidence,feedback),/NEW_GATEWAY_TRACE_NOT_CORRELATED/);
  const staged=recordObservedPair(s,2,bundle,evidence,feedback);
  assert.equal(progress(staged).observedGatewayTurns,4);
  assert.equal(progress(s).observedGatewayTurns,2,"original study stays immutable");
  assert.equal(staged.learning.baseline[0].arm,"baseline");
  assert.equal(staged.learning.gate_keeper[0].arm,"gate_keeper");
  assert.throws(()=>recordObservedPair(staged,2,bundle,evidence,feedback),/PREVIOUS_ROUND_INCOMPLETE_OR_DUPLICATE/);
});

test("staged four-round mock never becomes certified learning or native TrueForge evidence",()=>{
  let s=state();
  for(let n=2;n<=4;n++){
    const {feedback,bundle}=nextRound(s,n);
    s=recordObservedPair(s,n,bundle,mockEvidence(bundle,n),feedback);
  }
  const p=progress(s);
  assert.equal(p.observedGatewayTurns,8);
  assert.equal(p.missingGatewayTurns,0);
  assert.equal(p.status,"FOUR_ROUNDS_OBSERVED_NOT_QUALIFIED");
  assert.equal(p.nativeTrueForgeExecutionVerified,false);
  assert.equal(p.learningQualified,false);
  assert.deepEqual(s.learning.baseline.map(x=>x.afterRound),[1,2,3]);
  assert.deepEqual(s.learning.gate_keeper.map(x=>x.afterRound),[1,2,3]);
  // This is a synthetic unit test, not remotely observed additional responses.
});

test("the command line only exposes status, never an execution or model-call command",()=>{
  const script=new URL("../scripts/proof/four-rounds.mjs",import.meta.url);
  const out=execFileSync(process.execPath,[script.pathname,"--status"],{encoding:"utf8"});
  const data=JSON.parse(out);
  assert.equal(data.observedGatewayTurns,2);
  assert.equal(data.missingGatewayTurns,6);
  const requests=JSON.parse(execFileSync(process.execPath,[script.pathname,"--reflection-round-1"],{encoding:"utf8"}));
  assert.deepEqual(Object.keys(requests),ARMS);
  assert.equal(requests.baseline.model,MODEL);
  assert.equal(requests.gate_keeper.model,MODEL);
  assert.equal(requests.baseline.systemSha256,requests.gate_keeper.systemSha256);
  assert.notEqual(requests.baseline.userSha256,requests.gate_keeper.userSha256);
  assert.equal(requests.baseline.learningOnly,true);

  assert.throws(()=>execFileSync(process.execPath,[script.pathname,"--prepare-round-2"],{encoding:"utf8",stdio:"pipe"}),/Command failed/);
  assert.throws(()=>execFileSync(process.execPath,[script.pathname,"--run"],{encoding:"utf8",stdio:"pipe"}),/Command failed/);
});

test("Base44 model progression is source-bound and never fills missing rounds with scores",()=>{
  const json=JSON.parse(readFileSync(new URL("../integrations/base44/data/deepseekFourRoundProgress.json",import.meta.url),"utf8"));
  const first=JSON.parse(readFileSync(new URL("../proof/submissions/gk-playground-deepseek-20261102-a/summary.json",import.meta.url),"utf8"));
  const component=readFileSync(new URL("../integrations/base44/components/GateKeeperBenchmark.jsx",import.meta.url),"utf8");
  const p=progress();
  assert.equal(json.studyId,p.studyId);
  assert.equal(json.model,p.model);
  assert.equal(json.channel,p.channel);
  assert.equal(json.status,p.status);
  assert.equal(json.totalReviewTurnsObserved,2);
  assert.equal(json.reviewTurnsMissing,6);
  assert.equal(json.currentGatewayChargeUsd,p.gatewayReportedCostUsd);
  assert.equal(json.agents.length,2);
  assert.ok(json.agents.every(x=>x.observedRounds===1&&x.requiredRounds===4&&x.observedOwnModelLearningCalls===0));
  assert.deepEqual(json.rounds.map(x=>x.fixtureId),TASK_IDS);
  assert.equal(json.rounds[0].baseline.detected,first.arms.baseline.detected_known_issues);
  assert.equal(json.rounds[0].gate_keeper.detected,first.arms.gate_keeper.detected_known_issues);
  assert.equal(json.rounds[0].baseline.gatewayChargeUsd,first.arms.baseline.gateway_reported_cost_usd);
  assert.equal(json.rounds[0].gate_keeper.gatewayChargeUsd,first.arms.gate_keeper.gateway_reported_cost_usd);
  for(const round of json.rounds.slice(1)){
    assert.equal(round.baseline.status,"NOT_RUN");
    assert.equal(round.gate_keeper.status,"NOT_RUN");
    assert.equal(round.baseline.detected,null);
    assert.equal(round.gate_keeper.detected,null);
    assert.equal(round.baseline.gatewayChargeUsd,null);
    assert.equal(round.gate_keeper.gatewayChargeUsd,null);
  }
  assert.equal(json.nativeTrueForgeAgentCompared,false);
  assert.match(component,/DeepSeek four-round study progress/);
  assert.match(component,/Not run/);
  assert.match(component,/different fixture difficulty/i);
  assert.doesNotMatch(component,/sessions\.create|createTurn|fetch\(/);
});
