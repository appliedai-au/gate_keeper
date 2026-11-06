# Bounded observation recovery for the original fourth proposal

## Scope and current acceptance

This protocol is **source only until the exact candidate is independently reviewed, receives a fresh exact-head Gitar decision, passes the complete isolated Learning qualification and is merged as actual implementation D**. Authenticated execution of that process is an operator responsibility. A static packet, a different preparation-only PR, or another deployment does not qualify this implementation. Do not run this code locally, change the original bundle or start a model call to test it.

The original frozen experiment is A. Its original corrected-reader/BASE continuation implementation is B. D is a separately qualified implementation of the same experiment, with a bounded new way to consume the genuine later observation of **proposal attempt four**. D preserves the original terminal host failure, the original lease/request/call, all B continuation evidence, the original budget settlement, the frozen policy and the historical rule bank. It accepts zero additional model calls for this recovery. Ordinary attempts five through ten require explicit owner scope and a separate run invocation.

The actual custody motivating this code contained one completed fourteen-call BASE, three invalid proposals already consumed by the host, and a fourth provider turn that was complete while the host retained `session → turn → failure`. The original host failure was `TRUEFORGE_CALL_UNRESOLVED` at `turn-read`; its underlying exception was not retained and no HTTP-specific cause is asserted. The original whole output is invalid under the unchanged parser. The original B authority subsequently issued its ordinary signed one-call settlement, with price explicitly unknown. These are historical capture facts; none is evidence that D has executed or that the pilot is complete.

Public source identities may be cited in operator records. Original private session/call/lease identifiers, captured prompts, provider text, private journal snapshots and credentials must stay outside Git. All test fixtures in this packet are synthetic analogues.

## Distinct source identities

| Identity | Meaning | Retained rule |
| --- | --- | --- |
| A | Frozen experiment source | Bundle, policy, trust, config digest, original gate and history remain unchanged. |
| B | Original qualified pagination repair and completed BASE continuation | Its signed qualification, owner authorization, original failed BASE archive and continuation sidecar remain byte-identical. |
| D | Actual new running implementation for bounded fourth observation and, only when authorized, the remaining pilot | Qualify and authenticate D independently. Never assign B or A to `RAILWAY_GIT_COMMIT_SHA`. |
| C | Future ordinary-review serving application with completed history | Current B-only C v1 cannot honestly represent D history; a separately reviewed and qualified versioned A/B/D/C archive profile is required. |

D's exact merged commit must have historical B as its first parent and the qualified D candidate as its second parent; the merged tree must equal the qualified tree. D startup independently checks current main D. Keep main at D until the remaining pilot, any novelty decisions, and final closure are complete and its driver is disabled. A later C merge can make a required D restart fail by design.

## Files and custody

New pure/source modules are `proposal-observation-source.mjs`, `proposal-observation-proof.mjs`, `proposal-observation.mjs` and `proposal-observation-authority.mjs`. They are used by the existing host, authority, driver and status reader. The ordinary `OperationArchive` class and frozen controller transition logic are unchanged.

| Location | Content and publication |
| --- | --- |
| `/data/gk-v4-authority/ledger` and `/data/gk-v4-authority/artifacts` | Original authority history. D qualification, preparation and owner authorization read these; those stages append no original record or artifact. Later explicitly authorized ordinary pilot work retains the existing authority behavior. |
| `/data/gk-v4-authority/proposal-observation` | Separate append-only D proof namespace. Original qualification transport evidence, stable source-facts digest, signed D qualification, original host checkpoint, signed later observation and owner decision. No replacement of `state.implementation` in the original ledger. |
| `/var/lib/gk-v2-private-journal/implementation-qualification.json` | Original B qualification; read strictly and preserved. |
| `/var/lib/gk-v2-private-journal/baseline-continuation-authorization.json` | Original B authorization; read strictly and preserved. |
| `/var/lib/gk-v2-private-journal/proposal-observation-qualification.json` | Create-once signed actual-D qualification. |
| `/var/lib/gk-v2-private-journal/proposal-observation-preparation.json` | Create-once independently signed observation. Optional until actual preparation completes. |
| `/var/lib/gk-v2-private-journal/proposal-observation-authorization.json` | Create-once owner-authorized signed D decision. Optional until the actual owner record is authenticated. |
| `/var/lib/gk-v2-private-journal/experiment/proposal-observations/<operation digest>` | Append-only original checkpoint/proof opener and final consumed-state cut. There is no synthetic final in the original operation archive. |

