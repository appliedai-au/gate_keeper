# Actual-C serving with immutable completed A/B history

This is a separately qualified **completed-history** profile. It lets the
ordinary authenticated review app serve from actual source C while the owner
Learning page reads the completed frozen experiment A and its authorized
continuation implementation B. It creates no Learning coordinator, admission,
model dispatch, issuer, replacement experiment or new history bank.

The presence of this source is not evidence that the real pilot has completed,
that C has been qualified or merged, or that a hosted Base44 session has passed
acceptance. All three are operational gates with their own observed evidence.

## Source and authority boundaries

| Identity | Meaning | Retained evidence |
| --- | --- | --- |
| A | Frozen experiment, policy, corpus, prompts, public role pins and original managed gate | Original production bundle, controller, operation archives and signed gate |
| B | Actual implementation independently authorized to complete the original BASE and execute the rest of that exact experiment | Original B qualification, preparation and owner authorization; append-only BASE continuation and dispatch linkage |
| C | Actual app image with ordinary reviews and a completed-history reader | New exact-C qualification receipt, create-once closure and authenticated owner closure pin |

A, B and C must be distinct. C never writes `RAILWAY_GIT_COMMIT_SHA` to B, calls
the B-bound production opener using a fake identity, substitutes a new B gate,
or treats B's authorization as permission for C to run Learning. The ordinary
review runtime still checks its own configured source against actual C.

The original Learning policy is unchanged: ten real proposal attempts, two
passes, minimum gain of one, three fresh confirmation pairs for promotion,
positive and negative retained history, and no retry of a negative proposal.
There is no aggregate spending ceiling. Unknown prices remain unknown. This
profile adds no Spekky prerequisite and does not absorb the optional issue #42
backlog into mandatory closeout.

## Closure eligibility is based on original results

The private validator requires all of the following before export/capture or
serving can succeed:

1. Exactly ten uniquely numbered original proposal attempts. Each has its own
   original admission, deterministic request, one owned SDK call, complete
   terminal output, and authentic signed settlement for exactly one call.
2. The original fourteen-call BASE, including B's mandatory continuation link,
   independently signed B proofs, retained original first result and original
   failed second call, thirteen distinct continued calls, and original
   fourteen-call evaluation and settlement. Ordinary archive finality remains
   intact. A missing continuation sidecar always holds.
3. Exact one-to-one host, dispatch and authority operation/lease/request sets.
   Every recorded call is owned and terminal; every relay has a complete 2xx
   result; every counted input/output digest and session/turn identity matches
   the retained original host output and independently read authority artifact.
4. Original Ed25519 envelopes verified with the original role pins. This covers
   the managed gate, admissions, settlements, evaluations, novelty judgments,
   activation decisions and renewals, and any retained delayed-usage receipt.
   A final counter or hash-chained state snapshot alone is insufficient.
5. Genuine negative outcomes preserved. Invalid output and exact duplicates are
   derived from the original complete proposal text and prior retained history.
   Covered uncertain/equivalent and no-coverage outcomes require the original
   signed novelty evidence. Such proposals legitimately need not have an
   evaluation-complete flag or an observed evaluation call counter.
6. Every novel covered candidate has its original screening result. A positive
   screen has exactly the three prescribed fresh confirmation pairs; all
   confirmed versions and activation transitions follow those signed results.
   An authority activation or later renewal that the host never consumed holds.
7. No pending dispatch, unconsumed operation, provisional attempt, unresolved
   provider intent, incomplete relay, undecided review, writer lock or pending
   publication. Existing original files, journal heads, namespace inventories
   and historical proof sidecars match at both ends of capture and every read.

A provider-failure/reconciliation-only attempt without a complete original
proposal result is **ineligible** for this profile even when a charge can be
accounted for. It is not turned into an invalid proposal, replaced by an
eleventh attempt, or assigned invented output. Later interrupted proposal
recovery is outside the original BASE-only continuation authorization. Any
additional recovery design needs its own source/proof review; this reader does
not create one.

Lease validity is checked at the original host admission, not at C's clock and
not at every continued BASE slot. The approved BASE continuation may finish
after the original lease window. Activation validity is checked at the actual
historical host consumption event, using the retained renewal if one was
consumed. C never renews either receipt.

