/**
 * Four-round DeepSeek study protocol. This is a non-billable, source-only
 * preparation and results ledger. It cannot call TrueFoundry or other LLMs.
 *
 * One actual Playground review has been observed per arm. Further passes
 * require separately recorded same-model self-reflection and fresh gateway
 * traces. A prompt-learning proxy is NOT a native TrueForge agent proof.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { armInstructions, OUTPUT_CONTRACT, sha256 } from "./live/config.mjs";

export const MODEL = "tfy-managed/deepseek-v4-flash-0731";
export const ARMS = Object.freeze(["baseline", "gate_keeper"]);
export const TASK_IDS = Object.freeze([
  "01-python-utils", "02-express-users", "03-python-deploy", "04-ts-fetch",
]);
export const PARAMETERS = Object.freeze({ temperature: 0, maxOutputTokens: 2500 });
export const PRIOR_PROOF = "gk-playground-deepseek-20261102-a";
export const CHANNEL = "TrueFoundry Playground";
export const STATUS = "INCOMPLETE_EXPLORATORY_PROMPT_LEARNING";
const fail = (why) => { throw Error("FOUR_ROUND_REJECTED: " + why); };
const hex64 = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const here = fileURLToPath(import.meta.url);
const priorPath = new URL("../../proof/submissions/gk-playground-deepseek-20261102-a/summary.json", import.meta.url);

export function fixtureForRound(n) {
  if (!Number.isInteger(n) || n < 1 || n > 4) fail("ROUND_OUT_OF_BOUNDS");
  const path = new URL("../../evals/tasks/" + TASK_IDS[n - 1] + ".json", import.meta.url);
  const t = JSON.parse(readFileSync(path, "utf8"));
  if (t.id !== TASK_IDS[n - 1] || t.holdout !== false ||
      !Array.isArray(t.code) || !Array.isArray(t.expected) || t.expected.length !== 3)
    fail("FROZEN_PUBLIC_FIXTURE_INVALID");
  return t;
}

function publicTaskPrompt(t) {
  const width = String(t.code.length).length;
  return [
    "Review this change. File: " + t.filename + ". What the change does: " + t.context,
    "", "Line numbers are on the left of the |.", "", 
    t.language + " source:",
    ...t.code.map((line, i) => String(i + 1).padStart(width) + " | " + line),
  ].join("\n");
}

function publicArmResult(r, arm) {
  if (!r || r.detected_known_issues < 0 || r.detected_known_issues > 3 ||
      !Number.isFinite(r.gateway_reported_cost_usd) || r.gateway_reported_cost_usd < 0 ||
      !Number.isInteger(r.reported_findings) || !/^[a-f0-9]{12}$/.test(r.span_suffix))
    fail("HISTORICAL_RESULT_UNVERIFIED");
  return {
    status: "OBSERVED_PLAYGROUND",
    arm, model: MODEL, fixtureId: TASK_IDS[0], round: 1, method: r.method,
    detectedKnownIssues: r.detected_known_issues, expectedKnownIssues: 3,
    reportedFindings: r.reported_findings,
    gatewayReportedCostUsd: r.gateway_reported_cost_usd,
    approximateTotalTokens: r.reported_total_tokens_approx,
    gatewayLatencyMs: r.gateway_latency_ms,
    traceIdSuffix: r.span_suffix,
    unsupportedSubclaims: (r.unsupported_subclaims || []).length,
    sourceProof: PRIOR_PROOF,
    // Historical Playground prompts were not byte-escrowed; do not retrofit a
    // prompt hash or claim a native TrueForge agent ran them.
    instructionHash: null, nativeTrueForgeExecution: false,
    selfLearningTurnObserved: false,
  };
}

export function initialStudy() {
  const prior = JSON.parse(readFileSync(priorPath, "utf8"));
  if (prior.run_id !== PRIOR_PROOF || prior.result !== "INCONCLUSIVE" ||
      prior.execution.upstream_provider + "/" + prior.execution.model !== MODEL ||
      prior.execution.trueforge_sdk_executed !== false ||
      prior.execution.gateway_request_count !== 2 ||
      prior.execution.effective_max_output_tokens !== PARAMETERS.maxOutputTokens)
    fail("SOURCE_PROOF_MISMATCH");
  const observed = {
    baseline: publicArmResult(prior.arms.baseline, "baseline"),
    gate_keeper: publicArmResult(prior.arms.gate_keeper, "gate_keeper"),
  };
  return {
    schema: "gate-keeper-four-round-progress-v1",
    studyId: "gk-deepseek-four-round-20261102",
    sourceProof: PRIOR_PROOF, sourceCommit: prior.source.commit,
    channel: CHANNEL, model: MODEL,
    conclusion: STATUS, qualification: "NOT_QUALIFIED",
    design: "4 successive public fixtures per arm, independent same-model feedback and private lesson history",
    nativeTrueForgeExecutionVerified: false,
    rounds: TASK_IDS.map((id, index) => ({
      round: index + 1, fixtureId: id, expectedKnownIssuesPerArm: 3,
      arms: index === 0 ? observed : { baseline: null, gate_keeper: null },
    })),
    learning: { baseline: [], gate_keeper: [] },
    limitations: [
      "Only Round 1 on TrueFoundry Playground has been observed, not native TrueForge.",
      "No individual agent self-learning turns or lessons have been verified yet.",
      "Future public fixtures differ in difficulty; sequential recall is exploratory, not causal proof of learning.",
      "No sponsor-credit deduction or balance is independently attested.",
    ],
  };
}

export function progress(study = initialStudy()) {
  if (study.model !== MODEL || !Array.isArray(study.rounds) || study.rounds.length !== 4)
    fail("STUDY_SHAPE_INVALID");
  const byArm = Object.fromEntries(ARMS.map((arm) => {
    const completed = study.rounds.filter((r) =>
      r.arms?.[arm]?.status === "OBSERVED_PLAYGROUND").length;
    return [arm, { observed: completed, total: 4, missing: 4 - completed }];
  }));
  const observedGatewayTurns = ARMS.reduce((s, arm) => s + byArm[arm].observed, 0);
  const charges = study.rounds.flatMap((r) =>
    ARMS.map((a) => r.arms?.[a]).filter(Boolean)).reduce(
      (sum, x) => sum + x.gatewayReportedCostUsd, 0);
  return {
    studyId: study.studyId, model: study.model, channel: study.channel,
    status: observedGatewayTurns === 8 ? "FOUR_ROUNDS_OBSERVED_NOT_QUALIFIED" : STATUS,
    byArm, observedGatewayTurns, requiredGatewayTurns: 8,
    missingGatewayTurns: 8 - observedGatewayTurns,
    gatewayReportedCostUsd: Number(charges.toFixed(12)),
    nativeTrueForgeExecutionVerified: false,
    learningQualified: false,
  };
}

/**
 * A separate, identical self-reflection contract for BOTH methods, run only
 * after the prior review was independently checked. Uses the reviewer's OWN
 * prior evidence and no next-task source or key. Produces a candidate lesson,
 * not a certified automated learning event.
 *
 * For round 1, historical public output is only a sanitised excerpt; this
 * limitation is carried into the request so it is never called a raw trace.
 * For later rounds the raw reply must be provided privately and checked by
 * SHA-256 against the stored gateway response digest before creating a prompt.
 */
