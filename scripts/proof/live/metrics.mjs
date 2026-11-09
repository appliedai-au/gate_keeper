// Pure measurement helpers: parse candidate findings, blind them for the
// adjudicator, apply adjudications and aggregate per-arm metrics. Nothing here
// talks to a model; everything is unit-tested.
import { randomBytes, randomInt } from "node:crypto";
import { CATEGORIES, SEVERITIES, severityFor } from "./config.mjs";

/** Last ```json block (or bare JSON). The frozen historical location
 * scorer is not edited, but NEW benchmark adjudication rejects malformed
 * findings rather than silently filtering invalid or invented fields. */
export function parseFindingsWithSeverity(reply) {
  const blocks = [...String(reply || "").matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const candidate = blocks.length ? blocks[blocks.length - 1] : reply;
  try {
    const obj = JSON.parse(String(candidate).trim());
    if (!obj || !Array.isArray(obj.findings) || obj.findings.length > 100) return null;
    const findings = [];
    for (const f of obj.findings) {
      if (!f || typeof f !== "object" || Array.isArray(f) ||
          !Number.isSafeInteger(f.line) || f.line < 1 ||
          typeof f.category !== "string" || typeof f.severity !== "string" ||
          typeof f.comment !== "string" || !f.comment.trim() ||
          f.comment.length > 1200) return null;
      const item = { line: f.line, category: f.category.toLowerCase().trim(),
        severity: f.severity.toLowerCase().trim(), comment: f.comment };
      if (!validFinding(item)) return null;
      findings.push(item);
    }
    return findings;
  } catch { return null; }
}

export function shuffle(xs) {
  const a = [...xs];
  for (let i = a.length - 1; i > 0; i--) { const j = randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/**
 * Blind every finding for one task across all arms and trials. The adjudicator
 * receives only opaque ids, line, category, severity and comment, in random
 * order. The unblinding key stays with the evaluator.
 */
export function blindTask(taskId, replies) {
  const items = [];
  const key = {};
  for (const r of replies) {
    (r.findings || []).forEach((f, index) => {
      const id = "f_" + randomBytes(5).toString("hex");
      key[id] = { arm: r.arm, trial: r.trial, task_id: taskId, index };
      items.push({ id, line: f.line, category: f.category, severity: f.severity, comment: f.comment });
    });
  }
  return { items: shuffle(items), key };
}

export function answerKey(task) {
  return task.expected.map((e, i) => ({
    expected_id: "E" + (i + 1), line: e.line, categories: e.categories, why: e.why, severity: severityFor(task, e),
  }));
}

/** Validate the adjudicator's JSON. Unknown ids or expected ids are rejected. */
export function parseAdjudication(reply, blindedIds, expectedIds) {
  const blocks = [...String(reply || "").matchAll(/```json\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  const candidate = blocks.length ? blocks[blocks.length - 1] : reply;
  let obj;
  try { obj = JSON.parse(String(candidate).trim()); } catch { return { ok: false, reason: "UNPARSEABLE" }; }
  if (!obj || !Array.isArray(obj.judgements)) return { ok: false, reason: "NO_JUDGEMENTS" };
  const out = {};
  for (const j of obj.judgements) {
    if (!j || !blindedIds.has(j.id)) continue;
    const matches = j.matches === null || j.matches === undefined || j.matches === "" ? null : String(j.matches);
    if (matches !== null && !expectedIds.has(matches)) continue;
    out[j.id] = {
      matches,
      real_defect: matches !== null ? true : j.real_defect === true,
      explanation_correct: matches !== null ? j.explanation_correct === true : null,
    };
  }
  const missing = [...blindedIds].filter((id) => !(id in out));
  return { ok: missing.length === 0, judgements: out, missing };
}

/** Deterministic line/category matcher used as a cross-check on the adjudicator. */
export function deterministicMatch(task, finding) {
  const key = answerKey(task);
  const hit = key.find((e) => Math.abs(e.line - finding.line) <= 1 && e.categories.includes(finding.category));
  return hit ? hit.expected_id : null;
}

const median = (xs) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const ratio = (a, b) => (b ? Math.round((a / b) * 1e4) / 1e4 : null);
function jaccard(a, b) {
  if (!a.size && !b.size) return 1;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/**
 * results: [{arm, trial, task, findings|null, latency_ms, metrics, status}]
 * judgements: {blindId -> judgement}, key: {blindId -> {arm, trial, task_id, index}}
 */
export function aggregateArm(arm, results, judgements, key, { holdoutOnly = null } = {}) {
  const rows = results.filter((r) => r.arm === arm && (holdoutOnly === null || !!r.task.holdout === holdoutOnly));
  const lookup = new Map();
  for (const [id, k] of Object.entries(key)) lookup.set(`${k.arm}|${k.trial}|${k.task_id}|${k.index}`, id);
  let expected = 0, matchedFirst = 0, tp = 0, fp = 0, dup = 0, unlisted = 0, explOk = 0, sevOk = 0, unjudged = 0;
  let parseFail = 0, detAgree = 0, detTotal = 0, tokens = 0, cost = 0, tokensKnown = true, costKnown = true;
  const acc = { inputTok: [0, true], cacheRead: [0, true], cacheWrite: [0, true] };
  const add = (k, v) => { if (Number.isFinite(v)) acc[k][0] += v; else acc[k][1] = false; };
  const latencies = [], perTaskSets = new Map(), perTrialRecall = new Map();
  for (const r of rows) {
    const ak = answerKey(r.task);
    expected += ak.length;
    const seen = new Set();
    if (r.findings === null) parseFail++;
    (r.findings || []).forEach((f, index) => {
      const id = lookup.get(`${r.arm}|${r.trial}|${r.task.id}|${index}`);
      const j = id ? judgements[id] : undefined;
      if (!j) { unjudged++; return; }
      const det = deterministicMatch(r.task, f);
      detTotal++; if (det === j.matches) detAgree++;
      if (j.matches) {
        if (seen.has(j.matches)) { dup++; return; }
        seen.add(j.matches); matchedFirst++; tp++;
        if (j.explanation_correct) explOk++;
        const want = ak.find((e) => e.expected_id === j.matches).severity;
        if (f.severity === want) sevOk++;
      } else if (j.real_defect) { tp++; unlisted++; }
      else fp++;
    });
    latencies.push(r.latency_ms);
    const t = r.metrics?.totalTokens; if (Number.isFinite(t)) tokens += t; else tokensKnown = false;
    add("cacheRead", r.metrics?.totalCacheReadTokens); add("cacheWrite", r.metrics?.totalCacheWriteTokens); add("inputTok", r.metrics?.totalInputTokens);
    const c = r.metrics?.totalCostInUsd; if (Number.isFinite(c)) cost += c; else costKnown = false;
    if (!perTaskSets.has(r.task.id)) perTaskSets.set(r.task.id, []);
    perTaskSets.get(r.task.id).push(seen);
    const pt = perTrialRecall.get(r.trial) || { m: 0, e: 0 };
    pt.m += seen.size; pt.e += ak.length; perTrialRecall.set(r.trial, pt);
  }
  const jac = [];
  for (const sets of perTaskSets.values())
    for (let i = 0; i < sets.length; i++) for (let k = i + 1; k < sets.length; k++) jac.push(jaccard(sets[i], sets[k]));
  const trialRecalls = [...perTrialRecall.values()].map((x) => (x.e ? x.m / x.e : 0));
  const mean = trialRecalls.reduce((s, x) => s + x, 0) / (trialRecalls.length || 1);
  const sd = Math.sqrt(trialRecalls.reduce((s, x) => s + (x - mean) ** 2, 0) / (trialRecalls.length || 1));
  const trials = new Set(rows.map((r) => r.trial)).size;
  return {
    trials, turns: rows.length,
    // If adjudicator decisions are missing, numerators are incomplete and
    // false-positive denominators are unknowable. Never publish optimistic
    // recall or precision as complete quality metrics.
    defect_recall: unjudged ? null : ratio(matchedFirst, expected),
    precision: unjudged ? null : ratio(tp, tp + fp),
    explanation_correctness: unjudged ? null : ratio(explOk, matchedFirst),
    explanation_validated_precision: unjudged ? null : ratio(explOk, tp + fp),
    unsupported_explanations: matchedFirst - explOk,
    adjudication_complete: unjudged === 0 && parseFail === 0,
    severity_accuracy: ratio(sevOk, matchedFirst),
    median_latency_ms: median(latencies),
    total_tokens: tokensKnown && rows.length ? tokens : null,
    // null = not reported for every turn (unknown), never silently 0.
    input_tokens: acc.inputTok[1] && rows.length ? acc.inputTok[0] : null,
    cache_read_tokens: acc.cacheRead[1] && rows.length ? acc.cacheRead[0] : null,
    cache_write_tokens: acc.cacheWrite[1] && rows.length ? acc.cacheWrite[0] : null,
    trueforge_estimated_cost_usd: costKnown && rows.length ? Math.round(cost * 1e6) / 1e6 : null,
    expected_issues: expected, matched_issues: matchedFirst, true_positives: tp, false_positives: fp,
    duplicates: dup, unlisted_real_defects: unlisted, unjudged_findings: unjudged, unparseable_replies: parseFail,
    reproducibility_mean_jaccard: jac.length ? Math.round((jac.reduce((s, x) => s + x, 0) / jac.length) * 1e4) / 1e4 : null,
    recall_stdev_across_trials: trials > 1 ? Math.round(sd * 1e4) / 1e4 : null,
    adjudicator_deterministic_agreement: ratio(detAgree, detTotal),
  };
}

export function validFinding(f) {
  return Number.isInteger(f.line) && f.line > 0 && CATEGORIES.includes(f.category) && SEVERITIES.includes(f.severity);
}