## Separate actual-C qualification

`completed-history-proof.mjs` defines a new source-proof protocol. The existing
A and B verifiers are unchanged. The configured descriptor identifies an
authenticated owner comment on the C PR; the owner must be the GitHub owner
already bound by B's signed qualification, not the unrelated Base44 owner ID.

The mandatory target is `gatekeeper-completed-history-reviews-v1`. Its preset
and output-profile digests are canonical digests of the exported protocol
constants. These constants specify requirements; they do not claim an operator
has already registered a target or run it. Registration and the receipt must
come from observed qualification of the final composed source.

| Required recipe | Exact source-byte SHA256 |
| --- | --- |
| `Dockerfile.reviews-qualify` | `c4ff16a3eaca5db2d02bad81b40337a688d336472946468ee4488b7f0f0aceac` |
| `scripts/reviews/qualify.sh` | `1bac3526e9e44fead93177814c351217aff85a75bb0f709558b271c6e4584d0d` |

The recipe uses Node 24.19.0, packaged TrueForge 0.182.0, Caddy and real local
PostgreSQL 15. Privacy canary, typecheck, five scorer self-tests, the complete
source suite and mandatory real-PostgreSQL suite must all pass without skips.
Production/provider credentials are excluded. The owner receipt includes
actual deployment identity, terminal success, raw-log digest and actual
post-success cleanup observation. The older `Dockerfile.qualify` is
insufficient for this C profile.

The verifier independently retrieves the exact public source and review
evidence. The actual merge must have the exact qualified tree, exact ordered
base/head parents and current main C. It verifies a fresh exact-head Gitar
approval after the request/acknowledgement, the complete bounded native-review
inventory, and absence of an undismissed current-head changes request. Old
resolved inline findings retain their actual old `commit_id`; a separate
authenticated fixed-by pin and ancestry comparison bind the actual fix into
the final head. Their historical identity is not rewritten to the new head.

The trust boundary is explicit: the authenticated owner attests actual Railway
execution and cleanup; C retrieves and verifies the source, immutable owner
receipt and independent review evidence. C has no broad Railway credential and
does not claim to rerun qualification during startup.

The owner qualification comment begins `GK_COMPLETED_HISTORY_QUALIFICATION`
followed by one newline and exact JSON conforming to
`gk-completed-history-source-qualification-v1`. The separate descriptor schema
is `gk-completed-history-source-proof-v1`; it contains repository, actual C and
the comment ID, body SHA256, owner ID and owner login. Publish the receipt only
after its actual qualification and cleanup facts exist.

## Private authority export and host capture

The new `authority-export` control role runs the qualified C image against the
retained `/data/gk-v4-authority` custody. It uses `FileJournal` in existing-file,
read-only mode and `AuthorityLedger.read()` with inert initial state. It never
opens issuer key bytes, creates an authority, initializes a ledger, performs a
provider read, signs a receipt, appends a journal event or starts a listener.

It checks secret filenames, types, ownership, permissions and link counts by
metadata only. It reads the original public bundle/pins and journal. Named
private intent and evidence artifacts necessarily contain provider output and
prompt material; the exporter reads them to verify their canonical digest,
exact byte hash, owned identity, input/output digests and completion facts.
Only a strict field allowlist leaves the process. No raw provider bodies,
prompts, private keys, relay prefix or connection credentials are exported.
The final content-addressed artifact inventory is retained in the capsule.

The host collector reads the fixed original `production-config.json` to verify
its full frozen bundle against the authority capsule, including retained
nonprocedure bank content. That original file also contains connection/token
bytes. Only its verified bundle survives the helper; connection fields never
become a client, closure field, output, log or child environment. The separate
status token stays solely in the protected owner-status reader capability.

The capsule contains original serialized signed envelope strings, complete
closed operation/attempt sets, bounded call provenance and frozen input
digests. It distinguishes the last historical authority event time from the
actual C capture time. The whole capsule SHA256 is pinned externally; it is
not a self-referential JSON field.

### Bounded protected transfer

Authority export prints only lines prefixed
`GK_COMPLETED_HISTORY_TRANSFER ` containing `gk-completed-history-transfer-v1`
records. A transfer has one begin record, zero-based numbered 8-KiB chunks and
one end record. Both boundaries pin exact byte length, chunk count, capture ID
and SHA256. The maximum decoded capsule is 32 MiB. Missing, duplicate,
reordered, partial, mixed-capture, noncanonical or digest-mismatched transfers
are rejected before host capture.

