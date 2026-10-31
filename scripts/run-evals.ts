// TrueForge manual evaluation: private results only, never automatic promotion.
// Running evaluations requires an explicit operator authorisation; this alone
// does not impose a hard provider spending limit.

import { appendFileSync, existsSync, readFileSync, writeFileSync, openSync, closeSync, unlinkSync, readdirSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { scoreRun, scoreTask } from "../evals/score.ts";
import {
  client,
  die,
  exportSession,
  flag,
  git,
  headSha,
  isClean,
  loadTasks,
  readAgent,
  runDir,
  runTurn,
  sessionStats,
  SUMMARY_CSV,
  PRIVATE_ROOT,
  TASKS_DIR,
  ROOT,
  syncAgent,
  taskPrompt,
  writeJson,
} from "./lib.ts";

const HEADER = "run,session_id,agent_commit,score,date_utc,tasks_passed,tasks_total,tokens,tool_calls,duration_s";

if(process.env.GATE_KEEPER_EVAL_AUTHORIZED!=="1") die("EVAL_NOT_AUTHORIZED: explicit model-evaluation approval required");
const benchmarkFiles=readdirSync(TASKS_DIR).filter(x=>x.endsWith(".json")).sort();
const benchmarkHash=createHash("sha256");
for(const file of benchmarkFiles) {
  benchmarkHash.update(file);
  benchmarkHash.update(readFileSync(join(TASKS_DIR,file)));
}
benchmarkHash.update(readFileSync(join(ROOT,"evals","score.ts")));
const benchmarkSha256=benchmarkHash.digest("hex");
if(process.env.GK_FROZEN_BENCHMARK_SHA256 && process.env.GK_FROZEN_BENCHMARK_SHA256!==benchmarkSha256) die("Frozen benchmark identity mismatch");
const benchmarkFrozen=process.env.GK_FROZEN_BENCHMARK_SHA256===benchmarkSha256;
let lockFD:number;
try {lockFD=openSync(join(PRIVATE_ROOT,"eval.lock"),"wx",0o600);}
catch {die("Evaluation already active or unreconciled");}
try {
// 1. The agent and evaluation must be committed for reproducibility.
if (!isClean("agent", "evals") && !flag("allow-dirty")) {
  die("agent/ or evals/ has uncommitted changes. Commit them first, so agent_commit points at what ran.");
}
const agentCommit = headSha() + (isClean("agent", "evals") ? "" : "-dirty");

if (!existsSync(SUMMARY_CSV) || readFileSync(SUMMARY_CSV, "utf8").trim() === "") writeFileSync(SUMMARY_CSV, HEADER + "\n");
const rows = readFileSync(SUMMARY_CSV, "utf8").trim().split("\n").slice(1).filter(Boolean);
const run = rows.length + 1;
const dir = runDir(run);
const nn = String(run).padStart(2, "0");

// 2. Make the TrueForge agent match agent/ at this commit.
const tf = client();
const agent = await syncAgent(tf, headSha());
const tasks = loadTasks();
console.log(`Run ${nn}: agent "${agent.name}" at ${agentCommit.slice(0, 7)}, ${tasks.length} tasks`);

// 3. One session for the whole run. https://trueforge.dev/api/overview#session
const started = Date.now();
const { data: session } = await tf.sessions.create({
  agent: { name: readAgent().agent.name },
  metadata: { purpose: "eval", run: nn, agent_commit: agentCommit },
});
await tf.sessions.update(session.id, { title: `eval run ${nn} @ ${agentCommit.slice(0, 7)}` });
console.log(`  session ${session.id}`);

// 4. Each task is one root turn; score the reply.
const results = [];
for (const task of tasks) {
  process.stdout.write(`  ${task.id.padEnd(24)} `);
  const turn = await runTurn(tf, session.id, taskPrompt(task));
  const scored = scoreTask(task, turn.text);
  results.push({ ...scored, turn_id: turn.turnId, status: turn.status, error: turn.error, reply: turn.text });
  console.log(`${turn.status === "done" ? "" : `[${turn.status}] `}${scored.score.toFixed(2)}${scored.passed ? "  pass" : ""}`);
}
const durationS = Math.round((Date.now() - started) / 1000);
const total = scoreRun(results);

// 5. Save the run.
const exp = await exportSession(tf, session.id);
const stats = sessionStats(exp);
writeJson(join(dir, "results.json"), results);
writeJson(join(dir, "score.json"), { run, session_id: session.id, agent_commit: agentCommit,
  benchmark_sha256: benchmarkSha256, qualification: benchmarkFrozen ? "benchmark_frozen_only" : "unqualified",
  ...total, ...stats, duration_s: durationS });
writeJson(join(dir, "session.json"), exp);

const date = new Date().toISOString().replace(/\.\d+Z$/, "Z");
appendFileSync(
  SUMMARY_CSV,
  [run, session.id, agentCommit, total.score, date, total.tasks_passed, total.tasks_total, stats.tokens, stats.toolCalls, durationS].join(",") + "\n",
);

console.log(`\nRun ${nn} score: ${total.score} (${total.tasks_passed}/${total.tasks_total} tasks passed, ${stats.tokens} tokens)`);

// No raw TrueForge transcripts, tasks or learning state may enter this public repository.
console.log("Private evaluation saved. No independent qualification or promotion.");
} finally {closeSync(lockFD);unlinkSync(join(PRIVATE_ROOT,"eval.lock"));}
