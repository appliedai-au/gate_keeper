# Gate Keeper proof submission `gk-proof-blocked-20261101`

**Result: BLOCKED.** No live comparison, repair drill or qualification was run, because none of the required live systems were reachable from the qualification session. This report publishes the exact blockers rather than substituting simulations or source tests. Nothing here supports a claim that Gate Keeper is better than, equal to or worse than a standard TrueForge reviewer.

- Source revision: `d62ae2facaf15b35b8b5a0662c9d8defd385085b` (head of `feat/base44-gatekeeper-integration`, PR #7)
- Structural check: `node scripts/proof/validate-public-proof.mjs proof/submissions/gk-proof-blocked-20261101/summary.json` returns valid. The validator checks structure only and authenticates nothing.
- Unauthorised production changes: none. No merge, deploy, model call or write outside this proof branch.

## 1. What was checked (read-only)

| Check | Outcome |
|---|---|
| Repo, PR #7, proof contract, request, validator read | Done |
| `npm ci`, `npm run test:learning-policy` | 135 of 135 pass (source tests only, not live proof) |
| `npm run typecheck` | Clean |
| `node scripts/trueforge/native-preflight.mjs` | HELD: `TRUEFORGE_HTTPS_URL_REQUIRED` |
| `npm run providers:status` | TrueForge routing not configured; DeepSeek not configured in TrueForge; ChatGPT hosted inference NOT_AUTHORISED |
| TrueForge / gateway / verifier / private-storage credentials in session | None present |

## 2. Blockers (exact, with owner)

1. **B1 TrueForge host.** No `TRUEFORGE_BASE_URL` or token. Needed from the TrueForge operator: HTTPS host plus a scoped token. This blocks every live stage.
2. **B2 Model.** No provider-qualified model confirmed via `tf.models.list()`; `GK_TRUEFORGE_MODEL` unset. Needed from the TrueForge model operator: one registered model ID used for both arms.
3. **B3 Sandbox and GitHub connector.** No TrueForge-managed sandbox provisioned and no read-only GitHub connector verified, so no session, turn or event traces exist. Needed from the sandbox operator.
4. **B4 Spending lease.** No independent budget gateway. Needed from the gateway operator: a signed lease with finite total, per-run ceiling, exact model/source/task scope, expiry and settlement. Paid work was not started.
5. **B5 Verifier.** No independent verifier identity or signing key, so there is no baseline receipt or qualification receipt. Needed from the verifier operator. The evaluator must not generate its own signature.
6. **B6 Fixture and holdout.** No disposable repair fixture repository with write authority, no owner-private holdout set, and no immutable private evidence store. Needed from the repository owner.
7. **B7 Arm A.** The standard TrueForge reviewer's instructions, tools and runtime version cannot be recorded without B1. `baseline_instructions_sha256` in `summary.json` is the all-zero sentinel meaning NOT COLLECTED.

## 3. V-shaped stage and test matrix

| Stage | Status | Reason |
|---|---|---|
| Adversarial review (both arms) | BLOCKED | B1-B4, B7 |
| Sandbox repair, bounded patch | BLOCKED | B3, B6 |
| V-model validation (unit, integration, adversarial, acceptance) | BLOCKED | B3, B6 |
| Polling | BLOCKED | B3 |
| Post-repair adversarial re-review | BLOCKED | B1-B4 |
| Failed-check discard and source-SHA-unchanged proof | BLOCKED | B3, B6 |
| User lesson capture (private) | BLOCKED | needs a real run |
| Core candidate selection | BLOCKED | needs consent, two or more tenants, verifier |
| Independent qualification and next-cycle repeat | BLOCKED | B5 |
| Both "No human in the loop" settings | BLOCKED | B3, B4, B6; admission policy covered by source tests only |

## 4. Measured results

None. Both arms have zero trials; recall, precision, explanation correctness, severity accuracy, latency, tokens and cost are all `null`. No cost receipts or signatures exist, and none were invented.

## 5. Private evidence references

No private evidence exists for this run, so `evidence` is an empty array. Hashes of public inputs that were pinned:

| Item | SHA-256 |
|---|---|
| `agent/native-trueforge-instructions.md` (Arm B instructions) | `737280171cd0c48c5c2ca4cf84f5c52977e13f15e1127b5d302ad98627c97b83` |
| `agent/instructions.md` (original starter reviewer) | `e01318b867c47d6458534c942d95cc0782aee9d641f0507a05329940388525ef` |
| `evals/score.ts` (frozen scorer) | `8096f1c871b327ba425ff3368cec34fbac400f777a4061f2ff7ae6ac55aecefd` |
| `evals/tasks/*.json` combined (`cd evals/tasks && sha256sum *.json \| sha256sum`, filename/glob order, no extra `sort`) | `8dc469adbc4e0606cfa8d891af99fd07f4d3b6dc3fd246e2d3c9c8f2709549d7` |

## 6. Findings from reading the code (not live proof)

1. **Scorer cannot judge explanations.** `evals/score.ts` matches on category and line within ±1 and penalises noise at 0.5. It cannot assess explanation correctness or severity, which the contract requires. Independent semantic adjudication is a missing component, not just missing data.
2. **The "holdout" is public.** `evals/tasks/04-ts-fetch.json` is `holdout: true` but sits in the public repo, so it is not an unseen holdout. A real private holdout must live outside GitHub.
3. **Validator forced `fairness.*` to `true` even when nothing ran.** Fixed in this PR: `null` (not applicable) is now accepted only when the result is not PASS and both arms have zero trials. `false`, and anything for a run that executed or claims PASS, is still rejected. Tests added. This submission uses `null`.
4. **The specialist methodology is thin.** `native-trueforge-instructions.md` is mostly governance and process. The reviewing technique is one line ("inspect defects, tenant boundaries, error handling and regression risks"), and `native-trueforge-profile.json` does not reference the `review-checklist` skill. If the Gate Keeper arm differs from the baseline mainly by governance wording, a recall or precision advantage is unlikely to be measurable. A live run is the only way to know.

## 7. Provisional assessment (hypotheses, not proof)

- **Is Gate Keeper demonstrably better than the standard TrueForge reviewer?** Unproven. No evidence either way.
- **What the code uniquely contributes (it is not TrueForge-native):**
  - Independent spend and execution admission (`scripts/execution/policy.mjs`).
  - Signature and receipt verification (`scripts/learning-trust.mjs`).
  - Sealed baselines and candidate qualification checks (`scripts/learning-policy.mjs`, `scripts/learning-baseline.mjs`).
  - Tenant-private lesson gating and the core-candidate rules.
  - The frozen scorer and the public proof validator.

  This is governance and safety value. It is not yet shown to be review-quality value.
- **Likely duplication to remove or shrink (needs owner confirmation):**
  - `scripts/providers/*` (about 760 lines for ChatGPT OAuth, DeepSeek BYOK and account identity). The repo's own docs say the default path is TrueForge Settings → Models.
  - The role descriptions in `native-trueforge-instructions.md` that restate TrueForge's coordinator, subagents and sandbox.
  - Possibly the Base44 UI (about 1,400 lines) if TrueForge's own session views cover it. I have not evaluated that.
- **Is the full learning loop proven?** No. The policy functions are unit-tested in isolation; no live cycle, lesson, qualification or repeat has run.

## 8. Minimum to unblock

1. A TrueForge URL and token, with one registered model for both arms.
2. A sandbox and read-only GitHub connector.
3. A signed spending lease from the budget gateway.
4. A verifier identity that signs the baseline and qualification receipts outside the sandbox.
5. A disposable fixture repo, an owner-private holdout, and immutable private storage.
6. An independent adjudicator for explanation and severity correctness.

## 9. Reproduction

```bash
git checkout d62ae2facaf15b35b8b5a0662c9d8defd385085b
npm ci
npm run test:learning-policy
npm run typecheck
node scripts/trueforge/native-preflight.mjs   # expected: HELD without TRUEFORGE_BASE_URL
node scripts/proof/validate-public-proof.mjs proof/submissions/gk-proof-blocked-20261101/summary.json
```

Tools: Node 22.23.4, TypeScript 5.9.3, `@truefoundry/trueforge-sdk` 0.180.0.