These records are **private control-plane evidence**, not public application
output or a new HTTP upload endpoint. Use an authorized control-plane transfer
capability to stage their exact ordered JSON array at:

`/tmp/gk-completed-history-input/authority-transfer.json`

The parent directory must already be private mode 0700, owned by UID 1000;
the file must be mode 0600, UID 1000, a regular single-link file. An available
authenticated staging capability is a commissioning prerequisite. If the
platform cannot securely provide that file, hold deployment; this source does
not invent an endpoint or broaden a public bridge to transfer it.

`capture` verifies the independently observed capsule SHA, actual-C source
proof and every original host/authority fact. It rechecks the host after source
verification, then creates a new `completed-history` directory once, with
`authority-capsule.json` and `closure.json`. Each file uses exclusive creation
and file/directory fsync. Existing original A/B files are never replaced.
Partial or duplicate publication remains held; no implicit repair deletes or
overwrites it.

The closure pins the full capsule-byte SHA, all original host and continuation
journal heads, all retained file hashes, actual A/B/C identities, source-proof
descriptor digest, completion facts and fixed `archivedAt`. Its whole byte
SHA256 is also external. The following owner comment begins
`GK_COMPLETED_HISTORY_ACTIVATION` plus one newline and exact JSON:

```json
{
  "schema": "gk-completed-history-owner-activation-v1",
  "purpose": "read-only-completed-pilot",
  "experimentSourceCommit": "<actual frozen A>",
  "executionSourceCommit": "<actual authorized B>",
  "servingSourceCommit": "<actual merged C>",
  "configDigest": "<unchanged experiment config digest>",
  "closureDigest": "<SHA256 of exact closure.json bytes>",
  "authorityCapsuleSha256": "<SHA256 of exact capsule bytes>",
  "qualificationDescriptorDigest": "<canonical actual-C descriptor digest>",
  "driver": "unavailable"
}
```

Placeholders are documentation, not usable receipts. The comment must be on
the authenticated C PR, authored by the pinned GitHub owner after capture.
It publishes no private owner, operation, lease, session or turn IDs.
`activate` independently verifies it and all retained heads again, then
exclusively creates `activation.json`. This activation enables only the
read-only completed-history profile; it is unrelated to Learning promotion.

## Explicit control roles

Every role requires actual `RAILWAY_GIT_COMMIT_SHA=C` and the named
`GK_COMPLETED_HISTORY_ROLE`. No role accepts command-line source or path
overrides. No role accepts a Learning execution command or authority token.

| Role | Additional control inputs | Result |
| --- | --- | --- |
| `authority-export` | `GK_COMPLETED_HISTORY_SOURCE_PROOF_B64` | Read-only protected numbered capsule transfer; no listener |
| `capture` | Source proof above and `GK_COMPLETED_HISTORY_CAPSULE_SHA256` | New capsule/closure only; no listener |
| `activate` | Source proof above and `GK_COMPLETED_HISTORY_OWNER_PIN_B64` | New exact owner-pin activation only; no listener |
| `serve` | No import/qualification/owner-pin environment input | Read existing activation, verify closure, start actual-C app |

The Base64 source input is the exact descriptor JSON. The owner-pin input is
`{"commentId":<observed ID>,"bodySha256":"<observed exact body SHA>"}`.
Do not leave role-specific import inputs present when changing roles.

The authority export command is
`node scripts/learning-v2/completed-history-control.mjs` under the original
authority file owner's identity. Host capture, activation and serving use
`/bin/sh scripts/learning-v2/start-completed-history.sh` on the retained host
volume. Its root preflight requires the existing dedicated mount and original
files, then drops to UID/GID 1000. It refuses a fresh/empty volume and never
prepares, chowns or chmods one. The existing explicit host-bootstrap and HTTP
router opt-in flags must be `enabled`; the Learning production command is
absent. Other old `GK_` driver/authority/qualification variables are rejected.

