/**
 * Gate Keeper sponsor-funded, source-bound paired smoke.
 *
 * DEFAULT: --plan performs NO network call. --run is intentionally disabled
 * until a trusted sponsor issuer is pinned in a separately reviewed commit
 * and a valid signed grant + gateway budget receipt is mounted.
 *
 * This runner never calls model-provider APIs directly. It can only ask the
 * independently isolated TrueForge runtime to create two inline review turns.
 * No grader, repair, learning, sandbox commands or repository access.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { armInstructions, ROOT } from "./live/config.mjs";
import { taskPrompt } from "./live/review.mjs";
import { BudgetController } from "./live/budget.mjs";
import { EvidenceStore } from "./live/evidence.mjs";
import { scoreTask } from "../../evals/score.ts";
import {
  smokePlan, verifySponsorAdmission, requireIsolatedRailway,
  assertTrueForgeRoute,
} from "./sponsor-admission.mjs";
import pin from "../../config/gk-sponsor-issuer-pin.json" with { type: "json" };

export { smokePlan, verifySponsorAdmission, requireIsolatedRailway, assertTrueForgeRoute };

const PROOF_FIXTURE = "01-python-utils";
const RUNS = ["baseline", "gate_keeper"];
const MODEL_SETTINGS = Object.freeze({ temperature: 0, maxTokens: 500 });
const NO_EXECUTION = Object.freeze({
  askUserQuestions: { enabled: false },
  generativeUi: { enabled: false },
  dynamicSubAgents: { enabled: false },
  iterationLimit: 1,
});
const fail = (why) => { throw new Error("SPONSOR_SMOKE_BLOCKED: " + why); };
const expectedConfigKeys = [
  "GK_PROOF_EVIDENCE_S3_ENDPOINT", "GK_PROOF_EVIDENCE_S3_BUCKET",
  "GK_PROOF_EVIDENCE_S3_ACCESS_KEY_ID", "GK_PROOF_EVIDENCE_S3_SECRET_ACCESS_KEY",
];
const textOf = (output) => {
  const c = output?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) return c.map((p) => p && typeof p.text === "string" ? p.text : "").join("");
  return "";
};
const fixturePath = new URL("../../evals/tasks/01-python-utils.json", import.meta.url);
export function publicFixture() {
  const t = JSON.parse(readFileSync(fixturePath, "utf8"));
  if (t.id !== PROOF_FIXTURE || t.holdout !== false || !Array.isArray(t.code) ||
      !Array.isArray(t.expected) || t.expected.length !== 3)
    fail("PUBLIC_FIXTURE_CHANGED");
  return t;
}

/** No model request is made by this helper: metadata only. */
async function requireExactRoute(tf, model) {
  const [providerResponse, modelResponse] = await Promise.all([
    tf.settings.modelProviders.list(), tf.models.list(),
  ]);
  return assertTrueForgeRoute({
    providers: providerResponse?.data, models: modelResponse?.data, model,
  });
}

export async function pollSingleTurn(tf, sessionId, initialTurn, {
  sleep = (ms) => new Promise((res) => setTimeout(res, ms)),
  maxPolls = 12, intervalMs = 2000,
} = {}) {
  let turn = initialTurn;
  for (let poll = 0; poll <= maxPolls; poll++) {
    const state = turn?.state?.status;
    if (state === "done") return turn;
    if (state && state !== "running" && state !== "queued") {
      await tf.sessions.cancel(sessionId).catch(() => {});
      fail("TURN_NOT_SUCCESSFUL");
    }
    if (poll === maxPolls) break;
    await sleep(intervalMs);
    turn = (await tf.sessions.getTurn(sessionId, initialTurn.id))?.data;
  }
  await tf.sessions.cancel(sessionId).catch(() => {});
  fail("TURN_DEADLINE_EXCEEDED");
}

/**
 * Injectable runner for exact-head, non-billable mock testing. The caller
 * MUST supply the independent S3 one-shot lock and private evidence store.
 * No broad execution or hidden retry path.
 */
