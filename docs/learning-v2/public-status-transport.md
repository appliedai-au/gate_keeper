# Owner-bound public learning status

The public Proxy has one scoped status route:
`/gatekeeper/learning-v3/status`. Its Caddy handle rewrites only the path to the
existing internal `/gatekeeper/learning-v2/status` handler. Method, query and
caller-supplied owner/token headers are preserved. The handler rejects queries,
unsupported methods, missing or invalid tokens, and mismatched owners before a
status read. Caddy never supplies a token on the caller's behalf.

The status handle and the ordinary reverse-proxy handle are mutually exclusive.
A denied, unavailable or broken status request cannot fall through to TrueForge.
All existing ordinary paths, including the internal v2 status URL, retain the
existing Basic Auth requirement. `/proxy-healthz` retains its existing public
health response. General Proxy credentials remain in the Proxy service.

The Base44 Learning bridge requires exactly four server bindings:

- `GATEKEEPER_LEARNING_OWNER_ID`
- `GATEKEEPER_LEARNING_EXPERIMENT_ID`
- `GATEKEEPER_LEARNING_SOURCE_COMMIT`
- `GATEKEEPER_LEARNING_READ_TOKEN`

The authenticated Base44 user must be an administrator whose server-derived ID
equals the configured owner. Browser input cannot select a source, experiment,
URL or owner. The upstream token is an independent read-only capability. The
bridge continues to enforce a fixed HTTPS origin, no redirects, a seven-second
deadline, a 16 KiB response bound, strict public projection and freshness checks.
The UI receives neither token nor owner binding. Unknown provider charges remain
unknown in the public accounting projection; there is no aggregate spend cap.

## Qualification and deployment

`Dockerfile.qualify` includes the same Caddy image family used by the existing
Proxy. The full remote source suite starts the actual checked-in startup script
and Caddyfile with synthetic credentials and disposable loopback peers. It checks
owner success, anonymous and wrong-owner refusal, preserved POST/query rejection,
no fallback on status failure, and unchanged Basic Auth on ordinary and suffix
paths. No local candidate execution or production credentials are used.

After independent review, exact-head Gitar approval and the complete isolated
Railway qualification, connect the existing Proxy service to the qualified merge
commit with `Dockerfile.status-proxy` and start command
`/bin/sh /app/scripts/learning-v2/start-status-proxy.sh`. Retain its existing
domain, upstream variables and Basic Auth variables. Pin the source commit so
later repository changes cannot silently alter the public route. A source attach
must apply the new service configuration; redeploying a prior deployment may use
that deployment's original command snapshot.

Provision the four scoped Base44 bindings through the existing Secrets UI and
install the qualified shared contract/backend into the existing Learning
function. Publish after its remote build succeeds. Verify anonymous refusal,
non-owner refusal and the configured owner's live projection before recording
the app closeout. The separate legacy runtime-readiness function retains its own
configuration and is not evidence of this learning experiment's completion.

Rollback restores the prior Proxy image/start command and prior Base44 shared
backend. It does not remove the journal or alter the learning state. Historical
source manifests remain unchanged snapshots of their earlier commits.

Primary Caddy references: [exclusive handles](https://caddyserver.com/docs/caddyfile/directives/handle),
[path-only rewrites preserve the query](https://caddyserver.com/docs/caddyfile/directives/rewrite),
and [Basic Auth](https://caddyserver.com/docs/caddyfile/directives/basic_auth).
