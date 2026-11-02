/**
 * Native TrueForge 4-round DeepSeek A/B. Not the historical Playground study.
 * 4 matched public hard tasks x 2 agents + 3 separate own-feedback turns each.
 * Default --plan makes no network request. --run requires independent funded
 * gateway receipt, lifetime US$1 Enforce policy and private evidence.
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { armInstructions, OUTPUT_CONTRACT } from "./live/config.mjs";
import { taskPrompt } from "./live/review.mjs";
import { parseFindingsWithSeverity } from "./live/metrics.mjs";
import { BudgetController } from "./live/budget.mjs";
import { assertTrueForgeRoute, requireIsolatedRailway } from "./sponsor-admission.mjs";
import { scoreTask } from "../../evals/score.ts";
import issuerPin from "../../config/gk-sponsor-issuer-pin.json" with { type: "json" };

export const STUDY_ID = "native-deepseek-hard-four-v1";
export const MODEL = "truefoundry/deepseek-v4-flash-0731";
export const UPSTREAM = "tfy-managed/deepseek-v4-flash-0731";
export const ARMS = Object.freeze(["baseline", "gate_keeper"]);
export const REVIEW_TURNS = 8;
export const LEARNING_TURNS = 6;
export const HARD_CAP_USD = 1;
export const REVIEW_MAX_TOKENS = 2500;
export const LESSON_MAX_TOKENS = 400;
const fail = (code) => { throw new Error("NATIVE_FOUR_HELD:" + code); };
const digest = (v) => createHash("sha256").update(v).digest("hex");
const fixturePaths = [
  "../../proof/fixtures/native-hard/01-native-hard-01-ledger.json",
  "../../proof/fixtures/native-hard/02-native-hard-02-webhook.json",
  "../../proof/fixtures/native-hard/03-native-hard-03-export.json",
  "../../proof/fixtures/native-hard/04-native-hard-04-entitlements.json",
];

export function loadHardFixtures() {
  const tasks = fixturePaths.map((p) => JSON.parse(readFileSync(new URL(p, import.meta.url), "utf8")));
  if (tasks.length !== 4 || new Set(tasks.map((t) => t.id)).size !== 4 ||
      tasks.some((t) => t.schema !== "gate-keeper-native-hard-v1" ||
        t.holdout !== false || !Array.isArray(t.code) ||
        !Array.isArray(t.expected) || t.expected.length < 6 ||
        t.expected.length > 8 ||
        t.expected.some((e) => !Number.isInteger(e.line) ||
          e.line < 1 || e.line > t.code.length ||
          !Array.isArray(e.categories) || !e.categories.length)))
    fail("PUBLIC_FIXTURE_SET_INVALID");
  return tasks;
}

export function fixtureDigest(tasks = loadHardFixtures()) {
  return digest(JSON.stringify(tasks.map((t) => ({
    id: t.id, filename: t.filename, context: t.context,
    code: t.code, expected: t.expected,
  }))));
}

export function nativeFourPlan() {
  const tasks = loadHardFixtures();
  return {
    study: STUDY_ID, status: "HELD_UNTIL_INDEPENDENT_SPONSOR_AND_USD1_GATEWAY_BUDGET",
    channel: "Native TrueForge SDK sessions; NOT Playground",
    model: MODEL, upstream: UPSTREAM, isolatedOnly: true,
    rounds: tasks.map((t, i) => ({
      number: i + 1, task: t.id, title: t.title,
      seededDefects: t.expected.length, arms: [...ARMS],
      separateSelfReflectionAfterRound: i < 3,
    })),
    knownDefectsPerArm: tasks.reduce((n, t) => n + t.expected.length, 0),
    reviewTurns: REVIEW_TURNS, reflectionTurns: LEARNING_TURNS,
    maxReviewTokens: REVIEW_MAX_TOKENS, maxReflectionTokens: LESSON_MAX_TOKENS,
    externalGatewayHardCapUsd: HARD_CAP_USD,
    rule: "dedicated VA, Lifetime, Enforce, per-virtual-account",
    noTools: true, noRepair: true, noAutomaticRetry: true,
    fixtureDigestSha256: fixtureDigest(tasks),
    previousPlaygroundTurnsCounted: 0,
    explanationGrading: "independent blinded assessment still required",
    releaseVerdict: "INCONCLUSIVE_UNTIL_VERIFIER_SIGNS",
  };
}

/** This checks only signature/scope; the signer identity and live gateway policy
 * MUST be verified independently before trusting the repository key pin. */
