# Claude execution prompt — upload independent proof

Work in `appliedai-au/gate_keeper` on feature branch `feat/base44-gatekeeper-integration`, draft PR #7:
https://github.com/appliedai-au/gate_keeper/pull/7

**Mission:** independently prove or disprove whether our Gate Keeper review/repair/learning loop offers measurable advantages over a baseline TrueForge reviewer, and upload verifiable evidence. Preserve the full continuous loop. Do not merge PR #7, mutate production, expose secrets, or claim production readiness from source-only tests.

Read first:
- `docs/proof-submission-contract.md`
- `agent/native-trueforge-instructions.md`
- `scripts/proof/validate-public-proof.mjs`
- `scripts/learning-policy.mjs`
- `scripts/execution/policy.mjs`
- `evals/score.ts` (line/category-only scoring cannot adjudicate explanations)

**Execution:**
1. Confirm exact repository HEAD, TrueForge version, approved model/provider and registered GitHub MCP and sandbox capabilities. Record identities, without logging tokens or secrets. If access is missing, locate the responsible maintainer/operator and request the specific missing permission or an operator-generated evidence artifact. Continue safe read-only qualification meanwhile.
2. Set up two genuinely comparable review arms: baseline TrueForge reviewer and Gate Keeper specialist reviewer. Use the same model, tasks, source SHAs, scoring identity, token/cost limits, provider account and tool scope. Freeze benchmark beforehand. Never leak private holdout answers.
3. Collect real session/turn/event evidence and blinded adjudication of substantive finding correctness, recall, false positives, severity, reproducibility, latency and actual token/provider spend.
4. On a **nonproduction, disposable repository fixture**, exercise and record the entire authorised Gate Keeper loop: review → patch → V-shaped unit/integration/adversarial/acceptance checks → poll → re-review → deliberate failing-check rollback/discard → private user lesson candidate → core candidate selection → independently signed qualification → next-cycle decision. An agent may not mark its own evaluation as independently qualified. 'No human in the loop' must not bypass independent budgets, tenant boundaries or core promotion.
5. Obtain detached verifier and gateway evidence from an independently controlled identity. Require source/benchmark/scorer/holdout hashes and a signed report. Where these systems are not commissioned, mark BLOCKED and name exactly what access or deployment is needed. Never synthesize a signature, cost receipt, holdout score or passing run.
6. Write public, **sanitized** `proof/submissions/<unique-run-id>/summary.json` and `report.md` in a separate proof branch. Run `node scripts/proof/validate-public-proof.mjs proof/submissions/<unique-run-id>/summary.json`; this checks structure, **not** authenticity. Put raw logs, session transcripts, benchmark answers, private lessons and signed receipts in immutable **private owner-controlled** storage, and reference them in the public report by safe paths and SHA-256. Never upload tokens, credentials, private tenant code or private holdout data into public GitHub.
7. Push the proof branch, open a proof PR into `feat/base44-gatekeeper-integration`, and comment on PR #7 with the proof PR link, exact revision, metric comparison, verification steps, unresolved blockers and verdict. If a stacked PR is technically unsupported, provide a GitHub link to the proof branch and comment on PR #7. Do not overwrite prior run records or edit `runs/summary.csv` unless its existing provenance contract is satisfied.
8. Report clearly whether Gate Keeper **beats, matches or trails** the baseline. If the answer is 'unproven', say so, retain useful specialised governance code and list the minimum tests still required. Do not conflate TrueForge's native coordinator/executor functionality with our specialised validation/learning system.

**Acceptance:** Real reproducible evidence links uploaded or an explicit, independently checkable BLOCKED report, all loop stages covered, zero unauthorised production changes, no invented PASS labels, and no self-certification. Keep working around nonessential blockers safely; do not bypass the independent signing or spending gate. Send the proof PR link and a concise verdict when complete.
