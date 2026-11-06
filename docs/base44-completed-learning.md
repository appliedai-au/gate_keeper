# Base44 completed Learning history v2

This is the public/UI slice of the post-pilot C profile. It is source for independent
review and isolated qualification, not evidence that the pilot has completed or
that a hosted function has been installed. This v2 public layer requires the
separate private v2 completed-history reader. The accepted private v1 reader is a
B-only profile and cannot validate the later authenticated recovery history. Public v2 alone is not a deployable
or qualified runtime. The private core owns proof of genuine calls, retained
failures, signed receipts, final heads, recovery observation linkage and owner authorization.

## Separate identities and response

`learning-history-contract.js` exports:

```js
validateLearningHistoryBinding({
  ownerId, experimentId, sourceCommit, // original frozen experiment A
  servingSourceCommit,                // actual qualified app image C
  originalExecutionSourceCommit,      // retained earlier implementation B
  finalExecutionSourceCommit,         // qualified recovery/final implementation
  closureDigest,                      // exact owner-pinned completed checkpoint
});
projectLearningHistoryResponse(value, binding, nowMs = Date.now());
projectLearningHistoryForDisplay(value, binding);
```

The public response has exactly these fields:

```text
schema: gk-learning-completed-history-response-v2
checkedAt: time of this validated read
serving: { mode: completed-history, sourceCommit: C }
archive: { experimentSourceCommit: A,
           originalExecutionSourceCommit: B,
           finalExecutionSourceCommit: finalExecutionSource,
           recovery: { kind: original-invalid-proposal-observation,
                       attempt: 4, additionalModelCalls: 0 },
           closureDigest, archivedAt: immutable closure capture time }
status: unchanged strict original A Learning status projection
```

The experiment, original execution, final execution and serving sources must be four distinct valid commits. The original status projection is still
validated by `projectLearningStatus`; its `sourceCommit` remains A. A supplied
binding pins the owner scope, experiment, all four source identities and closure.
Extra/private fields, accessors, hidden fields, invalid timestamps, the old
live-status envelope and the B-only completed-history v1 envelope are rejected.
The old `archive.executionSourceCommit` field is not a v2 alias. A v2 outer schema
with a v1 archive shape also fails. The nested original A status keeps its exact
existing schema; neither an older nor a substituted nested schema is accepted.
There is no legacy fallback or inferred final-execution value.

The recovery object has exactly its three declared fields and values. It means a
later read and consumption of the original fourth invalid result, with no new
model call for that recovery. The original implementation retains the original
fourteen-call BASE and four original proposal calls. The recovery implementation
observes the original result of the already-dispatched fourth proposal and
executes only the separately authorized remaining original attempts. This is
execution provenance, not evidence of a model improvement. Learned confirmation
counts retain their separate meaning.

The public boundary also requires ten attempted proposals and ten terminal outcome
dispositions, at least four invalid outcomes, zero provisional count, complete BASE, no pending operation/dispatch,
zero pending execution and reserved estimate, at least the original BASE plus ten
proposal dispatch closures, at most thirty-one permitted phase closures, and the
recorded source gate. These are checks on the
public projection; they do not replace the private core's signed evidence checks.
The four-invalid minimum follows the specific recovery precondition: the three genuine
earlier invalid proposals and the genuinely recovered fourth invalid proposal.
Neither a zero-call placeholder nor a reclassified unresolved failure satisfies
the required private proof.

The private v2 reader derives the recovery summary from authenticated recovery
qualification/preparation/owner authorization, the original B one-call settlement,
the original terminal host failure, and the completed mandatory observation link
and immutable local cut. It must preserve all original A/B objects and verify the
remaining genuine attempts. The C owner-pinned closure digest covers that complete
lineage and the fixed archive capture time. The public recovery summary is a
necessary bounded shape check, never an alternative proof or client input.

Duplicate, unresolved, invalid and no-coverage dispositions remain legitimate
terminal records when the private core proves their genuine executed/settled
proposal. Ten successful proposals and a learned promotion are not required.
Unknown prices remain unknown. The original `budget.complete` may remain false
when execution is closed but pricing is incomplete.