export function verifyNativeFourAdmission({
  receipt, publicKeyPem, pinnedKeySha256, sourceCommit, runId,
  now = Date.now(), tasks = loadHardFixtures(),
} = {}) {
  if (!/^[a-f0-9]{64}$/.test(pinnedKeySha256 || "") ||
      typeof publicKeyPem !== "string" ||
      digest(publicKeyPem) !== pinnedKeySha256)
    fail("TRUSTED_ISSUER_NOT_PINNED");
  if (!/^[a-f0-9]{40}$/.test(sourceCommit || "") ||
      !/^gk-native-deepseek-[a-z0-9-]{8,64}$/.test(runId || ""))
    fail("SOURCE_OR_RUN_ID_INVALID");
  if (!receipt || !receipt.statement ||
      !/^[A-Za-z0-9+/]+={0,2}$/.test(receipt.signature || ""))
    fail("SIGNED_ADMISSION_MISSING");
  let valid = false;
  try {
    const key = createPublicKey(publicKeyPem);
    valid = key.asymmetricKeyType === "ed25519" &&
      verify(null, Buffer.from(JSON.stringify(receipt.statement), "utf8"),
        key, Buffer.from(receipt.signature, "base64"));
  } catch {}
  if (!valid) fail("SIGNED_ADMISSION_INVALID");
  const s = receipt.statement, p = s.gatewayBudget;
  if (s.study !== STUDY_ID || s.runId !== runId ||
      s.sourceCommit !== sourceCommit || s.fixtureDigestSha256 !== fixtureDigest(tasks) ||
      s.tenant !== "stranger-builds" || s.provider !== "tfy-managed" ||
      s.model !== MODEL || s.upstreamModel !== UPSTREAM ||
      s.fundingSource !== "sponsor-inference-credit" ||
      s.personalBillingFallbackDisabled !== true ||
      s.overageDisabled !== true || s.noTools !== true ||
      s.noRepair !== true || s.noAutomaticRetry !== true ||
      s.maxReviewTurns !== REVIEW_TURNS || s.maxLearningTurns !== LEARNING_TURNS ||
      s.maxTurns !== REVIEW_TURNS + LEARNING_TURNS ||
      s.maxReviewTokens !== REVIEW_MAX_TOKENS ||
      s.maxLearningTokens !== LESSON_MAX_TOKENS)
    fail("SIGNED_SCOPE_MISMATCH");
  if (!Number.isFinite(s.issuedAt) || !Number.isFinite(s.expiresAt) ||
      s.issuedAt > now || s.expiresAt <= now ||
      s.expiresAt - s.issuedAt > 86400000 || now - s.issuedAt > 86400000)
    fail("SIGNED_LEASE_EXPIRED");
  if (typeof s.virtualAccountId !== "string" ||
      !/^gate-keeper-smoke-[a-zA-Z0-9-]+$/.test(s.virtualAccountId) ||
      !p || typeof p.ruleId !== "string" || !p.ruleId.trim() ||
      p.subject !== s.virtualAccountId || p.mode !== "Enforce" ||
      p.period !== "Lifetime" || p.scope !== "per-virtual-account" ||
      p.currency !== "USD" || p.limitUsd !== HARD_CAP_USD ||
      !Number.isFinite(p.remainingUsd) || p.remainingUsd <= 0 ||
      p.remainingUsd > p.limitUsd ||
      !Number.isFinite(s.sponsorCreditRemainingUsd) ||
      s.sponsorCreditRemainingUsd < p.remainingUsd)
    fail("DEDICATED_SPONSORED_HARD_BUDGET_UNVERIFIED");
  return Object.freeze({
    runId, sourceCommit, model: MODEL,
    fixtureDigestSha256: fixtureDigest(tasks),
    evidenceSha256: digest(JSON.stringify(receipt.statement)),
    hardCapUsd: p.limitUsd,
  });
}