export function prepareSelfReflection(study, n, arm, {
  ownReviewText = null, ownPriorAdjudication = null,
} = {}) {
  if (!ARMS.includes(arm) || !Number.isInteger(n) || n < 1 || n > 3)
    fail("SELF_REFLECTION_SCOPE_INVALID");
  if (study.model !== MODEL || study.channel !== CHANNEL) fail("MODEL_OR_STUDY_MISMATCH");
  const record = study.rounds[n - 1]?.arms?.[arm];
  if (!record || record.status !== "OBSERVED_PLAYGROUND")
    fail("NO_PRIOR_REVIEW_TO_LEARN_FROM");
  let priorText, critique, provenance;
  if (n === 1) {
    const source = JSON.parse(readFileSync(priorPath, "utf8"));
    priorText = JSON.stringify(source.arms[arm].model_answer);
    critique = arm === "baseline"
      ? "Independent previous-round scoring: one error-handling defect was missed; one matched finding's severity was rated too high."
      : "Independent previous-round fact check: a subsidiary claim about the behavior of a zero step in Python range was incorrect.";
    provenance = "sanitised historical answer excerpt plus publicly documented previous-round critique";
  } else {
    if (typeof ownReviewText !== "string" || !ownReviewText.trim() ||
        !hex64(record.rawOutputSha256) ||
        sha256(ownReviewText) !== record.rawOutputSha256 ||
        typeof ownPriorAdjudication !== "string" ||
        !ownPriorAdjudication.trim() || ownPriorAdjudication.length > 500)
      fail("PRIVATE_PRIOR_REPLY_AND_ADJUDICATION_REQUIRED");
    priorText = ownReviewText;
    critique = ownPriorAdjudication;
    provenance = "private digest-matched previous-round reply and independent previous-round critique";
  }
  const sys = [
    "You are reviewing only your OWN previous code-review result.",
    "Produce exactly one general review principle of at most 40 words that",
    "could improve your next review. Do not reproduce code, file names,",
    "secrets, example answers, expected line numbers, or later fixtures.",
    "Return exactly one JSON object: {\"lesson\":\"...\"}.",
    "Do not discuss the other reviewer, speculate about other model outputs,",
    "or claim any tests passed.",
  ].join(" ");
  const usr = [
    "Previous round: " + n,
    "Own review method: " + arm,
    "Own prior answer: " + priorText,
    "Prior round feedback only: " + critique,
    "Write one transferable principle, not a code patch.",
  ].join("\n\n");
  return {
    arm, afterRound: n, model: MODEL, channel: CHANNEL,
    parameters: { temperature: 0, maxOutputTokens: 180 },
    provenance, systemPrompt: sys, userPrompt: usr,
    systemSha256: sha256(sys), userSha256: sha256(usr),
    noTools: true, noAutoRetry: true, learningOnly: true,
  };
}

