// Candidate-only TrueForge learning. Never write to active agent/ or publish private
// evaluation transcripts. Promotion requires an independent signed qualification.

import { existsSync, readFileSync } from "node:fs";
import { validateCandidate, candidateDigest } from "./learning-policy.mjs";
import { join, normalize } from "node:path";
import type { TaskScore } from "../evals/score.ts";
import {
  client,
  buildManifest,
  die,
  exportSession,
  flag,
  git,
  isClean,
  loadTasks,
  numbered,
  option,
  readAgent,
  ROOT,
  runDir,
  runTurn,
  SUMMARY_CSV,
  writeJson,
} from "./lib.ts";

// ---------- which run ----------

const rows = existsSync(SUMMARY_CSV) ? readFileSync(SUMMARY_CSV, "utf8").trim().split("\n").slice(1).filter(Boolean) : [];
if (!rows.length) die("No runs yet. Run npm run run-evals first.");
const run = Number(option("run") ?? rows.length);
if(!Number.isSafeInteger(run) || run<1 || run>rows.length) die("Invalid training run identifier");
const dir = runDir(run);
const nn = String(run).padStart(2, "0");
if (!existsSync(join(dir, "results.json"))) die(`No results for run ${nn} in ${dir}`);
if (!isClean("agent", "evals")) die("Training requires a committed, frozen agent and benchmark");
if(process.env.GATE_KEEPER_EVAL_AUTHORIZED!=="1" || process.env.GK_PROVIDER_HARD_BUDGET_CONFIRMED!=="1")
  die("IMPROVEMENT_HELD: operator approval and externally enforced provider spend ceiling required");
if((readAgent().agent.skill_mode ?? "inline")!=="inline")
  die("IMPROVEMENT_HELD: only tool-free inline agent improvement is qualified");
const saved = JSON.parse(readFileSync(join(dir, "score.json"), "utf8"));
if(saved.run!==run || saved.agent_commit!==git("rev-parse","HEAD") ||
  !/^[0-9a-f]{64}$/.test(saved.benchmark_sha256||""))
  die("IMPROVEMENT_HELD: evaluation source or benchmark provenance mismatch");
if(existsSync(join(dir,"candidate.json")) || existsSync(join(dir,"improve-session.json")) ||
  existsSync(join(dir,"improve-intent.json")))
  die("IMPROVEMENT_HELD: previous attempt exists; reconcile before any paid retry");

type Result = TaskScore & { reply: string };
const results = JSON.parse(readFileSync(join(dir, "results.json"), "utf8")) as Result[];
const tasks = new Map(loadTasks().map((t) => [t.id, t]));
const failed = results.filter((r) => !r.passed && !r.holdout);
if (!failed.length) {
  console.log(`Nothing to learn from run ${nn}: every training task passed. Add harder tasks before run 1 next time.`);
  process.exit(0);
}

// ---------- the prompt ----------

const { agent, instructions, skills } = readAgent();
const currentFiles = [
  { path: "agent/instructions.md", text: instructions },
  ...skills.map((s) => ({ path: `${s.path}/SKILL.md`, text: readFileSync(join(ROOT, s.path, "SKILL.md"), "utf8") })),
];

const feedback = failed
  .map((r) => {
    const t = tasks.get(r.task_id)!;
    const missed = r.missed.map((m) => `  - missed: line ${m.line} (${m.categories.join(" or ")}): ${m.why}`);
    const noise = r.noise.map((n) => `  - not a real problem: line ${n.line} (${n.category})${n.comment ? `: ${n.comment}` : ""}`);
    return [
      `### ${t.filename} — score ${r.score.toFixed(2)}${r.parsed ? "" : " — your reply had no valid ```json block with \"findings\""}`,
      "```" + t.language,
      numbered(t.code),
      "```",
      "Your reply ended with:",
      "```",
      r.reply.slice(-1500) || "(empty reply)",
      "```",
      "The scorer says:",
      ...missed,
      ...noise,
    ].join("\n");
  })
  .join("\n\n");

const prompt = `This message is not a code review. Ignore the Output section of your instructions for this reply.

You are improving your own playbook. Below are your current instruction files, then the reviews you got wrong in your last evaluation run, with what the scorer said.

Rewrite your files so that next time you catch the kinds of problems you missed and stop making the kinds of comments that were not real problems.

Rules:
- Write general rules that would help on code you have never seen. Never mention these files, file names, task names, function names or line numbers.
- Keep what works. Change only what the failures show is wrong or missing. Keep the Output section of instructions.md exactly as it is: the scorer depends on it.
- Short beats long: a checklist item is one line, with what to look for.
- You may edit agent/instructions.md and any agent/skills/<name>/SKILL.md (keep the frontmatter). Leave out files you don't change.

Reply with each changed file in full, in this format, and nothing else:

<<<FILE agent/skills/review-checklist/SKILL.md
(the whole new file)
>>>
<<<LEARNED
(one sentence: what you learned)
>>>

## Your current files

${currentFiles.map((f) => `<<<FILE ${f.path}\n${f.text.trim()}\n>>>`).join("\n\n")}

## What went wrong in run ${nn}

${feedback}
`;

