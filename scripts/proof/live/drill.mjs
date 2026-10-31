// Disposable repair-drill machinery. No model calls here: fixture repositories,
// bounded patch application, V-model validation jobs with polling, candidate
// disposal and origin-integrity checks. Agent-written code only ever runs in a
// throwaway candidate clone with a scrubbed environment (no runner secrets).
import { spawn, execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sha256 } from "./config.mjs";

const git = (cwd, ...args) => execFileSync("git", args, { cwd, encoding: "utf8", env: gitEnv() }).trim();
function gitEnv() {
  return { PATH: process.env.PATH, HOME: "/tmp", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_NAME: "gk-drill",
    GIT_AUTHOR_EMAIL: "drill@invalid", GIT_COMMITTER_NAME: "gk-drill", GIT_COMMITTER_EMAIL: "drill@invalid" };
}

export function loadVmodel(fixtureDir) {
  const v = JSON.parse(readFileSync(join(fixtureDir, "vmodel.json"), "utf8"));
  if (!v.id || !v.file || !Array.isArray(v.allowed_paths) || !v.allowed_paths.includes(v.file)) throw new Error("VMODEL_INVALID");
  return v;
}

/** Copy a fixture into a fresh git repository: the authorised, disposable "origin". */
export function createFixtureRepo(fixtureDir, workRoot) {
  const v = loadVmodel(fixtureDir);
  const repo = join(workRoot, v.id + "-origin");
  rmSync(repo, { recursive: true, force: true });
  mkdirSync(repo, { recursive: true });
  cpSync(fixtureDir, repo, { recursive: true });
  git(repo, "init", "-q", "-b", "main");
  git(repo, "add", "-A");
  git(repo, "commit", "-q", "-m", "fixture: " + v.id);
  return { repo, vmodel: v, sourceSha: git(repo, "rev-parse", "HEAD"), fileSha256: sha256(readFileSync(join(repo, v.file))) };
}

/** Spec material the repairer may see. Tests stay with the validator. */
export function repairBrief(repo, v) {
  const doc = (f) => (existsSync(join(repo, f)) ? readFileSync(join(repo, f), "utf8").trim() : "");
  return { source: readFileSync(join(repo, v.file), "utf8"), requirements: doc("REQUIREMENTS.md"),
    threats: doc("THREATS.md"), architecture: doc("ARCHITECTURE.md") };
}

export function cloneCandidate(origin, workRoot, label) {
  const dir = join(workRoot, label);
  rmSync(dir, { recursive: true, force: true });
  git(workRoot, "clone", "-q", "--no-hardlinks", origin, dir);
  return dir;
}

/** Last ```javascript / ```js block = the complete replacement file. */
export function extractReplacementFile(reply) {
  const blocks = [...String(reply || "").matchAll(/```(?:javascript|js|mjs)\s*\n([\s\S]*?)```/g)].map((m) => m[1]);
  return blocks.length ? blocks[blocks.length - 1] : null;
}