function requireOwnFeedback(feedback, arm, prior, n) {
  // Feedback must be created by a separate call to the same LLM for the same
  // arm AFTER review n, then reviewed by an external evaluator. Never import
  // the other arm's feedback, answer keys or later fixtures.
  if (!feedback || feedback.arm !== arm || feedback.afterRound !== n ||
      feedback.sourceProof !== prior.sourceProof ||
      feedback.priorTraceIdSuffix !== prior.traceIdSuffix ||
      feedback.model !== MODEL ||
      feedback.origin !== "same_model_self_reflection" ||
      feedback.evaluatorChecked !== true ||
      typeof feedback.learningTurnId !== "string" || !feedback.learningTurnId ||
      typeof feedback.lesson !== "string" || !feedback.lesson.trim())
    fail("INDEPENDENT_OWN_FEEDBACK_REQUIRED:" + arm);
  const wordCount = feedback.lesson.trim().split(/\s+/).length;
  if (wordCount > 40 || feedback.lesson.length > 280 ||
      /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(feedback.lesson))
    fail("LESSON_UNBOUNDED:" + arm);
  return {
    lesson: feedback.lesson.trim(),
    sha256: sha256(feedback.lesson.trim()),
    traceRef: feedback.learningTurnId,
  };
}

function appendLearning(arm, ownLessons) {
  const base = armInstructions(arm);
  if (!base.endsWith(OUTPUT_CONTRACT)) fail("REVIEW_OUTPUT_CONTRACT_DRIFT");
  const prefix = base.slice(0, -OUTPUT_CONTRACT.length);
  const feedback = ownLessons.length ?
    "## Previously learned review principles (from this reviewer only)\n" +
      ownLessons.map((x) => "- " + x.lesson).join("\n") + "\n\n" : "";
  return prefix + feedback + OUTPUT_CONTRACT;
}

/**
 * Prepare both review turns for a numbered round, without making an API call.
 * Input feedback includes both arms, but prompts only receive their OWN
 * reviewer's lessons. Incomplete prior rounds cannot be skipped.
 */
