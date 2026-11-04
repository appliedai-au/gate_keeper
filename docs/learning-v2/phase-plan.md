# Gate Keeper v2 learning engine: phased implementation

## Decision and delivery status

Build a modular v2 learning engine inside the existing `appliedai-au/gate_keeper`
repository. Keep the existing Gate Keeper app, identity, integrations, reviewer
instructions, and historical evidence. The new engine owns explicit experiment
state and evidence requirements; TrueForge remains the runtime integration
boundary. This is not a new app, repository, or collection of new services.

The owner approved this direction and requested a phase plan and implementation
on 4 November 2026. That instruction authorizes the additive source work. It
does not establish an operational runner, a passed gate, a model improvement,
or authority to deploy or merge.

The delivery now includes Phase 1 core source and the Phase 2 concrete TrueForge
adapter, persistent host, pre-admission dispatch ledger, operation archive,
compatibility renderer and regression source. Explicit recovery reconciles
historical admission and final settlement without dispatching again. It remains
**unqualified source**, with no local or remote execution claimed. The
[adapter record](phase-2-adapter.md) and [host record](phase-2-host.md) give the
implemented interfaces, explicit runtime changes and current gate dependency.
There are no schedule or accuracy forecasts in this plan.

| Phase | Current status | Next required evidence |
| --- | --- | --- |
| 0: source and ownership | Pinned for additive work | Refresh refs at integration |
| 1: isolated learning core | Source delivered in PR #43 | Full managed qualification |
| 2a: concrete adapter and operation archive | Source delivered; parent source review approved | Full managed qualification |
| 2b: persistent host, owned-runner integration and gate | Host and admission-recovery source implemented; live integration pending | Reconciled runner, real authorities/gateway, durable volume, registered target and complete exact-source receipt |
| 3: controls and ten-attempt pilot | Not started | Qualified source, BASE controls and reconciled cumulative budget |
| 4: app read model and rollout | Not started | Qualified state integration and separate activation authorization |
| 5: broader memory and skills | Deferred | Separate design and evaluation for each expansion |

## Source baseline and ownership

| Reference | Inspected identity | Use in this plan |
| --- | --- | --- |
| `main` | `20dcea65a22e680398d017191b91d04e32b4f883` | Immutable starting point for additive v2 source |
| `study/control-completion-fix` | `3091c2e8ae9e85b020e81bc62ad6520ca68e3cfb` | Preserve fresh controls and per-pass completeness requirements |
| `study/ten-cycle-concurrency-bank` | `e054d8dfc4befb586f8b28699904e8396fc30955` | Preserve host-only negative history; repair novelty and activation defects during integration |
| Common study-branch ancestor | `1a1f0e58922ff8d6ecf3e9b0f16c1925a27c255d` | Historical experiment provenance, not the new implementation |
| e054 runtime blob | `fb7fe2e1502d281fbc8ba68d7fc52d8baa046df1` | File identity for `proof/three-agent/run.mjs`; **not a commit or branch head** |

At inspection, the study branches diverged: e054 was five commits ahead and two
behind 3091. Both change `proof/three-agent/run.mjs` and
`tests/portable-rule-banks.test.mjs`. Neither isolated branch is the reconciled
runtime candidate. Keep those owners' shared files intact during the initial
additive implementation. One explicit owner must reconcile the runner and
inherited regression suites before an integrated source identity is claimed.

The existing model-evaluation owner retains the evaluation service. The existing
native-gate owner retains Spekky target registration and operation. New source
modules do not acquire either authority. Read the current refs and ownership
record again immediately before integration or publication; these recorded
identities are a baseline, not a claim that branches cannot move.

