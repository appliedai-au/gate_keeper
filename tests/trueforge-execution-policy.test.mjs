import test from "node:test";
import assert from "node:assert/strict";
import {
  budgetAdmission, executionAdmission, nextExecutionState,
  assessLessonForCore, selectCoreCandidates, corePromotionAdmission,
} from "../scripts/execution/policy.mjs";

const NOW=Date.parse("2026-11-01T00:00:00Z");
const lease=()=>({
  independent:true,signatureVerified:true,runId:"run-1",tenantId:"tenant-1",
  expiresAt:"2026-11-02T00:00:00Z",maxCalls:5,maxUsd:5,
});
const budget=(override={})=>({
  estimateUsd:1,remainingUsd:4,perRunUsd:2,lease:lease(),now:NOW,...override,
});
const scope=()=>({
  mode:"sandbox",readOnlyReview:true,tenantScoped:true,
  repairScopeApproved:true,repositoryPinned:true,branchProtected:true,
  pollingEnabled:true,autoRevertEnabled:true,
  noHumanInLoop:false,humanApproved:true,
});
const lesson=()=>({
  id:"candidate-1",scope:"user",tenantId:"tenant-1",
  userConsent:true,containsSecrets:false,
  containsPersonalData:false,containsProprietaryCode:false,
  anonymized:true,evidenceIds:["ev-1","ev-2"],
  verifiedSuccesses:3,independentTenants:2,regressions:0,
  independentHoldoutPassed:true,adversarialSecurityPassed:true,
  signedVerifierPassed:true,expectedSourceBound:true,
});
const policy={ownerAllowsCoreCandidates:true};
const safeEvidence=()=>({sealed:true,independent:true,signatureVerified:true});
const owner=()=>({coreOwnerApproved:true,reviewedCommit:"a".repeat(40)});

test("budget holds bad or missing lease properties, including NaN expiry/call count",()=>{
  for(const next of [
    undefined,{}, { ...lease(), maxCalls:undefined },
    { ...lease(), maxCalls:null }, { ...lease(), maxCalls:0 },
    { ...lease(), maxCalls:1.5 }, { ...lease(), maxCalls:NaN },
    { ...lease(), expiresAt:"not-a-date" }, { ...lease(), expiresAt:"" },
    { ...lease(), expiresAt:"2026-10-31T00:00:00Z" },
    { ...lease(), signatureVerified:"true" },
  ]){
    const admission=budgetAdmission(budget({lease:next}));
    assert.equal(admission.admitted,false,JSON.stringify(next));
    assert.equal(admission.reason,"INDEPENDENT_LEASE_REQUIRED");
  }
});

test("budget admits only within both account and per-run ceilings",()=>{
  assert.deepEqual(budgetAdmission(budget()),{admitted:true,authorizedCents:100,calls:5});
  for(const overrides of [{estimateUsd:3},{remainingUsd:0},{perRunUsd:0.5},
    {lease:{...lease(),maxUsd:0.25}}]){
    assert.equal(budgetAdmission(budget(overrides)).reason,"BUDGET_CAP_EXCEEDED");
  }
});

test("sandbox authorization is explicit and no-human checkbox never widens it",()=>{
  assert.equal(executionAdmission(scope()).admitted,true);
  assert.equal(executionAdmission({...scope(),mode:"production"}).reason,"ISOLATION_REQUIRED");
  assert.equal(executionAdmission({...scope(),tenantScoped:false}).reason,"SCOPE_NOT_AUTHORIZED");
  assert.equal(executionAdmission({...scope(),autoRevertEnabled:false}).reason,"RECOVERY_GUARD_REQUIRED");
  assert.equal(executionAdmission({...scope(),noHumanInLoop:true,humanApproved:false}).reason,"AUTONOMOUS_MODE_NOT_ALLOWED");
  assert.equal(executionAdmission({...scope(),noHumanInLoop:true,humanApproved:false,ownerApprovedAutonomy:true}).admitted,true);
});

test("execution state machine rejects illegal transitions and terminal retries",()=>{
  assert.equal(nextExecutionState("queued","start"),"reviewing");
  assert.equal(nextExecutionState("reviewing","finding"),"repairing");
  assert.equal(nextExecutionState("repairing","patch"),"testing");
  assert.equal(nextExecutionState("testing","pass"),"polling");
  assert.equal(nextExecutionState("polling","failure"),"reverted");
  assert.throws(()=>nextExecutionState("kept","start"),/TERMINAL_JOB/);
  assert.throws(()=>nextExecutionState("queued","stable"),/ILLEGAL_TRANSITION/);
});

test("sensitive or unknown user lesson contents never become core candidates",()=>{
  assert.equal(assessLessonForCore(lesson(),policy).selected,true);
  for(const flag of ["containsSecrets","containsPersonalData","containsProprietaryCode"]){
    const unknown=lesson();delete unknown[flag];
    assert.equal(assessLessonForCore(unknown,policy).selected,false);
    assert.ok(assessLessonForCore(unknown,policy).reasons.includes("SENSITIVE_CONTENT"));
    assert.equal(assessLessonForCore({...lesson(),[flag]:true},policy).selected,false);
  }
  assert.equal(assessLessonForCore({...lesson(),userConsent:false},policy).selected,false);
  assert.equal(assessLessonForCore(lesson(),{}).selected,false);
  assert.equal(selectCoreCandidates([lesson()],policy)[0].status,"qualified_candidate");
});

test("core promotion rejects forged selection, unverified signatures and invalid approvals",()=>{
  const accepted={selection:{id:"candidate-1",selected:true},
    lesson:lesson(),policy,evidence:safeEvidence(),approval:owner()};
  assert.deepEqual(corePromotionAdmission(accepted),{
    permitted:true,controllerVerificationRequired:true
  });
  for(const changed of [
    {selection:{selected:true,id:"different"}},
    {lesson:{...lesson(),containsSecrets:undefined}},
    {evidence:{...safeEvidence(),signatureVerified:"false"}},
    {approval:{...owner(),coreOwnerApproved:1}},
    {approval:{...owner(),reviewedCommit:"not-a-commit"}},
    {selection:{selected:true}},
  ])assert.equal(corePromotionAdmission({...accepted,...changed}).permitted,false);
});
