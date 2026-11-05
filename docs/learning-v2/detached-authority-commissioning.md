# Detached production authority: commissioning and recovery

This source connects the existing production host to a separate protected
authority. The host remains the sole experiment coordinator. The authority
reconstructs each requested phase from frozen inputs and its own verified
history, owns provider access and four signing identities, and independently
retrieves the actual provider artifacts before issuing evaluation receipts.

The code was authored and reviewed as source only. No local test, build,
repository import, install, key generation, model request or commissioning is
implied by this document. Publish only the combined reviewed tree, obtain the
full remote qualification and Gitar review, and then commission that exact
merged source. The real pilot remains a separate execution result.

## Existing deployment to repurpose

Use the completed gk-native-runner in the earlier learning environment:

| Resource | Exact identity |
| --- | --- |
| Project | a8f4c4a4-0f32-4166-ba92-dad9baf2b652 |
| Environment | 03fb9181-2f19-409b-a9b1-823cb32e56c2 |
| Service | e885493f-229a-40ea-8ba5-04f55dd6465d |
| Existing volume | Preserve the existing /data mount |
| Historical bank | /data/gk3-rule-bank.json, read only |
| Authority custody | /data/gk-v4-authority, separate private directory |
| Public authenticated authority API | Port8080 |
| Private scoped provider relay | gk-native-runner.railway.internal:8787 |

Use Dockerfile.authority and an explicit start command:

    node /app/scripts/learning-v2/authority-service.mjs

Do not execute the old GK3_BOOT_B64 or legacy paid boot. Do not reattach an old
deployment whose saved start command can override current configuration.
Connecting the reviewed source SHA applies the current Dockerfile/start
configuration; verify the resulting deployment metadata before proceeding.
No additional service or credential copy to another project is required.

The production driver remains in its existing production service/journal.
It receives only the driver bearer token, frozen bundle/public pins, and its
separate owner-status read token. It does not receive provider credentials or
private signing keys.

## Required protected configuration

Existing authorized variables stay on this earlier service:

- TRUEFORGE_BASE_URL: exactly http://trueforge.railway.internal:8080.
- TRUEFORGE_TOKEN: the existing authorized Gate Keeper TrueForge credential.
- GK_TFY_PAT: the existing authorized TrueFoundry credential.

New variables:

- GK_AUTHORITY_MODE: initialize or serve.
- GK_AUTHORITY_CONFIG: the JSON configuration below.
- GK_AUTHORITY_DRIVER_TOKEN: one new scoped bearer credential, at least32
  non-whitespace characters, shared only with the production driver.
- GK_AUTHORITY_SOURCE_PROOF: the public evidence descriptor below, required in
  serve mode.
- GK_AUTHORITY_REGISTER_PROVIDER: set to1 for the explicit first registration.
- PORT:8080.

The initializer creates four distinct Ed25519 private keys on the protected
volume. It creates a random private relay prefix once. Later opens verify and
reuse those exact identities, prefix and bundle. There is no rotation,
replacement, journal reset or credential discovery fallback.

GK_AUTHORITY_CONFIG has these exact fields:

    {
      "schema": "gk-learning-authority-config-v1",
      "ownerId": "<the frozen production owner identifier>",
      "experimentId": "<one new fixed experiment identifier, maximum48 characters>",
      "sourceCommit": "<the actual qualified merge SHA,40 lowercase hexadecimal characters>",
      "serverVersion": "0.182.0",
      "model": "gk-v4-authority/glm-5-3-flash",
      "upstreamModelId": "tfy-managed/glm-5.3-flash",
      "gatewayId": "<one fixed scoped gateway identifier>",
      "reviewerId": "<the selected independent semantic reviewer identifier>",
      "legacyBankFileDigest": "2f679a49712b9dbefc992c03a1437ec9dff7e2f989b90bcb130aa3a4dc42b7ab",
      "gatePolicy": {
        "targetId": "gatekeeper-production-learning-v4",
        "presetDigest": "d89425eeddad71f79bcf3db105c073e22a6d2644a0e0b8c8f809363e5df9ddfe",
        "outputProfileDigest": "ee24ee6b8cb9e3fd945c33ed3e39c639dc311e8ae6cbba1124f2f874aa004139",
        "effectiveTreeDigest": "<digest of the exact Git tree record below>"
      }
    }

