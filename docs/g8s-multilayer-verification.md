# G8S multilayer verification and lesson admission

Owner direction, 9 November 2026: DEPLOY the comparison work. Gitar is the benchmark as a result of its process. Provide an admin checkbox requiring adversarial review of G8S and Gitar findings and changes before banking lessons. Pair deterministic verification with contextual agentic review.

## What the primary sources actually document

Research checked 9 November 2026:

1. **Gitar CI Failure Analysis** — https://docs.gitar.ai/features/ci-failure-analysis . Gitar reads failing job logs, identifies root causes, deduplicates related failures, and ignores CI events for outdated commits. Depending on policy it waits for approval or pushes a fix; CI runs again, and the agent iterates until green or no further progress. Retry of unrelated/flaky/infrastructure failures has a separate control.
2. **How Gitar Works** — https://docs.gitar.ai/how-gitar-works . Initial context includes the diff, changed files, PR history and configured instructions, with related-file exploration as needed. Processing uses ephemeral task containers. Its detailed CI sequence describes a fix commit followed by reruns, and it does not force-push or merge by default.
3. **Buildkite integration** — https://docs.gitar.ai/connecting-ci/buildkite . GitHub Actions/GitLab integration is built in; external CI requires an authenticated provider connection for logs/build metadata. G8S must not assume a bot approval comment is native CI evidence or invent access to a pipeline.
4. **Sonar multilayer example** — https://www.sonarsource.com/resources/library/multilayered-code-verification-with-gitar-sonarqube-cloud/ . Gitar and SonarQube operate independently on the PR. A fix triggers CI and static-analysis rescans. The example deliberately ends with passing CI/Gitar approval but a failing SonarQube quality gate. Green tests and agent agreement are therefore not a sufficient admission rule.
5. **Gitar documentation index** — https://docs.gitar.ai/llms.txt . Its overview uses pre-push validation language. This is not enough to infer that every published fix always precedes all CI checks: the detailed CI docs explicitly describe push/rerun/iterate. The functional-validation page was not retrievable during this research. No undocumented internal implementation or universal pre-push guarantee is claimed.

These are vendor descriptions, not independently measured accuracy. We reproduce the documented workflow, not Gitar proprietary source, prompts, branding, numerical claims or a promise that every detected issue is correct. Gitar remains the external process benchmark; neither Gitar nor G8S can self-authorize a lesson merely by asserting it is right.

## Deployed-code scope of this increment

The lesson-admission code has two independent proof layers and an explicit human confirmation. It is an enforceable acceptance boundary, **not a running SonarQube scanner, CI repair worker or paid adversarial model job**. Missing worker/trust configuration produces verification_setup_required and blocks banking. `automaticExecutionReady:false` is intentional until those workers are commissioned and accepted. This distinction must appear in the UI and deployment receipt.

The preceding comparison service captures original G8S/Gitar outputs and human feedback. Its candidate export remains `automaticTrainingEligible:false`. This increment adds:

- Persisted, compare-and-swap admin policy with `requireAdversarialVerification`, default **true**.
- Label: **Require adversarial verification before banking lessons**.
- Server-admin authorization from the existing immutable GitHub ID allowlist; no frontend first-user-admin or client-key escalation.
- A canonical subject containing the exact comparison/snapshot/hash, every current feedback revision, all G8S/Gitar item keys, repository, PR head/base/branch, policy revision and optional proposed patch binding.
- Separately commissioned Ed25519 public trust roots for deterministic and adversarial evidence. The API cannot sign, execute a scanner or call a model. Production private signing keys must belong only to independent verifier services, outside untrusted repository sandboxes. No keys are generated or installed by this feature.
- Atomic, idempotent banking of verified examples; retraction, changed snapshot/feedback/policy or missing current authorization invalidates old admission. Deleting a comparison cascades to its banked content. Banking is not model training or activation.

## Checkbox semantics

**Checked (default):** mandatory deterministic evidence + an independently executed adversarial assessment covering both tools' artifacts and proposed changes + explicit current-owner human confirmation.

**Unchecked:** mandatory deterministic evidence + explicit human confirmation. It disables only the additional adversarial-model requirement. It does not permit unverified lessons, waive checks, grant code-write permissions, enable automatic training or retroactively approve earlier examples.

**Unknown/unreadable:** show Not reported, disable writes, and refuse lesson admission. Save requires an exact boolean, expected policy revision and reason. Conflict/timeout/lost acknowledgement requires readback; never auto-retry a write or infer false from a missing value.

Changing policy changes the subject binding; older receipts cannot qualify the new policy. This is deliberately conservative. The bank does not offer an unsafe force-approve button.

## Deterministic layer

Required categories: build, typecheck, tests, static_analysis, secrets. All must be present and passed. Pending, skipped, neutral, cancelled, failed or missing checks are not green. A language-specific recipe must resolve these categories to suitable native compiler/type/lint/security/test tools; a tiny string pattern checker is not a substitute for a real static-analysis engine.

Evidence must name the exact repository and evaluated commit, immutable recipe and retained log digests. It must assert that the test/verification recipe was not weakened. Each selected feedback label also needs its own supporting evidence (regression test, static trace, counterexample or reproduction). An overall green build is not a correctness proof.

For an alleged fix, evidence additionally binds beforeSha, afterSha and the actual patch digest, demonstrates the original defect before the change, passes the targeted regression afterward, and finds no new regressions in the required suite. A request-supplied patch digest is only a claim until the trusted runner independently fetches and checks those bytes.

