# Gate Keeper learning-v2: opt-in read-only status transport

This is an **inert source-only integration component**, not a live route or
a second learning coordinator. The unchanged production TrueForge Dockerfile
does not import or start these modules.

The new `status-listener.mjs` adapts the previously reviewed, fixed-owner
`createLearningStatusEndpoint` to Node's HTTP server. It only binds
`127.0.0.1:8791` in an independently invoked opt-in process, accepts a
bodyless GET at the fixed status path, and denies missing/mismatched read token
or owner assertion before touching the journal. No write, model, gateway,
signing or activation capabilities exist in this process.

The companion `status-config.mjs` refuses startup unless the process runs
as UID 1000, `GK_V2_READONLY_STATUS=enabled` is explicitly set, and a
private regular `0600`, single-link, node-owned config exists at the fixed
path `/var/lib/gk-v2-private-journal/status-config.json`.
The file must carry the exact configured owner, experiment, source commit,
configuration digest, public signing keys with their pins, durable journal
directory and distinct read token. Its bytes must be provisioned securely;
never commit private configuration or tokens.

The reader uses `FileJournal` in read-only, create=false mode. Missing,
corrupt, mismatched or uninitialized journals produce an authenticated 503,
not a fabricated zero-activity experiment. There are **no private issuer keys**
or provider credentials here.

**Not a complete release**: this source does not select or authenticate a
Base44 editor runtime, mount the status route on the existing TrueForge
server, configure a reverse proxy, provision real trust pins, or mount the
production journal. A future independently reviewed integration must decide
how to route the loopback listener without exposing credentials or adding
another agent coordinator. There is no default listener.

No paid inference or learning activation. The US$50 lifetime ceiling includes
historical spending and outstanding holds; independent TrueFoundry funding
reconciliation and authority custody remain mandatory.
