// Selectable Gate Keeper review method. "adversarial" appends the adversarial
// method module to the core reviewer instructions; "lean" uses the core alone.
// Selected with GK_REVIEW_MODE; unknown values fail closed.
import { readFileSync } from "node:fs";
import { join } from "node:path";

export const REVIEW_MODES = Object.freeze(["adversarial", "lean"]);
export const DEFAULT_REVIEW_MODE = "adversarial";

export function resolveReviewMode(env = process.env) {
  const mode = env.GK_REVIEW_MODE || DEFAULT_REVIEW_MODE;
  if (!REVIEW_MODES.includes(mode)) throw new Error("REVIEW_MODE_REJECTED: GK_REVIEW_MODE must be one of " + REVIEW_MODES.join(", "));
  return mode;
}

/** Core reviewer instructions plus the selected method module(s). */
export function composeReviewerInstructions(agentDir, mode) {
  const core = readFileSync(join(agentDir, "instructions.md"), "utf8").trim();
  if (mode === "lean") return core;
  const method = readFileSync(join(agentDir, "methods", "adversarial.md"), "utf8").trim();
  // The method goes before Severity so the output contract stays last.
  const at = core.indexOf("## Severity");
  return at >= 0 ? core.slice(0, at) + method + "\n\n" + core.slice(at) : core + "\n\n" + method;
}