export function instructionsFor(arm, ownLessons = []) {
  if (!ARMS.includes(arm) || !Array.isArray(ownLessons) ||
      ownLessons.some((x) => typeof x !== "string" ||
        !x.trim() || x.trim().split(/\s+/).length > 40))
    fail("LESSON_SCOPE_INVALID");
  const base = armInstructions(arm);
  if (!base.endsWith(OUTPUT_CONTRACT)) fail("OUTPUT_CONTRACT_CHANGED");
  if (!ownLessons.length) return base;
  return base.slice(0, -OUTPUT_CONTRACT.length) +
    "## Lessons from YOUR OWN earlier completed reviews (not externally qualified)\n" +
    ownLessons.map((x) => "- " + x).join("\n") + "\n\n" + OUTPUT_CONTRACT;
}

export function feedbackFor(task, score) {
  return {
    priorTaskId: task.id, expectedCount: task.expected.length,
    locationMatches: score.caught.length,
    missedDefectsFromOwnPriorReview: score.missed.map((x) => x.why),
    extraFindingLocations: score.noise.map((x) => ({ line: x.line, category: x.category })),
    caveat: "Location grading alone does not validate explanations or subsidiary assertions.",
  };
}
function textOf(output) {
  const c = output?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p && typeof p.text === "string" ? p.text : "").join("");
  return "";
}
export function parseOwnLesson(reply) {
  const x = String(reply || "").trim();
  const start = x.indexOf("{"), end = x.lastIndexOf("}");
  if (start < 0 || end < start || x.length > 1500) fail("SELF_REFLECTION_FORMAT_INVALID");
  let parsed;
  try { parsed = JSON.parse(x.slice(start, end + 1)); }
  catch { fail("SELF_REFLECTION_FORMAT_INVALID"); }
  if (typeof parsed?.lesson !== "string" ||
      !parsed.lesson.trim() ||
      parsed.lesson.trim().split(/\s+/).length > 40 ||
      /(?:BEGIN (?:PRIVATE|OPENSSH)|sk-[a-z0-9]{10,})/i.test(parsed.lesson))
    fail("SELF_REFLECTION_NOT_BOUNDED");
  return parsed.lesson.trim();
}

const REFLECTION_INSTRUCTIONS =
  "You are the SAME native DeepSeek reviewer reflecting only on YOUR own previous output and its independent location-scoring feedback. " +
  "Return one transferable review principle (max 40 words), no future-fixture guesses, no credentials, no other agent's work. " +
  'Return only JSON: {"lesson":"general principle"}';
const CONFIG = {
  askUserQuestions: { enabled: false },
  generativeUi: { enabled: false },
  dynamicSubAgents: { enabled: false },
  iterationLimit: 1,
};
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Injectable TrueForge SDK runner; still enforces the signed admission even
 * when invoked directly. privateWrite and claimOnce MUST be owner-controlled
 * durable create-only operations, never agent-owned storage.
 */
