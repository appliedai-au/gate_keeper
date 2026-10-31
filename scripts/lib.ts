// Shared helpers for the starter scripts: config, the TrueForge client, git, the agent files and the eval tasks.
// SDK: @truefoundry/trueforge-sdk (https://trueforge.dev/api/quickstart). The TypeScript SDK uses camelCase
// field names (previousTurnId, iterationLimit); the HTTP API and the docs' JSON use snake_case.

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync, lstatSync, realpathSync, chmodSync, openSync, closeSync, fsyncSync, constants } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, relative, parse } from "node:path";
import { fileURLToPath } from "node:url";
import { TrueForge, TrueForgeApi } from "@truefoundry/trueforge-sdk";
import { verifyBudgetLease } from "./learning-trust.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const AGENT_DIR = join(ROOT, "agent");
export const TASKS_DIR = join(ROOT, "evals", "tasks");
// Private records are never authorised to land in a public Git checkout.
const canonicalRoot=realpathSync(ROOT);
export const PRIVATE_ROOT = resolve(process.env.GATE_KEEPER_STATE_DIR || join(homedir(), ".local", "state", "gate-keeper"));
if (PRIVATE_ROOT === ROOT || PRIVATE_ROOT.startsWith(ROOT + "/"))
  throw new Error("PRIVATE_EVIDENCE_REJECTED: state directory inside checkout");
mkdirSync(PRIVATE_ROOT, {recursive:true, mode:0o700});
// Reject every symlinked ancestor; a symlink above the private root could
// otherwise point all the nominally external evidence into the public repo.
function assertRealDirectory(path:string):void {
  const full=resolve(path);
  const anchor=parse(full).root;
  let current=anchor;
  for (const part of full.slice(anchor.length).split("/").filter(Boolean)) {
    current=join(current,part);
    const st=lstatSync(current);
    if(st.isSymbolicLink() || !st.isDirectory()) throw new Error("PRIVATE_EVIDENCE_REJECTED: symlink or non-directory ancestor");
  }
}
assertRealDirectory(PRIVATE_ROOT);
const realPrivate=realpathSync(PRIVATE_ROOT);
if(realPrivate===canonicalRoot || realPrivate.startsWith(canonicalRoot+"/"))
  throw new Error("PRIVATE_EVIDENCE_REJECTED: canonical checkout containment");
const privateStat=lstatSync(PRIVATE_ROOT);
if(process.getuid && privateStat.uid!==process.getuid())
  throw new Error("PRIVATE_EVIDENCE_REJECTED: private directory owner");
if(privateStat.mode & 0o077) chmodSync(PRIVATE_ROOT,0o700);
export const RUNS_DIR=join(PRIVATE_ROOT,"runs");
export const SUMMARY_CSV=join(PRIVATE_ROOT,"summary.csv");

/** Every private output path must resolve inside the private root, without a
 * symlinked path component. The final file is created exclusively (never
 * replaced) so failed or duplicate model runs cannot overwrite evidence.
 */
export function assertPrivatePath(path:string):string {
  const full=resolve(path);
  const rel=relative(PRIVATE_ROOT,full);
  if(!rel || rel===".." || rel.startsWith("../") || rel.startsWith("/") || rel.includes("\\"))
    throw new Error("PRIVATE_EVIDENCE_REJECTED: path escapes private state");
  // Walk each directory from a trusted private root. Never mkdir -p through
  // an unverified symlink: that could create files outside the protected root.
  let current=PRIVATE_ROOT;
  for(const part of relative(PRIVATE_ROOT,dirname(full)).split("/").filter(Boolean)) {
    current=join(current,part);
    let st;
    try {st=lstatSync(current);}
    catch(err) {
      if((err as NodeJS.ErrnoException).code!=="ENOENT") throw err;
      mkdirSync(current,{mode:0o700});
      st=lstatSync(current);
    }
    if(st.isSymbolicLink() || !st.isDirectory() ||
       (process.getuid && st.uid!==process.getuid()))
      throw new Error("PRIVATE_EVIDENCE_REJECTED: directory owner or type");
    if(st.mode & 0o077) chmodSync(current,0o700);
  }
  // existsSync follows dangling symlinks and falsely returns false. lstat
  // detects these even when their target does not exist.
  try {
    const st=lstatSync(full);
    if(st.isSymbolicLink() || !st.isFile() ||
       (process.getuid && st.uid!==process.getuid()))
      throw new Error("PRIVATE_EVIDENCE_REJECTED: unsafe existing file");
  } catch(err) {
    if((err as NodeJS.ErrnoException).code!=="ENOENT") throw err;
  }
  return full;
}

