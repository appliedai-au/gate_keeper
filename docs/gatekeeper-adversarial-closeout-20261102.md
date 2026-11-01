# Gate Keeper agent and process — adversarial closeout

**Date:** 2026-11-02  
**Scope:** the Gate Keeper review product/agent (`agent/instructions.md`, `agent/methods/adversarial.md`, `agent/skills/review-checklist`), proof harness, evidence, user-facing disclosure, and remaining work. TrueForge is the underlying runtime; this is **not** a review of TrueForge's own native reviewer.

**Source branch:** `fix/gatekeeper-adversarial-closeout-20261102`, PR #27 into draft Gate Keeper integration PR #7. No production inference or deployment was authorised by this audit.

## Adversarial objectives and failure tests

A hostile actor may: place instructions inside code comments or a tool response; submit a line-correct finding with a false explanation; provide malformed JSON or duplicate/noisy findings; rely on prior fixture/session memory to contaminate a hidden test; exploit a partial or failed grading response to inflate precision; scrape logs for private session IDs or holdout-only metrics; mistake historical estimated token costs for sponsor-funded receipts; claim a live Base44 demo demonstrates a running Gate Keeper agent; or select an expensive/unqualified model from the 20-model public catalogue.

Gate Keeper must never turn one of these conditions into silent permission, a verified measurement or a signed PASS.

## Findings and source corrections

| ID | Severity | Failure mode | Correction | Verification |
|---|---|---|---|---|
| GK-A01 | High | One candidate session reused across successive tasks per arm/trial. Prior public/holdout code and candidate outputs can influence later reviews, while report implies independent tasks. | Fresh candidate TrueForge session per (task, arm, trial), and fresh adjudicator session per task. No new benchmark turns were made in this correction. | Unit regression checks unique session IDs and task isolation. Existing frozen historical runs remain as originally recorded and cannot be retroactively corrected. |
| GK-A02 | High | `GK_PROOF_PUBLIC_DATA` printed TrueForge session IDs, names/hashes of private evidence files and holdout-only breakdowns. Session export errors also included internal identifiers. | Public log now contains aggregate inventory count, no private item paths, no session ID or hidden task ID; full evidence remains in private owner storage. Restrict public aggregates to all/public, not holdout-only metrics. | Offline E2E regression confirms session IDs, private paths and holdout-specific aggregates are absent. |
| GK-A03 | High | Deterministic defect-location matching gives a match even if the reviewer invents a subsidiary failure mode (confirmed by the initial DeepSeek Playground response). | Gate Keeper prompt/checklist requires falsifying each material claim and checking runtime semantics; blinded adjudicator must mark an explanation incorrect if any material subsidiary assertion is false. New `explanation_validated_precision` and `unsupported_explanations` distinguish a location match from a trustworthy explanation. | False-explanation synthetic canary retains location match but scores 0 semantic explanation correctness. The original DeepSeek verdict remains INCONCLUSIVE. |
| GK-A04 | Medium | Reviewer finding parser silently dropped malformed array elements and coerced invalid fields, hiding noisy output; unjudged findings were excluded from optimistic recall/precision denominators. | Reject malformed finding objects/invalid line/category/severity/comments; incomplete adjudication returns null precision and recall rather than an apparently complete score. | Negative tests for malformed JSON, invalid records and missing grader decisions. |
| GK-A05 | Medium | Runs and Evidence shared a mounted component, so the evidence-limitations disclosure could be collapsed on entering Evidence. | Remount benchmark component using `key={page}`. | Exact JSX regression and source-only build. |
| GK-A08 | High | `run.mjs` copied TrueForge's turn cost estimate into a field named `actual_cost_usd`, which can be mistaken for reconciled gateway billing. | Future public proof summaries always leave `actual_cost_usd: null` until externally settled billing is available; internal estimates remain explicitly estimated. | Offline E2E regression enforces null actual billed costs on both arms. |
| GK-A06 | Blocked external | The US$50 team Enforce budget is not a receipt proving sponsor-funded model credits, and a two-call Playground comparison is not a native Gate Keeper/TrueForge SDK A/B. | Keep release inactive; no inferred sponsor balance, no second automatic spend path. Commission separately scoped virtual account, lifetime US$1 Enforce rule, verified funding identity and signed authorisation in issue #21. | Only a trusted issuer and provider-side trace/billing settlement can close; local code cannot attest external credit. |
| GK-A07 | Blocked evidence | Historical proof is INCONCLUSIVE and the four-round DeepSeek exploratory program has completed only 1/4 per arm. Current Gate Keeper reviewer changes modify prompt hashes and session methodology. | Do not rewrite prior results, claim causal improvement or promote learned rules. Require a fresh source-bound benchmark on the *new* prompt version, blinded independent semantic grading, unseen holdouts and signed third-party qualification. | A completed, separately signed proof, not a source-only test. |

## Mandatory evidence protocol

1. Freeze Gate Keeper review instructions, method, skill, model/provider account and task/scorer hashes; do **not** put private holdout answers in a public PR or model conversation.
2. Admit only source-pinned, tenant-isolated review with a real nonproduction provider, exact model and no broad GitHub writes. Sponsor funding and per-virtual-account cumulative limit must be independently verified before new paid calls.
3. Run same task, model, parameters and output contract on standard plain reviewer and Gate Keeper, with a fresh session for **each** task and arm, blinded/randomised ordering. This prevents cross-task session state.
4. Independently adjudicate **each** finding's material assertions, not just category and ±1 line. Record missing/invalid grades as incomplete rather than counting them as correct, and report both location precision and explanation-validated precision.
5. Store private traces, unblinding keys, session identifiers, secret-bearing errors, full lesson content and hidden fixture results only in independently controlled private evidence. Public output contains sanitised aggregate metrics, hashes and limits.
6. A successful source build, Gitar approval, a passing synthetic fixture or a completed TrueFoundry Playground call **never** constitutes native Gate Keeper qualification or production permission. External signed verifier is the only authority to promote or claim QUALIFIED.
7. A disclosed limitation is not a waived limitation. Any missing independent spending lease, private evidence upload, sandbox proof, holdout or source identity remains HELD.

## Closeout boundaries

**Source-only acceptance:** exact-head TypeScript build, scoring selftest, full offline suite, regressions above and independent code review (Gitar). Merge this small PR only into the existing draft integration branch after checks, without merging draft PR #7 to `main` or deploying a new live agent.

**Operational acceptance remains held:** issue #21 (sponsored funding/VA/$1 budget lease), authenticated Base44 backend and current UI publication, isolated native Gate Keeper agent with sandbox and source-only connector, semantic grader and signed qualification, and the incomplete 4-round learning study. Document each with its own proof rather than marking the product complete.

**Release verdict:** SOURCE-HARDENED when qualified tests pass; overall Gate Keeper agent = **HELD/INCONCLUSIVE** until independent live qualification. Neither historical `gk-live-20261101-g` nor Playground `gk-playground-deepseek-20261102-a` may be changed into a PASS.
