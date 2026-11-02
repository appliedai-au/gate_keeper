import test from "node:test";
import assert from "node:assert/strict";
import { auditProofPublicLogs } from "../scripts/proof/public-log-audit.mjs";
import { emitChunked } from "../scripts/proof/live/run.mjs";
import { runSyntheticLogCanary } from "../scripts/proof/synthetic-log-canary.mjs";

const publicSummary = () => ({
  result: "INCONCLUSIVE", environment: { adjudicator_calibration: "pending" },
  arms: { baseline: { actual_cost_usd: null }, gate_keeper: { actual_cost_usd: null } },
});
const publicData = () => ({
  sessions: [{ phase: "comparison", arm: "baseline", trial: 1 }],
  private_evidence_item_count: 2,
  arms: { baseline: { public: { trials: 1 } }, gate_keeper: { public: { trials: 1 } } },
});
function logs(summary = publicSummary(), data = publicData()) {
  const lines = [];
  emitChunked((x) => lines.push(x), "GK_PROOF_PUBLIC_SUMMARY", summary);
  emitChunked((x) => lines.push(x), "GK_PROOF_PUBLIC_DATA", data);
  return lines;
}
const failsWith = (lineSet, code) => {
  const verdict = auditProofPublicLogs(lineSet);
  assert.equal(verdict.status, "FAIL");
  assert.ok(verdict.codes.includes(code), JSON.stringify(verdict.codes));
  assert.equal(Object.prototype.hasOwnProperty.call(verdict, "payloads"), false);
};

test("decoded public-log audit accepts only redacted summary/metadata and never returns raw content", () => {
  const v = auditProofPublicLogs(logs());
  assert.deepEqual(v, {
    status: "PASS", codes: [], decodedPublicRecords: 2,
    summaryPresent: true, publicDataPresent: true,
  });
});

test("Base64-encoded private session, turn and holdout IDs are caught after decoding", () => {
  for (const forbidden of [
    { sessions: [{ phase: "comparison", arm: "baseline", trial: 1, id: "session-real-01" }] },
    { sessions: [{ phase: "comparison", arm: "baseline", trial: 1, task_id: "private-fixture" }] },
    { sessionId: "private-session" },
    { turnId: "private-turn" },
    { evidence_items: [{ path: "private/trace.json" }] },
  ]) {
    const data = { ...publicData(), ...forbidden };
    const v = auditProofPublicLogs(logs(publicSummary(), data));
    assert.equal(v.status, "FAIL");
    assert.ok(v.codes.some(x => x === "PRIVATE_SESSION_METADATA" ||
      x === "PRIVATE_METADATA_FIELD" || x === "PRIVATE_EVIDENCE_INVENTORY"));
  }
  failsWith(logs(publicSummary(), { ...publicData(),
    privateReference: "SECRET_HOLDOUT_WHY" }), "PRIVATE_CANARY_SENTINEL");
  failsWith(logs(publicSummary(), { ...publicData(),
    arbitrary: "h-secret-01" }), "PRIVATE_CANARY_SENTINEL");
});

test("both explicit holdout aggregates and all-minus-public differentials are blocked", () => {
  failsWith(logs(publicSummary(), {
    ...publicData(), arms: { baseline: { public: {}, all: {} } },
  }), "HOLDOUT_COMPOSITION_LEAK");
  failsWith(logs(publicSummary(), {
    ...publicData(), arms: { baseline: { public: {}, holdout: {} } },
  }), "HOLDOUT_COMPOSITION_LEAK");
  failsWith([...logs(), 'GK_PROOF_COMPARISON={"arms":{"gate_keeper":{"public":{},"all":{}}}}'],
    "HOLDOUT_COMPOSITION_LEAK");
});

test("every proof event is audited, including future event names and private storage URIs", () => {
  failsWith([...logs(),
    'GK_PROOF_AGENTS_EXPORTED={"agents":[],"evidence":{"reference":"railway-bucket://bucket/private/data.json"}}'],
    "PRIVATE_EVIDENCE_PATH");
  failsWith([...logs(),
    'GK_PROOF_PROVIDER_REMOVED={"model":"m","sessionId":"synthetic-sensitive-session"}'],
    "PRIVATE_METADATA_FIELD");
  failsWith([...logs(),
    'GK_PROOF_NEW_EVENT={"arms":{"gate_keeper":{"all":{},"public":{}}}}'],
    "HOLDOUT_COMPOSITION_LEAK");
  failsWith([...logs(), 'GK_PROOF_UNKNOWN=[1,2]'],
    "PUBLIC_EVENT_UNPARSEABLE");
  failsWith([...logs(), 'GK_PROOF_NEW_EVENT={not-valid-json}'],
    "PUBLIC_JSON_UNPARSABLE");
});

