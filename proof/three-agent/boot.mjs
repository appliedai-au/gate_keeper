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
const { randomBytes } = await import("node:crypto");
const prefix = randomBytes(16).toString("hex");
const proxy = startProxy({ port: 8787, prefix });
// Private network only. TrueForge's SSRF guard must list this host in OUTBOUND_URL_ALLOWED_HOSTS.
const privateHost = process.env.RAILWAY_PRIVATE_DOMAIN || "gk-native-runner.railway.internal";
// Register whichever model is configured on the proxied provider, and always run through it.
const m = (process.env.GK3_MODEL || "deepseek-v4-flash-0731").replace(/^[^/]+\//, "");
process.env.GK3_MODEL = "tfy-direct/" + m;
const key = process.env.GK_TFY_PAT || "";
if (key.length < 20) { console.error("GK3_PAT_MISSING"); process.exit(2); }
const tf = new globalThis.GK3_SDK.TrueForge({ baseUrl: process.env.TRUEFORGE_BASE_URL, token: process.env.TRUEFORGE_TOKEN, timeoutInSeconds: 60 });
await tf.settings.modelProviders.createOrUpdate({ manifest: { type: "custom", name: "tfy-direct",
  baseUrl: "http://" + privateHost + ":8787/" + prefix + "/api/llm", auth: { apiKey: key },
  models: [{ name: m, modelId: "tfy-managed/" + m, properties: {} }] } });
console.log("GK3_BOOT " + c + " " + process.env.GK3_PAYLOAD + " model " + process.env.GK3_MODEL + " via sse-proxy");
await import("file:///tmp/gk3-run.mjs");
console.log("GK3_PROXY " + JSON.stringify(proxy.stats()));
process.exit(0);
