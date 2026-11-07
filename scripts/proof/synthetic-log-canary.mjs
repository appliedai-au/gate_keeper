// One-shot, strictly synthetic log canary for the disposable Gate Keeper
// qualification project only. No provider SDK, paid model credentials, runtime
// API or bucket upload. The fake is injected as a function argument.
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { main } from "./live/run.mjs";
import { fakeTrueForge } from "../../tests/helpers/fake-trueforge.mjs";
import { auditProofPublicLogs } from "./public-log-audit.mjs";

const PROJECT = "a8f4c4a4-0f32-4166-ba92-dad9baf2b652";
const HOLDOUT = [{
  id: "h-secret-01", title: "sensitive canary", filename: "private.py",
  language: "python", context: "SECRET_HOLDOUT_CONTEXT",
  code: ["a=1","b=2","c=3","d=4","e=5","f=6","g=7"],
  expected: [{ line: 7, categories: ["bug"], why: "SECRET_HOLDOUT_WHY", severity: "high" }],
}];

export async function runSyntheticLogCanary({ log = console.log, environment = {} } = {}) {
  // A real CLI MUST run only in the separate, deliberately nonproduction
  // qualification project. Supplying fake flags in production cannot skip it.
  if (environment.RAILWAY_PROJECT_ID !== PROJECT ||
      environment.RAILWAY_ENVIRONMENT_NAME !== "qualification")
    throw new Error("SYNTHETIC_LOG_CANARY_ISOLATION_REQUIRED");
  const events = [];
  const env = {
    GK_PROOF_RUN_ID: "gk-log-synthetic-canary-001",
    TRUEFORGE_BASE_URL: "http://trueforge.railway.internal:8080",
    GK_PROOF_MODE: "compare",
    GK_PROOF_TRIALS: "1",
    GK_PROOF_CAP_USD: "10",
    GK_PROOF_POLL_MS: "1",
    GK_OWNER_APPROVED_AUTONOMY: "1",
    GK_PROOF_ADJUDICATOR_MODEL: "truefoundry/claude-fable-5-1",
    GK_SOURCE_COMMIT: "a".repeat(40),
    GK_PRIVATE_HOLDOUT_B64: gzipSync(Buffer.from(JSON.stringify(HOLDOUT))).toString("base64"),
  };
  const output = await main({
    tf: fakeTrueForge({}),
    selftestFake: true,
    fetchImpl: async () => ({ status: 200 }),
    env, log: (line) => events.push(line),
  });
  if (output?.summary?.result !== "INCONCLUSIVE" ||
      output?.summary?.arms?.baseline?.actual_cost_usd !== null)
    throw new Error("SYNTHETIC_LOG_CANARY_OUTPUT_INVALID");
  const verdict = auditProofPublicLogs(events);
  log("GK_SYNTHETIC_CANARY=SIMULATED_ONLY_NO_LLM_OR_SPEND");
  // Never log raw private data or a failure's untrusted original payload.
  log("GK_LOG_CANARY_VERDICT="+JSON.stringify(verdict));
  if (verdict.status !== "PASS") throw new Error("SYNTHETIC_LOG_CANARY_REDACTION_FAILED");
  // Replay the exact public log events that a real proof runner would emit,
  // after vetting all decoded chunks, into Railway's bounded log stream.
  for (const line of events) log(line);
  log("GK_LOG_CANARY_FINISHED=INCONCLUSIVE_SYNTHETIC_NO_MODEL_CALL");
  return verdict;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await runSyntheticLogCanary({ environment: process.env });
  } catch (error) {
    // Fixed error code only. Never print environment, upstream error payload
    // or raw model/holdout material into shared logs.
    console.error("GK_LOG_CANARY_HELD="+
      (/^SYNTHETIC_LOG_CANARY_/.test(error?.message||"") ? error.message : "CHECK_FAILED"));
    process.exitCode = 3;
  }
}
