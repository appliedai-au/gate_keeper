# Gate Keeper

**A read-only code-review agent built on [TrueForge](https://trueforge.dev), with controlled evaluation and candidate-only learning.**

Gate Keeper reviews proposed code changes, identifies substantive defects and returns structured findings. TrueForge orchestrates the agent; the source, evaluation rules and qualification code live in this repository. Gate Keeper does **not** autonomously merge repairs, run arbitrary tenant code, or promote changes to its own instructions.

> **Release status — 31 October 2026:** The TrueForge-first model-routing, per-user local OAuth and Phase 2 security-contract work has been merged. The exact Phase 2 merge commit, [`040c81a`](https://github.com/appliedai-au/gate_keeper/commit/040c81a4353694c4ab84b9ac7065d7b0146916ee), passed **91/91 isolated post-merge source tests**, TypeScript checks and scorer self-tests. This is **not** evidence of a live paid evaluation, qualified self-learning cycle, or fully commissioned independent budget gateway.

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

The example agent in [`agent/`](agent/) is a **read-only code reviewer**. Its default manifest currently names `anthropic/claude-sonnet-4-6`; that is a configuration value, **not proof that the model is enabled or billed** on a particular TrueForge instance.

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

The source-only suite tests policy, private evidence boundaries, OAuth handling, benchmark integrity and negative security cases. It does **not** test a real model's defect-detection accuracy or a live independent gateway.

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

The default `agent/agent.json` model remains in effect when `GK_MODEL_PROVIDER` is unset. Optional DeepSeek models can be configured **inside TrueForge** with explicit source-sharing approval; see [provider guidance](docs/providers.md).

## User-owned ChatGPT subscription (optional, local only)

Each user may explicitly sign in with **their own** ChatGPT account on an eligible local, open-source installation. Tokens are stored under the current OS user's `~/.config/gate-keeper/chatgpt-oauth/` directory with owner-private permissions. No shared administrator account, global OAuth token, or automatic fallback to another user's plan is supported.

```bash
npm run connect:chatgpt -- login --email your-own-email@example.com
# Approve access in the local browser, then:
npm run connect:chatgpt -- status
npm run connect:chatgpt -- select YOUR_ISSUED_CLIENT_ID

# Explicit, one-request, fixed-prompt test; uses account-authorised plan access
npm run test:chatgpt-sub -- --confirm --email your-own-email@example.com

# Clear the ChatGPT-only selection without deleting your credentials
npm run connect:chatgpt -- deselect
```

Sign-in alone does **not** change the agent's provider. Selecting a ChatGPT-only account is explicit, and the normal TrueForge path fails closed if that selection lacks a qualified inference adapter.

**Important:** This local OAuth test is **not** a ChatGPT subscription adapter for hosted TrueForge on Railway. Do not paste OAuth tokens into TrueForge's API-key field, expose a shared OAuth proxy, or assume a ChatGPT subscription permits hosted/commercial multi-user inference. See [TrueForge-first model access](docs/trueforge-model-access.md).

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
| [`scripts/providers/`](scripts/providers/) | TrueForge routing, optional BYOK and local OAuth utilities |
| [`tests/`](tests/) | Policy, boundary, security and integration tests |
| [`Dockerfile.qualify`](Dockerfile.qualify) | Disposable, credential-free source qualification |
| [`docs/providers.md`](docs/providers.md) | Provider setup, consent and limits |
| [`docs/trueforge-model-access.md`](docs/trueforge-model-access.md) | TrueForge-first architecture and billing boundaries |

## Deployment and security status

The source repository is on GitHub. TrueForge and its supporting services are deployed separately on Railway; **a successful container deployment is not equivalent to a qualified paid-agent run**. The Phase 2 security contracts were merged as [PR #3](https://github.com/appliedai-au/gate_keeper/pull/3) after the TrueForge-first routing and local OAuth releases.

Before exposing a TrueForge API to untrusted clients or tenants, independently verify authentication on every internal and external route, isolation from other services, and rate/spend enforcement. Keep production data out of disposable evaluation environments.

For troubleshooting:
- **Model missing:** verify the exact `provider/model` name in TrueForge Settings → Models, and check `npm run providers:status`.
- **OAuth selected but no TrueForge inference adapter:** use `npm run connect:chatgpt -- deselect` to restore the normal local provider selection.
- **Evaluation held:** do not bypass a missing signed lease, expired budget, private evidence lock or missing baseline receipt; resolve it through the independent controller.
- **Source tests:** run `npm run typecheck && npm run score -- --selftest && npm run test:learning-policy` without credentials.

## Origins, contribution and licence

Gate Keeper originated from the [TrueForge](https://github.com/truefoundry/trueforge) *Stranger Builds* self-improving agent challenge. The challenge inspired its evaluation and improvement design, but the current implementation intentionally holds self-promotion until independent evidence exists.

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidance. Licensed under the [MIT License](LICENSE).
