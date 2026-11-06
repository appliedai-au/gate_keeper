# Qualified implementation and original BASE continuation

This procedure repairs the protected reader and continues the already admitted BASE. It does not start a replacement experiment, renew a lease, change the historical bank, retry a model call, or qualify the public review product.

## Identities and scope

The frozen experiment remains `gk-v4-concurrency-20261105`, source **A** `a35c83ccb2e3743c4d4f3b9ae13406507dfd297a`, config digest `bd1221efb5946cab549bcb2a6e7205e776a5cef4e43a0bb44c3c1713211d66ed`. Use the actual original BASE operation identity captured in protected preparation evidence.

The original managed gate and frozen bundle continue to name A. **B** is the actual new reviewed, remotely qualified and merged implementation commit. B is not known while this source is being authored. Use the real platform `RAILWAY_GIT_COMMIT_SHA` for B on both services. Never assign A to a B image, edit the original bundle/gate, replace the old production configuration, or change a signer pin.

The fixed reader requests 25 turns per page and 100 events per page. Both retain complete pagination and root-turn exclusivity. The bounded continuation accepts exactly the following retained state:

- One original seven-case, two-pass, fourteen-call BASE operation, with the same operation ID, request digest and lease.
- No proposal attempts, accepted baseline, settlement, abandonment, activation or conflicting operation.
- A host archive with precisely one complete first result and one terminal second-call `session-request` failure with null session and turn IDs.
- Independent authority custody with precisely one complete owned call and no second session intent. Host null IDs alone are insufficient.
- Exact agreement between the first host final and the authority's fresh provider reads: session/turn/call IDs, model-visible input, prompt/model, output digest and text.

The old first final and second failure remain terminal in the original `OperationArchive`. The implementation creates a separate append-only continuation archive. It references the original archive head and original failure, replays the already verified first result without entering the SDK adapter, and dispatches only the thirteen remaining original logical slots. The failed second slot keeps its original deterministic call ID, while the additive archive distinguishes its authorized new execution from the retained original failure.

This is an explicit one-time continuation. A started incomplete continuation stays held. It has no generic recovery, alternate lease, replacement operation, automatic retry, lock removal or inferred zero charge.

## Review and qualification before operational use

1. Review the complete R1 + R2 candidate, including the new tests and this procedure. R1-only approval does not approve R2.
2. Obtain independent review and Gitar approval for the final candidate head.
3. Run the existing full `Dockerfile.qualify` preset in the authorized disposable remote qualifier: all Node tests, privacy canary, typecheck and five scorer self-tests, with no skip/cancel/failure/todo. The new tests are discovered by the existing `tests/*.test.mjs` glob. Do not run candidate code, imports, tests, builds or installs locally.
4. Preserve the raw result bytes and their SHA256, then observe the qualifier's actual cleanup. Publish the exact authenticated owner qualification receipt on the repair PR, using the existing `GK_AUTHORITY_QUALIFICATION` schema.
5. Merge only the independently reviewed, qualified tree. Record B's exact two ordered parents, qualified head, tree, and current-main observation. The independent implementation verifier uses the existing source proof checks for B. Its target, preset and output-profile digests must match A's policy; only the separately qualified effective tree is B's. The old A gate remains unchanged.

No source-authored regression is a live BASE result. Remote source qualification is necessary before the commissioning steps below, and it does not replace the actual provider/host acceptance.

## Stage 1: qualify the actual B authority, with execution still held

Deploy the authority at actual B in `serve` mode. Keep `GK_AUTHORITY_CONFIG` and `GK_AUTHORITY_SOURCE_PROOF` as the original A commissioning values. Add a separate `GK_AUTHORITY_IMPLEMENTATION_PROOF` descriptor:

```json
{
  "schema": "gk-learning-implementation-source-proof-v1",
  "sourceProof": {
    "schema": "gk-learning-source-proof-v1",
    "repository": "appliedai-au/gate_keeper",
    "sourceCommit": "ACTUAL_MERGED_B_COMMIT",
    "qualification": {
      "commentId": 0,
      "bodySha256": "EXACT_NEW_QUALIFICATION_COMMENT_BODY_SHA256",
      "authorId": 0,
      "authorLogin": "ORIGINAL_PINNED_OWNER_LOGIN"
    }
  },
  "gatePolicy": {
    "targetId": "ORIGINAL_TARGET_ID",
    "presetDigest": "ORIGINAL_PRESET_DIGEST",
    "outputProfileDigest": "ORIGINAL_OUTPUT_PROFILE_DIGEST",
    "effectiveTreeDigest": "CANONICAL_DIGEST_OF_REPOSITORY_AND_B_GIT_TREE"
  }
}
```