export function prepareRound(study, n, feedbackByArm) {
  if (n < 2 || n > 4 || !Number.isInteger(n)) fail("NEXT_ROUND_OUT_OF_BOUNDS");
  if (study.channel !== CHANNEL || study.model !== MODEL ||
      study.rounds?.[n - 1]?.fixtureId !== TASK_IDS[n - 1])
    fail("MODEL_OR_STUDY_MISMATCH");
  if (!feedbackByArm || typeof feedbackByArm !== "object") fail("OWN_FEEDBACK_MISSING");
  const t = fixtureForRound(n);
  const prompt = publicTaskPrompt(t);
  const bundle = {};
  for (const arm of ARMS) {
    const previous = study.rounds[n - 2]?.arms?.[arm];
    if (previous?.status !== "OBSERVED_PLAYGROUND" ||
        study.rounds[n - 1].arms?.[arm] !== null)
      fail("PREVIOUS_ROUND_INCOMPLETE_OR_DUPLICATE:" + arm);
    // Every prior round requires its own post-review self-reflection record.
    const allFeedback = [...(study.learning[arm] || []), feedbackByArm[arm]];
    if (allFeedback.length !== n - 1) fail("LEARNING_HISTORY_LENGTH_INVALID:" + arm);
    const accepted = allFeedback.map((item, i) =>
      requireOwnFeedback(item, arm, study.rounds[i].arms[arm], i + 1));
    const sys = appendLearning(arm, accepted);
    bundle[arm] = {
      arm, round: n, model: MODEL, fixtureId: t.id,
      parameters: { ...PARAMETERS }, channel: CHANNEL,
      systemPrompt: sys, userPrompt: prompt,
      lessonSha256: accepted.map((x) => x.sha256),
      systemSha256: sha256(sys), userSha256: sha256(prompt),
      expectedTotalCalls: 2, noRetry: true, noTools: true,
      // No expected answers or future task data in prompt payload.
      // Full fixture 'expected' is never returned.
    };
  }
  if (bundle.baseline.userPrompt !== bundle.gate_keeper.userPrompt ||
      bundle.baseline.model !== bundle.gate_keeper.model ||
      JSON.stringify(bundle.baseline.parameters) !== JSON.stringify(bundle.gate_keeper.parameters))
    fail("PAIRED_PROMPT_DRIFT");
  return bundle;
}

/**
 * For imports from actual gateway traces only. Enforce one irreversible pair
 * per fixture and preserve exact source and model provenance. The caller
 * stores raw output privately; we do not fabricate traces or issue tokens.
 */
export function recordObservedPair(study, n, bundle, observed, feedbackByArm) {
  if (n < 2 || n > 4) fail("ROUND_OUT_OF_BOUNDS");
  const expected = prepareRound(study, n, feedbackByArm);
  if (!bundle || !observed || typeof observed !== "object")
    fail("GATEWAY_EVIDENCE_MISSING");
  const ids = new Set();
  const records = {};
  for (const arm of ARMS) {
    const input = bundle[arm], item = observed[arm];
    if (!input || input.systemSha256 !== expected[arm].systemSha256 ||
        input.userSha256 !== expected[arm].userSha256 ||
        !item || item.model !== MODEL || item.fixtureId !== TASK_IDS[n - 1] ||
        item.temperature !== PARAMETERS.temperature ||
        item.maxOutputTokens !== PARAMETERS.maxOutputTokens ||
        item.provider !== "tfy-managed" ||
        typeof item.gatewayTraceRef !== "string" || !item.gatewayTraceRef ||
        ids.has(item.gatewayTraceRef) ||
        !hex64(item.rawOutputSha256) ||
        !Number.isInteger(item.found) || item.found < 0 || item.found > 3 ||
        !Number.isFinite(item.gatewayReportedCostUsd) || item.gatewayReportedCostUsd < 0)
      fail("NEW_GATEWAY_TRACE_NOT_CORRELATED:" + arm);
    ids.add(item.gatewayTraceRef);
    records[arm] = {
      status: "OBSERVED_PLAYGROUND", arm, model: MODEL,
      fixtureId: TASK_IDS[n - 1], round: n, method: arm,
      detectedKnownIssues: item.found, expectedKnownIssues: 3,
      gatewayReportedCostUsd: item.gatewayReportedCostUsd,
      traceIdSuffix: item.gatewayTraceRef.slice(-12),
      rawOutputSha256: item.rawOutputSha256,
      sourceProof: study.studyId,
      instructionHash: input.systemSha256,
      nativeTrueForgeExecution: false,
      selfLearningTurnObserved: true,
    };
  }
  const updated = structuredClone(study);
  updated.rounds[n - 1].arms = records;
  for (const arm of ARMS) updated.learning[arm].push(feedbackByArm[arm]);
  return updated;
}

if (process.argv[1] && resolve(process.argv[1]) === here) {
  const arg = process.argv[2] || "--status";
  try {
    if (arg === "--status") console.log(JSON.stringify(progress(), null, 2));
    else if (arg === "--prepare-round-2") {
      // This MUST hold until both same-model self-reflection calls have
      // actually produced independently checked, distinct feedback evidence.
      prepareRound(initialStudy(), 2, {});
    } else fail("UNSUPPORTED_COMMAND");
  } catch (e) {
    console.error(String(e?.message || e).slice(0, 160));
    process.exitCode = 3;
  }
}