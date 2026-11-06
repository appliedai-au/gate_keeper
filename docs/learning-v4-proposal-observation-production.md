# D startup for the original fourth-proposal observation

This source profile is an additive continuation of the retained experiment. It
does not authorize a deployment, a recovery action, a provider call, or a new
experiment by itself. D requires its own exact-source qualification and owner
authorization. The original frozen experiment A, historical implementation B,
original BASE continuation and original fourth-call failure remain unchanged.

The three production wrappers distinguish actual D from historical B through
`gk-learning-proposal-observation-status-v1`. They never substitute a D SHA into
B's qualification or ask B's original source verifier to pretend B is current
main. B's historical envelopes are checked against their original signatures and
the original protected host files. D's source verifier independently retrieves
the actual current source, merge relation, ordered parents and review evidence.

## Fixed proof namespace

The existing private production root retains its original configuration, status
configuration, B qualification and B BASE-continuation authorization. D may add
only these three create-once files through the existing no-clobber publisher:

| New file | Meaning | Availability |
| --- | --- | --- |
| `proposal-observation-qualification.json` | Signed qualification of actual D, binding the original A/B identities and proof digests. | Required for every D command. |
| `proposal-observation-preparation.json` | Signed later observation of the original paid fourth call. | Absent before preparation; mandatory before authorization. |
| `proposal-observation-authorization.json` | Signed owner authorization of that exact preparation, with an explicit remainder permission. | Required for consumption and ordinary mutation. |

The wrapper publishes qualification, preparation and authorization in that order.
Repeating identical installation does not replace bytes. A different existing
file, preparation without qualification, authorization without preparation,
missing B file, or changed historical B object causes a hold. The D installer
never passes either B proof file, the original configuration, or the original
status configuration to a writer.

Startup reads use `readPrivatePublishedJson(..., {strictReadOnly:true})`. They
reject unresolved or acquired extra hard links instead of cleaning publication
staging before source verification. The shared publisher keeps its existing
qualified atomic publication and no-clobber behavior for deliberate writes. An
empty volume cannot become a new D experiment through this startup path.

## Public source descriptor and process boundary

The parent receives the actual platform commit from `RAILWAY_GIT_COMMIT_SHA`.
For D it also requires `GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF`, containing
at most 32,768 UTF-8 bytes of JSON with exactly:

```json
{
  "schema": "gk-learning-proposal-observation-source-proof-v1",
  "sourceProof": {
    "schema": "gk-learning-proposal-observation-gate-proof-v1",
    "repository": "appliedai-au/gate_keeper",
    "sourceCommit": "ACTUAL_QUALIFIED_D_COMMIT",
    "qualification": {
      "commentId": 0,
      "bodySha256": "EXACT_PUBLIC_QUALIFICATION_COMMENT_SHA256",
      "authorId": 0,
      "authorLogin": "ORIGINAL_AUTHENTICATED_OWNER"
    }
  },
  "gatePolicy": {
    "targetId": "ORIGINAL_FULL_LEARNING_TARGET",
    "presetDigest": "ORIGINAL_FULL_QUALIFIER_SHA256",
    "outputProfileDigest": "ORIGINAL_OUTPUT_PROFILE_SHA256",
    "effectiveTreeDigest": "QUALIFIED_D_EFFECTIVE_TREE_SHA256"
  }
}
```

This is a shape illustration, not an executable descriptor. The placeholders and
zero IDs are deliberately invalid. The real descriptor must come from the
independently reviewed and qualified D source packet. Its nested gate verifier
checks all actual source, review, owner, recipe and cleanup requirements; parsing
the outer JSON grants no authority.

The exact descriptor string is the only additional child input. The complete
child environment is:

| Variable | Value source |
| --- | --- |
| `PATH` | Fixed `/usr/local/bin:/usr/bin:/bin`. |
| `NODE_ENV` | Fixed `production`. |
| `GK_PRODUCTION_SOURCE_COMMIT` | Actual parent's `RAILWAY_GIT_COMMIT_SHA`. |
| `GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF` | The exact bounded public descriptor, only for D. |

No provider key, database credential, authority token, `NODE_OPTIONS`, historical
bootstrap command or other parent variable is copied. D refuses commissioning
seeds (`GK_PRODUCTION_CONFIG_B64` and `GK_PRODUCTION_BOOTSTRAP_B64`); their retained
configuration must already exist. A descriptor naming a different actual image
is refused before child creation. The original A/B path retains its existing
three-variable environment when no D descriptor is present.

## Independent parent and child gates

The parent reads the original authenticated authority connection and retrieves
`implementationStatus()`. On actual D the authority returns the typed D status;
there is no alternate unqualified RPC or fallback to B. The wrapper checks the
command's signed permission and calls
`createProposalObservationSourceVerifier({descriptor,fetcher})` with the original
bundle, actual D commit and retained `historicalImplementationStatus`.

