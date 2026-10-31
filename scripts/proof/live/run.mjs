// Gate Keeper live proof orchestrator.
//   node --import tsx scripts/proof/live/run.mjs
// Runs ONLY against a TrueForge reachable on a private Railway network (or an
// explicitly allowed local URL for self-tests). Every model call is reserved
// against an external spend cap first. Raw evidence goes to private storage;
// stdout carries only hashes, aggregates and the sanitised public summary.
import { gunzipSync } from "node:zlib";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { scoreTask } from "../../../evals/score.ts";
import { assessLessonForCore, budgetAdmission, executionAdmission, nextExecutionState } from "../../execution/policy.mjs";
import { validatePublicProof, REQUIRED_STAGES } from "../validate-public-proof.mjs";
import { ARMS, DEFAULT_CAP_USD, OUTPUT_CONTRACT, REPAIR_OUTPUT_CONTRACT, PHASE_SHARE, REVIEW_PARAMS, ROOT, RUNTIME_CONFIG, TRUEFORGE_RUNTIME,
  armInstructions, gateKeeperMethodology, instructionHashes, sha256 } from "./config.mjs";
import { BudgetController } from "./budget.mjs";
import { aggregateArm, answerKey, blindTask, parseAdjudication, parseFindingsWithSeverity, shuffle, validFinding } from "./metrics.mjs";
import { applyBoundedPatch, cloneCandidate, createFixtureRepo, discardCandidate, extractPatch, pollValidation,
  repairBrief, startValidation, verifyOrigin } from "./drill.mjs";
import { EvidenceStore } from "./evidence.mjs";

export const ADJUDICATOR = `You are an independent adjudicator for a code-review benchmark. You did not write any of the findings and you do not know who did.
For EACH finding decide:
- "matches": the expected_id of the answer-key issue it identifies (the same underlying defect; the line may differ slightly), or null.
- "real_defect" (only meaningful when matches is null): true only if the finding describes a genuine merge-blocking defect in the shown code that the key omits; false if it is wrong, speculative, stylistic, or not a real problem.
- "explanation_correct" (only when matches is not null): true if the comment correctly explains why it is a defect, consistent with the key; false if the reasoning is wrong or materially incomplete.
Judge only from the code and the key. Return exactly one fenced JSON block:
\`\`\`json
{"judgements": [{"id": "f_...", "matches": "E1", "real_defect": true, "explanation_correct": true}]}
\`\`\`
covering every finding id exactly once.`;

const BASELINE_REPAIR = "You are a software engineer. Fix the reported problem with a minimal change that satisfies the requirements and threat model.";
export const RE_REVIEW_ADJUDICATOR = `You are an independent adjudicator checking a repair gate. A reviewer flagged blocking findings on a repaired file that has ALREADY passed its acceptance, adversarial, integration and unit tests.
For EACH finding decide "real": true only if it is a genuine, merge-blocking defect in the repaired code given its requirements and threat model; false if it is speculative, stylistic, out of scope, already handled, or wrong.
Return exactly one fenced JSON block: \`\`\`json {"judgements": [{"index": 0, "real": false}]} \`\`\` covering every index once.`;
const LESSON_WRITER = `From the run evidence below, write ONE tenant-private lesson (at most two sentences) that would help you review and repair this same user's code next time. Do not include code, file contents, secrets or personal data. Return exactly one fenced JSON block: \`\`\`json {"lesson": "..."} \`\`\``;

const numbered = (lines) => { const w = String(lines.length).length; return lines.map((l, i) => `${String(i + 1).padStart(w)} | ${l}`).join("\n"); };
export function taskPrompt(t) {
  return [`Review this change. File: \`${t.filename}\`. What the change does: ${t.context}`, "",
    "Line numbers are on the left of the `|`.", "", "```" + t.language, numbered(t.code), "```"].join("\n");
}
const messageText = (msg) => { const c = msg?.content; if (!c) return ""; return typeof c === "string" ? c : c.map((p) => ("text" in p ? p.text : "")).join(""); };

function loadPublicTasks() {
  const dir = join(ROOT, "evals", "tasks");
  return readdirSync(dir).filter((f) => f.endsWith(".json")).sort().map((f) => ({ ...JSON.parse(readFileSync(join(dir, f), "utf8")), holdout: false, public_holdout_flag: JSON.parse(readFileSync(join(dir, f), "utf8")).holdout === true }));
}
export function decodeHoldout(b64) {
  if (!b64) return { tasks: [], sha256: null };
  const raw = gunzipSync(Buffer.from(b64, "base64"));
  const tasks = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(tasks) || !tasks.every((t) => t.id && Array.isArray(t.code) && Array.isArray(t.expected))) throw new Error("HOLDOUT_INVALID");
  return { tasks: tasks.map((t) => ({ ...t, holdout: true })), sha256: sha256(raw) };
}
function publicBenchmarkSha(tasks) {
  return sha256(JSON.stringify(tasks.map((t) => ({ id: t.id, code: t.code, expected: t.expected }))));
}

