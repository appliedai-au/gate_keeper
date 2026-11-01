import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetController } from "../scripts/proof/live/budget.mjs";
import { armInstructions, instructionHashes, OUTPUT_CONTRACT, ROOT } from "../scripts/proof/live/config.mjs";
import { aggregateArm, blindTask, parseAdjudication, parseFindingsWithSeverity } from "../scripts/proof/live/metrics.mjs";
import { applyBoundedPatch, cloneCandidate, createFixtureRepo, discardCandidate, extractPatch, pollValidation, startValidation, verifyOrigin } from "../scripts/proof/live/drill.mjs";
import { validatePublicProof } from "../scripts/proof/validate-public-proof.mjs";

const PHASES = { comparison: 0.55, adjudication: 0.2, drill: 0.25 };

test("budget refuses a call that would breach the total or phase cap and settles from turn metrics", () => {
  const b = new BudgetController({ capUsd: 1, phaseShare: PHASES, model: "anthropic/claude-sonnet-4-6" });
  const r = b.reserve("comparison", "x", 3000, 1500);
  assert.ok(r && r.amount > 0);
  assert.equal(b.settle(r, { totalCostInUsd: 0.02 }), 0.02);
  assert.equal(b.snapshot().cost_sources.trueforge_turn_metric, 1);
  let refused = null;
  for (let i = 0; i < 200 && !refused; i++) { const x = b.reserve("comparison", "y" + i, 3000, 1500); if (!x) refused = i; else b.settle(x, null); }
  assert.ok(refused !== null, "comparison phase must stop at its share");
  assert.ok(b.snapshot().phase_spent_usd.comparison <= 0.55 + 1e-9);
  assert.equal(b.snapshot().refusals.length, 1);
  assert.throws(() => new BudgetController({ capUsd: 0, phaseShare: PHASES, model: "m" }), /BUDGET_CAP_INVALID/);
});

test("budget settles unknown cost at the full reservation and uses a flat reserve for unknown models", () => {
  const b = new BudgetController({ capUsd: 2, phaseShare: PHASES, model: "acme/unknown" });
  const r = b.reserve("drill", "z", 10, 10);
  assert.equal(r.amount, 0.3);
  assert.equal(b.settle(r, {}), 0.3);
});

test("arms share model params, output contract and limits; only methodology differs", () => {
  const a = armInstructions("baseline"), g = armInstructions("gate_keeper");
  assert.ok(a.endsWith(OUTPUT_CONTRACT) && g.endsWith(OUTPUT_CONTRACT));
  assert.ok(!/Gate Keeper/.test(a), "baseline must not contain Gate Keeper text");
  assert.match(g, /review-checklist/);
  const h = instructionHashes();
  assert.notEqual(h.baseline_instructions_sha256, h.gate_keeper_instructions_sha256);
  assert.match(h.scorer_sha256, /^[a-f0-9]{64}$/);
});

test("findings parse with severity; blinding hides arm and trial", () => {
  const f = parseFindingsWithSeverity('x\n```json\n{"findings":[{"line":3,"category":"Bug","severity":"HIGH","comment":"c"}]}\n```');
  assert.deepEqual(f, [{ line: 3, category: "bug", severity: "high", comment: "c" }]);
  assert.equal(parseFindingsWithSeverity("no json"), null);
  const { items, key } = blindTask("t1", [{ arm: "baseline", trial: 1, findings: f }, { arm: "gate_keeper", trial: 1, findings: f }]);
  assert.equal(items.length, 2);
  for (const it of items) { assert.ok(!("arm" in it) && !("trial" in it)); assert.match(it.id, /^f_[0-9a-f]{10}$/); }
  assert.deepEqual(new Set(Object.values(key).map((k) => k.arm)), new Set(["baseline", "gate_keeper"]));
});

test("adjudication parsing rejects unknown finding ids and unknown expected ids", () => {
  const ids = new Set(["f_aaaaaaaaaa", "f_bbbbbbbbbb"]);
  const r = parseAdjudication('```json\n{"judgements":[{"id":"f_aaaaaaaaaa","matches":"E9"},{"id":"f_bbbbbbbbbb","matches":"E1","explanation_correct":true},{"id":"f_zzzzzzzzzz","matches":"E1"}]}\n```', ids, new Set(["E1"]));
  assert.equal(r.ok, false);
  assert.deepEqual(Object.keys(r.judgements), ["f_bbbbbbbbbb"]);
  assert.deepEqual(r.missing, ["f_aaaaaaaaaa"]);
});

test("aggregation computes recall, precision, explanation, severity, duplicates and reproducibility", () => {
  const task = { id: "01-python-utils", holdout: false, expected: [{ line: 7, categories: ["bug"] }, { line: 12, categories: ["bug"] }] };
  const fs = [{ line: 7, category: "bug", severity: "high", comment: "" }, { line: 7, category: "bug", severity: "low", comment: "" }, { line: 30, category: "bug", severity: "low", comment: "" }];
  const results = [1, 2].map((trial) => ({ arm: "gate_keeper", trial, task, findings: fs, latency_ms: 100 * trial, metrics: { totalTokens: 10, totalCostInUsd: 0.001 } }));
  const { key } = blindTask(task.id, results.map((r) => ({ arm: r.arm, trial: r.trial, findings: r.findings })));
  const j = {};
  for (const [id, k] of Object.entries(key)) j[id] = k.index === 2 ? { matches: null, real_defect: false, explanation_correct: null } : { matches: "E1", real_defect: true, explanation_correct: k.index === 0 };
  const m = aggregateArm("gate_keeper", results, j, key);
  assert.equal(m.defect_recall, 0.5);
  assert.equal(m.precision, 0.5);
  assert.equal(m.duplicates, 2);
  assert.equal(m.explanation_correctness, 1);
  assert.equal(m.severity_accuracy, 1);
  assert.equal(m.reproducibility_mean_jaccard, 1);
  assert.equal(m.total_tokens, 20);
  assert.equal(m.median_latency_ms, 150);
});

