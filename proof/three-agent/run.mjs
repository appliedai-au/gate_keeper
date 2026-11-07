// Three-agent review test on stock TrueForge -> DeepSeek via TrueFoundry. Equal limits for every agent.
import { gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const { TrueForge } = globalThis.GK3_SDK ?? await import("@truefoundry/trueforge-sdk");
// Model-agnostic: the same sealed tasks and locked agents rerun on any TrueFoundry model.
const MODEL = process.env.GK3_MODEL || "tfy-direct/deepseek-v4-flash-0731"; // boot.mjs sets this to the proxied provider
const PRICE = (process.env.GK3_PRICE_PER_MTOK || "0.3,1.2").split(",").map(Number);
const CAP = Number(process.env.GK3_CAP_USD || "0.5"), TRIALS = Number(process.env.GK3_TRIALS || "1");
const ARMS = (process.env.GK3_ARMS || "codex,qodo,gate_keeper").split(",");
const CONC = Number(process.env.GK3_CONCURRENCY || "3");
const P = JSON.parse(gunzipSync(Buffer.from(process.env.GK3_PAYLOAD_B64, "base64")).toString("utf8"));
// GK3_GK_SYSTEM (set by the launcher from a prompt file at the pinned commit): replaces Gate Keeper's system prompt only.
// Codex and Qodo prompts are untouched. The override's hash is logged so every run names the exact prompt it used.
if (process.env.GK3_GK_SYSTEM) { P.agents.gate_keeper.system = process.env.GK3_GK_SYSTEM; P.sha256 = { ...(P.sha256 || {}), gate_keeper: createHash("sha256").update(process.env.GK3_GK_SYSTEM).digest("hex") };
  console.log("GK3_GK_OVERRIDE " + JSON.stringify({ file: process.env.GK3_GK_FILE || null, sha256: P.sha256.gate_keeper, chars: process.env.GK3_GK_SYSTEM.length })); }
// GK3_GK_SYSTEM_B: a second Gate Keeper variant run as its own arm ("gate_keeper_b") on the same prompts, so two prompt versions
// can be compared in one run. Same harness treatment as gate_keeper (line merge included).
if (process.env.GK3_GK_SYSTEM_B) { P.agents.gate_keeper_b = { system: process.env.GK3_GK_SYSTEM_B }; for (const t of P.tasks) t.prompts.gate_keeper_b = t.prompts.gate_keeper;
  P.sha256 = { ...(P.sha256 || {}), gate_keeper_b: createHash("sha256").update(process.env.GK3_GK_SYSTEM_B).digest("hex") };
  console.log("GK3_GK_OVERRIDE_B " + JSON.stringify({ file: process.env.GK3_GK_FILE_B || null, sha256: P.sha256.gate_keeper_b, chars: process.env.GK3_GK_SYSTEM_B.length })); }
const tf = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL, token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 60 });
let spent = 0, reserved = 0, calls = 0;
// Same for every agent. Reviews are non-interactive: no one can answer TrueForge's built-in ask_user_question
// tool, and a call to it ends the turn with no answer (seen in practice run 2). Everything else stays stock.
const RUNTIME = { askUserQuestions: { enabled: false } };
const est = (chars, out) => ((chars / 3 + 3000) * PRICE[0] + out * PRICE[1]) / 1e6;
// Budget guard only: tokens of output reserved per in-flight call (default maxTokens). Real cost comes from turn metrics.
const RESERVE_OUT = Number(process.env.GK3_RESERVE_OUT || "0");
// Response cache (GK3_CACHE_DIR, a Railway volume): the same model, instructions, prompt, temperature, max tokens and
// trial number return the stored reply, so runs 2, 3, 4 only pay for calls whose inputs changed. Same for every agent.
// A cached row keeps the original call's cost and time, so per-review numbers stay comparable; only `spent` skips it.
import { mkdirSync, readFileSync as rfs, writeFileSync as wfs, existsSync } from "node:fs";
let CACHE = process.env.GK3_CACHE_DIR || "";
if (CACHE) { try { mkdirSync(CACHE, { recursive: true }); wfs(CACHE + "/.probe", "1"); } catch (e) { console.log("GK3_CACHE_OFF " + String(e?.code || e)); CACHE = ""; } }
let hits = 0;
// Key = inputs + trial + any per-sample suffix after /t<n> (vote's a/b samples stay distinct).
const cacheKey = (label, model, instructions, prompt, temperature, maxTokens) => {
  const m = label.match(/\/t(\d+)((?:\/.*)?)$/) || [], k = [model, temperature, maxTokens, instructions, prompt, m[1] || "1"];
  if (m[2]) k.push(m[2]);
  return createHash("sha256").update(JSON.stringify(k)).digest("hex");
};
async function turn(label, instructions, prompt, model = MODEL, tempOverride = null) {
  const { maxTokens } = P.params; const temperature = tempOverride ?? P.params.temperature;
  const ck = CACHE ? CACHE + "/" + cacheKey(label, model, instructions, prompt, temperature, maxTokens) + ".json" : "";
  if (ck && existsSync(ck)) { try { const c = JSON.parse(rfs(ck, "utf8")); hits++; return { ...c, label, cached: true }; } catch {} }
  const r = await turnLive(label, instructions, prompt, model, temperature, maxTokens);
  if (ck && r.status === "done" && r.text) { try { wfs(ck, JSON.stringify(r)); } catch {} }
  return r;
}
async function turnLive(label, instructions, prompt, model, temperature, maxTokens) {
  const reserve = est(instructions.length + prompt.length, RESERVE_OUT || maxTokens);
  if (spent + reserved + reserve > CAP) return { label, status: "BUDGET_STOP", text: "" };
  reserved += reserve; calls++;
  const t0 = Date.now();
  let sid = null, st = null, tid = null;
  try {
    const s = await tf.sessions.create({ agent: { spec: { model: { name: model, params: { temperature, maxTokens } }, instructions, config: RUNTIME } },
      metadata: { purpose: "gk-three-agent-" + P.set, label } });
    sid = s.data.id;
    let t = (await tf.sessions.createTurn(sid, { input: [{ type: "user.message", content: prompt }], previousTurnId: "none" }, { maxRetries: 0 })).data;
    for (let i = 0; i < 400 && !["done", "error", "failed", "cancelled"].includes(t?.state?.status); i++) {
      await new Promise((r) => setTimeout(r, 1500)); t = (await tf.sessions.getTurn(sid, t.id)).data;
    }
    tid = t?.id ?? null; st = t?.state;
  } catch (e) { st = { status: "EXCEPTION", error: String(e?.message || e).slice(0, 300) }; }
  if (st?.status !== "done" && sid) { try { await tf.sessions.cancel(sid); } catch {} }
  const o = st?.output, m = st?.metrics ?? null;
  const cost = Number.isFinite(m?.totalCostInUsd) ? m.totalCostInUsd :
    Number.isFinite(m?.totalInputTokens) ? (m.totalInputTokens * PRICE[0] + (m.totalOutputTokens || 0) * PRICE[1]) / 1e6 : reserve;
  reserved -= reserve; spent += cost;
  let text = typeof o?.content === "string" ? o.content : Array.isArray(o?.content) ? o.content.map((x) => x?.text || "").join("") : "";
  let source = text ? "output" : "none", streamReasoningChars = 0; // reasoning is never scored: diagnostics only
  // Same fallback for every agent: if the final message is empty, rebuild the text from the turn's streamed deltas.
  if (!text && sid && st?.status === "done") {
    try {
      if (tid) { let acc = "", rc = "";
        const seen = [];
        for await (const ev of await tf.sessions.listTurnEvents(sid, tid)) {
          if (ev?.type !== "model.message.delta") seen.push(ev?.type + (ev?.toolCalls?.length ? "[" + ev.toolCalls.map((c) => c?.function?.name ?? c?.name).join(",") + "]" : "") + (ev?.finishReason ? "(" + ev.finishReason + ")" : ""));
          else if (ev?.toolCalls?.length) seen.push("delta-toolcall[" + ev.toolCalls.map((c) => c?.function?.name ?? c?.name ?? "?").join(",") + "]");
          if (ev?.type === "model.message.delta") { acc += ev.content || ""; rc += ev.reasoningContent || ""; }
          else if (ev?.type === "model.message" && typeof ev.content === "string") acc = acc || ev.content;
        }
        console.log("GK3_EVENTS " + label + " " + JSON.stringify([...new Set(seen)].slice(0, 30)));
        if (acc) { text = acc; source = "deltas"; } else if (rc) { source = "reasoning-only"; streamReasoningChars = rc.length; } }
    } catch (e) { source = "fallback-error:" + String(e?.message || e).slice(0, 80); }
  }
  const tools = (o?.toolCalls || []).map((x) => x?.function?.name ?? x?.name);
  return { label, status: st?.status, finishReason: o?.finishReason ?? null, tools, text, source, outputNull: o == null, reasoningChars: (o?.reasoningContent || "").length || streamReasoningChars, cost, seconds: Math.round((Date.now() - t0) / 100) / 10,
    error: (st?.error || st?.message) ? JSON.stringify(st.error || st.message).slice(0, 300) : null, tokens: m ? { in: m.totalInputTokens, out: m.totalOutputTokens, reasoning: m.totalReasoningTokens ?? null } : null };
}
// Harness-level and the same for every agent: take the last balanced {...} with a findings array, wherever it sits in the reply.
function jsonFindings(text, key = "findings") {
  let best = null;
  for (let a = text.indexOf("{"); a >= 0; a = text.indexOf("{", a + 1)) {
    let d = 0, q = false, esc = false;
    for (let i = a; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') q = false; continue; }
      if (ch === '"') q = true; else if (ch === "{") d++; else if (ch === "}" && --d === 0) {
        try { const j = JSON.parse(text.slice(a, i + 1)); if (Array.isArray(j?.[key])) best = j[key]; } catch {}
        break;
      }
    }
  }
  return best;
}
const span = (s, e) => (Number.isInteger(e) && e >= s && e - s <= 10 ? { start: s, end: e } : { start: s, end: s });
function parse(arm, text) {
  if (!text) return null;
  if (arm.startsWith("qodo")) {
    const i = text.indexOf("key_issues_to_review");
    if (i < 0) return null;
    const rest = text.slice(i).split(/\n\s{0,2}(?:security_concerns|relevant_tests|estimated_effort|todo_sections)\b/)[0];
    const out = [];
    for (const m of rest.matchAll(/start_line:\s*(\d+)[\s\S]*?end_line:\s*(\d+)/g)) out.push(span(+m[1], +m[2]));
    return out;
  }
  const f = jsonFindings(text);
  if (!f) return null;
  return f.map((x) => {
    const r = x?.code_location?.line_range;
    if (r && Number.isInteger(r.start)) return span(r.start, r.end);
    const l = Number(x?.line); return Number.isInteger(l) ? { start: l, end: l } : null;
  }).filter(Boolean);
}
// A finding catches a planted bug when the bug's line is inside its range, plus or minus 1.
// Findings on a task's "benign" lines (defensible but unplanted) count neither way.
function score(expected, fs, benign = []) {
  if (!fs) return { parsed: false, caught: 0, of: expected.length, extra: 0, neutral: 0 };
  const open = [...expected]; let caught = 0, extra = 0, neutral = 0;
  for (const f of fs) {
    const i = open.findIndex((l) => l >= f.start - 1 && l <= f.end + 1);
    if (i >= 0) { open.splice(i, 1); caught++; }
    else if (benign.some((l) => l >= f.start - 1 && l <= f.end + 1)) neutral++;
    else extra++;
  }
  return { parsed: true, caught, of: expected.length, extra, neutral };
}
// Gate Keeper agent design, not harness scoring: an arm named "<agent>_vote" runs that agent twice in parallel
// and keeps only findings both samples agree on (within one line). It is scored by the same score() as every arm.
// Sample A is also logged as "<agent>_solo" so single and voted runs compare on identical outputs.
async function vote(arm, task, trial) {
  const base = arm.slice(0, -5);
  const [a, b] = await Promise.all(["a", "b"].map((k) => turn(`${arm}/${task.id}/t${trial}/${k}`, P.agents[base].system, task.prompts[base])));
  const fa = a.status === "done" ? parse(base, a.text) : null, fb = b.status === "done" ? parse(base, b.text) : null;
  let fv = null;
  if (fa && fb) { fv = []; for (const f of fa) if (fb.some((g) => g.start <= f.end + 1 && f.start <= g.end + 1) && !fv.some((h) => h.start === f.start)) fv.push(f); }
  else fv = fa || fb;
  for (const [name, r, fs, cost, seconds] of [[base + "_solo", a, fa, a.cost, a.seconds], [arm, a, fv, (a.cost || 0) + (b.cost || 0), Math.max(a.seconds || 0, b.seconds || 0)]]) {
    const row = { arm: name, task: task.id, trial, status: r.status, ...score(task.expected, fs, task.benign || []), cost, seconds, error: r.error };
    rows.push(row); console.log("GK3_ROW " + JSON.stringify(row));
  }
  console.log("GK3_RAW " + `${arm}/${task.id}/t${trial} a=` + JSON.stringify(fa) + " b=" + JSON.stringify(fb));
}
// Gate Keeper agent design (two models), not harness scoring. "<agent>_duo" runs the agent's instructions on
// model A (GK3_MODEL) and model B (GK3_MODEL_B) in parallel. A finding both report (within one line) is kept.
// A finding only one reports goes to the other model as judge, and is kept only if the judge confirms it.
// Every variant is scored by the same score(); the single-model and agree-only variants are logged for comparison.
const MODEL_B = process.env.GK3_MODEL_B || "";
const JUDGE = `You check another reviewer's findings on one change. For each finding, decide if it is a real defect a careful senior engineer would block the merge for.
A finding is real only if you can name, from the code and context shown, the realistic input or state that triggers it and the wrong result. Style, speculation and hypotheticals are not real.
Reply with only this JSON: {"verdicts":[{"line":12,"real":true,"trigger":"<= 15 words"}]}, one entry per finding, same line numbers.`;
const near = (f, g) => g.start <= f.end + 1 && f.start <= g.end + 1;
const asSpan = (x) => { const l = Number(x?.line); return Number.isInteger(l) ? { start: l, end: l, comment: String(x?.comment || "").slice(0, 300) } : null; };
async function judge(label, task, base, model, items) {
  if (!items.length) return { kept: [], cost: 0, seconds: 0 };
  const list = items.map((f) => `- line ${f.start}: ${f.comment}`).join("\n");
  const r = await turn(label, JUDGE, task.prompts[base] + "\n\nFindings to check:\n" + list, model);
  const v = r.status === "done" ? (jsonFindings(r.text, "verdicts") || []) : [];
  const ok = new Set(v.filter((x) => x?.real === true).map((x) => Number(x.line)));
  console.log("GK3_JUDGE " + label + " " + JSON.stringify(v.map((x) => [x?.line, x?.real])));
  return { kept: items.filter((f) => ok.has(f.start)), cost: r.cost || 0, seconds: r.seconds || 0 };
}
async function duo(arm, task, trial) {
  const base = arm.slice(0, -4), sys = P.agents[base].system, pr = task.prompts[base], id = `${arm}/${task.id}/t${trial}`;
  const [a, b] = await Promise.all([turn(id + "/a", sys, pr, MODEL), turn(id + "/b", sys, pr, MODEL_B)]);
  const fa = a.status === "done" ? (jsonFindings(a.text) || null)?.map(asSpan).filter(Boolean) ?? null : null;
  const fb = b.status === "done" ? (jsonFindings(b.text) || null)?.map(asSpan).filter(Boolean) ?? null : null;
  const A = fa || [], B = fb || [];
  const agree = A.filter((f) => B.some((g) => near(f, g)));
  const onlyA = A.filter((f) => !B.some((g) => near(f, g))), onlyB = B.filter((g) => !A.some((f) => near(f, g)));
  const [ja, jb] = await Promise.all([judge(id + "/judge-a-by-b", task, base, MODEL_B, onlyA), judge(id + "/judge-b-by-a", task, base, MODEL, onlyB)]);
  const dedupe = (xs) => xs.filter((f, i) => !xs.slice(0, i).some((g) => near(f, g) && g.start === f.start));
  const final = dedupe([...agree, ...ja.kept, ...jb.kept]);
  const sec = Math.max(a.seconds || 0, b.seconds || 0) + Math.max(ja.seconds, jb.seconds);
  const out = [[base + "_a", fa, a.cost, a.seconds, a], [base + "_b", fb, b.cost, b.seconds, b],
    [base + "_agree", fa && fb ? agree : (fa || fb), (a.cost || 0) + (b.cost || 0), Math.max(a.seconds || 0, b.seconds || 0), a],
    [arm, (fa || fb) ? final : null, (a.cost || 0) + (b.cost || 0) + ja.cost + jb.cost, sec, a]];
  for (const [name, fs, cost, seconds, r] of out) {
    const row = { arm: name, task: task.id, trial, status: r.status, ...score(task.expected, fs, task.benign || []), cost, seconds, error: r.error };
    rows.push(row); console.log("GK3_ROW " + JSON.stringify(row));
  }
  console.log("GK3_RAW " + id + " a=" + JSON.stringify(A.map((f) => f.start)) + " b=" + JSON.stringify(B.map((f) => f.start)) + " final=" + JSON.stringify(final.map((f) => f.start)) + (b.status !== "done" ? " bErr=" + b.status + ":" + b.error : ""));
}
// Gate Keeper's rule bag (gk-bag.mjs): rule packs picked for this code, pattern hints, post-call filters and
// fingerprints, still ONE model call per review. gk_bag = rules + hints; gk_bag_strict adds the Codex-style report bar.
// Fingerprints come from GK3_FP_URL / payload P.fingerprints, built only from tasks outside the set being scored.
const BAG = (process.env.GK3_BAG_PATH || (ARMS.some((a) => a.startsWith("gk_")) || process.env.GK3_IMPROVE_BAG || process.env.GK3_SELF_GATED || process.env.GK3_LANG_PACKS)) ? await import(process.env.GK3_BAG_PATH || "file:///tmp/gk3-bag.mjs") : null;
const FP = P.fingerprints || null;
async function bag(arm, task, trial) {
  const strict = arm.includes("strict"), useFp = arm.includes("fp");
  const pr = task.prompts.gate_keeper, prep = BAG.prepare(P.agents.gate_keeper.system, pr, { strict });
  const r = await turn(`${arm}/${task.id}/t${trial}`, prep.system, prep.prompt);
  const raw = r.status === "done" ? jsonFindings(r.text) : null;
  const fs0 = raw ? raw.map((x) => { const l = Number(x?.line ?? x?.code_location?.line_range?.start); return Number.isInteger(l) ? { start: l, end: l, quote: String(x?.quote || ""), comment: String(x?.comment || x?.title || "").slice(0, 200) } : null; }).filter(Boolean) : null;
  const p = BAG.post(pr, fs0, useFp ? FP : null);
  const row = { arm, task: task.id, trial, status: r.status, cached: !!r.cached, ...score(task.expected, p.out, task.benign || []), cost: r.cost, seconds: r.seconds, tokens: r.tokens, error: r.error,
    rules: prep.rules, hints: prep.hints, dropped: p.dropped, moved: p.moved, fpAdded: p.fpAdded, fpCut: p.fpCut };
  rows.push(row); console.log("GK3_ROW " + JSON.stringify(row));
  console.log("GK3_RAW " + `${arm}/${task.id}/t${trial} ` + JSON.stringify(r.text.slice(0, 6000)));
}
// Gate Keeper four-call pipeline (gk_four): two find runs with the rule bag (union, merged), then two review runs.
// A reviewer must name the triggering input and wrong result, or drop the finding, and gives the line where the fix goes.
// A finding survives only if both reviewers keep it; its line comes from reviewer 1 when both agree within 1 line.
// Find run 1 uses the same inputs and label as gk_bag, so it reuses gk_bag's cached reply. Scored by the same score().
const REVIEW = `You are the second stage of a code reviewer. Below the code is a numbered list of candidate findings from the first stage. Most lists contain false alarms.
For each candidate decide:
- real: true only if you can name, from the code and context shown, a concrete input or state that triggers it AND the wrong result it causes. Style, best practice, hypotheticals, "could be", missing features not asked for, and anything the context says is acceptable are false.
- A candidate that repeats the root cause of an earlier candidate (same fix) is false.
- line: the single line where the fix must be made (the faulty condition, call, assignment or missing check), which may differ from the candidate's line. Use the numbers shown in the code.
Reply with only this JSON: {"verdicts":[{"id":1,"real":true,"line":12,"trigger":"<= 15 words"}]}, one entry per candidate, same ids.`;
const toF = (raw) => raw ? raw.map((x) => { const l = Number(x?.line ?? x?.code_location?.line_range?.start); return Number.isInteger(l) ? { start: l, end: l, quote: String(x?.quote || ""), comment: String(x?.comment || x?.title || "").slice(0, 240) } : null; }).filter(Boolean) : null;
async function four(arm, task, trial) {
  const pr = task.prompts.gate_keeper, prep = BAG.prepare(P.agents.gate_keeper.system, pr, {}), id = `${task.id}/t${trial}`;
  const [a, b] = await Promise.all([turn(`gk_bag/${id}`, prep.system, prep.prompt), turn(`gk_four/${id}/f2`, prep.system, prep.prompt)]);
  const fa = a.status === "done" ? toF(jsonFindings(a.text)) : null, fb = b.status === "done" ? toF(jsonFindings(b.text)) : null;
  let cand = (fa || fb) ? BAG.post(pr, [...(fa || []), ...(fb || [])], null).out : null;
  let final = cand, rv = [], reviewOk = null;
  if (cand && cand.length) {
    const list = cand.map((f, i) => `${i + 1}. line ${f.start}: ${f.comment}`).join("\n");
    rv = await Promise.all([1, 2].map((k) => turn(`gk_four/${id}/r${k}`, REVIEW, pr + "\n\nCandidate findings:\n" + list)));
    // A reviewer whose reply fails or does not parse is unusable, not a reviewer that rejected everything.
    const V = rv.map((r) => { const vs = r.status === "done" ? jsonFindings(r.text, "verdicts") : null; if (!vs) return null; const m = new Map(); for (const v of vs) m.set(Number(v?.id), v); return m; });
    reviewOk = V.filter(Boolean).length;
    if (!reviewOk) final = null; else {
    final = [];
    cand.forEach((f, i) => { const v1 = V[0]?.get(i + 1), v2 = V[1]?.get(i + 1);
      const ok = (v) => v?.real === true; const keep = V[0] && V[1] ? ok(v1) && ok(v2) : ok(V[0] ? v1 : v2);
      if (!keep) return; const l1 = Number(v1?.line), l2 = Number(v2?.line);
      const line = Number.isInteger(l1) && (!Number.isInteger(l2) || Math.abs(l1 - l2) <= 1) ? l1 : f.start;
      final.push({ ...f, start: line, end: line }); });
    final = BAG.post(pr, final.map(({ quote, ...f }) => f), null).out; }
  }
  // Owen's grid, all from the same calls: find = run 1 only (f1) / either run (fu) / both runs (fb);
  // flag = no review (r0) / drop if >=1 reviewer flags it false (r1) / drop only if both flag it (r2); "m" = move to reviewer's fix line.
  // Variant "why": two more reviewers who also see the find runs' own reasoning (their checklists), same REVIEW rubric.
  let rvW = [];
  if (cand && cand.length && process.env.GK3_REVIEW_WHY) {
    const why = [a, b].map((r, k) => { const t = r.text || ""; const j = t.lastIndexOf('{"findings"'); return `Find run ${k + 1} reasoning:\n` + (j > 0 ? t.slice(0, j) : t).slice(0, 3000); }).join("\n\n");
    const list = cand.map((f, i) => `${i + 1}. line ${f.start}: ${f.comment}`).join("\n");
    rvW = await Promise.all([1, 2].map((k) => turn(`gk_four/${id}/w${k}`, REVIEW, pr + "\n\n" + why + "\n\nCandidate findings:\n" + list)));
  }
  const grid = (rv, tag) => {
    const Vg = rv.map((r) => { const vs = r.status === "done" ? jsonFindings(r.text, "verdicts") : null; if (!vs) return null; const m = new Map(); for (const v of vs) m.set(Number(v?.id), v); return m; });
    const pa = fa ? BAG.post(pr, fa, null).out : [], pb = fb ? BAG.post(pr, fb, null).out : [];
    const inA = (c) => pa.some((f) => Math.abs(f.start - c.start) <= 1), inB = (c) => pb.some((f) => Math.abs(f.start - c.start) <= 1);
    const need = { f1: !!fa, fu: !!(fa || fb), fb: !!(fa && fb) };
    const sel = { f1: inA, fu: () => true, fb: (c) => inA(c) && inB(c) };
    const usable = Vg.filter(Boolean);
    const flags = (i) => usable.filter((m) => m.get(i + 1)?.real === false).length;
    const fixLine = (i, c) => { for (const m of usable) { const v = m.get(i + 1); const l = Number(v?.line); if (v?.real !== false && Number.isInteger(l) && Math.abs(l - c.start) <= 8) return l; } return c.start; };
    const fcost = { f1: a.cost || 0, fu: (a.cost || 0) + (b.cost || 0), fb: (a.cost || 0) + (b.cost || 0) };
    const fsec = { f1: a.seconds || 0, fu: Math.max(a.seconds || 0, b.seconds || 0), fb: Math.max(a.seconds || 0, b.seconds || 0) };
    const rcost = rv.reduce((x, r) => x + (r.cost || 0), 0), rsec = Math.max(0, ...rv.map((r) => r.seconds || 0));
    for (const fk of ["f1", "fu", "fb"]) for (const rk of ["r0", "r1", "r2"]) for (const mv of rk === "r0" ? [""] : ["", "m"]) {
      if (tag && rk === "r0") continue;
      const name = `grid_${tag}${fk}_${rk}${mv}`; let out;
      if (!need[fk] || (rk !== "r0" && cand.length && !usable.length)) out = null;
      else { out = []; cand.forEach((c, i) => { if (!sel[fk](c)) return; const fl = rk === "r0" ? 0 : flags(i);
        if (rk === "r1" && fl >= 1) return; if (rk === "r2" && fl >= Math.min(2, usable.length)) return;
        const l = mv ? fixLine(i, c) : c.start; out.push({ start: l, end: l }); });
        out = BAG.post(pr, out, null).out; }
      const row = { arm: name, task: task.id, trial, status: a.status, ...score(task.expected, out, task.benign || []),
        cost: fcost[fk] + (rk === "r0" ? 0 : rcost), seconds: fsec[fk] + (rk === "r0" ? 0 : rsec), calls: (fk === "f1" ? 1 : 2) + (rk === "r0" ? 0 : rv.length) };
      rows.push(row); console.log("GK3_ROW " + JSON.stringify(row));
    }
  };
  cand = cand || []; grid(rv, ""); if (process.env.GK3_REVIEW_WHY) grid(rvW, "why_");
  const calls4 = [a, b, ...rv], cost = calls4.reduce((s, r) => s + (r.cost || 0), 0), seconds = Math.max(a.seconds || 0, b.seconds || 0) + Math.max(0, ...rv.map((r) => r.seconds || 0));
  for (const [name, fs, c, sec] of [["gk_four_find2", cand, (a.cost || 0) + (b.cost || 0), Math.max(a.seconds || 0, b.seconds || 0)], [arm, final, cost, seconds]]) {
    const row = { arm: name, task: task.id, trial, status: a.status, cached: !!a.cached, ...score(task.expected, fs, task.benign || []), cost: c, seconds: sec, calls: name === arm ? calls4.length : 2, ...(name === arm ? { reviewOk, reviewStatus: rv.map((r) => r.status) } : {}) };
    rows.push(row); console.log("GK3_ROW " + JSON.stringify(row)); }
  console.log("GK3_RAW gk_four/" + id + " cand=" + JSON.stringify((cand || []).map((f) => f.start)) + " final=" + JSON.stringify((final || []).map((f) => f.start)) + " rv=" + JSON.stringify(rv.map((r) => r.text.slice(-1500))));
}
// Gate Keeper consecutive chain (gk_chain): run 1 is the rule-bag review (same inputs and label as gk_bag, so cached).
// Runs 2..GK3_CHAIN_N each see every finding so far and report only real defects not already listed.
// Rows gk_chain_1..N score the merged union after each run, so each run's added catches and false alarms show directly.
const CHAIN_ASK = `\n\nEarlier review passes already reported these findings:\n%LIST%\n\nDo another careful pass. Report ONLY real defects that are NOT already listed above (a different line or a different root cause). Do not repeat or rephrase listed findings. If you find nothing new, return {"findings":[]}. Same JSON format.`;
async function chain(arm, task, trial) {
  const N = Number(process.env.GK3_CHAIN_N || "4"), pr = task.prompts.gate_keeper, prep = BAG.prepare(P.agents.gate_keeper.system, pr, {}), id = `${task.id}/t${trial}`;
  let all = [], ok = false, cost = 0, seconds = 0;
  for (let k = 1; k <= N; k++) {
    const list = all.length ? all.map((f) => `- line ${f.start}: ${f.comment}`).join("\n") : "(none)";
    const r = k === 1 ? await turn(`gk_bag/${id}`, prep.system, prep.prompt) : await turn(`gk_chain/${id}/c${k}`, prep.system, prep.prompt + CHAIN_ASK.replace("%LIST%", list));
    cost += r.cost || 0; seconds += r.seconds || 0;
    const fs = r.status === "done" ? toF(jsonFindings(r.text)) : null, before = all.length;
    if (fs) { ok = true; all = BAG.post(pr, [...all, ...fs], null).out; }
    const row = { arm: `gk_chain_${k}`, task: task.id, trial, status: r.status, cached: !!r.cached, ...score(task.expected, ok ? all : null, task.benign || []), cost, seconds, calls: k, reported: fs ? fs.length : null, newThisRun: fs ? all.length - before : null };
    rows.push(row); console.log("GK3_ROW " + JSON.stringify(row));
  }
}
const jobs = [];
for (let trial = 1; trial <= TRIALS; trial++) for (const task of P.tasks) for (const arm of ARMS) jobs.push({ trial, task, arm });
const rows = [];
async function worker() {
  while (jobs.length) {
    const { trial, task, arm } = jobs.shift();
    if (arm.endsWith("_vote")) { await vote(arm, task, trial); continue; }
    if (arm.endsWith("_duo")) { await duo(arm, task, trial); continue; }
    if (arm === "gk_four") { await four(arm, task, trial); continue; }
    if (arm === "gk_chain") { await chain(arm, task, trial); continue; }
    if (arm.startsWith("gk_bag")) { await bag(arm, task, trial); continue; }
    const r = await turn(`${arm}/${task.id}/t${trial}`, P.agents[arm].system, task.prompts[arm]);
    let fs = r.status === "done" ? parse(arm, r.text) : null;
    // Gate Keeper's own code step (GK3_GK_MERGE=1): merge its findings on the same or next line. Gate Keeper only.
    if (fs && arm.startsWith("gate_keeper") && process.env.GK3_GK_MERGE) { const out = []; for (const f of [...fs].sort((a, b) => a.start - b.start)) { if (out.length && f.start - out[out.length - 1].start <= 1) continue; out.push(f); } fs = out; }
    const sc = score(task.expected, fs, task.benign || []);
    const row = { arm, task: task.id, trial, status: r.status, cached: !!r.cached, finish: r.finishReason, source: r.source, outputNull: r.outputNull, reasoningChars: r.reasoningChars, tools: r.tools, ...sc, cost: r.cost, seconds: r.seconds, tokens: r.tokens, error: r.error };
    rows.push(row);
    console.log("GK3_ROW " + JSON.stringify(row));
    console.log("GK3_RAW " + `${arm}/${task.id}/t${trial} ` + JSON.stringify(r.text.slice(0, 6000)));
  }
}
// Gate Keeper design search (GK3_MATRIX=1): one shared set of generations and judge calls per task and trial,
// then 20 Gate Keeper configurations are formed from them and each is scored by the same score().
// Cost per config = the generations it uses plus the full cost of any judge call it uses (an upper bound).
// Gate Keeper agent code search (GK3_PIPE=1), one model fixed (GK3_MODEL_B, e.g. glm-5.3-flash).
// These are Gate Keeper's own steps, not harness scoring: every config is scored by the same score().
// Steps: a deterministic merge of same/adjacent-line findings, focused passes, a second look, and quote anchoring.
async function pipe() {
  const GM = MODEL_B || MODEL, sys = P.agents.gate_keeper.system;
  const FOCUS = [
    "untrusted input (pass 2) and identity and access (pass 3)",
    "state and concurrency (pass 4) and failure paths (pass 5)",
    "boundaries (pass 1) and semantics (pass 6)",
  ].map((x) => `\n\nThis pass: hunt only ${x}, plus any rule stated in the context that the code breaks. Other defect types are covered by other passes; leave them out.`);
  const QSYS = sys + "\n\nExtra field: every finding also has `\"quote\"`: the code of the line it points at, copied character for character (without the line number).";
  const toSpans = (r) => r.status === "done" ? (jsonFindings(r.text) || null)?.map((x) => { const l = Number(x?.line); return Number.isInteger(l) ? { start: l, end: l, comment: String(x?.comment || "").slice(0, 200), quote: typeof x?.quote === "string" ? x.quote : "" } : null; }).filter(Boolean) ?? null : null;
  const merge = (fs) => { if (!fs) return null; const out = []; for (const f of [...fs].sort((a, b) => a.start - b.start)) { if (out.length && f.start - out[out.length - 1].start <= 1) continue; out.push(f); } return out; };
  const norm = (x) => x.replace(/\s+/g, " ").trim();
  function anchor(prompt, fs) {
    if (!fs) return null; const code = new Map();
    for (const m of prompt.matchAll(/^\s*(\d+) \| ?(.*)$/gm)) code.set(+m[1], norm(m[2]));
    let moved = 0;
    const out = fs.map((f) => { const q = norm(f.quote || ""); if (q.length < 4) return f;
      if ((code.get(f.start) || "").includes(q) || q.includes(code.get(f.start) || "\u0000")) return f;
      let best = null; for (const [n, c] of code) if (c.length >= 4 && (c.includes(q) || q.includes(c)) && (best === null || Math.abs(n - f.start) < Math.abs(best - f.start))) best = n;
      if (best !== null && Math.abs(best - f.start) <= 8) { moved++; return { ...f, start: best, end: best }; } return f; });
    return { out, moved };
  }
  const MM = "tfy-direct/mimo-v2-6-flash";
  const C = ["v10", "v10+merge", "focused x3", "v10+second look", "quote anchor", "quote anchor+merge", "v10+focused x3", "v10+second look+quote",
    "mimo", "mimo+merge", "glm+mimo union+merge", "glm+mimo agree", "glm+mimo+second look union+merge", "glm+mimo+focused union+merge"];
  const prow = [], q = [];
  for (let trial = 1; trial <= TRIALS; trial++) for (const task of P.tasks) q.push({ trial, task });
  async function one({ trial, task }) {
    const id = `p/${task.id}/t${trial}`, pr = task.prompts.gate_keeper;
    const mimoP = turn(id + "/mimo", sys, pr, MM);
    const [base, qa, ...foc] = await Promise.all([turn(id + "/base", sys, pr, GM), turn(id + "/quote", QSYS, pr, GM), ...FOCUS.map((x, i) => turn(id + "/focus" + i, sys, pr + x, GM))]);
    const fb = toSpans(base);
    const seen = (fb || []).map((f) => `- line ${f.start}: ${f.comment}`).join("\n") || "- (none)";
    const gap = await turn(id + "/gap", sys, pr + "\n\nA first review of this change already reported:\n" + seen + "\nReport only real defects it missed, on other lines. Do not repeat or rephrase its findings. If it missed nothing, reply with the checklist and {\"findings\":[]}.", GM);
    const mi = await mimoP, fm = toSpans(mi);
    const fq = toSpans(qa), ff = foc.map(toSpans), fg = toSpans(gap), aq = anchor(pr, fq);
    const uni = (...xs) => xs.some(Boolean) ? xs.filter(Boolean).flat() : null;
    const foundF = uni(...ff);
    const sets = {
      "v10": [fb, base.cost, base.seconds],
      "v10+merge": [merge(fb), base.cost, base.seconds],
      "focused x3": [merge(foundF), foc.reduce((a, r) => a + (r.cost || 0), 0), Math.max(...foc.map((r) => r.seconds || 0))],
      "v10+second look": [merge(uni(fb, fg)), (base.cost || 0) + (gap.cost || 0), (base.seconds || 0) + (gap.seconds || 0)],
      "quote anchor": [aq?.out ?? null, qa.cost, qa.seconds],
      "quote anchor+merge": [merge(aq?.out ?? null), qa.cost, qa.seconds],
      "v10+focused x3": [merge(uni(fb, foundF)), (base.cost || 0) + foc.reduce((a, r) => a + (r.cost || 0), 0), Math.max(base.seconds || 0, ...foc.map((r) => r.seconds || 0))],
      "v10+second look+quote": [merge(uni(fb, fg, aq?.out ?? null)), (base.cost || 0) + (gap.cost || 0) + (qa.cost || 0), (base.seconds || 0) + (gap.seconds || 0)],
      "mimo": [fm, mi.cost, mi.seconds],
      "mimo+merge": [merge(fm), mi.cost, mi.seconds],
      "glm+mimo union+merge": [merge(uni(fb, fm)), (base.cost || 0) + (mi.cost || 0), Math.max(base.seconds || 0, mi.seconds || 0)],
      "glm+mimo agree": [fb && fm ? merge(fb.filter((f) => fm.some((g) => Math.abs(g.start - f.start) <= 1))) : merge(fb || fm), (base.cost || 0) + (mi.cost || 0), Math.max(base.seconds || 0, mi.seconds || 0)],
      "glm+mimo+second look union+merge": [merge(uni(fb, fg, fm)), (base.cost || 0) + (gap.cost || 0) + (mi.cost || 0), Math.max((base.seconds || 0) + (gap.seconds || 0), mi.seconds || 0)],
      "glm+mimo+focused union+merge": [merge(uni(fb, foundF, fm)), (base.cost || 0) + foc.reduce((a, r) => a + (r.cost || 0), 0) + (mi.cost || 0), Math.max(base.seconds || 0, mi.seconds || 0, ...foc.map((r) => r.seconds || 0))],
    };
    console.log("GK3_GEN " + id.slice(2) + " " + JSON.stringify({ base: fb?.map((f) => f.start), quote: fq?.map((f) => [f.start, f.quote.slice(0, 60)]), anchored: aq?.out.map((f) => f.start), moved: aq?.moved, focus: ff.map((x) => x?.map((f) => f.start)), gap: fg?.map((f) => f.start), mimo: fm?.map((f) => f.start), mimoErr: mi.error, st: [base, qa, gap, mi, ...foc].map((r) => r.status) }));
    for (const name of C) { const [fs, cost, seconds] = sets[name];
      const row = { arm: name, task: task.id, trial, ...score(task.expected, fs, task.benign || []), cost, seconds }; prow.push(row); console.log("GK3_ROW " + JSON.stringify(row)); }
  }
  console.log("GK3_START " + JSON.stringify({ pipe: true, model: GM, trials: TRIALS, tasks: P.tasks.length, cap: CAP, sha256: P.sha256 }));
  await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) await one(q.shift()); }));
  const sum = C.map((name) => { const rs = prow.filter((r) => r.arm === name); const n = rs.length || 1;
    const caught = rs.reduce((a, r) => a + r.caught, 0), fa = rs.reduce((a, r) => a + r.extra, 0);
    return { name, caught, of: rs.reduce((a, r) => a + r.of, 0), fa, net: caught - fa, unparsed: rs.filter((r) => !r.parsed).length,
      avgS: Math.round(10 * rs.reduce((a, r) => a + (r.seconds || 0), 0) / n) / 10, avgUsd: Math.round(1e6 * rs.reduce((a, r) => a + (r.cost || 0), 0) / n) / 1e6 }; }).sort((a, b) => b.net - a.net);
  for (const x of sum) console.log("GK3_MATRIX " + JSON.stringify(x));
  console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6 }));
}
// Gate Keeper's improve step (GK3_IMPROVE=1): Gate Keeper rewrites its own rules from its training misses.
// Each round: review the training tasks with the current rules (quote + code merge), show the improver the missed
// bugs (with their reasons) and the false alarms, take at most two new general rules, re-run, and keep them only
// if net rises by GK3_MIN_GAIN or more (default +1 fault-equivalent) and neither split (t4-t5 fit, t6 check) gets worse. Scored by the same score().
// GK3_IMPROVE_BAG=1: the same loop on the rule-bag Gate Keeper. Round A = current rules; after each round Gate Keeper
// writes up to two new rules from its misses and false alarms, and round B, C, ... run with them (kept only past noise).
const BAGMODE = !!process.env.GK3_IMPROVE_BAG;
async function improve() {
  const GM = MODEL_B || MODEL, ROUNDS = Number(process.env.GK3_ROUNDS || "3"), GAIN = Number(process.env.GK3_MIN_GAIN ?? "1");
  const FOCUS = ["untrusted input (pass 2) and identity and access (pass 3)", "state and concurrency (pass 4) and failure paths (pass 5)", "boundaries (pass 1) and semantics (pass 6)"]
    .map((x) => `\n\nThis pass: hunt only ${x}, plus any rule stated in the context that the code breaks. Other defect types are covered by other passes; leave them out.`);
  // Accepts both output shapes: v12's {line, comment} and v13's {code_location.line_range, title, why}.
  const toSpans = (r) => r.status === "done" ? (jsonFindings(r.text) || null)?.map((x) => { const lr = x?.code_location?.line_range, l = Number(lr && Number.isInteger(lr.start) ? lr.start : x?.line);
    const e = lr && Number.isInteger(lr.end) && lr.end >= l && lr.end - l <= 10 ? lr.end : l;
    return Number.isInteger(l) ? { start: l, end: e, comment: String(x?.comment || [x?.title, x?.why].filter(Boolean).join(": ")).slice(0, 200) } : null; }).filter(Boolean) ?? null : null;
  const merge = (fs) => { if (!fs) return null; const out = []; for (const f of [...fs].sort((a, b) => a.start - b.start)) { if (out.length && f.start - out[out.length - 1].start <= 1) continue; out.push(f); } return out; };
  const codeOf = (t) => { const m = new Map(); for (const x of t.prompts.gate_keeper.matchAll(/^\s*(\d+) \| ?(.*)$/gm)) m.set(+x[1], x[2].trim()); return m; };
  // Check split: task ids matching GK3_CHECK_RE (default: tranche 6). Everything else is the fit split.
  const CHECK_RE = new RegExp(process.env.GK3_CHECK_RE || "^t6-"), isFit = (t) => !CHECK_RE.test(t.id);
  async function evalRules(tag, sys, focused = false, only = null) {
    const TS = only ? P.tasks.filter((t) => only.has(t.id)) : P.tasks;
    const q = []; for (let trial = 1; trial <= TRIALS; trial++) for (const task of TS) q.push({ trial, task });
    const res = { tag, fit: 0, val: 0, caught: 0, fa: 0, cost: 0, sec: 0, n: 0, unparsed: 0, misses: [], fas: [], rows: [] };
    async function one({ trial, task }) {
      const id = `i/${tag}/${task.id}/t${trial}`, pr = task.prompts.gate_keeper;
      let rs, fs;
      if (BAGMODE) { // the rule-bag Gate Keeper: rule packs + hints before the call, code checks after. Base rules reuse gk_bag's cached replies.
        // A gated rule set (array) adds each rule only where its code trigger fires; elsewhere the call is the base call (cached).
        let s0 = sys, on = [];
        if (Array.isArray(sys)) { on = BAG.gate(pr, sys); s0 = on.length ? withGated(on.map((r) => r.rule)) : BASE; }
        const prep = BAG.prepare(s0, pr, {}), base = s0 === BASE;
        if (on.length) prep.prompt += "\n\nLines a learned rule's trigger matched (check them against that rule; many are fine): " + on.map((r) => r.lines.map((l) => "L" + l).join(", ")).join("; ") + ".";
        rs = [await turn(base ? `gk_bag/${task.id}/t${trial}` : id, prep.system, prep.prompt)];
        const raw = rs[0].status === "done" ? toF(jsonFindings(rs[0].text)) : null;
        fs = raw ? BAG.post(pr, raw, null).out : null;
        // GK3_IMPROVE_CHAIN=2: a second, consecutive run sees run 1's findings and reports only new ones (same as gk_chain).
        for (let k = 2; k <= Number(process.env.GK3_IMPROVE_CHAIN || "1"); k++) {
          const list = (fs || []).length ? fs.map((f) => `- line ${f.start}: ${f.comment}`).join("\n") : "(none)";
          const r2 = await turn(base ? `gk_chain/${task.id}/t${trial}/c${k}` : `${id}/c${k}`, prep.system, prep.prompt + CHAIN_ASK.replace("%LIST%", list));
          rs.push(r2); const more = r2.status === "done" ? toF(jsonFindings(r2.text)) : null;
          if (more) fs = BAG.post(pr, [...(fs || []), ...more], null).out;
        }
      } else {
        // A gated rule set (array) adds each rule only where its code trigger fires; elsewhere the call is the base call (cached).
        let s1 = sys, p1 = pr;
        if (Array.isArray(sys)) { const on = BAG.gate(pr, sys); s1 = on.length ? withGated(on.map((r) => r.rule)) : BASE;
          if (on.length) p1 = pr + "\n\nLines a learned rule's trigger matched (check them against that rule; many are fine): " + on.map((r) => r.lines.map((l) => "L" + l).join(", ")).join("; ") + "."; }
        rs = focused ? await Promise.all(FOCUS.map((x, i) => turn(id + "/f" + i, s1, p1 + x, GM))) : [await turn(id, s1, p1, GM)];
        const parts = rs.map(toSpans); fs = parts.some(Boolean) ? merge(parts.filter(Boolean).flat()) : null;
      }
      const sc = score(task.expected, fs, task.benign || []), code = codeOf(task);
      res.rows.push({ k: `${task.id}/t${trial}`, task: task.id, fit: isFit(task), net: sc.caught - sc.extra, caught: sc.caught, fa: sc.extra, parsed: !!sc.parsed });
      res.caught += sc.caught; res.fa += sc.extra; res[isFit(task) ? "fit" : "val"] += sc.caught - sc.extra; res.n++; if (!sc.parsed) res.unparsed++;
      res.cost += rs.reduce((a, r) => a + (r.cost || 0), 0); res.sec += BAGMODE ? rs.reduce((a, r) => a + (r.seconds || 0), 0) : Math.max(...rs.map((r) => r.seconds || 0));
      if (fs) { for (const w of task.why) if (!fs.some((f) => w.line >= f.start - 1 && w.line <= (f.end ?? f.start) + 1)) res.misses.push({ task: task.id, line: w.line, code: code.get(w.line) || "", why: w.why });
        for (const f of fs) if (!task.expected.some((l) => l >= f.start - 1 && l <= (f.end ?? f.start) + 1) && !(task.benign || []).some((l) => l >= f.start - 1 && l <= (f.end ?? f.start) + 1)) res.fas.push({ task: task.id, line: f.start, code: code.get(f.start) || "", comment: f.comment }); }
      console.log("GK3_ROW " + JSON.stringify({ arm: tag, task: task.id, trial, ...sc }));
    }
    await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) await one(q.shift()); }));
    const out = { tag, net: res.caught - res.fa, caught: res.caught, of: TS.reduce((a, t) => a + t.expected.length, 0) * TRIALS, fa: res.fa, fitNet: res.fit, checkNet: res.val, unparsed: res.unparsed, avgS: Math.round(10 * res.sec / res.n) / 10, avgUsd: Math.round(1e6 * res.cost / res.n) / 1e6 };
    console.log("GK3_EVAL " + JSON.stringify(out)); return { ...out, misses: res.misses, fas: res.fas, rows: res.rows };
  }
  const IMPROVER = `You maintain the instructions of an automated code reviewer. You get its current instructions, the planted bugs it missed on training reviews (with the reason each is a bug), and its false alarms.
Write at most two NEW general rules that would make it catch more of these misses or raise fewer of these false alarms on code it has never seen.
- Each rule is one sentence of at most 40 words, about a kind of defect or a reviewing habit, never about one task: no file, function, variable or product names from the examples.
- Do not repeat or reword a rule the instructions already have. Prefer the pattern behind the most misses.
Reply with only this JSON: {"rules":["...","..."],"why":"<= 30 words"}`;
  const tally = (xs) => { const seen = new Map(); for (const x of xs) { const k = x.task + ":" + x.line; seen.set(k, { ...x, n: (seen.get(k)?.n || 0) + 1 }); } return [...seen.values()].sort((a, b) => b.n - a.n); };
  console.log("GK3_START " + JSON.stringify({ improve: true, model: GM, rounds: ROUNDS, gain: GAIN, trials: TRIALS, tasks: P.tasks.length, cap: CAP, sha256: P.sha256 }));
  const BASE = P.agents.gate_keeper.system;
  const withRules = (list) => BASE.includes("\n\nExtra field:") ? BASE.replace("\n\nExtra field:", "\n\n## Learned rules\n" + list.map((x) => "- " + x).join("\n") + "\n\nExtra field:") : BASE + "\n\n## Learned rules\n" + list.map((x) => "- " + x).join("\n");
  // Gated rules go in their own section, so a prompt that already has "## Learned rules" (v13.1) keeps it unchanged.
  const withGated = (list) => { const sec = "\n\n## Rules for code like this\n" + list.map((x) => "- " + x).join("\n"); return BASE.includes("\n\nExtra field:") ? BASE.replace("\n\nExtra field:", sec + "\n\nExtra field:") : BASE + sec; };
  let rules = BASE, learned = [], rejected = [];
  let best = await evalRules(BAGMODE ? "round A (rule bag)" : (process.env.GK3_GK_FILE || "v12"), rules);
  // Paired sign-flip test on per-review net differences (same task, same trial), one split at a time.
  // Pairs where either side failed or did not parse are left out. Exact over all sign vectors of the non-zero
  // differences when there are at most 20 of them; otherwise 20000 draws from mulberry32 (exact 32-bit math).
  const paired = (a, b, fit) => pairedRows(a.rows.filter((r) => r.fit === fit), b.rows.filter((r) => r.fit === fit));
  const pairedRows = (ar, br) => { const A = new Map(ar.filter((r) => r.parsed).map((r) => [r.k, r.net])); const d = br.filter((r) => r.parsed && A.has(r.k)).map((r) => r.net - A.get(r.k));
    const obs = d.reduce((x, y) => x + y, 0), nz = d.filter((x) => x); let hit = 0, R;
    if (nz.length <= 20) { R = 2 ** nz.length; for (let m = 0; m < R; m++) { let t = 0; for (let j = 0; j < nz.length; j++) t += (m >> j) & 1 ? nz[j] : -nz[j]; if (t >= obs) hit++; } }
    else { R = 20000; let s = 12345; const rand = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return (t ^ (t >>> 14)) >>> 0; };
      for (let i = 0; i < R; i++) { let t = 0; for (const x of nz) t += rand() & 1 ? x : -x; if (t >= obs) hit++; } hit++; R++; }
    return { diff: obs, reviews: d.length, changed: nz.length, up: nz.filter((x) => x > 0).length, down: nz.filter((x) => x < 0).length, p: Math.round(1e4 * hit / R) / 1e4 }; };
  // GK3_LANG_PACKS=1: per-language learned packs for this model. Each stack (stackOf: the code fence, file name and imports)
  // gets its own pack of "catch" and "do not flag" rules, learned from that stack's fit-split misses and false alarms only,
  // shown only on that stack's code, and kept only if that stack's net rises by GAIN and neither its fit nor its check
  // split drops. The unchanged Codex rubric runs on the same tasks and trials as the comparison arm (GK3_ARMS includes codex).
  if (process.env.GK3_LANG_PACKS) {
    const ST = new Map(P.tasks.map((t) => [t.id, BAG.stackOf(t.prompts.gate_keeper)])), MINT = Number(process.env.GK3_LANG_MIN_FIT || "4");
    const NAME = { node: "Node.js", react: "React", bun: "Bun", elysia: "Elysia (Bun)", ts: "TypeScript", go: "Go", rust: "Rust", erlang: "Erlang", php: "PHP", python: "Python", jvm: "JVM (Java/Kotlin)" };
    const of = (s) => P.tasks.filter((t) => ST.get(t.id) === s), stacks = [...new Set(ST.values())].filter((s) => of(s).filter(isFit).length >= MINT && of(s).some((t) => !isFit(t))).sort();
    const sum = (rows) => rows.reduce((a, r) => ({ net: a.net + r.net, caught: a.caught + r.caught, fa: a.fa + r.fa, n: a.n + 1 }), { net: 0, caught: 0, fa: 0, n: 0 });
    const on = (rows, s, fit) => rows.filter((r) => ST.get(r.task) === s && (fit === undefined || r.fit === fit));
    const cx = { rows: [] };
    if (P.agents.codex && ARMS.includes("codex")) {
      const q = []; for (let trial = 1; trial <= TRIALS; trial++) for (const task of P.tasks) q.push({ trial, task });
      await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) { const { trial, task } = q.shift();
        const r = await turn(`codex/${task.id}/t${trial}`, P.agents.codex.system, task.prompts.codex, GM), fs = r.status === "done" ? parse("codex", r.text) : null, sc = score(task.expected, fs, task.benign || []);
        cx.rows.push({ k: `${task.id}/t${trial}`, task: task.id, fit: isFit(task), net: sc.caught - sc.extra, caught: sc.caught, fa: sc.extra, parsed: !!sc.parsed });
        console.log("GK3_ROW " + JSON.stringify({ arm: "codex", task: task.id, trial, ...sc })); } }));
      const t = sum(cx.rows); console.log("GK3_EVAL " + JSON.stringify({ tag: "codex rubric", ...t, unparsed: cx.rows.filter((r) => !r.parsed).length }));
    }
    const LANG_IMPROVER = `You maintain one language's rule pack for an automated code reviewer. The pack is shown to the reviewer only when it reviews %LANG% code.
You get the reviewer's instructions, its current %LANG% pack, the planted bugs it missed in %LANG% training reviews (with the reason each is a bug), and its false alarms there.
Write at most two NEW rules for this pack. A rule is either a CATCH rule (a %LANG% defect pattern to report) or a DO-NOT-FLAG rule (a %LANG% idiom that looks wrong but is fine, so it is not reported). Prefer a DO-NOT-FLAG rule when false alarms repeat.
- Each rule is one sentence of at most 40 words, starting "Catch:" or "Do not flag:", naming the %LANG% construct (API, keyword or idiom) it applies to; never a file, function, variable or product name from the examples.
- Do not repeat or reword a rule the pack or the instructions already have. Prefer the pattern behind the most examples.
Reply with only this JSON: {"rules":["...","..."],"why":"<= 30 words"}`;
    const withPack = (s, list) => { const sec = `\n\n## Rules for ${NAME[s] || s} code\n` + list.map((x) => "- " + x).join("\n"); return BASE.includes("\n\nExtra field:") ? BASE.replace("\n\nExtra field:", sec + "\n\nExtra field:") : BASE + sec; };
    const report = {}, packs = {}, fin = new Map(best.rows.map((r) => [r.k, r]));
    console.log("GK3_LANG_START " + JSON.stringify({ model: GM, stacks: stacks.map((s) => ({ s, fit: of(s).filter(isFit).length, check: of(s).filter((t) => !isFit(t)).length })), skipped: [...new Set(ST.values())].filter((s) => !stacks.includes(s)) }));
    for (const s of stacks) {
      const only = new Set(of(s).map((t) => t.id)), base = { rows: on(best.rows, s), misses: best.misses.filter((m) => only.has(m.task)), fas: best.fas.filter((f) => only.has(f.task)) };
      let cur = base, pack = [], rejected = [];
      for (let r = 1; r <= ROUNDS; r++) {
        const fitIds = new Set(of(s).filter(isFit).map((t) => t.id)), ms = tally(cur.misses.filter((m) => fitIds.has(m.task))).slice(0, 14), fs = tally(cur.fas.filter((f) => fitIds.has(f.task))).slice(0, 10);
        if (!ms.length && !fs.length) break;
        const ask = "Reviewer instructions:\n" + BASE + `\n\nCurrent ${NAME[s] || s} pack:\n` + (pack.length ? pack.map((x) => "- " + x).join("\n") : "(empty)") + "\n\nMissed bugs (missed in n of " + TRIALS + " runs):\n" + (ms.map((m) => `- [${m.n}x] line ${m.line}: \`${m.code}\` — ${m.why}`).join("\n") || "(none)") +
          "\n\nFalse alarms:\n" + (fs.map((f) => `- [${f.n}x] line ${f.line}: \`${f.code}\` — reviewer said: ${f.comment}`).join("\n") || "(none)") + (rejected.length ? "\n\nRules already tried that did not help (do not propose these again):\n" + rejected.map((x) => "- " + x).join("\n") : "");
        const rr = await turn(`lang/${s}/improve-r${r}`, LANG_IMPROVER.replaceAll("%LANG%", NAME[s] || s), ask, GM);
        const nr = (jsonFindings(rr.text, "rules") || []).filter((x) => typeof x === "string" && x.length > 10).slice(0, 2).map((x) => x.trim().slice(0, 300));
        if (!nr.length) { console.log("GK3_PACK " + JSON.stringify({ stack: s, round: r, error: "no rules", status: rr.status })); continue; }
        const c = await evalRules(`pack ${s} r${r}`, withPack(s, [...pack, ...nr]), false, only);
        const B = sum(cur.rows), C = sum(c.rows), Bf = sum(on(cur.rows, s, true)), Cf = sum(on(c.rows, s, true)), Bc = sum(on(cur.rows, s, false)), Cc = sum(on(c.rows, s, false));
        const ok = C.net - B.net >= GAIN && Cf.net >= Bf.net && Cc.net >= Bc.net;
        console.log("GK3_PACK " + JSON.stringify({ stack: s, round: r, rules: nr, base: B, cand: C, delta: { net: C.net - B.net, caught: C.caught - B.caught, fa: C.fa - B.fa, fit: Cf.net - Bf.net, check: Cc.net - Bc.net },
          fitTest: pairedRows(on(cur.rows, s, true), on(c.rows, s, true)), checkTest: pairedRows(on(cur.rows, s, false), on(c.rows, s, false)), accepted: ok }));
        if (ok) { pack = [...pack, ...nr]; cur = c; } else rejected.push(...nr);
      }
      packs[s] = pack; for (const x of cur.rows) fin.set(x.k, x);
      const cxr = on(cx.rows, s), row = { tasks: only.size, base: sum(base.rows), packed: sum(cur.rows), codex: cx.rows.length ? sum(cxr) : null,
        packedVsBase: pairedRows(base.rows, cur.rows), packedVsCodex: cx.rows.length ? pairedRows(cxr, cur.rows) : null, checkVsCodex: cx.rows.length ? pairedRows(on(cx.rows, s, false), on(cur.rows, s, false)) : null, pack };
      report[s] = row; console.log("GK3_LANG " + JSON.stringify({ stack: s, ...row }));
    }
    // Totals: 13.1 with every pack in place (stacks without a pack keep the base reply) vs the Codex rubric, paired per review.
    const all = [...fin.values()];
    console.log("GK3_PACKS " + JSON.stringify({ model: GM, base: P.sha256?.gate_keeper, packs }));
    console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6, base: sum(best.rows), packed: sum(all), codex: cx.rows.length ? sum(cx.rows) : null, baseVsCodex: cx.rows.length ? pairedRows(cx.rows, best.rows) : null, packedVsCodex: cx.rows.length ? pairedRows(cx.rows, all) : null, checkPackedVsCodex: cx.rows.length ? pairedRows(cx.rows.filter((r) => !r.fit), all.filter((r) => !r.fit)) : null, report }));
    return;
  }
  if (BAGMODE && process.env.GK3_GATED) {
    const g = await evalRules("round D gated", BAG.GATED);
    const fired = P.tasks.map((t) => ({ task: t.id, rules: BAG.gate(t.prompts.gate_keeper).map((r) => r.id) })).filter((x) => x.rules.length);
    console.log("GK3_GATED " + JSON.stringify({ base: { net: best.net, caught: best.caught, fa: best.fa, fit: best.fitNet, check: best.checkNet }, gated: { net: g.net, caught: g.caught, fa: g.fa, fit: g.fitNet, check: g.checkNet }, fit: paired(best, g, true), check: paired(best, g, false), fired: fired.length, of: P.tasks.length, firedOn: fired }));
  }
  const fq = BAGMODE || process.env.GK3_SKIP_FOCUSED ? { net: null } : await evalRules("v12 focused x3", rules, true);
  // GK3_SELF_GATED=1: Gate Keeper writes its own trigger-gated rules. Each round the improver proposes up to 4 single
  // rules, each with a line regex (its trigger) and the rule text. Code checks every candidate before any model call:
  // the regex must compile, must fire on the line (±1) of at least one missed bug, and may fire on at most GK3_MAX_FIRE
  // training tasks. Survivors are scored gated (the rule appears only where its trigger fires; other reviews are the
  // cached base). The best survivor is kept if net rises by GAIN or more and neither split gets worse.
  if (process.env.GK3_SELF_GATED) {
    const MAXF = Number(process.env.GK3_MAX_FIRE || "5"), lineOf = (t) => codeOf(t);
    const SELF = `You maintain an automated code reviewer. It already has general instructions. You add LEARNED RULES, and each learned rule is shown to the reviewer ONLY on code where its trigger regex matches a line, so a rule cannot cause false alarms elsewhere.
You get the planted bugs it missed (code line and why it is a bug) and its false alarms (code line and what it wrongly said).
Propose up to 4 candidates, each aimed at a different kind of miss. Each has:
- "trigger": a JavaScript regex source (no slashes, case-insensitive) that matches the kind of code line where this defect lives: API names, operators, keywords. It must be generic: no variable, function, file or product names from the examples. It should match the missed line and as few other lines as possible.
- "rule": one sentence, at most 50 words, in the form "When <pattern>, check <what>; flag only if you can quote <evidence>; not when <exception>." Take the exception from the false alarms where you can.
Do not propose a rule that repeats one already listed. Reply with only this JSON: {"candidates":[{"trigger":"...","rule":"..."}],"why":"<= 30 words"}`;
    let gated = [], gbest = best;
    for (let r = 1; r <= ROUNDS; r++) {
      // Evidence comes from the fit split only, so the check split stays unseen by the rule writer.
      const fitIds = new Set(P.tasks.filter(isFit).map((t) => t.id)), ms = tally(gbest.misses.filter((m) => fitIds.has(m.task))).slice(0, 16), fs = tally(gbest.fas.filter((f) => fitIds.has(f.task))).slice(0, 12);
      const ask = "Learned rules so far:\n" + (gated.length ? gated.map((g) => `- [${g.trigger.source}] ${g.rule}`).join("\n") : "(none)") +
        "\n\nMissed bugs (missed in n of " + TRIALS + " runs):\n" + ms.map((m) => `- [${m.n}x] \`${m.code}\` — ${m.why}`).join("\n") +
        "\n\nFalse alarms:\n" + fs.map((f) => `- [${f.n}x] \`${f.code}\` — reviewer said: ${f.comment}`).join("\n") +
        (rejected.length ? "\n\nCandidates already tried that did not help (do not propose again):\n" + rejected.map((x) => "- " + x).join("\n") : "");
      const rr = await turn(`i/self-gated-r${r}`, SELF, ask, GM);
      const raw = (jsonFindings(rr.text, "candidates") || []).slice(0, 4), checked = [];
      for (const [i, c] of raw.entries()) {
        let re = null, why = null;
        try { if (typeof c?.trigger !== "string" || typeof c?.rule !== "string" || c.trigger.length > 200 || c.rule.length < 20) throw new Error("bad shape"); re = new RegExp(c.trigger, "i"); } catch (e) { why = "invalid: " + e.message; }
        let fired = 0, hits = 0;
        if (re) { for (const t of P.tasks) { const code = lineOf(t), on = [...code].filter(([, x]) => re.test(x)).map(([n]) => n); if (on.length) fired++; for (const m of ms) if (m.task === t.id && on.some((n) => Math.abs(n - m.line) <= 1)) hits++; }
          if (!why && gated.some((g) => g.trigger.source === re.source)) why = "same trigger as a kept rule";
          if (!why && hits === 0) why = "fires on no missed bug"; if (!why && fired > MAXF) why = `fires on ${fired} tasks (max ${MAXF})`; }
        const cand = { id: `L${r}${"abcd"[i]}`, trigger: re, rule: String(c?.rule || "").trim().slice(0, 400), fired, hits };
        console.log("GK3_CAND " + JSON.stringify({ round: r, id: cand.id, trigger: c?.trigger, rule: cand.rule, fired, missHits: hits, rejectedByCode: why }));
        if (why) rejected.push(`[${c?.trigger}] ${cand.rule}`); else checked.push(cand);
      }
      let pick = null;
      for (const c of checked) {
        const e = await evalRules(`self r${r} ${c.id}`, [...gated, c]);
        const ok = e.net - gbest.net >= GAIN && e.fitNet >= gbest.fitNet && e.checkNet >= gbest.checkNet;
        console.log("GK3_SELF " + JSON.stringify({ round: r, id: c.id, rule: c.rule, trigger: c.trigger.source, base: { net: gbest.net, caught: gbest.caught, fa: gbest.fa, fit: gbest.fitNet, check: gbest.checkNet }, cand: { net: e.net, caught: e.caught, fa: e.fa, fit: e.fitNet, check: e.checkNet }, fitTest: paired(gbest, e, true), checkTest: paired(gbest, e, false), ok }));
        if (ok && (!pick || e.net > pick.e.net)) pick = { c, e }; else if (!ok) rejected.push(`[${c.trigger.source}] ${c.rule}`);
      }
      if (pick) { gated = [...gated, pick.c]; gbest = pick.e; }
      console.log("GK3_SELF_ROUND " + JSON.stringify({ round: r, candidates: raw.length, passedCode: checked.length, kept: pick ? pick.c.id : null, net: gbest.net, caught: gbest.caught, fa: gbest.fa }));
    }
    const out = gated.map((g) => ({ id: g.id, trigger: g.trigger.source, rule: g.rule }));
    console.log("GK3_LEARNED_GATED " + JSON.stringify({ rules: out, sha256: createHash("sha256").update(JSON.stringify(out)).digest("hex"), start: { net: best.net, caught: best.caught, fa: best.fa }, end: { net: gbest.net, caught: gbest.caught, fa: gbest.fa }, fitTest: paired(best, gbest, true), checkTest: paired(best, gbest, false) }));
    console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6, best: { net: gbest.net, caught: gbest.caught, fa: gbest.fa }, learned: out }));
    return;
  }
  for (let r = 1; r <= ROUNDS; r++) {
    // The improver sees fit-split evidence only, so the check split stays unseen.
    const fitOnly = new Set(P.tasks.filter(isFit).map((t) => t.id)), ms = tally(best.misses.filter((m) => fitOnly.has(m.task))).slice(0, 14), fs = tally(best.fas.filter((f) => fitOnly.has(f.task))).slice(0, 10);
    const ask = "Current instructions:\n" + rules + "\n\nMissed bugs (missed in n of " + TRIALS + " runs):\n" + ms.map((m) => `- [${m.n}x] line ${m.line}: \`${m.code}\` — ${m.why}`).join("\n") +
      "\n\nFalse alarms:\n" + fs.map((f) => `- [${f.n}x] line ${f.line}: \`${f.code}\` — reviewer said: ${f.comment}`).join("\n") + (rejected.length ? "\n\nRules already tried that did not help (do not propose these again):\n" + rejected.map((x) => "- " + x).join("\n") : "");
    const rr = await turn(`i/improve-r${r}`, IMPROVER, ask, GM);
    const nr = (jsonFindings(rr.text, "rules") || []).filter((x) => typeof x === "string" && x.length > 10).slice(0, 2).map((x) => x.trim().slice(0, 300));
    if (!nr.length) { console.log("GK3_IMPROVE " + JSON.stringify({ round: r, error: "no rules", status: rr.status })); continue; }
    const candRules = withRules([...learned, ...nr]);
    const c = await evalRules(BAGMODE ? `round ${"BCDEFG"[r - 1]}` : `r${r}`, candRules);
    const ok = c.net - best.net >= GAIN && c.fitNet >= best.fitNet && c.checkNet >= best.checkNet;
    console.log("GK3_IMPROVE " + JSON.stringify({ round: r, rules: nr, why: (() => { try { return JSON.parse(rr.text.slice(rr.text.indexOf("{"), rr.text.lastIndexOf("}") + 1)).why; } catch { return null; } })(), base: { net: best.net, caught: best.caught, fa: best.fa, fit: best.fitNet, check: best.checkNet }, cand: { net: c.net, caught: c.caught, fa: c.fa, fit: c.fitNet, check: c.checkNet }, delta: { net: c.net - best.net, caught: c.caught - best.caught, falseAlarms: c.fa - best.fa, fit: c.fitNet - best.fitNet, check: c.checkNet - best.checkNet }, fitTest: paired(best, c, true), checkTest: paired(best, c, false), accepted: ok }));
    if (ok) { rules = candRules; learned = [...learned, ...nr]; best = c; } else rejected.push(...nr);
  }
  console.log("GK3_RULES " + JSON.stringify({ learned, sha256: createHash("sha256").update(rules).digest("hex") }));
  console.log("GK3_FINAL " + JSON.stringify(rules));
  console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6, best: { net: best.net, caught: best.caught, fa: best.fa }, focused: { net: fq.net, caught: fq.caught, fa: fq.fa, avgUsd: fq.avgUsd }, learned }));
}
if (process.env.GK3_IMPROVE) { await improve(); } else if (process.env.GK3_PIPE) { await pipe(); } else if (process.env.GK3_MATRIX) {
  const M = { ds: MODEL, oss: "tfy-direct/gpt-oss-120b", glm: "tfy-direct/glm-5-3-flash", mimo: "tfy-direct/mimo-v2-6-flash" };
  const G = { ds: ["gk_v10", "ds"], ds2: ["gk_v10", "ds"], ds0: ["gk_v10", "ds", 0], ds8: ["gk_v8", "ds"], oss: ["gk_v10", "oss"], glm: ["gk_v10", "glm"], mimo: ["gk_v10", "mimo"] };
  const JM = ["ds", "oss", "glm"];
  const C = [
    ["ds", ["ds"], "one"], ["oss", ["oss"], "one"], ["glm", ["glm"], "one"], ["mimo", ["mimo"], "one"], ["ds_t0", ["ds0"], "one"], ["ds_v8", ["ds8"], "one"],
    ["ds+oss agree", ["ds", "oss"], "agree"], ["ds+oss duo", ["ds", "oss"], "duo"], ["ds+glm duo", ["ds", "glm"], "duo"], ["ds+mimo duo", ["ds", "mimo"], "duo"],
    ["oss+glm duo", ["oss", "glm"], "duo"], ["ds+oss+glm 2of3", ["ds", "oss", "glm"], "maj2"], ["ds+oss+glm 2of3+judge", ["ds", "oss", "glm"], "maj2j"],
    ["ds checked by oss", ["ds"], "check:oss"], ["ds self-check", ["ds"], "check:ds"], ["oss checked by ds", ["oss"], "check:ds"],
    ["ds x2 union checked by oss", ["ds", "ds2"], "union:oss"], ["ds+oss union checked by glm", ["ds", "oss"], "union:glm"],
    ["4-model 2of4", ["ds", "oss", "glm", "mimo"], "maj2"], ["ds_v8+oss duo", ["ds8", "oss"], "duo"],
  ];
  const near = (f, g) => g.start <= f.end + 1 && f.start <= g.end + 1;
  const toSpans = (r) => r.status === "done" ? (jsonFindings(r.text) || null)?.map((x) => { const l = Number(x?.line); return Number.isInteger(l) ? { start: l, end: l, comment: String(x?.comment || "").slice(0, 200) } : null; }).filter(Boolean) ?? null : null;
  const JUDGE = `You check another reviewer's findings on one change. For each finding, decide if it is a real defect a careful senior engineer would block the merge for.
A finding is real only if you can name, from the code and context shown, the realistic input or state that triggers it and the wrong result. Style, speculation and hypotheticals are not real.
Reply with only this JSON: {"verdicts":[{"line":12,"real":true,"trigger":"<= 15 words"}]}, one entry per finding, same line numbers.`;
  const mrows = [];
  const mjobs = [];
  for (let trial = 1; trial <= TRIALS; trial++) for (const task of P.tasks) mjobs.push({ trial, task });
  console.log("GK3_START " + JSON.stringify({ mode: "matrix", models: M, configs: C.length, tasks: P.tasks.length, trials: TRIALS, cap: CAP, sha256: P.sha256 }));
  async function one({ trial, task }) {
    const id = `${task.id}/t${trial}`;
    const gk = Object.keys(G), gr = await Promise.all(gk.map((k) => turn(`m/${id}/${k}`, P.agents[G[k][0]].system, task.prompts.gate_keeper, M[G[k][1]], G[k][2] ?? null)));
    const gen = Object.fromEntries(gk.map((k, i) => [k, { r: gr[i], f: toSpans(gr[i]) }]));
    const all = []; for (const k of gk) for (const f of gen[k].f || []) if (!all.some((g) => g.start === f.start)) all.push(f);
    const jr = await Promise.all(JM.map((j) => all.length ? turn(`m/${id}/judge-${j}`, JUDGE, task.prompts.gate_keeper + "\n\nFindings to check:\n" + all.map((f) => `- line ${f.start}: ${f.comment}`).join("\n"), M[j]) : null));
    const jv = Object.fromEntries(JM.map((j, i) => { const r = jr[i]; const v = r?.status === "done" ? (jsonFindings(r.text, "verdicts") || []) : [];
      return [j, { ok: new Set(v.filter((x) => x?.real === true).map((x) => Number(x.line))), cost: r?.cost || 0, seconds: r?.seconds || 0, n: v.length }]; }));
    console.log("GK3_GEN " + id + " " + JSON.stringify(Object.fromEntries(gk.map((k) => [k, { st: gen[k].r.status, lines: (gen[k].f || []).map((f) => f.start), cost: gen[k].r.cost, s: gen[k].r.seconds, err: gen[k].r.error }]))) + " judges " + JSON.stringify(Object.fromEntries(JM.map((j) => [j, { n: jv[j].n, ok: [...jv[j].ok], cost: jv[j].cost }]))));
    for (const [name, use, how] of C) {
      const fs = use.map((k) => gen[k].f).filter(Boolean);
      let out = null, judges = [];
      if (fs.length) {
        const count = (f) => fs.filter((x) => x.some((g) => near(f, g))).length;
        const uni = []; for (const x of fs) for (const f of x) if (!uni.some((g) => near(f, g) && g.start === f.start)) uni.push(f);
        if (how === "one") out = fs[0];
        else if (how === "agree") out = fs.length < 2 ? fs[0] : fs[0].filter((f) => count(f) >= 2);
        else if (how === "maj2") out = uni.filter((f) => count(f) >= 2);
        else if (how === "duo" || how === "maj2j") {
          out = []; const need = how === "duo" ? 2 : 2;
          for (let i = 0; i < fs.length; i++) for (const f of fs[i]) { if (out.some((g) => near(f, g))) continue;
            if (count(f) >= need) { out.push(f); continue; }
            let judge = how === "duo" ? G[use[1 - i]][1] : (G[use[i]][1] === "ds" ? "oss" : "ds"); if (!JM.includes(judge)) judge = G[use[i]][1] === "oss" ? "ds" : "oss";
            if (!judges.includes(judge)) judges.push(judge);
            if (jv[judge].ok.has(f.start)) out.push(f); }
        } else if (how.startsWith("check:") || how.startsWith("union:")) {
          const j = how.split(":")[1]; judges = [j]; out = (how.startsWith("check:") ? fs[0] : uni).filter((f) => jv[j].ok.has(f.start));
        }
      }
      const gens = use.map((k) => gen[k].r);
      const cost = gens.reduce((a, r) => a + (r.cost || 0), 0) + judges.reduce((a, j) => a + jv[j].cost, 0);
      const seconds = Math.max(...gens.map((r) => r.seconds || 0)) + (judges.length ? Math.max(...judges.map((j) => jv[j].seconds)) : 0);
      const row = { arm: name, task: task.id, trial, ...score(task.expected, out, task.benign || []), cost, seconds };
      mrows.push(row); console.log("GK3_ROW " + JSON.stringify(row));
    }
  }
  const q = [...mjobs];
  await Promise.all(Array.from({ length: CONC }, async () => { while (q.length) await one(q.shift()); }));
  const sum = C.map(([name]) => { const rs = mrows.filter((r) => r.arm === name); const n = rs.length || 1;
    const caught = rs.reduce((a, r) => a + r.caught, 0), fa = rs.reduce((a, r) => a + r.extra, 0);
    return { name, caught, of: rs.reduce((a, r) => a + r.of, 0), fa, net: caught - fa, unparsed: rs.filter((r) => !r.parsed).length,
      avgS: Math.round(10 * rs.reduce((a, r) => a + r.seconds, 0) / n) / 10, avgUsd: Math.round(1e6 * rs.reduce((a, r) => a + r.cost, 0) / n) / 1e6 }; }).sort((a, b) => b.net - a.net);
  for (const x of sum) console.log("GK3_MATRIX " + JSON.stringify(x));
  console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6 }));
} else {
console.log("GK3_START " + JSON.stringify({ runtime: RUNTIME, model: MODEL, set: P.set, arms: ARMS, trials: TRIALS, tasks: P.tasks.length, cap: CAP, params: P.params, sha256: P.sha256 }));
await Promise.all(Array.from({ length: CONC }, worker));
const summary = Object.fromEntries([...new Set(rows.map((r) => r.arm))].map((a) => { const rs = rows.filter((r) => r.arm === a); const n = rs.length || 1;
  const caught = rs.reduce((s, r) => s + r.caught, 0), of = rs.reduce((s, r) => s + r.of, 0);
  return [a, { reviews: rs.length, recallPct: Math.round(1000 * caught / Math.max(1, of)) / 10, caught, of, falseAlarms: rs.reduce((s, r) => s + r.extra, 0),
    unparsed: rs.filter((r) => !r.parsed).length, avgSeconds: Math.round(10 * rs.reduce((s, r) => s + (r.seconds || 0), 0) / n) / 10,
    avgCostUsd: Math.round(1e6 * rs.reduce((s, r) => s + (r.cost || 0), 0) / n) / 1e6 }]; }));
console.log("GK3_SUMMARY " + JSON.stringify({ calls, cacheHits: hits, spentUsd: Math.round(spent * 1e6) / 1e6, summary }));
}
