# P6: private live review implementation candidate

Status: source implementation prepared, not executed locally, not independently approved,
not remotely qualified, not deployed, and not enabled in Base44. The starting source is
`a35c83ccb2e3743c4d4f3b9ae13406507dfd297a`. Rebase this patch onto the accepted R1/R2
repair source and repeat independent review and all remote gates before release.

## Delivered scope

This adds an authenticated single-file review flow to the existing Gate Keeper app
`6ae577c8f34f21f5eebe75d9` at `https://secure-authentic-gate-flow.base44.app/`.
The first release serves the configured owner administrator. It does not admit other
signups. The store still includes explicit app and authenticated owner keys in every
job lookup, admission, claim and result update, so caller-supplied identity cannot
select another account's data.

The user enters a filename, language, intended behavior and at most 1,000 lines / 32 KiB
of code, acknowledges inference, and starts one review. The server first saves a
request, then claims a single session and one root turn. The app shows saved state,
manual status checks, recent private requests and actual validated findings. The
sample walkthrough remains separately labeled. A zero-finding result is shown only
after a completed, validated model response; it is not a correctness certificate.

The existing draft control settings are not applied to this flow. The review uses a
fixed read-only runtime and the source-pinned reviewer instructions and checklist.
There is no repository fetch, execution of submitted code, repair, merge, deployment,
learning, promotion, private benchmark input or second TrueForge coordinator.

## Concrete contracts

The public transport is one newly implemented Gate Keeper route, exactly
`POST /gatekeeper/reviews-v1` on the existing proxy. This is not represented as an
existing TrueForge endpoint. Caddy preserves this route and its headers without
injecting general proxy credentials. Ordinary TrueForge paths retain Basic Auth.
The Learning read token has no review authority.

Base44 `gatekeeperReview` obtains `auth.me()` through `@base44/sdk@0.8.20`. It requires
both role `admin` and equality to the configured owner before reading its review
capability. It accepts only the declared command body. Owner, app, destination, model
and source are supplied by server configuration, never by browser JSON.

| Command | Behavior |
| --- | --- |
| `info` | Verify the review store and return the configured source binding. |
| `submit` | Save or recover the same `(app, owner, idempotency key)` request; no model call. |
| `start` | Claim a queued or session-created job and dispatch at most its missing session/turn. |
| `get` | Read the known turn/events, persist a validated terminal result, or show its saved state. |
| `list` | Return up to twenty scoped summaries without submitted code, raw prompts or upstream IDs. |

The request body cannot supply upstream IDs. All responses are bounded and marked
`private, no-store`. Browser persistence contains only opaque request/idempotency
identifiers. Findings render as escaped React text. Private code, model observations
and receipts stay in server-side storage. TrueForge session responses must report
`shared: false` and the expected inline agent before any turn is sent.

The existing TrueForge API is called only through the SDK:

1. `sessions.create({ agent: { spec }, metadata })` → `POST /api/v1/sessions`.
2. `sessions.createTurn(sessionId, { input, previousTurnId: 'none' })` →
   `POST /api/v1/sessions/{sessionId}/turns`.
3. `sessions.getTurn` and `sessions.listTurnEvents` → the documented GET routes.

API provenance is the official TrueForge v0.182.0 source at
`842e4992b8ed6d34c13b1b208d52f295ba9f3b8b`, particularly
`packages/trueforge-sdk/src/api/resources/sessions/client/Client.ts`, the session and
turn types, and `packages/trueforge/src/db/postgres/client.ts` / `config.ts`.
The repository lock has SDK 0.180.0; the same call shapes are supported by that version.
Remote qualification must record the actual SDK and server package versions installed.

All SDK calls set `maxRetries: 0` and an explicit timeout. The target is the fixed
existing loopback server `http://127.0.0.1:8790`. Redirects are denied. There is no
fallback model or generic forwarding endpoint. The model is an operator-selected
registered reference, not a browser choice. Changing its provider registry definition
requires disabling review and a new operational qualification; a string reference is
not a provider-configuration fingerprint or a reproducible benchmark claim.

## Durability and uncertain outcomes

PostgreSQL is the authority. The new, separate `gatekeeper_reviews` schema contains
private jobs and immutable stage observations. No Base44 entity mutation or unproven
compare-and-set is used. No learning tables, experiment files or journal are changed.