const fixture = (id) => join(ROOT, "proof", "fixtures", id);
test("drill: a failing candidate is discarded and the origin stays unchanged", async () => {
  const work = mkdtempSync(join(tmpdir(), "gk-t-"));
  const o = createFixtureRepo(fixture("money"), work);
  const cand = cloneCandidate(o.repo, work, "c1");
  const p = applyBoundedPatch(cand, o.vmodel, readFileSync(join(o.repo, o.vmodel.file), "utf8") + "// noop\n");
  assert.equal(p.applied, true);
  const v = await pollValidation(startValidation(cand, o.vmodel, { rounds: 1 }), { intervalMs: 20 });
  assert.equal(v.verdict, "FAIL");
  assert.ok(v.polls >= 1);
  assert.equal(discardCandidate(cand).discarded, true);
  assert.equal(existsSync(cand), false);
  assert.equal(verifyOrigin(o.repo, o.sourceSha, o.vmodel, o.fileSha256).unchanged, true);
});

test("drill: correct fix passes every V level; naive traversal fix fails the trap; bounds are enforced", async () => {
  const work = mkdtempSync(join(tmpdir(), "gk-t-"));
  const m = createFixtureRepo(fixture("money"), work);
  const good = cloneCandidate(m.repo, work, "good");
  const src = readFileSync(join(m.repo, m.vmodel.file), "utf8").replace("Number(frac);", 'Number(frac.padEnd(2, "0"));');
  assert.equal(applyBoundedPatch(good, m.vmodel, src).applied, true);
  const gv = await pollValidation(startValidation(good, m.vmodel, { rounds: 1 }), { intervalMs: 20 });
  assert.equal(gv.verdict, "PASS");
  assert.deepEqual(Object.keys(gv.levels).sort(), ["acceptance", "adversarial", "integration", "static", "unit"]);
  const bad = cloneCandidate(m.repo, work, "bad");
  assert.match(applyBoundedPatch(bad, m.vmodel, src + "\nconst x = process.env.SECRET;\n").reason, /FORBIDDEN_API/);
  assert.equal(applyBoundedPatch(bad, m.vmodel, src + "\n" + "// pad\n".repeat(40)).reason, "PATCH_TOO_LARGE");
  const u = createFixtureRepo(fixture("uploads"), work);
  const naive = cloneCandidate(u.repo, work, "naive");
  const naiveSrc = readFileSync(join(u.repo, u.vmodel.file), "utf8").replace("  return join(", '  if (userPath.includes("..")) { const e = new Error("x"); e.code = "E_TRAVERSAL"; throw e; }\n  return join(');
  assert.equal(applyBoundedPatch(naive, u.vmodel, naiveSrc).applied, true);
  const nv = await pollValidation(startValidation(naive, u.vmodel, { rounds: 1 }), { intervalMs: 20 });
  assert.equal(nv.verdict, "FAIL");
  assert.equal(nv.levels.acceptance, "FAIL");
});

function e2e(cfg) {
  const out = execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "tests", "helpers", "live-e2e.mjs"), JSON.stringify(cfg)], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return JSON.parse(out.trim().split("\n").pop());
}
const decodeChunks = (lines, key) => JSON.parse(Buffer.from(lines.filter((l) => l.startsWith(key + "_B64[")).map((l) => l.split("=").slice(1).join("=")).join(""), "base64").toString("utf8"));

