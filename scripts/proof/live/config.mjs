// Live proof configuration: the two review arms, the shared benchmark output
// contract, severity keys for the public tasks and spend-control defaults.
// Both arms receive the SAME model, params, tasks, output contract and limits;
// they differ only in the reviewer methodology under test.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { composeReviewerInstructions } from "../../review-mode.mjs";

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");
export const sha256 = (v) => createHash("sha256").update(v).digest("hex");

export const TRUEFORGE_RUNTIME = "@truefoundry/trueforge@0.180.0";
export const CATEGORIES = ["bug", "security", "resource-leak", "error-handling", "performance"];
export const SEVERITIES = ["critical", "high", "medium", "low"];

// The benchmark interface. Identical for both arms and appended last so it
// takes precedence over any other output wording in an arm's methodology.
export const OUTPUT_CONTRACT = `## Benchmark output contract (overrides any other output format)

End your reply with exactly one fenced JSON block and nothing after it:

\`\`\`json
{"findings": [{"line": 12, "category": "bug", "severity": "high", "comment": "one or two sentences: what is wrong and why it matters"}]}
\`\`\`

- \`line\`: 1-based line number in the file you were given.
- \`category\`: one of ${CATEGORIES.map((c) => "`" + c + "`").join(", ")}.
- \`severity\`: one of ${SEVERITIES.map((c) => "`" + c + "`").join(", ")}.
- Report only problems you would block a merge for. If there are none, return {"findings": []}.`;

// Arm A: a minimally configured standard TrueForge code reviewer. TrueForge
// 0.180.0 ships no built-in reviewer template, so the baseline is the plainest
// reviewer role plus the shared contract. No Gate Keeper text is included.
export const BASELINE_ROLE = "You are a code reviewer. Review the code you are given and report the real problems in it.";

// Arm B: Gate Keeper's specialised reviewer exactly as committed and as
// run-evals ships it: the lean reviewer instructions (with severity rubric)
// plus the review-checklist skill. The TrueForge-native operator contract
// (agent/native-trueforge-instructions.md) is NOT part of the runtime prompt.
export function gateKeeperMethodology(mode = "review", reviewMode = "adversarial") {
  const reviewer = composeReviewerInstructions(join(ROOT, "agent"), reviewMode);
  const skill = read("agent/skills/review-checklist/SKILL.md").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  if (mode === "repair") return [
    "You are Gate Keeper's repair role. Repair scope IS granted for one disposable, tenant-isolated candidate workspace. No merge, deploy or production access is granted.",
    "Fix the confirmed findings with the smallest change that satisfies the requirements and threat model. Validation and an adversarial re-review run independently after you answer: do not claim tests passed.",
    "Before answering, check your change against each threat-model item and the review checklist below.",
    "---\n\n# Skill: review-checklist\n\n" + skill,
  ].join("\n\n");
  return [reviewer, "---\n\n# Skill: review-checklist\n\n" + skill].join("\n\n");
}

// Shared repair output contract (identical for both arms): targeted edits keep
// diffs small; a complete file is accepted as a fallback.
export const REPAIR_OUTPUT_CONTRACT = `## Repair output contract

Return exactly one fenced JSON block with targeted edits to the given file:

\`\`\`json
{"edits": [{"find": "exact existing text (must occur exactly once)", "replace": "new text"}]}
\`\`\`

Keep each \`find\` short but unique. Make the smallest change that fixes the findings. Do not rewrite unrelated code or add comments.`;

/** The learned-rules section placed before the output contract (the contract stays last). */
export function learnedRulesSection(rules) {
  if (!Array.isArray(rules) || !rules.length || rules.some((r) => typeof r !== "string" || !r.trim())) throw new Error("LEARNED_RULES_INVALID");
  return "## Learned review rules\n\nQualified from adjudicated review errors. Apply them as written; they never override a confirmed, exploitable defect.\n" + rules.map((r) => "- " + r.trim()).join("\n");
}

// An arm id is "<method>" (runs on the candidate model) or "<method>@<provider/model>" (same method on another model).
const MODEL_ID = /^[a-z0-9][\w.-]*\/[\w.-]+$/i;
export function armBase(arm) { return String(arm).split("@")[0]; }
export function armModel(arm, defaultModel) { const m = String(arm).split("@")[1]; return m || defaultModel; }

