// Execute only on the Spekky-managed remote runner. No model or network calls.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
import { createHash } from "node:crypto";

const runner = new URL("../proof/three-agent/run.mjs", import.meta.url).href;
const arms = ["codex", "qodo", "gate_keeper"];
// Unsorted, duplicate and adjacent findings distinguish the existing non-chain
// merge from both no merge and a transitive collapse of 10/11/12 into one item.
const findings = [12, 10, 11, 10, 30];
const outputs = {
  codex: JSON.stringify({ findings: findings.map((n) => ({ code_location: { line_range: { start: n, end: n } } })) }),
  qodo: "key_issues_to_review:\n" + findings.map((n) => `  - start_line: ${n}\n    end_line: ${n}`).join("\n"),
  gate_keeper: JSON.stringify({ findings: findings.map((line) => ({ line, quote: "synthetic" })) }),
};
const payload = {
  set: "synthetic-comparison", params: { temperature: 0.2, maxTokens: 8000 },
  agents: Object.fromEntries(arms.map((a) => [a, { system: a }])),
  tasks: [{ id: "synthetic", expected: [10, 12, 30], benign: [], prompts: Object.fromEntries(arms.map((a) => [a, "synthetic"])) }],
};
function run(env = {}, responses = outputs) {
  const source = `
    const outputs = ${JSON.stringify(responses)};
    globalThis.fetch = () => { throw new Error("network forbidden in regression test"); };
    globalThis.GK3_SDK = { TrueForge: class {
      sessions = {
        create: async ({ agent }) => {
          if (agent.spec.model.name !== "tfy-direct/glm-5-3-flash") throw new Error("wrong model");
          return { data: { id: agent.spec.instructions } };
        },
        createTurn: async (id) => ({ data: { id: "turn", state: {
          status: "done", output: { content: outputs[id] },
          metrics: { totalCostInUsd: 0, totalInputTokens: 1, totalOutputTokens: 1 }
        } } }),
      };
    } };
    await import(${JSON.stringify(runner)});
  `;
  return spawnSync(process.execPath, ["--input-type=module", "-e", source], {
    encoding: "utf8", timeout: 10000,
    // No inherited credentials, model settings or experimental mode variables.
    env: {
      GK3_PAYLOAD_B64: gzipSync(Buffer.from(JSON.stringify(payload))).toString("base64"),
      GK3_MODEL: "tfy-direct/glm-5-3-flash", GK3_CAP_USD: "0.1",
      GK3_TRIALS: "1", GK3_CONCURRENCY: "1", GK3_ARMS: arms.join(","), ...env,
    },
  });
}
function summary(result) {
  assert.equal(result.status, 0, result.stderr);
  const line = result.stdout.split("\n").find((s) => s.startsWith("GK3_SUMMARY "));
  return JSON.parse(line.slice("GK3_SUMMARY ".length)).summary;
}

test("plain comparison applies v12 merge only to Gate Keeper, preserving other scores", () => {
  const result = run({ GK3_GK_MERGE: "1" });
  const s = summary(result);
  assert.equal(s.gate_keeper.caught, 3);
  assert.equal(s.gate_keeper.falseAlarms, 0);
  for (const a of ["codex", "qodo"]) {
    assert.equal(s[a].caught, 3);
    assert.equal(s[a].falseAlarms, 2);
  }
  const start = JSON.parse(result.stdout.split("\n").find((s) => s.startsWith("GK3_START ")).slice(10));
  assert.equal(start.gateKeeperMerge, true);
  assert.equal(start.gateKeeperSha256, createHash("sha256").update("gate_keeper").digest("hex"));
});

test("historical plain behavior stays unchanged without the merge setting", () => {
  const s = summary(run());
  for (const a of arms) assert.equal(s[a].falseAlarms, 2);
});

test("an unparsed Gate Keeper answer stays unparsed with merge enabled", () => {
  const s = summary(run({ GK3_GK_MERGE: "1" }, { ...outputs, gate_keeper: "not JSON" }));
  assert.equal(s.gate_keeper.unparsed, 1);
  assert.equal(s.gate_keeper.caught, 0);
});

test("zero budget makes no calls; invalid budget and changed prompt fail closed", () => {
  const zero = summary(run({ GK3_CAP_USD: "0", GK3_GK_MERGE: "1" }));
  for (const a of arms) assert.equal(zero[a].unparsed, 1);
  for (const env of [{ GK3_CAP_USD: "not-a-number" }, { GK3_EXPECT_GK_SHA256: "wrong" }]) {
    const r = run(env);
    assert.notEqual(r.status, 0);
    assert.doesNotMatch(r.stdout, /GK3_ROW /);
  }
});
