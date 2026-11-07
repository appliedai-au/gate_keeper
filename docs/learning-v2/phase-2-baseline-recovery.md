# Phase 2 review closeout: baseline non-admission

## Status and finding

This source increment addresses the [PR #43 review finding](https://github.com/appliedai-au/gate_keeper/pull/43#discussion_r4467002348)
against parent `d6f4f3b24a3f721aebd1876fd2c939eed82bf833`. That parent added the
persistent host and admission recovery. Gitar approved it with a suggestion:
baseline non-admission closed the dispatch ledger without recording a terminal
baseline disposition in the controller.

The baseline could not be retried, as required by the experiment contract, but
the controller still looked like it had an unfinished plan. The operator could
not distinguish a consumed baseline from work still waiting to start by reading
controller state or the public status projection.

The correction is source only. Prepared regression assertions are not executed
results. No candidate code, paid inference, activation or deployment was run.
The [baseline recovery source manifest](baseline-recovery-source-manifest.json)
seals this increment; all three earlier manifests remain unchanged historical
snapshots.

## Authenticated controller disposition

`LearningController.recordBaselineNotAdmitted(operation, envelope)` now records
this outcome in one controller journal write. It requires the existing planned
baseline, matching source gate and exact frozen operation/request identity,
with no admitted operation, completed baseline or prior terminal baseline error.
It independently verifies the pinned budget authority and every non-admission
binding, including the global budget/gateway, TrueFoundry provider, fixed US$20
ceiling, no reservation, and zero calls/cost for this particular operation.

The transition records a fixed `baselineError`, consumes the receipt ID and
retains this private marker:

```js
baselineNonAdmission = {
  operationId,
  requestDigest,
  receiptId,
  receiptDigest,
};
```

`receiptDigest` is `digest(JSON.stringify(capturedEnvelope))`: SHA-256 over the
strict canonical JSON representation of the original serialized envelope
string. Original signed-body property order is preserved. It is not a digest
of a reordered body. The method captures both inputs before its first await.

This marker creates no controller lease, model result, settlement or operation
archive. Global observed spend and reservations are unchanged. Zero usage for
one non-admitted request does not reset cumulative programme accounting.

The baseline execution-request path also refuses a recorded baseline error.
Lower-level callers therefore cannot bypass the host's consumed-phase check
and obtain a replacement admission request. The failed baseline remains
terminal; a new experiment requires its existing separate authorization and
the same cumulative budget accounting.

## Two-store ordering and recovery

The host authenticates the receipt, verifies any existing controller marker,
retains the original observation, records the controller disposition, and then
completes the dispatch ledger. A marker must match the exact operation,
request, receipt ID and original envelope digest. A truthy `baselineError`
alone never permits skipping a write or completing the ledger.

| Last durable boundary | Persisted state | Permitted next action |
| --- | --- | --- |
| Admission intent only | Planned baseline and pending dispatch | Obtain independent admission/settlement or non-admission evidence |
| Non-admission observation retained | Planned baseline and pending dispatch | Explicitly submit authenticated non-admission to record its disposition |
| Controller disposition recorded | Failed baseline and matching pending dispatch | Explicitly resubmit the same receipt to finish ledger closure |
| Dispatch ledger completed | Failed baseline and completed non-admission | Inspect the terminal outcome; do not repeat dispatch |

The host may finish an acknowledged controller disposition after losing its
acknowledgment or the subsequent ledger completion. This requires explicit
resubmission of the same authenticated receipt. A differently signed receipt
or changed original serialization cannot replace the marker, even if it claims
the same semantic outcome. Reopening and read operations perform no repair.

Two operator processes can overlap while observing receipts. While closure is
pending, the controller marker must have matching retained original evidence;
a later selected observation does not erase that evidence or prevent explicit
recovery. Completion supplies the expected selected-observation digest to
`DispatchLedger.complete`. The ledger checks that digest inside the same
compare-and-swap append that closes the entry. A changed selection or stale
journal head refuses completion. Explicit recovery can then reselect the
original receipt and finish. A completed entry must have that original receipt
selected; it cannot conceal a different observation behind the resolution.

## Public baseline status

`status().baseline` is an additive public projection:

```typescript
type BaselineStatus = {
  status: 'not-planned' | 'planned' | 'complete' | 'failed',
  failureCode: null | 'not-admitted' | 'unresolved',
};
```

`not-admitted` comes from the authenticated controller marker. Other recorded
baseline failures use `unresolved`. The projection exposes no raw error text,
receipt body, signature, private diagnostic, prompt or historical rule. It
does not add a learning attempt or imply that global billing is fully settled.
The separate pending-operation and observed-budget fields retain their existing
meanings. The app endpoint/UI still requires the owned integration and full
qualification before rollout.

## Prepared regression coverage

Controller cases cover authentic closure, independent signer/context refusal,
receipt replay, existing admission/completion refusal, input capture, preserved
accounting and lower-level retry refusal. Host cases use the real controller,
dispatch ledger and private file journals to reproduce the interruption after
controller disposition and before ledger completion. Projection cases cover
baseline states and exclusion of private diagnostics.
Ledger cases cover the completion digest and competing selection/CAS windows;
the host fixture also retains a later competing receipt before recovering the
controller's original receipt.

All cases are source only. Discovery, actual outcomes, the complete inherited
suite and every normal repository gate remain the responsibility of the full
registered Spekky-managed remote gate.

## Current qualification dependency

At **23:10 AEDT on 4 November 2026** (12:10 UTC), the served Spekky deployment
remained `5d15c5d1-5572-4162-881a-53f309625ed1`, source
`2882f1c67d77a17a42840c2eb738fa8e9c07891e`. Gate Keeper was still absent from
its target and trusted output-profile tables. Spekky main had advanced to
`179e6095a9f2bbffb17d5dffa98fec30388d016a`, without adding that registration.

The existing runner and native-gate owners retain integration and registration.
The whole remote recipe, exact source identities and open/non-draft admission
requirement remain unchanged. No unrelated application gate or local execution
substitutes for qualification.

Sources: [current main target table](https://github.com/appliedai-au/Spekky-V1/blob/179e6095a9f2bbffb17d5dffa98fec30388d016a/server-go/internal/services/executor_check.go),
[current main output profiles](https://github.com/appliedai-au/Spekky-V1/blob/179e6095a9f2bbffb17d5dffa98fec30388d016a/scripts/executor/run-task.sh),
[served target table](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/server-go/internal/services/executor_check.go),
and [existing operational handoff](https://github.com/appliedai-au/Spekky-V1/pull/809#issuecomment-6621027317).
