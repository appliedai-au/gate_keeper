# Learning v2: implementation and runner contract

Status: core, concrete adapter and persistent host source implemented, awaiting
owned-runner integration and the full managed remote gate.
This document describes the committed contract; it is not a run receipt.
The [phase plan](phase-plan.md) records the rollout and outstanding owners.
The [app status source record](phase-4-app-status.md) adds a prepared read-only
interface in parallel; its route and Base44 assets are not installed or qualified.

## Source layout

| Module | Implemented responsibility |
| --- | --- |
| `scripts/learning-v2/contracts.mjs` | Frozen policy, strict JSON, structured procedures, immutable prompt identities |
| `scripts/learning-v2/controller.mjs` | Attempt accounting, signed novelty/evidence admission, provisional/confirmed states, activation and rollback |
| `scripts/learning-v2/evidence.mjs` | Independent receipt validation, exact two-pass coverage, derived scores and comparison decisions |
| `scripts/learning-v2/journal.mjs` | Private durable records, compare-and-swap writes, restart state and fail-closed writer locks |
| `scripts/learning-v2/prompts.mjs` | Allowed learner/finder projections and a small app status projection |
| `scripts/learning-v2/runtime.mjs` | Ordered admission, durable intent, managed dispatch, evidence consumption and billing settlement |
| `scripts/learning-v2/host.mjs` | Stable private composition, exact reopen checks, one-phase dispatch and explicit authenticated recovery |
| `scripts/learning-v2/dispatch-ledger.mjs` | Durable intent before gateway admission, immutable original observations, explicit receipt selection and terminal resolution |
| `scripts/learning-v2/executor.mjs` | Concrete baseline/proposal/screen/confirmation scheduler and independent receipt verification |
| `scripts/learning-v2/trueforge-turn.mjs` | Injected SDK transport with durable call intent, explicit fresh turns and complete observations |
| `scripts/learning-v2/operation-archive.mjs` | Private create-once operation/call observations, ordered stages and immutable artifacts |
| `scripts/learning-v2/legacy-renderer.mjs` | Existing two-pass prompt chain and finding-conversion/merge order |
| `scripts/learning-v2/compat/gk-bag-3091.mjs` | Byte-identical pure BAG helper from the existing control branch |
| `scripts/learning-v2/status-endpoint.mjs` | Fixed owner/experiment/source read capability with scoped token authentication; no HTTP listener or write capability |
| `integrations/base44/shared/learning-status-contract.js` | Strict bounded public status schema shared with backend and browser |
| `integrations/base44/shared/learning-status-backend.js` | Single-owner Base44 bridge to one fixed status path; sanitized errors and no credential forwarding to the browser |

The modules use Node built-ins, the existing `learning-trust.mjs` signature
verifier and a host-supplied SDK client. There is no new package, SDK upgrade,
service or CLI. The [Phase 2 adapter record](phase-2-adapter.md) details the
proposed runtime configuration changes; the [host record](phase-2-host.md)
describes the persistent composition and original-receipt recovery contract.
The current `proof/three-agent/run.mjs` is not changed by this source slice.

The prepared read endpoint accepts only `() => host.status()` after its
configured owner/experiment/source grant is authenticated. It never calls
`inspect()`, selects a directory, opens a replacement host, dispatches work or
performs recovery. The Base44 bridge separately authenticates the signed-in
administrator and checks the configured owner before using its machine
credential. Its shared read token is distinct from the broad proxy Basic
credential. Mounting, credential provisioning and actual app module packaging
remain owned integration steps, followed by the complete managed qualification.

## Host integration sequence

The existing runner owner supplies the transport capabilities, durable volume
and real receipts. Use the concrete persistent host so admission intent is
durable before contacting the gateway. The following is integration pseudocode
for that admitted runner, not a local execution instruction:

```js
const host = await initializeLearningHost({
  directory: stablePrivateExperimentDirectory,
  repositoryRoot: admittedCheckout,
  config: frozenConfiguration,
  trust: pinnedPublicTrust,
  client: admittedTrueForgeClient,
  runtime: frozenRuntimeManifest,
  caseInputs: frozenModelVisibleCases,
  authorities: { evaluation: independentEvaluator, novelty: independentReviewer },
  gateway: { admit: gatewayAdmission, settle: gatewaySettlement },
}, {
  history: reviewedHistoricalReferences,
  budgetEnvelope: signedCumulativeBudgetState,
});
await host.recordManagedGate(signedFullGateReceipt);
await host.dispatch('baseline');

const attempt = await host.beginAttempt(signedOriginalFitFeedback);
await host.dispatch('proposal', attempt.attemptId);
// The runner reads the persisted state. Only a ready proposal can be screened.
await host.dispatch('screen', attempt.attemptId);
// Only a provisional result can be confirmed.
await host.dispatch('confirmation', attempt.attemptId);
// Confirmation uses exactly three predeclared fresh pairs and leaves an
// inactive artifact. Separate operator authorization is required:
await host.activateVersion(confirmedVersionId, signedActivationApproval);
```