At the server boundary, `projectLearningHistoryResponse` requires `checkedAt` to be
no more than sixty seconds old or five seconds ahead of the server's supplied clock;
its default remains the server's `Date.now()`. There is no null/flag freshness bypass.
`archivedAt` must be a canonical finite ISO timestamp no later than
`checkedAt`. The private core must supply the exact `archivedAt` fixed by its
owner-pinned closure digest on every read; it must never replace it with the current
clock. Reading an old immutable archive can produce a fresh `checkedAt` without
claiming new pilot activity.

The browser uses the explicit `projectLearningHistoryForDisplay` API only on the
response from the fixed authenticated `gatekeeperLearningHistory` function. It
retains exact shape, canonical timestamp/order, all four source roles, closure and completed-state
checks, including exact matching whenever trusted bindings are supplied. It does
not compare timestamps with the device clock or establish authentication/freshness
itself. The private backend resolves the authenticated owner and trusted
pins and applies the server freshness projector before returning any data. Neither
client-selected bindings nor an arbitrary payload/source can replace that boundary.

## Historical release identities

For the installed pilot, B dispatched the fourteen BASE calls and first four
proposal calls. D is a separately qualified predecessor release; successor E
performed the zero-new-call consumption of the fourth result and the remaining
six proposal calls. The private core verifies E's exact signed v2 source facts,
including the one bounded D predecessor anchored in B. Its v1 source-facts branch
also accepts the original direct B-to-D qualification protocol. The public
contract names the final execution role and its actual commit, so either
qualified lineage keeps the original B meaning without exposing private proof
objects or hardcoding a predecessor as the final implementation.

## Hosted bridge and bindings

The new function name is **`gatekeeperLearningHistory`**. The editor source is
`integrations/base44/editor/base44/functions/gatekeeperLearningHistory/entry.ts`.
It uses SDK 0.8.54, `secrets.get` from `base44:runtime`, a default export, a factory
created inside invocation, and direct fetch with the hosted redirect compatibility
policy. The adapter requires `redirect: 'error'`, translates only that field to
`manual` in a fresh options object, and rejects every 300–399 or already-redirected
response before headers/body use. Input and all other option references are
unchanged. This v2 slice leaves all three hosted adapters byte-identical and changes
the history backend's explicit source binding fields, final-execution secret read
and separate bounded upstream deadline.
The original live Learning and ordinary Review backends are also unchanged. Use the exact
[installation manifest and normalization contract](base44-hosted-fetch-compatibility.md).

The four original Learning bindings and the existing C/B/closure bindings keep
their meaning. V2 adds only the final-execution binding, for eight total:

| Binding | Required meaning |
| --- | --- |
| `GATEKEEPER_LEARNING_OWNER_ID` | Original configured owner, authenticated as administrator |
| `GATEKEEPER_LEARNING_EXPERIMENT_ID` | Original frozen experiment |
| `GATEKEEPER_LEARNING_SOURCE_COMMIT` | Frozen experiment source A |
| `GATEKEEPER_LEARNING_READ_TOKEN` | Existing independently scoped read capability |
| `GATEKEEPER_LEARNING_HISTORY_SOURCE_COMMIT` | Actual qualified serving image C |
| `GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT` | Original/earlier qualified execution image B; never repurpose this secret as the recovery implementation |
| `GATEKEEPER_LEARNING_FINAL_EXECUTION_SOURCE_COMMIT` | Qualified final Learning implementation, including its zero-call observation |
| `GATEKEEPER_LEARNING_CLOSURE_SHA256` | Exact accepted owner-pinned closure digest |

The bridge authenticates the actual user, requires administrator role, then awaits
and matches the configured owner before reading any other binding. It validates an
empty POST body and rejects query parameters before reading the read token or
provenance pins. Client input cannot select an owner, mode, source, archive or URL.

The upstream request is a GET to the existing fixed URL:
`https://proxy-production-9553.up.railway.app/gatekeeper/learning-v3/status`.
It retains the existing owner/token headers, no-store, redirect denial,
content-type/UTF-8 checks and sixteen-KiB response ceiling. The incoming empty
JSON body has a separate seven-second deadline. One sixty-second deadline covers
the upstream fetch and complete upstream body; receiving headers does not reset
it. This budget permits the complete retained-history validation while remaining
bounded. Only a valid
200, unredirected completed-history response reaches the UI. Authentication failures
are fixed 401/403 replies, request-shape failures are fixed 400 replies, and missing
pins (including final execution), secret/fetch errors or invalid provenance return only
`learning_history_unavailable` with 503. No raw errors, values or upstream bodies
are logged or reflected. There are no automatic retries.

