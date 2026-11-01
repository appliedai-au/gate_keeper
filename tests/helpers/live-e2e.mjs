// Offline end-to-end run of the live orchestrator against the SYNTHETIC fake.
import { gzipSync } from "node:zlib";
import { main } from "../../scripts/proof/live/run.mjs";
import { fakeTrueForge } from "./fake-trueforge.mjs";
const cfg = JSON.parse(process.argv[2] || "{}");
const holdout = [{ id: "h-secret-01", title: "t", filename: "x.py", language: "python", context: "SECRET_HOLDOUT_CONTEXT", code: ["a=1", "b=2", "c=3", "d=4", "e=5", "f=6", "g=7"], expected: [{ line: 7, categories: ["bug"], why: "SECRET_HOLDOUT_WHY", severity: "high" }] }];
const unseen = [{ id: "u-secret-01", title: "u", filename: "y.js", language: "javascript", context: "SECRET_UNSEEN_CONTEXT", code: ["a", "b", "c", "d", "e", "f", "g"], expected: [{ line: 7, categories: ["bug"], why: "SECRET_UNSEEN_WHY", severity: "high" }] },
  { id: "u-secret-02", title: "u", filename: "z.js", language: "javascript", context: "clean", code: ["const x = 1;"], expected: [] }];
const learn = cfg.env?.GK_PROOF_MODE === "learn";
const tf = fakeTrueForge(cfg.fake || {});
const lines = [];
// The fake-harness trust marker is injected by the test caller, NEVER taken from env.
const out = await main({ tf, selftestFake: cfg.offlineFake !== false, log: (l) => lines.push(l), fetchImpl: async () => ({ status: 200 }), env: {
  GK_PROOF_RUN_ID: "selftest-run-001", TRUEFORGE_BASE_URL: "http://trueforge.railway.internal:8080", GK_PROOF_TRIALS: String(cfg.trials || 2),
  GK_PROOF_CAP_USD: String(cfg.cap || 10), GK_PROOF_POLL_MS: "1", GK_OWNER_APPROVED_AUTONOMY: cfg.autonomy === false ? "0" : "1",
  // Offline runs grade with a registered, already-calibrated stand-in; the owner-chosen grader is held until calibrated.
  GK_PROOF_ADJUDICATOR_MODEL: "truefoundry/claude-fable-5-1", GK_SOURCE_COMMIT: "a".repeat(40), GK_PRIVATE_HOLDOUT_B64: gzipSync(Buffer.from(JSON.stringify(learn ? unseen : holdout))).toString("base64"),
  ...(learn ? { GK_DEV_HOLDOUT_B64: gzipSync(Buffer.from(JSON.stringify(holdout))).toString("base64") } : {}), ...(cfg.env || {}) } });
console.log(JSON.stringify({ out, lines, calls: tf.calls() }));