export async function main({ tf, env = process.env, log = console.log, now = () => Date.now(), fetchImpl = fetch }) {
  const t0 = now();
  const runId = env.GK_PROOF_RUN_ID;
  if (!runId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{5,79}$/.test(runId)) throw new Error("RUN_ID_REQUIRED");
  const baseUrl = env.TRUEFORGE_BASE_URL || "";
  const privateUrl = /^http:\/\/[a-z0-9-]+\.railway\.internal:\d{2,5}\/?$/.test(baseUrl);
  if (!privateUrl && env.GK_PROOF_ALLOW_LOCAL !== "1") throw new Error("PRIVATE_TRUEFORGE_URL_REQUIRED");
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
  const model = env.GK_PROOF_MODEL || agentJson.model.name;
  const preflight = { health, base_url_private: privateUrl, trueforge_runtime: TRUEFORGE_RUNTIME, models: modelNames, selected_model: model,
    sandbox_enabled: !!caps?.sandbox?.enabled, skills_enabled: !!caps?.skill?.enabled, source_commit: sourceCommit };
  emit("GK_PROOF_PREFLIGHT", preflight);
  ev.put("preflight.json", preflight, "preflight");
  if (!modelNames.includes(model)) {
    emit("GK_PROOF_BLOCKED", { reason: "MODEL_NOT_REGISTERED", model, available: modelNames });
    return { blocked: "MODEL_NOT_REGISTERED", preflight };
  }
  const budget = new BudgetController({ capUsd, phaseShare: PHASE_SHARE, model, now });

  // ---------- model call wrapper: reserve -> create turn -> poll -> settle ----------
  async function newSession(spec, meta) {
    const metadata = Object.fromEntries(Object.entries({ purpose: "gk-proof", run_id: runId, ...meta }).map(([k, v]) => [k, String(v)]));
    const { data } = await tf.sessions.create({ agent: { spec }, metadata });
    sessions.push({ id: data.id, ...meta });
    return data.id;
  }
  async function callTurn(phase, label, sessionId, content, instructionsChars, maxTokens) {
    if (timeLeft() < 90000) return { refused: "DEADLINE" };
    const r = budget.reserve(phase, label, instructionsChars + content.length, maxTokens);
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
      ({ data: turn } = await tf.sessions.getTurn(sessionId, turn.id));
    }
    const s = turn.state;
    const metrics = s.metrics || null;
    budget.settle(r, metrics);
    const latency = s.completedAt && turn.createdAt ? Date.parse(s.completedAt) - Date.parse(turn.createdAt) : now() - started;
    return { status: s.status, turnId: turn.id, text: s.status === "done" ? messageText(s.output) : "", error: s.message, metrics, latency_ms: latency, polls };
  }

  // ---------- 1. comparison: identical inputs, interleaved arms, repeated trials ----------
  const publicTasks = loadPublicTasks();
  let holdout = { tasks: [], sha256: null };
  try { holdout = decodeHoldout(env.GK_PRIVATE_HOLDOUT_B64); } catch (e) { blockers.push("Private holdout could not be decoded: " + e.message); }
  if (!holdout.tasks.length) blockers.push("No owner-private holdout supplied to the runner (GK_PRIVATE_HOLDOUT_B64)");
  const tasks = [...publicTasks, ...holdout.tasks];
  ev.put("private/holdout-tasks.json", holdout.tasks, "private_holdout");
  const results = [];
  const completeTrials = [];
  for (let trial = 1; trial <= trialsWanted; trial++) {
    const sessionByArm = {};
    for (const arm of ARMS) sessionByArm[arm] = await newSession(
      { model: { name: model, params: REVIEW_PARAMS }, instructions: armInstructions(arm), config: RUNTIME_CONFIG }, { phase: "comparison", arm, trial });
    let complete = true;
    for (const task of shuffle(tasks)) {
      for (const arm of shuffle(ARMS)) {
        const out = await callTurn("comparison", `${arm}/t${trial}/${task.id}`, sessionByArm[arm], taskPrompt(task), armInstructions(arm).length, REVIEW_PARAMS.maxTokens);
        if (out.refused) { complete = false; break; }
        const findings = out.status === "done" ? parseFindingsWithSeverity(out.text) : null;
        results.push({ arm, trial, task, findings, latency_ms: out.latency_ms, metrics: out.metrics, status: out.status, turn_id: out.turnId,
          session_id: sessionByArm[arm], reply: out.text, deterministic: scoreTask(task, out.text || "") });
      }
      if (!complete) break;
    }
    if (complete) completeTrials.push(trial);
    else { limitations.push(`Trial ${trial} stopped early (budget or deadline); only complete trials are scored`); break; }
  }
  const scored = results.filter((r) => completeTrials.includes(r.trial));
  ev.put("private/comparison-replies.json", results.map(({ task, ...r }) => ({ ...r, task_id: task.id, holdout: !!task.holdout })), "candidate_replies");

  // ---------- 2. blinded independent adjudication ----------
  const judgements = {}, blindKey = {};
  let adjudicatorSession = null;
  for (const task of tasks) {
    const replies = scored.filter((r) => r.task.id === task.id).map((r) => ({ arm: r.arm, trial: r.trial, findings: r.findings }));
    const { items, key } = blindTask(task.id, replies);
    Object.assign(blindKey, key);
    if (!items.length) continue;
    adjudicatorSession ||= await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 3000 } }, instructions: ADJUDICATOR, config: RUNTIME_CONFIG }, { phase: "adjudication" });
    const ak = answerKey(task);
    for (let i = 0; i < items.length; i += 30) {
      const chunk = items.slice(i, i + 30);
      const prompt = ["Code under review:", "```" + task.language, numbered(task.code), "```", "", "Answer key:", "```json", JSON.stringify(ak.map(({ severity, ...e }) => e), null, 1), "```", "",
        "Findings to judge (anonymised, shuffled):", "```json", JSON.stringify(chunk, null, 1), "```"].join("\n");
      let ids = new Set(chunk.map((c) => c.id));
      for (let attempt = 0; attempt < 2 && ids.size; attempt++) {
        const out = await callTurn("adjudication", `adjudicate/${task.id}/${i}/${attempt}`, adjudicatorSession, prompt + (attempt ? `\n\nJudge ONLY these ids: ${[...ids].join(", ")}` : ""), ADJUDICATOR.length, 3000);
        if (out.refused) break;
        const parsed = parseAdjudication(out.text, ids, new Set(ak.map((e) => e.expected_id)));
        ev.put(`private/adjudication/${task.id}-${i}-${attempt}.json`, { reply: out.text, turn_id: out.turnId, parsed }, "adjudication");
        Object.assign(judgements, parsed.judgements || {});
        ids = new Set([...ids].filter((id) => !(id in judgements)));
      }
    }
  }
  ev.put("private/blinding-key.json", blindKey, "unblinding_key");

  const arms = {};
  for (const arm of ARMS) {
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
  const drill = await runDrill({ tf, model, budget, callTurn, newSession, ev, emit, env });

  // ---------- 4. evidence: sessions, ledger, upload ----------
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

  // ---------- 5. public summary (aggregates and hashes only) ----------
  blockers.push("No independent verifier/signing identity: qualification cannot be signed, so no PASS is claimable");
  blockers.push("No independent budget gateway lease: spend was capped by the evaluator process (outside the agents), not a signed gateway");
  limitations.push("Adjudicator is a separate, blinded TrueForge session on the same model as the candidates, not a human or a different model family");
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
    environment: { trueforge_version: TRUEFORGE_RUNTIME, model_id: model, provider: model.split("/")[0], sandbox_provider: preflight.sandbox_enabled ? "trueforge-configured" : "none (disposable runner clone)" },
    benchmark: { id: `public evals/tasks (${publicTasks.length}) + owner-private holdout (${holdout.tasks.length})`, sha256: sha256(publicBenchmarkSha(publicTasks) + ":" + (holdout.sha256 || "none")), holdout_private: true },
    fairness: { same_model: true, same_provider: true, same_inputs: true, same_scoring: true, same_limits: true },
    arms: { baseline: pick(arms.baseline.all) || emptyArm(), gate_keeper: pick(arms.gate_keeper.all) || emptyArm() },
    loop: drill.stages,
    evidence: [{ kind: "private_evidence_manifest", private_reference: upload.reference || "runner-local (upload failed)", sha256: manifest.sha256 }],
    blockers, limitations,
  };
  for (const arm of ARMS) if (!completeTrials.length) summary.arms[arm] = emptyArm();
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