The fixed gateway URL must be switched to the separately qualified completed-history
v2 handler only after the original experiment is genuinely closed under its
retained original and recovery evidence and its capsule/closure/owner attestation have
been accepted. The bridge does not make that transition itself. It cannot serve
v1 data while a private v2 profile is unavailable.

## UI and navigation

`GateKeeperLearningHistory.jsx` is an owner-only read view using the existing
Learning CSS. The C page's Learning navigation selects this new component and exact
new function. It accepts no alternate function name. The existing live-status
component remains available in source for the earlier B serving profile.

The view shows **Completed pilot** only after the completed response validates. It
shows terminal outcomes, the original complete baseline, closed execution,
recorded prices and explicit experiment/original execution/final execution/serving/checkpoint identities. Capture time and last-read
time are displayed separately. It states that archived rules are not applied to
ordinary private reviews and provides no execution, promotion or repair action.
Earlier execution and later recovery/final execution have separate role labels.
The final label is neutral so a qualified successor is never misnamed as its predecessor.
The recovery summary shows original attempt four and zero additional recovery
calls. It states that the original model call is counted once and that unknown
prices remain unknown; zero new recovery calls is not a zero-price claim.

Every refresh clears the prior snapshot before requesting a new read. The view has
a bounded seventy-five-second wait, including the server budget and transport
overhead; expired, superseded and unmounted responses cannot
restore old data. Invalid replies, server freshness refusals, unauthorized replies
and unavailable replies show no counts or substituted demo history. A manual
refresh repeats only the read function.

## Source qualification and integration

The new contract/backend/hosted-adapter tests cover exact source and closure pins,
four distinct source identities, exact recovery kind/attempt/call count, the
four-invalid lower bound, public closure invariants, genuine negative-outcome shapes, unknown pricing,
timestamp bounds, no legacy fallback, private-field/accessor rejection, owner-first
binding reads, fixed fetch options, body limits, secret/transport failures and the
actual compiled hosted entrypoint. Separate actual-JSX tests cover provenance,
truthful completed labels, unavailable/unauthorized states, server freshness
refusals, partial/legacy replies, clearing on refresh, late acknowledgements and
unmount behavior. Device-clock regressions show the actual JSX and actual contracts
render the same server-verified response with slow and fast browser clocks. Backend regressions retain the exact future/age acceptance boundaries
and reject the same out-of-window payload that is structurally valid for display.
Deadline regressions keep a pending fetch alive at seven and twenty seconds,
accept a valid response just before sixty seconds, reject fetch/body stalls at
sixty seconds without resetting the timer, and retain the seven-second incoming
body limit. Actual-JSX timer regressions keep the UI loading through sixty
seconds, then reject a late acknowledgement at its exact seventy-five-second
boundary. The existing superseded-response and unmount protections remain.

The private reader reuses one deeply frozen verified snapshot per journal only
within a single request. Every request still validates each full on-disk chain,
all signatures and linkage, and performs real final journal rereads plus complete
before/after byte inventories. There is no cross-request cache. Qualification
must measure the actual C route and the complete hosted invocation against these
deadlines on the retained archive. A longer timeout or synthetic passing test is
not evidence that the deployed path meets the budget.

Fixtures are explicitly synthetic public projections, never production evidence.

No candidate code was executed during authoring. This exact slice must receive
independent source review, then be integrated with the independently reviewed
private C v2 core and the qualified recovery evidence protocol. The resulting exact combined C source
requires fresh Gitar review and the full isolated P6 qualifier, including the real
PostgreSQL/Caddy gates. A source review or test fixture is not a closure receipt.

Only the history contract and history backend installation entries change. The
manifest pins each exact repository file, its listed quoted import adaptations,
and both permitted final-LF variants. All nine mappings/eighteen variants remain
subject to byte and whole-file SHA256 verification. No extra normalization,
redirect behavior, retry, logging field or runtime workaround is introduced.

After all gates, install the exact editor/shared source and the eight bindings,
then verify owner success, signed-out/non-owner denial, wrong serving/original execution/final execution/closure refusal,
v1/hybrid-envelope refusal and fresh-read/immutable-archive timestamps against the actual
accepted private v2 closure. Keep all original A/B proof/config/journal bytes and
the independently accepted recovery observation evidence intact. No
current pilot counter or evidence value is authored by this public-layer packet.
