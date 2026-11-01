// Gate Keeper live proof orchestrator.
//   node --import tsx scripts/proof/live/run.mjs
// Runs ONLY against a TrueForge reachable on a private Railway network (or an
// explicitly allowed local URL for self-tests). Every model call is reserved
// against an external spend cap first. Raw evidence goes to private storage;
// stdout carries only hashes, aggregates and the sanitised public summary.
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { assessLessonForCore, budgetAdmission, executionAdmission, nextExecutionState } from "../../execution/policy.mjs";
import { validatePublicProof, REQUIRED_STAGES } from "../validate-public-proof.mjs";
import { ALL_ARMS, armBase, armModel, comparisonArms, validArmId, DEFAULT_CAP_USD, OUTPUT_CONTRACT, REPAIR_OUTPUT_CONTRACT, PHASE_SHARE, REVIEW_PARAMS, ROOT, RUNTIME_CONFIG, TRUEFORGE_RUNTIME,
  armInstructions, gateKeeperMethodology, instructionHashes, sha256 } from "./config.mjs";
import { BudgetController } from "./budget.mjs";
import { aggregateArm, parseFindingsWithSeverity, shuffle, validFinding } from "./metrics.mjs";
import { applyBoundedPatch, cloneCandidate, createFixtureRepo, discardCandidate, extractPatch, pollValidation,
  repairBrief, startValidation, verifyOrigin } from "./drill.mjs";
import { EvidenceStore } from "./evidence.mjs";
import { ADJUDICATOR, adjudicateTasks, decodeHoldout, reviewTasks, taskPrompt } from "./review.mjs";
import { runLearning, LEARN_PHASE_SHARE } from "./learn.mjs";

export { ADJUDICATOR, decodeHoldout, taskPrompt };

export const REPAIR_FIXTURES = ["money", "uploads", "pagination", "escape", "redirect", "retry"];
const BASELINE_REPAIR = "You are a software engineer. Fix the reported problem with a minimal change that satisfies the requirements and threat model.";
/** Gate adjudication counts only when every blocking index 0..n-1 is judged exactly once (last JSON block). */
export function parseGateJudgements(text, n) {
  const blocks = [...String(text || "").matchAll(/```json\s*\n?([\s\S]*?)```/g)].map((m) => m[1]);
  let judged; try { judged = JSON.parse((blocks.length ? blocks[blocks.length - 1] : text).trim()).judgements; } catch { return null; }
  if (!Array.isArray(judged) || judged.length !== n) return null;
  const seen = new Set();
  for (const j of judged) {
    if (!j || !Number.isInteger(j.index) || j.index < 0 || j.index >= n || seen.has(j.index) || typeof j.real !== "boolean") return null;
    seen.add(j.index);
  }
  return { confirmed: judged.filter((j) => j.real).length, rejected: judged.filter((j) => !j.real).length };
}
export const RE_REVIEW_ADJUDICATOR = `You are an independent adjudicator checking a repair gate. A reviewer flagged blocking findings on a repaired file that has ALREADY passed its acceptance, adversarial, integration and unit tests.
For EACH finding decide "real": true only if it is a genuine, merge-blocking defect in the repaired code given its requirements and threat model; false if it is speculative, stylistic, out of scope, already handled, or wrong.
Return exactly one fenced JSON block: \`\`\`json {"judgements": [{"index": 0, "real": false}]} \`\`\` covering every index once.`;
const LESSON_WRITER = `From the run evidence below, write ONE tenant-private lesson (at most two sentences) that would help you review and repair this same user's code next time. Do not include code, file contents, secrets or personal data. Return exactly one fenced JSON block: \`\`\`json {"lesson": "..."} \`\`\``;

const messageText = (msg) => { const c = msg?.content; if (!c) return ""; return typeof c === "string" ? c : c.map((p) => ("text" in p ? p.text : "")).join(""); };

function loadPublicTasks() {
  const dir = join(ROOT, "evals", "tasks");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => ({ ...JSON.parse(readFileSync(join(dir, f), "utf8")), holdout: false, public_holdout_flag: JSON.parse(readFileSync(join(dir, f), "utf8")).holdout === true }));
}
function publicBenchmarkSha(tasks) {
  return sha256(JSON.stringify(tasks.map((t) => ({ id: t.id, code: t.code, expected: t.expected }))));
}