// ---------- ask the agent ----------

// Persist no-retry intent *before* invoking a paid TrueForge session.
writeJson(join(dir,"improve-intent.json"), {from_run:run, agent_commit:saved.agent_commit,
  benchmark_sha256:saved.benchmark_sha256, state:"admitted_unsettled", promotion:"DISABLED"});
const tf = client();
const coach = flag("coach");
const { data: session } = await tf.sessions.create({
  // The agent itself (by name), or a coach: an inline TrueForge agent on the same model.
  // Never reference or update the shared hosted agent during a learning trial.
  agent: coach
    ? { spec: { model: agent.model, instructions: "You coach a code-review agent; propose general rules without access to evaluators or code execution.", config: { askUserQuestions: { enabled: false }, generativeUi: { enabled: false } } } }
    : { spec: buildManifest(git("rev-parse","HEAD")) },
  metadata: { purpose: "improve", learned_from_run: nn },
});
await tf.sessions.update(session.id, { title: `improve from run ${nn}` });
console.log(`Asking ${coach ? "the coach" : `"${agent.name}"`} to rewrite its playbook from ${failed.length} failed tasks (session ${session.id})…`);

const turn = await runTurn(tf, session.id, prompt, false);
if (turn.status !== "done") die(`The turn ended with status ${turn.status}${turn.error ? `: ${turn.error}` : ""}`);

// ---------- parse and check the change ----------

const files = [...turn.text.matchAll(/<<<FILE ([^\n]+)\n([\s\S]*?)\n>>>/g)].map((m) => ({ path: normalize(m[1].trim()), text: m[2].trimEnd() + "\n" }));
const learned = turn.text.match(/<<<LEARNED\n([\s\S]*?)\n>>>/)?.[1].trim() ?? "";
if (!files.length) die("The learning model did not return valid candidate files");

const allowed = /^agent\/(instructions\.md|skills\/[a-z0-9][a-z0-9-]*\/SKILL\.md)$/;
for (const f of files) {
  if (!allowed.test(f.path)) die(`The agent tried to write ${f.path}. Only agent/instructions.md and agent/skills/<name>/SKILL.md are allowed.`);
}

// Overfitting guard: the new playbook must not quote the eval tasks.
const leaks: string[] = [];
for (const t of loadTasks()) {
  const quotes = [t.id, t.filename, ...t.expected.map((e) => t.code[e.line - 1].trim()).filter((l) => l.length >= 16)];
  for (const f of files) for (const q of quotes) if (f.text.includes(q)) leaks.push(`${f.path} quotes "${q}"`);
}
if (leaks.length) die(`The change quotes the eval tasks, so it would overfit:\n  ${leaks.join("\n  ")}\nRun improve again; leakage is not overridable.`);

for (const f of files.filter((f) => f.path.endsWith("/SKILL.md"))) {
  if (!/^---\n[\s\S]*?\bname:[\s\S]*?\bdescription:[\s\S]*?\n---\n/.test(f.text) || f.text.split("\n").length < 6) {
    die(`${f.path} lost its frontmatter (name, description) or its body. Run improve again.`);
  }
}
const newInstructions = files.find((f) => f.path === "agent/instructions.md");
if (newInstructions && !newInstructions.text.includes('"findings"')) {
  die("The new instructions.md dropped the JSON output format the scorer needs. Run improve again.");
}

// ---------- immutable private candidate, no active mutation ----------
const candidateFiles = validateCandidate(files, instructions);
const digest = candidateDigest(candidateFiles, instructions);
writeJson(join(dir, "candidate.json"), {
  schema: "gate-keeper-learning-candidate-v1",
  source_commit: git("rev-parse", "HEAD"),
  from_run: nn,
  trueforge_session_id: session.id,
  digest,
  learned,
  files: candidateFiles,
  promotion: "BLOCKED_PENDING_INDEPENDENT_QUALIFICATION",
});
writeJson(join(dir, "improve-session.json"), await exportSession(tf, session.id));
console.log("Candidate staged privately (" + digest + "); active agent and repository unchanged.");
console.log("Independent holdout, signed verdict and reviewed promotion PR are required.");
