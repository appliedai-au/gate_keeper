// Runner boot: fetch the harness at GK3_COMMIT, start the SSE re-framing proxy, point the
// "tfy-direct" TrueForge provider at it (token read from env, never printed), then run.
import { writeFileSync } from "node:fs";
const c = process.env.GK3_COMMIT, base = "https://raw.githubusercontent.com/appliedai-au/gate_keeper/" + c + "/proof/three-agent/";
const get = async (p) => { const r = await fetch(base + p); if (!r.ok) { console.error("GK3_FETCH_FAILED", p, r.status); process.exit(2); } return r.text(); };
writeFileSync("/tmp/gk3-sse-proxy.mjs", await get("sse-proxy.mjs"));
writeFileSync("/tmp/gk3-run.mjs", await get("run.mjs"));
process.env.GK3_PAYLOAD_B64 = (await get("payloads/" + process.env.GK3_PAYLOAD)).trim();
globalThis.GK3_SDK ??= await import("@truefoundry/trueforge-sdk");
const { startProxy } = await import("file:///tmp/gk3-sse-proxy.mjs");
const proxy = startProxy({ port: 8787 });
const key = process.env.GK_TFY_PAT || "";
if (key.length < 20) { console.error("GK3_PAT_MISSING"); process.exit(2); }
const tf = new globalThis.GK3_SDK.TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL, token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 60 });
await tf.settings.modelProviders.createOrUpdate({ manifest: { type: "custom", name: "tfy-direct",
  baseUrl: "http://" + (process.env.RAILWAY_PRIVATE_DOMAIN || "gk-native-runner.railway.internal") + ":8787/api/llm", auth: { apiKey: key },
  models: [{ name: "deepseek-v4-flash-0731", modelId: "tfy-managed/deepseek-v4-flash-0731", properties: {} }] } });
console.log("GK3_BOOT " + c + " " + process.env.GK3_PAYLOAD + " via sse-proxy " + (process.env.RAILWAY_PRIVATE_DOMAIN || "default-host"));
await import("file:///tmp/gk3-run.mjs");
console.log("GK3_PROXY " + JSON.stringify(proxy.stats()));
process.exit(0);
