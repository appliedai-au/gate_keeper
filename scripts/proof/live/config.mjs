// Live proof configuration: the two review arms, the shared benchmark output
// contract, severity keys for the public tasks and spend-control defaults.
// Both arms receive the SAME model, params, tasks, output contract and limits;
// they differ only in the reviewer methodology under test.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

// Arm B: Gate Keeper's specialised adversarial methodology exactly as committed:
// the TrueForge-native profile (review-only loop), the reviewer instructions and
// the review-checklist skill inlined as run-evals does.
export function gateKeeperMethodology(mode = "review") {
  const native = read("agent/native-trueforge-instructions.md").trim();
  const reviewer = read("agent/instructions.md").trim();
  const skill = read("agent/skills/review-checklist/SKILL.md").replace(/^---\n[\s\S]*?\n---\n?/, "").trim();
  const scope = mode === "repair"
    ? "Repair scope IS granted for one disposable, tenant-isolated candidate workspace. No merge, deploy or production access is granted."
    : "This is a review-only run: no repair scope is granted. Complete the review step and report findings.";
  return [
    native,
    scope,
    reviewer,
    "---\n\n# Skill: review-checklist\n\n" + skill,
  ].join("\n\n");
}

export function armInstructions(arm) {
  if (arm === "baseline") return BASELINE_ROLE + "\n\n" + OUTPUT_CONTRACT;
  if (arm === "gate_keeper") return gateKeeperMethodology() + "\n\n" + OUTPUT_CONTRACT;
  throw new Error("UNKNOWN_ARM");
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
    output_contract_sha256: sha256(OUTPUT_CONTRACT),
    scorer_sha256: sha256(read("evals/score.ts")),
  };
}
