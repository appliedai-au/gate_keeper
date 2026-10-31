import test from "node:test";
import assert from "node:assert/strict";
import {validatePublicProof,REQUIRED_STAGES} from "../scripts/proof/validate-public-proof.mjs";
import {readFileSync} from "node:fs";

const H="a".repeat(64),SHA="b".repeat(40);
const emptyMeasures=()=>({
 trials:0,defect_recall:null,precision:null,explanation_correctness:null,
 severity_accuracy:null,median_latency_ms:null,total_tokens:null,actual_cost_usd:null,
});
function sample(){
 return {
  schema:"gate-keeper-public-proof-v1",
  run_id:"qual-example-001",
  submitted_at:"2026-11-01T01:00:00Z",
  result:"BLOCKED",
  source:{repository:"appliedai-au/gate_keeper",gate_keeper_commit:SHA,
   baseline_instructions_sha256:H,gate_keeper_instructions_sha256:H,scorer_sha256:H},
  environment:{trueforge_version:"version-undetermined",model_id:"not-available",
   provider:"unknown",sandbox_provider:"not-connected"},
  benchmark:{id:"frozen-source-fixture",sha256:H,holdout_private:true},
  fairness:{same_model:true,same_provider:true,same_inputs:true,same_scoring:true,same_limits:true},
  arms:{baseline:emptyMeasures(),gate_keeper:emptyMeasures()},
  loop:Object.fromEntries(REQUIRED_STAGES.map(s=>[s,"BLOCKED"])),
  evidence:[],
  blockers:["Model and sandbox availability not verified"],
  limitations:["This is a unit-test fixture; it is not proof of a real run."],
 };
}
function passable(){
 const v=sample();v.result="PASS";v.blockers=[];
 const measures={trials:2,defect_recall:0.5,precision:0.8,explanation_correctness:0.7,
  severity_accuracy:0.7,median_latency_ms:1200,total_tokens:800,actual_cost_usd:0.15};
 v.arms.baseline={...measures};v.arms.gate_keeper={...measures,defect_recall:0.65};
 v.loop=Object.fromEntries(REQUIRED_STAGES.map(s=>[s,"PASS"]));
 v.verifier={independent:true,receipt_sha256:H,private_reference:"private://qualification/receipt"};
 return v;
}
const rejected=(update,regex=/PUBLIC_PROOF_INVALID/)=>{
 const data=update(sample());
 assert.throws(()=>validatePublicProof(data),regex);
};
test("blockers may be reported openly without fabricating successful results",()=>{
 const r=validatePublicProof(sample());
 assert.equal(r.valid,true);
 assert.equal(r.result,"BLOCKED");
 assert.equal(r.verifierAuthenticated,false);
});
test("PASS structure demands both arms, complete loop and independent receipt",()=>{
 const valid=validatePublicProof(passable());
 assert.equal(valid.result,"PASS");
 assert.equal(valid.verifierAuthenticated,false,"schema checks cannot authenticate a signature");
 const p=passable();p.arms.baseline.trials=0;assert.throws(()=>validatePublicProof(p));
 const q=passable();delete q.verifier;assert.throws(()=>validatePublicProof(q));
 const s=passable();s.loop.polling="NOT_RUN";assert.throws(()=>validatePublicProof(s));
 const t=passable();t.blockers=["gateway unavailable"];assert.throws(()=>validatePublicProof(t));
});
test("proof summary cannot omit or rename the learning loop stages",()=>{
 for(const stage of REQUIRED_STAGES){
  rejected(d=>{delete d.loop[stage];return d;});
 }
});
test("proof summary requires exact source and benchmark identity",()=>{
 rejected(d=>(d.source.gate_keeper_commit="123",d));
 rejected(d=>(d.source.scorer_sha256="wrong",d));
 rejected(d=>(d.benchmark.sha256="?",d));
 rejected(d=>(d.source.repository="other/other",d));
 rejected(d=>(d.run_id="../../unsafe",d));
});
test("proof rejects made-up measures and token-bearing public evidence references",()=>{
 rejected(d=>(d.arms.baseline.precision=1.2,d));
 rejected(d=>(d.arms.baseline.total_tokens=Number.NaN,d));
 rejected(d=>(d.arms.baseline.trials=0,d.arms.baseline.actual_cost_usd=1,d));
 rejected(d=>(d.evidence=[{kind:"trace",sha256:H,private_reference:"https://example.test/download?token=secret"}],d));
 rejected(d=>(d.evidence=[{kind:"trace",sha256:H,private_reference:"Bearer invalidtoken"}],d));
});
test("proof rejects claims that benchmark comparison was not fair",()=>{
 for(const field of ["same_model","same_provider","same_inputs","same_scoring","same_limits"]){
  rejected(d=>(d.fairness[field]=false,d));
 }
});

test("TrueForge-native instructions retain the entire repair and learning loop",()=>{
 const instructions=readFileSync(new URL("../agent/native-trueforge-instructions.md",import.meta.url),"utf8");
 for(const phrase of ["Scope and budget admission","Review:","Repair:","V-model validation",
   "Poll and challenge again","Re-evaluate:","Capture user lesson","Select core candidates",
   "Independent qualification","Controlled promotion and next cycle"]){
    assert.ok(instructions.includes(phrase),"missing loop step: "+phrase);
 }
 assert.match(instructions,/unseen.*holdouts/i);
 assert.match(instructions,/never use synthetic fixture results as proof/i);
 assert.match(instructions,/No human in the loop/);
 for(const status of ["HELD","REVIEWED","CANDIDATE","REVERTED","QUALIFIED"]){
  assert.match(instructions,new RegExp(status+" \\("),"distinct terminal status "+status+" required");
 }
});