The caller branches on recorded states; it does not call every line blindly.
An invalid, duplicate, unresolved or uncovered proposal already consumed its
attempt. A rejected screen cannot enter confirmation. A failed confirmation
cannot be extended. Ten attempts is the experiment limit, not a target count of
successful evaluations. Subsequent processes use `openLearningHost(options)`
with the same directory, configuration and trust pins; they never initialize
replacement stores as a recovery step.

Gateway admission/settlement and independent evaluation/novelty issuers are
trusted host capabilities, never model tools. The persistent host supplies
the concrete executor and deterministic archive locations under its stable
private root. Real transports, authority custody and durable volume provisioning
remain the admitted runner's responsibility. A local process signing its own model outputs does not become
an independent evaluator or a global budget gateway.

### Admission and dispatch

`executionRequest(kind, attemptId)` produces a frozen host manifest. It includes
the experiment/configuration identity, runtime identity, policy, baseline and
incumbent identities, complete phase plan, prompt artifacts, required call
count, pinned authority identities, and the safe proposer projection when applicable. Its digest is bound
to the gateway lease and every evaluation/novelty receipt.

The host first claims the logical phase in its dispatch ledger, before invoking
gateway admission through `dispatchManagedOperation`. It retains the original
lease before controller reservation and uses a stable archive that claims each
call before SDK mutation. It has no default transport or automatic retry. A
pending intent blocks further work even when no controller lease was recorded.
The executor
receives `receiptContext.operationId` and `receiptContext.requestDigest`; the
independent issuer verifies the actual execution against that request before
including these fields in its signed receipts. Merely copying the requested
identity onto unrelated measurements is not valid verification.

The protocol requires one inference for each scheduled fresh finding/proposal
turn. The complete scheduled turn count is:

| Phase | Fresh turns |
| --- | --- |
| Baseline | Two per task/trial case |
| Proposal | One |
| Screening | Two per incumbent case, plus one candidate second pass per reviewed applicable case |
| Confirmation | Three pairs × number of distinct arms × two passes × cases |

Confirmation has two arms while BASE is the incumbent, and three when a
separately confirmed incumbent requires a fresh original-BASE control. The
three-arm orders alternate `base/incumbent/candidate`,
`candidate/incumbent/base`, `base/incumbent/candidate`.

The lease must reserve the complete exact call count, with sufficient money
inside the cumulative programme ceiling. The gateway must enforce the global
limit across all jobs and reject the same logical phase across processes or
volumes. The adapter's one-main-loop limit and observed-event checks cannot
attest provider-internal calls or billing. The gateway must independently
enforce the actual inference count and reconcile any additional or ambiguous
usage; local state alone cannot enforce that property.

### Model-visible projections

The host execution manifest contains scheduling and evaluation metadata. Do not
pass that entire object to a model. The proposer receives only its `learner`
projection: fixed baseline instructions, confirmed procedures and independently
attributed original fit examples. `beginAttempt(feedbackEnvelope)` validates
and freezes those examples before the request is hashed and admitted. Check
cases and cases marked `learnerVisible: false` are excluded. Mark the existing
Go ZIP quarantine in the frozen manifest. Raw code and fit feedback may be
supplied only from the approved development population.

Finder calls use the frozen first-pass prompt and the per-case second-pass
projection from `reviewerInstructions`. A rule's signed `coverageCaseIds`
controls applicability within this frozen experiment. Two cases sharing a
fault label may still have different stack/language applicability. Unknown
cases receive no learned rule until the integration establishes an authorized
code-based applicability decision; this case map is not a production classifier.

Only the current candidate is exposed during its own authorized evaluation.
Historical negative and unproven rules, outcomes, scores, comparison reasons
and diagnostics remain host-side. Confirmed but inactive versions also stay
out of normal learner/reviewer carry.

## Frozen configuration and digest definitions

`configuration()` accepts exactly these fields:

| Field | Meaning |
| --- | --- |
| `experimentId` | Stable identifier, at most 48 characters; generated namespaces preserve it exactly |
| `sourceCommit` | Exact 40-character Git commit identity of the admitted source |
| `benchmarkDigest`, `scorerDigest` | SHA-256 of the frozen development manifest and independent scorer artifact |
| `model` | Fixed TrueFoundry-routed model identity |
| `scope` | One fixed fault focus |
| `baseInstructions` | Frozen original reviewer instructions |
| `firstPassInstructionsDigest` | SHA-256 of the frozen original BASE instruction bytes, before case-specific BAG preparation; complete prepared requests have per-call input digests |
| `runtimeDigest` | SHA-256 of the canonical runtime manifest described below |
| `gatePolicy` | Expected managed target/preset/output/effective-tree identities |
| `cases` | Two to 128 task/trial cases, each with caseId, fit/check split, fault scope, expected bug count, two passes and learner visibility |
| `budgetId` | Existing global programme budget identity, never a new v2 allowance |

Task/trial IDs must identify individual merged-score units. A case's two passes
are merged and scored once by the independent scorer. Do not duplicate a bug's
credit across passes. The manifest contains both fit and check coverage and
cannot admit a `holdout` split. No tranche-7 data belongs in this manifest.

The host owns and retains these digest preimages with the private qualification
packet. This core checks exact identity, not the truth of an opaque digest:

- **Runtime manifest and environment evidence:** the concrete client manifest
  and exact canonical preimage are specified in the adapter record. It binds
  server/SDK version selection, model parameters, explicit runtime flags,
  session policy, renderer/BAG and case-input identity. Separately retain the
  actual admitted build, provider route, effective capabilities/context and
  memory-policy evidence; declared fields alone do not prove deployed values.
  BASE/scorer/benchmark and the complete source are separately bound in the
  configuration. The independent verifier checks the whole effective request.
- **Preset digest:** the reviewed entire managed gate definition, including
  literal commands, versions, mandatory stages, protected policy/base identity,
  discovery rules, cleanup requirements, and conditional Python fixture gates.
  A reduced test command is a different preset.
- **Output-profile digest:** the reviewed receipt/log schema and completion,
  discovery, policy, effective-tree, cleanup and evidence requirements.
- **Effective-tree digest:** SHA-256 of canonical JSON
  `{schema: 'gk-effective-tree-v1', files: [...]}`, with entries sorted by exact
  repository-relative path, each `{path, mode, sha256}`. Hash exact file bytes;
  represent a tracked symlink by its target bytes and Git mode. Reject unknown
  modes and duplicate paths. Include the complete admitted product/source tree,
  not just the new v2 files. Git's native 40-character tree ID is a different
  identity and must not be substituted for this SHA-256 manifest digest.

`digest(value)` is SHA-256 over the strict recursively key-sorted JSON emitted
by `canonical(value)`. Array order is retained. Unsupported values, unsafe keys,
accessors, hidden properties, cycles and exotic objects are refused.
`configDigest` hashes `{config, policy, trustPins, history}`. `trustPins` includes
the four role fingerprints and the approved gateway ID. Normalized historical
references are included so a restart cannot silently substitute different memory.

`promptDigest` identifies the canonical prompt artifact: frozen baseline plus
ordered procedures and their reviewed applicability maps. A call's
`inputDigest` instead binds the exact client model/input/configuration object
described in the adapter record. Independent verification must also establish
any server-added context or capabilities. `outputDigest` hashes the exact UTF-8
text selected or concatenated from the final main-thread message, excluding
response JSON and event envelopes. Scheduling IDs
must not be mistaken for request content. The verifier must retain enough raw
evidence to recompute both and to prove the source/provider turn identities.

## Receipt contracts

Four pinned host trust roles are used: `evaluation`, `novelty`, `budget` and
`activation`. Each supplies a public PEM key and SHA-256 fingerprint of its DER
SPKI representation; budget additionally pins the approved `gatewayId`. No
private key is supplied to this module or obtained from model input.

Envelopes are `{body, signature}`. The existing verifier checks Ed25519-style
64-byte signatures over the exact UTF-8 `JSON.stringify(body)` bytes. Preserve
that serialization when signing; canonical digest serialization and signature
serialization are deliberately separate contracts. The evaluator's `bodyDigest`
uses the same exact serialized body bytes. Use externally held signing
authority; the regression suite's generated keys are synthetic fixtures only.