The original production/status config and all existing journals retain their original bytes. New private sidecars use atomic no-clobber publication. Strict D reads reject unresolved staging hard links without unlinking or repair. An operator must inspect an incomplete publication rather than silently reconstruct it. These guarantees cover local append-only custody; external rollback of an entire volume remains an operator custody concern.

## Qualification input contract

The protected authority uses `GK_AUTHORITY_PROPOSAL_OBSERVATION_PROOF`. The production parent and child use `GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF`. Both contain the same bounded, nonsecret JSON descriptor, with a maximum of 32,768 UTF-8 bytes:

```json
{
  "schema": "gk-learning-proposal-observation-source-proof-v1",
  "sourceProof": {
    "schema": "gk-learning-proposal-observation-gate-proof-v1",
    "repository": "appliedai-au/gate_keeper",
    "sourceCommit": "ACTUAL_MERGED_D_40_HEX",
    "qualification": {
      "commentId": 123,
      "bodySha256": "EXACT_OWNER_COMMENT_BODY_64_HEX",
      "authorId": 456,
      "authorLogin": "AUTHENTICATED_ORIGINAL_GITHUB_OWNER"
    }
  },
  "gatePolicy": {
    "targetId": "ORIGINAL_FULL_LEARNING_TARGET",
    "presetDigest": "ORIGINAL_DOCKERFILE_QUALIFY_SHA256",
    "outputProfileDigest": "ORIGINAL_FULL_SUITE_OUTPUT_PROFILE_SHA256",
    "effectiveTreeDigest": "CANONICAL_REPOSITORY_AND_D_TREE_SHA256"
  }
}
```

Placeholders above are not deployable values. The first three gate-policy fields must equal the original frozen Learning gate. The effective-tree digest is `digest({repository:'appliedai-au/gate_keeper',gitTree:<qualified D tree SHA>})`, using the repository's canonical JSON digest. This is an explicit D source-proof context; it never mutates A's gate policy.

The owner qualification comment is on D's actual PR, starts with `GK_PROPOSAL_OBSERVATION_QUALIFICATION` followed by a newline, and contains strict JSON with exactly these fields:

```text
schema = gk-learning-proposal-observation-source-qualification-v1
repository = appliedai-au/gate_keeper
pullRequest = actual D PR number
qualifiedCommit = exact qualified candidate SHA
baseCommit = historical merged B SHA
treeSha = exact qualified candidate/merged D tree SHA
gatePolicy = exact descriptor gate policy
deployment = {projectId,environmentId,serviceId,deploymentId,finishedAt,status:'SUCCESS'}
cleanup = {complete:true,serviceId,observedAt}
checks = {node,canary,typecheck:'passed',scorerSelfTests:5}
rawLogsDigest = SHA256 of actual complete qualification logs
review = {mode,requestedHead,request,acknowledgement,approval,resolvedComments,nativeReviews}
```

Each `node` and `canary` summary is exactly `{tests,pass,fail,skipped,cancelled,todo}`. Tests must be positive; pass must equal tests; all four other counts must be zero. Cleanup is an actual observed deletion after successful execution, preceding comment creation. The service has no Railway credential and does not claim to have run qualification itself: it authenticates the pinned owner's exact observation and independently retrieves the source and review evidence.

Review contract:

- `mode` is `formal-review` or `dashboard`; `requestedHead` is the qualified candidate SHA.
- `request`, `approval` and a non-null `acknowledgement` are `{id,bodySha256}` pins. The request is by the original authenticated owner and names exact candidate plus Gitar. Bot artifacts must have the pinned Gitar ID and login.
- Formal approval is `APPROVED` on the exact qualified candidate and is submitted after the exact request/acknowledgement. Dashboard approval requires a fresh exact-head bot acknowledgement and a complete approved dashboard updated afterward.
- Each resolved historical inline finding is `{id,bodySha256,commitId,fixCommit}`. `commitId` remains the real old comment commit. The bot's fixed-by body must name the actual fix, and an independent bounded ancestry comparison must prove that fix is contained in the final candidate. Do not fabricate an updated inline commit ID.
- `nativeReviews` is the **complete current Gitar inventory**, each exactly `{id,commitId,state}`. The verifier independently paginates the live review list (100 per page, at most ten complete pages), rejects duplicate IDs/incomplete coverage, and compares it to those pins. A current-qualified-head `CHANGES_REQUESTED` remains blocking even when omitted from owner pins or when a separate dashboard says approved. Older review states remain recorded honestly.

