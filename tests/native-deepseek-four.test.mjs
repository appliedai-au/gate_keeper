import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync, createHash, sign } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  STUDY_ID, MODEL, UPSTREAM, HARD_CAP_USD, nativeFourPlan, loadHardFixtures,
  fixtureDigest, verifyNativeFourAdmission, instructionsFor,
  feedbackFor, parseOwnLesson, runNativeFour,
} from "../scripts/proof/native-four-run.mjs";
import { scoreTask } from "../evals/score.ts";
import { smokePlan } from "../scripts/proof/sponsor-admission.mjs";

const sourceCommit = "a".repeat(40);
const runId = "gk-native-deepseek-20261102-qual-a";
const env = {
  RAILWAY_PROJECT_ID: "a8f4c4a4-0f32-4166-ba92-dad9baf2b652",
  RAILWAY_ENVIRONMENT_ID: "03fb9181-2f19-409b-a9b1-823cb32e56c2",
  RAILWAY_ENVIRONMENT_NAME: "qualification", RAILWAY_GIT_COMMIT_SHA: sourceCommit,
};
const hash = (x) => createHash("sha256").update(x).digest("hex");
const FENCE = String.fromCharCode(96).repeat(3);

function fixtureGrant(overrides = {}) {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const pem = publicKey.export({ type: "spki", format: "pem" });
  const issuedAt = 1_000_000;
  const statement = {
    study: STUDY_ID, runId, sourceCommit, fixtureDigestSha256: fixtureDigest(),
    tenant: "stranger-builds", provider: "tfy-managed",
    model: MODEL, upstreamModel: UPSTREAM,
    fundingSource: "sponsor-inference-credit",
    personalBillingFallbackDisabled: true, overageDisabled: true,
    noTools: true, noRepair: true, noAutomaticRetry: true,
    maxReviewTurns: 8, maxLearningTurns: 6, maxTurns: 14,
    maxReviewTokens: 2500, maxLearningTokens: 400,
    virtualAccountId: "gate-keeper-native-four-qual",
    gatewayBudget: {
      ruleId: "synthetic-test-only", subject: "gate-keeper-native-four-qual",
      mode: "Enforce", period: "Lifetime", scope: "per-virtual-account",
      currency: "USD", limitUsd: 5, remainingUsd: 5,
    },
    sponsorCreditRemainingUsd: 5,
    issuedAt, expiresAt: issuedAt + 60000,
    ...overrides,
  };
  const receipt = { statement, signature: sign(null,
    Buffer.from(JSON.stringify(statement), "utf8"), privateKey).toString("base64") };
  return { receipt, publicKeyPem: pem, pinnedKeySha256: hash(pem),
    sourceCommit, runId, now: issuedAt + 1000 };
}

test("four harder public fixtures have 29 uniquely located known defects", () => {
  const tasks = loadHardFixtures();
  const plan = nativeFourPlan();
  assert.deepEqual(tasks.map((t) => t.expected.length), [6, 8, 7, 8]);
  assert.equal(plan.knownDefectsPerArm, 29);
  assert.equal(plan.reviewTurns, 8);
  assert.equal(plan.reflectionTurns, 6);
  assert.equal(plan.previousPlaygroundTurnsCounted, 0);
  assert.equal(plan.model, MODEL);
  assert.equal(HARD_CAP_USD, 5, "the native full study must have a US$5 hard cap");
  assert.equal(plan.externalGatewayHardCapUsd, 5);
  assert.equal(smokePlan().maxGatewayLifetimeUsd, 1, "the two-turn smoke stays capped at US$1");
  assert.match(fixtureDigest(), /^[a-f0-9]{64}$/);
  for (const task of tasks) {
    assert.equal(task.holdout, false);
    assert.ok(task.context.length > 170);
    assert.ok(task.code.length >= 35);
    assert.equal(new Set(task.expected.map((e) => e.line)).size, task.expected.length);
    const perfect = FENCE + "json\n" + JSON.stringify({
      findings: task.expected.map((e) => ({
        line: e.line, category: e.categories[0], severity: "high", comment: e.why,
      })),
    }) + "\n" + FENCE;
    assert.equal(scoreTask(task, perfect).score, 1);
    const empty = FENCE + "json\n" + JSON.stringify({ findings: [] }) + "\n" + FENCE;
    assert.equal(scoreTask(task, empty).score, 0);
  }
});

