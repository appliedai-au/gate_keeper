// Direct launcher for a run on an already-registered TrueForge model provider (no SSE proxy, no provider setup).
// Fetches the harness, rule module, payload and the Gate Keeper prompt file from GK3_COMMIT, then runs run.mjs.
// GK3_MODEL names the registered provider/model, e.g. gk-allmodels/deepseek-v4-flash-0731.
import { writeFileSync } from "node:fs";
const c = process.env.GK3_COMMIT;
if (!/^[a-f0-9]{40}$/.test(c || "")) { console.error("GK3_COMMIT_INVALID"); process.exit(2); }
const base = "https://raw.githubusercontent.com/appliedai-au/gate_keeper/" + c + "/proof/three-agent/";
const get = async (p) => { const r = await fetch(base + p); if (!r.ok) { console.error("GK3_FETCH_FAILED", p, r.status); process.exit(2); } return r.text(); };
writeFileSync("/tmp/gk3-run.mjs", await get("run.mjs"));
writeFileSync("/tmp/gk3-bag.mjs", await get("gk-bag.mjs"));
process.env.GK3_PAYLOAD_B64 = (await get("payloads/" + process.env.GK3_PAYLOAD)).trim();
if (process.env.GK3_GK_FILE) process.env.GK3_GK_SYSTEM = await get(process.env.GK3_GK_FILE);
console.log("GK3_BOOT " + JSON.stringify({ commit: c, payload: process.env.GK3_PAYLOAD, gk: process.env.GK3_GK_FILE || null, model: process.env.GK3_MODEL, direct: true }));
await import("file:///tmp/gk3-run.mjs");
process.exit(0);