test("missing, duplicate, inconsistent and oversized log chunks are held", () => {
  const good = logs();
  failsWith(good.slice(1), "PUBLIC_PROOF_RECORDS_MISSING");
  const duplicate = [good[0], good[0], ...good.slice(1)];
  failsWith(duplicate, "PUBLIC_CHUNK_INCONSISTENT");
  failsWith(["GK_PROOF_PUBLIC_DATA_B64[1/2]=e30=", ...logs(publicSummary(), publicData())
    .filter(x => x.startsWith("GK_PROOF_PUBLIC_SUMMARY"))], "PUBLIC_CHUNK_INCOMPLETE");
  failsWith(["GK_PROOF_PUBLIC_DATA_B64[1/1]=NOTBASE64!", ...logs().filter(x => x.startsWith("GK_PROOF_PUBLIC_SUMMARY"))],
    "PUBLIC_CHUNK_INVALID");
  failsWith(Array(1501).fill("GK_PROOF_DONE={}"), "LOG_INPUT_OUT_OF_BOUNDS");
  failsWith(["GK_PROOF_DRILL=" + "x".repeat(131073), ...logs()],
    "LOG_INPUT_OUT_OF_BOUNDS");
  failsWith(Array(25).fill("GK_PROOF_DRILL=" + "x".repeat(90000)).concat(logs()),
    "LOG_INPUT_OUT_OF_BOUNDS");
});

test("synthetic public proofs may not claim verified model cost or premature PASS", () => {
  failsWith(logs({ ...publicSummary(), arms: {
    baseline: { actual_cost_usd: 0.001 }, gate_keeper: { actual_cost_usd: null },
  } }), "UNVERIFIED_ACTUAL_COST");
  failsWith(logs({ ...publicSummary(), result: "PASS" }), "UNVERIFIED_PASS");
});

test("canary refuses production or unverified Railway environment before any work", async () => {
  const outputs = [];
  await assert.rejects(() => runSyntheticLogCanary({ log: x => outputs.push(x),
    environment: { RAILWAY_PROJECT_ID: "507ae09d-7dbb-444a-bd62-a5a16405c874",
      RAILWAY_ENVIRONMENT_NAME: "production" } }), /SYNTHETIC_LOG_CANARY_ISOLATION_REQUIRED/);
  assert.deepEqual(outputs, []);
});

test("full offline proof canary decodes and audits its logs before publishing them", async () => {
  const records = [];
  let result;
  try {
    result = await runSyntheticLogCanary({
      environment: { RAILWAY_PROJECT_ID: "a8f4c4a4-0f32-4166-ba92-dad9baf2b652",
        RAILWAY_ENVIRONMENT_NAME: "qualification" },
      log: x => records.push(x),
    });
  } catch (error) {
    // Print only the canary's fixed diagnostic codes; never reproduce a
    // decoded public record, model text, session ID, object path or source.
    const record = records.find(x => x.startsWith("GK_LOG_CANARY_VERDICT="));
    const verdict = record ? JSON.parse(record.slice("GK_LOG_CANARY_VERDICT=".length)) : null;
    assert.fail("SYNTHETIC_CANARY_FAILED: " + (verdict?.codes || ["NO_VERDICT"]).join(","));
  }
  assert.equal(result.status, "PASS");
  assert.ok(records.some(x => x.startsWith("GK_LOG_CANARY_VERDICT=")));
  assert.ok(records.some(x => x === "GK_LOG_CANARY_FINISHED=INCONCLUSIVE_SYNTHETIC_NO_MODEL_CALL"));
  assert.ok(records.some(x => x.startsWith("GK_PROOF_PUBLIC_DATA_B64")));
  assert.ok(records.some(x => x.startsWith("GK_PROOF_PUBLIC_SUMMARY_B64")));
  const recheck = auditProofPublicLogs(records);
  assert.equal(recheck.status, "PASS", JSON.stringify(recheck.codes));
  assert.ok(!records.join("\n").includes("SECRET_HOLDOUT"));
});