test("default plan CLI needs no network or credentials; execution fails closed", () => {
  const cli = new URL("../scripts/proof/native-four-run.mjs", import.meta.url).pathname;
  const plan = spawnSync(process.execPath, ["--import", "tsx", cli, "--plan"], {
    encoding: "utf8", timeout: 20000,
  });
  assert.equal(plan.status, 0, plan.stderr);
  assert.equal(JSON.parse(plan.stdout).study, STUDY_ID);
  const denied = spawnSync(process.execPath, ["--import", "tsx", cli, "--run"], {
    encoding: "utf8", timeout: 20000,
  });
  assert.equal(denied.status, 3);
  assert.match(denied.stderr, /NATIVE_FOUR_HELD:ISOLATED_RAILWAY_ENVIRONMENT_REQUIRED/);
});

test("signed 14-turn scope verifies; independent funding and budget controls fail closed", () => {
  const v = fixtureGrant();
  assert.equal(verifyNativeFourAdmission(v).model, MODEL);
  assert.equal(verifyNativeFourAdmission(v).hardCapUsd, 5);
  assert.equal(v.receipt.statement.gatewayBudget.period, "Lifetime");
  assert.equal(v.receipt.statement.gatewayBudget.mode, "Enforce");
  assert.equal(v.receipt.statement.gatewayBudget.scope, "per-virtual-account");
  assert.ok(v.receipt.statement.virtualAccountId.startsWith("gate-keeper-native-"));
  assert.notEqual(v.receipt.statement.gatewayBudget.subject.startsWith("gate-keeper-smoke-"), true);
  for (const replacement of [
    { maxTurns: 8 }, { maxLearningTurns: 5 },
    { overageDisabled: false }, { personalBillingFallbackDisabled: false },
    { sourceCommit: "b".repeat(40) }, { model: "truefoundry/other" },
    { fixtureDigestSha256: "b".repeat(64) },
    { gatewayBudget: { ...v.receipt.statement.gatewayBudget, mode: "Audit" } },
    { gatewayBudget: { ...v.receipt.statement.gatewayBudget, scope: "team" } },
    { gatewayBudget: { ...v.receipt.statement.gatewayBudget, limitUsd: 1 } },
    { gatewayBudget: { ...v.receipt.statement.gatewayBudget, limitUsd: 6 } },
    { gatewayBudget: { ...v.receipt.statement.gatewayBudget, limitUsd: 50 } },
    { virtualAccountId: "gate-keeper-smoke-native-qual" },
    { gatewayBudget: { ...v.receipt.statement.gatewayBudget, subject: "gate-keeper-smoke-native-qual" } },
    { sponsorCreditRemainingUsd: 0.25 }, { maxReviewTokens: 8000 },
  ]) {
    const x = fixtureGrant(replacement);
    assert.throws(() => verifyNativeFourAdmission(x), /NATIVE_FOUR_HELD:/,
      JSON.stringify(replacement));
  }
  assert.throws(() => verifyNativeFourAdmission({
    ...v, pinnedKeySha256: "b".repeat(64),
  }), /TRUSTED_ISSUER_NOT_PINNED/);
  assert.throws(() => verifyNativeFourAdmission({
    ...v, receipt: { ...v.receipt, signature: "ZmFrZQ==" },
  }), /SIGNED_ADMISSION_INVALID/);
  assert.throws(() => verifyNativeFourAdmission({
    ...v, now: v.receipt.statement.expiresAt + 1,
  }), /SIGNED_LEASE_EXPIRED/);
});