export async function runPairedSmoke({
  tf, signedEvidence, publicKeyPem, pinnedKeySha256, sourceCommit, runId,
  model = smokePlan().model, now = () => Date.now(),
  claimRunOnce, evidenceStore, pollOptions = {},
} = {}) {
  const fixture = publicFixture();
  const evidence = verifySponsorAdmission({
    evidence: signedEvidence, publicKeyPem, pinnedKeySha256,
    model, sourceCommit, runId, now: now(),
  });
  if (typeof claimRunOnce !== "function" ||
      typeof evidenceStore?.put !== "function" ||
      typeof evidenceStore?.upload !== "function") fail("DURABLE_PRIVATE_EVIDENCE_REQUIRED");
  if (typeof tf?.settings?.modelProviders?.list !== "function" ||
      typeof tf?.models?.list !== "function" ||
      typeof tf?.sessions?.create !== "function" ||
      typeof tf?.sessions?.createTurn !== "function" ||
      typeof tf?.sessions?.getTurn !== "function" ||
      typeof tf?.sessions?.cancel !== "function") fail("TRUEFORGE_SDK_NOT_CAPABLE");
  const route = await requireExactRoute(tf, model);
  // Claim the run id in owner-controlled S3 with atomic create-if-absent
  // semantics before making any sessions or potentially chargeable requests.
  await claimRunOnce({ runId, evidence, model, sourceCommit });
  evidenceStore.put("private/commissioning.json", {
    status: evidence.status, evidenceSha256: evidence.evidenceSha256,
    virtualAccountId: evidence.virtualAccountId, sourceCommit,
    model, upstreamId: route.upstreamId,
  }, "commissioning_receipt_reference");
  const budget = new BudgetController({
    capUsd: Math.min(1, evidence.hardCapUsd),
    phaseShare: { comparison: 1 },
    model, now,
  });
  const out = [];
  for (const arm of RUNS) {
    const instructions = armInstructions(arm);
    const prompt = taskPrompt(fixture);
    const reservation = budget.reserve("comparison", arm, instructions.length + prompt.length, 500, model);
    if (!reservation) fail("LOCAL_BUDGET_EXCEEDED");
    let sessionId = null;
    let rawTurn = null;
    try {
      const spec = {
        model: { name: model, params: { ...MODEL_SETTINGS } },
        instructions, config: NO_EXECUTION, tools: [],
      };
      const created = await tf.sessions.create({
        agent: { spec },
        metadata: { purpose: "gk-sponsor-smoke", run_id: runId, phase: "comparison", arm },
      });
      sessionId = created?.data?.id;
      if (typeof sessionId !== "string" || !sessionId) fail("SESSION_CREATE_FAILED");
      const createdTurn = await tf.sessions.createTurn(sessionId, {
        input: [{ type: "user.message", content: prompt }],
        previousTurnId: "none",
      }, { maxRetries: 0 });
      if (!createdTurn?.data?.id) fail("TURN_CREATE_FAILED");
      rawTurn = await pollSingleTurn(tf, sessionId, createdTurn.data, pollOptions);
    } catch (error) {
      if (sessionId) await tf.sessions.cancel(sessionId).catch(() => {});
      // Unknown charge: settle the FULL reservation. Never replay this run.
      budget.settle(reservation, null);
      fail("MODEL_CALL_FAILED_OR_INCOMPLETE");
    }
    const score = scoreTask(fixture, textOf(rawTurn?.state?.output));
    const metrics = rawTurn?.state?.metrics ?? null;
    budget.settle(reservation, metrics);
    evidenceStore.put("private/reviews/" + arm + ".json", {
      runId, model, arm, sessionId, turnId: rawTurn?.id, prompt, instructions,
      rawOutput: rawTurn?.state?.output, metrics, score,
    }, "private_review_trace");
    out.push({
      arm, model, task_id: fixture.id,
      parsed: score.parsed, caught: score.caught.length,
      missed: score.missed.length, noise: score.noise.length, score: score.score,
      // Never claim invoice billing from a TrueForge turn metric.
      gateway_billed_usd: null, gateway_request_trace: "NOT_YET_CORRELATED",
    });
  }
  const uploaded = await evidenceStore.upload();
  if (!uploaded?.uploaded || !uploaded?.manifest_sha256) fail("PRIVATE_EVIDENCE_UPLOAD_FAILED");
  return {
    run_id: runId, status: "INCONCLUSIVE",
    reason: "Two-arm smoke only; billing provenance and independent verifier receipt require external reconciliation",
    model, source_commit: sourceCommit, fixture: fixture.id,
    arms: out, localBudget: budget.snapshot(),
    actual_gateway_billing_usd: null,
    privateEvidence: { manifest_sha256: uploaded.manifest_sha256, reference: uploaded.reference },
    noRepairOrLearning: true,
  };
}