export async function runNativeFour({
  tf, receipt, publicKeyPem, pinnedKeySha256,
  runId, sourceCommit, env, claimOnce, privateWrite,
  now = () => Date.now(), wait = sleep,
} = {}) {
  requireIsolatedRailway(env);
  const tasks = loadHardFixtures();
  const grant = verifyNativeFourAdmission({
    receipt, publicKeyPem, pinnedKeySha256,
    sourceCommit, runId, tasks, now: now(),
  });
  if (!tf?.settings?.modelProviders?.list || !tf?.models?.list ||
      !tf?.sessions?.create || !tf?.sessions?.createTurn ||
      !tf?.sessions?.getTurn || !tf?.sessions?.cancel ||
      typeof claimOnce !== "function" || typeof privateWrite !== "function")
    fail("RUNTIME_OR_DURABLE_PRIVATE_STORAGE_MISSING");

  // Read-only metadata preflight: forbid a similarly named provider, model
  // fallback or another unapproved upstream model.
  const [pr, mr] = await Promise.all([
    tf.settings.modelProviders.list(), tf.models.list(),
  ]);
  assertTrueForgeRoute({ providers: pr.data, models: mr.data, model: MODEL });
  const lock = await claimOnce({
    runId, sourceCommit, evidenceSha256: grant.evidenceSha256,
    fixtureDigestSha256: grant.fixtureDigestSha256, model: MODEL,
  });
  if (lock?.created !== true) fail("DURABLE_ONCE_CLAIM_NOT_PROVED");

  const budget = new BudgetController({
    capUsd: Math.min(HARD_CAP_USD, grant.hardCapUsd),
    phaseShare: { review: 0.8, reflection: 0.2 }, model: MODEL, now,
  });
  const lessons = { baseline: [], gate_keeper: [] };
  const prior = { baseline: null, gate_keeper: null };
  const arms = { baseline: [], gate_keeper: [] };
  const seenSessions = new Set(), seenTurns = new Set();
  let writes = 0;
  const put = async (relative, value) => {
    await privateWrite(relative, value);
    writes++;
  };

  async function nativeTurn({ arm, round, phase, instructions, prompt, maxTokens }) {
    const reservation = budget.reserve(phase, phase + "/" + round + "/" + arm,
      instructions.length + prompt.length, maxTokens, MODEL);
    if (!reservation) fail("LOCAL_BUDGET_REFUSED");
    let sessionId = null, turnId = null;
    try {
      const spec = {
        model: { name: MODEL, params: { temperature: 0, maxTokens } },
        instructions, config: CONFIG, tools: [],
      };
      const created = await tf.sessions.create({
        agent: { spec },
        metadata: { purpose: STUDY_ID, run_id: runId, arm, round: String(round), phase },
      });
      sessionId = created?.data?.id;
      if (!sessionId || seenSessions.has(sessionId)) fail("SESSION_ID_INVALID_OR_REUSED");
      seenSessions.add(sessionId);
      const initial = await tf.sessions.createTurn(sessionId, {
        input: [{ type: "user.message", content: prompt }],
        previousTurnId: "none",
      }, { maxRetries: 0 });
      turnId = initial?.data?.id;
      if (!turnId || seenTurns.has(turnId)) fail("TURN_ID_INVALID_OR_REUSED");
      seenTurns.add(turnId);
      let turn = initial.data;
      for (let i = 0; i < 20; i++) {
        const status = turn?.state?.status;
        if (status === "done") break;
        if (status && !["running", "queued"].includes(status)) fail("MODEL_TURN_NOT_SUCCESSFUL");
        await wait(1500);
        turn = (await tf.sessions.getTurn(sessionId, turnId))?.data;
      }
      if (turn?.state?.status !== "done") fail("MODEL_TURN_DEADLINE");
      const metrics = turn.state.metrics ?? null;
      budget.settle(reservation, metrics);
      const text = textOf(turn.state.output);
      if (!text) fail("EMPTY_MODEL_OUTPUT");
      const record = {
        study: STUDY_ID, runId, sourceCommit, arm, round, phase, model: MODEL,
        instructions, prompt, sessionId, turnId, text, metrics,
        instructionSha256: digest(instructions), promptSha256: digest(prompt),
        localCostSource: budget.ledger.at(-1)?.cost_source ?? null,
      };
      // Persist raw evidence BEFORE scoring or advancing. Never expose in logs.
      await put("private/turns/" + phase + "-" + round + "-" + arm + ".json", record);
      return {
        text, metrics, instructionSha256: record.instructionSha256,
        promptSha256: record.promptSha256,
      };
    } catch {
      if (reservation.open) budget.settle(reservation, null);
      try {
        await put("private/failures/" + phase + "-" + round + "-" + arm + ".json", {
          sourceCommit, model: MODEL, sessionId, turnId,
          reason: "CALL_OR_EVIDENCE_INCOMPLETE; NOT_SAFE_TO_RETRY",
        });
      } catch {}
      fail("NATIVE_TURN_FAILED_OR_PRIVATE_TRACE_UNAVAILABLE_NO_RETRY");
    }
  }

  for (let round = 1; round <= 4; round++) {
    const task = tasks[round - 1];
    // Alternating order guards against a constant first-arm advantage.
    for (const arm of (round % 2 ? ARMS : [...ARMS].reverse())) {
      const instructions = instructionsFor(arm, lessons[arm]);
      const output = await nativeTurn({
        phase: "review", round, arm, instructions,
        prompt: taskPrompt(task), maxTokens: REVIEW_MAX_TOKENS,
      });
      const parsed = parseFindingsWithSeverity(output.text);
      const score = scoreTask(task, output.text);
      prior[arm] = { text: output.text, score, task };
      await put("private/scores/round-" + round + "-" + arm + ".json", {
        runId, sourceCommit, round, arm, task, score, strictOutputParsed: parsed !== null,
        semanticAdjudicationComplete: false,
      });
      arms[arm].push({
        round, taskId: task.id, expected: task.expected.length,
        locationMatches: score.caught.length, missed: score.missed.length,
        unmatchedFindings: score.noise.length, score: score.score,
        strictOutputParsed: parsed !== null,
        instructionSha256: output.instructionSha256,
        promptSha256: output.promptSha256,
        externallyValidatedExplanations: null,
        gatewayBilledCostUsd: null,
      });
    }
    if (round === 4) break;
    for (const arm of [...ARMS].reverse()) {
      const previous = prior[arm];
      const feedback = feedbackFor(previous.task, previous.score);
      const result = await nativeTurn({
        phase: "reflection", round, arm,
        instructions: REFLECTION_INSTRUCTIONS,
        prompt: JSON.stringify({
          ownPreviousReview: previous.text,
          ownPreviousFixtureFeedback: feedback,
          existingOwnLessons: lessons[arm],
        }),
        maxTokens: LESSON_MAX_TOKENS,
      });
      const principle = parseOwnLesson(result.text);
      lessons[arm].push(principle);
      await put("private/lessons/round-" + round + "-" + arm + ".json", {
        arm, round, lesson: principle,
        reflectionPromptSha256: result.promptSha256,
        reflectionInstructionSha256: result.instructionSha256,
        feedback,
        independentlyQualified: false,
      });
    }
  }

  const summary = {
    study: STUDY_ID, runId, sourceCommit, model: MODEL, upstream: UPSTREAM,
    channel: "native-trueforge-sdk",
    result: "INCONCLUSIVE",
    fundingStatus: "SIGNED_LEASE_ADMITTED_NOT_INDEPENDENTLY_RECONCILED",
    elligibility: "public seeded exploratory; NOT unseen holdout proof",
    reviewTurnsObserved: REVIEW_TURNS, reflectionTurnsObserved: LEARNING_TURNS,
    lessonsPerArm: { baseline: lessons.baseline.length, gate_keeper: lessons.gate_keeper.length },
    independentSemanticAdjudication: "NOT_RUN",
    independentlySignedQualification: false,
    gatewayActualBillingUsd: null,
    localBudget: budget.snapshot(),
    arms, separateNativeSessions: seenSessions.size,
    privateEvidenceItemCount: writes + 1,
    warnings: [
      "Prior Playground calls are not part of this study.",
      "Task difficulty varies: raw round-over-round improvement is not causal evidence of learning.",
      "Location matches do not validate factual explanations; blind external adjudication is required.",
      "TrueForge turn estimates are not gateway-billed sponsor credit.",
      "Lessons are model-generated within the native runtime but remain unqualified, private and unpromoted.",
    ],
  };
  await put("private/SUMMARY.json", summary);
  return { ...summary, privateEvidenceItemCount: writes };
}

