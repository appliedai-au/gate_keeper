# Production pilot composition

This change connects the existing v4 `LearningController`, durable host, executor,
SDK-turn archive and per-run ledger to a detached authenticated authority service.
The production driver has no provider credential or signing key. It does not
implement a second controller or infer evaluation outcomes from caller claims.

## Frozen inputs and history

`config/learning/concurrency-atomicity-corpus-v1.json` preserves the original
Gate Keeper prompt bytes from historical source
`138ef6bba4a7a109bd9969f57073b9cf9e6a3f62`, payload
`proof/three-agent/payloads/train-t4-t5-t6burned-bag-v12.b64`, Git blob
`ddc86c9ddce9f50b0fb278fb542d5bf1bae8a538`. Its selection reproduces that source's
concurrency-atomicity regex over the existing expected-line explanations. Other
known defects are neutral locations in this focused experiment, as in the
historical runner. The new host still uses its already-pinned two-pass renderer;
this is a new v4 control, not a claim to reproduce an old run's score.

| Case | Development split | Expected focused defects |
| --- | --- | ---: |
| t4-01-py-wallet-transfer | Fit | 2 |
| t4-03-go-ttl-lru | Fit | 2 |
| t4-04-cs-exchange-rates | Fit | 1 |
| t5-01-py-login-flow | Fit | 1 |
| t5-04-java-inventory-reservations | Fit | 3 |
| t6-01-py-redis-lock | Burned check | 6 |
| t6-03-go-sse-broker | Burned check | 1 |

The seven cases contain 16 focused defects. This is development evidence only:
tranche 6 was already burned. No tranche 7 artifact is read, decoded or admitted.
The canonical corpus digest is
`eac6553e0fc669d2a648ba460d492325cae3a45e1770bad10d02a8d36f9a79b3`.
Only `{caseId,prompt}` enters the executor's case-input projection. The independent
evaluator retains the oracle and line-window scoring definition. Check feedback
does not enter the learner request.

The existing read-only legacy-bank projection is mandatory. Initialization refuses
an empty substitute, incomplete group/index coverage, or a bank predating the
retained 35 harmful and 18 unproven entries. The full projection stays in the frozen
private bundle. Original record digests, group indices and source-file digest bind
every imported reference. Existing positive records would be `legacy-positive`,
never v4 confirmed versions. Malformed or oversized old unscored attempts remain
explicit non-procedure records; they are neither truncated nor silently promoted
into valid procedures. A historical negative two-rule bundle stays one rejected
bundle, without asserting that either component was independently harmful.

The recovered source bank has revision 65 and counts 0 accepted, 35 harmful,
18 unproven and 47 history records. Its source-file digest is
`2f679a49712b9dbefc992c03a1437ec9dff7e2f989b90bcb130aa3a4dc42b7ab`;
the complete safe projection digest is
`549a00b379e7819cd6b0ea1141f58d4ded306cb1a41c7909de186ee531f568f2`.
The private runtime projection is not committed to this repository. Its current
shapes produce 100 procedure references and one retained historical confirmation
record without a procedure. Full original history remains available to the
independent semantic reviewer.

After source qualification, `inspect-production-history.mjs` can run on the
existing legacy runner to exercise the real importer against that fixed bank.
It verifies the recovered digests and expected reference counts, then emits only
digests, revision, counts and zero-call/zero-write metadata. This provides an
actual-data integration check without publishing private historical procedures.

## Authority and configuration boundary

`freezeProductionBundle` requires explicit owner, experiment, exact source commit,
catalog model, qualified server version, full managed-gate policy, corpus, legacy
projection and four distinct pinned Ed25519 public identities. Its config digest
uses the existing controller identity format. It never generates a signing key or
creates a managed-gate, evaluation, novelty, execution or activation receipt.

`authority-client.mjs` supplies the SDK-shaped session client, independent
evaluation/novelty issuers, admission/settlement gateway, managed-gate receipt,
original-BASE fit feedback, activation and delayed usage reconciliation. The
detached service owns actual SDK access and protected signing roles. It must
independently retrieve provider artifacts and score the frozen oracle. The driver
never forwards a provider credential or signs its own result.

The small bootstrap descriptor has this exact data shape:

```text
schema: gk-learning-production-bootstrap-v1
binding: ownerId, experimentId, sourceCommit, configDigest
legacyBankFileDigest
legacyBankDigest
trustPins: evaluation, novelty, budget, activation, gatewayId
authority: baseUrl, token
readToken
```

The operator supplies actual values from the authenticated authority and the
qualified source. The source must also equal the production platform's
`RAILWAY_GIT_COMMIT_SHA`. Each public fingerprint and both bank digests are checked
before installation. The status token uses the existing base64url 32–256 character
contract and must differ from the scoped authority-driver token.

On the first explicit bootstrap, the host fetches
`GET /v1/gatekeeper/bootstrap` from the descriptor's fixed HTTPS authority origin
with bearer authentication. Redirects are refused; the response is limited to
4 MiB and 30 seconds. The complete bundle is independently recomputed and checked
against every descriptor binding. Later starts validate and reuse the existing
private configuration without fetching or replacing it. A small private
`GK_PRODUCTION_BOOTSTRAP_B64` descriptor avoids putting the large history bundle
in a platform variable. `GK_PRODUCTION_CONFIG_B64` remains an explicit alternative
for a fully prepared bounded configuration; both sources cannot be supplied.

## Existing production host

The required directory is `/var/lib/gk-v2-private-journal/experiment`, outside the
repository. Configuration and status remain under the existing private root:

- `/var/lib/gk-v2-private-journal/production-config.json`
- `/var/lib/gk-v2-private-journal/status-config.json`