test("each arm gets only its own bounded lesson, with the same output contract", () => {
  const b = instructionsFor("baseline"), g = instructionsFor("gate_keeper");
  assert.notEqual(b, g);
  const own = "Check versioning, retries and tenant scope.";
  const b2 = instructionsFor("baseline", [own]);
  assert.ok(b2.includes(own));
  assert.ok(!g.includes(own));
  assert.ok(b2.endsWith(b.slice(b.indexOf("## Benchmark output contract"))));
  assert.throws(() => instructionsFor("gate_keeper", ["word ".repeat(41)]),
    /LESSON_SCOPE_INVALID/);
  const task = loadHardFixtures()[0];
  const f = feedbackFor(task, { caught: [], missed: task.expected, noise: [] });
  assert.equal(f.expectedCount, 6);
  assert.equal(f.missedDefectsFromOwnPriorReview.length, 6);
  assert.equal(parseOwnLesson('{"lesson":"Check atomic settlement before publishing."}'),
    "Check atomic settlement before publishing.");
  assert.throws(() => parseOwnLesson('{"lesson":"' + "word ".repeat(45) + '"}'),
    /SELF_REFLECTION_NOT_BOUNDED/);
});

function fakeTrueForge() {
  let sessionSeq = 0, turnSeq = 0, providerReads = 0, modelReads = 0;
  const sessions = new Map(), calls = [];
  return {
    calls, sessions,
    get providerReads() { return providerReads; },
    get modelReads() { return modelReads; },
    settings: { modelProviders: { list: async () => {
      providerReads++;
      return { data: [{
        name: "truefoundry", manifest: {
          type: "truefoundry",
          baseUrl: "https://stranger-builds.truefoundry.cloud/api/llm",
          models: [{ name: "deepseek-v4-flash-0731", modelId: UPSTREAM }],
        },
      }] };
    } } },
    models: { list: async () => {
      modelReads++;
      return { data: [{ name: MODEL, provider: { name: "truefoundry" } }] };
    } },
    sessions: {
      create: async ({ agent, metadata }) => {
        const id = "synthetic-session-" + ++sessionSeq;
        sessions.set(id, { spec: agent.spec, metadata });
        return { data: { id } };
      },
      createTurn: async (id, body, options) => {
        assert.deepEqual(options, { maxRetries: 0 });
        assert.equal(body.previousTurnId, "none");
        const spec = sessions.get(id);
        assert.ok(spec);
        assert.equal(spec.spec.model.name, MODEL);
        assert.equal(spec.spec.model.params.temperature, 0);
        assert.deepEqual(spec.spec.tools, []);
        const text = spec.metadata.phase === "reflection" ?
          '{"lesson":"Check authorization and transaction ordering at every boundary."}' :
          FENCE + "json\n" + JSON.stringify({
            findings: [{
              line: 1, category: "bug", severity: "low",
              comment: "review-note-" + spec.metadata.arm,
            }],
          }) + "\n" + FENCE;
        const turn = {
          id: "synthetic-turn-" + ++turnSeq,
          state: { status: "done", output: { content: text }, metrics: {
            totalCostInUsd: 0.0001, totalTokens: 150,
          } },
        };
        calls.push({ ...spec.metadata, sessionId: id,
          instructions: spec.spec.instructions, input: body.input[0].content });
        return { data: turn };
      },
      getTurn: async () => { throw Error("mock turn is immediately complete"); },
      cancel: async () => {},
    },
  };
}