The preset is the complete combined Dockerfile.qualify, including actual
Caddy qualification. Its bytes are independently fetched from the qualified
source and must match the preset digest. The output profile is SHA256 of:

    gate-keeper:qualification-receipt-v1:all-tests-pass:no-skips:explicit-cleanup

effectiveTreeDigest is the existing contracts.digest of this record:

    {"repository":"appliedai-au/gate_keeper","gitTree":"<qualified Git tree SHA>"}

The contract digest uses canonical JSON with sorted object keys. It is not the
raw Git tree SHA or the SHA256 of an arbitrary pretty-printed JSON file.

The intended backend version is0.182.0. Before generating any keys or registering
the provider, the service reads the actual installed backend's /healthz and
requires its version to match. It repeats this check before each new admission.
A mismatch is printed as a bounded version observation and stops commissioning.
No declaration in this document substitutes for that live observation.

## Initialize, then serve

1. Preserve the real /data volume and historical bank. Configure the exact
   qualified source, Dockerfile.authority, explicit command and initialize mode.
   The read-only bank projection is rebuilt from the actual fixed bank path.
   The initializer checks the original file digest before freezing the bundle.
   Source and the actual server version are checked before key initialization.
2. Initialization is a one-shot remote process. It writes private identities,
   the stable relay prefix and the immutable frozen bundle. Its only public
   identity output is GK_AUTHORITY_PUBLIC_CONFIG with binding, both bank
   digests and four public fingerprints/gatewayId.
3. Copy those public pins/configDigest into the operator-supplied production
   bootstrap descriptor. The canonical projection digest for the recovered
   revision65 bank is
   549a00b379e7819cd6b0ea1141f58d4ded306cb1a41c7909de186ee531f568f2.
   The live initializer must reproduce it; do not override a mismatch.
4. Publish the actual qualification receipt after successful qualification,
   real disposable-service cleanup, merge and final Gitar dashboard update.
   Configure GK_AUTHORITY_SOURCE_PROOF and switch to serve mode.
5. Set GK_AUTHORITY_REGISTER_PROVIDER=1 for the new scoped provider registration.
   The old tfy-direct provider remains unchanged. Registration uses the existing
   GK_TFY_PAT on this service and a stable private route. No model call occurs
   during registration. Subsequent starts with already admitted operations
   verify the provider route/model without registering it again.
6. Expose the authenticated8080 API on an HTTPS domain. Only /healthz is public
   without authentication. GET /v1/gatekeeper/bootstrap returns the exact frozen
   bundle after driver bearer authentication. The production driver pins and
   verifies that bundle before create-once journal installation.
7. Verify GK_AUTHORITY_READY, the actual server-version observation, driver
   bootstrap pins, anonymous owner-route denial and authenticated status before
   explicitly starting the existing production driver.

Expected safe markers:

- GK_AUTHORITY_SERVER_OBSERVED: actual version, status ok/mismatch and time.
- GK_AUTHORITY_PUBLIC_CONFIG: public fingerprints and frozen binding/digests.
- GK_AUTHORITY_READY: authenticated service and scoped private provider ready.
- GK_AUTHORITY_REVIEW_APPLIED: protected exact-context review accepted.
- GK_AUTHORITY_OPERATION_RECONCILED: protected accounting recovery retained.
- GK_AUTHORITY_START_REFUSED: startup did not satisfy a required boundary.

Generic refusal messages intentionally omit SDK exception bodies and secrets.
Use the protected operator status export below for exact durable call state.

## Exact source qualification receipt

GK_AUTHORITY_SOURCE_PROOF is:

    {
      "schema": "gk-learning-source-proof-v1",
      "repository": "appliedai-au/gate_keeper",
      "sourceCommit": "<actual merged source SHA>",
      "qualification": {
        "commentId": 0,
        "bodySha256": "<SHA256 of the exact comment body bytes>",
        "authorId": 0,
        "authorLogin": "<authenticated owner who published the actual receipt>"
      }
    }