| Schema | Issuer and required binding |
| --- | --- |
| `gk-learning-v2-budget-state` | Budget authority: experiment/config/source, global budget and gateway, cumulative spent/reserved amounts, fixed US$20 ceiling and short validity window |
| `gk-learning-v2-managed-gate` | Trusted independent qualification receipt: exact config/source and gatePolicy, actual run and log digest, passed full suite, current base, no skipped checks, completed cleanup |
| `gk-learning-v2-operation-lease` | Budget authority: exact operation, namespace, request digest, source/config/model/provider, gate receipt digest, exclusive namespace, provider-enforced global reservation, exact complete call count and expiry |
| `gk-learning-v2-novelty` | Host reviewer: operation/request, attempt, candidate, incumbent, original BASE, full prior-history digest, procedure-policy version, code-scope attestation and explicit comparisons |
| `gk-learning-v2-evaluation` | Independent evaluator: operation/request, source/model/benchmark/scorer/prompt, phase/namespace/pair/order/applicability, complete case/pass evidence |
| `gk-learning-v2-fit-feedback` | Independent evaluator: original baseline receipt, original-fit-only origin and unique approved visible fit examples |
| `gk-learning-v2-operation-settlement` | Budget authority: operation/lease/global budget, actual calls and cost, cumulative spent/reserved totals and settled status |
| `gk-learning-v2-operation-not-admitted` | Budget authority: exact pending operation/request/source/config/global gateway, no reservation, zero calls/cost and explicit non-admission; the host consumes that logical phase |
| `gk-learning-v2-activation` | Operator authority: exact confirmed version/evidence, expected incumbent, original BASE, action and experiment-only purpose within a short validity window |

The controller and host source give the exact non-evaluation field checks; the closed
evaluation schema is defined in `evidence.mjs`. Novelty compares every retained
reference using `distinct`, `equivalent` or `uncertain`, with actual prior IDs
and reasons. A normalized exact match blocks automatically. A reviewed
equivalent blocks even with different words. Uncertainty stays unscored.
At least one reviewed applicable learner-visible fit case is required.

An evaluation receipt contains one merged caught/false-alarm score per frozen
case and exactly two complete pass records. Each pass names its call, session,
turn, input/output digests, status, finish reason, parse status, truncation,
tool-call count and reuse origin. Zero findings is valid; missing/empty raw
text is not. The adapter must verify actual provider termination and parsing,
not manufacture `finishReason: 'stop'` for a failed or truncated response.

For screening, the candidate must reuse the exact current incumbent's first
pass and every nonapplicable second pass. Call/session/turn identities, raw
request/output digests and named receipt origin must match. A cache miss does
not authorize a fresh fallback. Every applicable second pass is fresh.
Baseline and confirmation refuse any reuse. All fresh call IDs and provider
session/turn pairs are checked against the persisted experiment history.

## State, billing and recovery

Money uses integer micro-US-dollars: `20_000_000` is US$20. The initial signed
budget receipt must include all prior programme spend and outstanding
reservations. There is no reset to zero when v2 starts, no per-worker allowance,
and no automatic release on timeout.

An operation is admitted once per `(kind, attemptId)`; changing its caller ID
does not create another chance. Evidence is consumed once. The core requires
recorded evidence or explicit `abandonOperation` before accepting settlement.
For a completed evaluation, the settled actual call count must equal the
verified fresh-call count and the admitted count. Incomplete phases may settle
fewer calls, but never fewer than already verified fresh calls. Actual calls,
actual cost and the settlement identity remain in the journal. A contradiction
keeps the reservation unresolved and blocks new work/activation.

The host's separate dispatch ledger also covers the interval before controller
reservation. An admission request whose response is lost remains pending and
blocks another attempt or phase. `recover` imports original gateway receipts;
it never calls admission, settlement or the SDK itself. If no controller lease
was recorded, historical admission alone preserves the hold. Historical
admission plus final settlement can atomically create an already-consumed,
already-settled `reconciliationOnly` record. Its original expiry may have
elapsed, but this accounting path never issues execution authority or accepts
learning evidence. A separately authenticated non-admission consumes the
logical phase, including when no call occurred. Missing responses prove
neither non-admission nor zero cost.

Baseline non-admission additionally uses the authenticated controller transition
`recordBaselineNotAdmitted(operation, envelope)`. It records the exact receipt
marker and a terminal baseline error before the dispatch ledger completes,
without changing global budget totals or creating a lease/settlement. An
interruption between those stores remains pending until explicit resubmission
of the same original receipt completes the ledger. Lower-level baseline request
generation also refuses a recorded baseline failure. See the
[baseline recovery closeout](phase-2-baseline-recovery.md).

If execution is ambiguous, preserve the operation and reconcile with the
existing runner/gateway owner. `abandonOperation(id, reason)` can mark an
unconsumed phase unresolved without releasing money. It does not cancel a
remote call, prove that no call happened, or authorize a retry. Gateway
reconciliation remains necessary. A failed baseline requires a separately
authorized new experiment; it cannot be rerun into a convenient control.

