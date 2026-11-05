# Run accounting v4: unknown prices do not stop authenticated execution

Policy revision 4 keeps a simple balance for one experiment run. A gateway can
close execution with an exact, signed call count while the operation's price is
still unknown. The next permitted learning phase can proceed. A later verified
charge updates accounting once, without repeating a model call or changing a
learning result.

This implements the owner's removal of programme spending from the execution
decision. It does not create a provider, an evidence issuer, live credentials, or
an experiment result. Independent execution, evaluation, novelty, and activation
authority remain required.

## Fresh experiment; historical records stay intact

`POLICY.version` is 4. The configuration digest includes that policy, the frozen
configuration, trust pins, and imported historical references. The existing
policy equality check refuses to reopen an earlier policy's journal. There is no
migration or rewrite of v1, v2, or v3 records, Tranche 7, or earlier rule-bank rows.
Use a new experiment identity and preserve the actual rejected/unproven historical
references in its initialization input.

The optional opening receipt must still describe an empty new run. Historical
programme charges cannot be inserted into the new balance. The old `budget` role
and public field name remain wire names for compatibility; there is no monetary
ceiling or cumulative spend admission decision.

## Execution completion and price availability

The existing signed `gk-learning-v2-operation-settlement` receipt still binds the
experiment, frozen configuration, source, operation, lease, gateway, and provider.
Its `actualCalls` must be an integer within the admitted count, at least the
observed fresh calls, and exactly the planned count when complete evaluation
evidence was recorded. Missing or contradictory execution facts do not close
custody and never authorize a retry.

For policy 4, `actualMicros` has two explicit forms:

| Value | Meaning |
| --- | --- |
| Nonnegative safe integer | Verified operation charge in microUSD; zero is a verified zero charge. |
| `null` | Operation charge is unknown. This is not a zero charge. |

Omitted values, negative amounts, fractions, and unsafe integers are refused.
The controller never substitutes SDK-estimated costs for provider-verified charges.

A valid receipt with `actualMicros: null` settles execution. The controller can
then advance according to its existing learning state machine. The host closes
the matching dispatch record using that receipt. The same rule applies when a
historical admission is reconciled after an interrupted response. An unknown fee
on a zero-call operation remains an unknown **operation** even though its unknown
call count is zero.

Remote cumulative `spentMicros` and `reservedMicros` are no longer balance inputs
or execution conditions. They may be delayed or refer to other runs. The local
balance is derived from this run's individually authenticated operations.

## One durable accounting source

`operationRunBalance()` in `scripts/learning-v2/run-balance.mjs` projects the
controller's existing append-only journal:

- Known charges sum each original verified operation charge, or its one later
  verified charge, exactly once.
- Reserved estimates sum the admitted reservations of operations whose execution
  remains unsettled. A reservation is not a charge.
- Unknown cost operations and their exact actual call counts remain explicit.
- Pending execution is counted separately; an admitted maximum call count is
  never presented as actual usage.

The standalone per-call `RunBalance` class remains available and unchanged. A
provider may bill an entire operation as a batch. The host therefore uses the
shared operation projection without inventing an allocation to individual calls
or introducing a second accounting journal with another atomicity boundary.

The host and read-only status reader also include an open dispatch intent in the
pending count. This covers the gap before controller admission and the gap after
controller settlement but before dispatch closure. A matching unsettled
controller operation is counted once.

## Delayed charge API

The trusted host can receive a late, independently signed charge through:

```js
await host.reconcileOperationUsage(operationId, signedEnvelope);
```

The envelope has the existing `{ body, signature }` shape. The body must contain
exactly these fields:

| Field | Required binding |
| --- | --- |
| `schema` | `gk-learning-v4-operation-usage` |
| `receiptId` | Unique authenticated receipt identity |
| `experimentId`, `configDigest`, `sourceCommit` | This frozen experiment |
| `operationId`, `leaseId`, `requestDigest` | The completed operation and original admission |
| `settlementReceiptId`, `actualCalls` | The original execution settlement and unchanged actual call count |
| `budgetId`, `gatewayId` | The run's configured accounting identity and pinned gateway |
| `provider` | `truefoundry` |
| `global`, `ceilingMicros` | `false`, `null` |
| `status` | `known` |
| `actualMicros` | Nonnegative safe integer with the verified operation charge |

The pinned budget authority must sign the original JSON body, using the existing
Ed25519 envelope contract. The host does not sign or fabricate this receipt. A
gateway can supply one only after independently reconciling the actual charge.

Reconciliation requires a completed operation whose original price was explicitly
unknown. It retains the first accepted serialized envelope and its digest,
registers the receipt identity in the shared replay set, and appends one controller
event. The original settlement ID, call count, and `actualMicros: null` remain
unchanged; the later charge is retained in `usageReconciliation`. This preserves
recovery using the original execution receipt if dispatch closure was interrupted.

Replaying the same authenticated body is idempotent, including a reordered outer
envelope. It adds no event and does not replace the first original bytes. A changed
charge or receipt identity conflicts; wrong signatures, changed bindings, reused
receipt identities, and attempts to overwrite an originally known charge fail.

The operation is accounting only. It can run while a different dispatch awaits
recovery, provided no other host mutation is currently executing. It does not
admit or complete that dispatch, change attempt or version state, activate a rule,
contact a model, or retry anything. No browser mutation endpoint is added.

## Public status

The existing public `budget` record adds `unknownCostOperations`,
`unknownCostCalls`, `pendingExecutionOperations`, and `complete`.
`observedSpentMicros` is the known verified subtotal, not an assertion that all
usage has been priced. `complete` is true only when no unknown operation price and
no unresolved execution/dispatch custody remain. The exact public contract checks
these relationships and excludes private receipt bytes, signatures, and rule text.

The dashboard labels the amounts as **Known charges** and **Reserved estimate**,
shows unpriced operations and calls awaiting prices, and displays whether the
accounting record is complete. Learning outcomes and accounting completeness are
independent: a candidate can finish the required confirmations while its prices
remain pending, but activation still requires the separate signed approval.

## Qualification and remaining integration

Regression source covers explicit unknown versus verified zero, exact execution
counts, stale cumulative gateway totals, cross-context and wrong-role receipts,
idempotent later reconciliation, frozen historical policies, and public projection
consistency. Durable host cases cover restart, both dispatch custody gaps, a late
charge during an unrelated pending operation, original-receipt recovery after
late pricing, and confirmation/activation with unknown prices.

These tests are prepared for the authorized isolated full Railway qualification.
They have not been run locally. This source change alone is not evidence of a live
BASE or ten-attempt pilot. The production composition still needs a genuine
configured SDK client, frozen cases/runtime/configuration, retained historical
references, independent evaluation and novelty issuers, authentic admission and
execution settlement callbacks, pinned public keys, and the separately authorized
activation path. The status service also needs its real private configuration and
owner binding. Price availability is no longer an additional gate on those steps.
