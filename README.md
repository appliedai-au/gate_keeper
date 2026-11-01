# Gate Keeper

> **TrueForge-native closed-loop work (draft PR #7):** The existing `gate-keeper` production agent is still read-only. The proposed `gate-keeper-native` profile delegates execution to TrueForge while preserving adversarial review → isolated candidate repair → V-model tests → polling → re-review → tenant-private lessons → independent qualification → controlled core improvement. No automatic merge/promotion or paid evaluation is enabled. See [full proof submission contract](docs/proof-submission-contract.md) and [Claude evidence collection/upload prompt](docs/claude-proof-request.md). Real comparative proof remains outstanding.

**A read-only code-review agent built on [TrueForge](https://trueforge.dev), with controlled evaluation and candidate-only learning.**

Gate Keeper reviews proposed code changes, identifies substantive defects and returns structured findings. TrueForge orchestrates the agent; the source, evaluation rules and qualification code live in this repository. Gate Keeper does **not** autonomously merge repairs, run arbitrary tenant code, or promote changes to its own instructions.

> **Release status — 31 October 2026:** The TrueForge-first model-routing and Phase 2 security-contract work has been merged. The exact Phase 2 merge commit, [`040c81a`](https://github.com/appliedai-au/gate_keeper/commit/040c81a4353694c4ab84b9ac7065d7b0146916ee), passed **91/91 isolated post-merge source tests**, TypeScript checks and scorer self-tests. This is **not** evidence of a live paid evaluation, qualified self-learning cycle, or fully commissioned independent budget gateway.

## How it works

```text
       Proposed code change
                 |
        Gate Keeper review
         (TrueForge agent)
                 |
          JSON findings
                 |
       Deterministic scoring
                 |
     Owner-private run evidence
                 |
      Independent qualification  <-- NOT YET COMMISSIONED
                 |
     Candidate improvement only
                 |
       Reviewed promotion PR     <-- NEVER automatic
```

The example agent in [`agent/`](agent/) is a **read-only code reviewer**. Its default manifest names `anthropic/claude-sonnet-5-5`. Models are chosen per role on measured merit and recorded in [`agent/models.json`](agent/models.json): reviewer and repair Sonnet 5.5, grader/gate Fable 5.1, learning Opus 5.5. The locked reference results are in [`proof/baseline.json`](proof/baseline.json) (run `gk-live-20261101-g`). Models are reached only through TrueForge's model catalogue (optionally TrueFoundry AI Gateway); Gate Keeper holds no provider credentials. The Railway-hosted TrueForge used for the proof runs is temporary: the harness accepts any owner-approved https TrueForge host (`GK_TRUEFORGE_APPROVED_HOSTS` plus `TRUEFORGE_TOKEN`). A model name is a configuration value, **not proof that the model is enabled or billed** on a particular TrueForge instance.

### Ownership boundaries

| Responsibility | Owner |
| --- | --- |
| Agent runtime, sessions, model catalog | **TrueForge** |
| Agent instructions, skills, task fixtures and scorer | **This GitHub repository** |
| Model credentials and provider billing | **The operator's TrueForge model configuration / optional TrueFoundry AI Gateway** |
| Private evaluations, transcripts, signed receipts and lease claims | **Owner-private state outside the Git checkout** |
| Independent spending enforcement and signed evidence | **A separately trusted gateway/verifier — not yet commissioned** |
| Promotion of an improved agent | **Reviewed and explicitly authorised PR, never automatic** |

Use TrueForge as the default provider interface. Ordinary Gate Keeper users should **not** be asked to enter separate model API keys when an approved model is already configured in TrueForge. Model access does not imply prepaid inference: provider charges depend on the account that configured the model.

## Prerequisites and safe local setup

Requires **Node.js 22.14+**, npm and Git, plus access to a TrueForge instance with an approved model. For local development, TrueForge can run separately; Railway deployment of the TrueForge service is not required for source-only checks.

```bash
git clone https://github.com/appliedai-au/gate_keeper.git
cd gate_keeper
npm ci

# Source-only qualification: no paid model calls
npm run typecheck
npm run score -- --selftest
npm run test:learning-policy
npm run providers:status
```

The source-only suite tests policy, private evidence boundaries, model-routing guards, benchmark integrity and negative security cases. It does **not** test a real model's defect-detection accuracy or a live independent gateway.

### Connect to TrueForge

Start your own local TrueForge instance separately if you do not already have one:

```bash
npx @truefoundry/trueforge@0.180.0
```

In **TrueForge → Settings → Models**, configure and verify a permitted model using TrueForge's protected provider settings. Do not commit API keys. To explicitly choose a model that is already in the TrueForge catalog:

```bash
export GK_MODEL_PROVIDER=trueforge
export GK_TRUEFORGE_MODEL=provider/model-id  # replace with the exact registered ID
npm run providers:status
```

For a local server, copy [`.env.example`](.env.example) to `.env` and configure `TRUEFORGE_BASE_URL` (default `http://localhost:8790`). Hosted or protected TrueForge instances may require `TRUEFORGE_TOKEN` in the **local environment**, never in Git.

```bash
cp .env.example .env
# Inspect the active model, access permissions and instance before proceeding.
npm run setup
```

**`npm run setup` writes or updates the named TrueForge agent**. Run it only against an authorised instance. Managed model selections are checked against the instance's actual model catalog before agent/skill mutations; unknown selections are held rather than silently switched.

The default `agent/agent.json` model remains in effect when `GK_MODEL_PROVIDER` is unset. Any other provider (including DeepSeek or a TrueFoundry AI Gateway) is configured **inside TrueForge** and selected with `GK_MODEL_PROVIDER=trueforge` and its registered model ID. Gate Keeper has no provider-specific adapters or login screens of its own.

## Evaluations and self-improvement: currently held

`npm run run-evals` and `npm run improve` are **controlled, potentially billable** workflows. They are not quickstart steps and **must not be run simply by setting a boolean flag**.

- **Evaluation:** Requires explicit operator authorisation, a frozen benchmark identity, a unique run identity, and an independently signed spending lease tied to the model/source/task count. The lease contract and local replay claim are implemented, but an authoritative independent budget gateway and settlement process have **not** been commissioned.
- **Evidence:** Results, scores and session exports are written to private state (by default `~/.local/state/gate-keeper/`), **not** committed to public `runs/`. Exclusive writes, file ownership, anti-symlink checks and no-retry claims protect the local evidence. These controls do not by themselves prove safe multi-worker operation.
- **Improvement:** Requires an independently signed, sealed baseline with matching source, benchmark, score, results and scorer hashes. It may generate a **private candidate**; it does not edit the live agent or push a promotion.
- **Promotion:** Requires an independently qualified holdout result, security/adversarial review and explicit approval. This repository does **not** provide a commissioned autonomous promotion pipeline.

Until the signer, gateway-side spending enforcement, tenant isolation and end-to-end evidence checks are deployed and demonstrated, **do not enable autonomous paid learning or automatic promotion**.

## Run 1 vs run N

This heading is retained for the original *Stranger Builds* TrueForge challenge, from which Gate Keeper evolved.

**No independently verified, published run-1-to-run-N improvement has been established here.** The public [`runs/summary.csv`](runs/summary.csv) currently has only its header; private or simulated qualification checks must not be presented as model-learning scores. A genuine comparison requires the same frozen tasks and scorer, distinct TrueForge session evidence, an agent-authored candidate, independent holdout review, and an explicitly reviewed promotion.

## Repository map

| Path | Purpose |
| --- | --- |
| [`agent/`](agent/) | Read-only reviewer manifest, instructions and skill checklist |
| [`evals/tasks/`](evals/tasks/) | Evaluation task fixtures, including holdout designations |
| [`evals/score.ts`](evals/score.ts) | Deterministic scoring and self-tests |
| [`scripts/setup.ts`](scripts/setup.ts) | Authorised TrueForge agent sync |
| [`scripts/run-evals.ts`](scripts/run-evals.ts) | Controlled private evaluation |
| [`scripts/improve.ts`](scripts/improve.ts) | Candidate-only learning from sealed evidence |
| [`scripts/learning-trust.mjs`](scripts/learning-trust.mjs) | Signed lease/receipt verification |
| [`scripts/learning-baseline.mjs`](scripts/learning-baseline.mjs) | Frozen evaluation evidence validation |
| [`scripts/providers/`](scripts/providers/) | Fail-closed TrueForge model routing and status |
| [`scripts/proof/live/`](scripts/proof/live/) | Live baseline-vs-Gate Keeper comparison and autonomous repair-loop drill (`GK_PROOF_DRILL_SET=standard|hard|all` picks the repair fixtures; `hard` is five fixtures in `proof/fixtures/` where the obvious minimal fix fails the threat-model or architecture tests) |
| [`tests/`](tests/) | Policy, boundary, security and integration tests |
| [`Dockerfile.qualify`](Dockerfile.qualify) | Disposable, credential-free source qualification |
| [`docs/providers.md`](docs/providers.md) | Provider setup, consent and limits |
| [`docs/trueforge-model-access.md`](docs/trueforge-model-access.md) | TrueForge-first architecture and billing boundaries |

## Deployment and security status

The source repository is on GitHub. TrueForge and its supporting services are deployed separately on Railway; **a successful container deployment is not equivalent to a qualified paid-agent run**. The Phase 2 security contracts were merged as [PR #3](https://github.com/appliedai-au/gate_keeper/pull/3) after the TrueForge-first routing and local OAuth releases.

Before exposing a TrueForge API to untrusted clients or tenants, independently verify authentication on every internal and external route, isolation from other services, and rate/spend enforcement. Keep production data out of disposable evaluation environments.

For troubleshooting:
- **Model missing:** verify the exact `provider/model` name in TrueForge Settings → Models, and check `npm run providers:status`.
- **Evaluation held:** do not bypass a missing signed lease, expired budget, private evidence lock or missing baseline receipt; resolve it through the independent controller.
- **Source tests:** run `npm run typecheck && npm run score -- --selftest && npm run test:learning-policy` without credentials.

## Origins, contribution and licence

Gate Keeper originated from the [TrueForge](https://github.com/truefoundry/trueforge) *Stranger Builds* self-improving agent challenge. The challenge inspired its evaluation and improvement design, but the current implementation intentionally holds self-promotion until independent evidence exists.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidance. Licensed under the [MIT License](LICENSE).