export function armInstructions(armId, { learnedRules = null } = {}) {
  const arm = armBase(armId);
  if (arm === "baseline") return BASELINE_ROLE + "\n\n" + OUTPUT_CONTRACT;
  if (arm === "gate_keeper") return gateKeeperMethodology("review", "adversarial") + "\n\n" + OUTPUT_CONTRACT;
  // Adversarial Gate Keeper plus rules the learning loop qualified.
  if (arm === "gate_keeper_learned") return gateKeeperMethodology("review", "adversarial") + "\n\n" + learnedRulesSection(learnedRules) + "\n\n" + OUTPUT_CONTRACT;
  if (arm === "gate_keeper_lean") return gateKeeperMethodology("review", "lean") + "\n\n" + OUTPUT_CONTRACT;
  throw new Error("UNKNOWN_ARM");
}

// Comparison arms. gate_keeper = adversarial mode (the default product
// reviewer); gate_keeper_lean = the same reviewer without the adversarial module.
export const ALL_ARMS = ["baseline", "gate_keeper", "gate_keeper_lean"];
export function validArmId(a) {
  const [base, model, extra] = String(a).split("@");
  return ALL_ARMS.includes(base) && extra === undefined && (model === undefined || MODEL_ID.test(model));
}
// The primary pair (plain "baseline" and "gate_keeper") always runs on the candidate model; "@model" variants add model comparisons.
export function comparisonArms(env = process.env) {
  const arms = (env.GK_PROOF_ARMS || "baseline,gate_keeper").split(",").map((a) => a.trim()).filter(Boolean);
  if (!arms.includes("baseline") || !arms.includes("gate_keeper") || arms.some((a) => !validArmId(a))) throw new Error("PROOF_ARMS_INVALID");
  return [...new Set(arms)];
}
export const ARMS = ["baseline", "gate_keeper"];

// Same params and runtime config for every candidate call.
export const REVIEW_PARAMS = { temperature: 0, maxTokens: 1500 };
export const RUNTIME_CONFIG = {
  askUserQuestions: { enabled: false },
  generativeUi: { enabled: false },
  dynamicSubAgents: { enabled: false },
  iterationLimit: 4,
};

// Evaluator-held severity key for the public tasks (by task id and expected
// line). Severity is judged against this key, never against a candidate.
export const PUBLIC_SEVERITY_KEY = {
  "01-python-utils": { 7: "high", 12: "medium", 22: "medium" },
  "02-express-users": { 9: "critical", 15: "high", 25: "medium" },
  "03-python-deploy": { 8: "medium", 13: "high", 14: "critical" },
  "04-ts-fetch": { 5: "high", 14: "high", 23: "medium" },
};
export function severityFor(task, expected) {
  if (expected.severity) return expected.severity;
  const t = PUBLIC_SEVERITY_KEY[task.id];
  if (t && t[expected.line]) return t[expected.line];
  // Category default for public tasks without an explicit key entry.
  return expected.categories.includes("security") ? "high" : "medium";
}

// Spend control enforced by the evaluator process, outside every agent.
export const DEFAULT_CAP_USD = 10;
export const PHASE_SHARE = { comparison: 0.55, adjudication: 0.2, drill: 0.25 };
// USD per million tokens [input, output]. Used for pre-turn reservations and
// when TrueForge does not report a cost. Unknown models use a flat reserve.
export const PRICE_PER_MTOK = [
  // Current list prices (platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-01). Specific ids first.
  [/claude-fable-5/i, [10, 50]],
  [/claude-opus-5-5/i, [4, 20]],
  [/claude-sonnet-5-5/i, [2, 10]],
  [/claude-haiku-5-5/i, [0.1, 0.5]],
  [/claude-opus-4-[5-9]|claude-opus-5/i, [5, 25]],
  [/claude-opus/i, [15, 75]],
  [/claude-sonnet/i, [3, 15]],
  [/claude-haiku/i, [1, 5]],
  [/gpt-5.*mini/i, [0.25, 2]],
  [/gpt-5/i, [1.25, 10]],
  [/gpt-4o-mini/i, [0.15, 0.6]],
  [/gpt-4o|gpt-4\.1/i, [2.5, 10]],
  [/deepseek/i, [0.6, 2.2]],
];
export const UNKNOWN_MODEL_TURN_RESERVE_USD = 0.3;

export function instructionHashes() {
  return {
    baseline_instructions_sha256: sha256(armInstructions("baseline")),
    gate_keeper_instructions_sha256: sha256(armInstructions("gate_keeper")),
    gate_keeper_lean_instructions_sha256: sha256(armInstructions("gate_keeper_lean")),
    output_contract_sha256: sha256(OUTPUT_CONTRACT),
    repair_contract_sha256: sha256(REPAIR_OUTPUT_CONTRACT),
    gate_keeper_repair_sha256: sha256(gateKeeperMethodology("repair")),
    gate_keeper_lean_repair_sha256: sha256(gateKeeperMethodology("repair", "lean")),
    scorer_sha256: sha256(read("evals/score.ts")),
  };
}