The verifier returns a stable `qualificationEvidenceDigest` over exact descriptor/receipt facts, immutable source/qualified/base commit/tree/ordered parents and retained B qualification/authorization digests. It still retrieves fresh current main, merge relation and review inventory on every invocation. Unrelated PR metadata changes therefore do not replace the signed digest. Raw authenticated transport evidence is retained separately in D proof custody. Parent and child compare actual D commit/tree, owner pin, run, log digest and this stable evidence digest to the independently signed D qualification before opening the host.

## Operational order and environment

Existing authorizations for the scoped work remain valid. This protocol does not invent a new permission question; it requires the concrete source/owner evidence described below before the implementation can mutate its bounded state. Runtime coordination remains with the designated operator; never run concurrent driver or authority-control sessions.

1. **Preserve and quiesce.** Retain the original host fourth-failure checkpoint and the original B post-settlement authority state. Verify the original budget settlement already exists and is the ordinary B result. Do not call generic host recovery, abandon the attempt, overwrite a terminal failure, reserve another operation or create a fifth attempt. The original host's settled-call accounting can remain at 17 while authority accounting is 18 until this recovery consumes the original receipt.
2. **Review and qualify exact D.** Independently review the immutable complete patch, obtain fresh exact-head Gitar approval, execute the full existing isolated Learning gate with no skips and observe cleanup. Publish the actual qualification receipt. Merge only the qualified tree with ordered B/candidate parents; derive actual D. No model call is part of qualification. A preparation-only draft or its separate qualification cannot substitute for this integrated packet.
3. **Start qualified D authority in serve mode.** Keep `GK_AUTHORITY_CONFIG` and `GK_AUTHORITY_SOURCE_PROOF` describing original A, existing custody/trust/provider origin/token, scoped driver token and existing model registration. Set `GK_AUTHORITY_MODE=serve` and the new `GK_AUTHORITY_PROPOSAL_OBSERVATION_PROOF`. Clear the old `GK_AUTHORITY_IMPLEMENTATION_PROOF` input and `GK_AUTHORITY_BASE_CONTINUATION_AUTHORIZATION`; their protected B files/history remain untouched. Do not set initialization or registration commands. `RAILWAY_GIT_COMMIT_SHA` must be actual D from the platform. D independently verifies source before creating its separate proof namespace. Qualification alone permits status and preparation; it cannot admit/dispatch ordinary work.
4. **Prepare through the existing authenticated channel.** On actual D production host set `GK_PRODUCTION_PROPOSAL_OBSERVATION_PROOF` and `GK_PRODUCTION_COMMAND=prepare-proposal-observation`, with existing original config/authority connection. The parent authenticates typed D status and publishes only new create-once D sidecars after verification. The child independently checks source again. The host reads its own existing journals and sends its bounded original checkpoint through the existing authenticated `prepareProposalObservation` RPC (8 MiB request limit, 16 MiB response limit). No file upload or credential/signing-key transfer is needed. The authority compares original plan, lease, owned intent, original settlement and provider evidence, then performs GET/list reads only. The signed later observation is stored in the new D namespace. CLI output is a bounded digest summary, not private output/prompt/runtime IDs.
5. **Authenticate a concrete owner decision.** Construct the exact public owner comment below using the actual returned signed preparation's digests. It must be created after that preparation. Set `GK_AUTHORITY_PROPOSAL_OBSERVATION_AUTHORIZATION` to `{commentId,bodySha256}` for a controlled authority serve restart. The protected method independently retrieves and authenticates the owner record, confirms the original post-settlement authority head is unchanged, and appends authorization only in D custody. The driver RPC cannot publish this owner decision.
6. **Consume and stop.** Set `GK_PRODUCTION_COMMAND=consume-proposal-observation`. Parent/child verify actual D and authenticated owner scope, fetch/persist new proof sidecars, and reopen original host state. The consumption path has no remote settlement, SDK, admission or signing capability. It appends only the new observation/link and existing invalid-consumption/settlement transitions. Successful return says `recovered:true`, `attemptNumber:4`, `disposition:'invalid'`, `additionalModelCalls:0`, with safe status. It exits immediately; it does not call the pilot run loop. Verify four invalid host dispositions, all five operations settled, eighteen original actual calls, no pending execution, unchanged A/B artifacts and the original unknown-price settlement.
7. **Reopen and decide the next invocation.** Verify mandatory D sidecar/link and original failure on fresh status and process reopen. A missing or altered sidecar must fail. If the authenticated owner comment explicitly has `allowRemainingExperiment:true`, a separate `GK_PRODUCTION_COMMAND=run` may continue attempts five through ten under actual D and the original policy. Other ordinary D driver operations also require that explicit scope plus the completed local consumed-state proof. A repeated consume at the same four-attempt closed cut is a zero-write read; after attempt five or any later history it holds and cannot become historical replay.
8. **Complete and archive honestly.** Preserve both B and D source/proof lineages. Complete exactly ten genuine proposal attempts and any required signed novelty decisions/three confirmation pairs for promotion under frozen policy. Keep unknown price unknown, keep negative examples, and never retry a negative or failed attempt to improve the result. D does not change the ten-attempt policy, +/-1 scorer, no aggregate cap, or the waived Spekky gate. After the pilot and activation/accounting/driver disablement are complete, an explicit versioned C archive implementation must prove A/B/D history before ordinary review serving can claim that completed history.

