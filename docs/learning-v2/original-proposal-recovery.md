# Interrupted original proposal recovery

## Incident and scope

The original protected experiment is `gk-v4-concurrency-20261105`. Its original
BASE completed with fourteen calls. Attempts 1–3 were retained as genuine invalid
proposals. Attempt 4 was interrupted during an authority replacement after its
owned provider root turn had already been created. The preserved host archive has
`session,turn,failure`, not a final result. Repeating the provider call or changing
the result to a failed execution is not a valid repair.

This change implements the missing **read-only original-output preparation**.
It is deliberately not wired into a startup command or a public endpoint. It does
not by itself close issue #44, resume the pilot, settle an operation, or enable
private live reviews. Production must remain at qualified B until the separate
source-transition and consumption boundaries below are implemented and reviewed.

## Implemented boundary

`prepareOriginalProposalRecovery` accepts a trusted operator's `readOriginal`
capability, independently pinned expected context and authenticated provider
readers. The expected context is not browser-supplied data. Its owned entry must
come from the actual detached authority ledger, not from provider output.

The original checkpoint contains the controller, dispatch and operation journal
heads and the original operation archive. Its canonical digest is pinned before
reading provider data. Preparation requires exactly one unconsumed proposal with
one original call, no disposition artifacts, the full original input, and exactly
`session,turn,failure`. Only a captured `TRUEFORGE_CALL_UNRESOLVED` interruption at
`turn-read`, `events-read` or `poll-wait` is eligible. Missing identifiers, uncertain
session/turn creation, final-archive uncertainty, changed journals, already
consumed work and multiple calls remain held.

The implementation reuses `inspectProviderCall`, rather than creating a weaker
recovery verifier. This verifies the private inline session and subject, complete
session specifications and metadata, exact input, the sole root turn, all turn
pages at limit 25, all event pages at limit 100, one main-thread model output,
matching terminal event content and a stable final read. Required actions, tools,
refusals, truncation, extra inference, unresolved execution and changed content
are rejected. The original checkpoint is read again after verification.

There is no provider create/createTurn/update/delete capability in the verifier.
There is no retry loop and no journal write during preparation. Original output
is classified only as invalid, exact duplicate, or requiring independent review.
A unique valid candidate is **not** classified as novel or promoted.

`retainOriginalProposalPreparation` can publish the complete private observation
in a **separate, dedicated recovery journal** with one compare-and-swap append.
Explicit reentry may read back the same already-retained observation after a lost
acknowledgement. It never overwrites a different observation or replays the
original archive. Its output remains `prepared-not-consumed` and explicitly not
an authority receipt. Provider metrics remain estimates; actual monetary charges
are unknown.

## Required next integration (not implemented in this change)

1. Capture the actual original checkpoint and authority-owned entry through the
   existing private runtime. Preserve all original hashes and both journals.
2. Bind the preparation to the independently qualified recovery implementation
   and an explicit owner-authorized transition. Historical implementation B and
   the actual recovery image must be distinct identities; never relabel new code
   as B or overwrite the create-once B qualification/BASE authorization files.
3. Add an append-only, authenticated original-result consumption path. Invalid
   and exact-duplicate outputs must use their true dispositions. A unique valid
   candidate still needs the genuine independent semantic review over the exact
   retained history. An observation from this module alone is insufficient.
4. Consume the exact original operation/lease/request once, settle through the
   independent authority, and verify host/authority correspondence. Preserve the
   original failed record. Do not clear a lock, edit a journal or manufacture a
   receipt to satisfy the checks.
5. Update the completed-history verifier to understand the explicit recovery
   linkage before it is allowed to serve this history. The current PR #59 closed-B
   profile intentionally rejects the interrupted archive.
6. Only after actual attempt-4 settlement may the same ten-attempt pilot proceed.
   No replacement attempt, extra paid call or new experiment is allowed.

## Qualification

Run the full inherited `Dockerfile.qualify` in an isolated Railway service with
no credentials, database, production volume or public route. The added synthetic
regressions use the actual provider verifier and cover original-output recovery,
valid-candidate review preservation, rejected-rule duplication, changed bindings,
ambiguous writes, pagination/inference, terminal instability, caller mutation,
read failure and create-once sidecar publication including lost acknowledgement.
No local candidate execution is required or permitted by this work order.

Passing these tests qualifies this preparation code only. It does not prove that
production attempt 4 has been recovered, that its output is invalid, or that the
pilot is complete.