export async function main({ tf, env = process.env, log = console.log, now = () => Date.now(), fetchImpl = fetch }) {
  const t0 = now();
  const runId = env.GK_PROOF_RUN_ID;
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(runId)) throw new Error("RUN_ID_REQUIRED");
  const baseUrl = env.TRUEFORGE_BASE_URL || "";
  // TrueForge is the harness wherever it is hosted. Accepted: the temporary private Railway service, or an
  // https endpoint whose host the owner approved (GK_TRUEFORGE_APPROVED_HOSTS) reached with a TrueForge token.
  const privateUrl = /^http:\/\/[a-z0-9-]+\.railway\.internal:\d{2,5}\/?$/.test(baseUrl);
  let approvedHttps = false;
  try {
    const u = new URL(baseUrl);
    const hosts = String(env.GK_TRUEFORGE_APPROVED_HOSTS || "").split(",").map((h) => h.trim().toLowerCase()).filter(Boolean);
    approvedHttps = u.protocol === "https:" && hosts.includes(u.hostname.toLowerCase()) && !!env.TRUEFORGE_TOKEN;
  } catch {}
  if (!privateUrl && !approvedHttps && env.GK_PROOF_ALLOW_LOCAL !== "1") throw new Error("TRUEFORGE_URL_NOT_APPROVED");
  const deadline = t0 + 60000 * Number(env.GK_PROOF_DEADLINE_MIN || 50);
  const capUsd = Number(env.GK_PROOF_CAP_USD || DEFAULT_CAP_USD);
  const trialsWanted = Math.max(1, Math.min(5, Number(env.GK_PROOF_TRIALS || 3)));
  const sourceCommit = env.RAILWAY_GIT_COMMIT_SHA || env.GK_SOURCE_COMMIT || "unknown";
  const ev = new EvidenceStore(env.GK_EVIDENCE_DIR || mkdtempSync(join(tmpdir(), "gk-evidence-")), runId);
  const blockers = [], limitations = [], sessions = [];
  const emit = (k, v) => log(`${k}=${typeof v === "string" ? v : JSON.stringify(v)}`);
  const timeLeft = () => deadline - now();

  // ---------- preflight (no spend) ----------
  let health = null;
  try { health = (await fetchImpl(baseUrl.replace(/\/$/, "") + "/healthz", { signal: AbortSignal.timeout(8000) })).status; } catch (e) { health = "unreachable"; }
  const { data: caps } = await tf.server.getCapabilities();
  const { data: models } = await tf.models.list();
  const modelNames = models.map((m) => m.name);
  const agentJson = JSON.parse(readFileSync(join(ROOT, "agent", "agent.json"), "utf8"));
  // Per-role defaults come from agent/models.json (the locked baseline); env overrides are for experiments.
  const roleConfig = JSON.parse(readFileSync(join(ROOT, "agent", "models.json"), "utf8")).roles;
  const model = env.GK_PROOF_MODEL || roleConfig.reviewer?.model || agentJson.model.name;
  const preflight = { health, base_url_private: privateUrl, base_url_kind: privateUrl ? "railway-private (temporary)" : approvedHttps ? "approved-https" : "local-selftest", trueforge_runtime: TRUEFORGE_RUNTIME, models: modelNames, selected_model: model,
    sandbox_enabled: !!caps?.sandbox?.enabled, skills_enabled: !!caps?.skill?.enabled, source_commit: sourceCommit };
  emit("GK_PROOF_PREFLIGHT", preflight);
  ev.put("preflight.json", preflight, "preflight");
  // Inventory only reads provider routes, so it must still run when the reviewer model is the thing that is missing.
  if (!modelNames.includes(model) && !["inventory", "provider-remove"].includes(env.GK_PROOF_MODE || "compare")) {
    emit("GK_PROOF_BLOCKED", { reason: "MODEL_NOT_REGISTERED", model, available: modelNames });
    return { blocked: "MODEL_NOT_REGISTERED", preflight };
  }
  const mode = env.GK_PROOF_MODE || "compare";
  if (!["compare", "learn", "inventory", "provider-remove"].includes(mode)) throw new Error("PROOF_MODE_INVALID");
  // Owner-requested removal of one named model provider from TrueForge (no model calls). The name must match exactly.
  if (mode === "provider-remove") {
    const target = String(env.GK_REMOVE_PROVIDER || "");
    const before = sanitizeProviders((await tf.settings.modelProviders.list()).data);
    if (!target || !before.some((p) => p.name === target)) throw new Error("PROVIDER_REMOVE_TARGET_NOT_FOUND");
    await tf.settings.modelProviders.delete(target);
    const after = sanitizeProviders((await tf.settings.modelProviders.list()).data);
    if (after.some((p) => p.name === target)) {
      emit("GK_PROOF_BLOCKED", { reason: "PROVIDER_REMOVE_NOT_CONFIRMED", target });
      throw new Error("PROVIDER_REMOVE_NOT_CONFIRMED");
    }
    const { data: modelsAfter } = await tf.models.list();
    const result = { removed: target, providers_before: before, providers_after: after, models_after: modelsAfter.map((m) => ({ id: m.name, provider: m.provider?.name ?? null })) };
    emit("GK_PROOF_PROVIDER_REMOVED", result);
    ev.put("provider-remove.json", result, "provider_change");
    return { providerRemoved: result };
  }
  // Inventory: read-only, no model calls. Reports which provider route each configured model uses.
  if (mode === "inventory") {
    let providers = null, providerError = null;
    try { providers = (await tf.settings.modelProviders.list()).data; } catch (e) { providerError = String(e?.message || e).slice(0, 160); }
    const inventory = { models: models.map((m) => ({ id: m.name, provider: m.provider?.name ?? null })), providers: sanitizeProviders(providers), provider_error: providerError };
    emit("GK_PROOF_INVENTORY", inventory);
    ev.put("inventory.json", inventory, "model_inventory");
    return { inventory };
  }
  let phaseShare = mode === "learn" ? LEARN_PHASE_SHARE : PHASE_SHARE;
  if (mode === "compare" && env.GK_PROOF_PHASE_SHARE) {
    const [c, a, d] = env.GK_PROOF_PHASE_SHARE.split(",").map(Number);
    if (![c, a, d].every((x) => x > 0 && x < 1) || Math.abs(c + a + d - 1) > 1e-6) throw new Error("PHASE_SHARE_INVALID");
    phaseShare = { comparison: c, adjudication: a, drill: d };
  }
  const budget = new BudgetController({ capUsd, phaseShare, model, now });
  const compArms = mode === "compare" ? comparisonArms(env) : null;
  const drillArms = mode === "compare" ? [...new Set((env.GK_PROOF_DRILL_ARMS || "baseline,gate_keeper").split(",").map((a) => a.trim()).filter(Boolean))] : [];
  if (mode === "compare" && (!drillArms.length || drillArms.some((a) => !validArmId(a)) || !drillArms.includes("gate_keeper"))) throw new Error("DRILL_ARMS_INVALID");
  const modelFor = (arm) => armModel(arm, model);
  // Every model a role or arm will use must be registered in TrueForge before any spend.
  const learningModel = env.GK_PROOF_LEARNING_MODEL || roleConfig.learning?.model || model;
  // Bare drill arms repair with the repair role's model; "method@model" drill arms name their repairer explicitly.
  const repairModel = env.GK_PROOF_REPAIR_MODEL || roleConfig.repair?.model || model;
  const repairerFor = (arm) => arm.includes("@") ? modelFor(arm) : repairModel;
  // Role models are checked as given; only arm ids are mapped through modelFor.
  const roleModels = mode === "learn" ? [learningModel] : [repairModel];
  const missing = [...new Set([...roleModels, ...[...(compArms || []), ...drillArms].map(modelFor)])].filter((m) => !modelNames.includes(m));
  if (missing.length) { emit("GK_PROOF_BLOCKED", { reason: "MODEL_NOT_REGISTERED", models: missing }); return { blocked: "MODEL_NOT_REGISTERED", preflight }; }

  // The adjudicator may be a different (stronger) registered model than the candidates.
  const adjudicatorModel = env.GK_PROOF_ADJUDICATOR_MODEL || roleConfig.adjudicator?.model || model;
  if (!modelNames.includes(adjudicatorModel)) {
    emit("GK_PROOF_BLOCKED", { reason: "ADJUDICATOR_MODEL_NOT_REGISTERED", model: adjudicatorModel });
    return { blocked: "ADJUDICATOR_MODEL_NOT_REGISTERED", preflight };
  }
  const sessionModel = new Map();

  // ---------- model call wrapper: reserve -> create turn -> poll -> settle ----------
  async function newSession(spec, meta) {
    const metadata = Object.fromEntries(Object.entries({ purpose: "gk-proof", run_id: runId, ...meta }).map(([k, v]) => [k, String(v)]));
    const { data } = await tf.sessions.create({ agent: { spec }, metadata });
    sessions.push({ id: data.id, model: spec.model?.name, ...meta });
    sessionModel.set(data.id, spec.model?.name || model);
    return data.id;
  }
  async function callTurn(phase, label, sessionId, content, instructionsChars, maxTokens) {
    if (timeLeft() < 90000) return { refused: "DEADLINE" };
    const r = budget.reserve(phase, label, instructionsChars + content.length, maxTokens, sessionModel.get(sessionId));
    if (!r) return { refused: "BUDGET" };
    const started = now();
    let turn;
    try {
      ({ data: turn } = await tf.sessions.createTurn(sessionId, { input: [{ type: "user.message", content }], previousTurnId: "none" }, { maxRetries: 0 }));
    } catch (e) {
      budget.settle(r, null);
      return { status: "create_error", error: String(e?.message || e).slice(0, 300), text: "", latency_ms: now() - started };
    }
    let polls = 0;
    while (["running", "paused"].includes(turn.state.status) || !turn.state.status) {
      if (turn.state.status === "paused" || now() - started > 240000) {
        try { await tf.sessions.cancel(sessionId); } catch {}
        budget.settle(r, null);
        return { status: turn.state.status === "paused" ? "paused_cancelled" : "timeout_cancelled", turnId: turn.id, text: "", latency_ms: now() - started, polls };
      }
      await new Promise((res) => setTimeout(res, env.GK_PROOF_POLL_MS ? Number(env.GK_PROOF_POLL_MS) : 1500));
      polls++;
      try { ({ data: turn } = await tf.sessions.getTurn(sessionId, turn.id)); }
      catch (e) {
        try { await tf.sessions.cancel(sessionId); } catch {}
        budget.settle(r, null);
        return { status: "poll_error", turnId: turn.id, error: String(e?.message || e).slice(0, 300), text: "", latency_ms: now() - started, polls };
      }
    }
    const s = turn.state;
    const metrics = s.metrics || null;
    budget.settle(r, metrics);
    const latency = s.completedAt && turn.createdAt ? Date.parse(s.completedAt) - Date.parse(turn.createdAt) : now() - started;
    return { status: s.status, turnId: turn.id, text: s.status === "done" ? messageText(s.output) : "", error: s.message, metrics, latency_ms: latency, polls };
  }

  /** Export every TrueForge session trace and the spend ledger, then upload the private evidence. */
  async function exportEvidence() {
    for (const s of sessions) {
      try {
        const { data: session } = await tf.sessions.get(s.id);
        const turns = [];
        for await (const turn of await tf.sessions.listTurns(s.id)) {
          const events = [];
          for await (const e of await tf.sessions.listTurnEvents(s.id, turn.id, { order: "asc" })) events.push(e);
          turns.push({ ...turn, events });
        }
        ev.put(`private/sessions/${s.id}.json`, { meta: s, session, turns }, "trueforge_session_trace");
      } catch (e) { limitations.push(`Session ${s.id} export failed: ${String(e?.message || e).slice(0, 120)}`); }
    }
    ev.put("private/spend-ledger.json", { snapshot: budget.snapshot(), ledger: budget.ledger }, "spend_ledger");
    const upload = await ev.upload({ endpoint: env.GK_EVIDENCE_S3_ENDPOINT, bucket: env.GK_EVIDENCE_S3_BUCKET, region: env.GK_EVIDENCE_S3_REGION,
      accessKeyId: env.GK_EVIDENCE_S3_ACCESS_KEY_ID, secretAccessKey: env.GK_EVIDENCE_S3_SECRET_ACCESS_KEY,
      forcePathStyle: env.GK_EVIDENCE_S3_PATH_STYLE !== "false" }).catch((e) => ({ uploaded: false, reason: "UPLOAD_FAILED: " + String(e?.message || e).slice(0, 160) }));
    if (!upload.uploaded) blockers.push("Private evidence upload failed or not configured: " + upload.reason);
    const manifest = ev.manifest();

    return { upload, manifest };
  }

  // ---------- learning run: errors -> lessons -> selection -> qualification -> unseen proof ----------
  if (mode === "learn") {
    const learning = await runLearning({ env, model, adjudicatorModel, learningModel, publicTasks: loadPublicTasks(), budget, callTurn, newSession, ev, emit, limitations });
    const { upload, manifest } = await exportEvidence();
    blockers.push("No independent verifier/signing identity: promoted rules cannot be signed, so core promotion stays held");
    limitations.push(adjudicatorModel === model ? "Adjudicator is a separate, blinded TrueForge session on the same model as the candidates" : `Adjudicator is a separate, blinded session on a different model (${adjudicatorModel}) from the same provider family, not a human`);
    limitations.push("Holdouts were written by the evaluator (Claude), not by an independent party");
    const hashes = instructionHashes();
    const publicData = { mode: "learn", run_id: runId, source_commit: sourceCommit, preflight, candidate_model: model, adjudicator_model: adjudicatorModel, learning_model: learningModel, learning: learning.public, budget: budget.snapshot(),
      sessions: sessions.map((s) => ({ id: s.id, phase: s.phase, arm: s.arm, trial: s.trial, role: s.role })), blockers, limitations,
      hashes: { ...hashes, ...learning.hashes, evidence_manifest_sha256: manifest.sha256 },
      evidence_items: manifest.body.items.map(({ kind, path, sha256: h, bytes }) => ({ kind, path, sha256: h, bytes })), upload, elapsed_ms: now() - t0 };
    emitChunked(log, "GK_PROOF_PUBLIC_DATA", publicData);
    emit("GK_PROOF_DONE", { run_id: runId, mode, spent_usd: budget.snapshot().spent_usd, evidence_manifest_sha256: manifest.sha256 });
    return { publicData };
  }

  // ---------- 1. comparison: identical inputs, interleaved arms, repeated trials ----------
  const publicTasks = loadPublicTasks();
  let holdout = { tasks: [], sha256: null };
  try { holdout = decodeHoldout(env.GK_PRIVATE_HOLDOUT_B64); } catch (e) { blockers.push("Private holdout could not be decoded: " + e.message); }
  if (!holdout.tasks.length) blockers.push("No owner-private holdout supplied to the runner (GK_PRIVATE_HOLDOUT_B64)");
  const tasks = [...publicTasks, ...holdout.tasks];
  ev.put("private/holdout-tasks.json", holdout.tasks, "private_holdout");
  const { results, completeTrials } = await reviewTasks({ tasks, arms: compArms, instructionsFor: (arm) => armInstructions(arm), modelFor, trials: trialsWanted,
    phase: "comparison", model, callTurn, newSession, limitations });
  const scored = results.filter((r) => completeTrials.includes(r.trial));
  ev.put("private/comparison-replies.json", results.map(({ task, ...r }) => ({ ...r, task_id: task.id, holdout: !!task.holdout })), "candidate_replies");

  // ---------- 2. blinded independent adjudication ----------
  const { judgements, blindKey } = await adjudicateTasks({ tasks, scored, phase: "adjudication", model, adjudicatorModel, callTurn, newSession, ev });
  ev.put("private/blinding-key.json", blindKey, "unblinding_key");

  const arms = {};
  for (const arm of compArms) {
    arms[arm] = {
      all: aggregateArm(arm, scored, judgements, blindKey),
      public: aggregateArm(arm, scored, judgements, blindKey, { holdoutOnly: false }),
      holdout: holdout.tasks.length ? aggregateArm(arm, scored, judgements, blindKey, { holdoutOnly: true }) : null,
      deterministic_score_mean: (() => { const xs = scored.filter((r) => r.arm === arm).map((r) => r.deterministic.score); return xs.length ? Math.round((100 * xs.reduce((s, x) => s + x, 0)) / xs.length * 100) / 100 : null; })(),
      malformed_findings: scored.filter((r) => r.arm === arm).reduce((s, r) => s + (r.findings || []).filter((f) => !validFinding(f)).length, 0),
    };
  }
  emit("GK_PROOF_COMPARISON", { complete_trials: completeTrials, arms, budget: budget.snapshot() });

  // ---------- 3. autonomous loop drill on disposable fixtures ----------
  const drill = await runDrill({ tf, model, adjudicatorModel, drillArms, repairerFor, budget, callTurn, newSession, ev, emit, env });

  // ---------- 4. evidence: sessions, ledger, upload ----------
  const { upload, manifest } = await exportEvidence();

  // ---------- 5. public summary (aggregates and hashes only) ----------
  blockers.push("No independent verifier/signing identity: qualification cannot be signed, so no PASS is claimable");
  blockers.push("No independent budget gateway lease: spend was capped by the evaluator process (outside the agents), not a signed gateway");
  limitations.push(adjudicatorModel === model ? "Adjudicator is a separate, blinded TrueForge session on the same model as the candidates, not a human or a different model family"
    : `Adjudicator is a separate, blinded session on a different model (${adjudicatorModel}) from the same provider family, not a human`);
  limitations.push("actual_cost_usd is TrueForge's per-turn cost estimate (turn metrics), not a provider billing statement");
  limitations.push("Node permission sandbox confines candidate file reads but not network sockets; network access by candidate code is blocked only by the patch denylist");
  limitations.push("Re-review gate precision is judged by a same-model blinded adjudicator session");
  if (!preflight.sandbox_enabled) limitations.push("TrueForge sandbox provider not enabled; candidate patches were validated in a disposable clone inside the one-shot runner container");
  const pick = (a) => a ? ({ trials: a.trials, defect_recall: a.defect_recall, precision: a.precision, explanation_correctness: a.explanation_correctness,
    severity_accuracy: a.severity_accuracy, median_latency_ms: a.median_latency_ms, total_tokens: a.total_tokens, actual_cost_usd: a.trueforge_estimated_cost_usd }) : null;
  const hashes = instructionHashes();
  const summary = {
    schema: "gate-keeper-public-proof-v1", run_id: runId, submitted_at: new Date(now()).toISOString(),
    result: "INCONCLUSIVE",
    source: { repository: "appliedai-au/gate_keeper", gate_keeper_commit: sourceCommit, baseline_instructions_sha256: hashes.baseline_instructions_sha256,
      gate_keeper_instructions_sha256: hashes.gate_keeper_instructions_sha256, scorer_sha256: hashes.scorer_sha256 },
    environment: { trueforge_version: TRUEFORGE_RUNTIME, model_id: model, adjudicator_model_id: adjudicatorModel, arm_models: Object.fromEntries(compArms.map((a) => [a, modelFor(a)])), drill_arm_repair_models: Object.fromEntries(drillArms.map((a) => [a, repairerFor(a)])), provider: model.split("/")[0], sandbox_provider: preflight.sandbox_enabled ? "trueforge-configured" : "none (disposable runner clone)" },
    benchmark: { id: `public evals/tasks (${publicTasks.length}) + owner-private holdout (${holdout.tasks.length})`, sha256: sha256(publicBenchmarkSha(publicTasks) + ":" + (holdout.sha256 || "none")), holdout_private: true },
    fairness: { same_model: true, same_provider: true, same_inputs: true, same_scoring: true, same_limits: true },
    arms: { baseline: pick(arms.baseline.all) || emptyArm(), gate_keeper: pick(arms.gate_keeper.all) || emptyArm() },
    loop: drill.stages,
    evidence: [{ kind: "private_evidence_manifest", private_reference: upload.reference || "runner-local (upload failed)", sha256: manifest.sha256 }],
    blockers, limitations,
  };
  for (const arm of compArms) if (!(arm in summary.arms)) summary.arms[arm] = pick(arms[arm].all) || emptyArm();
  const variants = compArms.filter((a) => a.includes("@"));
  if (variants.length) limitations.push(`Model-comparison arms (${variants.join(", ")}) use the same method on a different model; fairness flags apply to the primary baseline/gate_keeper pair on ${model}`);
  for (const arm of compArms) if (!completeTrials.length) summary.arms[arm] = emptyArm();
  if (!completeTrials.length) summary.fairness = { same_model: null, same_provider: null, same_inputs: null, same_scoring: null, same_limits: null };
  validatePublicProof(summary);
  const publicData = { preflight, complete_trials: completeTrials, arms, drill: drill.public, budget: budget.snapshot(), sessions: sessions.map((s) => ({ id: s.id, phase: s.phase, arm: s.arm, trial: s.trial })),
    hashes: { ...hashes, public_benchmark_sha256: publicBenchmarkSha(publicTasks), private_holdout_sha256: holdout.sha256, evidence_manifest_sha256: manifest.sha256 },
    evidence_items: manifest.body.items.map(({ kind, path, sha256: h, bytes }) => ({ kind, path, sha256: h, bytes })), upload, elapsed_ms: now() - t0 };
  emitChunked(log, "GK_PROOF_PUBLIC_SUMMARY", summary);
  emitChunked(log, "GK_PROOF_PUBLIC_DATA", publicData);
  emit("GK_PROOF_DONE", { run_id: runId, spent_usd: budget.snapshot().spent_usd, evidence_manifest_sha256: manifest.sha256 });
  return { summary, publicData };
}

