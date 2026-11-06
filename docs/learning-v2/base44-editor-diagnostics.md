# Hosted Base44 Learning adapter diagnostics

This adds one editor-runtime adapter at
`integrations/base44/editor/base44/functions/gatekeeperLearningStatus/entry.ts`.
It uses `npm:@base44/sdk@0.8.54`, `secrets.get` from `base44:runtime`, and a default
export. It constructs the existing `createLearningStatusBackend` factory inside
each invocation. It does not change the portable backend, public projection,
owner/role checks, empty-body requirement, four bindings, fixed upstream route,
fetch options, seven-second deadlines, freshness limit or public error responses.

The currently observed owner checks pass, followed by a 503. Independent diagnostics
report an upstream 200 with fresh, contract-valid JSON. Those observations do not
prove the hosted function itself reached the upstream. Latency alone does not
establish that a failure happened before network egress. The adapter distinguishes
secret retrieval from the invocation and outcome of the actual hosted fetch.

## Fixed server-side observations

| Event | Additional allowed facts | Meaning |
| --- | --- | --- |
| `GK_LS_SECRET_BEGIN` | Known binding name, when recognized | The wrapper is about to invoke the runtime secret getter. |
| `GK_LS_SECRET_RESULT` | Known binding name and `nonemptyString` boolean | The getter returned. Presence does not imply valid format or correct value. |
| `GK_LS_SECRET_ERROR` | Known binding name and allowlisted error kind | The getter threw; the same error is rethrown. |
| `GK_LS_FETCH_BEGIN` | None | The wrapper is about to invoke direct `fetch(input, init)`. This is not proof of network egress. |
| `GK_LS_FETCH_RESULT` | Integer HTTP status 100–599, if available | Fetch returned a response; its body has not been read by the observer. |
| `GK_LS_FETCH_ERROR` | Allowlisted error kind | Fetch threw; the same error is rethrown. |

Error kind is one of `timeout`, `dns`, `tls`, `network`, `unsupported-option` or
`other`. It is a coarse diagnostic hint, not an asserted root cause. Classification
reads bounded hints locally and never emits them. Error getters and the logging
sink can fail without replacing the original result or error.

The only recognized binding names are `GATEKEEPER_LEARNING_OWNER_ID`,
`GATEKEEPER_LEARNING_EXPERIMENT_ID`, `GATEKEEPER_LEARNING_SOURCE_COMMIT`, and
`GATEKEEPER_LEARNING_READ_TOKEN`. Unexpected names are forwarded unchanged to the
original getter and omitted from observations. No value, URL, owner/experiment ID,
header, upstream body, error message, error object or stack trace is logged.
The adapter adds no public diagnostic endpoint or diagnostic response fields.

The fetch wrapper passes the exact input and `init` objects to direct
`fetch(input, init)`. It does not bind/capture an unbound fetch function, spread or
rebuild request options, change credentials, consume/cancel/clone the response,
redirect, retry, or extend a timeout. The original response identity is preserved.

## Reading one authenticated owner invocation

Correlate the fixed events inside the existing platform invocation log; the adapter
does not introduce a request ID. In the unchanged backend the owner binding is read
after authentication, then the other three bindings are read concurrently after
owner and request validation. Do not infer ordering between the concurrent reads.

If a secret error appears, inspect its binding name and coarse kind without printing
the secret or raw error. A returned empty/non-string value can also explain a
configuration rejection. If all secret results appear but no fetch-begin event does,
the unchanged binding/token validation may have rejected a value; a missing log
alone does not prove that branch ran. A fetch-begin event followed by fetch-error
distinguishes an attempted runtime call from successful receipt of HTTP headers.
A fetch-result 200 followed by 503 moves attention to the unchanged response body,
projection or freshness checks, or an interruption after headers; this observer
deliberately does not expose their private inputs.

## Source and release gate

This adapter, its regression file and this note are new disjoint source files. No
existing adapter/backend/contract file is changed. The regression compiles the
actual TypeScript adapter with the repository's TypeScript package and injects
synthetic SDK/runtime/backend/fetch/logging capabilities. It exercises per-invocation
factory construction, exact identity/options preservation, secret presence-only
observations, error identity/no retry, error-kind allowlisting, status bounding,
throwing error/status getters and a failed logging sink. It uses no real runtime
secret, authenticated account, upstream network or model call.

No candidate imports, parsing, tests or execution have been performed locally.
These files must join the agreed R2 packet, receive independent source review and
Gitar review, and pass the complete isolated remote source qualification before
hosted installation. Preserve the app's verified shared module layout and other
functions when installing the editor adapter. Do not substitute this file for a
different function-runtime convention without checking the hosted module imports.

After installation, use one actual authorized owner invocation and the restricted
server-side events to narrow the 503. Keep user-visible responses and all four
bindings unchanged. This adapter supplies evidence; it does not establish that
the underlying failure is repaired or that a Learning status read succeeded.
