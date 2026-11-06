# Base44 hosted fetch compatibility

This is a separate source delta over the independently accepted Learning observer,
hosted Review adapter and completed-Learning public packets. Their frozen snapshots
remain unchanged. It alters the three hosted editor adapters, their regressions and
installation documentation. Portable backends, contracts, owner and token ordering,
the frozen experiment, journals, gateway, source proof and database behavior are
unchanged. The combined tree needs fresh review and qualification before use.

## Concrete runtime evidence

The actual Learning owner invocation at 2026-11-06 04:57:36.668Z returned 503 after
all four secret-presence observations and `FETCH_BEGIN`, followed by the bounded
`unsupported-option` classification. That classification alone did not identify an
option. Read-only Base44 builder inspection then identified `@base44/vite-plugin`
1.0.52 and its workerd/Cloudflare compatibility modules.

[Cloudflare's official Request reference](https://developers.cloudflare.com/workers/runtime-apis/request/),
updated November 2, 2026, documents that `redirect: 'error'` is unsupported and
throws during request construction, including inside fetch. It prescribes manual
mode and response-status inspection. The same page and the official
[Fetch reference](https://developers.cloudflare.com/workers/runtime-apis/fetch/)
support `cache: 'no-store'`; request cancellation remains supported. This evidence
supports a redirect-only change. No cache, timeout or header workaround is included.

## Exact transport policy

All three hosted adapters implement the same bounded policy:

1. Require the portable backend's explicit `init.redirect === 'error'`. Missing,
   `follow`, `manual` or any unexpected policy fails before fetch. No default is used.
2. Create one fresh options object by spreading that init and overriding only
   `redirect` with `manual`. Do not mutate the caller's init. Preserve the exact
   input and every unrelated option value/reference, including headers, body,
   cache and AbortSignal.
3. Invoke direct `fetch(input, options)` once inside the function invocation.
4. Read only response status and `redirected`. Reject every 300–399 response,
   including one without a Location header, and every already-redirected response.
   Neither its headers nor its body is read or exposed to the portable backend.
5. Otherwise return the original response. Original transport errors propagate
   unchanged; locally rejected policy/redirect errors have fixed, nonprivate text.

There is no redirect following, target selection, second fetch, fallback or retry.
The existing Learning observer keeps only its six fixed events, four known binding
names, presence boolean, bounded HTTP status and error-kind enum. A local redirect
policy rejection is reported with the existing `other` kind; no new log fields or
public diagnostics are introduced. Review and completed history add no logs.

The original backend responses remain fixed. A failed Review start can have been
accepted upstream before a transport failure, so its public error remains
`dispatch_uncertain`. Failed submit acknowledgement remains subject to the existing
durable-key/history recovery. The adapter never repeats either POST and cannot
clear server custody or the unresolved-job constraint.

## Installation identity and bounded editor normalization

The exact machine-readable mapping is
`integrations/base44/editor/HOSTED_INSTALLATION_MANIFEST.json`. It pins nine server
files by repository bytes/hash and by both permitted hosted bytes/hashes. No entry
authorizes deployment or supplies a credential. The three adapter destinations are:

| Repository function | Hosted editor path | Shared backend |
| --- | --- | --- |
| `gatekeeperLearningStatus` | `base44/functions/gatekeeperLearningStatus/entry.ts` | `base44/shared/learningStatusBackend.ts` |
| `gatekeeperReview` | `base44/functions/gatekeeperReview/entry.ts` | `base44/shared/reviewBackend.ts` |
| `gatekeeperLearningHistory` | `base44/functions/gatekeeperLearningHistory/entry.ts` | `base44/shared/learningHistoryBackend.ts` |

The Learning layout is observed. Review and completed history are explicit planned
new mappings using the same shared directory. The manifest also lists all shared
contract imports, including the unchanged original Learning contract. The editor
entry imports use `../../shared/<camelCase>.ts`; server modules stay outside the
frontend bundle. Frontend component installation is a separate existing task.

Apply only each exact quoted import replacement listed in the manifest, once.
After that, either preserve every byte or omit exactly one final LF byte (`0x0A`).
The latter accommodates the observed permitted editor write interface. It is not
general whitespace normalization: no trim, CRLF conversion, formatting, extra blank
line removal, import rewriting beyond the list, or character change is accepted.

Use permitted editor writes and read back each installed file. Record path, chosen
variant, byte count and SHA256; accept only the manifest's exact pair for that path.
A mismatch is a source-integrity failure requiring inspection and a new reviewed
delta if necessary. Do not use shell access or another prohibited interface to
bypass an editor write restriction. The manifest records the old observed Learning
entry hashes solely as a baseline; those bytes retain the unsupported mode and are
not the new compatibility payload.

## Regression and release gates

Existing actual-adapter tests now expect one fresh options object whose only changed
field is redirect. `tests/base44-hosted-fetch-compat.test.mjs` adds all-three-adapter
coverage for unexpected policies; every 300–399 status; already-redirected responses;
unread redirect headers/body; exact input/header/body/signal preservation; original
error identity; owner/method/body denial; fixed success payloads; uncertain Review
start/submit behavior; and precise installed-source identity. It also uses two real
loopback HTTP servers to verify 301/302/303/307/308 never send a request or capability
to the destination. All credentials, commands and projected history in tests are
synthetic; no provider or hosted account is used.

The installation regression checks all nine repository/import-adapted hashes, both
permitted LF variants and rejection of extra whitespace, CRLF and altered text. It
compiles and invokes each adapted entry variant against the actual portable backend
with synthetic SDK/runtime bindings.

These are authored tests, not an execution report. No candidate source, compiler,
test, package, database, model or runtime was executed locally. Independent source
review, fresh Gitar and the full isolated combined-C qualifier remain mandatory,
including the inherited suite and real PostgreSQL/Caddy gates. Node loopback tests
do not prove the hosted platform's implementation: after qualification, verify the
exact read-back installation and an authorized owner invocation in the actual
Base44 runtime. Owner/non-owner denial and the existing response/provenance checks
remain required. No further live function call is authorized by this document.
