import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BudgetController } from "../scripts/proof/live/budget.mjs";
import { armInstructions, instructionHashes, OUTPUT_CONTRACT, ROOT } from "../scripts/proof/live/config.mjs";
import { aggregateArm, blindTask, parseAdjudication, parseFindingsWithSeverity } from "../scripts/proof/live/metrics.mjs";
import { applyBoundedPatch, cloneCandidate, createFixtureRepo, discardCandidate, pollValidation, startValidation, verifyOrigin } from "../scripts/proof/live/drill.mjs";
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
  assert.ok(money.length === 2 && money.every((c) => c.outcome === "CANDIDATE" && c.attempts[0].verdict === "PASS" && c.origin_unchanged === true), JSON.stringify(money));
  const naive = data.drill.cycles.filter((c) => c.fixture === "uploads");
  assert.ok(naive.every((c) => c.outcome === "REVERTED" && c.attempts.length === 2 && c.attempts.every((a) => a.patch_applied && a.verdict === "FAIL" && a.discarded === true)), JSON.stringify(naive));
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
  assert.throws(() => e2e({ env: { TRUEFORGE_BASE_URL: "https://example.com" } }), /PRIVATE_TRUEFORGE_URL_REQUIRED/);
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