/** Provider summary safe to publish: name, type, endpoint host and model count. Never auth or full URLs. */
export function sanitizeProviders(list) {
  const arr = Array.isArray(list) ? list : Array.isArray(list?.data) ? list.data : [];
  return arr.map((p) => {
    let host = null;
    try { host = p?.baseUrl ? new URL(p.baseUrl).hostname : null; } catch { host = "unparseable"; }
    return { name: String(p?.name ?? ""), type: String(p?.type ?? p?.provider?.type ?? "unknown"), endpoint_host: host,
      models: Array.isArray(p?.models) ? p.models.length : null, auth_configured: !!p?.auth };
  });
}

const emptyArm = () => ({ trials: 0, defect_recall: null, precision: null, explanation_correctness: null, severity_accuracy: null, median_latency_ms: null, total_tokens: null, actual_cost_usd: null });
export function emitChunked(log, key, value) {
  const b64 = Buffer.from(JSON.stringify(value)).toString("base64");
  const size = 2500, n = Math.ceil(b64.length / size);
  for (let i = 0; i < n; i++) log(`${key}_B64[${i + 1}/${n}]=${b64.slice(i * size, (i + 1) * size)}`);
}

// ---------- autonomous repair-loop drill ----------
async function runDrill({ model, adjudicatorModel, drillArms, repairerFor, budget, callTurn, newSession, ev, emit, env }) {
  const work = mkdtempSync(join(tmpdir(), "gk-drill-"));
  const fixtures = Object.fromEntries([...REPAIR_FIXTURES, "archive"].map((id) => [id, join(ROOT, "proof", "fixtures", id)]));
  const params = { temperature: 0, maxTokens: 2500 };
  const cycles = [], lessons = [], events = [];
  let reAdjSession = null;
  // Lesson capture and the repeat-after-improvement cycles run on the default gate_keeper arm (validated in main).
  events.push({ check: "drill_arms", arms: drillArms });
  const stage = Object.fromEntries(REQUIRED_STAGES.map((s) => [s, "NOT_RUN"]));
  const mark = (s, v) => { if (stage[s] !== "FAIL") stage[s] = v === "PASS" && stage[s] === "BLOCKED" ? "BLOCKED" : v; };

  // Gate Keeper's own admission controls, recorded exactly as they answer.
  const baseAdmission = { mode: "sandbox", readOnlyReview: true, tenantScoped: true, repairScopeApproved: true, repositoryPinned: true,
    branchProtected: true, pollingEnabled: true, autoRevertEnabled: true };
  const supervised = executionAdmission({ ...baseAdmission, noHumanInLoop: false, humanApproved: false });
  const autonomous = executionAdmission({ ...baseAdmission, noHumanInLoop: true, ownerApprovedAutonomy: env.GK_OWNER_APPROVED_AUTONOMY === "1" });
  const gkBudgetGate = budgetAdmission({ estimateUsd: 1, remainingUsd: budget.remaining(), perRunUsd: 2.5, lease: null });
  events.push({ check: "no_human_in_loop=false", admission: supervised, outcome: supervised.admitted ? "unexpected_admit" : "held_approval (no repair, no spend)" });
  events.push({ check: "no_human_in_loop=true", admission: autonomous });
  events.push({ check: "gate_keeper_budget_admission_without_signed_lease", admission: gkBudgetGate });

  const architectWarranted = (v) => v.allowed_paths.length > 1 || /cross-service|schema|migration/i.test(v.context);

  async function cycle(arm, fixtureId, { lesson = null, maxAttempts = 2, label }) {
    const origin = createFixtureRepo(fixtures[fixtureId], work);
    const v = origin.vmodel;
    const rec = { label, arm, fixture: fixtureId, tenant: v.tenant, source_sha: origin.sourceSha, lesson_applied: !!lesson,
      architect_invoked: architectWarranted(v), architect_reason: architectWarranted(v) ? "multi-file or cross-service change" : "single-file change; no cross-service design impact",
      attempts: [], states: ["queued"] };
    let state = nextExecutionState("queued", "start"); rec.states.push(state);
    const lessonText = lesson ? `\n\n## Tenant-private lessons for this user (${v.tenant})\n- ${lesson}` : "";
    const reviewInstr = armInstructions(arm) + lessonText;
    const reviewSession = await newSession({ model: { name: model, params: REVIEW_PARAMS }, instructions: reviewInstr, config: RUNTIME_CONFIG }, { phase: "drill", arm, fixture: fixtureId, role: "review" });
    const brief = repairBrief(origin.repo, v);
    const task = { id: v.id, filename: v.file, language: "javascript", context: v.context, code: brief.source.replace(/\n$/, "").split("\n") };
    const review = await callTurn("drill", `${label}/review`, reviewSession, taskPrompt(task), reviewInstr.length, REVIEW_PARAMS.maxTokens);
    if (review.refused) { rec.outcome = "HELD_BUDGET"; return rec; }
    const findings = parseFindingsWithSeverity(review.text) || [];
    rec.review = { turn_id: review.turnId, findings: findings.length, finding_lines: findings.map((f) => f.line) };
    if (!findings.length) { state = nextExecutionState(state, "deny"); rec.states.push(state); rec.outcome = "REVIEWED_NO_FINDING"; return rec; }
    mark("adversarial_review", "PASS");
    state = nextExecutionState(state, "finding"); rec.states.push(state);
    const repairInstr = (armBase(arm).startsWith("gate_keeper") ? gateKeeperMethodology("repair", armBase(arm) === "gate_keeper_lean" ? "lean" : "adversarial") : BASELINE_REPAIR) + "\n\n" + REPAIR_OUTPUT_CONTRACT + lessonText;
    // In the drill, "@model" selects the REPAIR model only; review and re-review stay on the candidate model so the gate is identical across arms.
    const repairSession = await newSession({ model: { name: repairerFor(arm), params }, instructions: repairInstr, config: RUNTIME_CONFIG }, { phase: "drill", arm, fixture: fixtureId, role: "repair" });
    let feedback = "";
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) { state = "repairing"; rec.states.push("repairing(bounded retry " + attempt + ")"); }
      const prompt = [`File \`${v.file}\`:`, "```javascript", brief.source, "```", "", "Requirements:", brief.requirements, "", "Threat model:", brief.threats, "", "Architecture:", brief.architecture, "",
        "Confirmed review findings:", "```json", JSON.stringify(findings, null, 1), "```", feedback].join("\n");
      const out = await callTurn("drill", `${label}/repair${attempt}`, repairSession, prompt, repairInstr.length, params.maxTokens);
      if (out.refused) { rec.outcome = "HELD_BUDGET"; break; }
      const candidate = cloneCandidate(origin.repo, work, `${label}-cand${attempt}`);
      const extracted = extractPatch(out.text, brief.source);
      const patch = extracted.content ? applyBoundedPatch(candidate, v, extracted.content) : { applied: false, reason: extracted.reason };
      const att = { attempt, repair_turn: out.turnId, patch: { applied: patch.applied, format: extracted.format, reason: patch.reason || null, changed_lines: patch.changedLines ?? null, patch_sha256: patch.patchSha256 || null } };
      rec.attempts.push(att);
      if (patch.applied) ev.put(`private/drill/${label}-attempt${attempt}.diff`, patch.diff, "candidate_patch");
      if (!patch.applied) {
        state = nextExecutionState("repairing", "failure"); rec.states.push(state);
        att.discard = discardCandidate(candidate); mark("rollback_failure_drill", att.discard.discarded ? "PASS" : "FAIL");
        feedback = `\nYour previous candidate was rejected before testing: ${patch.reason}. Return corrected targeted edits against the ORIGINAL file shown above.`;
        continue;
      }
      mark("sandbox_repair", "PASS");
      state = nextExecutionState("repairing", "patch"); rec.states.push(state);
      const job = startValidation(candidate, v);
      const polled = await pollValidation(job);
      att.validation = { job_id: job.id, polls: polled.polls, verdict: polled.verdict, levels: polled.levels, waited_ms: polled.waited_ms };
      ev.put(`private/drill/${label}-attempt${attempt}-validation.json`, job.rounds, "v_model_test_logs");
      mark("v_model_validation", "PASS"); mark("polling", polled.terminal ? "PASS" : "FAIL");
      if (polled.verdict !== "PASS") {
        state = nextExecutionState("testing", "failure"); rec.states.push(state);
        att.discard = discardCandidate(candidate); mark("rollback_failure_drill", att.discard.discarded ? "PASS" : "FAIL");
        const failed = Object.entries(polled.levels || {}).filter(([, s]) => s !== "PASS").map(([k]) => k);
        feedback = `\nIndependent validation ${polled.verdict === "TIMEOUT" ? "TIMED OUT" : "FAILED"} at levels: ${failed.join(", ") || "(none completed)"}. Re-read the requirements and threat model and return corrected targeted edits against the ORIGINAL file shown above.`;
        continue;
      }
      state = nextExecutionState("testing", "pass"); rec.states.push(state);
      // Independent adversarial re-review of the repaired code in a fresh session.
      const reSession = await newSession({ model: { name: model, params: REVIEW_PARAMS }, instructions: reviewInstr, config: RUNTIME_CONFIG }, { phase: "drill", arm, fixture: fixtureId, role: "re-review" });
      const repaired = readFileSync(join(candidate, v.file), "utf8");
      const re = await callTurn("drill", `${label}/rereview${attempt}`, reSession, taskPrompt({ ...task, context: v.context + " (repaired candidate)", code: repaired.replace(/\n$/, "").split("\n") }), reviewInstr.length, REVIEW_PARAMS.maxTokens);
      if (re.refused) { rec.outcome = "HELD_BUDGET"; att.discard = discardCandidate(candidate); break; }
      const reFindings = parseFindingsWithSeverity(re.text) || [];
      const blocking = reFindings.filter((f) => ["critical", "high"].includes(f.severity));
      att.re_review = { turn_id: re.turnId, findings: reFindings.length, blocking: blocking.length };
      mark("post_repair_review", "PASS");
      if (blocking.length) {
        // Measure the gate's precision: adjudicate each blocking finding independently (evaluation only; the gate still discards).
        reAdjSession ||= await newSession({ model: { name: adjudicatorModel, params: { temperature: 0, maxTokens: 1500 } }, instructions: RE_REVIEW_ADJUDICATOR, config: RUNTIME_CONFIG }, { phase: "adjudication", role: "re-review-gate" });
        const adjPrompt = ["Repaired file (passed all V-model tests):", "```javascript", repaired, "```", "", "Requirements:", brief.requirements, "", "Threat model:", brief.threats, "", "Blocking findings:", "```json",
          JSON.stringify(blocking.map((f, index) => ({ index, line: f.line, category: f.category, severity: f.severity, comment: f.comment })), null, 1), "```"].join("\n");
        let gateJudgement = null, adjReplies = [];
        for (let k = 0; k < 2 && !gateJudgement; k++) {
          const adj = await callTurn("adjudication", `${label}/gate${attempt}/${k}`, reAdjSession, adjPrompt + (k ? "\n\nYour previous answer did not judge every index exactly once. Judge every index 0.." + (blocking.length - 1) + " exactly once." : ""), RE_REVIEW_ADJUDICATOR.length, 1500);
          if (adj.refused) break;
          adjReplies.push({ reply: adj.text || null, turn_id: adj.turnId || null });
          gateJudgement = parseGateJudgements(adj.text, blocking.length);
        }
        if (gateJudgement) { att.re_review.blocking_confirmed = gateJudgement.confirmed; att.re_review.blocking_rejected = gateJudgement.rejected; }
        else att.re_review.adjudication_incomplete = true;
        ev.put(`private/drill/${label}-attempt${attempt}-gate-adjudication.json`, { blocking, replies: adjReplies, judgement: gateJudgement }, "gate_adjudication");
      }
      if (blocking.length) {
        state = nextExecutionState("polling", "failure"); rec.states.push(state);
        att.discard = discardCandidate(candidate); mark("rollback_failure_drill", att.discard.discarded ? "PASS" : "FAIL");
        feedback = `\nIndependent re-review found blocking issues in your candidate: ${JSON.stringify(blocking)}. Return corrected targeted edits against the ORIGINAL file shown above.`;
        continue;
      }
      state = nextExecutionState("polling", "stable"); rec.states.push(state);
      rec.outcome = "CANDIDATE"; // kept as a sandbox candidate only: never merged or deployed
      att.retained_as_candidate_then_discarded = discardCandidate(candidate);
      break;
    }
    rec.outcome ||= "REVERTED";
    rec.origin_check = verifyOrigin(origin.repo, origin.sourceSha, v, origin.fileSha256);
    if (!rec.origin_check.unchanged) mark("rollback_failure_drill", "FAIL");
    return rec;
  }

  if (!autonomous.admitted) {
    events.push({ outcome: "autonomous drill held: owner autonomy approval not present" });
    for (const s of ["adversarial_review", "sandbox_repair", "v_model_validation", "polling", "post_repair_review", "rollback_failure_drill"]) stage[s] = "BLOCKED";
  } else {
    // Negative control: a deliberately failing candidate must be discarded automatically.
    const nc = createFixtureRepo(fixtures.money, work);
    const ncCand = cloneCandidate(nc.repo, work, "negative-control");
    const ncPatch = applyBoundedPatch(ncCand, nc.vmodel, readFileSync(join(nc.repo, nc.vmodel.file), "utf8") + "// harness negative control: unchanged defect\n");
    const ncVal = await pollValidation(startValidation(ncCand, nc.vmodel));
    const ncDiscard = ncVal.verdict !== "PASS" ? discardCandidate(ncCand) : { discarded: false };
    const ncOrigin = verifyOrigin(nc.repo, nc.sourceSha, nc.vmodel, nc.fileSha256);
    events.push({ check: "harness_negative_control", patch_applied: ncPatch.applied, verdict: ncVal.verdict, levels: ncVal.levels, discard: ncDiscard, origin: ncOrigin });
    mark("rollback_failure_drill", ncVal.verdict === "FAIL" && ncDiscard.discarded && ncOrigin.unchanged ? "PASS" : "FAIL");

    for (const fixtureId of REPAIR_FIXTURES) for (const arm of shuffle(drillArms)) cycles.push(await cycle(arm, fixtureId, { label: `${arm}-${fixtureId}` }));

    // Capture tenant-private lessons from Gate Keeper's own runs.
    const lessonSession = await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 400 } }, instructions: LESSON_WRITER, config: RUNTIME_CONFIG }, { phase: "drill", role: "lesson" });
    for (const c of cycles.filter((c) => c.arm === "gate_keeper")) {
      const evidence = JSON.stringify({ fixture: c.fixture, tenant: c.tenant, outcome: c.outcome, review: c.review, attempts: c.attempts.map((a) => ({ attempt: a.attempt, patch: a.patch, validation: a.validation && { verdict: a.validation.verdict, levels: a.validation.levels }, re_review: a.re_review })) });
      const out = await callTurn("drill", `lesson/${c.fixture}`, lessonSession, evidence, LESSON_WRITER.length, 400);
      if (out.refused) break;
      let text = null; try { text = JSON.parse((out.text.match(/```json\s*([\s\S]*?)```/) || [])[1] || out.text).lesson; } catch {}
      if (!text) continue;
      const lesson = { scope: "user", tenantId: c.tenant, fixture: c.fixture, text: String(text).slice(0, 400), evidenceIds: [c.review?.turn_id, ...c.attempts.map((a) => a.repair_turn)].filter(Boolean),
        verifiedSuccesses: c.outcome === "CANDIDATE" ? 1 : 0, independentTenants: 1, regressions: 0, userConsent: false, anonymized: false,
        containsSecrets: false, containsPersonalData: false, containsProprietaryCode: null, independentHoldoutPassed: false,
        adversarialSecurityPassed: false, signedVerifierPassed: false, expectedSourceBound: true, lesson_turn: out.turnId };
      lesson.core_selection = assessLessonForCore(lesson);
      lessons.push(lesson);
      ev.put(`private/lessons/${c.tenant}-${c.fixture}.json`, lesson, "tenant_private_lesson");
    }
    if (lessons.length) mark("user_lesson_capture", "PASS");
    if (lessons.length) mark("core_candidate_selection", "PASS");

    // Improve and repeat: same tenant, new fixture, without and then with the lesson.
    const betaLesson = lessons.find((l) => l.tenantId === "tenant-beta");
    if (betaLesson) {
      cycles.push(await cycle("gate_keeper", "archive", { label: "gate_keeper-archive-control" }));
      cycles.push(await cycle("gate_keeper", "archive", { lesson: betaLesson.text, label: "gate_keeper-archive-with-lesson" }));
    } else events.push({ outcome: "repeat-after-improvement not run: no tenant-beta lesson captured" });
  }
  stage.independent_qualification = "BLOCKED";
  if (stage.core_candidate_selection === "PASS" && !lessons.some((l) => l.core_selection?.selected)) {
    events.push({ outcome: "core candidate selection executed on real lessons; none eligible (consent, generality, holdout and signed verifier gates)" });
  }
  ev.put("private/drill/cycles.json", { cycles, lessons, events }, "drill_record");
  const publicCycles = cycles.map((c) => ({ label: c.label, arm: c.arm, fixture: c.fixture, lesson_applied: c.lesson_applied, outcome: c.outcome,
    architect_invoked: c.architect_invoked, states: c.states, review_findings: c.review?.findings ?? 0, attempts: c.attempts.map((a) => ({ attempt: a.attempt,
      patch_applied: a.patch.applied, patch_format: a.patch.format ?? null, patch_reason: a.patch.reason, changed_lines: a.patch.changed_lines, patch_sha256: a.patch.patch_sha256,
      verdict: a.validation?.verdict ?? null, levels: a.validation?.levels ?? null, polls: a.validation?.polls ?? null,
      re_review_blocking: a.re_review?.blocking ?? null, re_review_blocking_confirmed: a.re_review?.blocking_confirmed ?? null, discarded: a.discard?.discarded ?? a.retained_as_candidate_then_discarded?.discarded ?? null })),
    origin_unchanged: c.origin_check?.unchanged ?? null, source_sha: c.source_sha }));
  const repairSuccess = Object.fromEntries(drillArms.map((arm) => { const cs = cycles.filter((c) => c.arm === arm && !c.label.includes("archive")); return [arm, { cycles: cs.length, candidates: cs.filter((c) => c.outcome === "CANDIDATE").length, first_attempt: cs.filter((c) => c.outcome === "CANDIDATE" && c.attempts.length === 1).length,
    v_model_passing_patch: cs.filter((c) => c.attempts.some((a) => a.validation?.verdict === "PASS")).length,
    oversize_rejections: cs.reduce((n, c) => n + c.attempts.filter((a) => a.patch.reason === "PATCH_TOO_LARGE").length, 0),
    attempts: cs.reduce((n, c) => n + c.attempts.length, 0) }]; }));
  const gate = cycles.flatMap((c) => c.attempts.map((a) => a.re_review).filter(Boolean));
  const gatePrecision = { re_reviews: gate.length, blocking_findings: gate.reduce((n, g) => n + g.blocking, 0),
    adjudicated_real: gate.reduce((n, g) => n + (g.blocking_confirmed || 0), 0), adjudicated_not_real: gate.reduce((n, g) => n + (g.blocking_rejected || 0), 0),
    candidates_discarded_by_gate: gate.filter((g) => g.blocking > 0).length,
    discarded_with_no_confirmed_finding: gate.filter((g) => g.blocking > 0 && g.blocking_confirmed === 0 && !g.adjudication_incomplete).length,
    adjudications_incomplete: gate.filter((g) => g.adjudication_incomplete).length };
  const pub = { stages: stage, cycles: publicCycles, repair_success: repairSuccess, re_review_gate: gatePrecision, events,
    lessons: lessons.map((l) => ({ tenant: l.tenantId, fixture: l.fixture, text_sha256: sha256(l.text), verified_successes: l.verifiedSuccesses, core_selected: l.core_selection.selected, core_reasons: l.core_selection.reasons })) };
  emit("GK_PROOF_DRILL", pub);
  return { stages: stage, public: pub };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { TrueForge } = await import("@truefoundry/trueforge-sdk");
  const tf = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL, token: process.env.TRUEFORGE_TOKEN || undefined, timeoutInSeconds: 120 });
  const hardStop = setTimeout(() => { console.error("GK_PROOF_ABORT=hard wall-clock limit"); process.exit(7); }, 60000 * (Number(process.env.GK_PROOF_DEADLINE_MIN || 50) + 10));
  hardStop.unref();
  try {
    await guardRunOnce(process.env);
    await main({ tf });
  } catch (e) {
    console.error("GK_PROOF_FAILED=" + String(e?.stack || e).slice(0, 1500));
    process.exitCode = 4;
  }
}