function checkedS3(env) {
  for (const key of expectedConfigKeys) if (!env[key]) fail("PRIVATE_EVIDENCE_STORAGE_NOT_CONFIGURED");
  return {
    endpoint: env.GK_PROOF_EVIDENCE_S3_ENDPOINT,
    bucket: env.GK_PROOF_EVIDENCE_S3_BUCKET,
    region: env.GK_PROOF_EVIDENCE_S3_REGION || "auto",
    accessKeyId: env.GK_PROOF_EVIDENCE_S3_ACCESS_KEY_ID,
    secretAccessKey: env.GK_PROOF_EVIDENCE_S3_SECRET_ACCESS_KEY,
  };
}
async function privateEvidenceConnection(env) {
  const config = checkedS3(env);
  const { S3Client, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    endpoint: config.endpoint, region: config.region,
    forcePathStyle: true,
    credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
  });
  const claimRunOnce = async ({ runId, evidence, model, sourceCommit }) => {
    const key = "gate-keeper-proof/" + runId + "/STARTED";
    try {
      await s3.send(new PutObjectCommand({
        Bucket: config.bucket, Key: key,
        Body: JSON.stringify({ runId, evidence_sha256: evidence.evidenceSha256, model, sourceCommit }),
        ContentType: "application/json", IfNoneMatch: "*",
      }));
    } catch {
      fail("ATOMIC_ONCE_CLAIM_UNAVAILABLE_OR_DUPLICATE");
    }
  };
  const evidenceStore = new EvidenceStore("/tmp/gk-smoke-private", env.GK_SPONSOR_SMOKE_RUN_ID);
  return {
    claimRunOnce,
    evidenceStore: {
      put: (...args) => evidenceStore.put(...args),
      upload: () => evidenceStore.upload(config),
    },
  };
}

async function cli() {
  const command = process.argv[2] || "--plan";
  const model = process.env.GK_SPONSOR_SMOKE_MODEL || smokePlan().model;
  if (command === "--plan") {
    console.log(JSON.stringify(smokePlan({ model }), null, 2));
    return;
  }
  if (command !== "--run") fail("UNKNOWN_COMMAND");
  const env = process.env;
  requireIsolatedRailway(env);
  // This pin is intentionally null until the sponsor issuer and source-bound
  // external gateway policy were qualified and reviewed out of band.
  if (pin.status !== "VERIFIED" || !pin.signerPublicKeySha256 ||
      !pin.issuerVerifiedBy) fail("TRUSTED_SPONSOR_SIGNER_NOT_COMMISSIONED");
  for (const key of ["GK_SPONSOR_SMOKE_RECEIPT_FILE","GK_SPONSOR_SMOKE_ISSUER_PEM_FILE",
    "GK_SPONSOR_SMOKE_RUN_ID","TRUEFORGE_TOKEN"]) if (!env[key]) fail("EXECUTION_PREREQUISITE_MISSING");
  // Do not accept an exposed HTTP gateway or a user-supplied upstream host.
  if (env.TRUEFORGE_BASE_URL !== "http://trueforge.railway.internal:8080")
    fail("PRIVATE_TRUEFORGE_ENDPOINT_REQUIRED");
  let receipt, publicKeyPem;
  try {
    receipt = JSON.parse(readFileSync(resolve(env.GK_SPONSOR_SMOKE_RECEIPT_FILE), "utf8"));
    publicKeyPem = readFileSync(resolve(env.GK_SPONSOR_SMOKE_ISSUER_PEM_FILE), "utf8");
  } catch { fail("SIGNED_RECEIPT_FILES_UNREADABLE"); }
  // Do not create even a metadata request until the independent signature
  // and source/method restrictions are verified.
  verifySponsorAdmission({
    evidence: receipt, publicKeyPem,
    pinnedKeySha256: pin.signerPublicKeySha256,
    model, sourceCommit: env.RAILWAY_GIT_COMMIT_SHA, runId: env.GK_SPONSOR_SMOKE_RUN_ID,
  });
  const { claimRunOnce, evidenceStore } = await privateEvidenceConnection(env);
  const { TrueForge } = await import("@truefoundry/trueforge-sdk");
  const tf = new TrueForge({
    baseUrl: env.TRUEFORGE_BASE_URL, token: env.TRUEFORGE_TOKEN, timeoutInSeconds: 30,
  });
  const result = await runPairedSmoke({
    tf, signedEvidence: receipt, publicKeyPem,
    pinnedKeySha256: pin.signerPublicKeySha256,
    sourceCommit: env.RAILWAY_GIT_COMMIT_SHA, runId: env.GK_SPONSOR_SMOKE_RUN_ID,
    model, claimRunOnce, evidenceStore,
  });
  console.log(JSON.stringify(result));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { await cli(); }
  catch (e) {
    // Sanitised refusal only; never print a token, receipt or upstream payload.
    console.error("SPONSOR_SMOKE_HELD=" + String(e?.message || "refused").slice(0, 160));
    process.exitCode = 3;
  }
}