`GK_AUTHORITY_RECONCILIATION` is not an input to this recovery. The ordinary B settlement already exists. Source D also refuses generic reconciliation of the recovered original fourth operation. No new remote settle or retry method is introduced by this protocol.

## Public owner authorization

The owner comment on D's PR starts with `GK_PROPOSAL_OBSERVATION_AUTHORIZATION` and a newline, then exactly:

```json
{
  "schema": "gk-learning-owner-proposal-observation-v1",
  "purpose": "qualified-original-fourth-invalid-proposal-observation",
  "experimentSourceCommit": "A_40_HEX",
  "historicalImplementationCommit": "B_40_HEX",
  "implementationCommit": "D_40_HEX",
  "implementationTree": "D_TREE_40_HEX",
  "configDigest": "ORIGINAL_FROZEN_CONFIG_64_HEX",
  "qualificationDigest": "DIGEST_OF_SIGNED_D_QUALIFICATION",
  "preparedProofDigest": "DIGEST_OF_SIGNED_D_PREPARATION",
  "retainedDigest": "DIGEST_OF_PREPARATION_BODY_RETAINED",
  "settlementDigest": "DIGEST_OF_ORIGINAL_SERIALIZED_SETTLEMENT_STRING",
  "allowRemainingExperiment": false
}
```

The boolean must be explicit. `false` authorizes only this bounded observation consumption; it does not authorize any remaining pilot mutation. `true` also authorizes the corrected implementation for the remaining original experiment, but the consume command still stops at four and a separate invocation is mandatory. Public comments contain digests and public source identities only. Do not paste the protected `retained` object, session/call/lease IDs, observed text, original checkpoint, tokens or private evidence artifacts.

The original settlement authenticates `operationId` and `leaseId`; it does **not** contain owner, requestDigest or callId fields. Their binding is indirect and mandatory: original signed admission → exact frozen operation/request → exactly one owned original provider intent → same input/model/session/turn/output → genuine invalid classification. D does not add invented fields to the receipt or infer a zero charge. `actualCalls` is one; `actualMicros` remains null.

## Exact recovery prefix and invariants

The new sidecar has one atomic `authorized-observation` opener containing the checkpoint and original serialized B/D proof objects. This avoids separate claim/LINK artifact windows. A second `completed-observation` record pins the exact final controller and dispatch cut. No SDK call or authority settlement is reachable from this executor.

| Durable sidecar records | New controller records | New dispatch records | Allowed next append |
| --- | --- | --- | --- |
| 0 | 0 | 0 | Atomic original checkpoint and signed proof opener. |
| 1 | 0 | 0 | Immutable D observation link to original failure/head and exact proof bytes. |
| 1 | 0 | 1 | Original serialized B settlement observation. |
| 1 | 0 | 2 | Existing controller invalid proposal transition. |
| 1 | 1 | 2 | Existing controller settlement transition using original receipt. |
| 1 | 2 | 2 | Dispatch completion bound to that exact receipt string. |
| 1 | 2 | 3 | Sidecar completion pinning the complete consumed-state cut. |
| 2 | 2 | 3 | Read-only completed replay at exactly four attempts. |