/** Refuse to run twice for the same run id (crash-restart must not re-spend). */
async function guardRunOnce(env) {
  if (!env.GK_EVIDENCE_S3_BUCKET) return;
  const { S3Client, HeadObjectCommand, PutObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({ endpoint: env.GK_EVIDENCE_S3_ENDPOINT, region: env.GK_EVIDENCE_S3_REGION || "auto", forcePathStyle: env.GK_EVIDENCE_S3_PATH_STYLE !== "false",
    credentials: { accessKeyId: env.GK_EVIDENCE_S3_ACCESS_KEY_ID, secretAccessKey: env.GK_EVIDENCE_S3_SECRET_ACCESS_KEY } });
  const Key = `gate-keeper-proof/${env.GK_PROOF_RUN_ID}/STARTED`;
  try { await s3.send(new HeadObjectCommand({ Bucket: env.GK_EVIDENCE_S3_BUCKET, Key })); throw new Error("RUN_ALREADY_STARTED: refusing to spend twice for " + env.GK_PROOF_RUN_ID); }
  catch (e) { if (String(e.message).startsWith("RUN_ALREADY_STARTED")) throw e; if (e?.$metadata?.httpStatusCode !== 404 && e?.name !== "NotFound") throw new Error("RUN_GUARD_UNAVAILABLE: " + e.message); }
  await s3.send(new PutObjectCommand({ Bucket: env.GK_EVIDENCE_S3_BUCKET, Key, Body: new Date().toISOString() }));
}
