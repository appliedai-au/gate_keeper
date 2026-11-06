# Redacted operational diagnostics and observation startup

Owner requests: "add logging and go again" and "can you finish it". This change
adds observability to the actual status-gateway entrypoint and detached-authority
client. It also removes a duplicate status bootstrap for explicit observation-mode
commands. It does not change recovery permissions, signed evidence, either source
verification, journal custody or model requests.

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
and the explicitly selected `requested-command`. A finished preflight means only
that the status child finished. A finished gateway stage means only that gateway
startup returned with a live child. Neither means the learning pilot or the
original-result reconciliation completed. Observation routing marks the separate
status preflight `disabled`, not `finished`; that does not disable verification
inside the requested command.

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

## Proven quota failure and bounded source correction

The live E diagnostic on 6 November 2026 at 12:09:20 UTC observed HTTP403 with
GitHub core limit60, remaining0, reset1793967670. Its source location was
`proposal-observation-source.mjs:24`, the refusal of unavailable public source
evidence. Issue44 comment6684702537 retains the operational evidence. This is
not a claim that every earlier generic startup error had the same cause.

The current two-release qualification receipts require 28 GitHub reads per full
source verification. The actual parent and its separate child each independently
verify the source: 56 reads. The old entrypoint first bootstrapped `status` and
then bootstrapped the requested command, duplicating both full verifications.
That could require112 reads before preparation finished. The original public
API quota was60; repeatedly restarting the same flow could not repair it.

For the fixed set `run`, `resume-review`, `reconcile-usage`, `reconcile-operation`,
`prepare-proposal-observation` and `consume-proposal-observation`, a nonblank
observation descriptor now routes directly to ONE requested bootstrap after a
live gateway starts. The descriptor's presence is a routing hint, never proof
acceptance. The unchanged `startProductionPilot` still parses it, binds the actual
image, checks command permission and installed custody, independently verifies
all source evidence, publishes only the permitted create-once sidecars, and
launches the unchanged whitelisted child. That child independently repeats its
full source and permission checks before opening the actual driver.

Observation mode requires the original A/B commissioning and status files to
already exist. Its former status bootstrap did not publish or replace them.
The existing gateway independently validates that read-only configuration; missing
or invalid custody never becomes an empty-success status. Command authorization
and recovery remain entirely inside the actual bootstrap/core, not this routing
choice. Unknown, absent and whitespace-only descriptor hints do not provide a
new action capability. A malformed nonblank descriptor still fails in the real
bootstrap before any child; there is no fallback or command retry.

A/B commissioning, explicit `status`, `init`, and unsupported/legacy commands
retain their existing preflight path. A dead or failed gateway cannot invoke the
requested command in either path. The original environment stripping and signal
lifetime handling are retained.

This correction removes redundant work; it does not increase or evade a provider
quota. Insufficient quota must still hold. The isolated startup regression uses
an explicitly labelled60-request model to reproduce the duplication and checks
that one observation bootstrap retains both28-read verification stages. The
model is not source evidence for the actual verifier. The unchanged complete
production, source-proof and custody suites exercise those actual checks.

## Tool boundary

The earlier Railway action rejection happened before execution. Application
logs cannot observe or explain an upstream ChatGPT tool-safety decision. A later
normal action was accepted and exposed the application quota failure above.
Record actual tool outcomes separately from deployment/build/startup/application
logs. Missing diagnostic output is not proof of a particular failure: the
application may not have started, the release may not contain logging, or the
log sink/query may be incomplete. Never bypass a tool refusal with a renamed
command or another route.

## Qualification and live-release hold

Run the unchanged complete `Dockerfile.qualify` on this exact candidate in an
isolated Railway service without credentials, volumes or public routes. Tests
exercise the real diagnostic implementation, actual client and actual entrypoint
with explicit synthetic transport/process/gateway seams. The startup tests also
use the actual pure child-specification validator for malformed proof, source
drift and commissioning-seed refusal. No production call or model inference is
needed. Preserve inherited tests, privacy canary, typecheck and all scorer tests.
No Spekky gate is requested. Earlier1050-test results qualify only their earlier
exact source; this routing correction requires a fresh complete run and review.

Main and the running recovery are currently source-bound to
`30e429680f9da8ef8f5307f5fde4ef6bcfa2e70c`, with the recovery qualification already
installed. Advancing main would invalidate its live current-main check, and a new
image cannot reuse or overwrite the installed qualification. This branch must
remain unmerged and undeployed until an independently qualified lifecycle
transition supports that exact installed state, or the bound experiment reaches
its documented release boundary. Do not invent a proof, remove sidecars, widen
ancestry or force a source switch merely to enable diagnostics.

The tests and source review do not reconcile the fourth paid result or complete
the ten-attempt pilot. Track actual preparation, authorization, one-time
consumption and post-restart acceptance separately in issue44.