/** Bounded, signed admission for individual TrueForge experiments.
 * The signer and gateway must be independent. Claiming locally prevents
 * same-volume replay, but is NOT a substitute for gateway-side accounting.
 */
export function requireSignedBudgetLease(action:"eval"|"improve",
  source_commit:string,benchmark_sha256:string,model:string,run_id:string) {
  const leasePath=process.env.GK_BUDGET_LEASE_FILE;
  const pubkeyPath=process.env.GK_VERIFIER_PUBKEY_FILE;
  const trustPin=process.env.GK_VERIFIER_SPKI_SHA256;
  const gateway=process.env.GK_APPROVED_GATEWAY_ID;
  if(!leasePath || !pubkeyPath || !trustPin || !gateway || !run_id)
    throw new Error("BUDGET_REJECTED: independent gateway configuration missing");
  const source=JSON.parse(readFileSync(assertPrivatePath(leasePath),"utf8"));
  const key=readFileSync(pubkeyPath,"utf8");
  const permit=verifyBudgetLease({body:source.body,signature:source.signature,
    publicKeyPem:key,pinnedFingerprint:trustPin,
    expected:{action,source_commit,benchmark_sha256,model,
      gateway_id:gateway,run_id,purpose:action==="eval"?"private_eval":"private_improve"}});
  const id=source.body.gateway_lease_id;
  if(!id || typeof id!=="string") throw new Error("BUDGET_REJECTED: lease id missing");
  const ledgerId=createHash("sha256").update(gateway+":"+id).digest("hex");
  // Atomic create-only local replay record; crash leaves a claim, never
  // silently refreshes the spend allowance. Multi-worker uniqueness must be
  // enforced separately by the gateway.
  writeJson(join(PRIVATE_ROOT,"lease-claims",ledgerId+".json"),
    {gateway,lease_id:id,run_id,action,source_commit,benchmark_sha256,
      state:"consumed_pending_gateway_settlement"});
  return permit;
}

// ---------- config ----------

if (existsSync(join(ROOT, ".env"))) process.loadEnvFile(join(ROOT, ".env"));

export const env = {
  baseUrl: process.env.TRUEFORGE_BASE_URL ?? "http://localhost:8790",
  token: process.env.TRUEFORGE_TOKEN || undefined,
  /** Public HTTPS URL of this repo; only needed for skill_mode "git". */
  repoUrl: process.env.SKILL_REPO_URL || undefined,
};

export function client(): TrueForge {
  return new TrueForge({
    baseUrl: env.baseUrl,
    token: env.token, // only when the server has OIDC login on; local npx needs none
    timeoutInSeconds: 600, // turns stream over SSE and can take minutes
  });
}

export function die(msg: string): never {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

export function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

export function option(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

// ---------- git ----------

export function git(...args: string[]): string {
  return execFileSync("git", args, { cwd: ROOT, encoding: "utf8" }).trim();
}

export function headSha(): string {
  return git("rev-parse", "HEAD");
}

/** True when these paths have no uncommitted changes (staged, unstaged or untracked). */
export function isClean(...paths: string[]): boolean {
  return git("status", "--porcelain", "--", ...paths) === "";
}

// ---------- the agent's files ----------

export interface AgentFile {
  name: string;
  description: string;
  model: { name: string; params?: Record<string, unknown> };
  /** "inline": skills are pasted into the instructions (no sandbox). "git": real TrueForge skills (needs a sandbox and a public repo). */
  skill_mode?: "inline" | "git";
}

export interface SkillFile {
  name: string;
  description: string;
  body: string;
  /** Path inside the repo, e.g. agent/skills/review-checklist */
  path: string;
}

export function readAgent(): { agent: AgentFile; instructions: string; skills: SkillFile[] } {
  const agent = JSON.parse(readFileSync(join(AGENT_DIR, "agent.json"), "utf8")) as AgentFile;
  if (process.env.TF_AGENT_NAME) agent.name = process.env.TF_AGENT_NAME;
  if (process.env.TF_MODEL) agent.model = { ...agent.model, name: process.env.TF_MODEL };
  const instructions = readFileSync(join(AGENT_DIR, "instructions.md"), "utf8");
  const skillsDir = join(AGENT_DIR, "skills");
  const skills: SkillFile[] = [];
  if (existsSync(skillsDir)) {
    for (const dir of readdirSync(skillsDir).sort()) {
      const file = join(skillsDir, dir, "SKILL.md");
      if (!existsSync(file)) continue;
      const { meta, body } = parseFrontmatter(readFileSync(file, "utf8"));
      skills.push({
        name: meta.name ?? dir,
        description: meta.description ?? "",
        body,
        path: `agent/skills/${dir}`,
      });
    }
  }
  return { agent, instructions, skills };
}

function parseFrontmatter(text: string): { meta: Record<string, string>; body: string } {
  const m = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^(\w+):\s*(.*)$/);
    if (kv) meta[kv[1]] = kv[2].trim();
  }
  return { meta, body: m[2] };
}