async function cli() {
  const command = process.argv[2] || "--plan";
  if (command === "--plan") {
    console.log(JSON.stringify(nativeFourPlan(), null, 2));
    return;
  }
  if (command !== "--run") fail("UNKNOWN_COMMAND");
  const env = process.env;
  requireIsolatedRailway(env);
  if (issuerPin.status !== "VERIFIED" ||
      !issuerPin.signerPublicKeySha256 || !issuerPin.issuerVerifiedBy)
    fail("TRUSTED_SPONSOR_SIGNER_NOT_COMMISSIONED");
  const needed = [
    "RAILWAY_GIT_COMMIT_SHA", "GK_NATIVE_FOUR_RUN_ID",
    "GK_NATIVE_FOUR_RECEIPT_FILE", "GK_NATIVE_FOUR_ISSUER_PEM_FILE",
    "TRUEFORGE_TOKEN", "GK_PROOF_EVIDENCE_S3_ENDPOINT",
    "GK_PROOF_EVIDENCE_S3_BUCKET", "GK_PROOF_EVIDENCE_S3_ACCESS_KEY_ID",
    "GK_PROOF_EVIDENCE_S3_SECRET_ACCESS_KEY",
  ];
  if (needed.some((k) => !env[k]) ||
      env.TRUEFORGE_BASE_URL !== "http://trueforge.railway.internal:8080")
    fail("ISOLATED_PRIVATE_RUNTIME_OR_EVIDENCE_PREREQUISITE_MISSING");
  let receipt, publicKeyPem;
  try {
    receipt = JSON.parse(readFileSync(resolve(env.GK_NATIVE_FOUR_RECEIPT_FILE), "utf8"));
    publicKeyPem = readFileSync(resolve(env.GK_NATIVE_FOUR_ISSUER_PEM_FILE), "utf8");
  } catch { fail("PROTECTED_SIGNER_FILES_UNREADABLE"); }

  verifyNativeFourAdmission({
    receipt, publicKeyPem, pinnedKeySha256: issuerPin.signerPublicKeySha256,
    sourceCommit: env.RAILWAY_GIT_COMMIT_SHA, runId: env.GK_NATIVE_FOUR_RUN_ID,
  });
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    endpoint: env.GK_PROOF_EVIDENCE_S3_ENDPOINT,
    region: env.GK_PROOF_EVIDENCE_S3_REGION || "auto",
    forcePathStyle: env.GK_PROOF_EVIDENCE_S3_PATH_STYLE !== "false",
    credentials: {
      accessKeyId: env.GK_PROOF_EVIDENCE_S3_ACCESS_KEY_ID,
      secretAccessKey: env.GK_PROOF_EVIDENCE_S3_SECRET_ACCESS_KEY,
    },
  });
  const bucket = env.GK_PROOF_EVIDENCE_S3_BUCKET;
  const prefix = "gate-keeper-proof/" + env.GK_NATIVE_FOUR_RUN_ID + "/";
  const privateWrite = async (rel, value) => {
    if (rel.includes("..") || rel.startsWith("/") || rel.includes("\\"))
      fail("PRIVATE_OBJECT_KEY_UNSAFE");
    const body = JSON.stringify(value);
    await s3.send(new PutObjectCommand({
      Bucket: bucket, Key: prefix + rel, Body: body,
      ContentType: "application/json",
      Metadata: { sha256: digest(body) }, IfNoneMatch: "*",
    }));
  };
  // Any failure to atomically claim the new run ID is a hard stop.
  const claimOnce = async (entry) => {
    try { await privateWrite("STARTED", entry); }
    catch { fail("PRIVATE_ATOMIC_CLAIM_FAILED_OR_RUN_ALREADY_STARTED"); }
    return { created: true };
  };
  const { TrueForge } = await import("@truefoundry/trueforge-sdk");
  const tf = new TrueForge({
    baseUrl: env.TRUEFORGE_BASE_URL, token: env.TRUEFORGE_TOKEN,
    timeoutInSeconds: 30,
  });
  const result = await runNativeFour({
    tf, receipt, publicKeyPem,
    pinnedKeySha256: issuerPin.signerPublicKeySha256,
    runId: env.GK_NATIVE_FOUR_RUN_ID, sourceCommit: env.RAILWAY_GIT_COMMIT_SHA,
    env, claimOnce, privateWrite,
  });
  // Logs include aggregates only. Raw output, session and turn IDs are S3-only.
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await cli(); }
  catch (e) {
    const code = /^NATIVE_FOUR_HELD:[A-Z_]+$/.test(e?.message || "") ?
      e.message : "NATIVE_FOUR_HELD:UNVERIFIED_ERROR_NO_RETRY";
    console.error(code);
    process.exitCode = 3;
  }
}