const emptyArm = () => ({ trials: 0, defect_recall: null, precision: null, explanation_correctness: null, severity_accuracy: null, median_latency_ms: null, total_tokens: null, actual_cost_usd: null });
export function emitChunked(log, key, value) {
  const b64 = Buffer.from(JSON.stringify(value)).toString("base64");
  const size = 2500, n = Math.ceil(b64.length / size);
  for (let i = 0; i < n; i++) log(`${key}_B64[${i + 1}/${n}]=${b64.slice(i * size, (i + 1) * size)}`);
}

// ---------- autonomous repair-loop drill ----------
async function runDrill({ model, budget, callTurn, newSession, ev, emit, env }) {
  const work = mkdtempSync(join(tmpdir(), "gk-drill-"));
  const fixtures = Object.fromEntries(["money", "uploads", "pagination", "escape", "archive"].map((id) => [id, join(ROOT, "proof", "fixtures", id)]));
  const params = { temperature: 0, maxTokens: 2500 };
  const cycles = [], lessons = [], events = [];
  let reAdjSession = null;
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
    const repairInstr = (arm === "gate_keeper" ? gateKeeperMethodology("repair") : BASELINE_REPAIR) + "\n\n" + REPAIR_OUTPUT_CONTRACT + lessonText;
    const repairSession = await newSession({ model: { name: model, params }, instructions: repairInstr, config: RUNTIME_CONFIG }, { phase: "drill", arm, fixture: fixtureId, role: "repair" });
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
        reAdjSession ||= await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 1500 } }, instructions: RE_REVIEW_ADJUDICATOR, config: RUNTIME_CONFIG }, { phase: "adjudication", role: "re-review-gate" });
        const adjPrompt = ["Repaired file (passed all V-model tests):", "```javascript", repaired, "```", "", "Requirements:", brief.requirements, "", "Threat model:", brief.threats, "", "Blocking findings:", "```json",
          JSON.stringify(blocking.map((f, index) => ({ index, line: f.line, category: f.category, severity: f.severity, comment: f.comment })), null, 1), "```"].join("\n");
        const adj = await callTurn("adjudication", `${label}/gate${attempt}`, reAdjSession, adjPrompt, RE_REVIEW_ADJUDICATOR.length, 1500);
        let judged = null;
        try { judged = JSON.parse(((adj.text || "").match(/```json\s*([\s\S]*?)```/) || [])[1] || adj.text).judgements; } catch {}
        if (Array.isArray(judged)) {
          att.re_review.blocking_confirmed = judged.filter((j) => j && j.real === true).length;
          att.re_review.blocking_rejected = judged.filter((j) => j && j.real === false).length;
        }
        ev.put(`private/drill/${label}-attempt${attempt}-gate-adjudication.json`, { blocking, reply: adj.text || null, turn_id: adj.turnId || null }, "gate_adjudication");
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

    for (const fixtureId of ["money", "uploads", "pagination", "escape"]) for (const arm of shuffle(ARMS)) cycles.push(await cycle(arm, fixtureId, { label: `${arm}-${fixtureId}` }));

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
  const repairSuccess = Object.fromEntries(ARMS.map((arm) => { const cs = cycles.filter((c) => c.arm === arm && !c.label.includes("archive")); return [arm, { cycles: cs.length, candidates: cs.filter((c) => c.outcome === "CANDIDATE").length, first_attempt: cs.filter((c) => c.outcome === "CANDIDATE" && c.attempts.length === 1).length,
    v_model_passing_patch: cs.filter((c) => c.attempts.some((a) => a.validation?.verdict === "PASS")).length,
    oversize_rejections: cs.reduce((n, c) => n + c.attempts.filter((a) => a.patch.reason === "PATCH_TOO_LARGE").length, 0),
    attempts: cs.reduce((n, c) => n + c.attempts.length, 0) }]; }));
  const gate = cycles.flatMap((c) => c.attempts.map((a) => a.re_review).filter(Boolean));
  const gatePrecision = { re_reviews: gate.length, blocking_findings: gate.reduce((n, g) => n + g.blocking, 0),
    adjudicated_real: gate.reduce((n, g) => n + (g.blocking_confirmed || 0), 0), adjudicated_not_real: gate.reduce((n, g) => n + (g.blocking_rejected || 0), 0),
    candidates_discarded_by_gate: gate.filter((g) => g.blocking > 0).length, discarded_with_no_confirmed_finding: gate.filter((g) => g.blocking > 0 && g.blocking_confirmed === 0).length };
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