`abandonAttempt` refuses while any unconsumed operation belongs to that
attempt. Abandon the operation first, retaining its lease and observed usage
for authentic settlement. This ordering prevents an unresolved phase from
becoming impossible to settle after its attempt has already been closed.

FileJournal uses a private, owner-controlled POSIX directory outside the source
repository, mode 0700, with 0600 files. It requires local exclusive-create,
hard-link and directory-fsync semantics. Persist the volume across restarts.
It is a bounded single-writer store with synchronous I/O, not a distributed
database. Controller records contain cumulative state snapshots; dispatch-ledger
and operation-archive records contain individual event deltas. They use the same 32 MiB
per-record ceiling; provision storage for the full retained journal plus a
publication temporary.
No automatic compaction or history deletion is implemented.

Reopened host stores and archive inspection use `create: false`. Missing stores
are refused instead of recreated; missing archived evidence required by recorded
execution also blocks reopening. An admission-only reconciliation can have no
call archive without implying no remote usage. Only the specific missing
journal-directory condition has `JOURNAL_DIRECTORY_MISSING`; missing records,
corruption and unsafe paths remain errors.

The journal checks a SHA-256 chain, contiguous sequence and durable head
checkpoint. A stale revision, extra file, interrupted publication, unexpected
lock, symlink, corruption or missing tail refuses progress. Investigate stale
locks and pending files explicitly; neither age nor process ID authorizes
deletion. An external trusted checkpoint is needed to detect replacement of
the entire directory with an older internally consistent snapshot. The local
hash chain is not authentication against a malicious process with the same UID.

The private evaluator/runner retains original signed receipts, raw outputs,
scoring artifacts and gateway logs. The controller journal keeps normalized
evidence, receipt/body digests and lineage. The separate operation archive now
retains call intents and raw observations, including original serialized signed
envelopes as strings; neither replaces independently held evidence.
The dispatch ledger retains the original gateway envelopes, including unusable
observations. Explicit recovery may select an earlier retained receipt through
an append-only reference event; it never overwrites receipt bytes or rewrites
history. The host authenticates the selected evidence before resolving billing.

## Activation and existing data

Confirmation creates an immutable inactive version carrying its parent and
evidence digest. `activateVersion` verifies a separate short-lived operator
authorization and the expected current parent. Rollback selects the frozen BASE
or a previously active confirmed version while preserving history. Both actions
only change the experimental incumbent. Deployment/publication remains the
existing reviewed application boundary.

Historical records import as `rejected`, `unproven` or `legacy-positive`
references, each with its original source reference. None becomes confirmed
or model-visible merely by import. Exact repeated procedures are blocked.
Requalifying a legacy positive needs a separately designed explicit path in
Phase 2; this first slice intentionally provides no silent override.

## Qualification handoff

New tests are in `tests/learning-v2-*.test.mjs`, which the existing
`test:learning-policy` wildcard discovers. Their fake signatures, counts and
model identities are fixtures, not production evidence. No test or candidate
parser/import/build/install has been run locally for this change.

The native-gate owner must run the full registered Gate Keeper recipe against
the final source identity: frozen install, decoded-log canary, typecheck,
scorer self-test, complete Node test suite, and all normal dependency/security,
policy/base/product/effective-tree and cleanup gates. If integrating the pending
Python contrast fixtures, retain the separately specified explicit interpreter,
test-identity and discovery-count gates. Do not substitute a reduced command,
the paid evaluation service, or a successful receipt from another source.

Connecting the persistent host to the real managed runner, establishing signing
authority custody, gateway enforcement and durable volume custody, reconciling
existing runner repairs, and measuring baseline equivalence are Phase 2b/3 work.
The explicit runtime-capability changes need controls. The served native gate
requires an open, non-draft PR with exact head/base; explicit dispatch has the
same requirement. Registration and source integration must be ready before
advancing this draft for gate admission.

The app status endpoint/UI consumes `host.status()` only after that integration.
It includes the pending dispatch identity and locally observed stage, even
before a controller reservation exists. It must not expose `inspect()`,
`inspectOperation()`, controller `state()` or private journal contents to
ordinary app users. Observation stages do not assert remote termination.
The public `baseline` field contains only a status (`not-planned`, `planned`,
`complete` or `failed`) and fixed failure code (`null`, `not-admitted` or
`unresolved`). Raw baseline errors and private receipt markers remain private.
