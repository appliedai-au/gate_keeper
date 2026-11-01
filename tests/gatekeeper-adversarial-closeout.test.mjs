import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {reviewTasks,adjudicateTasks,ADJUDICATOR} from "../scripts/proof/live/review.mjs";
import {parseFindingsWithSeverity,blindTask,aggregateArm} from "../scripts/proof/live/metrics.mjs";
import {armInstructions} from "../scripts/proof/live/config.mjs";

const task = (id) => ({
  id, filename: id+".py", language:"python", context:"public source review",
  code:["def fn(x):","    return x"],
  expected:[{line:1,categories:["bug"],why:"sample test defect",severity:"medium"}],
  holdout:false,
});
const reply = '{"findings":[{"line":1,"category":"bug","severity":"medium","comment":"Example concrete failure"}]}';

test("Gate Keeper agent rejects untrusted source instructions and ungrounded subsidiary claims",()=>{
  const a=armInstructions("baseline"), g=armInstructions("gate_keeper");
  assert.match(g,/untrusted review data/i);
  assert.match(g,/false subsidiary explanation/i);
  assert.match(g,/review-checklist/i);
  assert.match(g,/runtime semantics/i);
  assert.ok(!/Gate Keeper/.test(a),"baseline stays the plain reviewer");
  assert.match(ADJUDICATOR,/incorrect subsidiary claim/i);
});

test("candidate session isolation prevents cross-task and cross-arm contamination",async()=>{
  const specs=[], turns=[], exclusions=[];
  const result=await reviewTasks({
    tasks:[task("p1"),task("p2")],arms:["baseline","gate_keeper"],
    instructionsFor:armInstructions,trials:2,phase:"comparison",
    model:"truefoundry/deepseek-v4-flash-0731",limitations:exclusions,
    newSession:async(spec,meta)=>{const id="candidate-"+(specs.length+1);specs.push({id,...meta,spec});return id;},
    callTurn:async(phase,label,sessionId,prompt)=>{
      turns.push({phase,label,sessionId,prompt});
      return {status:"done",text:reply,latency_ms:1,metrics:{totalTokens:10},turnId:"turn-"+turns.length};
    },
  });
  assert.equal(result.completeTrials.length,2);
  assert.equal(result.results.length,8);
  assert.equal(specs.length,8);
  assert.equal(new Set(result.results.map(x=>x.session_id)).size,8,"no candidate session may see another fixture");
  assert.ok(specs.every(s=>["p1","p2"].includes(s.task_id)));
  for(const id of ["p1","p2"]){
    const rows=result.results.filter(r=>r.task.id===id);
    assert.equal(rows.length,4);
    assert.equal(new Set(rows.map(r=>r.session_id)).size,4,"trials and arms must remain isolated");
  }
  assert.equal(exclusions.length,0);
});

test("adjudicator keys cannot contaminate the next task",async()=>{
  const sessions=[], traces=[];
  const tasks=[task("p1"),task("p2")];
  const scored=tasks.map((t)=>({arm:"baseline",trial:1,task:t,findings:[{
    line:1,category:"bug",severity:"medium",comment:"Real defect with an incorrect extra assertion"
  }]}));
  const result=await adjudicateTasks({
    tasks,scored,phase:"adjudication",model:"truefoundry/x",
    newSession:async(spec,meta)=>{
      const id="grader-"+(sessions.length+1);
      sessions.push({id,meta});return id;
    },
    callTurn:async(phase,label,id,prompt)=>{
      traces.push({id,prompt});
      const matches=[...prompt.matchAll(/"id": "(f_[a-f0-9]+)"/g)].map(x=>x[1]);
      assert.equal(matches.length,1);
      return {text:JSON.stringify({judgements:matches.map(k=>({
        id:k,matches:"E1",real_defect:true,explanation_correct:false,
      }))})};
    },
    ev:{put:()=>{}},
  });
  assert.equal(sessions.length,2);
  assert.deepEqual(sessions.map(x=>x.meta.task_id),["p1","p2"]);
  assert.equal(new Set(traces.map(x=>x.id)).size,2);
  assert.equal(Object.keys(result.judgements).length,2);
});

test("invalid findings cannot be silently discarded to inflate precision",()=>{
  const parse = obj=>parseFindingsWithSeverity(JSON.stringify(obj));
  const good={line:7,category:"bug",severity:"high",comment:"Root cause shown in this file"};
  assert.deepEqual(parse({findings:[good]}),[good]);
  for(const bad of [null,{}, {line:7,category:"bug",severity:"high"},
    {line:"7",category:"bug",severity:"high",comment:"Unsupported"},
    {...good,severity:"unknown"}, {...good,comment:""},
    {...good,line:1.5},{...good,line:-4},{...good,comment:"x".repeat(1201)}]){
    assert.equal(parse({findings:[good,bad]}),null,JSON.stringify(bad)?.slice(0,100));
  }
  assert.deepEqual(parse({findings:[]}),[]);
});

test("wrong subsidiary claims lose explanation-validated precision, even when the defect is found",()=>{
  const t=task("t1");
  const row={arm:"gate_keeper",trial:1,task:t,
    findings:[{line:1,category:"bug",severity:"medium",comment:"Correct location; false side-effect claim"}],
    latency_ms:5,metrics:{totalTokens:10}};
  const {key}=blindTask(t.id,[row]);
  const id=Object.keys(key)[0];
  const adjudicated=aggregateArm("gate_keeper",[row],
    {[id]:{matches:"E1",real_defect:true,explanation_correct:false}},key);
  assert.equal(adjudicated.matched_issues,1);
  assert.equal(adjudicated.precision,1,"location-level precision is not semantic proof");
  assert.equal(adjudicated.explanation_correctness,0);
  assert.equal(adjudicated.explanation_validated_precision,0);
  assert.equal(adjudicated.unsupported_explanations,1);
  assert.equal(adjudicated.adjudication_complete,true);
  const incomplete=aggregateArm("gate_keeper",[row],{},key);
  assert.equal(incomplete.unjudged_findings,1);
  assert.equal(incomplete.precision,null);
  assert.equal(incomplete.defect_recall,null);
  assert.equal(incomplete.adjudication_complete,false);
});

test("the Evidence view must remount so limitations cannot remain collapsed from Runs",()=>{
  const source=readFileSync(new URL("../integrations/base44/pages/GateKeeper.jsx",import.meta.url),"utf8");
  assert.ok(source.includes("GateKeeperBenchmark key={page} section={page}"));
});
