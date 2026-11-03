// Three-agent review test on stock TrueForge -> DeepSeek via TrueFoundry. Equal limits for every agent.
import { gunzipSync } from "node:zlib";
const { TrueForge } = await import("@truefoundry/trueforge-sdk");
const MODEL = "truefoundry/deepseek-v4-flash-0731", PRICE = [0.3, 1.2];
const CAP = Number(process.env.GK3_CAP_USD || "0.5"), TRIALS = Number(process.env.GK3_TRIALS || "1");
const ARMS = (process.env.GK3_ARMS || "codex,qodo,gate_keeper").split(",");
const CONC = Number(process.env.GK3_CONCURRENCY || "3");
const P = JSON.parse(gunzipSync(Buffer.from(process.env.GK3_PAYLOAD_B64, "base64")).toString("utf8"));
const tf = new TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL, token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 60 });
let spent = 0, reserved = 0, calls = 0;
const est = (chars, out) => ((chars / 3 + 3000) * PRICE[0] + out * PRICE[1]) / 1e6;
async function turn(label, instructions, prompt) {
  const { temperature, maxTokens } = P.params;
  const reserve = est(instructions.length + prompt.length, maxTokens);
  if (spent + reserved + reserve > CAP) return { label, status: "BUDGET_STOP", text: "" };
  reserved += reserve; calls++;
  const t0 = Date.now();
  let sid = null, st = null;
  try {
    const s = await tf.sessions.create({ agent: { spec: { model: { name: MODEL, params: { temperature, maxTokens } }, instructions } },
      metadata: { purpose: "gk-three-agent-" + P.set, label } });
    sid = s.data.id;
    let t = (await tf.sessions.createTurn(sid, { input: [{ type: "user.message", content: prompt }], previousTurnId: "none" }, { maxRetries: 0 })).data;
    for (let i = 0; i < 400 && !["done", "error", "failed", "cancelled"].includes(t?.state?.status); i++) {
      await new Promise((r) => setTimeout(r, 1500)); t = (await tf.sessions.getTurn(sid, t.id)).data;
    }
    st = t?.state;
  } catch (e) { st = { status: "EXCEPTION", error: String(e?.message || e).slice(0, 300) }; }
  if (st?.status !== "done" && sid) { try { await tf.sessions.cancel(sid); } catch {} }
  const o = st?.output, m = st?.metrics ?? null;
  const cost = Number.isFinite(m?.totalCostInUsd) ? m.totalCostInUsd :
    Number.isFinite(m?.totalInputTokens) ? (m.totalInputTokens * PRICE[0] + (m.totalOutputTokens || 0) * PRICE[1]) / 1e6 : reserve;
  reserved -= reserve; spent += cost;
  const text = typeof o?.content === "string" ? o.content : Array.isArray(o?.content) ? o.content.map((x) => x?.text || "").join("") : "";
  const tools = (o?.toolCalls || []).map((x) => x?.function?.name ?? x?.name);
  return { label, status: st?.status, finishReason: o?.finishReason ?? null, tools, text, cost, seconds: Math.round((Date.now() - t0) / 100) / 10,
    error: st?.error ? JSON.stringify(st.error).slice(0, 300) : null, tokens: m ? { in: m.totalInputTokens, out: m.totalOutputTokens, reasoning: m.totalReasoningTokens ?? null } : null };
}
function jsonFindings(text) {
  const c = [...text.matchAll(/```(?:json)?\s*\n([\s\S]*?)```/g)].map((m) => m[1]).reverse();
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a >= 0 && b > a) c.push(text.slice(a, b + 1));
  for (const x of c) { try { const j = JSON.parse(x.trim()); if (Array.isArray(j?.findings)) return j.findings; } catch {} }
  return null;
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
function score(expected, fs) {
  if (!fs) return { parsed: false, caught: 0, of: expected.length, extra: 0 };
  const open = [...expected]; let caught = 0, extra = 0;
  for (const f of fs) { const i = open.findIndex((l) => l >= f.start - 1 && l <= f.end + 1); if (i >= 0) { open.splice(i, 1); caught++; } else extra++; }
  return { parsed: true, caught, of: expected.length, extra };
}
const jobs = [];
for (let trial = 1; trial <= TRIALS; trial++) for (const task of P.tasks) for (const arm of ARMS) jobs.push({ trial, task, arm });
const rows = [];
async function worker() {
  while (jobs.length) {
    const { trial, task, arm } = jobs.shift();
    const r = await turn(`${arm}/${task.id}/t${trial}`, P.agents[arm].system, task.prompts[arm]);
    const sc = score(task.expected, r.status === "done" ? parse(arm, r.text) : null);
    const row = { arm, task: task.id, trial, status: r.status, finish: r.finishReason, tools: r.tools, ...sc, cost: r.cost, seconds: r.seconds, tokens: r.tokens, error: r.error };
    rows.push(row);
    console.log("GK3_ROW " + JSON.stringify(row));
    console.log("GK3_RAW " + `${arm}/${task.id}/t${trial} ` + JSON.stringify(r.text.slice(0, 6000)));
  }
}
console.log("GK3_START " + JSON.stringify({ set: P.set, arms: ARMS, trials: TRIALS, tasks: P.tasks.length, cap: CAP, params: P.params, sha256: P.sha256 }));
await Promise.all(Array.from({ length: CONC }, worker));
const summary = Object.fromEntries(ARMS.map((a) => { const rs = rows.filter((r) => r.arm === a); const n = rs.length || 1;
  const caught = rs.reduce((s, r) => s + r.caught, 0), of = rs.reduce((s, r) => s + r.of, 0);
  return [a, { reviews: rs.length, recallPct: Math.round(1000 * caught / Math.max(1, of)) / 10, caught, of, falseAlarms: rs.reduce((s, r) => s + r.extra, 0),
    unparsed: rs.filter((r) => !r.parsed).length, avgSeconds: Math.round(10 * rs.reduce((s, r) => s + (r.seconds || 0), 0) / n) / 10,
    avgCostUsd: Math.round(1e6 * rs.reduce((s, r) => s + (r.cost || 0), 0) / n) / 1e6 }]; }));
console.log("GK3_SUMMARY " + JSON.stringify({ calls, spentUsd: Math.round(spent * 1e6) / 1e6, summary }));
