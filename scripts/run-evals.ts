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
  buildManifest,
  requireSignedBudgetLease,
  taskPrompt,
  writeJson,
} from "./lib.ts";

const HEADER = "run,session_id,agent_commit,score,date_utc,tasks_passed,tasks_total,tokens,tool_calls,duration_s";

if(process.env.GATE_KEEPER_EVAL_AUTHORIZED!=="1") die("EVAL_NOT_AUTHORIZED: explicit model-evaluation approval required");
// A boolean assertion is not an enforced budget. Require a source-bound
// signed lease from an independent gateway before any paid TrueForge call.
if(!process.env.GK_RUN_ID) die("BUDGET_UNVERIFIED: signed run identity missing");
if((readAgent().agent.skill_mode ?? "inline")!=="inline") die("EVAL_UNSUPPORTED: only tool-free inline agent evaluation is qualified");
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
// Preflight before taking the execution lock: deterministic refusals should
// not strand a claim. Dirty source cannot be a reproducible learning baseline.
if(!isClean("agent","evals")) die("Agent or benchmark has uncommitted changes");
if(flag("allow-dirty")) die("Dirty evaluation is not permitted");
const agentCommit=headSha();
const LOCK=join(PRIVATE_ROOT,"eval.lock");
let lockFD:number;
let settled=false;
let retainClaim=false;
try {lockFD=openSync(LOCK,"wx",0o600);}
catch {die("Evaluation already active or unreconciled");}
// process.exit does not run finally. Only PRE-spend failures may release a lock;
// after a paid intent is committed, a signal/crash must leave it for reconciliation.
process.once("exit",()=>{if(!retainClaim){try{unlinkSync(LOCK);}catch{}}});
process.once("SIGINT",()=>process.exit(130));
process.once("SIGTERM",()=>process.exit(143));
try {

if (!existsSync(SUMMARY_CSV) || readFileSync(SUMMARY_CSV, "utf8").trim() === "") writeFileSync(SUMMARY_CSV, HEADER + "\n");
const rows = readFileSync(SUMMARY_CSV, "utf8").trim().split("\n").slice(1).filter(Boolean);
const run = rows.length + 1;
const dir = runDir(run);
const nn = String(run).padStart(2, "0");
// All deterministic pre-spend refusals happen while the run lock is held,
// but BEFORE writing intent.json or retaining that lock. A rejected lease
// must not strand the lock or consume an undersized one-time grant.
const agent = readAgent().agent;
const manifest = buildManifest(agentCommit);
const tasks = loadTasks();
const tf = client();
const permit=requireSignedBudgetLease("eval",agentCommit,benchmarkSha256,
  agent.model.name,process.env.GK_RUN_ID!,tasks.length);
// A successful claim must remain non-retryable after any subsequent failure.
// Persist intent before making any paid request; an uncertain run retains it.
retainClaim=true;
writeJson(join(dir, "intent.json"), {run, agent_commit:agentCommit, benchmark_sha256:benchmarkSha256,
  status:"admitted_no_verdict", budget:"externally_attested", promotion:"DISABLED"});
console.log(`Run ${nn}: isolated TrueForge spec for "${agent.name}" at ${agentCommit.slice(0, 7)}, ${tasks.length} tasks`);

// 3. One session for the whole run. https://trueforge.dev/api/overview#session
const started = Date.now();
const { data: session } = await tf.sessions.create({
  agent: { spec: manifest },
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
settled=true;
} finally {
  closeSync(lockFD);
  // Crash, timeout, interrupted export or unknown cost => retain lock for
  // operator reconciliation. Deleting it would permit duplicate paid work.
  if(settled || !retainClaim) unlinkSync(LOCK);
}
