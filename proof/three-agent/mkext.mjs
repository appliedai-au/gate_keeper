// Training payload for the improve step on extended stacks: Gate Keeper plus the unchanged Codex rubric as comparison, every planted bug's "why" kept for the
// improver (never shown to the reviewer). Refuses any task marked holdout and any folder named tranche-7.
// Usage: node mkext.mjs <gk-file> <task-dir>... <out.b64>
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { taskPrompt } from "../../scripts/proof/live/review.mjs";
const a = process.argv.slice(2), gkFile = a[0], out = a[a.length - 1], dirs = a.slice(1, -1);
const tasks = [];
for (const d of dirs) {
  if (/tranche-7/.test(d)) throw new Error("refusing sealed tranche-7");
  for (const f of readdirSync(d).filter((x) => x.endsWith(".json")).sort()) {
    const t = JSON.parse(readFileSync(d.replace(/\/?$/, "/") + f, "utf8"));
    if (t.holdout === true && !/tranche-6/.test(d)) throw new Error("refusing holdout task " + t.id);
    tasks.push(t);
  }
}
const gk = readFileSync(gkFile, "utf8"), sha = (v) => createHash("sha256").update(v).digest("hex");
// The Codex review rubric, unchanged (Apache-2.0), as the comparison arm; same task prompt as Gate Keeper.
const codex = readFileSync(new URL("./vendor/openai-codex/review-rubric.md", import.meta.url), "utf8");
if (sha(codex) !== "ec60e7f36a1d1c2679ce095c0205ecc56f7dd8fb57707a13ef362072390f219f") throw new Error("codex rubric changed");
const P = { set: "train-extended-stacks", params: { temperature: 0.2, maxTokens: 8000 }, agents: { codex: { system: codex }, gate_keeper: { system: gk } },
  tasks: tasks.map((t) => ({ id: t.id, expected: t.expected.map((e) => e.line), benign: Array.isArray(t.benign) ? t.benign : [],
    why: t.expected.map((e) => ({ line: e.line, why: e.why })), prompts: { codex: taskPrompt(t), gate_keeper: taskPrompt(t) } })) };
P.sha256 = { codex: sha(codex), gate_keeper: sha(gk), tasks: sha(JSON.stringify(P.tasks)) };
writeFileSync(out, gzipSync(Buffer.from(JSON.stringify(P))).toString("base64"));
console.log(P.tasks.length, "tasks;", P.tasks.reduce((s, t) => s + t.expected.length, 0), "bugs;", P.sha256);
