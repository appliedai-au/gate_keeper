// Shared review and blinded-adjudication steps. The comparison run and the
// learning run both use these, so every arm in every phase is reviewed and
// graded the same way.
import { gunzipSync } from "node:zlib";
import { scoreTask } from "../../../evals/score.ts";
import { REVIEW_PARAMS, RUNTIME_CONFIG, sha256 } from "./config.mjs";
import { answerKey, blindTask, parseAdjudication, parseFindingsWithSeverity, shuffle } from "./metrics.mjs";

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

export const numbered = (lines) => { const w = String(lines.length).length; return lines.map((l, i) => `${String(i + 1).padStart(w)} | ${l}`).join("\n"); };
export function taskPrompt(t) {
  return [`Review this change. File: \`${t.filename}\`. What the change does: ${t.context}`, "",
    "Line numbers are on the left of the `|`.", "", "```" + t.language, numbered(t.code), "```"].join("\n");
}

/** Owner-private holdout: gzip+base64 JSON task list. */
export function decodeHoldout(b64) {
  if (!b64) return { tasks: [], sha256: null };
  const raw = gunzipSync(Buffer.from(b64, "base64"));
  const tasks = JSON.parse(raw.toString("utf8"));
  if (!Array.isArray(tasks) || !tasks.every((t) => t.id && Array.isArray(t.code) && Array.isArray(t.expected))) throw new Error("HOLDOUT_INVALID");
  return { tasks: tasks.map((t) => ({ ...t, holdout: true })), sha256: sha256(raw) };
}

/**
 * Review every task with every arm, interleaved and shuffled, `trials` times.
 * instructionsFor(arm) gives each arm's full system instructions.
 * Returns all results and the trials that completed without a budget/deadline stop.
 */
export async function reviewTasks({ tasks, arms, instructionsFor, trials = 1, phase, model, callTurn, newSession, limitations, tag = "" }) {
  const results = [], completeTrials = [];
  for (let trial = 1; trial <= trials; trial++) {
    const sessionByArm = {};
    for (const arm of arms) sessionByArm[arm] = await newSession(
      { model: { name: model, params: REVIEW_PARAMS }, instructions: instructionsFor(arm), config: RUNTIME_CONFIG }, { phase, arm, trial });
    let complete = true;
    for (const task of shuffle(tasks)) {
      for (const arm of shuffle(arms)) {
        const out = await callTurn(phase, `${tag}${arm}/t${trial}/${task.id}`, sessionByArm[arm], taskPrompt(task), instructionsFor(arm).length, REVIEW_PARAMS.maxTokens);
        if (out.refused) { complete = false; break; }
        const findings = out.status === "done" ? parseFindingsWithSeverity(out.text) : null;
        results.push({ arm, trial, task, findings, latency_ms: out.latency_ms, metrics: out.metrics, status: out.status, turn_id: out.turnId,
          session_id: sessionByArm[arm], reply: out.text, deterministic: scoreTask(task, out.text || "") });
      }
      if (!complete) break;
    }
    if (complete) completeTrials.push(trial);
    else { limitations.push(`${tag || phase}: trial ${trial} stopped early (budget or deadline); only complete trials are scored`); break; }
  }
  return { results, completeTrials };
}

/** Blind every finding per task and have a separate adjudicator session grade it against the key. */
export async function adjudicateTasks({ tasks, scored, phase, model, callTurn, newSession, ev, evPrefix = "private/adjudication" }) {
  const judgements = {}, blindKey = {};
  let session = null;
  for (const task of tasks) {
    const replies = scored.filter((r) => r.task.id === task.id).map((r) => ({ arm: r.arm, trial: r.trial, findings: r.findings }));
    const { items, key } = blindTask(task.id, replies);
    Object.assign(blindKey, key);
    if (!items.length) continue;
    session ||= await newSession({ model: { name: model, params: { temperature: 0, maxTokens: 3000 } }, instructions: ADJUDICATOR, config: RUNTIME_CONFIG }, { phase, role: "adjudicator" });
    const ak = answerKey(task);
    for (let i = 0; i < items.length; i += 30) {
      const chunk = items.slice(i, i + 30);
      const prompt = ["Code under review:", "```" + task.language, numbered(task.code), "```", "", "Answer key:", "```json", JSON.stringify(ak.map(({ severity, ...e }) => e), null, 1), "```", "",
        "Findings to judge (anonymised, shuffled):", "```json", JSON.stringify(chunk, null, 1), "```"].join("\n");
      let ids = new Set(chunk.map((c) => c.id));
      for (let attempt = 0; attempt < 2 && ids.size; attempt++) {
        const out = await callTurn(phase, `adjudicate/${task.id}/${i}/${attempt}`, session, prompt + (attempt ? `\n\nJudge ONLY these ids: ${[...ids].join(", ")}` : ""), ADJUDICATOR.length, 3000);
        if (out.refused) break;
        const parsed = parseAdjudication(out.text, ids, new Set(ak.map((e) => e.expected_id)));
        ev.put(`${evPrefix}/${task.id}-${i}-${attempt}.json`, { reply: out.text, turn_id: out.turnId, parsed }, "adjudication");
        Object.assign(judgements, parsed.judgements || {});
        ids = new Set([...ids].filter((id) => !(id in judgements)));
      }
    }
  }
  return { judgements, blindKey };
}

/** Per-result error list from adjudication: false alarms (judged not real) and missed key issues. */
export function reviewErrors(result, judgements, blindKey) {
  const lookup = new Map();
  for (const [id, k] of Object.entries(blindKey)) lookup.set(`${k.arm}|${k.trial}|${k.task_id}|${k.index}`, id);
  const falseAlarms = [], matched = new Set();
  (result.findings || []).forEach((f, index) => {
    const j = judgements[lookup.get(`${result.arm}|${result.trial}|${result.task.id}|${index}`)];
    if (!j) return;
    if (j.matches) matched.add(j.matches);
    else if (!j.real_defect) falseAlarms.push(f);
  });
  const misses = answerKey(result.task).filter((e) => !matched.has(e.expected_id));
  return { falseAlarms, misses };
}