Only the `serve` role may receive ordinary review/provider bindings. The
review gateway retains its separate source check, authenticated owner/token,
database contract and review service. The completed launcher validates source,
closure, original history and initial status before any listener or TrueForge
child. It permits exactly one fixed TrueForge child on loopback port 8790 and
removes every `GK_` and `GATEKEEPER_` control variable from that child. Actual C
is preserved. There is no Learning driver startup path in this launcher.

## Public owner status

The existing owner/token-protected GET route selects exactly this explicit
profile. It returns the original strict A status inside the new completed
envelope, with separate actual-C serving and historical-B execution fields.
`archivedAt` is the immutable closure capture time. `checkedAt` is fresh for
each successful re-read. Unknown costs do not turn into a priced zero.

Every request reopens all original host journals, proofs and inventories and
the three completed-profile files. A changed file, new writer lock, missing
sidecar or mismatched closure returns a fixed unavailable result. There is no
cached last-good success, live-provider fallback or legacy-profile fallback.

Base44 uses the separately named `gatekeeperLearningHistory` function and
explicit C/B/closure bindings, while retaining its original four A bindings.
The UI labels completed history and separates experiment, execution and
serving source. Refer to `docs/base44-completed-learning.md` and
`docs/base44-hosted-fetch-compatibility.md` for the exact hosted adapter and
owner-session acceptance. A direct upstream access matrix alone does not
prove anonymous/nonowner/owner Base44-session behavior.

## Rollout order and rollback boundary

1. Review the exact combined candidate and obtain fresh exact-head Gitar
   acceptance and mandatory remote C qualification. Candidate review and
   qualification may occur while main remains B; do not assign a future merge
   identity or publish a C receipt early.
2. Keep main and actual Learning execution at B until the real ten-attempt
   pilot, all required protected novelty decisions, settlements and any
   activation consumption are complete. Verify quiescence and disable the
   Learning driver. B's startup proof requires current main B, so merging C
   before this point can prevent a needed B restart.
3. Merge the exactly qualified C tree only after closure eligibility is
   established, verify its actual ordered parents/tree/current main, and
   publish the observed actual-C qualification descriptor/receipt.
4. Run only the qualified C read-only authority-export role against retained B
   custody. Preserve all original files, complete bounded transfer evidence
   and the observed capsule SHA. Do not run an authority constructor on C.
5. Stage the private transfer through an authenticated available control
   capability. Run host `capture`, review the concrete closure digest and
   completion evidence, publish its exact authenticated owner pin, then run
   `activate`. A changed/missing prefix holds for investigation.
6. Remove all Learning/import control inputs and serve actual C through the
   completed launcher. Install only the qualified exact hosted adapters and
   bindings. Perform actual authenticated review, restart/persistence and
   anonymous/nonowner/owner completed-Learning acceptance with observed
   results. Public ordinary reviews become operational only after P6's own
   database, authentication, one-dispatch and result acceptance gates pass.

Any unresolved attempt, source discrepancy, archive drift or unsupported
private transfer stops this composition before serving. Preserve evidence and
disable C serving/review capability while investigating. Do not overwrite A/B
files, recapture silently under the same owner pin, roll main back to bypass a
source check, start B under a forged C identity, or call an ordinary Learning
driver as a status probe. A later repair requires a concrete separately
reviewed source/proof decision. Existing task authorization still covers the
scoped operational work; this source document adds no new user-permission
requirement.

## Required validation evidence

The authored remote regressions exercise real existing host/controller/
authority code with synthetic Ed25519 and provider fixtures: original 1+13
BASE, ten actual invalid or duplicate results, and a separate novel candidate
through paired screen, all three confirmation pairs and consumed historical
renewal alongside a covered uncertain result. They reject missing/reserved
attempts, changed original outputs or signatures, pending relay/review work,
missing B sidecar, extra or reused calls, unconsumed activation, partial
transfers, changed pinned heads, hard links/symlinks/permissions, weaker source
qualification and omitted blocking reviews.

Startup/transport regressions verify no child/listener capability before
acceptance, one actual-C child, removed Learning controls, fixed owner-only
status, stale/changed evidence refusal, refusal to prepare an empty mount, and
create-once publication including partial-file holds. Public and hosted
adapter tests remain in the complete mandatory suite. These are authored
source until the exact combined image actually passes remote qualification;
neither static review nor fixture construction is a production run result.