The positive numeric IDs above must be the actual IDs, not zero. Publish the
owner comment body as the literal line GK_AUTHORITY_QUALIFICATION, a newline,
and one JSON object with these exact fields:

    {
      "schema": "gk-learning-source-qualification-v1",
      "repository": "appliedai-au/gate_keeper",
      "pullRequest": 0,
      "qualifiedCommit": "<tested and reviewed exact PR head>",
      "baseCommit": "<the actual first parent of the merged source>",
      "treeSha": "<tested head tree, equal to merged source tree>",
      "gatePolicy": "<the exact gatePolicy object, not a string>",
      "deployment": {
        "projectId": "<actual disposable qualification project>",
        "environmentId": "<actual qualification environment>",
        "serviceId": "<actual disposable qualification service>",
        "deploymentId": "<actual SUCCESS deployment>",
        "finishedAt": "<actual terminal UTC timestamp>",
        "status": "SUCCESS"
      },
      "cleanup": {
        "complete": true,
        "serviceId": "<the same actual disposable qualification service>",
        "observedAt": "<actual observed deletion time, after SUCCESS>"
      },
      "checks": {
        "node": {"tests":0,"pass":0,"fail":0,"skipped":0,"cancelled":0,"todo":0},
        "canary": {"tests":0,"pass":0,"fail":0,"skipped":0,"cancelled":0,"todo":0},
        "typecheck": "passed",
        "scorerSelfTests": 5
      },
      "rawLogsDigest": "<digest of the retained actual complete qualification logs>",
      "review": {
        "mode": "dashboard",
        "requestedHead": "<same qualifiedCommit>",
        "request": {"id":0,"bodySha256":"<actual exact-head owner request body hash>"},
        "acknowledgement": {"id":0,"bodySha256":"<actual exact-head Gitar acknowledgement hash>"},
        "approval": {"id":0,"bodySha256":"<actual final approved dashboard hash>"},
        "resolvedComments": [],
        "nativeReviews": [{"id":0,"commitId":"<actual native review commit>","state":"COMMENTED"}]
      }
    }

Replace all example counts and IDs with actual evidence. Node and canary totals
must be positive, equal their pass counts, with all failure/skip/cancel/todo
counts zero. Cleanup must already have happened before the comment is created.

The authority independently retrieves the owner comment, qualified and merged
Git commits, current main, actual Dockerfile, PR and pinned Gitar artifacts.
It requires exactly ordered merge parents [baseCommit,qualifiedCommit], equal
tested/merged trees, and current main equal to the deployment's source.

Dashboard mode requires an authentic Gitar bot acknowledgement that names the
full exact head and a queued/current review, followed by an approved dashboard.
Native COMMENTED reviews remain COMMENTED. Formal-review mode instead requires
an actual APPROVED GitHub review on the exact head. An old inline finding whose
commit_id does not equal the final head can be omitted from resolvedComments;
the complete approved dashboard remains pinned.

The execution trust boundary is explicit: the pinned authenticated owner
attests actual Railway execution and cleanup using the actual connector logs.
The authority independently retrieves that receipt and source/review evidence;
it has no broad Railway token and does not pretend it ran the tests itself.
The first verified managed-gate receipt is durable-cached across review restarts.

## Independent semantic review and continuation

A completed paid proposal is independently fetched, parsed and bound to its
owned SDK session/turn, exact source/config/candidate/history digests and all
retained prior procedures. A non-duplicate candidate creates a durable review
queue and returns GK_AUTHORITY_REVIEW_PENDING. The driver stops with the
original admitted operation and archived paid proposal intact.

To export the review packet through the authenticated Railway control plane,
set GK_AUTHORITY_EXPORT_REVIEW to its exact operationId and restart the same
qualified service only when no provider call is active. The service emits:

- GK_AUTHORITY_REVIEW_BEGIN: reviewId, contextDigest, bytes, parts and sha256.
- GK_AUTHORITY_REVIEW_PART: reviewId, zero-based index and base64 data.
- GK_AUTHORITY_REVIEW_END: reviewId, parts and sha256.

Concatenate decoded parts in order and verify the byte count and SHA256 before
review. The packet includes the entire retained bank projection, normalized
references/outcomes, candidate, supplied code and applicability manifest. It
does not contain signing keys, provider credentials, SDK transport headers or
hidden check oracle labels. No candidate text is itself evidence of novelty.