Admission takes a PostgreSQL transaction-level owner lock, then enforces unique
`(app_id, owner_id, idempotency_key)`. Reusing the key with different normalized input
returns 409. A partial unique index allows only one unresolved review per owner.
This includes held jobs, so a new browser key cannot bypass an uncertain request.

Every outbound write is preceded by one committed state transition plus immutable
intent containing its exact request. A session receipt must be durably saved before
the turn can be claimed. The turn receipt must be saved before it becomes pollable.
All competing claims use row locks and state predicates in PostgreSQL. Process-local
promises are used only for lifetime management, never for deduplication authority.

`queued → session_dispatch → session_created → turn_dispatch → running` is the normal
path. A queued or session-created job can be explicitly continued after a restart.
A claimed write is never leased back to queued or automatically reissued. A timeout,
lost acknowledgement, invalid receipt or persistence uncertainty holds the request.
A dispatch abandoned by a crash becomes held when checked after two minutes. A late
receipt is preserved privately and does not reopen the job.

This provides durable at-most-once application dispatch for each claimed operation.
It does not claim upstream exactly-once execution: a request can be accepted before
its acknowledgement is lost. The conservative consequence is a held request that
needs operator reconciliation. The app has no release-hold, delete-job, replay or
manual-success endpoint. Reconciliation must use actual private session/turn/provider
evidence and a separately reviewed procedure; deleting the active row or resetting
its state to force another call is not an acceptable recovery.

Polling can be repeated because it makes only upstream GET requests. Complete event
pagination, exact session/turn identity and submitted turn input, a stable terminal
re-read, matching final message content in the event history, a single main-thread model message, no tool
events/actions/refusals, `finishReason: stop`, and the existing bounded findings schema
are required for a completed result. Tool activity or hidden model iterations hold
the job. Invalid JSON or a terminal failed turn is recorded as a failed review, with
no fabricated findings. Provider metrics are shown only as estimates; absent prices
remain unknown and billing remains unsettled. This adapter adds no aggregate spend
cap or automatic spending-policy claim.

The pinned server can expose its unconditional `currentDateTime` tool even with tool
features disabled. Source configuration alone does not prove zero tool execution or
a billing bound. Unexpected activity is detected in the final event history and held.
The commissioning smoke must verify actual behavior of the selected runtime/model.

## Explicit disabled-by-default dependencies

No secret value or provider registration is created by this patch. These dependencies
are currently commissioning gaps, not completed work:

| Location | Binding / requirement |
| --- | --- |
| Base44 function | `GATEKEEPER_REVIEW_ENABLED=enabled` after acceptance. |
| Base44 and gateway | `GATEKEEPER_REVIEW_OWNER_ID` for the same actual admin owner. |
| Base44 and gateway | `GATEKEEPER_REVIEW_SOURCE_COMMIT` matching the separately qualified new deployment. |
| Base44 only | `GATEKEEPER_REVIEW_TOKEN`, a dedicated scoped capability supplied by the authorized operator. |
| Gateway only | `GATEKEEPER_REVIEW_TOKEN_SHA256`, the corresponding digest; never the Learning read token. |
| Gateway only | `GATEKEEPER_REVIEW_ENABLED=enabled` after acceptance. |
| Gateway only | `GATEKEEPER_REVIEW_MODEL`, an approved ordinary registered model reference. Frozen learning authority routes are rejected. |
| Existing gateway runtime | Existing `TRUEFORGE_API_KEY` is used only for the loopback SDK; it is never copied to Base44. |
| Existing database | Existing `DATABASE_URL` or `POSTGRES_HOST/PORT/USER/PASSWORD/DB`, preserving existing explicit TLS settings. |
| Runtime | TrueForge server package 0.182.0, plus its declared `pg` dependency. The helper refuses another server version. |
| Database | Reviewed schema v1 migration on the existing database, after the pilot is closed and release source is qualified. |

The review adapter resolves `pg` relative to the installed TrueForge server package,
so it uses a declared dependency rather than assuming npm flattened it at the app root.
No package/lock file is changed. A database URL containing query-level TLS overrides
fails closed; normalize such configuration explicitly before commissioning.
The database role must be able to create and own the separate schema during the
explicit migration. Startup only checks the version; it never runs DDL.

