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
async function turn(label, instructions, prompt) {
  const { temperature, maxTokens } = P.params;
  const reserve = est(instructions.length + prompt.length, maxTokens);
  if (spent + reserved + reserve > CAP) return { label, status: "BUDGET_STOP", text: "" };
  reserved += reserve; calls++;
  const t0 = Date.now();
  let sid = null, st = null, tid = null;
  try {
    const s = await tf.sessions.create({ agent: { spec: { model: { name: MODEL, params: { temperature, maxTokens } }, instructions, config: RUNTIME } },
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
function jsonFindings(text) {
  let best = null;
  for (let a = text.indexOf("{"); a >= 0; a = text.indexOf("{", a + 1)) {
    let d = 0, q = false, esc = false;
    for (let i = a; i < text.length; i++) {
      const ch = text[i];
      if (q) { if (esc) esc = false; else if (ch === "\\") esc = true; else if (ch === '"') q = false; continue; }
      if (ch === '"') q = true; else if (ch === "{") d++; else if (ch === "}" && --d === 0) {
        try { const j = JSON.parse(text.slice(a, i + 1)); if (Array.isArray(j?.findings)) best = j.findings; } catch {}
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
const jobs = [];
for (let trial = 1; trial <= TRIALS; trial++) for (const task of P.tasks) for (const arm of ARMS) jobs.push({ trial, task, arm });
const rows = [];
async function worker() {
  while (jobs.length) {
    const { trial, task, arm } = jobs.shift();
    const r = await turn(`${arm}/${task.id}/t${trial}`, P.agents[arm].system, task.prompts[arm]);
    const sc = score(task.expected, r.status === "done" ? parse(arm, r.text) : null, task.benign || []);
    const row = { arm, task: task.id, trial, status: r.status, finish: r.finishReason, source: r.source, outputNull: r.outputNull, reasoningChars: r.reasoningChars, tools: r.tools, ...sc, cost: r.cost, seconds: r.seconds, tokens: r.tokens, error: r.error };
    rows.push(row);
    console.log("GK3_ROW " + JSON.stringify(row));
    console.log("GK3_RAW " + `${arm}/${task.id}/t${trial} ` + JSON.stringify(r.text.slice(0, 6000)));
  }
}
console.log("GK3_START " + JSON.stringify({ runtime: RUNTIME, model: MODEL, set: P.set, arms: ARMS, trials: TRIALS, tasks: P.tasks.length, cap: CAP, params: P.params, sha256: P.sha256 }));
await Promise.all(Array.from({ length: CONC }, worker));
const summary = Object.fromEntries(ARMS.map((a) => { const rs = rows.filter((r) => r.arm === a); const n = rs.length || 1;
  const caught = rs.reduce((s, r) => s + r.caught, 0), of = rs.reduce((s, r) => s + r.of, 0);
  return [a, { reviews: rs.length, recallPct: Math.round(1000 * caught / Math.max(1, of)) / 10, caught, of, falseAlarms: rs.reduce((s, r) => s + r.extra, 0),
    unparsed: rs.filter((r) => !r.parsed).length, avgSeconds: Math.round(10 * rs.reduce((s, r) => s + (r.seconds || 0), 0) / n) / 10,
    avgCostUsd: Math.round(1e6 * rs.reduce((s, r) => s + (r.cost || 0), 0) / n) / 1e6 }]; }));
console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6, summary }));