The zeros and uppercase values above are placeholders, not valid proof. Use the independently observed real IDs and hashes. The qualification author must be the same authenticated owner already pinned by A's retained source proof.

At this point B can report its qualification and perform the nondispatching prepare. The authority refuses model/session mutations, admissions, evaluations and ordinary protected decisions until the separate continuation owner authorization is verified and retained. Do not reinitialize custody or register a replacement provider.

## Stage 2: capture and independently prepare the actual original state

Deploy the host at actual B with `GK_PRODUCTION_COMMAND=prepare-baseline`. Keep its original A bootstrap descriptor and immutable production configuration. No operation ID override is accepted for this command.

The parent retrieves B's signed qualification through the existing authenticated authority connection and validates it against A's four existing public pins. It creates `implementation-qualification.json` once; it does not replace `production-config.json` or `status-config.json`. The child continues to receive its real B source identity through the whitelisted environment.

The host captures the actual controller head, dispatch head, original operation archive head, request, operation, first final and second failure. The authority reconstructs the admitted frozen request, independently rereads the one provider session/turn through the fixed reader, proves there is no second authority intent, and signs a prepared proof. This may append verification/prepare evidence but performs **zero SDK mutations, provider claims, model dispatches, leases, result consumptions or settlements**.

Preserve the returned `preparedProof` envelope and both protected source identities. Its `retained` object supplies the exact original operation/lease/request, fourteen-call maximum, thirteen-call remainder, host heads, archive/failure/result digests and provider IDs. These values must come from the actual prepare, never from this document or a hand-written reconstruction.

## Stage 3: publish the exact owner authorization

Publish a new immutable owner comment on B's repair PR, beginning with the literal line:

```text
GK_BASE_CONTINUATION_AUTHORIZATION
```

Follow it with a JSON object in this shape:

```json
{
  "schema": "gk-learning-owner-base-continuation-v1",
  "purpose": "qualified-turn-pagination-repair-original-base",
  "binding": "COPY_THE_COMPLETE_ORIGINAL_A_BINDING_OBJECT",
  "implementationCommit": "ACTUAL_MERGED_B_COMMIT",
  "implementationTree": "ACTUAL_QUALIFIED_B_GIT_TREE",
  "qualificationDigest": "CANONICAL_DIGEST_OF_SIGNED_B_QUALIFICATION_ENVELOPE",
  "preparedProofDigest": "CANONICAL_DIGEST_OF_SIGNED_PREPARED_PROOF_ENVELOPE",
  "retainedDigest": "CANONICAL_DIGEST_OF_THE_COMPLETE_PRIVATE_PREPARED_RETAINED_OBJECT",
  "allowCorrectedReaderRemainder": true
}
```

`binding` is an object, not a string; the quoted placeholder shows where the observed object belongs. Keep the complete `retained` object, provider session/turn IDs, and operation/lease identifiers in protected custody. The public comment binds that exact private state using `retainedDigest` and `preparedProofDigest`; it does not disclose those runtime identities. Envelope identity uses the repository's canonical JSON `digest` format. The comment body pin is SHA256 of the exact UTF-8 body, including its prefix and actual newlines. Preserve the original envelope property order for signature verification.

The owner comment must postdate the actual prepare. It explicitly authorizes both the bounded BASE continuation and use of B's corrected reader for the remaining phases of **this same frozen experiment**. It does not authorize another experiment, increased attempts/calls, a new rule-bank import, changed prompts/scorer/model, additional confirmation pairs, or a public live-review workflow.

Set the protected authority control-plane input `GK_AUTHORITY_BASE_CONTINUATION_AUTHORIZATION` to the exact `{ "commentId": ..., "bodySha256": ... }` pin and restart the same qualified B. This is not a driver RPC. The authority independently fetches the owner comment, checks its author, PR, exact bytes, B qualification and original prepared state, and durably retains a signed authorization. Replacing this decision is refused.

## Stage 4: continue and settle the original BASE

Run the host at actual B with `GK_PRODUCTION_COMMAND=continue-baseline`. The bootstrap requires the signed owner-authorized implementation status before starting the child. It creates `baseline-continuation-authorization.json` once, separately from the qualification file.

