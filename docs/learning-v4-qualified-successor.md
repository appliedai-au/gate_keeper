# A qualified successor before the first recovery installation

PR61's v1 recovery source requires the actual merge's first parent to be the
historical B implementation. That is correct for the first release. A repair on
top of that merged release must not pretend that its first parent is still B.

The nested source gate proof now has an explicit v2 variant. It names exactly
one complete v1 predecessor proof. This is a release-proof extension, not a
journal migration, credential workaround, owner execution permission, or
permission to bypass a blocked platform operation.

## Exact chain

Let B be the historical implementation already bound by the original signed B
qualification and continuation. Let D be the previously qualified recovery
merge, and E the new successor merge:

- E has exactly ordered parents [D, E-qualified-candidate].
- D has exactly ordered parents [B, D-qualified-candidate].
- Both candidates' trees must exactly equal their respective merged trees.
- E is the actual platform source and live current main.

Both legs independently retrieve their owner qualification comment, complete
source/PR/tree/ordered-parent evidence, actual pinned Dockerfile recipe, review
request/acknowledgement/approval, complete native-review inventory, test counts
and cleanup attestation. The predecessor is not an arbitrary ancestor. There
is no recursive chain or parents-contain shortcut. The owner ID/login and the
full target, recipe and output-profile policy must match on both legs and match
historical B. The two qualification deployment IDs must differ. The predecessor
qualification must not postdate the successor qualification.

Both legs observe real current main equal to E. The predecessor never fabricates
a response saying D is current. E rechecks main after the predecessor's complete
verification. Any missing or changed evidence, rate limit, failed network read,
open review or invalid qualification holds rather than skipping a gate.

## Descriptor shape

The outer production descriptor remains
`gk-learning-proposal-observation-source-proof-v1` with exactly `schema`,
`sourceProof` and `gatePolicy`. Its nested `sourceProof` is either:

1. The unchanged `gk-learning-proposal-observation-gate-proof-v1` with exactly
   `schema`, `repository`, `sourceCommit`, and `qualification`; or
2. `gk-learning-proposal-observation-gate-proof-v2` with those four fields plus
   `previous`, containing the complete previous outer v1 descriptor. The
   previous nested gate proof MUST be v1. Additional/nested predecessors refuse.

The successor's sourceCommit and qualification pin name E and its own receipt.
The embedded previous sourceCommit and pin name D and D's receipt. The previous
and successor gatePolicy effective-tree digests name their own trees; the other
policy fields must match. There are no credentials or signatures in this public
descriptor. Existing 32,768-byte production descriptor bounds still apply.

## Signed facts and installation boundary

V1's canonical qualified-facts projection remains byte-compatible. V2 uses the
distinct `gk-learning-proposal-observation-qualified-facts-v2` schema and includes
the verified predecessor descriptor, qualification receipt, source, candidate and
base commit/tree/ordered-parent identities. The authority signs the actual E
qualification with this digest. An old D signature does not qualify E. Parent
and child both independently recompute and compare these facts before use.

This extension supports the observed release position: the live authority and
host are still B, and D has NOT installed recovery qualification/preparation/
authorization sidecars. It does not upgrade an already installed D recovery.
The existing private create-once namespace stays create-once. Existing D files,
if present, must fail the actual-E identity check and must NOT be removed,
overwritten, relabelled or replaced. A separate reviewed migration would be
needed for that different state. Original A/B files, keys, bank, failed archive,
provider evidence and journal prefixes are unchanged.

Only the source verifier and its versioned evidence projection change. The
signed preparation and owner authorization still bind the actual implementation
and exact retained fourth call. Consumption still adds zero model calls and
returns before attempt five. The ordinary remainder still requires its separate
explicit permission and completed local observation linkage.

## Dashboard repair

The review verifier now reads the actual approved Code Review section (or the
fixed plain summary), excluding quoted/code/comment examples and other sections.
Explicit counts take precedence: nonzero-open counts, conflicting counts,
noncanonical/oversized counts and malformed count summaries refuse. The suffix
of `10 findings` or `100 open` is never a zero-finding statement.

## Required qualification

Run the unchanged complete Dockerfile.qualify on the exact candidate in an
isolated credentialless Railway service, including all earlier recovery,
production-wrapper, privacy and scorer tests. New tests cover the actual source
verifier's dashboard acceptance/refusal and the exact successor chain, both
recipes and review inventories, B anchoring, real current-main changes, distinct
qualification runs, immutable fact digests and refusal of old D signatures.

Keep source review, Gitar approval, executed tests, actual service cleanup, merge,
deployment and genuine live fourth-result recovery as separate evidence. No
Spekky gate is required by Owen's current project instruction. This document
does not claim that any of those operational steps has completed.