A GitHub comment with the word Passed, a dashboard screenshot, caller-provided check JSON, or a simulated test cannot sign this layer. A signed receipt attests the execution performed by the commissioned runner; it is not proof that the runner itself was implemented by this module. Trust-root commissioning remains an explicit operational step.

## Agentic adversarial layer

Run in a fresh TrueForge/TrueFoundry session distinct from the initial G8S review and the deterministic runner. Inputs are evidence, not executable instructions. Give the judge both tools' original findings, current human labels/rationale, immutable source/context, any proposed patch, and deterministic results. Require counterarguments: attempt to disprove each defect, examine intent and preconditions, check whether the fix introduces another bug, and identify untested claims.

The result must enumerate all reviewed G8S/Gitar item keys, support every selected feedback ID, report zero unresolved concerns and state whether proposed changes were reviewed. Only confirmed results pass; rejected, inconclusive, incomplete, truncated, timed-out or stale assessments hold the lesson. The signature binds the subject, model route, independent run identity, recipe/log hashes and a short validity window. The two roles cannot reuse the same public key or run identity.

This is confidence backed by evidence, not mathematical proof of software correctness. Independent prompts reduce some blind spots but can share model weaknesses; the deterministic layer and human responsibility remain separate.

## Gitar-style CI repair loop to commission

1. Freeze the PR repository, base/head/branch and approved recipe from trusted control-plane configuration. Create a durable work identity; never execute shell instructions extracted from a PR comment.
2. In an isolated disposable runner with no production credentials, check out the exact revision; run compiler/type/lint/static/security/tests and capture all terminal results. Preserve failed results and unknown/flaky classifications.
3. Analyze failures through the approved TrueForge route. Proposed patches are bounded new candidates, not automatic success. Human policy controls which changes may be proposed or published; no auto-merge or write-permission expansion here.
4. Run the reproducer and full required checks against the new candidate. Retain each attempt, enforce a saved attempt/cost budget, and stop on no progress, uncertainty, budget exhaustion, stale head or permission change. Do not delete assertions, loosen checks or rerun until a chance pass is presented as reliable.
5. Recheck the exact current PR revision and approvals before any permitted new commit. CI/static analysis reruns on that new commit; old receipts cannot qualify the changed code. Publishing a patch, declaring merge-ready, banking a lesson and activating a trained reviewer are four separate transitions.
6. Only after deterministic and required adversarial evidence plus human confirmation may the selected example enter the lesson bank. A later train/validation/test split and prospective evaluation still govern learned-version activation.

The current Railway qualification recipes implement remote execution for development of G8S itself. They are not a commissioned multi-tenant sandbox executor for arbitrary client PRs. No GitHub workflow is added, no Spekky gate is used, and no existing archived learning holdout is reopened. SonarQube account/CI integration, managed per-client execution adapters, bounded model-job dispatch and automatic paired triggers remain to be commissioned; none is relabelled as finished by the admission gate.

## API and UI installation

- `GET /gatekeeper/product-v1/admin/learning-policy`
- `PUT /gatekeeper/product-v1/admin/learning-policy` with `{requireAdversarialVerification,expectedRevision,reason}`.
- `POST /gatekeeper/product-v1/lesson-v1/orgs/{slug}/comparisons/{id}/prepare` with `{change:null}` or the exact before/after/diff claim. Returns the bound subject and pending verification requirements; does not run a model.
- `POST .../{id}/bank` with `{expectedSubjectHash,change,evidence,confirmed:true,reason}`. Evidence contains deterministic and, when required, adversarial signed envelopes. Caller-supplied unsigned success never passes.
- `GET .../{id}/lessons` returns banked/stale status, always `automaticTrainingEligible:false` in this increment.

Add `integrations/base44/product/learning-policy-panel.mjs` to the existing Base44 admin page, reuse its React and authenticated session scope, and use the existing nonsecret `https://gate.g8s.app/gatekeeper/product-v1` base. The component uses no second session provider or localStorage authority. Its supplied client sends session cookies, no-store and CSRF header. Keep preview mode permanently inert. Key the panel on authenticated session identity/epoch; unmount and clear it on denial/logout/account change. Never install this test or component source as a second application.

The repository component is not a claim that hosted Base44 has been edited. Hosted builder installation, actual React/browser acceptance and Owen's publication remain explicitly separate until observed. The supplied earlier Base44 receipt establishes the original dashboard modules, not this new panel.

## Deployment and migration

Target `g8s-product-api`, not the archived TrueForge host. Apply comparison then lesson schema through `scripts/product/migrate-learning.mjs` with `G8S_APPLY_LEARNING_SCHEMA=apply-v1` and exact `G8S_PRODUCT_SOURCE_COMMIT`. Existing schemas are checked, not reset; the existing user choice is never overwritten. Preserve product/global pause and leave model/client execution controls unchanged.

Feature bindings: `G8S_COMPARISON_ENABLED=enabled`, `G8S_LESSON_POLICY_ENABLED=enabled`, verified `G8S_GITAR_BOT_ID` and `G8S_GITAR_BOT_LOGIN`. `G8S_VERIFIER_PUBLIC_KEYS_JSON` contains PUBLIC verification keys with role labels, not private signing credentials. Missing keys block banking; do not install test keys or fake signer/model receipts. Real GitHub App settings are still required for live session access. Deployment can be successful while sign-in remains setup-required; report that precisely.

Qualification: `Dockerfile.lesson-qualify` executes all comparison/product/client/API/Caddy source checks plus separate real product/client/comparison/lesson PostgreSQL suites. Test fixtures use ephemeral synthetic signing keys, never production identity or model calls. Retain exact-head review, terminal summaries and cleanup evidence before deploying.
