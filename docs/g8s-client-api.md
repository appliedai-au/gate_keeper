# G8S client review API

9 November 2026. Implements part of #76: G8S is one application at `g8s.app`; its dashboard and external clients use the same authenticated service and durable review queue. This document describes implemented source, not an available production endpoint. Current production still uses the historical `f344f5f` image; product #73, serving transition #74 and private GitHub App commissioning remain prerequisites. Do not configure the dashboard with a guessed `api.g8s.app` URL or the old Basic-Auth proxy.

## Implemented routes

All paths below are relative to the **verified, commissioned API origin**. The product prefix is `/gatekeeper/product-v1/client-v1`.

| Method and path | Authentication | Result |
|---|---|---|
| GET `/orgs/{slug}/keys` | Current browser session | Metadata only, active keys first; at most100 records, with `hasMoreHistory` for truncated inactive history |
| POST `/orgs/{slug}/keys` | Current browser session and CSRF headers | One-time API token, metadata, `shownOnce:true` |
| DELETE `/orgs/{slug}/keys/{keyId}` | Current browser session and CSRF headers | Revocation readback; repeated revocation leaves the same revoked state |
| POST `/orgs/{slug}/reviews` | Scoped API key or current browser session | `202` with stable `runId`, `statusPath`, `duplicate`, `execution:asynchronous` |
| GET `/orgs/{slug}/reviews/{runId}` | `reviews:read` key or current browser session | Existing persisted run detail and findings, including queued/failed/held states |

The runtime composes these routes into the existing product handler only when `G8S_CLIENT_API_ENABLED=enabled`. The default adds no database dependency. Enabling it requires the additive `scripts/product/client-api-schema.sql` migration after the original product schema; missing schema refuses startup rather than performing DDL automatically. No historical schema, journal or qualification recipe is modified.

### Browser use

Use the existing Secure/HttpOnly `__Host-g8s_session` cookie, `credentials:include`, and no-store requests. JSON mutations require the exact configured frontend Origin, `Content-Type: application/json` and `X-G8S-Request: 1`. The browser sets Origin; do not spoof it. This uses the actual G8S session, not Base44's unrelated admin identity. API-key management is session-only; an API key cannot create more keys, administer accounts, or gain broader access.

The Base44 key-management controls have not been installed by this change. Wire them into the existing account/repository settings after source integration and commissioned origin readback. Display a newly issued token once with explicit copy/close controls, never in a URL, localStorage, analytics event, log, public issue or builder prompt. A lost key-creation acknowledgement requires listing/revoking the orphaned key before deliberate recreation; do not retry key issuance automatically.

### Machine use

Create a named key scoped to one organization and selected numeric GitHub repository IDs. Supported permissions: `reviews:read`, `reviews:write`; choose only the required set. Expiry is1–90days, at most20 active keys perowner. Only a SHA256 digest is stored. Disabled users, expired/revoked keys and the GitHub authorization revocation watermark deny future use. Repository disablement or installation removal also denies access. An already committed review is not falsely described as cancelled merely because its client key was revoked; the worker rechecks current user/repository/GitHub authorization before dispatch/publication.

Send `Authorization: Bearer <client-key>` without a Cookie header. Mixed credentials and duplicate security headers are rejected. Never give clients the platform TrueForge key, GitHub App private key, webhook secret or provider credentials. The owner-level HTTP limit is120requests/minute; this is a request-abuse bound, not a changed billing or spending policy. Existing monthly run allowance, concurrency, pause and provider accounting remain in force.

## Submit an exact PR revision

Required JSON body (no extra authority/model fields):

```json
{"repositoryId":"123456","prNumber":42,"headSha":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","baseSha":"bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"}
```

These are illustrative values, not a real submission. The server resolves the linked repository and installation, verifies current GitHub permission, obtains the current PR and refuses changed head/base SHAs. It does not accept caller-supplied source code, a remote fetch URL, model/provider configuration or another user's ID.

