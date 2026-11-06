# Hosted Base44 Review adapter

This packet adds the exact editor entrypoint for the observed hosted runtime. It
does not enable reviews, provision credentials, deploy an app or qualify a runtime.
The portable `Deno.serve` entrypoint remains available for its original environment.

## Exact source and installation shape

The hosted function is named `gatekeeperReview`. Its source is
`integrations/base44/editor/base44/functions/gatekeeperReview/entry.ts` and imports
`../../../../shared/review-backend.js` from that repository layout. Preserve the
corresponding shared backend and `review-contract.js` files when installing through
the editor's project tree; those server modules must not enter the frontend bundle.

This adapter uses the established hosted interfaces only:

- `createClientFromRequest` from `npm:@base44/sdk@0.8.54` and its `auth.me()` method.
- `secrets.get` from `base44:runtime`.
- A default exported function, constructing the portable bridge inside invocation.
- A direct fetch wrapper that requires the backend's `redirect: 'error'`, translates
  only that field to `manual` in a fresh options object, and rejects every 300–399
  or already-redirected response before headers/body use. It preserves the input,
  all other option references, accepted response and original fetch errors.
  Cache/abort requirements stay intact; it never follows or retries a request.

The [hosted fetch compatibility note](base44-hosted-fetch-compatibility.md) records
the runtime evidence, exact installation mappings and optional one-LF normalization.

There is no module-load secret read, SDK authentication or network operation. The
adapter adds no logs, provider capability or new endpoint.

## Asynchronous secret boundary

The portable bridge's existing `readEnv` dependency now accepts a value or promise.
This keeps the existing synchronous portable adapter compatible while allowing
the hosted `secrets.get` implementation to resolve asynchronously.

Reads stay sequential. The bridge checks the request method, authenticates the
actual user and requires an administrator identity before reading the owner
binding. Only after that binding matches the authenticated user can it read
enabled/source/token settings. A missing/invalid owner, non-owner, disabled feature
or secret-read exception cannot reach the upstream request. A thrown or rejected
secret read returns only the existing fixed `review_unavailable` 503 response.
No raw secret or runtime exception is reflected.

The four Review bindings are separate from Learning bindings:

| Binding | Purpose |
| --- | --- |
| `GATEKEEPER_REVIEW_OWNER_ID` | Exact server-authenticated configured administrator |
| `GATEKEEPER_REVIEW_ENABLED` | Explicit `enabled` opt-in |
| `GATEKEEPER_REVIEW_SOURCE_COMMIT` | Actual qualified Review serving commit C |
| `GATEKEEPER_REVIEW_TOKEN` | Dedicated Review capability, never the Learning read token |

The fixed upstream URL, app identity, owner/source headers, body/response limits,
accepted commands, result schema, no-store/redirect/timeout settings and public
error codes are unchanged. The adapter does not alter PostgreSQL claims, request
keys, lost-acknowledgement recovery or source-drift behavior. The portable bridge
still returns `dispatch_uncertain` after an ambiguous upstream start and performs
zero automatic retries.

## Qualification and hosted acceptance

`tests/base44-editor-review.test.mjs` compiles the actual TypeScript adapter in the
isolated source gate and executes it under synthetic SDK/runtime/fetch stubs. Its
tests cover per-invocation construction, exact request and wrapper propagation,
deferred owner-secret ordering, authentication/owner denial before private token
reads, all four secret rejection boundaries, ordinary async success, fixed fetch
options and ambiguous-start behavior. The existing portable contract tests remain
part of the full suite. No test uses hosted credentials or real inference.

These tests are authored source, not a report of execution. Independently review
the exact packet, obtain Gitar review and run the full isolated P6 source/real-PG/
Caddy qualification before any deployment. A later combined history/Review C tree
needs its own exact qualification; the frozen repair packet is not that receipt.

After qualification, install the exact source tree and four Review bindings through
the existing authenticated editor flow. Verify signed-out and wrong-owner denial,
disabled-feature behavior, owner `info`/history, and fixed unavailable responses
before enabling a real review. Use the explicit owner submission flow for any paid
test. A failed or ambiguous submission/start is checked through saved history;
neither this adapter nor the acceptance procedure retries an uncertain POST.

The compatibility delta addresses the documented hosted redirect-mode restriction.
It does not claim a successful hosted Review call before that has been observed.
