// Adds Gate Keeper's fingerprint store to a payload. Usage: node mkbag.mjs <base.b64> <out.b64> <source.b64>...
// Bug fingerprints = the code lines of planted bugs in the SOURCE payloads only. Never pass the payload being scored,
// or the sealed holdout, as a source: that would be scoring on what was learned.
import { readFileSync, writeFileSync } from "node:fs";
import { gzipSync, gunzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { fingerprint, codeLines } from "./gk-bag.mjs";
const load = (f) => JSON.parse(gunzipSync(Buffer.from(readFileSync(f, "utf8").trim(), "base64")).toString("utf8"));
const [base, out, ...srcs] = process.argv.slice(2);
const P = load(base), bug = new Set(), from = [];
for (const s of srcs) { const Q = load(s); for (const t of Q.tasks) { const code = codeLines(t.prompts.gate_keeper); from.push(t.id);
  for (const l of t.expected) { const line = code.get(l); if (line && line.replace(/\s+/g, " ").trim().length >= 12) bug.add(fingerprint(line)); } } }
const clash = P.tasks.filter((t) => from.includes(t.id)).map((t) => t.id);
if (clash.length) { console.error("refusing: sources overlap the scored set", clash); process.exit(2); }
P.fingerprints = { bug: [...bug].sort(), fa: [], from };
P.set += "-bag";
const json = JSON.stringify(P); P.sha256 = createHash("sha256").update(json).digest("hex");
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(P))).toString("base64"));
console.log(out, P.tasks.length, "tasks;", bug.size, "bug fingerprints from", from.length, "source tasks");
