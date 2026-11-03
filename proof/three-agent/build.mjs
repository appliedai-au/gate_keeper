// Builds a self-contained payload: three agents x a task set. Usage: tsx build.mjs <practice|test> <gk-file> <out>
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";
import { taskPrompt } from "../../scripts/proof/live/review.mjs";
const S = new URL("./", import.meta.url).pathname;
const R = new URL("../../", import.meta.url).pathname;
const sha = (v) => createHash("sha256").update(v).digest("hex");
const [set, gkFile, out] = process.argv.slice(2);
// set: "practice", or a folder path holding task JSON files (e.g. one sealed tranche).
const files = set === "practice"
  ? [...readdirSync(R + "evals/tasks").map((f) => R + "evals/tasks/" + f), R + "proof/fixtures/four-rounds/05-ts-task-pagination.json",
     ...readdirSync(R + "proof/fixtures/native-hard").map((f) => R + "proof/fixtures/native-hard/" + f)].filter((f) => f.endsWith(".json")).sort()
  : readdirSync(set).filter((f) => f.endsWith(".json")).sort().map((f) => set.replace(/\/?$/, "/") + f);
const tasks = files.map((f) => JSON.parse(readFileSync(f, "utf8")));
const codex = readFileSync(S + "vendor/openai-codex/review-rubric.md", "utf8");
if (sha(codex) !== "ec60e7f36a1d1c2679ce095c0205ecc56f7dd8fb57707a13ef362072390f219f") throw new Error("codex rubric changed");
const render = (cap) => JSON.parse(execFileSync("python3", [S + "render_qodo.py", S + "vendor/qodo-pr-agent", String(cap)], { input: JSON.stringify(tasks) }).toString());
const qodo = render(20), qodo3 = render(3);
const gk = readFileSync(gkFile, "utf8");
const payload = {
  set: set === "practice" ? "practice" : set.split("/").filter(Boolean).pop(), params: { temperature: 0.2, maxTokens: 8000 },
  agents: { codex: { system: codex }, qodo: { system: qodo.system }, qodo_cap3: { system: qodo3.system }, gate_keeper: { system: gk } },
  tasks: tasks.map((t) => ({ id: t.id, expected: t.expected.map((e) => e.line), benign: Array.isArray(t.benign) ? t.benign : [],
    prompts: { codex: taskPrompt(t), gate_keeper: taskPrompt(t), qodo: qodo.users[t.id], qodo_cap3: qodo3.users[t.id] } })),
};
payload.sha256 = { codex: sha(codex), qodo_system: sha(qodo.system), qodo_cap3_system: sha(qodo3.system), gate_keeper: sha(gk), tasks: sha(JSON.stringify(payload.tasks)) };
const b64 = gzipSync(Buffer.from(JSON.stringify(payload))).toString("base64");
writeFileSync(out, b64);
console.log(set, tasks.length, "tasks;", tasks.reduce((s, t) => s + t.expected.length, 0), "bugs; b64", b64.length, payload.sha256);
