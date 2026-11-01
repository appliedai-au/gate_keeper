// Strict STRUCTURAL validation for a PUBLIC proof summary. This is not an
// independent verifier and does not authenticate costs, signatures or metrics.
// It prevents incomplete/ambiguous claims from entering proof submissions.
import {readFileSync} from "node:fs";
import {resolve} from "node:path";
import {fileURLToPath} from "node:url";

const H64=/^[a-f0-9]{64}$/;
const H40=/^[a-f0-9]{40}$/;
const OUTCOME=new Set(["PASS","FAIL","INCONCLUSIVE","BLOCKED"]);
const CHECK=new Set(["PASS","FAIL","BLOCKED","NOT_RUN"]);
const STAGES=["adversarial_review","sandbox_repair","v_model_validation",
  "polling","post_repair_review","rollback_failure_drill",
  "user_lesson_capture","core_candidate_selection","independent_qualification"];
const MEASURES=["defect_recall","precision","explanation_correctness","severity_accuracy",
  "median_latency_ms","total_tokens","actual_cost_usd"];
function fail(reason){throw new Error("PUBLIC_PROOF_INVALID: "+reason);}
const obj=v=>!!v&&typeof v==="object"&&!Array.isArray(v);
const string=v=>typeof v==="string"&&v.trim()!==""&&v.length<=1024;
function digest(v,label){if(!H64.test(v||""))fail(label+" must be SHA-256");}
function sha(v,label){if(!H40.test(v||""))fail(label+" must be full Git SHA");}
function field(v,label){if(!string(v))fail(label+" missing or invalid");}
function validMeasure(name,v){
 if(v===null)return;
 if(typeof v!=="number"||!Number.isFinite(v)||v<0)fail(name+" invalid");
 if(["defect_recall","precision","explanation_correctness","severity_accuracy"].includes(name)&&v>1)
  fail(name+" outside [0,1]");
}
export const REQUIRED_STAGES=Object.freeze([...STAGES]);
export function validatePublicProof(v){
 if(!obj(v)||v.schema!=="gate-keeper-public-proof-v1")fail("unknown schema");
 field(v.run_id,"run_id");
 if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(v.run_id))fail("run_id path unsafe");
 if(!OUTCOME.has(v.result))fail("result must be PASS/FAIL/INCONCLUSIVE/BLOCKED");
 if(!string(v.submitted_at)||!Number.isFinite(Date.parse(v.submitted_at)))fail("submitted_at invalid");
 if(!obj(v.source)||v.source.repository!=="appliedai-au/gate_keeper")fail("source repository mismatch");
 sha(v.source.gate_keeper_commit,"gate_keeper_commit");
 digest(v.source.baseline_instructions_sha256,"baseline_instructions_sha256");
 digest(v.source.gate_keeper_instructions_sha256,"gate_keeper_instructions_sha256");
 digest(v.source.scorer_sha256,"scorer_sha256");
 if(!obj(v.environment))fail("environment missing");
 for(const f of ["trueforge_version","model_id","provider","sandbox_provider"])field(v.environment[f],"environment."+f);
 // A run graded by a grader that is still pending calibration is calibration evidence only.
 if(v.environment.adjudicator_calibration!==undefined&&!["calibrated","pending"].includes(v.environment.adjudicator_calibration))fail("environment.adjudicator_calibration invalid");
 if(v.environment.adjudicator_calibration==="pending"&&v.result==="PASS")fail("a run graded by a pending-calibration grader cannot be a PASS");
 if(!obj(v.benchmark))fail("benchmark missing");
 field(v.benchmark.id,"benchmark.id");digest(v.benchmark.sha256,"benchmark.sha256");
 if(v.benchmark.holdout_private!==true)fail("holdout privacy not attested");
 if(!obj(v.fairness))fail("fairness missing");
 if(!obj(v.arms))fail("arms missing");
 // null ("not applicable: nothing ran") is allowed only for a non-PASS result in
 // which BOTH arms have zero trials. false, or anything for a run that executed,
 // must still be an explicit true.
 const nothingRan=v.result!=="PASS"&&["baseline","gate_keeper"].every(k=>obj(v.arms[k])&&v.arms[k].trials===0);
 for(const f of ["same_model","same_provider","same_inputs","same_scoring","same_limits"]){
  if(v.fairness[f]===true)continue;
  if(v.fairness[f]===null&&nothingRan)continue;
  fail("fairness."+f+(nothingRan?" must be true or null":" must be true"));
 }
 for(const arm of ["baseline","gate_keeper"]){
  const a=v.arms[arm];
  if(!obj(a))fail("arms."+arm+" missing");
  if(!Number.isSafeInteger(a.trials)||a.trials<0)fail("arms."+arm+".trials invalid");
  for(const measure of MEASURES){
   if(!(measure in a))fail("arms."+arm+"."+measure+" missing");
   validMeasure(arm+"."+measure,a[measure]);
  }
  if(a.trials===0 && MEASURES.some(m=>a[m]!==null))fail(arm+" has measured results without trials");
 }
 if(!obj(v.loop))fail("loop must enumerate every step");
 for(const s of STAGES)if(!CHECK.has(v.loop[s]))fail("loop."+s+" missing or invalid");
 if(!Array.isArray(v.evidence)||v.evidence.length>40)fail("evidence must be an array");
 for(const item of v.evidence){
  if(!obj(item))fail("evidence entry invalid");
  for(const key of ["kind","private_reference"])field(item[key],"evidence."+key);
  digest(item.sha256,"evidence.sha256");
  if(/(?:token=|apikey|api_key|password=|secret=|authorization:|Bearer\s)/i.test(item.private_reference))
   fail("evidence reference appears credential-bearing");
  if(/https?:\/\/[^\s]*\?/i.test(item.private_reference))
   fail("evidence reference may not contain query parameters");
 }
 if(!Array.isArray(v.blockers)||v.blockers.length>40||v.blockers.some(x=>!string(x)))
   fail("blockers must be a short array");
 if(!Array.isArray(v.limitations)||v.limitations.length<1||v.limitations.some(x=>!string(x)))
   fail("limitations required");
 // For a PASS claim, every loop stage and both actual independent trials
 // must be present. A detached verifier still MUST authenticate the report.
 if(v.result==="PASS"){
  if(Object.values(v.loop).some(s=>s!=="PASS"))fail("cannot claim PASS with incomplete loop");
  if(v.arms.baseline.trials<1||v.arms.gate_keeper.trials<1)fail("cannot claim PASS without both arms");
  if(MEASURES.some(m=>v.arms.baseline[m]===null||v.arms.gate_keeper[m]===null))
    fail("cannot claim PASS with missing measurements");
  if(!obj(v.verifier)||v.verifier.independent!==true)
    fail("independent verifier reference required");
  digest(v.verifier.receipt_sha256,"verifier.receipt_sha256");
  field(v.verifier.private_reference,"verifier.private_reference");
  if(v.blockers.length)fail("cannot claim PASS with unresolved blockers");
 }
 return {valid:true,result:v.result,run_id:v.run_id,verifierAuthenticated:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)fail("usage: node scripts/proof/validate-public-proof.mjs summary.json");
  const summary=JSON.parse(readFileSync(process.argv[2],"utf8"));
  console.log(JSON.stringify(validatePublicProof(summary)));
 }catch(e){console.error(String(e.message||e));process.exitCode=2;}
}