## Mandatory remote qualification

Nothing in this candidate has been executed locally. Follow independent source
review, Gitar and the complete isolated Railway source gate. The Gate Keeper Spekky
waiver does not waive these gates. Never point source tests at production services,
volumes, the frozen pilot, provider keys, Base44 secrets or customer submissions.

Use `Dockerfile.reviews-qualify` for the exact candidate source on the disposable
qualification service. `scripts/reviews/qualify.sh` runs, in order:

1. The inherited decoded-log redaction canary.
2. Repository typecheck and scorer selftest.
3. The complete existing `test:learning-policy` suite, including new bridge, output,
   JSX and real Caddy routing regressions.
4. A freshly initialized PostgreSQL 15 instance bound only to `127.0.0.1:55432`, with
   an isolated `gk_reviews_qualification` database, followed by
   `node --test tests/reviews-postgres.integration.mjs`.

No extra Railway database or provider binding is needed for this qualification image.
Before those gates, the qualifier prints `P6_RUNTIME_VERSIONS` with actual Node,
TrueForge, SDK and PostgreSQL driver versions and rejects unqualified versions.
The disposable PostgreSQL cluster is created inside its build container and removed
on exit. The PostgreSQL test requires the exact synthetic loopback URL and fails if
missing or different; it has no skip branch. Production/provider credential bindings
are rejected. The official `pg` dependency is resolved through the same installed
TrueForge 0.182.0 package used by the candidate runtime.

The real database suite exercises competing independent pools, duplicate and changed
input keys, owner privacy, single active slots, competing dispatch claims, reconnect
after an intent, a simulated lost COMMIT acknowledgement over an actually committed
transaction, uncertain session/turn POSTs, receipt-store failure before dispatch,
late receipts, terminal result durability and GET-only polling. Synthetic SDK peers
count calls; they cannot reach a provider. Caddy tests verify the exact route, token,
owner, app, source, no-store behavior and unchanged ordinary Basic Auth.

Qualification acceptance requires the exact-source complete log, zero failures and
zero skips for the PostgreSQL suite, installed package versions, and the final
explicit P6 qualification marker. A successful existing `Dockerfile.qualify` alone
does not qualify this P6 feature because it does not exercise the real database gate.

## Commissioning after the frozen pilot

1. Finish/reconcile the active pilot on its own qualified source and preserve its
   journal, private evidence and rollback checkpoint. Do not deploy P6 into it.
2. Rebase the candidate onto the accepted repair source, review all conflicts, obtain
   independent review/Gitar acceptance, and pass the P6 remote qualification image.
3. Plan the post-pilot gateway release/host bootstrap against the new exact source
   without rewriting the frozen experiment or its historical source binding. Verify
   the existing Learning status and ordinary TrueForge transport still work.
4. On the approved release, explicitly apply
   `node scripts/reviews/migrate.mjs --apply-reviewed-schema-v1` to the existing
   database. Confirm schema ownership, connection settings and the model reference.
5. Supply the separately authorized review capability and the matching owner/source
   bindings. A missing ordinary model route or review capability is a hard release
   blocker, never a reason to reuse the learning token, proxy password or frozen
   learning provider route.
6. In the same existing Base44 app, install `review-contract.js`, server-only
   `review-backend.js`, the editor function `gatekeeperReview.js`, the new JSX/CSS,
   and the reviewed landing-page diff. Verify hosted imports/SDK bundling. This
   patch specifies the editor function convention; no bulk CLI entity synchronization
   is needed. Do not run sparse `entities push`, `base44 deploy` or `--force`.
7. Enable only for the configured owner and run the reviewed acceptance case with
   synthetic code: unauthenticated, actual authenticated nonowner, wrong capability,
   wrong source, duplicate submit/start, one real owner review, reload/private history,
   invalid/uncertain result, and observed actual model/tool behavior. Check the saved
   job/session/turn receipts and usage estimate; do not substitute sample data.

Authenticated Base44 access is still required to install and verify this release.
The current source patch cannot establish that sign-in, deployment, provider
commissioning or a real user review has succeeded. Retain disabled bindings until
those specific acceptance checks pass.