The independently selected reviewer compares conditional procedures, including
their language/stack/guard restrictions, against every prior reference. Root
can relay that actual review via GK_AUTHORITY_REVIEW_DECISION:

    {
      "schema": "gk-learning-authority-review-v1",
      "reviewId": "<exact pending ID>",
      "contextDigest": "<exact pending context digest>",
      "reviewer": {"id":"<configured independent reviewerId>","evidenceRef":"<actual retained review reference>"},
      "verdict": "novel",
      "comparisons": [{"priorId":"<every prior ID once>","relation":"distinct","reason":"<actual semantic reason>"}],
      "coverageCaseIds": ["<actually applicable frozen case IDs>"],
      "coverageReasons": [{"caseId":"<each covered case once>","reason":"<actual code applicability reason>"}]
    }

The alternative verdicts are equivalent and uncertain; comparison relations
are distinct, equivalent and uncertain. String differences never establish
novelty. Missing/inconclusive comparisons block advancement, remain retained
and do not trigger a hidden judge call.

After the protected decision is applied, explicitly resume the same proposal
through the production driver's resume-review action. Its host consumes the
original archived procedure and newly retrieved independent novelty receipt,
then settles the original lease. It never reruns the executor or paid proposal.
Conflicting replacement decisions are rejected. Remove stale export variables
once the original packet is retained to avoid unnecessary log repetition.

## Safe accounting recovery and observability

Set GK_AUTHORITY_EXPORT_STATUS=1 for GK_AUTHORITY_OPERATION_STATUS. This bounded
operator summary contains operation/lease/request IDs, active call ID, SDK
stage counts, definite upstream HTTP-response counts, ambiguous dispatch
claims, independent verification/settlement state and pending review IDs.
It contains no prompts, raw provider responses, headers, tokens or keys.

The relay claims one exact owned HTTP body before its single upstream POST.
It checks the complete documented system wrapper, one user message, model and
parameters, the sole built-in current-date tool definition and stream options.
A second POST or unrelated prompt is refused before forwarding. Actual tool
use remains disqualifying evaluation evidence. The initial/final SDK model
events share an ID and are observations; they are not the accounting count.

An HTTP response establishes one actual outbound request even when it returns
an error. A claim without an observed HTTP response remains ambiguous and
outstanding across restart. Neither timeout nor a missing response establishes
zero usage. SDK session/turn intents without resolved IDs cannot be retried.

For a definitively terminal failed execution, or a durable admission with no
session/turn/HTTP intent at all, an operator may set:

    {
      "schema": "gk-learning-authority-reconciliation-v1",
      "mode": "failed-execution",
      "operationId": "<original owned operation>",
      "leaseId": "<original lease>",
      "requestDigest": "<original request>",
      "reason": "<actual independently inspected failure and retained evidence>"
    }

Use that JSON as GK_AUTHORITY_RECONCILIATION. The service refetches terminal
provider artifacts, retains the actual count and signs only accounting
settlement. It does not claim evaluation success or dispatch another slot.
The production driver's explicit reconcile-operation action fetches those
already protected receipts and calls host.recover on the original operation.

Use mode settlement-only only for a complete original result already consumed
by the host whose settlement response was lost. The driver requires its actual
durable operation.consumed===true before recovery. An unconsumed final result
remains held for original-evidence continuation. A completed proposal awaiting
semantic review cannot be erased through failed-execution reconciliation.

Per-run prices remain explicitly null unless authentic actual billing evidence
exists. TrueForge totalCostInUsd is an estimate and is never signed as an actual
charge. The implemented usage-reconciliation endpoint truthfully returns
unknown; this integration has no independently verified actual invoice API.
Unknown pricing remains visible in the existing RunBalance and does not impose
an aggregate spending cap or fabricate an uncharged call.

## Promotion and retained evidence

Only independently scored screen evidence followed by all three fresh,
alternating paired confirmations can produce a confirmed version. The
authority recomputes the controller's exact confirmation evidenceDigest.
Activation uses a separate protected signing identity and is limited to this
experiment's incumbent. The existing host independently verifies and applies it.

A lost activation response is replayed byte-for-byte while timely. After
expiry, authenticated replay may append a renewed authorization with the same
original incumbent, target, action and evidence; original envelopes remain
retained. The host's incumbent precondition prevents consuming it after an
already completed activation. This recovery performs no inference.

The frozen corpus is the actual t4/t5/t6 development family from the recovered
runner: five fit cases and two already-burned t6 check cases,16 expected bugs.
It is not sealed-holdout evidence. The full original bank remains untouched;
legacy outcomes are historical references, not new signed promotion results.
Every new negative, duplicate, uncertain and confirmed outcome remains durable.