Every resume checks the entire original hash-linked prefixes and complete permitted suffix, not just the final status. It verifies every original controller/dispatch/archive projection against the captured snapshots before any new append, then checks all heads again. Each local transition uses an expected-head guard from the full cross-journal check. An acknowledged append followed by a lost response may be resumed only from one of the exact rows above. Different proof bytes, changed request/lease, extra call, original terminal-final substitution, unknown artifact/event, missing/truncated sidecar, illegal order or uncertain publication remains held. Ordinary `OperationArchive` finality is untouched.

The original admission is validated historically; consuming a completed result does not require a fresh lease or re-admission. The original first dispatch was already admitted. D does not treat passage of time as permission to repeat it. Invalid proposals correctly retain `op.complete=false` at authority and `evidenceComplete=false` at host; these are not evaluation-completion flags. The genuine terminal owned result and original signed one-call settlement establish this particular negative outcome.

Read-only public status independently checks the sidecar and original failure on every read, including allowed in-progress prefixes. While the controller is settled but the final dispatch/sidecar cut is incomplete, it refuses a successful public status rather than presenting incomplete evidence as complete. The protected host inspection retains the exact prefix for explicit metadata completion. Ordinary new work cannot start until the final cut is complete. Original fourth unknown-price accounting remains pinned; this protocol does not introduce a later price-replacement mechanism for that closed observation.

## Mandatory isolated regression coverage

The authored tests are intended for the complete remote qualification only. No test results are claimed in this document.

- A real synthetic original 1+13 BASE continuation, three consumed invalid proposals, and original fourth `session → turn → failure` with three running host observations, no final/artifact, complete provider lifecycle events (`turn.created`, main `model.message`, `turn.done`) and ordinary B settlement.
- Actual-D qualification, historical B qualification/BASE linkage, independent owner proof, preserved source identities, no namespace writes before qualified source, and no original authority head/artifact change through qualification/preparation/authorization.
- Consume with every remote/SDK/admit/settle method throwing if touched; unchanged original operation archive and bank/bundle/gate, one original lease, eighteen original calls, original null price, four invalid outcomes and immediate stop.
- Every acknowledged-write-loss prefix, exact suffix validation before another append, fresh read-only status at each prefix, duplicate consume with zero additional writes/calls, missing sidecar after closure, changed original archive/link/request, unknown events and illegal transition order.
- No authorization, qualification-only mode, wrong actual implementation, forged signature, changed output/call/evidence, extra/ambiguous authority intent, pending review or fifth proposal, expired original admission without re-admission, and explicit separate remainder followed by a held later consume.
- Actual strengthened GitHub verifier: omitted and pinned current-head blockers, stale formal approval, full bounded native-review pagination, old inline commit with proved fix ancestry, wrong source/main/parent/owner and weakened full Learning recipe. Stable evidence digest survives unrelated PR metadata changes.
- Production parent and child wrapper paths, command denial before sidecar writes/spawn/open, exact D source-facts comparison, retained B files, strict create-once D files, no credentials in the child whitelist, and prepare CLI output redaction.
- Real-filesystem strict publication reads reject both pre-existing and newly acquired staging hard links without unlink/repair.

## Failure and rollback

Before consumption, leave the original host fourth pending and the ordinary authority settlement retained. Stop the driver; do not use generic recovery or overwrite any original file. If source proof, qualification, owner decision, provider evidence or journal validation fails, investigate the concrete mismatch and retain all evidence. An invalid source result does not authorize continuing on old B under a forged platform SHA.

After any allowed metadata prefix, restart only the same qualified actual D with the exact retained proof sidecars and invoke the bounded consume command. It finishes only missing local transitions. An unexpected/ambiguous prefix stays held for investigation. It does not reset, steal journal locks or repeat provider work.

After completion, preserve all original and new custody. Stopping D is reversible operational control; rolling the application source back to B cannot erase the D lineage or make B accept its journals. Any later implementation must be separately qualified and explicitly understand the preserved A/B/D history. C v1 remains a B-only profile until that versioned extension is implemented and qualified.