The independently returned D commit, tree, exact owner/comment pin, qualification
run, raw-log digest and deterministic `qualificationEvidenceDigest` must all
match the signed D qualification. The stable evidence digest covers authenticated
pinned facts rather than mutable transport metadata. Live current-main, merge and
review checks still run on every invocation. Failure stops before sidecar
publication and child spawn.

After re-reading the installed proof and checking the command again, the parent
starts one child with an explicit executable, arguments, working directory and
environment. The child independently repeats the same signed command check and
fresh D source verification before `openProductionPilot`. It does not treat the
parent's completed fetch as a reusable approval. D skips the legacy status-file
publication step and reopens the existing host without initialization.

## Command permissions and stopping behavior

| Command on actual D | Required D proof | Behavior |
| --- | --- | --- |
| `status` | Qualification; preparation/authorization may be absent. | Read protected status and report A, historical B and actual D separately. |
| `prepare-proposal-observation` | Qualification. | Independently observe only the original fourth call and retain signed preparation through the core's protected sink. No new model call or host recovery transition. |
| `consume-proposal-observation` | Exact signed owner authorization and preparation. | Call the core's single bounded consumption method, return its fourth-invalid result, and exit. |
| `run`, `resume-review`, `reconcile-usage`, `reconcile-operation` | Exact owner authorization with `allowRemainingExperiment:true`. | The actual driver additionally requires completed mandatory local observation linkage before any ordinary method, remote request or new work. |
| `init`, `prepare-baseline`, `continue-baseline` | Never allowed on D. | Refused; neither a replacement experiment nor BASE repetition is permitted. |

The two observation commands accept no operation selector. Their sole original
operation is already bound in the signed preparation and owner authorization.
The consumption branch returns directly; it has no call to `run`, `step`,
`beginAttempt`, admission, settlement or provider APIs. Even an owner decision
allowing the remaining original experiment does not cause the recovery command
to start attempt five. Later work requires a separate explicit ordinary command.

The wrapper's permission gate does not replace the core's custody proof. The
actual host/driver must authenticate the retained failure, exact original B
settlement, additive D observation link and completed consumption before ordinary
D work becomes available. A valid owner permission with incomplete local linkage
still holds.

## Preparation output and operational order

The internal preparation result retains the signed envelope for protected
consumers. The CLI emits only fixed status/action, the qualification,
preparation, retained-checkpoint and settlement digests, and
`additionalModelCalls:0`. It excludes the original provider text, signature,
runtime IDs, private connection and read token. CLI failures retain the existing
fixed error code and do not print exception objects.

After all source/review/qualification gates and the actual D deployment checks:

1. Keep ordinary execution disabled and configure the exact public D proof. Clear
   commissioning seed variables; retain all original protected files.
2. Use `status` to install/check qualified D without owner execution authority.
3. Invoke only `prepare-proposal-observation`; retain the original protected
   preparation and independently verify its public digest summary. A later
   explicit status/read can install the signed preparation beside the unchanged
   qualification.
4. Publish and verify the exact owner authorization under the core protocol.
   Retrieve/install that signed authorization through the next explicit command.
5. Invoke only `consume-proposal-observation`. Verify the genuine fourth invalid
   result, original one-call settlement, zero added calls, completed local link
   and unchanged original bytes. The command ends here.
6. Invoke an ordinary remaining-experiment command only if its explicit owner
   permission is true and the completed local observation proof passes.

These steps are prerequisites and planned behavior, not a claim that recovery,
qualification, deployment or any new call has occurred. The separately accepted
C completed-history v1 remains a B-only contract. D history requires the later
explicitly reviewed provenance evolution before C can serve it as completed.

## Focused regression coverage

`tests/learning-v4-proposal-observation-production.test.mjs` evaluates the actual
three wrapper modules with synthetic Ed25519 envelopes and the real bundle,
signature and typed-status validators. Explicit filesystem/process/driver I/O
and the independent source-verifier factory are controlled seams; the latter
returns synthetic verified facts so the wrappers' signed-fact agreement can be
checked. It covers ordered create-once
sidecars, unchanged original bytes, orphan/corrupt/missing proof, empty-volume
refusal, pre-owner permissions, source-fact substitution, parent and child
verification, exact child environment, no selector or seed bypass, immediate
consume exit, digest-only preparation output and the actual core driver's
completed-linkage gate before ordinary work.

The core source-protocol tests must exercise its real independent GitHub evidence
verifier and genuine archive/settlement/linkage fixture. Real-filesystem
publication tests must prove strict reads reject unresolved staging links without
unlinking or repairing them. The complete combined D
source still requires independent exact-byte review, fresh exact-head Gitar and
the full isolated Learning qualification recipe, with no skipped gates and
observed cleanup. No candidate code, compilation, imports, tests or builds were
executed while authoring this slice.
