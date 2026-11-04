# Phase 2: durable host composition and admission recovery

## Delivery status

This increment adds the concrete persistent host around the controller,
TrueForge executor and operation archives. It closes the caller-side storage
and admission crash windows in the previous adapter increment. It remains
**source-only and unqualified**: no candidate code or model inference was run.

The parent is
[`3ef57ff4d9776a70d337e0dbf206b5ccca9488fb`](https://github.com/appliedai-au/gate_keeper/commit/3ef57ff4d9776a70d337e0dbf206b5ccca9488fb).
Gitar's [review of that parent](https://github.com/appliedai-au/gate_keeper/pull/43#issuecomment-6629072454)
approved the source and closed its prior abandonment finding, while explicitly
distinguishing source review from runtime qualification. That review is not a
review or test pass for this later increment.

The [host source manifest](host-source-manifest.json) seals the current files.
The earlier Phase 1 and Phase 2 manifests remain unchanged historical snapshots
of their named parent revisions. They are not current whole-repository gate
receipts or effective-tree manifests.

## Concrete host API

`host.mjs` composes the real `FileJournal`, `LearningController`,
`DispatchLedger`, `OperationArchive`, `createLearningExecutor` and
`dispatchManagedOperation`. The caller supplies configuration and approved
capabilities; it no longer supplies an arbitrary operation archive factory.

```js
const options = {
  directory: stablePrivateExperimentDirectory,
  repositoryRoot: admittedCheckout,
  config: frozenExperimentConfiguration,
  trust: pinnedPublicTrust,
  client: admittedTrueForgeClient,
  runtime: frozenRuntimeManifest,
  caseInputs: frozenModelVisibleCases,
  authorities: { evaluation: independentEvaluator, novelty: independentReviewer },
  gateway: { admit: independentGatewayAdmission, settle: independentGatewaySettlement },
};

// Explicit first creation only:
const host = await initializeLearningHost(options, {
  history: reviewedPrivateHistory,
  budgetEnvelope: signedCumulativeProgrammeState,
});
await host.recordManagedGate(signedCompleteSourceGate);
await host.dispatch('baseline');

// Every subsequent process reopens the same existing experiment:
const resumed = await openLearningHost(options);
const attempt = await resumed.beginAttempt(signedOriginalFitFeedback);
await resumed.dispatch('proposal', attempt.attemptId);
// The admitted runner branches on the persisted result before the next phase.
```

This is the managed host's composition example, not a local execution command.
It discovers no credentials or endpoints and creates no provider client,
gateway, signer, service or deployment. Real authority custody and integration
remain with the existing owners.

| Method | Behavior |
| --- | --- |
| `initializeLearningHost(options, initial)` | Requires empty controller/dispatch stores, authenticates initial cumulative accounting, initializes once, then reopens with directory creation disabled |
| `openLearningHost(options)` | Requires existing stores and the same experiment configuration, trust pins and runtime inputs |
| `status()` | Public counts, version selection, observed accounting and outstanding dispatch identity/stage; no prompts, private history or receipts |
| `inspect()` | Private `{state, dispatch}` for the admitted operator; never expose this as the public app endpoint |
| `inspectOperation(id)` | Reads the stable operation archive without creating it; distinguishes a missing directory from corrupt or unsafe evidence |
| `recordManagedGate(envelope)` | Imports the independently signed complete source gate |
| `beginAttempt(feedbackEnvelope)` | Reserves one attempted cycle and freezes the allowed original fit feedback |
| `dispatch(kind, attemptId)` | Performs one explicit baseline, proposal, screening or confirmation phase; creates its missing plan where permitted, then admits and dispatches once |
| `recover({...})` | Imports independent admission/settlement evidence without calling the gateway or SDK |
| `recordNotAdmitted(envelope)` | Records an independently authenticated non-admission and consumes that logical phase without dispatch |
| `abandonAttempt(id, reason)` | Preserves the controller's recovery rules and refuses while host dispatch is outstanding |
| `activateVersion(id, envelope, action)` | Requires the existing separate activation/rollback authority |

There is no automatic next-attempt loop, screen-positive activation, replacement
confirmation block or repeated gateway request. The existing runner explicitly
chooses each next phase from the stored state.

## Stable storage and identities

The host uses one caller-selected, persistent private experiment directory,
disjoint from the source checkout. Its children are fixed:

| Location | Contents |
| --- | --- |
| `controller/` | Existing hash-linked controller snapshots |
| `dispatch/` | Create-once experiment/configuration anchor, admission intents, original gateway observations and explicit resolutions |
| `operations/<digest>/` | Private SDK call intents, stages, observations and signed evaluation/novelty artifacts for one operation |

The operation ID is `operation-` plus SHA-256 of canonical
`{experimentId, kind, attemptId}`. Its archive directory uses SHA-256 of
canonical `{operationId}`. Neither uses a random identifier, process ID,
timestamp, changing configuration digest or temporary directory to obtain a
fresh execution slot. Changing the configuration at the same experiment root
refuses reopening; it does not silently select new state.

`FileJournal` now supports `create: false`. Normal reopened host stores and
archive inspection use it. Only explicit initialization and the first admitted
archive claim can create their respective directories. Existing POSIX
ownership, symlink, 0700 directory, 0600 file, lock, hash-chain, checkpoint and
fsync checks remain in force.

A narrowly typed `JOURNAL_DIRECTORY_MISSING` result applies only to an absent
expected journal directory during preparation. Missing records, malformed
data, unsafe ownership, locks and permissions are not converted into that
result. Reopening refuses missing archives when recorded settled execution
requires them. An admission-only recovery can legitimately lack a call archive;
absence never proves zero provider usage.

Initialization spans two durable stores. A partial initialization is reported
as incomplete and is not automatically repaired. Whole-volume rollback or a
malicious process with the same operating-system identity still requires
external evidence custody. The independent gateway must enforce logical-phase
and budget uniqueness across different volumes or host processes.

## Admission is now durable before the gateway call

The earlier generic runtime seam asked the gateway to admit the operation
before recording its lease in the controller. A lost response in that interval
could leave real remote budget reserved while the local controller knew of no
operation. Merely deriving a stable ID would not prove whether admission had
already been attempted.

The host first appends a unique dispatch intent with the exact operation and
request digest to the persistent dispatch ledger. Only after that write is
durably acknowledged does it invoke `gateway.admit`. The original returned
lease is retained before controller reservation. The operation archive still
claims each call before SDK mutation.

Any pending intent blocks another host mutation that could advance the
experiment. An already recorded logical phase is refused **before** the gateway
is contacted, even if its earlier outcome was confirmed non-admission. A second
host process must claim the same ledger through compare-and-swap; its losing
claim cannot reach admission. The gateway remains responsible for exclusivity
outside that shared storage boundary.

An outstanding intent is visible in `status().pendingOperation` even before a
controller reservation exists. `status().dispatch.pending.stage` reports
`admission-intent`, `admission-observed`, `settlement-observed` or
`not-admitted-observed`. These are local observation stages, not claims that a
remote process has terminated or that billing has settled.

## Explicit recovery, including expired leases

Recovery never calls `admit`, `settle`, a model or an SDK method. The operator
obtains actual gateway evidence through the existing independent process and
imports its original signed envelopes:

```js
await host.recover({
  operationId,
  reason: operatorReconciliationReason,
  admissionEnvelope: originalGatewayAdmission,
  settlementEnvelope: actualFinalGatewaySettlement,
});
```

There are three distinct cases:

1. **Intent exists, controller reservation is absent.** A historical admission
   by itself remains an outstanding hold. When both historical admission and
   final settlement are authenticated, `reconcileAdmission` records a single
   already-consumed, already-settled, `reconciliationOnly` operation atomically.
   It validates the original issuance window, exact plan/call allowance,
   operation/source/gateway bindings, reservation and cumulative accounting.
   Elapsed expiry is allowed only for this accounting path. It never creates
   or renews execution authority. The attempt becomes unresolved, and a failed
   baseline does not become a valid control.
2. **Controller reservation exists, execution is ambiguous.** The host marks
   the unconsumed phase unresolved, preserving its actual identity and hold.
   Only authentic settlement can close billing. Missing settlement leaves the
   reservation outstanding; no zero-cost inference or automatic retry occurs.
3. **Evidence or settlement completed but acknowledgment was lost.** Recovery
   imports the matching settlement or finishes the pending ledger resolution
   against already settled controller evidence. It preserves accepted evidence
   and does not repeat the inference or gateway charge.

All gateway signatures use the pinned budget authority and exact context.
Wrong signatures, mismatched identities and contradictory usage are refused.
The historical-admission path requires both valid receipts before its single
controller write, so failed reconciliation cannot partially create an active
lease. Costs use integer micro-US-dollars and the same cumulative US$20 ceiling.

### Authenticated non-admission

When the gateway confirms that a request was never admitted, the host accepts
only a budget-signed `gk-learning-v2-operation-not-admitted` envelope binding:
receipt ID; experiment/config/source; operation/request digest; global budget
and gateway; TrueFoundry provider; fixed ceiling; `status: 'not-admitted'`;
`reservationExists: false`; and zero actual calls/cost.

This is an external gateway protocol requirement, not a local assertion or
newly commissioned endpoint. The host requires no controller reservation and
refuses non-admission if it already holds a matching authenticated admission.
It retains the original negative receipt, marks a learning attempt unresolved
and consumes the logical phase. An error, timeout, missing archive or missing
gateway response cannot substitute for this receipt.

### Original observations remain immutable

The dispatch ledger retains original serialized admission, settlement and
non-admission strings without canonicalizing their signed bodies. Corrected
independent evidence is appended; older observations are preserved. An explicit
recovery can select an earlier authentic receipt after a later unusable one,
through a separate event referencing the retained observation. This avoids
leaving the selected receipt inconsistent with the evidence actually used.

Each operation permits at most 32 distinct observations and 32 reselections.
Neither adding nor selecting an observation grants authority, clears the hold
or repeats dispatch. Only the host's authenticated resolution closes it.
Completed ledger entries and their underlying events remain immutable.

## Prepared regression evidence

New dispatch-ledger and host test source covers actual compare-and-swap races,
initialization/reopen, missing stores, pre-admission crash windows, original
receipt bytes, corrected evidence, expired leases, partial charges, lost
settlement responses, authenticated non-admission and duplicate-phase refusal.
The host integration fixture exercises the real controller, file journal,
executor and turn adapter through baseline, proposal, paired screening and
three-block confirmation, with independent synthetic issuers and no real model.
The confirmed fixture version remains inactive.

These cases have been written and source reviewed only. Their prepared
assertions and fixture counts are not executed results. Full managed
qualification, actual discovery/counts and runtime controls remain mandatory.

## Current operational dependency and next phase

The read-only check at **11:11 UTC on 4 November 2026** still found served Spekky
source `2882f1c67d77a17a42840c2eb738fa8e9c07891e`, Railway deployment
`5d15c5d1-5572-4162-881a-53f309625ed1`, and main
`f66bc753fb1c5de81ac4bdc1b9f152135bd372b1`. Gate Keeper remains absent from the
target and trusted output-profile tables. No Gate Keeper managed gate was
dispatched or inferred from a pending GitHub status.

A further verified admission requirement corrects the prior handoff wording:
the served native source guard requires an **open, non-draft PR with the exact
published head and base**. Prepared operator capsules use the same guard.
Explicit dispatch does not make a draft PR eligible. After registration and
source integration are ready, the candidate must become review-ready before
that native gate can be admitted. Merge/deployment require their existing
independent gates and authorization.

The remaining work is still owned live integration: reconcile the existing
3091/e054 runner changes, supply the real SDK/issuer/gateway capabilities and
durable volume, register and release the complete Gate Keeper target/profile,
then qualify the exact source through the whole remote recipe. Phase 3 follows
with explicit BASE controls for the declared runtime delta and the ten-attempt
pilot. No evaluation-host, local-command or unrelated-target substitution was
used to move past those requirements.

Sources: [served target table](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/server-go/internal/services/executor_check.go),
[served output profiles](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/scripts/executor/run-task.sh),
[exact-source and draft-state guard](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/server-go/internal/services/executor_sandbox_source.go),
and [existing registration handoff](https://github.com/appliedai-au/Spekky-V1/pull/809#issuecomment-6621027317).