/** The TrueForge agent spec built from agent/. */
export function buildManifest(gitRef?: string): TrueForgeApi.AgentSpec {
  const { agent, instructions, skills } = readAgent();
  const mode = agent.skill_mode ?? "inline";
  const config: TrueForgeApi.RuntimeConfig = {
    askUserQuestions: { enabled: false }, // evals run unattended: never pause for a question
    generativeUi: { enabled: false }, // we want plain text + JSON back
  };
  if (mode === "inline") {
    // Simplest path, no sandbox: the playbook lives in the instructions, and the agent rewrites it.
    const inlined = skills
      .map((s) => `\n\n---\n\n# Skill: ${s.name}\n\n_${s.description}_\n\n${s.body.trim()}`)
      .join("");
    return { model: agent.model, instructions: instructions.trim() + inlined, config };
  }
  // "git" mode: real TrueForge skills, cloned from this repo at the commit that runs (needs a sandbox).
  if (!gitRef) die("skill_mode git needs a git ref");
  return {
    model: agent.model,
    instructions: instructions.trim(),
    skills: skills.map((s) => ({ name: s.name })),
    config: { ...config, sandbox: { enabled: true } }, // skills require the sandbox
  };
}

/**
 * Create or update the TrueForge agent so it matches agent/ at `gitRef`.
 * agents.create / agents.update / agents.list: https://trueforge.dev/create-agent/overview#create-an-agent-via-the-api
 */
export async function syncAgent(tf: TrueForge, gitRef: string): Promise<TrueForgeApi.Agent> {
  const { agent, skills } = readAgent();
  if ((agent.skill_mode ?? "inline") === "git") {
    if (!env.repoUrl) die("skill_mode is \"git\": set SKILL_REPO_URL in .env to your public GitHub repo URL.");
    const { data: caps } = await tf.server.getCapabilities();
    if (!caps.skill.enabled) {
      die(
        `skill_mode is "git" but this TrueForge server can't run skills: ${caps.skill.reason ?? "no sandbox"}\n` +
          `  Local npx: on Linux install bubblewrap, socat and ripgrep, then restart TrueForge (macOS needs no extra packages).\n` +
          `  Or configure Daytona in Settings → Sandbox providers. Or go back to "skill_mode": "inline" (no sandbox needed).`,
      );
    }
    // Register each skill from this repo, pinned to the commit that runs.
    // settings.skills.createOrUpdate: https://trueforge.dev/api-reference/skills/create-or-replace-a-skill
    // TODO(verify): end to end with a pushed public repo; the commit must be pushed before the run.
    for (const s of skills) {
      await tf.settings.skills.createOrUpdate({
        manifest: { type: "git", name: s.name, description: s.description, url: env.repoUrl, path: s.path, ref: gitRef },
      });
    }
  }
  const manifest = buildManifest(gitRef);
  const existing = await findAgent(tf, agent.name);
  if (existing) {
    const { data } = await tf.agents.update(existing.id, { description: agent.description, manifest });
    return data;
  }
  const { data } = await tf.agents.create({ name: agent.name, description: agent.description, manifest });
  return data;
}

export async function findAgent(tf: TrueForge, name: string): Promise<TrueForgeApi.Agent | undefined> {
  const page = await tf.agents.list({ agentName: name }); // substring match, so check the exact name
  for await (const a of page) if (a.name === name) return a;
  return undefined;
}

// ---------- tasks ----------

export interface Task {
  id: string;
  title: string;
  /** Holdout tasks are run and scored, but improve never shows them to the agent. */
  holdout?: boolean;
  language: string;
  filename: string;
  context: string;
  code: string[];
  expected: { line: number; categories: string[]; why: string }[];
}