Sources: [main at the inspected commit](https://github.com/appliedai-au/gate_keeper/tree/20dcea65a22e680398d017191b91d04e32b4f883),
[control branch ref](https://api.github.com/repos/appliedai-au/gate_keeper/git/ref/heads/study/control-completion-fix),
[ten-cycle branch ref](https://api.github.com/repos/appliedai-au/gate_keeper/git/ref/heads/study/ten-cycle-concurrency-bank),
and [reviewed divergence and ownership requirements](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6620299744).

## Design boundaries

The modules live under `scripts/learning-v2/`, with regression source in the
existing `tests/` discovery path. Their responsibilities are:

| Boundary | Responsibility |
| --- | --- |
| Experiment controller | Freeze the experiment contract, reserve an attempt durably, enforce state transitions and stopping rules |
| Candidate and prompt projection | Accept one structured procedure; project only allowed fit examples and confirmed instructions to model requests |
| Novelty review | Consume authenticated host-side comparisons against durable history; retain matched prior IDs, scope, rationale, and policy identity |
| Evidence validation | Check exact task/trial/pass coverage, paired reuse, source/configuration bindings, and fresh confirmation evidence |
| Private journal | Preserve immutable history with revisions, compare-and-swap writes, and a hash chain; reject competing or stale mutations |
| Runtime admission and budget boundary | Require authenticated evidence and external authorization before runtime work; never obtain authority from a model's claim |
| Concrete TrueForge adapter | Schedule the frozen two-pass plan, retain provider observations and obtain independent receipts |
| Operation archive and compatibility renderer | Persist call intent before dispatch and preserve existing finding preparation/merge behavior |
| Persistent host and dispatch ledger | Compose stable private stores, persist intent before gateway admission and reconcile original receipts without automatic retry |
| Version activation | Produce an immutable confirmed version and require separate authorization for activation or rollback |

Implement these responsibilities as modules in the existing application. The
source now includes an injected SDK adapter; no live model call or runtime
configuration change has been applied. The explicit proposed runtime settings
are documented and require controls before qualification or attribution.

Trust roles must be pinned in host configuration. A candidate cannot appoint its
own novelty reviewer, evaluator, budget issuer, or activation authority. Signed
receipts bind the exact experiment, attempt, candidate, incumbent, original
baseline, source, policy, task/scorer, and model/configuration identities as
applicable. A signature authenticates a claim's origin and integrity; it does
not by itself prove that a measurement occurred or enforce a provider budget.
The admitted evaluator, authority custody, and gateway enforcement remain real
integration requirements.

Each external phase has one durable logical operation, identified by its kind
and attempt. Its lease and consumed evidence bind the exact operation ID and
execution-request digest. That request freezes the policy, configuration,
prompt artifacts, first-pass identity, applicability map, complete call count,
and phase plan. The proposal request includes the exact authenticated fit
projection frozen for that attempt. Settling an operation does not authorize
another operation for the same logical phase. A timeout or crash remains an
explicit reconciliation case, not an implicit retry.

Define the runtime digest from the actual admitted SDK/runtime, model,
temperature, output/token limits, tools, and memory settings. Define the pinned
gate policy from the reviewed whole command/preset, output profile, policy base,
and product/effective-tree evidence. A SHA256 tree-manifest digest must have a
documented canonical preimage; it is not interchangeable with a Git SHA1 tree
ID. The external verifier must check actual execution against these frozen
inputs before signing. Merely copying a digest from the request is insufficient.

Keep the existing TrueForge/SDK selection and package lock. The current package
declares `@truefoundry/trueforge-sdk` as `^0.180.0`; that range alone does not prove
the deployed version. Capture the actual admitted version before qualification.
An SDK, model, prompt-base, or sampling upgrade is a separate controlled change,
not part of this migration. The proposed adapter additionally disables optional
runtime capabilities and limits main-loop iterations; these declared settings
require BASE controls and are not claimed to match legacy runtime behavior.
Broad cross-session memory remains disabled for the controlled comparison.

## Required experiment contract

### Attempts and states

Use one fault focus, two finding passes, and ten attempted learning cycles.
Persist the attempt intent before invoking an external proposer. A restart or
ambiguous external result must not create a second hidden proposal or finding
run for the same intent. Preserve interrupted or unresolved work for explicit
reconciliation.

| State or disposition | Permitted consequence |
| --- | --- |
| Attempt reserved | One durable attempt identity; no candidate accepted yet |
| Invalid or unsupported proposal | Record an unscored attempt |
| Exact or reviewed-equivalent rejected procedure | Record an unscored duplicate with actual matched prior IDs and reasons |
| Novelty unresolved | Record an unscored unresolved attempt; no guessed semantic verdict |
| No fit coverage | Record an unscored attempt; no finding evaluation |
| Admitted candidate | Permit only the precisely authorized screening work |
| Screen unsuccessful | Preserve harmful or unproven evidence; keep incumbent unchanged |
| Screen successful | Create a provisional candidate; keep confirmed bank and incumbent unchanged |
| Confirmation incomplete or inconclusive | Preserve evidence and inactive candidate; do not activate |
| Confirmation qualified | Create an immutable confirmed version eligible for separate activation authorization |
| Activation authorized | Change the selected version through the admitted activation boundary |
| Rollback authorized | Select a previously eligible version; retain all intervening history |

Invalid, duplicate, unresolved, and no-coverage attempts all consume their
attempt. Report attempted, scored, duplicate, invalid, unresolved, no-coverage,
provisional, confirmed, and activated counts separately. Never add replacement
cycles to obtain ten scored candidates.

### Procedure identity and isolation

A procedure comprises trigger/data flow, inspection or reporting action,
required evidence, sufficient safety guard, and applicable scope. Different
wording, a different hash, or a writer-supplied family label does not establish
novelty. Keyword overlap may identify a comparison requiring review; it cannot
establish semantic equivalence. A materially different ABA/version check or
sufficient guard must not be rejected merely for sharing concurrency words.

Retain comparison policy versions, reviewed scope overlap, matched prior IDs,
and reasons in host-side evidence. Unknown legacy structure yields uncertainty
unless an authorized review resolves it. The learner cannot certify its own
novelty.

Negative and unproven history is strictly host-side. Do not send its text,
measurements, old feedback, classification diagnostics, or rejection reasons to
the learner or finder. Model requests receive only their explicit projection:
the frozen baseline, eligible confirmed positive instructions, approved current
fit examples where appropriate, and the current proposed procedure for its
authorized evaluation. Internal check truth, oracle labels, counterpart
variants, and held-out data are excluded from finder prompts.

Scope must be established from code and actual language/stack applicability,
not incidental context mentions. Preserve the existing Go ZIP learner
quarantine. Tranche 7 remains sealed and unused throughout this plan.

Within a frozen experiment, the authenticated novelty review names the exact
applicable case IDs, including at least one learner-eligible fit case. Bind that
map into the candidate artifact, evaluation expectations, and execution
request. It controls second-pass routing and exact off-scope reuse, including
cases with the same fault focus but a different language or stack. The case
map is host scheduling data and never part of the learner/finder messages.
Using a confirmed procedure on a new code population requires a new trusted
applicability decision; the initial map is not a production routing mechanism.

### Screening and confirmation

Screening compares the candidate with the exact confirmed incumbent on the
same task/trial population. Require net improvement of at least **+1**, no fit
or check regression, and complete required output. The historical +8 cutoff is
superseded. A valid empty finding list is complete; an error, missing response,
malformed output, or budget stop is not. A successful second pass cannot hide
an unsuccessful first pass.

For paired screening, reuse the exact incumbent first-pass request/reply
identities and content, and reuse unchanged off-scope requests/replies. Learned
instructions affect the second pass under this contract. Missing, corrupt,
mismatched, or incomplete cache evidence refuses paired qualification. Do not
silently substitute a live call and retain the paired label.

The initial v2 pilot uses the following conservative, predeclared confirmation
policy:

1. Exactly **three fresh full two-pass pairs** for each promising candidate.
2. Alternate order: incumbent/candidate, candidate/incumbent,
   incumbent/candidate.
3. Every pair must independently meet net improvement of at least +1, with no
   fit or check regression and complete task/trial/pass coverage.
4. Evaluate the candidate together with the retained confirmed bank, so
   interaction with existing rules is included.
5. There are **no extensions, replacement blocks, or optional stopping** after
   seeing results. Incomplete or inconclusive evidence stays inactive.
6. Claim each fresh namespace exclusively before external calls. Reject prior
   namespace reuse, ambiguous aliases, and evidence from another attempt or
   configuration. Preserve historical cache data.

When the confirmed incumbent differs from original BASE, each block also
includes a fresh original-BASE control, with the arm order frozen in advance.
The operation's complete call count and reservation include that additional
arm. This preserves the original comparison without adding optional blocks or
changing the predeclared candidate-versus-incumbent decision rule.

This all-three-pairs rule is the chosen v2 policy, not a claim that three pairs
provide statistical significance or generalization. Report per-task changes,
fit/check totals, caught defects, false alarms, completeness, actual cache/live
counts, costs, and the variation across pairs. Repeated trials on the same
tasks are not independent repositories. Future transfer evaluation requires
new families; this pilot does not manufacture them from repeated calls.

The original BASE remains immutable even after an incumbent changes. Every
receipt identifies both, preventing a later confirmed incumbent from silently
replacing the historical baseline.

Sources: [owner threshold and cycle policy](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6618558519),
[host-only novelty policy](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6620299744),
and [confirmation, pairing, and stopping requirements](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6620867674).

### Budget and provider

All inference goes through TrueFoundry. The **US$20 cumulative programme ceiling**
covers all participating jobs and workers; it is not a fresh allowance for v2.
An independently authorized budget boundary must account for prior spend,
outstanding reservations, actual usage, unresolved calls, and release or
settlement evidence. Do not reduce an unresolved reservation merely because a
client timed out.

The core's signed budget/admission contract is a prerequisite interface. It is
not a commissioned independent gateway or a substitute for global provider-side
enforcement. The existing owner must reconcile current accounting and runner
availability before any dispatch. Historical spend observations are preserved
as evidence, not treated as a current invoice or remaining balance.

Retain actual call and cost settlement observations per operation. Record the
execution evidence, or explicitly abandon an ambiguous operation, before
accepting settlement. Complete evaluation evidence and settled fresh-call
counts must equal the admitted count. An incomplete operation may settle fewer
calls, but never fewer than already verified fresh calls; contradictory
receipts cannot establish a complete qualified result. Pin the gateway identity
together with its trusted signing key for the lifetime of the experiment.

## Phases and exit criteria

### Phase 0 — Pin the reference and preserve ownership

Record the main/source identities above, the existing app and runtime owners,
the baseline instruction identity, and the immutable historical evidence
references. Preserve the two study branches and their outstanding findings.
Keep raw private evidence with its existing custodian; public source contains
schemas and references, not copied tenant traces or private bank contents.

**Exit:** an explicit source manifest, an agreed additive implementation scope,
and no competing changes to the active runner. The initial v2 source may be
written while runtime reconciliation and native registration remain pending.

### Phase 1 — Implement the isolated learning core

Build the experiment controller, structured proposal contract, safe model
projections, authenticated admission/novelty/evaluation interfaces, durable
attempt intents, private compare-and-swap journal, and version transitions.
Implement +1 provisional screening and the fixed three-pair confirmation
contract. Keep activation and rollback separately authorized.

Write regression source covering invalid states and identity substitutions,
duplicate and uncertain procedures, incomplete passes, missing pairing data,
reused confirmation namespaces, early activation, stale journal revisions,
replay, budget ambiguity, and negative-history leakage. Use injected fake
boundaries; the source suite must not invoke actual models.

**Exit:** reviewable module and test source, a source manifest, documented
external interfaces, and an explicit list of uncommissioned integrations.
Written tests are not passing tests. Initial source completion does not mark
Phase 2 complete.

### Phase 2 — Complete the adapter, reconcile the runner and qualify the full source

**2a source implemented:** the concrete scheduler now connects the controller's
frozen phase plan to the pinned SDK interface, a durable operation archive and
independent receipt transports. It preserves paired screening reuse and fresh
confirmation ordering, captures raw turn evidence, and prevents a repeated
operation/call claim after ambiguous dispatch. The compatibility helper matches
the existing BAG blob. The PR review's stranded-reservation recovery defect is
repaired. See the [adapter record](phase-2-adapter.md) and its separate manifest.

**2b host source implemented:** `host.mjs` now composes the existing controller,
executor and stable private operation archives. Its dispatch ledger records
intent before requesting gateway admission, including the interval before a
controller lease exists. Reopening requires the original stores and pins.
Explicit recovery authenticates retained admission and final settlement;
expired historical admission can close accounting only through an atomic,
consumed and settled record. It cannot renew execution authority. Independently
signed non-admission also consumes its logical phase. See the
[host record](phase-2-host.md) and its separate source manifest.

**Owned-runner integration and qualification remain:**

The existing reconciliation owner connects this host at the runner's existing
proposal/evaluation seam and supplies the real capabilities and durable volume.
Carry forward both 3091's control completeness and
e054's host-only history isolation. Replace the overbroad novelty matcher and
immediate screen-positive activation. Preserve the original baseline and all
inherited regressions. Connect the current TrueForge boundary without changing
model, SDK, sampler, task population, or scorer at the same time. Account for
the separately declared runtime-capability changes in the control comparison.

The trusted host adapter must produce actual source-bound receipts, exact
request/reply reuse evidence, exclusive freshness claims, per-pass statuses,
cost observations, and independent authorization. Document the authority
custody and gateway boundary; do not self-sign an evaluator or budget claim as
though it came from an independent service.

Through the existing native-gate owner, establish the registered Gate Keeper
target, reviewed full command/preset, protected gate paths, output profile, and
actual admitted dedicated runner. An available evaluation service or a Console
dropdown entry is not this registration.

Qualification must retain the **whole existing recipe**: pinned environment and
frozen install, decoded-log canary, `npm run typecheck`,
`npm run score -- --selftest`, full `npm run test:learning-policy`, and all normal
dependency/security/policy and product/effective-tree checks. No reduced suite,
ad hoc command, local execution, hook bypass, or evaluation-host substitution.

If integrating the supplied Python contrast fixtures, add reviewed explicit
discovery and the required interpreter to the full registered gate. Missing
Python or zero/wrong discovery must fail. Retain the actual Python version,
exact loader/path/command, seven expected fixture test identities, discovered
and run counts, and individual outcomes. The Node wildcard does not execute
Python tests. Fixture labels remain provisional until that qualification.

**Exit:** the exact reconciled commit/tree and source manifest, independent
review, and a retained full remote gate receipt binding head/base, product and
effective trees, command/preset, provider/service/worker/allocation/native run,
all step results and counts, log digests, reconciliation, and cleanup. No such
v2 receipt is claimed by the current source delivery. The served Spekky build
inspected on 4 November still lacks Gate Keeper's target and output profile;
the host record names the exact inspected identities and remaining actions.
The served source guard requires an open, non-draft PR at the exact head and
base, including explicit operator dispatch. Complete registration and source
integration, then advance the candidate to review-ready for gate admission;
there is no draft bypass.

Sources: [current qualification recipe](https://github.com/appliedai-au/gate_keeper/blob/20dcea65a22e680398d017191b91d04e32b4f883/Dockerfile.qualify),
[native registration requirements](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6619321938),
and [full-gate Python requirements](https://github.com/appliedai-au/Spekky-V1/issues/794#issuecomment-6620951327).

### Phase 3 — Establish baseline equivalence and run one controlled pilot

First compare v1 and v2 with learning disabled using the frozen original BASE,
same BASE instructions, model, sampler, population, scorer and complete two-pass
execution. Check valid-case rendering/merge compatibility in the full managed
suite. Explicitly assess the declared runtime-capability changes through
authorized BASE controls, separating that effect from model variation and
learned procedures. Whole-runtime and malformed-input parity are not assumed.
Do not interpret separately sampled differences as an engine gain.

After the source gate, runner-owner acceptance, and cumulative accounting,
admit one controlled ten-attempt pilot under the fixed protocol above. Keep the
one-fault focus and all attempt dispositions. Screen by exact reuse; confirm
only provisional candidates with the three fresh alternating pairs. Never
extend the experiment after seeing an inconvenient result.

**Exit:** complete, independently retained baseline/control/pilot evidence,
honest attempted-versus-scored counts, complete spend reconciliation, and a
clear outcome: no qualifying candidate, inconclusive evidence, or a confirmed
version eligible for separate activation authorization. Any of these can be a
correct experiment result. No accuracy improvement is presumed.

### Phase 4 — Connect the app read model and roll out incrementally

Project authoritative journal state into the existing app. Show original
baseline, confirmed incumbent, attempts, unscored reasons, provisional versus
confirmed status, activation history, evidence links, and cost state. Keep
tenant-private evidence behind the existing access boundary. The app does not
infer acceptance from a score or mutate the journal through display logic.

Use separately authorized version selection for a bounded rollout. Observe
operational failures and the agreed quality measures; rollback selects an
eligible prior version while preserving every receipt and the original BASE.
Keep one writer for each active state boundary. Do not run two competing
learning controllers against the same bank.

**Exit:** app state agrees with the authoritative records, activation and
rollback are qualified, and the owner has authorized the selected rollout.
This phase changes the existing Gate Keeper experience; it does not replace
the app or require new standalone services.

### Phase 5 — Consider broader memory and capability evolution

Only after the controlled engine works, assess evidence-producing skills,
additional fault families, new repository/template families, sampling changes,
and other models one controlled variable at a time. Evaluate TrueForge memory
and skill-distribution capabilities against the actual pinned runtime and SDK.
Separate durable user/session context from experimentally qualified reviewer
procedures.

**Exit:** a separately reviewed design and evaluation plan for each expansion.
Durable memory, traces, and a versioned skills registry are useful building
blocks; none grants automatic rule acceptance, model-weight learning, or
permission to bypass confirmation.

## Historical migration

Import existing negative and unproven records only as private, host-side
historical references with their original IDs, exact text or content digest,
scope, source/model/run/cycle, observations, and custodian evidence. Preserve
their historical classifications. Add versioned procedure-review associations
as new provenance rather than editing old results. Missing procedure details
or uncertain equivalence remains explicit.

Previously accepted bank entries are **historically accepted, v2-unqualified**
until reconfirmed under the new contract. Do not automatically turn them into
v2 confirmed carry or silently remove them from the existing product. The
current original BASE is frozen as its own reference; migration of separate
bank entries is an explicit operation, not a rewrite of that reference.
The initial proposal path does not bypass duplicate detection to requalify an
imported legacy positive. A separately reviewed legacy requalification path
belongs to the integration work; do not claim it already exists in this slice.

Do not import private bank contents into public Git files, erase failed
attempts, replace old scores, infer no-repeat success from normalized text, or
count an old model run as the new source gate. Preserve old receipts alongside
the new ledger's references so the lineage remains reviewable.

## Completion reporting

Report source implementation, independent source review, remote qualification,
model evaluation, activation, and deployment as separate statuses. Each claim
must name its actual artifact or receipt. A prepared regression, signed empty
envelope, historical deployment, or posted operator request is not a test pass,
accepted task, newly available capability, or measured learning gain.

The next milestone is the remaining Phase 2b live integration: supply the
implemented host with the real SDK, independent authorities, global gateway
and durable volume; reconcile the owned runner; and retain full managed
qualification for that exact source. The existing owner/operator requirements
remain explicit dependencies while the authorized source work proceeds.