test("offline e2e (synthetic fake): orchestration completes, summary validates, holdout never leaks", () => {
  const r = e2e({ trials: 2 });
  const summary = decodeChunks(r.lines, "GK_PROOF_PUBLIC_SUMMARY");
  assert.equal(validatePublicProof(summary).valid, true);
  assert.equal(summary.result, "INCONCLUSIVE");
  assert.equal(summary.arms.baseline.trials, 2);
  assert.equal(summary.loop.independent_qualification, "BLOCKED");
  assert.equal(summary.loop.rollback_failure_drill, "PASS");
  const all = r.lines.join("\n");
  assert.ok(!all.includes("SECRET_HOLDOUT"), "holdout content must never reach stdout");
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  const money = data.drill.cycles.filter((c) => c.fixture === "money");
  assert.ok(money.length === 2 && money.every((c) => c.outcome === "CANDIDATE" && c.attempts[0].verdict === "PASS" && c.attempts[0].patch_format === "edits" && c.origin_unchanged === true), JSON.stringify(money));
  const naive = data.drill.cycles.filter((c) => c.fixture === "uploads");
  assert.ok(naive.every((c) => c.outcome === "REVERTED" && c.attempts.length === 2 && c.attempts.every((a) => a.patch_applied && a.verdict === "FAIL" && a.discarded === true)), JSON.stringify(naive));
  const pag = data.drill.cycles.filter((c) => c.fixture === "pagination");
  assert.ok(pag.every((c) => c.outcome === "REVERTED" && c.attempts.every((a) => a.patch_format === "full_file" && a.verdict === "PASS" && a.re_review_blocking === 1 && a.re_review_blocking_confirmed === 0)), JSON.stringify(pag));
  assert.ok(data.drill.cycles.filter((c) => c.fixture === "escape").every((c) => c.attempts.every((a) => a.patch_reason === "NO_PATCH")));
  assert.equal(data.drill.re_review_gate.discarded_with_no_confirmed_finding, data.drill.re_review_gate.candidates_discarded_by_gate);
  assert.ok(data.drill.re_review_gate.adjudicated_not_real >= 4);
  assert.equal(data.drill.repair_success.gate_keeper.v_model_passing_patch, 2);
  assert.ok(data.drill.events.some((e) => e.check === "no_human_in_loop=false" && e.admission.reason === "HUMAN_APPROVAL_REQUIRED"));
  assert.ok(data.drill.events.some((e) => e.check === "gate_keeper_budget_admission_without_signed_lease" && e.admission.reason === "INDEPENDENT_LEASE_REQUIRED"));
  assert.ok(data.drill.lessons.length >= 1 && data.drill.lessons.every((l) => l.core_selected === false));
  assert.ok(data.drill.cycles.some((c) => c.label === "gate_keeper-archive-with-lesson"));
});

test("offline e2e (synthetic fake): spend cap stops calls and unapproved autonomy holds the drill", () => {
  const r = e2e({ trials: 3, cap: 0.05, autonomy: false, fake: { costPerTurn: 0.02 } });
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  assert.ok(data.budget.spent_usd <= 0.05 + 1e-9, "spend must not exceed the cap: " + data.budget.spent_usd);
  assert.ok(data.budget.refusals.length >= 1);
  assert.equal(data.drill.stages.sandbox_repair, "BLOCKED");
  const summary = decodeChunks(r.lines, "GK_PROOF_PUBLIC_SUMMARY");
  assert.equal(validatePublicProof(summary).valid, true);
});

test("orchestrator refuses public TrueForge URLs and unregistered models", () => {
  assert.throws(() => e2e({ env: { TRUEFORGE_BASE_URL: "https://example.com" } }), /TRUEFORGE_URL_NOT_APPROVED/);
  const r = e2e({ fake: { models: ["openai/other"] } });
  assert.equal(r.out.blocked, "MODEL_NOT_REGISTERED");
  assert.equal(r.calls, 0);
});

test("drill sandbox: candidate tests cannot read the runner's environment or files; bypass imports are rejected", async () => {
  const work = mkdtempSync(join(tmpdir(), "gk-t-"));
  const o = createFixtureRepo(fixture("money"), work);
  const cand = cloneCandidate(o.repo, work, "evil");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(cand, "test", "unit.test.mjs"), 'import test from "node:test"; import { readFileSync } from "node:fs";\ntest("steal", () => { readFileSync("/proc/" + process.ppid + "/environ"); });\n');
  const v = await pollValidation(startValidation(cand, { ...o.vmodel, levels: o.vmodel.levels.filter((l) => l.level === "unit") }, { rounds: 1 }), { intervalMs: 20 });
  assert.equal(v.levels.unit, "FAIL");
  const src = readFileSync(join(o.repo, o.vmodel.file), "utf8");
  for (const evil of ['import { readFile } from "fs/promises";', 'const m = await import("fs");', 'import http from "http";', "globalThis.x = 1;", 'import net from "node:net";'])
    assert.match(applyBoundedPatch(cloneCandidate(o.repo, work, "b" + Math.random().toString(36).slice(2)), o.vmodel, evil + "\n" + src).reason || "", /FORBIDDEN_API/, evil);
});

test("drill: poll timeout returns a complete result shape", async () => {
  const job = { status: "running", rounds: [] };
  const r = await pollValidation(job, { intervalMs: 5, timeoutMs: 20 });
  assert.equal(r.verdict, "TIMEOUT");
  assert.deepEqual(r.levels, {});
});

test("drill: a hanging candidate is cancelled on poll timeout and discard cannot crash the run", async () => {
  const work = mkdtempSync(join(tmpdir(), "gk-t-"));
  const o = createFixtureRepo(fixture("money"), work);
  const cand = cloneCandidate(o.repo, work, "hang");
  const { writeFileSync } = await import("node:fs");
  writeFileSync(join(cand, "test", "unit.test.mjs"), "while (true) {}\n");
  const job = startValidation(cand, o.vmodel, { rounds: 2, levelTimeoutMs: 60000 });
  const r = await pollValidation(job, { intervalMs: 20, timeoutMs: 400 });
  assert.equal(r.verdict, "TIMEOUT");
  assert.equal(job.status, "cancelled");
  assert.equal(discardCandidate(cand).discarded, true);
  await new Promise((res) => setTimeout(res, 300));
});