export function loadTasks(): Task[] {
  return readdirSync(TASKS_DIR)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(TASKS_DIR, f), "utf8")) as Task);
}

export function numbered(code: string[]): string {
  const w = String(code.length).length;
  return code.map((l, i) => `${String(i + 1).padStart(w)} | ${l}`).join("\n");
}

/** The message the agent gets for one task. Same text every run. */
export function taskPrompt(t: Task): string {
  return [
    `Review this change. File: \`${t.filename}\`. What the change does: ${t.context}`,
    "",
    "Line numbers are on the left of the `|`.",
    "",
    "```" + t.language,
    numbered(t.code),
    "```",
  ].join("\n");
}

// ---------- turns and sessions ----------

/** Text of a final model message (string or content parts). */
export function messageText(msg: TrueForgeApi.ModelMessageEvent | null | undefined): string {
  const c = msg?.content;
  if (!c) return "";
  if (typeof c === "string") return c;
  return c.map((p) => ("text" in p ? p.text : "")).join("");
}

export interface TurnResult {
  turnId: string;
  status: string;
  text: string;
  error?: string;
}

/**
 * Run one turn and wait for turn.done. `previousTurnId: "none"` makes it a new root turn,
 * so tasks in the same session don't see each other.
 * createTurnStream: https://trueforge.dev/api/use-agent#create-and-stream-a-turn
 */
export async function runTurn(tf: TrueForge, sessionId: string, content: string, root = true): Promise<TurnResult> {
  const stream = await tf.sessions.createTurnStream(
    sessionId,
    { input: [{ type: "user.message", content }], ...(root ? { previousTurnId: "none" } : {}) },
    { maxRetries: 0 }, // a retried POST would start a second turn
  );
  let turnId = "";
  for await (const { data: event } of stream.withMetadata()) {
    if (event.type === "turn.created") turnId = event.turnId;
    if (event.type === "turn.done") {
      const s = event.state;
      if (s.status === "done") return { turnId, status: s.status, text: messageText(s.output) };
      if (s.status === "error") return { turnId, status: s.status, text: "", error: s.message };
      return { turnId, status: s.status, text: "" };
    }
  }
  return { turnId, status: "no-turn-done", text: "" };
}

/**
 * Everything TrueForge keeps about a session: the session, every turn, and every turn's events.
 * There is no export endpoint, so we page through sessions.get / listTurns / listTurnEvents.
 * https://trueforge.dev/sessions and https://trueforge.dev/api-reference/agent-sessions/list-turn-events
 */
export async function exportSession(tf: TrueForge, sessionId: string) {
  const { data: session } = await tf.sessions.get(sessionId);
  const turns: (TrueForgeApi.Turn & { events: TrueForgeApi.SessionEvent[] })[] = [];
  for await (const turn of await tf.sessions.listTurns(sessionId)) {
    const events: TrueForgeApi.SessionEvent[] = [];
    for await (const e of await tf.sessions.listTurnEvents(sessionId, turn.id, { order: "asc" })) events.push(e);
    turns.push({ ...turn, events });
  }
  turns.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return { exported_at: new Date().toISOString(), base_url: env.baseUrl, session, turns };
}

export type SessionExport = Awaited<ReturnType<typeof exportSession>>;

/** Tokens and tool calls for a whole session, from its export. */
export function sessionStats(exp: SessionExport): { tokens: number | null; toolCalls: number } {
  let tokens: number | null = 0;
  let toolCalls = 0;
  for (const t of exp.turns) {
    const metrics = "metrics" in t.state ? t.state.metrics : undefined;
    if(metrics?.totalTokens === undefined || metrics?.totalTokens === null) tokens=null;
    else if(tokens !== null) tokens+=metrics.totalTokens;
    for(const e of t.events) if(e.type==="model.message") toolCalls+=e.toolCalls?.length ?? 0;
  }
  return {tokens,toolCalls};
}

export function writeJson(path: string, value: unknown): void {
  const safe=assertPrivatePath(path);
  // Exclusive create and NOFOLLOW reject pre-existing files or final symlinks
  // even if the final component changed after the lstat preflight.
  const fd=openSync(safe,constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,0o600);
  try {
    writeFileSync(fd,JSON.stringify(value,null,2)+"\n");
    fsyncSync(fd);
  } finally {closeSync(fd);}
}

export function runDir(n: number): string {
  return join(RUNS_DIR, `run-${String(n).padStart(2, "0")}`);
}
