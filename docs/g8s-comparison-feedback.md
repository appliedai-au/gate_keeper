# G8S comparison capture and feedback API

9 November 2026. Additive implementation for issue #76; stacked on the deployed HTTP-role source `bea1a558213981e29f3d164a4949c536f075dba6`.

## What this increment does

After an independent G8S PR review is complete, an authorized owner can collect actual Gitar review artifacts from GitHub, inspect both sides, label an item, link it to a corresponding item from the other tool, correct a judgment, and export explicitly selected training candidates. Source captures and judgment history are versioned. Deletion erases imported content and rationale, leaving a content-free identity tombstone and audit metadata.

This does NOT initiate either reviewer, post a GitHub comment, call a model, automatically train, promote a learned pack, or fine-tune model weights. Parallel PR-trigger orchestration, shadow publication and held-out evaluation remain separate work. The existing G8S worker cannot read this comparison store and receives no comparator output through this change. Because the existing worker publishes its result and Gitar may subsequently see it, independence is reported as unverified rather than assumed.

## Deployment and authorization

The module composes inside the same product runtime, behind `G8S_COMPARISON_ENABLED=enabled`. It requires an explicit separately applied `scripts/product/comparison-schema.sql`, and configured immutable comparator identity in `G8S_GITAR_BOT_ID` and `G8S_GITAR_BOT_LOGIN`. These are public identity pins, not model credentials. Validate them against authenticated GitHub artifacts before commissioning; a display name alone is not authority. An enabled feature with missing schema/identity returns setup_required on its routes without disabling existing sign-in.

Current-session owners only, matching the product's existing owner-isolation rule. Client review API keys do not implicitly grant comparison, training-data or credential-management access. Mutations require exact frontend Origin, `X-G8S-Request: 1`, JSON, and the HttpOnly session cookie; the body cannot choose an owner. Read/write boundaries recheck current session, user, repository and installation authorization. Revocation or repository disablement after GitHub I/O prevents capture commit. Owners can still erase their imported content when a repository is disabled.

No startup DDL. No new GitHub App permission: collection mints a repository-scoped installation token with pull_requests READ rather than write, and uses only review/comment GETs afterward. Post-review calls explicitly refuse through that read-only client. Credentials remain server-side. The configured GitHub App, product schema, active session and completed G8S review are still prerequisites; this feature does not bypass the outstanding live sign-in setup.

## Endpoints

Prefix: `/gatekeeper/product-v1/comparison-v1/orgs/{slug}/comparisons`.

| Method/path | Action |
|---|---|
| GET prefix `?page=0` | List the owner's nondeleted accessible comparisons, 20 per page |
| POST prefix | Capture comparator output for `{ "runId": "<G8S UUID>" }` |
| GET `/{comparisonId}` | Current snapshot, both source collections, feedback and non-inflated counts |
| GET `/{comparisonId}?version=1` | Historical immutable capture and judgments attached to it |
| POST `/{comparisonId}/feedback` | Append a judgment or correction; requires Idempotency-Key |
| GET `/{comparisonId}/candidates` | Explicitly selected candidate items with feedback and provenance, NOT a ready-to-train dataset |
| DELETE `/{comparisonId}` | Erase comparison content with `{ "confirmed": true }`; retain non-recreation tombstone |

POST capture verifies current GitHub collaborator authority and exact PR head/base/target branch before and after bounded collection. It refuses if the live PR has moved from the selected G8S review. Historical PR ingestion requires a separate proven revision protocol, not a timestamp guess. No client-supplied comparator body or URL is accepted. Identical repeated captures return the same snapshot; edited source appends a new version. A new version does not inherit old judgments silently.

Feedback body:

```json
{
  "snapshotId": "00000000-0000-4000-8000-000000000001",
  "itemKey": "gitar:inline:123",
  "expectedRevision": 0,
  "verdict": "valid_defect",
  "rationale": "Confirmed against the code and regression test.",
  "trainingUse": "candidate",
  "linkedItemKey": null
}
```

The example IDs are illustrative, not real user data. Valid judgments: valid_defect, false_positive, intentional, duplicate, already_fixed, insufficient_context, severity_correction, retracted. Training use is excluded or candidate; retracted items must be excluded. An optional linked key must exist in the SAME frozen snapshot and belong to the OTHER tool. A linkage is a human statement, not a machine-proven equivalence.