// Defence in depth only: the real boundary is the Node permission sandbox in runLevel.
const FORBIDDEN = [
  [/\beval\s*\(|\bFunction\s*\(|\bimport\s*\(/, "dynamic code execution or import"],
  [/["'](?:node:)?(?:fs|child_process|worker_threads|vm|net|http|https|http2|dgram|tls|dns|os|module|inspector|cluster|process|v8|wasi)(?:\/[^"']*)?["']/, "restricted core module"],
  [/\bprocess\s*[.[]|\bglobalThis\b|\brequire\s*\(|\bfetch\s*\(|XMLHttpRequest|WebSocket|\bBun\b|\bDeno\b/, "process, global or network access"],
];

/** Apply an agent patch to a candidate clone, bounded by path, size and API rules. */
export function applyBoundedPatch(candidate, v, content) {
  if (typeof content !== "string" || !content.trim()) return { applied: false, reason: "NO_PATCH" };
  for (const [re, why] of FORBIDDEN) if (re.test(content)) return { applied: false, reason: "FORBIDDEN_API: " + why };
  writeFileSync(join(candidate, v.file), content.endsWith("\n") ? content : content + "\n");
  // Tracked modifications plus any untracked files (never parse trimmed porcelain output).
  const changedPaths = [...git(candidate, "diff", "--name-only").split("\n"), ...git(candidate, "ls-files", "--others", "--exclude-standard").split("\n")].filter(Boolean);
  if (changedPaths.some((p) => !v.allowed_paths.includes(p))) return { applied: false, reason: "PATH_NOT_ALLOWED", changedPaths };
  const numstat = git(candidate, "diff", "--numstat");
  const changedLines = numstat.split("\n").filter(Boolean).reduce((s, l) => { const [a, d] = l.split("\t"); return s + Number(a) + Number(d); }, 0);
  if (changedLines === 0) return { applied: false, reason: "EMPTY_DIFF" };
  if (changedLines > v.max_changed_lines) return { applied: false, reason: "PATCH_TOO_LARGE", changedLines };
  return { applied: true, changedLines, diff: git(candidate, "diff"), patchSha256: sha256(git(candidate, "diff")) };
}

function runLevel(cwd, level, timeoutMs, job) {
  return new Promise((resolveLevel) => {
    const started = Date.now();
    // Sandbox: run under Node's permission model with reads confined to the
    // candidate clone (no /proc/<ppid>/environ, no runner files), no writes and
    // no child processes. "node --test X" runs X in-process instead.
    if (level.cmd[0] !== "node") throw new Error("VMODEL_COMMAND_NOT_ALLOWED");
    const rest = level.cmd.slice(1).filter((a) => a !== "--test");
    const argv = ["--permission", "--allow-fs-read=" + cwd, ...rest];
    const child = spawn(process.execPath, argv, { cwd, env: { PATH: process.env.PATH, HOME: cwd, NODE_ENV: "test" }, stdio: ["ignore", "pipe", "pipe"] });
    if (job) job.child = child;
    let out = "";
    let settled = false;
    const finish = (r) => { if (settled) return; settled = true; clearTimeout(timer); if (job && job.child === child) job.child = null; resolveLevel(r); };
    child.on("error", (e) => finish({ level: level.level, verifies: level.verifies, command: "node " + argv.join(" ").replace(cwd, "<candidate>"),
      exit_code: null, signal: null, status: "FAIL", duration_ms: Date.now() - started, output: "spawn error: " + String(e?.message || e) }));
    child.stdout.on("data", (d) => { if (out.length < 20000) out += d; });
    child.stderr.on("data", (d) => { if (out.length < 20000) out += d; });
    const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.on("close", (code, signal) => {
      finish({ level: level.level, verifies: level.verifies, command: "node " + argv.join(" ").replace(cwd, "<candidate>"), exit_code: code,
        signal, status: code === 0 ? "PASS" : "FAIL", duration_ms: Date.now() - started, output: out });
    });
  });
}

/** Start an asynchronous validation job (all V levels, `rounds` times for stability). */
export function startValidation(candidate, v, { rounds = 2, levelTimeoutMs = 20000 } = {}) {
  const job = { id: "val_" + Date.now().toString(36), status: "queued", rounds: [], started_at: new Date().toISOString() };
  job.promise = (async () => {
    job.status = "running";
    for (let r = 0; r < rounds; r++) {
      const results = [];
      for (const level of v.levels) {
        if (job.cancelled) break;
        results.push(await runLevel(candidate, level, levelTimeoutMs, job));
      }
      job.rounds.push(results);
      if (job.cancelled) { job.status = "cancelled"; return; }
    }
    job.status = "done";
    job.finished_at = new Date().toISOString();
  })().catch((e) => { job.status = "error"; job.error = String(e?.message || e); });
  return job;
}

/** Poll a validation job until it reaches a terminal state or the poll budget runs out. */
export async function pollValidation(job, { intervalMs = 250, timeoutMs = 120000 } = {}) {
  const start = Date.now(); let polls = 0;
  while (job.status === "queued" || job.status === "running") {
    if (Date.now() - start > timeoutMs) {
      // Stop the job (and its active child) BEFORE the caller may discard the clone.
      job.cancelled = true;
      try { job.child?.kill("SIGKILL"); } catch {}
      if (job.promise) await job.promise;
      return { terminal: false, polls, status: "POLL_TIMEOUT", verdict: "TIMEOUT", levels: {}, waited_ms: Date.now() - start };
    }
    polls++; await new Promise((r) => setTimeout(r, intervalMs));
  }
  const flat = job.rounds.flat();
  const byLevel = {};
  for (const res of flat) (byLevel[res.level] ||= []).push(res.status);
  const levels = Object.fromEntries(Object.entries(byLevel).map(([k, s]) => [k, s.every((x) => x === "PASS") ? "PASS" : s.some((x) => x === "PASS") ? "FLAKY" : "FAIL"]));
  const verdict = job.status !== "done" ? "ERROR" : Object.values(levels).every((s) => s === "PASS") ? "PASS" : "FAIL";
  return { terminal: true, polls, status: job.status, verdict, levels, waited_ms: Date.now() - start };
}

export function discardCandidate(candidate) {
  rmSync(candidate, { recursive: true, force: true });
  return { discarded: !existsSync(candidate), path_removed: candidate };
}

export function verifyOrigin(origin, sourceSha, v, fileSha256) {
  const head = git(origin, "rev-parse", "HEAD");
  const clean = git(origin, "status", "--porcelain") === "";
  const fileOk = sha256(readFileSync(join(origin, v.file))) === fileSha256;
  return { unchanged: head === sourceSha && clean && fileOk, head, clean, file_sha256_matches: fileOk };
}