An `Idempotency-Key` of16–128 ASCII letters/numbers/underscore/dot/colon/hyphen is mandatory. Reuse the **same key and body** when reconciling an uncertain response. The same identity returns the same run; a different body under it returns409. A different key intentionally represents a new requested review and may consume another run allowance. Do not generate a fresh key automatically on timeout.

```sh
# Set API_ORIGIN to the verified commissioned origin. G8S_API_KEY comes from
# your secret manager; never paste it into a shared command/history or log.
# request.json contains the four exact fields above using real GitHub IDs/SHAs.
curl --fail-with-body --silent --show-error \
  "$API_ORIGIN/gatekeeper/product-v1/client-v1/orgs/$G8S_ORG/reviews" \
  -H "Authorization: Bearer $G8S_API_KEY" \
  -H 'Content-Type: application/json' \
  -H "Idempotency-Key: $REQUEST_ID" \
  --data-binary @request.json
```

Successful admission returns202, not a clean review verdict. Poll its returned `statusPath` using a read-capable key; the result may remain queued while paused or allowance-limited. Failed, held, incomplete and unknown-cost states retain their actual meaning. No inference occurs in the HTTP handler.

Admission commits the request receipt and existing queue row in one PostgreSQL transaction. The existing delivery table is also the run's provenance foreign-key target; API requests receive an explicitly labeled `g8s_client_api` processed event. It is **not** presented as a signed GitHub webhook and is never offered to the webhook worker. A transaction failure rolls all records back. Duplicate races use independent database connections and one request-identity lock, not an in-memory mutex.

## Paired G8S and Gitar reviews

The intended application behavior is independent fan-out from the same PR creation/update event, not waiting for Gitar before starting G8S. The existing #73 webhook path can enqueue G8S; Gitar is requested through its actual installed service or supported manual trigger. Record real initiation/completion timestamps. Two services cannot be promised atomic simultaneous execution. A paused/rate-limited/missing Gitar result is unavailable, not an approval.

This client API adds optional explicit submission for clients, not a hidden second automatic trigger. When native GitHub webhooks already trigger G8S, do not also submit every event through an external script and accidentally request duplicate reviews. Configure one trigger owner perworkflow. Matching/deduplicating automatic and explicitly requested runs across both products is a separate orchestration change.

A pair must bind the same repository, PR, base/head and review scope. Keep each initial review independent of the other's output and later fixes. Collect authentic Gitar review/comment IDs and verified bot/App identity; mutable dashboard comments need versioned captures and defensible revision binding. Then compare findings, record human/code/test-backed judgments, and feed approved examples into the private learning corpus. Preserve valid G8S-only findings; do not optimize blind agreement.

**Not implemented by this patch:** Gitar dispatch or result ingestion, pair storage/normalization, comparison/feedback routes, shadow-publication control, training/evaluation jobs or learned-version activation. `comparisonAvailable:false` in the admission response deliberately makes this explicit. Existing reviews still follow the configured publication behavior; do not label them shadow runs. No training job is started by an API submission.

## Qualification and release

`Dockerfile.client-api-qualify` is a separate targeted test image using an empty loopback PostgreSQL15 cluster on55434 and independent pools. Tests cover the actual request handler and loopback HTTP, token/scope/CSRF boundaries, replay/conflict/races, rollback, key/installation/user revocation and preservation of the existing execution limits. All data and transport are synthetic; no GitHub/provider request, real credential, model inference or production mutation is needed.

A targeted test pass is not the combined product release, a security guarantee or live client acceptance. Before deployment the controller must review the exact candidate, reconcile it with #73/#75 and #74, run the complete inherited/product suites without changing their historical recipes, commission the private GitHub App settings and real API origin, apply the migration deliberately, and accept actual owner/non-owner flows. The dashboard receipt already reports installation; reconcile its current source rather than reinstalling the application. Owen publishes the accepted Base44 revision.
