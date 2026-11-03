// Training payload for the improve step: the t4-t6 training payload (t6 burned) with Gate Keeper v12
// and each planted bug's "why", which only the improver sees (never the reviewer).
// Usage: node mkimprove.mjs <in.b64> <gk-file> <tranche-dir>... <out.b64>
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
const a = process.argv.slice(2), [inp, gkFile] = a, out = a[a.length - 1], dirs = a.slice(2, -1);
const P = JSON.parse(gunzipSync(Buffer.from(readFileSync(inp, "utf8"), "base64")).toString("utf8"));
const why = {};
for (const d of dirs) for (const f of readdirSync(d).filter((x) => x.endsWith(".json"))) {
  const t = JSON.parse(readFileSync(d + "/" + f, "utf8"));
  if (t.holdout === true && !/tranche-6/.test(d)) throw new Error("refusing holdout task " + t.id);
  why[t.id] = t.expected.map((e) => ({ line: e.line, why: e.why }));
}
const gk = readFileSync(gkFile, "utf8");
P.set = "train-t4-t5-t6burned-improve"; P.agents = { gate_keeper: { system: gk } };
for (const t of P.tasks) { if (!why[t.id]) throw new Error("no why for " + t.id); t.why = why[t.id]; t.prompts = { gate_keeper: t.prompts.gate_keeper }; }
const sha = (v) => createHash("sha256").update(v).digest("hex");
P.sha256 = { gate_keeper: sha(gk), tasks: sha(JSON.stringify(P.tasks)) };
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(P))).toString("base64"));
console.log(P.tasks.length, "tasks", P.sha256);