The root must already be owned by UID 1000 with mode 0700. Published files are
regular UID-1000 mode-0600 files. A fully written and synced staging file is
published with a no-clobber hard link, then the staging link is removed. A restart
can remove only a matching publication staging link left after a crash; final
bytes and old journals are never rewritten. A crash before publication leaves
only an unreferenced private staging file, which cannot block a fresh publication.
Unrelated hard links and different existing final files are refused.

`production-bootstrap.mjs` is the parent-process entry point for the existing
host's startup integration. `GK_PRODUCTION_COMMAND` selects exactly one explicit
command. It spawns `launch-production-pilot.mjs` with only `PATH`, `NODE_ENV` and
the verified source SHA in its environment. Database secrets, TrueForge/provider
keys, signing material, `NODE_OPTIONS` and historical bootstrap commands are not
inherited. The child reads only the fixed private configuration. The parent host's
TrueForge service and status routing continue to own their existing roles.
The integrated launch entrypoint performs init/status preparation before capturing
the status handler, then starts an explicitly requested run after routing is
listening. The driver receives SIGTERM/SIGINT and gateway-close cancellation; the
parent waits for child closure and uses SIGKILL after a five-second drain if
necessary. Commissioning variables are also removed from the ordinary TrueForge
child's environment.

| Command | Effect |
| --- | --- |
| `init` | Initialize a new journal once and publish its bound status configuration. |
| `run` | Advance the existing experiment until completion, an unresolved operation or independent review is pending. |
| `resume-review` | Obtain the independent decision for the specified original proposal, resume that operation, then continue the bounded pilot. |
| `reconcile-usage` | Record a later signed charge for one existing operation, without model calls or another admission. |
| `reconcile-operation` | Apply a protected, independently verified terminal-operation reconciliation to the original pending dispatch; never retry it. |
| `status` | Open and report the existing experiment. |

The three operation-specific commands require `GK_PRODUCTION_OPERATION_ID`.
Initialization is never inferred from missing files during a `run` or restart.
Different source bindings, private configurations or trust pins fail closed.

Retain `GK_V2_HOST_BOOTSTRAP=enabled`, `GK_V3_HTTP_ROUTER=enabled` and
`GK_V3_READONLY_STATUS=enabled`. Set `GK_PRODUCTION_BOOTSTRAP_B64` to the small
descriptor and leave the alternative `GK_PRODUCTION_CONFIG_B64` unset. The
platform supplies the exact deployed `RAILWAY_GIT_COMMIT_SHA`.

Apply each command change using a fresh source attach/current-configuration
deployment of the same qualified commit. A historical-deployment redeploy can
restore that deployment's old variable snapshot and is not the commissioning
mechanism. The recommended sequence is:

1. `GK_PRODUCTION_COMMAND=init`; remove `GK_PRODUCTION_OPERATION_ID`.
2. `GK_PRODUCTION_COMMAND=run`; keep the operation ID absent.
3. Once the protected independent decision exists, set
   `GK_PRODUCTION_COMMAND=resume-review` and the exact pending
   `GK_PRODUCTION_OPERATION_ID`. Repeat only for subsequently queued reviews.
4. After the genuine ten-attempt result is retained, set
   `GK_PRODUCTION_COMMAND=status` and remove the operation ID.

The frozen source commit and public trust do not change midway through the pilot.
An exceptional terminal-operation reconciliation or delayed charge uses its own
explicit command and operation ID. Neither automatically dispatches the next
model call; the operator can subsequently select `run` when appropriate.
The authority labels operation reconciliation `failed-execution` or
`settlement-only`. The latter is accepted only when the original host already
consumed the operation's evidence. A completed authority result whose response
was lost before host consumption remains held for original-evidence resume;
accounting recovery cannot silently abandon it.

## Execution and independent review

The driver first records the actual source-bound full managed gate and executes
one original BASE control. It then advances the existing controller through at
most ten reserved attempts. Only a confirmed version with a separate authentic
activation receipt becomes the next incumbent. Screening, the minimum gain of one
and the three fresh alternating paired confirmations remain the existing policy.
There are no additional confirmation pairs or replacement attempts.

An independent novelty reviewer may queue a decision after the actual proposal
turn completes. `resumeProposalReview` authenticates that original archived input,
complete output, parsed candidate, historical reference coverage and signed
decision. It preserves the first receipt bytes, consumes the existing proposal
and settles the same operation. It never invokes the executor, creates a new SDK
turn, requests a new lease or changes an earlier decision. Replay and settlement
recovery are idempotent. A negative or uncertain novelty result still requires
the signed count of the one proposal call that actually ran.

Any other ambiguous dispatch remains held for explicit reconciliation. The driver
does not abandon, retry or invent zero usage to advance. It reports ten genuine
attempts only when all ten proposal operations have settled with exactly one
authenticated actual call each. Ten reserved identifiers alone are insufficient.
A completed all-negative pilot keeps BASE active and reports the negative result.

Known and unknown monetary charges follow v4's per-run accounting. An authentic
execution settlement with `actualMicros:null` can finish custody. A later signed
price can be reconciled without repeating inference. Raw SDK estimates are never
relabeled as confirmed charges.

## Qualification scope

New source regressions cover delayed-review call custody, signature/binding
rejection, negative-review call accounting, settlement crashes and idempotent
receipt replay; frozen corpus/history/trust validation; historical bundle
provenance; all ten confirmed attempts reaching the final completion observation;
zero-call attempts refusing genuine-completion claims; environment isolation;
authenticated bootstrap pins; and private-file publication crash windows.

These tests use explicitly synthetic fixtures. They are source for the isolated
managed qualification gate, not live pilot evidence. A current full qualified
source, the actual protected authority bundle, live provider configuration and
independent novelty decisions are still required for the genuine pilot.
