// Gate Keeper: deterministic policy for isolated repair execution and lessons.
// No model, filesystem, network or production write authority is granted here.
export const REVIEW_DEPTHS = Object.freeze(["quick", "standard", "deep"]);
export const EXECUTION_STATES = Object.freeze([
  "queued", "reviewing", "repairing", "testing", "polling", "kept", "reverted",
  "held_budget", "held_approval", "held_security", "failed",
]);
const MAX_USD=100;
function money(n,label) {
  if (typeof n!=="number" || !Number.isFinite(n) || n<0 || n>MAX_USD)
    throw new Error("INVALID_"+label.toUpperCase());
  return Math.round(n*100);
}
export function budgetAdmission({estimateUsd,remainingUsd,perRunUsd,lease,now=Date.now()}) {
  const cost=money(estimateUsd,"estimate");
  const remaining=money(remainingUsd,"remaining");
  const ceiling=money(perRunUsd,"per_run");
  if (!lease || lease.independent!==true || lease.signatureVerified!==true ||
      !lease.runId || !lease.tenantId || !lease.expiresAt ||
      Date.parse(lease.expiresAt)<=now || lease.maxCalls<1)
    return {admitted:false,reason:"INDEPENDENT_LEASE_REQUIRED"};
  const leaseCeiling=money(lease.maxUsd,"lease_cap");
  if(cost>remaining || cost>ceiling || cost>leaseCeiling)
    return {admitted:false,reason:"BUDGET_CAP_EXCEEDED"};
  return {admitted:true,authorizedCents:Math.min(cost,remaining,ceiling,leaseCeiling),calls:lease.maxCalls};
}
export function executionAdmission(input){
  if(input?.mode!=="sandbox") return {admitted:false,reason:"ISOLATION_REQUIRED"};
  if(input.readOnlyReview!==true) return {admitted:false,reason:"REVIEW_NOT_VERIFIED"};
  if(input.tenantScoped!==true || input.repairScopeApproved!==true)
    return {admitted:false,reason:"SCOPE_NOT_AUTHORIZED"};
  if(input.repositoryPinned!==true || input.branchProtected!==true)
    return {admitted:false,reason:"SOURCE_BOUNDARY_REQUIRED"};
  if(input.pollingEnabled!==true || input.autoRevertEnabled!==true)
    return {admitted:false,reason:"RECOVERY_GUARD_REQUIRED"};
  if(input.noHumanInLoop!==true && input.humanApproved!==true)
    return {admitted:false,reason:"HUMAN_APPROVAL_REQUIRED"};
  if(input.noHumanInLoop===true && input.ownerApprovedAutonomy!==true)
    return {admitted:false,reason:"AUTONOMOUS_MODE_NOT_ALLOWED"};
  return {admitted:true};
}
const TERMINAL = new Set(["kept","reverted","held_budget","held_security","failed"]);
export function nextExecutionState(state,event){
  if(TERMINAL.has(state)) throw new Error("TERMINAL_JOB");
  const transitions = {
    queued:{start:"reviewing",deny:"held_security"},
    reviewing:{finding:"repairing",deny:"held_security"},
    repairing:{patch:"testing",failure:"reverted"},
    testing:{pass:"polling",failure:"reverted"},
    polling:{stable:"kept",failure:"reverted"},
    held_approval:{approve:"repairing",deny:"held_security"},
  };
  const next=transitions[state]?.[event];
  if(!next) throw new Error("ILLEGAL_TRANSITION");
  return next;
}
// A core lesson is never copied from user content verbatim. The extracted,
// generalisable candidate must be separately consented, scrubbed and verified.
export function assessLessonForCore(lesson, policy={}) {
  const reasons=[];
  if(!lesson || typeof lesson!=="object") return {selected:false,reasons:["INVALID_LESSON"]};
  if(lesson.scope!=="user" || !lesson.tenantId) reasons.push("NOT_USER_SCOPED");
  if(lesson.userConsent!==true) reasons.push("CONSENT_REQUIRED");
  if(lesson.containsSecrets===true || lesson.containsPersonalData===true ||
     lesson.containsProprietaryCode===true) reasons.push("SENSITIVE_CONTENT");
  if(lesson.anonymized!==true) reasons.push("ANONYMIZATION_REQUIRED");
  if(!Array.isArray(lesson.evidenceIds) || lesson.evidenceIds.length<2)
    reasons.push("INSUFFICIENT_EVIDENCE");
  if(!Number.isInteger(lesson.verifiedSuccesses) || lesson.verifiedSuccesses<3)
    reasons.push("SUCCESS_PROOF_REQUIRED");
  if(!Number.isInteger(lesson.independentTenants) || lesson.independentTenants<2)
    reasons.push("CROSS_TENANT_GENERALITY_REQUIRED");
  if(lesson.regressions!==0) reasons.push("REGRESSION_OR_UNKNOWN");
  if(lesson.independentHoldoutPassed!==true) reasons.push("HOLDOUT_REQUIRED");
  if(lesson.adversarialSecurityPassed!==true) reasons.push("SECURITY_REVIEW_REQUIRED");
  if(lesson.signedVerifierPassed!==true) reasons.push("VERIFIER_SIGNATURE_REQUIRED");
  if(lesson.expectedSourceBound!==true) reasons.push("SOURCE_BINDING_REQUIRED");
  if(policy.ownerAllowsCoreCandidates!==true) reasons.push("CORE_POLICY_DISABLED");
  return {selected:reasons.length===0,status:reasons.length?"held":"qualified_candidate",reasons};
}
export function selectCoreCandidates(lessons,policy={}) {
  if(!Array.isArray(lessons))throw new Error("INVALID_LESSONS");
  return lessons.map(lesson=>({id:lesson?.id||null,...assessLessonForCore(lesson,policy)}));
}
// Promotion is deliberately separate from selection. This refuses unsigned
// promotion even when a user has ticked "no human in the loop" for repairs.
export function corePromotionAdmission({selection,approval,evidence}) {
  if(!selection?.selected)return {permitted:false,reason:"NOT_QUALIFIED"};
  if(!evidence?.sealed || !evidence?.independent || !evidence?.signatureVerified)
    return {permitted:false,reason:"INDEPENDENT_EVIDENCE_REQUIRED"};
  if(!approval?.coreOwnerApproved || !approval?.reviewedCommit)
    return {permitted:false,reason:"CORE_OWNER_REVIEW_REQUIRED"};
  return {permitted:true};
}
