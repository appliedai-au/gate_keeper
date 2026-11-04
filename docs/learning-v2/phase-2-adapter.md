# Phase 2: concrete TrueForge adapter and qualification handoff

## Status and scope

This increment implements the host-side TrueForge execution adapter, private
operation archive and compatibility renderer. It also repairs the Phase 1
abandonment path identified in PR #43. It is **source reviewed, not executed or
runtime-qualified**. The existing runner owner still owns live composition and
the native-gate owner still owns Gate Keeper registration and qualification.

The parent source is commit
`312a531315acee116e76356a2c1a86036d8a9c34` on
[`codex/gk-learning-v2-core-20261104`](https://github.com/appliedai-au/gate_keeper/pull/43).
The original [source manifest](source-manifest.json) describes that Phase 1
snapshot. The [Phase 2 manifest](phase-2-source-manifest.json) seals this
increment separately; neither manifest is a managed gate receipt.

| Source | Implemented behavior |
| --- | --- |
| `trueforge-turn.mjs` | Claims a call durably; creates a fresh inline session/root turn; captures bounded observations and a completeness flag; preserves ambiguous failures |
| `operation-archive.mjs` | Creates one private archive per operation; enforces unique call intents, exact operation bindings, ordered immutable stages and compare-and-swap publication |
| `legacy-renderer.mjs` | Renders the existing two-pass chain; converts findings and preserves the order of BAG post-processing |
| `compat/gk-bag-3091.mjs` | Byte-identical pure BAG helper from the existing control branch |
| `executor.mjs` | Schedules baseline, proposal, paired screening and three fresh confirmation blocks; refuses incomplete turns and verifies independently issued receipts against captured observations |
| `controller.mjs` update | Includes authority pins in the frozen execution request and refuses attempt abandonment while an unconsumed operation exists |

No package or lockfile changes are needed. The SDK client is supplied by the
admitted host. The active `proof/three-agent/run.mjs` and its overlapping
inherited tests are untouched by this increment.

## Host composition

The following illustrates the composition seam; it is not an instruction to
run candidate code outside the full managed gate:

```js
const execute = createLearningExecutor({
  controller,
  client: admittedTrueForgeClient,
  runtime: frozenRuntimeManifest,
  caseInputs: frozenModelVisibleCases,
  archiveFactory: async ({ operation }) => new OperationArchive({
    journal: privateJournalFor(operation.id),
  }),
  authorities: {
    evaluation: { publicKeyPem, pinnedFingerprint, issue: issueEvaluation },
    novelty: { publicKeyPem: noveltyPublicKey, pinnedFingerprint: noveltyPin,
      issue: issueNoveltyReview },
  },
});

await dispatchManagedOperation({
  controller, kind, attemptId, operationId,
  admit: globalGateway.admit,
  execute,
  settle: globalGateway.settle,
});
```

The host allocates a stable private journal outside the source checkout for
each operation ID. Reopening an archive permits inspection; repeating
`claimOperation` refuses dispatch, including after a crash. Selecting a new
directory is not recovery. The controller and independent gateway must retain
the same logical-operation identity across processes and volumes.

The executor compares the supplied request with the controller's persisted
reservation and freshly derived phase plan. It checks runtime, model, case
coverage, original instruction bytes and authority fingerprints before any
SDK mutation. Caller-supplied JSON is copied before the first await. Timing
options are restricted to clock, pause and bounded timeout/poll settings, so
they cannot replace the client, call or durable archive.

The `issue` functions are host capabilities with independently held authority.
They are not model tools, local signing fallbacks or implemented production
endpoints. The evaluator must check raw provider observations against its own
frozen oracle/scorer and actual admitted runtime. The novelty reviewer must
establish source applicability and compare every retained prior reference.
Copying requested identities onto a signed body is insufficient verification.

## Runtime identity and limits

The executor accepts exactly this versioned client-side runtime manifest:

| Field | Required value or preimage |
| --- | --- |
| `schema` | `gk-learning-v2-runtime-v1` |
| `sdkVersion` | `0.180.0`, matching the existing locked SDK selection |
| `serverVersion` | Existing admitted selection `0.180.0` or `0.182.0`; the host must identify which actual deployment it uses |
| `provider` | `truefoundry` |
| `memory` | `off`, a required managed-runtime policy assertion, not an invented SDK option |
| `sessionMode` | `inline-root-per-call` |
| `model` | Exact `{name, params}`; required positive `maxTokens`, with only the supported sampling/reasoning parameters accepted |
| `turnConfig` | Exact exported `TURN_CONFIG` described below |
| `renderer` | `gate-keeper-3091-two-pass-v1` |
| `bagBlob` | `3abd4181c0470d9b8fd9b81fb51e75ab9734bdc5` |
| `caseInputsDigest` | SHA-256 of canonical ordered `{caseId, prompt}` records; no oracle labels or scores |

`runtimeDigest` is the SHA-256 of this strict canonical JSON object. This
manifest pins the client request configuration. It does not establish the
truth of a supplied version string, the deployed server build, provider route,
server-added capabilities or billing behavior. The independent managed gate,
gateway and evaluator retain and verify the actual environment/build/route
evidence as part of admission. There is no live-version probe or endpoint
selection hidden in the adapter.

For each call, `inputDigest` hashes canonical
`{model, instructions, config, messages, previousTurnId: 'none'}`. `messages`
contains one user message. Metadata and scheduling IDs are excluded from this
model-input digest; operation/request/source identities are bound separately.
`outputDigest` hashes the exact UTF-8 text selected from the final main-thread
message. The provider observation still needs independent verification against
the complete effective request, including any server-added context.

### Explicit runtime delta requiring controls

The prior runner disabled `askUserQuestions`. This adapter additionally disables
generative UI, dynamic subagents, web search, sandbox, context compaction and
large-tool-response handling, and sets `iterationLimit: 1`. The configuration
and nested values are frozen. This is a declared runtime change. It must be
assessed through the unchanged BASE controls before attributing any result to
learning; this increment does not claim whole-runtime equivalence.

The pinned SDK has no `config.memory` field. A fresh inline agent and explicit
root turn prevent reuse of a previous conversation in this client path, but
they do not prove every server-side memory/capability setting. The pinned
server also installs `currentDateTime` unconditionally. One main-loop iteration
can execute a requested tool after its model step. The adapter rejects
observed tool activity, required actions, refusals, extra model-message IDs
and non-stop/empty/truncated output, but that check happens after the observed
activity. It is not pre-dispatch tool prohibition or provider-billing proof.

SDK HTTP calls use `maxRetries: 0`, deadlines and abort signals. The host must
still enforce the exact admitted inference allowance and the cumulative
US$20 programme limit at the independent gateway. Neither a single SDK turn,
an event count, an abort, nor an estimated `totalCostInUsd` metric proves the
actual number or cost of provider requests. Unresolved usage remains reserved
until independent reconciliation. No model inference was dispatched for this
source increment.

Primary runtime sources, pinned rather than taken from current marketing:

- [SDK RuntimeConfig at 0.180.0](https://github.com/truefoundry/trueforge/blob/b27acd9b06fcc8ea0765cd09188f9735da1c633c/packages/trueforge-sdk/src/api/types/RuntimeConfig.ts)
- [Built-in capability selection at 0.180.0](https://github.com/truefoundry/trueforge/blob/b27acd9b06fcc8ea0765cd09188f9735da1c633c/packages/trueforge-core/src/agent-session/builtinsFromSpec.ts)
- [Session client at 0.180.0](https://github.com/truefoundry/trueforge/blob/b27acd9b06fcc8ea0765cd09188f9735da1c633c/packages/trueforge-sdk/src/api/resources/sessions/client/Client.ts)
- [Corresponding 0.182.0 source](https://github.com/truefoundry/trueforge/tree/842e4992b8ed6d34c13b1b208d52f295ba9f3b8b)

## Two-pass compatibility and call scheduling

The compatibility helper is copied unchanged from
[`proof/three-agent/gk-bag.mjs` at 3091](https://github.com/appliedai-au/gate_keeper/blob/3091c2e8ae9e85b020e81bc62ad6520ca68e3cfb/proof/three-agent/gk-bag.mjs).
Its Git blob is `3abd4181c0470d9b8fd9b81fb51e75ab9734bdc5`, also present on
e054. Its SHA-256 is
`30266866befa36ef97a30a077e0a4541a64af45671520529bfad2d084278f1f1`.
The copy avoids importing the executable runner and keeps its original source
and attribution. No rule-bag contents were invented or regenerated.

First-pass instructions use the frozen BASE and BAG preparation. Its converted
findings are BAG-postprocessed before the existing chain text is appended to
the second request. The final merge combines those first-pass findings with
the **raw converted second-pass findings**, then postprocesses once. Separately
deduplicating pass two first would change valid-case results: first line 1
plus second lines 2 and 3 must preserve the legacy merged lines 1 and 3.

The parser retains legacy last-balanced-findings-object framing on bounded
text. It deliberately rejects malformed finding members, unsafe line values,
oversized replies and excessive framing work rather than silently turning
them into an apparently successful empty review. These completeness changes
and the runtime delta above require explicit control/regression qualification;
byte-level parity for all malformed inputs is not claimed.

Screening executes and verifies the full incumbent arm first. Candidate first
passes reuse its exact captured request/reply identities. Candidate off-scope
second passes also reuse their incumbent observations, after an exact input
digest comparison. Only reviewed applicable candidate second passes are fresh.
A cache miss or mismatch refuses progression without a live fallback.

Confirmation follows the controller's fixed three-block alternating plan.
Every arm/pass/case is fresh; a distinct incumbent also requires the planned
original-BASE control. The executor does not add replacement blocks, score its
own candidate, decide novelty, activate a version or start another attempt.

The model-visible case corpus contains only case IDs and prepared task prompts.
Expected defects, fit/check scores, rejected procedures and prior feedback do
not enter finder calls. The proposer receives only the controller's frozen
allowed learner projection. Private novelty-review inputs remain at the
independent host boundary. Tranche 7 remains sealed and unused.

## Durable observations, signatures and recovery

An operation archive records the operation/request before its first call, then
each unique call intent before SDK session creation. It retains immutable
`session -> turn -> final` stages, or a terminal `failure` at an earlier stage.
Identity changes, skipped stages, duplicate artifacts and terminal rewrites
are rejected during both writes and replay. A committed write whose response
is lost is not silently retried. `FileJournal` supplies private-path checks,
durability, locking and compare-and-swap behavior.

The final call observation includes session/turn IDs, exact model input/output,
all collected event pages, completeness and the explicitly estimated cost.
Transport headers and arbitrary SDK exception objects are excluded. Failures
retain stable codes and the available IDs/observations for reconciliation.

Signed envelopes use the existing verifier's exact `JSON.stringify(body)`
serialization. The executor verifies the issuer's original object and keeps
its original serialized envelope **as a string** in the canonical journal.
Sorting a signed body's keys before verification would invalidate that
signature; canonical content digests and signature bytes remain separate.

The Phase 1 review found that `abandonAttempt` could strand an unconsumed
operation: subsequent operation abandonment required an open attempt, while
settlement required consumed evidence. The controller now refuses that attempt
transition. The operator must first use `abandonOperation` to mark the phase
unresolved, then obtain authentic settlement. This preserves the reservation,
does not infer zero usage and does not authorize another dispatch.

Regression source covers the actual controller dispatch exception paths for
proposal, screening and confirmation, SDK observations and pagination,
archive restart/CAS races, two-pass rendering and concrete executor scheduling.
Synthetic SDKs and signing keys are test fixtures only. Written declarations
are not discovered or passing test counts. No local candidate parser, import,
test, typecheck, build, installation, formatter or hook was run.

## Verified managed-gate dependency and next exit

The read-only inspection on 4 November 2026 found Spekky API Railway deployment
`5d15c5d1-5572-4162-881a-53f309625ed1` at source
`2882f1c67d77a17a42840c2eb738fa8e9c07891e`. At that served source:

| Required native capability | Observed source |
| --- | --- |
| Gate Keeper target | Absent from the six-target table in `executor_check.go`, blob `a2673f44f8092b4d953930b10be0a0e00d7cbcb9` |
| Gate Keeper trusted output profile | Absent from `run-task.sh`, blob `26005ce567464222d58cea5bbbe6796861801280` |
| Unregistered target admission | Refused by `executor_sandbox_jobs.go`, blob `678f3aa6d5ab71eb7b30bd0e48f831dda37680b3` |

The inspected Spekky main
`f66bc753fb1c5de81ac4bdc1b9f152135bd372b1` also lacked this registration.
An empty pending GitHub status does not demonstrate a queued native gate.
The default poller skips draft PRs; this draft is not automatically admitted.
The owner must use the supported explicit exact-head gate path after the
registration is complete, or deliberately advance the review state when ready.

The remaining Phase 2 work is concrete:

1. The existing owner reconciles the 3091/e054 runner repairs and composes this
   adapter with private durable archives, real independent issuers and the
   already reconciled global gateway. Preserve all inherited regressions.
2. The native-gate owner registers Gate Keeper's complete target and reviewed
   preset, both shell/embedded output-profile copies, repository enrollment
   and protected gate paths; qualifies and releases that Spekky change.
3. Admit the exact reconciled Gate Keeper head to the **whole** existing recipe:
   pinned environment/install, decoded-log canary, typecheck, scorer self-test,
   full Node discovery and every normal security/policy/base/product/effective-
   tree/cleanup gate. Any adopted Python contrast fixtures additionally need
   their explicit interpreter, seven identities and discovery/outcome checks.
4. Retain the complete managed receipt and independent source review. Only
   then perform the Phase 3 BASE controls and authorized ten-attempt pilot.

No target from another application, generic shell, reduced command, paid
evaluation host or self-signed gate evidence substitutes for that exit.

Sources: [served target table](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/server-go/internal/services/executor_check.go),
[served output profiles](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/scripts/executor/run-task.sh),
[existing registration owner requirements](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6619321938),
[current ownership coordination](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6620951327),
and [Gate Keeper full qualification recipe](https://github.com/appliedai-au/gate_keeper/blob/20dcea65a22e680398d017191b91d04e32b4f883/Dockerfile.qualify).