The original lease may have expired since its first genuine call. This path does not perform admission or reservation again. The existing authority checks lease time only before an operation's first dispatch; the independently verified first call proves this operation already started. The regression suite advances past the original expiry and requires the same lease bytes/ID, one admission and fourteen total original calls.

Before dispatch the host verifies that its actual original heads and archived bytes still equal the signed authorization, creates the additive archive, and appends a mandatory continuation link to the existing dispatch journal using the authorized original dispatch head. A durable started marker and original-result replay reference precede every new SDK mutation.

An explicit continuation can finish an interrupted metadata-only initialization after its original operation claim or authorized LINK was written but before dispatch linkage. It first requires the exact original operation/request, zero call claims, and either no artifacts or exactly the accepted LINK with unchanged serialized qualification and authorization bytes. It appends only the missing claim/LINK/linkage steps; repeated metadata initialization adds nothing. Any differing, corrupt, started, replayed or evaluated prefix remains held. The original controller-head check and dispatch-head CAS still precede execution, and this path never retries an SDK call.

Success requires all of the following:

- The first original result is returned through the internal one-use verified replay capability, with **zero repeat SDK or model calls for that slot**.
- Exactly thirteen remaining deterministic slots execute under the original operation/request/lease. The first reused observation still counts as the first original fresh logical BASE call; this is not paired-cache reuse and receives no 13-call accounting discount.
- The authority independently verifies fourteen owned original calls and issues the complete BASE evaluation.
- The host consumes that original fourteen-call evaluation and settles the original lease with `actualCalls=14`. Estimated provider cost remains distinct from an actual billing receipt; unknown actual price remains `null`.
- The original archive head and both original terminal observations are unchanged. The new archive contains thirteen new SDK calls plus the verified replay reference, authorization link and independent evaluation artifacts.
- A repeated completed continuation performs zero new SDK or model calls. A restart can consume an already retained complete evaluation and finish its original settlement; it cannot re-enter an incomplete executor.
- Host reopen and the authenticated read-only status reader verify the mandatory continuation link and both archives. Missing or corrupt linked evidence holds/fails the read; it cannot fall back to the original failed archive while reporting a completed fourteen-call BASE.

The continuation command stops after BASE. Capture the protected result and authority status with A, actual B, qualification receipt, continuation receipt, original operation/lease, fourteen-call settlement and price provenance.

## Stage 5: remaining pilot and hold behavior

Only after actual BASE acceptance may the same qualified B run the ordinary protected pilot with `GK_PRODUCTION_COMMAND=run`. The explicit owner authorization covers the corrected reader for the remaining original experiment. The unchanged rules still require ten actual proposal attempts, retain positive and negative dispositions, prevent retrying negative procedures, use the frozen ±1 scorer, and require exactly three fresh confirmation pairs for promotion. There is no aggregate spend cap; Spekky remains waived under the existing task scope.

On any new ambiguous session/turn/provider intent, incomplete continuation, missing artifact, source mismatch or changed pin: stop dispatch and preserve all journals. Do not use generic reconciliation to abandon this continued BASE, rerun `init`, reclaim an old call, invent a zero charge, remove a sidecar, rewrite a checkpoint, or deploy the old A binary to resume work. Repeating `continue-baseline` is a read/consume/settle path only when the complete original continuation evidence already exists. Otherwise it holds.

Operational rollback means disabling the driver command and keeping the original and additive evidence intact. Before any additional implementation migration or recovery of a partially executed continuation, obtain a new concrete design and exact-source qualification. This bounded implementation authorizes one B migration; it deliberately refuses replacing that durable implementation/authorization with a different image.

## Qualification regressions

The new source covers the strict turn/event pagination contract; nondispatching prepare; first-result/provider equality; independently proven absence of a second intent; qualification-only execution refusal; wrong source, owner, pins, operation, lease, request or archive head; one verified replay plus thirteen new calls; fourteen-call unknown-price settlement; completed replay; held ambiguous continuation; unchanged original finality; mandatory sidecar on host reopen and read-only status; separate B source qualification with unchanged A policy; and owner authorization of the exact prepared proof and experiment remainder.

These tests use synthetic services/receipts and are intended for the full isolated remote qualification. Their success would establish source behavior, not an observed production BASE, actual paid attempt count, successful Base44 session matrix, confirmed learned rule, or operational public review product.