test("synthetic native engine performs exactly 8 paired reviews and 6 own feedback turns", async () => {
  const v = fixtureGrant(), tf = fakeTrueForge(), writes = new Map();
  const result = await runNativeFour({
    tf, receipt: v.receipt, publicKeyPem: v.publicKeyPem,
    pinnedKeySha256: v.pinnedKeySha256,
    sourceCommit, runId, now: () => v.now, env,
    claimOnce: async (entry) => {
      assert.equal(entry.model, MODEL);
      writes.set("STARTED", entry);
      return { created: true };
    },
    privateWrite: async (path, value) => {
      assert.ok(!writes.has(path), "private evidence must not be overwritten");
      writes.set(path, value);
    },
    wait: async () => {},
  });
  assert.equal(result.result, "INCONCLUSIVE");
  assert.equal(result.localBudget.cap_usd ?? result.localBudget.capUsd ?? result.localBudget.cap, 5);
  assert.equal(result.reviewTurnsObserved, 8);
  assert.equal(result.reflectionTurnsObserved, 6);
  assert.equal(result.separateNativeSessions, 14);
  assert.equal(result.gatewayActualBillingUsd, null);
  assert.equal(tf.calls.length, 14);
  assert.equal(tf.providerReads, 1);
  assert.equal(tf.modelReads, 1);
  assert.equal(writes.size, 30);
  assert.equal(result.privateEvidenceItemCount, 29);
  assert.deepEqual(result.lessonsPerArm, { baseline: 3, gate_keeper: 3 });
  for (let n = 1; n <= 4; n++) {
    const pair = tf.calls.filter((c) => c.phase === "review" && Number(c.round) === n);
    assert.equal(pair.length, 2);
    assert.equal(pair[0].input, pair[1].input);
    assert.notEqual(pair[0].instructions, pair[1].instructions);
    assert.equal(pair[0].input.includes('"expected"'), false);
  }
  for (const c of tf.calls.filter((x) => x.phase === "reflection")) {
    const other = c.arm === "baseline" ? "gate_keeper" : "baseline";
    assert.ok(c.input.includes("review-note-" + c.arm));
    assert.equal(c.input.includes("review-note-" + other), false);
  }
  assert.ok(!JSON.stringify(result).includes("synthetic-session-"));
  assert.ok(!JSON.stringify(result).includes("synthetic-turn-"));
});

test("production Railway scope and duplicate run ID refuse before any review turn", async () => {
  const v = fixtureGrant(), tf = fakeTrueForge();
  await assert.rejects(runNativeFour({
    tf, receipt: v.receipt, publicKeyPem: v.publicKeyPem,
    pinnedKeySha256: v.pinnedKeySha256, runId, sourceCommit,
    env: { ...env, RAILWAY_PROJECT_ID: "507ae09d-7dbb-444a-bd62-a5a16405c874" },
    claimOnce: async () => ({ created: true }), privateWrite: async () => {},
    now: () => v.now,
  }), /ISOLATED_RAILWAY_ENVIRONMENT_REQUIRED/);
  assert.equal(tf.providerReads, 0);
  await assert.rejects(runNativeFour({
    tf, receipt: v.receipt, publicKeyPem: v.publicKeyPem,
    pinnedKeySha256: v.pinnedKeySha256, runId, sourceCommit, env,
    claimOnce: async () => ({ created: false }), privateWrite: async () => {},
    now: () => v.now,
  }), /DURABLE_ONCE_CLAIM_NOT_PROVED/);
  assert.equal(tf.calls.length, 0);
});

test("a hung remote turn is cancelled and the run becomes nonretryable", async () => {
  const v = fixtureGrant(), tf = fakeTrueForge();
  const cancelled = [], writes = new Map();
  let attempt = 0;
  tf.sessions.createTurn = async () => {
    attempt++;
    return { data: { id: "stuck-" + attempt, state: { status: "running" } } };
  };
  tf.sessions.getTurn = async (_sessionId, turnId) =>
    ({ data: { id: turnId, state: { status: "running" } } });
  tf.sessions.cancel = async (id) => { cancelled.push(id); };
  await assert.rejects(runNativeFour({
    tf, receipt: v.receipt, publicKeyPem: v.publicKeyPem,
    pinnedKeySha256: v.pinnedKeySha256, sourceCommit, runId, env,
    now: () => v.now, wait: async () => {},
    claimOnce: async (x) => {
      writes.set("STARTED", x);
      return { created: true };
    },
    privateWrite: async (key, value) => {
      assert.ok(!writes.has(key));
      writes.set(key, value);
    },
  }), /NATIVE_TURN_FAILED_OR_PRIVATE_TRACE_UNAVAILABLE_NO_RETRY/);
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0], "synthetic-session-1");
  assert.equal(attempt, 1, "no paid call may automatically retry");
  assert.ok(writes.has("private/failures/review-1-baseline.json"));
  assert.equal(writes.get("private/failures/review-1-baseline.json").reason,
    "CALL_OR_EVIDENCE_INCOMPLETE; NOT_SAFE_TO_RETRY");
});
