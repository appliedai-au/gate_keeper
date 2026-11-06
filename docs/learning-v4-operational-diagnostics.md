# Redacted operational diagnostics

Owner request: "add logging and go again". This change adds observability to the
real status-gateway startup entrypoint and detached-authority client. It neither
renames nor replays a rejected tool action, and it does not change recovery
permissions, signed evidence, source gates, journal custody or model requests.

## Events

Each new line starts `GK_OPERATION_DIAGNOSTIC ` and contains a JSON object with
schema `gk-operational-diagnostic-v1`. The fields are deliberately bounded:

- Component, stage, outcome, and optional command/method/reason are fixed enums.
- `diagnosticId` is a newly generated unrelated UUID. It is not a call, session,
  experiment or operation ID and cannot authorize or resume anything.
- Sequence, UTC timestamp and monotonic elapsed milliseconds locate progress.
- Optional HTTP status and capped response byte count describe transport only.

No request/response body, raw error/message/stack/cause, header, credential,
provider output, signing key, receipt, digest, private URL/path or identifier is
passed to the diagnostic sink. Unexpected fields are ignored. Each field is
read once before validation. Each trace emits at most 32 events. Synchronous
and asynchronous sink failures are contained and never change business control
flow. These logs are not proof of a test pass, source approval, settlement or
experiment completion.

## Interpretation

The production entrypoint logs `startup`, `preflight-status`, `gateway-start`
and, only through its unchanged permission/control path, `requested-command`.
A finished preflight means only the status child finished. A finished gateway
stage means only gateway startup returned with a live child. Neither means the
learning pilot or original-result reconciliation completed.

The authority client logs `request`, `response-read`, `response-decode`,
`response-contract` on failure, and `complete` on successful response validation.
Failures identify a static category: aborted, transport-unresolved,
authority-refused, response-invalid, response-too-large or
response-contract-invalid. The actual response status is included only when one
was received. Lost or interrupted responses retain the existing unresolved error
and are never retried by logging. Existing signed result property order is kept.

A diagnostic ID correlates stages inside a single request or entrypoint only.
No new environment variables, request headers or payload fields propagate it
across processes. Use timestamps and components to compare separate traces;
do not claim they establish private operation identity.

## Tool boundary

The recorded Railway action rejection happened before execution. Application
logs cannot observe or explain an upstream ChatGPT tool-safety decision. Record
the actual tool outcome separately from deployment/build/startup/application
logs. Missing diagnostic output is not proof of a particular failure: the
application may not have started, the release may not contain logging, or the
log sink/query may be incomplete. Do not replace a tool block with a guessed
application diagnosis or bypass it with a renamed command or another route.

## Qualification and live-release hold

Run the unchanged complete `Dockerfile.qualify` on this exact candidate in an
isolated Railway service without credentials, volumes or public routes. Tests
exercise the real diagnostic implementation, actual client, and actual entrypoint
with explicit synthetic transport/process/gateway seams. No production call or
model inference is needed. Preserve inherited tests, privacy canary, typecheck
and all scorer tests. No Spekky gate is requested.

Main and the running recovery are currently source-bound to
`30e429680f9da8ef8f5307f5fde4ef6bcfa2e70c`, with the recovery qualification already
installed. Advancing main would invalidate its live current-main check, and a new
image cannot reuse or overwrite the installed qualification. This logging branch
must remain unmerged and undeployed until an independently qualified lifecycle
transition supports that exact installed state, or the current incident is closed
and the normal product release path resumes. Do not invent a new proof, remove
sidecars, widen ancestry, or force a source switch merely to enable logging.

The tests and source review do not reconcile the fourth paid result or complete
the ten-attempt pilot. Track executed evidence and live recovery separately in
issue #44.
