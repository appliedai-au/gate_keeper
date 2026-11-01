# Gate Keeper proof submission contract

**Purpose:** prove (or falsify) that Gate Keeper's specialised reviewer and closed-loop process improve on a plain TrueForge reviewer. Source tests and a healthy agent runtime are not evidence of superior review accuracy or reliable repair.

**Target:** owner-controlled GitHub repository `appliedai-au/gate_keeper`, draft PR **#7** (`feat/base44-gatekeeper-integration`). Preserve all existing run identity and public score history. Never amend/rebase historical challenge commits.

## What counts as proof

Run **both** arms using TrueForge's native agent harness, the **same explicitly registered model and provider account**, identical repository/task inputs, identical prompt budget/call limits, same frozen evaluation/scorer, and independent scoring.

- **Arm A — baseline:** a minimally configured standard TrueForge code reviewer (record its exact instructions SHA, model ID, tools and runtime version).
- **Arm B — Gate Keeper:** the review instructions/methodology and any permitted specialist roles from this PR (record exact git source commit and prompt/skill hashes).
- Compare *defect recall*, *precision/false positives*, *severity correctness*, *reproducibility*, *time*, *token consumption* and *actual billed cost*. A line/category-only scorer is not sufficient to validate explanations: include independently adjudicated semantic correctness.
- Keep the frozen benchmark separate from truly **unseen owner-private holdouts**. Do not let either candidate agent, prompt optimizer or lesson selector read hidden answers.
- For the repair arm (only after explicit sandbox/job scope is authorised), demonstrate read → adversarial finding → isolated patch → V-model tests → repeated polling → post-repair adversarial re-review → **failed test auto-discard**. Prove the original source SHA was unchanged; distinguish candidate/workspace discard from a production deployment rollback.
- Preserve learning: failed and successful attempts can produce **tenant-private** evidence-bound lessons; selection for **core candidate** requires explicit owner consent, sanitization, cross-tenant generality, evidence and an independently verified holdout. No automatic release to shared core.

## Do not pretend that an agent can certify itself

An independently controlled verifier must produce source-bound, immutable, signed qualification evidence. The TrueForge agent may collect measurements but **cannot write the expected holdout answers, choose the trusted signer, mark its own work independently qualified, or assert that a boolean signature flag is cryptographic proof**.

All paid inference and repair jobs require an independently issued spending lease with a finite total and per-run ceiling, exact model/source/task scope, expiration and settlement. If the gateway isn't commissioned or the model inaccessible, label that check **BLOCKED**. Do not invent costs, receipts, test traces or signatures.

## Output artifacts and destinations

**Private owner-controlled storage (never public GitHub):**
- Raw inputs and outputs, all TrueForge session/turn/event traces, full test logs, independent answer keys and private holdout results.
- Signed lease receipts, actual token/model billing statements, private lesson contents, secret-bearing environment captures.
- Verifier's private signing key must remain exclusively outside the agent sandbox.
- Store artifacts immutably, with owner-readable access; provide hash (SHA-256), storage reference and verification instructions. Do not paste credentials or expiring download tokens into a PR.

**Public GitHub PR #7 (safe, sanitized disclosure only):**
- Add a new **non-overwriting** proof submission under `proof/submissions/<run-id>/summary.json` and `proof/submissions/<run-id>/report.md` on a separate proof branch and open a PR into `feat/base44-gatekeeper-integration`, or comment on PR #7 with the proof-branch link if stacked PRs aren't supported. Do not directly push to main or merge.
- `summary.json` must conform to `scripts/proof/validate-public-proof.mjs` and contain the exact revision, both arms, fixed benchmark identity, aggregate measures, result (PASS/FAIL/INCONCLUSIVE/BLOCKED), immutable private evidence hashes/references (non-sensitive), detached independent verifier receipt reference, and explicit limitations.
- `report.md` should include the step-by-step experiment, failure cases, V-shaped stage/test matrix, before/after findings, actual measured costs, rollback/discard evidence, lessons/core-candidate admission results, and reproduction instructions.
- Post a PR comment referencing both artifact paths and the proof PR, with short conclusions. No screenshots-only proof and no simulated fixture data.
- If the tests cannot run, publish a **BLOCKED** report describing exactly which permission, model, sandbox, GitHub MCP scope, gateway or private evidence upload capability is missing. Do not silently weaken a gate.

## Evidence acceptance gates

1. Identical inputs/model/provider and frozen scoring across arms; no benchmark leakage.
2. Independently verifiable metrics including false positives and explanation correctness; repeated trials when non-deterministic.
3. Actual TrueForge session IDs, session metadata, exact source SHAs, and independently controlled trace hashes.
4. Real sandbox initialization and tool access, no production host execution or unauthorised repository writes.
5. V-model requirements ↔ acceptance, threat-model ↔ adversarial, architecture ↔ integration, implementation ↔ unit/static checks. Actual commands/exit codes/time budgets are provided privately.
6. Explicit **failed-validation disposal** proof, and independently verified source repository unchanged.
7. Signed, source-bound independent holdout verdict and independently settled per-job cost (if model spending used).
8. User lesson evidence stays private; core candidate selection and human-reviewed promotion are separate.
9. A reproducibility script or exact command sequence and pinned tool/runtime versions.
10. Final recommendation states whether our added code is demonstrably better than a baseline TrueForge reviewer. If not, say so and identify exactly which Gate Keeper-specific capabilities should be retained.

**Never report a production rollout as done merely because a PR was merged or all source tests passed.** The app's live Base44 URL and TrueForge hosting configuration need separate acceptance evidence.
