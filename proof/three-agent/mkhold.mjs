// Locked test payload for the sealed per-language holdout (run 1 vs run 2 after the packs are frozen).
// Verifies the sealed manifest hash first and prints only counts and hashes, never task content.
// Usage: node mkhold.mjs <gk-file> <holdout-dir> <expected-manifest-sha256> <out.b64>
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { taskPrompt } from "../../scripts/proof/live/review.mjs";
const [gkFile, dir0, want, out] = process.argv.slice(2), dir = dir0.replace(/\/?$/, "/"), sha = (v) => createHash("sha256").update(v).digest("hex");
if (/tranche-7/.test(dir)) throw new Error("refusing tranche-7");
const files = readdirSync(dir).filter((x) => x.endsWith(".json")).sort();
const manifest = files.map((f) => `${sha(readFileSync(dir + f))}  ${f}\n`).sort((a, b) => a.split("  ")[1].localeCompare(b.split("  ")[1])).join("");
if (sha(manifest) !== want) throw new Error("holdout manifest hash mismatch");
const tasks = files.map((f) => JSON.parse(readFileSync(dir + f, "utf8")));
const gk = readFileSync(gkFile, "utf8"), codex = readFileSync(new URL("./vendor/openai-codex/review-rubric.md", import.meta.url), "utf8");
if (sha(codex) !== "ec60e7f36a1d1c2679ce095c0205ecc56f7dd8fb57707a13ef362072390f219f") throw new Error("codex rubric changed");
const P = { set: process.argv[3].replace(/\/$/, "").split("/").pop(), params: { temperature: 0.2, maxTokens: 8000 }, agents: { codex: { system: codex }, gate_keeper: { system: gk } },
  tasks: tasks.map((t) => ({ id: t.id, stack: t.stack, expected: t.expected.map((e) => e.line), benign: Array.isArray(t.benign) ? t.benign : [],
    why: t.expected.map((e) => ({ line: e.line, why: e.why })), prompts: { codex: taskPrompt(t), gate_keeper: taskPrompt(t) } })) };
P.sha256 = { codex: sha(codex), gate_keeper: sha(gk), tasks: sha(JSON.stringify(P.tasks)), manifest: want };
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(P))).toString("base64"));
console.log(P.tasks.length, "tasks;", P.tasks.reduce((s, t) => s + t.expected.length, 0), "bugs;", P.sha256);