A stable 16–128 character Idempotency-Key is required for feedback. Same key/body returns the original revision; changed body refuses. expectedRevision starts at zero and must match the latest saved judgment. Revision or snapshot conflicts require readback; no unconditional overwrite or automatic mutation retry.

## Evidence semantics

Gitar artifacts must come from the configured immutable bot ID, exact bot login and Bot type, on the selected repository/PR. A familiar but foreign or reused login is ignored. Bounded collection reads native reviews, inline comments and PR conversation comments; it refuses oversized, duplicate-page or incomplete pagination rather than returning a fabricated clean review. GitHub pagination is not an atomic database snapshot: each source's identity, update time, raw payload digest and selected original content are retained.

Native review commit_id establishes a head SHA. Inline comments use original_commit_id so repositioned comments are not relabeled as new findings. Neither supplies independently proven base SHA. Therefore a matching head is `head_only`, not exact head+base verification. An ordinary issue-comment dashboard is `unbound` even when its prose mentions a commit. Different heads stay visible and explicitly labeled, not silently combined. Pending reviews are not submitted output. Approval text, praise and Markdown headings are not parsed as defects.

The comparison stores G8S run/head/base/branch/model/result and findings separately from GitHub artifacts. There is no claim that one review body equals one finding. Metrics distinguish G8S findings, comparator artifacts, matching-head/unbound/different-head items, human-adjudicated items and candidate selections. Missing output is no_output_observed. Precision, recall, winner and unknown comparator model/cost remain null. Automatic training eligibility stays false; independent review generation, base binding and an unseen evaluation split must be established before promotion.

## Privacy, retention and bounds

Data stays in the owning user's organization. No repository content or real review body belongs in this public source repository, test logs or audit details. Imported bodies are untrusted display text, never HTML or executable instructions. Audit contains identities/counts only, not source text, rationale, session hashes or tokens.

This first bounded implementation caps active-and-tombstoned comparison identities per owner (default 200), snapshots per comparison (default 10), artifact count/bytes, feedback history and request rates. Capture consumes ten units of the 120-unit owner/minute HTTP allowance; reads/judgments consume one. These are technical service bounds, not a pricing plan. A deleted run identity cannot silently recreate erased private evidence. Database backup/PITR retention is a separate operational policy; logical deletion is not a claim of instant backup erasure. Original G8S run records are not erased by comparison deletion.

## Dashboard integration contract

The existing Base44 app and session provider remain authoritative. Add Compare to a COMPLETED G8S review only when the service capability is commissioned. Render G8S findings and Gitar source artifacts separately with source links, commit labels, capture/version selection and explicit uncertainty. Use feedback controls with a rationale, excluded/candidate switch, current revision and stable request identity. Deletion needs explicit confirmation and readback. Do not show a percentage advantage or a live Train button from these endpoints.

Do not pass new actions into the existing read-only report hook without extending its fixed contract and tests. Use the existing current-session/scoped transport, never a second independent session provider or long-lived token in browser storage. Keep preview network-inert. This repository change does not itself install a Base44 page or claim hosted UI interaction acceptance.

## Verification

`Dockerfile.comparison-qualify` requires all new contract/handler tests, existing product/client/API-serving tests, the unchanged real product/client PostgreSQL suites, and a fresh independent PostgreSQL comparison suite. The comparison suite covers concurrent capture/feedback, revocation, immutable history, conflict and idempotency behavior, audit privacy, rollback, actual loopback HTTP, deletion and no model activation. Synthetic test data only; no live GitHub review/model invocation.

Actual terminal evidence and independent source review belong on the implementation PR. The recipe is targeted comparison integration, not the archived historical full release gate. Accepted #73/#75/#77/#78 heads, archive source/verifiers, production deployment and private credentials are unchanged by authoring this tranche.

Primary API references: https://docs.github.com/en/rest/pulls/reviews ; https://docs.github.com/en/rest/pulls/comments ; https://docs.github.com/en/rest/issues/comments . These describe available source fields, not G8S deployment status.
