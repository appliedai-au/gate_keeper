# Base44 completed Learning history

This is the public/UI slice of the post-pilot C profile. It is source for independent
review and isolated qualification, not evidence that the pilot has completed or
that a hosted function has been installed. The private completed-history core owns
the proof of genuine calls, signed receipts, final heads and owner authorization.

## Separate identities and response

`learning-history-contract.js` exports:

```js
validateLearningHistoryBinding({
  ownerId, experimentId, sourceCommit, // original frozen experiment A
  servingSourceCommit,               // actual qualified app image C
  executionSourceCommit,             // historical qualified implementation B
  closureDigest,                     // exact owner-pinned completed checkpoint
});
projectLearningHistoryResponse(value, binding, nowMs = Date.now());
projectLearningHistoryForDisplay(value, binding);
```

The public response has exactly these fields:

```text
schema: gk-learning-completed-history-response-v1
checkedAt: time of this validated read
serving: { mode: completed-history, sourceCommit: C }
archive: { experimentSourceCommit: A, executionSourceCommit: B,
           closureDigest, archivedAt: immutable closure capture time }
status: unchanged strict original A Learning status projection
```

A, B and C must be distinct valid commits. The original status projection is still
validated by `projectLearningStatus`; its `sourceCommit` remains A. A supplied
binding pins the owner scope, experiment, A/B/C and closure. Extra/private fields,
accessors, hidden fields, invalid timestamps and the old live-status envelope are
rejected. There is no fallback to the old schema.

The public boundary also requires ten attempted proposals and ten terminal outcome
dispositions, zero provisional count, complete BASE, no pending operation/dispatch,
zero pending execution and reserved estimate, at least the original BASE plus ten
proposal dispatch closures, at most thirty-one permitted phase closures, and the
recorded source gate. These are checks on the
public projection; they do not replace the private core's signed evidence checks.

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
retains exact shape, canonical timestamp/order, A/B/C/closure and completed-state
checks, including exact matching whenever trusted bindings are supplied. It does
not compare timestamps with the device clock or establish authentication/freshness
itself. The unchanged private backend resolves the authenticated owner and trusted
pins and applies the server freshness projector before returning any data. Neither
client-selected bindings nor an arbitrary payload/source can replace that boundary.

## Hosted bridge and bindings

The new function name is **`gatekeeperLearningHistory`**. The editor source is
`integrations/base44/editor/base44/functions/gatekeeperLearningHistory/entry.ts`.
It uses SDK 0.8.54, `secrets.get` from `base44:runtime`, a default export, a factory
created inside invocation, and direct fetch with the hosted redirect compatibility
policy. The adapter requires `redirect: 'error'`, translates only that field to
`manual` in a fresh options object, and rejects every 300–399 or already-redirected
response before headers/body use. Input and all other option references are
unchanged; the original portable backend remains byte-identical. Use the exact
[installation manifest and normalization contract](base44-hosted-fetch-compatibility.md).

The four original Learning bindings keep their original meaning. Three additional
bindings select this exact completed history:

| Binding | Required meaning |
| --- | --- |
| `GATEKEEPER_LEARNING_OWNER_ID` | Original configured owner, authenticated as administrator |
| `GATEKEEPER_LEARNING_EXPERIMENT_ID` | Original frozen experiment |
| `GATEKEEPER_LEARNING_SOURCE_COMMIT` | Frozen experiment source A |
| `GATEKEEPER_LEARNING_READ_TOKEN` | Existing independently scoped read capability |
| `GATEKEEPER_LEARNING_HISTORY_SOURCE_COMMIT` | Actual qualified serving image C |
| `GATEKEEPER_LEARNING_EXECUTION_SOURCE_COMMIT` | Historical qualified execution image B |
| `GATEKEEPER_LEARNING_CLOSURE_SHA256` | Exact accepted owner-pinned closure digest |

The bridge authenticates the actual user, requires administrator role, then awaits
and matches the configured owner before reading any other binding. It validates an
empty POST body and rejects query parameters before reading the read token or
provenance pins. Client input cannot select an owner, mode, source, archive or URL.

The upstream request is a GET to the existing fixed URL:
`https://proxy-production-9553.up.railway.app/gatekeeper/learning-v3/status`.
It retains the existing owner/token headers, no-store, redirect denial, seven-second
timeout, content-type/UTF-8 checks and sixteen-KiB response ceiling. Only a valid
200, unredirected completed-history response reaches the UI. Authentication failures
are fixed 401/403 replies, request-shape failures are fixed 400 replies, and missing
pins, secret/fetch errors or invalid provenance return only
`learning_history_unavailable` with 503. No raw errors, values or upstream bodies
are logged or reflected. There are no automatic retries.

The fixed gateway URL must be switched to the separately qualified completed-history
handler only after the original B pilot is closed and its capsule/closure/owner
attestation have been accepted. The bridge does not make that transition itself.

## UI and navigation

`GateKeeperLearningHistory.jsx` is an owner-only read view using the existing
Learning CSS. The C page's Learning navigation selects this new component and exact
new function. It accepts no alternate function name. The existing live-status
component remains available in source for the earlier B serving profile.

The view shows **Completed pilot** only after the completed response validates. It
shows terminal outcomes, the original complete baseline, closed execution,
recorded prices and explicit A/B/C/checkpoint identities. Capture time and last-read
time are displayed separately. It states that archived rules are not applied to
ordinary private reviews and provides no execution, promotion or repair action.

Every refresh clears the prior snapshot before requesting a new read. The view has
a bounded twenty-second wait; expired, superseded and unmounted responses cannot
restore old data. Invalid replies, server freshness refusals, unauthorized replies
and unavailable replies show no counts or substituted demo history. A manual
refresh repeats only the read function.

## Source qualification and integration

The new contract/backend/hosted-adapter tests cover exact source and closure pins,
public closure invariants, genuine negative-outcome shapes, unknown pricing,
timestamp bounds, no legacy fallback, private-field/accessor rejection, owner-first
binding reads, fixed fetch options, body limits, secret/transport failures and the
actual compiled hosted entrypoint. Separate actual-JSX tests cover provenance,
truthful completed labels, unavailable/unauthorized states, server freshness
refusals, partial/legacy replies, clearing on refresh, late acknowledgements and
unmount behavior. Device-clock regressions show the actual JSX renders the same
server-verified response with slow
and fast clocks. Backend regressions retain the exact future/age acceptance boundaries
and reject the same out-of-window payload that is structurally valid for display.
Fixtures are explicitly synthetic public projections, never production evidence.

No candidate code was executed during authoring. This exact slice must receive
independent source review, then be integrated with the independently reviewed
private C core and hosted Review adapter. The resulting exact combined C source
requires fresh Gitar review and the full isolated P6 qualifier, including the real
PostgreSQL/Caddy gates. A source review or test fixture is not a closure receipt.

After those gates, install the exact editor/shared source and the seven bindings,
then verify owner success, signed-out/non-owner denial, wrong C/B/closure refusal,
old-envelope refusal and fresh-read/immutable-archive timestamps against the actual
accepted private closure. Keep all A/B proof/config/journal bytes unchanged. No
current pilot counter or evidence value is authored by this public-layer packet.