test("repair patches: targeted edits apply exactly once; ambiguous or missing finds are rejected; full file is a fallback", () => {
  const src = "a = 1\nb = 2\na = 1\n";
  assert.deepEqual(extractPatch('```json\n{"edits":[{"find":"b = 2","replace":"b = 3"}]}\n```', src), { content: "a = 1\nb = 3\na = 1\n", format: "edits", edits: 1 });
  assert.equal(extractPatch('```json\n{"edits":[{"find":"a = 1","replace":"x"}]}\n```', src).reason, "EDIT_AMBIGUOUS");
  assert.equal(extractPatch('```json\n{"edits":[{"find":"zzz","replace":"x"}]}\n```', src).reason, "EDIT_NOT_FOUND");
  assert.equal(extractPatch('```json\n{"edits":[]}\n```', src).reason, "NO_EDITS");
  assert.equal(extractPatch("```javascript\nconst x = 1;\n```", src).format, "full_file");
  assert.equal(extractPatch("nothing", src).reason, "NO_PATCH");
});

test("lean Gate Keeper reviewer excludes the TrueForge operator contract but keeps checklist and severity rubric", () => {
  const g = armInstructions("gate_keeper");
  assert.ok(!/One coordinator, on-demand specialists|Non-negotiable closed-loop/.test(g));
  assert.match(g, /## Severity/);
  assert.match(g, /review-checklist/);
  assert.match(g, /## Adversarial method/, "the adversarial review method must stay in the default Gate Keeper reviewer");
  const lean = armInstructions("gate_keeper_lean");
  assert.ok(!/## Adversarial method/.test(lean) && /## Severity/.test(lean));
  assert.ok(g.indexOf("## Adversarial method") < g.indexOf("## Severity") && g.indexOf("## Severity") < g.indexOf("## Output"));
  assert.match(g, /untrusted input/); assert.match(g, /tenant and permission boundaries/);
  const native = readFileSync(join(ROOT, "agent", "native-trueforge-instructions.md"), "utf8");
  assert.match(native, /V-model validation/); assert.match(native, /Adversarial reviewer/);
});

test("gate adjudication counts only complete, unique index judgements", () => {
  const r = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", join(ROOT, "tests", "helpers", "gate-parse.mjs")], { cwd: ROOT, encoding: "utf8" }).trim());
  assert.deepEqual(r.ok, { confirmed: 1, rejected: 1 });
  assert.equal(r.partial, null); assert.equal(r.dup, null); assert.equal(r.range, null);
  assert.deepEqual(r.last, { confirmed: 1, rejected: 0 });
});

test("offline e2e (synthetic fake): a poll failure settles the reservation and the run still completes with evidence", () => {
  const r = e2e({ trials: 1, fake: { failPollAt: 3 } });
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  assert.equal(data.budget.reserved_usd, 0);
  assert.ok(r.lines.some((l) => l.startsWith("GK_PROOF_DONE=")));
  assert.equal(validatePublicProof(decodeChunks(r.lines, "GK_PROOF_PUBLIC_SUMMARY")).valid, true);
});

test("review mode is selectable, defaults to adversarial and fails closed on unknown values", async () => {
  const { resolveReviewMode, composeReviewerInstructions, DEFAULT_REVIEW_MODE } = await import("../scripts/review-mode.mjs");
  assert.equal(DEFAULT_REVIEW_MODE, "adversarial");
  assert.equal(resolveReviewMode({}), "adversarial");
  assert.equal(resolveReviewMode({ GK_REVIEW_MODE: "lean" }), "lean");
  assert.throws(() => resolveReviewMode({ GK_REVIEW_MODE: "fast" }), /REVIEW_MODE_REJECTED/);
  const dir = join(ROOT, "agent");
  assert.match(composeReviewerInstructions(dir, "adversarial"), /## Adversarial method/);
  assert.doesNotMatch(composeReviewerInstructions(dir, "lean"), /## Adversarial method/);
});

test("offline e2e (synthetic fake): three-arm comparison reports the lean arm alongside the default arm", () => {
  const r = e2e({ trials: 1, env: { GK_PROOF_ARMS: "baseline,gate_keeper,gate_keeper_lean", GK_PROOF_DRILL_ARMS: "gate_keeper,gate_keeper_lean", GK_PROOF_PHASE_SHARE: "0.5,0.15,0.35" } });
  const summary = decodeChunks(r.lines, "GK_PROOF_PUBLIC_SUMMARY");
  assert.equal(validatePublicProof(summary).valid, true);
  assert.equal(summary.arms.gate_keeper_lean.trials, 1);
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  assert.deepEqual(Object.keys(data.arms).sort(), ["baseline", "gate_keeper", "gate_keeper_lean"]);
  assert.deepEqual(Object.keys(data.drill.repair_success).sort(), ["gate_keeper", "gate_keeper_lean"]);
  assert.equal(data.drill.repair_success.gate_keeper.cycles, 6);
  assert.equal(data.budget.phase_caps_usd.drill, 3.5);
});

test("drill denylist: quoted strings like an allow-list are not imports; real imports of restricted modules are", async () => {
  const work = mkdtempSync(join(tmpdir(), "gk-t-"));
  const o = createFixtureRepo(fixture("escape"), work);
  const src = readFileSync(join(o.repo, o.vmodel.file), "utf8");
  const ok = applyBoundedPatch(cloneCandidate(o.repo, work, "allow"), o.vmodel, src + 'const SAFE = ["http", "https", "mailto"];\n');
  assert.equal(ok.applied, true, ok.reason);
  for (const evil of ['import fs from "fs";', 'import "node:http";', 'export { x } from "os";', 'const n = require ( "net" );', 'import fs from /**/ "node:fs";', 'import/**/"node:http";', 'import fs from // c\n "fs";'])
    assert.match(applyBoundedPatch(cloneCandidate(o.repo, work, "x" + Math.random().toString(36).slice(2)), o.vmodel, evil + "\n" + src).reason || "", /FORBIDDEN_API/, evil);
});

test("drill arms must include the default gate_keeper arm", () => {
  assert.throws(() => e2e({ trials: 1, env: { GK_PROOF_DRILL_ARMS: "baseline,gate_keeper_lean" } }), /DRILL_ARMS_INVALID/);
});

test("budget prices reported cache tokens at cache rates and aggregation reports them", () => {
  const b = new BudgetController({ capUsd: 1, phaseShare: PHASES, model: "anthropic/claude-sonnet-4-6" });
  const r = b.reserve("comparison", "c", 100, 100);
  const cost = b.settle(r, { totalInputTokens: 1000, totalOutputTokens: 100, totalCacheReadTokens: 2000, totalCacheWriteTokens: 0 });
  assert.equal(Math.round(cost * 1e6), Math.round((1000 * 3 + 2000 * 0.1 * 3 + 100 * 15)));
  assert.equal(b.snapshot().cost_sources.tokens_x_list_price_with_cache, 1);
  const task = { id: "t", holdout: false, expected: [{ line: 1, categories: ["bug"] }] };
  const m = aggregateArm("baseline", [{ arm: "baseline", trial: 1, task, findings: [], latency_ms: 1, metrics: { totalTokens: 10, totalInputTokens: 8, totalCacheReadTokens: 5 } }], {}, {});
  assert.equal(m.cache_read_tokens, 5); assert.equal(m.input_tokens, 8);
  assert.equal(m.cache_write_tokens, null, "unreported cache writes must be null, not 0");
});

test("offline e2e (synthetic fake): population learning - tenants' errors become shared rules that help a new tenant", () => {
  const r = e2e({ env: { GK_PROOF_MODE: "learn" }, fake: { learnedHelps: true } });
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  const L = data.learning;
  assert.deepEqual(L.stages, { dev_review: "PASS", tenant_lesson_capture: "PASS", population_ingestion: "PASS", qualification: "PASS", new_tenant_proof: "PASS" });
  assert.equal(L.tenants.contributing, 3);
  assert.ok(L.errors.false_alarms >= 5);
  assert.deepEqual(L.rules.map((x) => [x.accepted, x.rejection, x.independent_tenants]),
    [[true, null, 3], [false, "INSUFFICIENT_TENANT_SUPPORT", 1], [false, "CODE_OR_LINE_REFERENCE", 3]]);
  assert.ok(L.rules[0].text && !L.rules[1].text && /^[a-f0-9]{64}$/.test(L.rules[1].text_sha256), "rejected rule text must not be published");
  assert.ok(L.dev_after.false_positives < L.dev_before.false_positives);
  assert.equal(L.tenant_regressions, 0);
  assert.equal(L.security_issues_lost, 0);
  assert.ok(L.new_tenant.gate_keeper_learned.false_positives < L.new_tenant.gate_keeper.false_positives);
  assert.equal(L.new_tenant.gate_keeper_learned.matched_issues, L.new_tenant.gate_keeper.matched_issues);
  assert.equal(L.new_tenant.gate_keeper.findings_on_clean_tasks, 2);
  assert.equal(L.new_tenant.gate_keeper_learned.findings_on_clean_tasks, 1);
  const sel = L.core_selection[0];
  assert.equal(sel.selected, false);
  assert.deepEqual(sel.reasons.sort(), ["CORE_POLICY_DISABLED", "SECURITY_REVIEW_REQUIRED", "VERIFIER_SIGNATURE_REQUIRED"]);
  assert.deepEqual(Object.keys(data.budget.phase_caps_usd).sort(), ["dev", "learn", "prove", "qualify"]);
  assert.ok(data.sessions.filter((s) => s.role === "capture").length === 3, "one isolated capture session per tenant");
  assert.ok(!/SECRET_(HOLDOUT|UNSEEN)/.test(r.lines.join("\n")), "dev and unseen holdout content must never reach stdout");
  assert.ok(r.lines.some((l) => l.startsWith("GK_PROOF_DONE=")));
});

test("offline e2e (synthetic fake): non-consenting tenants stay private and cannot carry a shared rule", () => {
  const r = e2e({ env: { GK_PROOF_MODE: "learn", GK_LEARN_NON_CONSENTING: "tenant-a", GK_OWNER_ALLOWS_CORE_CANDIDATES: "1", GK_LEARN_PROVE_BASELINE: "0" }, fake: { learnedHelps: true } });
  const L = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA").learning;
  assert.deepEqual(Object.keys(L.new_tenant).sort(), ["gate_keeper", "gate_keeper_learned"]);
  assert.equal(L.tenant_lessons["tenant-a"].consenting, false);
  assert.ok(L.tenant_lessons["tenant-a"].lessons > 0, "lessons are still captured privately for the tenant");
  assert.equal(L.rules[0].independent_tenants, 2, "only consenting tenants count as support");
  assert.deepEqual(L.core_selection[0].reasons.sort(), ["SECURITY_REVIEW_REQUIRED", "VERIFIER_SIGNATURE_REQUIRED"]);
  const solo = decodeChunks(e2e({ env: { GK_PROOF_MODE: "learn", GK_LEARN_NON_CONSENTING: "tenant-a,tenant-b" }, fake: { learnedHelps: true } }).lines, "GK_PROOF_PUBLIC_DATA").learning;
  assert.equal(solo.stages.population_ingestion, "FAIL", "one consenting tenant cannot seed the shared rules");
  assert.throws(() => e2e({ env: { GK_PROOF_MODE: "learn", GK_LEARN_NON_CONSENTING: "tenant-zz" } }), /UNKNOWN_TENANT_IN_CONSENT_SETTING/);
});

test("offline e2e (synthetic fake): shared rules that do not cut false alarms fail qualification and never reach the new tenant", () => {
  const r = e2e({ env: { GK_PROOF_MODE: "learn" } });
  const L = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA").learning;
  assert.equal(L.stages.qualification, "FAIL");
  assert.equal(L.stages.new_tenant_proof, "NOT_RUN");
  assert.equal(L.new_tenant, undefined);
  assert.ok(L.core_selection.every((c) => c.selected === false));
});

test("learning: anonymisation filter, tenancy and verified support", async () => {
  const { ruleRejection, assignTenants, verifiedSupport } = await import("../scripts/proof/live/learn.mjs");
  const tasks = [{ filename: "orders.py", code: ["def list_orders(conn):", "  pageSize = 2"] }];
  assert.equal(ruleRejection("Only report a missing bound when no caller-side check limits the value.", tasks), null);
  assert.equal(ruleRejection("Check list_orders for offset errors before reporting anything.", tasks), "NAMES_A_TASK_IDENTIFIER");
  assert.equal(ruleRejection("The bug in orders.py is always the offset calculation.", tasks), "NAMES_A_TASK_FILE");
  assert.equal(ruleRejection("Look at line 12 first when reviewing anything here.", tasks), "CODE_OR_LINE_REFERENCE");
  assert.equal(ruleRejection("short", tasks), "LENGTH");
  assert.deepEqual(assignTenants([{ id: 1 }, { id: 2 }, { id: 3 }]).map((t) => t.tenant), ["tenant-a", "tenant-a", "tenant-b"]);
  const labels = new Map([["T1", "tenant-a"], ["T2", "tenant-b"]]);
  assert.deepEqual(verifiedSupport(["T1", "T1", "T2", "T9", 3], labels, new Set(["tenant-a"])), ["tenant-a"]);
  assert.throws(() => e2e({ env: { GK_PROOF_MODE: "learn", GK_PRIVATE_HOLDOUT_B64: "" } }), /UNSEEN_HOLDOUT_REQUIRED/);
  assert.throws(() => e2e({ env: { GK_PROOF_MODE: "fast" } }), /PROOF_MODE_INVALID/);
});

test("learning: qualification detects a swapped key issue (identity, not counts), including security", async () => {
  const { lostIssues } = await import("../scripts/proof/live/learn.mjs");
  const before = { "tenant-a": { matchedIds: new Set(["t1:E1", "t1:E2"]), securityIds: new Set(["t1:E1"]) } };
  const after = { "tenant-a": { matchedIds: new Set(["t1:E2", "t1:E3"]), securityIds: new Set() } };
  assert.deepEqual(lostIssues(before, after, ["tenant-a"], "matchedIds"), { "tenant-a": ["t1:E1"] });
  assert.deepEqual(lostIssues(before, after, ["tenant-a"], "securityIds"), { "tenant-a": ["t1:E1"] });
  assert.deepEqual(lostIssues(before, { "tenant-a": { matchedIds: new Set(["t1:E1", "t1:E2"]) } }, ["tenant-a"], "matchedIds"), { "tenant-a": [] });
});

test("adjudication can run on a different registered model, priced at that model's rates; unregistered adjudicator blocks", () => {
  const models = ["anthropic/claude-sonnet-5-5", "anthropic/claude-opus-5-5"];
  const r = e2e({ env: { GK_PROOF_MODE: "learn", GK_PROOF_ADJUDICATOR_MODEL: "anthropic/claude-opus-5-5" }, fake: { learnedHelps: true, models } });
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  assert.equal(data.adjudicator_model, "anthropic/claude-opus-5-5");
  const adj = data.sessions.filter((s) => s.role === "adjudicator");
  assert.ok(adj.length >= 3);
  assert.ok(data.limitations.some((l) => /different model \(anthropic\/claude-opus-5-5\)/.test(l)));
  const b = e2e({ env: { GK_PROOF_ADJUDICATOR_MODEL: "anthropic/claude-opus-5-5" }, fake: { models: ["anthropic/claude-sonnet-5-5"] } });
  assert.equal(b.out.blocked, "ADJUDICATOR_MODEL_NOT_REGISTERED");
  assert.equal(b.calls, 0);
});

test("budget reserves and settles each call at its own model's price", () => {
  const b = new BudgetController({ capUsd: 5, phaseShare: PHASES, model: "anthropic/claude-sonnet-4-6" });
  const s = b.reserve("adjudication", "s", 3000, 1000), o = b.reserve("adjudication", "o", 3000, 1000, "anthropic/claude-opus-5-5");
  assert.ok(o.amount > s.amount * 1.3);
  assert.equal(b.settle(o, { totalInputTokens: 1e6, totalOutputTokens: 0 }), 4);
  assert.equal(b.settle(s, { totalInputTokens: 1e6, totalOutputTokens: 0 }), 3);
});

test("model comparison arms: method@model runs the same method on another registered model; drill @model selects the repairer", () => {
  const models = ["anthropic/claude-sonnet-5-5", "anthropic/claude-fable-5-1", "anthropic/claude-haiku-5-5", "anthropic/claude-opus-5-5"];
  const r = e2e({ trials: 1, fake: { models }, env: { GK_PROOF_ARMS: "baseline,gate_keeper,gate_keeper@anthropic/claude-haiku-5-5",
    GK_PROOF_DRILL_ARMS: "gate_keeper,gate_keeper@anthropic/claude-opus-5-5", GK_PROOF_ADJUDICATOR_MODEL: "anthropic/claude-opus-5-5" } });
  const summary = decodeChunks(r.lines, "GK_PROOF_PUBLIC_SUMMARY");
  assert.equal(validatePublicProof(summary).valid, true);
  assert.equal(summary.environment.arm_models["gate_keeper@anthropic/claude-haiku-5-5"], "anthropic/claude-haiku-5-5");
  assert.equal(summary.environment.arm_models.gate_keeper, "anthropic/claude-sonnet-5-5");
  assert.equal(summary.arms["gate_keeper@anthropic/claude-haiku-5-5"].trials, 1);
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  assert.deepEqual(Object.keys(data.drill.repair_success).sort(), ["gate_keeper", "gate_keeper@anthropic/claude-opus-5-5"]);
  assert.ok(summary.limitations.some((l) => /Model-comparison arms/.test(l)));
  assert.throws(() => e2e({ env: { GK_PROOF_ARMS: "baseline,gate_keeper,gate_keeper@not a model" } }), /PROOF_ARMS_INVALID/);
  const blocked = e2e({ env: { GK_PROOF_ARMS: "baseline,gate_keeper,gate_keeper@anthropic/claude-haiku-5-5" } });
  assert.equal(blocked.out.blocked, "MODEL_NOT_REGISTERED");
  assert.equal(blocked.calls, 0);
});

test("current list prices: Sonnet 5.5, Opus 5.5, Haiku 5.5 and Fable resolve to their own rates", async () => {
  const { priceFor } = await import("../scripts/proof/live/budget.mjs");
  assert.deepEqual(priceFor("anthropic/claude-sonnet-5-5"), [2, 10]);
  assert.deepEqual(priceFor("anthropic/claude-opus-5-5"), [4, 20]);
  assert.deepEqual(priceFor("anthropic/claude-haiku-5-5"), [0.1, 0.5]);
  assert.deepEqual(priceFor("anthropic/claude-fable-5-1"), [10, 50]);
  assert.deepEqual(priceFor("anthropic/claude-sonnet-4-6"), [3, 15]);
});

test("a learning model that is not a registered id (e.g. missing provider prefix) blocks before any spend", () => {
  const r = e2e({ env: { GK_PROOF_MODE: "learn", GK_PROOF_LEARNING_MODEL: "claude-opus-5-5" } });
  assert.equal(r.out.blocked, "MODEL_NOT_REGISTERED");
  assert.equal(r.calls, 0);
});

test("locked baseline: per-role models in agent/models.json are the harness defaults; the baseline record names its source run", () => {
  const roles = JSON.parse(readFileSync(join(ROOT, "agent", "models.json"), "utf8")).roles;
  assert.equal(roles.reviewer.model, "anthropic/claude-sonnet-5-5");
  assert.equal(roles.adjudicator.model, "anthropic/claude-fable-5-1");
  assert.notEqual(roles.adjudicator.model, roles.reviewer.model, "the grader must never be the model under test");
  assert.equal(JSON.parse(readFileSync(join(ROOT, "agent", "agent.json"), "utf8")).model.name, roles.reviewer.model);
  const r = e2e({ env: { GK_PROOF_MODE: "learn" }, fake: { learnedHelps: true } });
  const data = decodeChunks(r.lines, "GK_PROOF_PUBLIC_DATA");
  assert.equal(data.candidate_model, roles.reviewer.model);
  assert.equal(data.adjudicator_model, roles.adjudicator.model);
  assert.equal(data.learning_model, roles.learning.model);
  const baseline = JSON.parse(readFileSync(join(ROOT, "proof", "baseline.json"), "utf8"));
  assert.equal(baseline.source_run, "gk-live-20261101-g");
  assert.ok(existsSync(join(ROOT, baseline.report)));
  assert.equal(baseline.metrics.gate_keeper_sonnet_5_5.matched_issues, baseline.metrics.gate_keeper_sonnet_5_5.expected_issues);
});

test("the repair role model is read: bare drill arms repair with it, @model drill arms with their own; it is registration-checked", () => {
  const models = ["anthropic/claude-sonnet-5-5", "anthropic/claude-fable-5-1", "anthropic/claude-opus-5-5", "anthropic/claude-haiku-5-5"];
  const r = e2e({ trials: 1, fake: { models }, env: { GK_PROOF_REPAIR_MODEL: "anthropic/claude-opus-5-5", GK_PROOF_DRILL_ARMS: "gate_keeper,gate_keeper@anthropic/claude-haiku-5-5" } });
  const summary = decodeChunks(r.lines, "GK_PROOF_PUBLIC_SUMMARY");
  assert.deepEqual(summary.environment.drill_arm_repair_models, { gate_keeper: "anthropic/claude-opus-5-5", "gate_keeper@anthropic/claude-haiku-5-5": "anthropic/claude-haiku-5-5" });
  const blocked = e2e({ env: { GK_PROOF_REPAIR_MODEL: "anthropic/claude-haiku-5-5" }, fake: { models: ["anthropic/claude-sonnet-5-5", "anthropic/claude-fable-5-1"] } });
  assert.equal(blocked.out.blocked, "MODEL_NOT_REGISTERED");
  assert.equal(blocked.calls, 0);
});

test("TrueForge may be any approved https host reached with a token; unapproved hosts or a missing token are refused", () => {
  const ok = e2e({ trials: 1, env: { TRUEFORGE_BASE_URL: "https://forge.example.org", GK_TRUEFORGE_APPROVED_HOSTS: "forge.example.org", TRUEFORGE_TOKEN: "t" } });
  assert.equal(decodeChunks(ok.lines, "GK_PROOF_PUBLIC_DATA").preflight.base_url_kind, "approved-https");
  assert.throws(() => e2e({ env: { TRUEFORGE_BASE_URL: "https://forge.example.org", GK_TRUEFORGE_APPROVED_HOSTS: "forge.example.org" } }), /TRUEFORGE_URL_NOT_APPROVED/);
  assert.throws(() => e2e({ env: { TRUEFORGE_BASE_URL: "http://forge.example.org", GK_TRUEFORGE_APPROVED_HOSTS: "forge.example.org", TRUEFORGE_TOKEN: "t" } }), /TRUEFORGE_URL_NOT_APPROVED/);
});

test("gateway models resolve to their own list prices", async () => {
  const { priceFor } = await import("../scripts/proof/live/budget.mjs");
  assert.deepEqual(priceFor("openai/gpt-6.1-terra"), [1, 5]);
  assert.deepEqual(priceFor("openai/gpt-6-luna"), [0.1, 0.5]);
  assert.deepEqual(priceFor("google/gemini-3.8-flash"), [0.75, 3.75]);
  assert.deepEqual(priceFor("google/gemini-3.5-flash-lite"), [0.3, 2.5]);
  assert.deepEqual(priceFor("google/gemini-4-argon"), [2, 10]);
  assert.deepEqual(priceFor("deepseek/deepseek-v4-pro"), [1.32, 3.96]);
});

test("inventory mode: read-only, no model calls, provider route reported without any secret", () => {
  const r = e2e({ env: { GK_PROOF_MODE: "inventory" } });
  assert.equal(r.calls, 0);
  const line = r.lines.find((l) => l.startsWith("GK_PROOF_INVENTORY="));
  const inv = JSON.parse(line.split("=").slice(1).join("="));
  assert.deepEqual(inv.providers, [{ name: "anthropic-direct", type: "anthropic", endpoint_host: "api.anthropic.com", models: 2, auth_configured: true }]);
  assert.equal(inv.models[0].provider, "anthropic-direct");
  assert.ok(!/SECRET_/.test(r.lines.join("\n")), "no credential or URL parameter may reach stdout");
});

test("inventory still reports provider routes when the reviewer model is not registered", () => {
  const r = e2e({ env: { GK_PROOF_MODE: "inventory" }, fake: { models: ["openai/other"] } });
  assert.equal(r.calls, 0);
  assert.ok(r.lines.some((l) => l.startsWith("GK_PROOF_INVENTORY=")));
  assert.ok(!r.lines.some((l) => l.startsWith("GK_PROOF_BLOCKED=")));
});

test("provider-remove: deletes exactly the named provider (no model calls), confirms it is gone, never prints secrets", () => {
  const r = e2e({ env: { GK_PROOF_MODE: "provider-remove", GK_REMOVE_PROVIDER: "anthropic-direct" } });
  assert.equal(r.calls, 0);
  const line = r.lines.find((l) => l.startsWith("GK_PROOF_PROVIDER_REMOVED="));
  const res = JSON.parse(line.split("=").slice(1).join("="));
  assert.equal(res.removed, "anthropic-direct");
  assert.equal(res.providers_before.length, 1);
  assert.deepEqual(res.providers_after, []);
  assert.ok(!/SECRET_/.test(r.lines.join("\n")));
  assert.throws(() => e2e({ env: { GK_PROOF_MODE: "provider-remove", GK_REMOVE_PROVIDER: "not-there" } }), /PROVIDER_REMOVE_TARGET_NOT_FOUND/);
});

test("provider-remove fails closed when the provider is still listed after delete", () => {
  assert.throws(() => e2e({ env: { GK_PROOF_MODE: "provider-remove", GK_REMOVE_PROVIDER: "anthropic-direct" }, fake: { deleteNoop: true } }), /PROVIDER_REMOVE_NOT_CONFIRMED/);
});

test("learning: rules are asked for in at most 40 words; length check allows a full sentence but rejects merged essays", async () => {
  const { ruleRejection, LEARN_SELECT, MAX_RULE_WORDS } = await import("../scripts/proof/live/learn.mjs");
  assert.match(LEARN_SELECT, new RegExp(`at most ${MAX_RULE_WORDS} words`));
  const sentence = "Only report an unvalidated input as a defect when it reaches a sensitive sink and no earlier guard, schema or type check constrains it, and say which input reaches it.";
  assert.equal(ruleRejection(sentence, []), null);
  assert.equal(ruleRejection(Array(80).fill("word").join(" "), []), "LENGTH");
});
