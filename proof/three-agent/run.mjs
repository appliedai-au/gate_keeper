// Three-agent review test on stock TrueForge -> DeepSeek via TrueFoundry. Equal limits for every agent.
import { gunzipSync } from "node:zlib";
const { TrueForge } = globalThis.GK3_SDK ?? await import("@truefoundry/trueforge-sdk");
// Model-agnostic: the same sealed tasks and locked agents rerun on any TrueFoundry model.
const MODEL = process.env.GK3_MODEL || "tfy-direct/deepseek-v4-flash-0731"; // boot.mjs sets this to the proxied provider
const PRICE = (process.env.GK3_PRICE_PER_MTOK || "0.3,1.2").split(",").map(Number);
const CAP = Number(process.env.GK3_CAP_USD || "0.5"), TRIALS = Number(process.env.GK3_TRIALS || "1");
const ARMS = (process.env.GK3_ARMS || "codex,qodo,gate_keeper").split(",");
const CONC = Number(process.env.GK3_CONCURRENCY || "3");
const P = JSON.parse(gunzipSync(Buffer.from(process.env.GK3_PAYLOAD_B64, "base64")).toString("utf8"));
const tf = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL, token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 60 });
let spent = 0, reserved = 0, calls = 0;
// Same for every agent. Reviews are non-interactive: no one can answer TrueForge's built-in ask_user_question
// tool, and a call to it ends the turn with no answer (seen in practice run 2). Everything else stays stock.
const RUNTIME = { askUserQuestions: { enabled: false } };
const est = (chars, out) => ((chars / 3 + 3000) * PRICE[0] + out * PRICE[1]) / 1e6;
// Budget guard only: tokens of output reserved per in-flight call (default maxTokens). Real cost comes from turn metrics.
const RESERVE_OUT = Number(process.env.GK3_RESERVE_OUT || "0");
async function turn(label, instructions, prompt, model = MODEL, tempOverride = null) {
  const { maxTokens } = P.params; const temperature = tempOverride ?? P.params.temperature;
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
const jobs = [];
for (let trial = 1; trial <= TRIALS; trial++) for (const task of P.tasks) for (const arm of ARMS) jobs.push({ trial, task, arm });
const rows = [];
async function worker() {
  while (jobs.length) {
    const { trial, task, arm } = jobs.shift();
    if (arm.endsWith("_vote")) { await vote(arm, task, trial); continue; }
    if (arm.endsWith("_duo")) { await duo(arm, task, trial); continue; }
    const r = await turn(`${arm}/${task.id}/t${trial}`, P.agents[arm].system, task.prompts[arm]);
    const sc = score(task.expected, r.status === "done" ? parse(arm, r.text) : null, task.benign || []);
    const row = { arm, task: task.id, trial, status: r.status, finish: r.finishReason, source: r.source, outputNull: r.outputNull, reasoningChars: r.reasoningChars, tools: r.tools, ...sc, cost: r.cost, seconds: r.seconds, tokens: r.tokens, error: r.error };
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
if (process.env.GK3_PIPE) { await pipe(); } else if (process.env.GK3_MATRIX) {
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
console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6, summary }));
}
