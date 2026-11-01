# Stranger Builds sponsor-credit smoke — commissioning and execution

**Status: BLOCKED — source prepared, no model calls made.** Entry: `node --import tsx scripts/proof/sponsor-smoke.mjs --plan`.

This is the **next** experiment after historical `gk-live-20261101-g`, which remains **INCONCLUSIVE** and whose provider billing was not verified. Do not overwrite that submission or claim sponsor credit paid for it.

## The precise experiment

- Source: exact reviewed Git commit; one frozen **public** fixture `evals/tasks/01-python-utils.json` (3 expected defects). No private holdout or tenant data.
- Candidate: `truefoundry/deepseek-v4-flash-0731` or `truefoundry/mimo-v2.6-flash`. Both were displayed in the owner's TrueFoundry tenant at US$0.14/M input and US$0.28/M output on 2026-11-01.
- Two methods on the **same** selected model: `baseline` (plain TrueForge reviewer) and `gate_keeper` (adversarial reviewer). One trial, exactly two turns, temperature 0, maximum 500 output tokens each, no grader, repair, learning or external tools.
- Test environment: Railway **project `gk-learning-qual-1031`** `a8f4c4a4-0f32-4166-ba92-dad9baf2b652`, environment **`qualification`** `03fb9181-2f19-409b-a9b1-823cb32e56c2`. It must have a separately provisioned nonproduction TrueForge service with private `trueforge.railway.internal:8080`, separate storage and no production database. The existing production Gate Keeper project is **never** acceptable.
- The TrueForge model provider must be exactly `truefoundry`, with origin `https://stranger-builds.truefoundry.cloud/api/llm` and **only the selected** `tfy-managed/<model>` mapping. No direct Anthropic route or silent fallback.
- **Hard gateway cap: at most US$1 lifetime, per virtual account, `Enforce`.** Existing broad US$50 `Applied-AI-budget` remains untouched. Local evaluator `BudgetController` is secondary, *not* the independent enforcement.

## Mandatory pre-spend controls

1. Get a sponsor administrator's confirmation, tied to the actual `tfy-managed` billing identity, that **underlying inference** is covered by sponsor credits, amount remaining, expiration, no personal provider fallback/overage, and which models are eligible. The $50 lifetime team policy is a **spending ceiling**, not proof of sponsor credit. Gateway metrics show $0 / zero requests and the tenant currently has no application virtual accounts.
2. Create `gate-keeper-smoke-...` under `Applied_AI` using TrueFoundry Access → Virtual Accounts; short expiry and secret manager. **No personal PAT**. Store the key exclusively in nonproduction TrueForge's protected provider UI. Browser automation credential-creation was blocked by its safety gate; use the authorised tenant operator UI.
3. Add a separate **US$1, Lifetime, per-virtual-account, Enforce** rule with the exact virtual-account subject; confirm via read-back, not just UI form submission. Ensure old broad policy remains unchanged and rate limits are bounded.
4. The trusted issuer must sign an evidence object binding the sponsor funding, the gateway's enforcing budget identity, exact model, the public fixture, run ID, expiry, two-turn limit, no tools and the **40-character source commit**. Signature: Ed25519 over the UTF-8 bytes of `JSON.stringify(statement)`, Base64. An independent approver must verify the issuer's authority and the actual gateway state.
5. Only after that independent verification, a separately reviewed PR may populate `config/gk-sponsor-issuer-pin.json` with the trusted public-key SHA-256, signer identity and `VERIFIED` status. **Its initial null values deliberately block all real inference**. Do not create a self-signed key merely to make tests pass.
6. Mount the signed receipt and signer public key as **read-only protected files**; do not paste them or the virtual-account key into Git, Base44 AI chat, logs, build arguments or model prompts. Configure isolated private evidence S3 with *create-if-absent* object support.
7. Use a new immutable `GK_SPONSOR_SMOKE_RUN_ID` matching the signed receipt. `--run` rejects mismatched Railway project, environment, commit, signer fingerprint, receipt, cap, model or S3 prerequisites before a billable call. It claims `STARTED` atomically in private S3, preventing replay.
8. Confirm actual Gateway Request Trace and billed sponsor-credit delta independently after the two turns. The source runner **never marks actual gateway charges from an SDK estimate**. Its initial public result remains **INCONCLUSIVE** pending trace correlation and signed independent verification.
9. Store raw output, session/turn IDs, prompts and metrics **privately only**. Publish a sanitised, non-overwriting new proof submission and later update the already-live Base44 Runs/Evidence view only after qualification.

## Example receipt statement (SCHEMA ONLY — NOT EVIDENCE)

```json
{
  "runId": "gk-sponsor-smoke-20261102-a",
  "sourceCommit": "40-hex-characters-go-here",
  "tenant": "stranger-builds",
  "provider": "tfy-managed",
  "fundingSource": "sponsor-inference-credit",
  "personalBillingFallbackDisabled": true,
  "overageDisabled": true,
  "sponsorCreditRemainingUsd": 1,
  "issuedAt": 0,
  "expiresAt": 0,
  "virtualAccountId": "gate-keeper-smoke-REPLACE",
  "model": "truefoundry/deepseek-v4-flash-0731",
  "fixture": "01-python-utils",
  "gatewayBudget": {
    "ruleId": "REPLACE_WITH_REAL_GATEWAY_POLICY_ID",
    "subject": "gate-keeper-smoke-REPLACE",
    "scope": "per-virtual-account",
    "mode": "Enforce",
    "period": "Lifetime",
    "currency": "USD",
    "limitUsd": 1,
    "remainingUsd": 1
  },
  "maxTurns": 2,
  "maxOutputTokensPerTurn": 500,
  "noAutomaticRetry": true,
  "allowTools": false,
  "allowRepair": false,
  "allowLearning": false,
  "publicFixtureOnly": true
}
```

The real receipt JSON consists of `{"statement":{...},"signature":"BASE64_ED25519"}`. The placeholder above must not be signed and does not entitle anyone to use credits. `issuedAt` and `expiresAt` are Unix **milliseconds**, with a validity of 24h or less.

## Protected execution inputs

Run `--plan` freely: it never reads a token or makes a network request. `--run` additionally requires:

- `RAILWAY_PROJECT_ID`, `RAILWAY_ENVIRONMENT_ID`, `RAILWAY_GIT_COMMIT_SHA`, `RAILWAY_ENVIRONMENT_NAME` tied to exact isolated project.
- `TRUEFORGE_BASE_URL=http://trueforge.railway.internal:8080` in that isolated project and a protected `TRUEFORGE_TOKEN`.
- `GK_SPONSOR_SMOKE_RECEIPT_FILE`, `GK_SPONSOR_SMOKE_ISSUER_PEM_FILE`, `GK_SPONSOR_SMOKE_RUN_ID`, `GK_SPONSOR_SMOKE_MODEL` as described.
- `GK_PROOF_EVIDENCE_S3_ENDPOINT`, `GK_PROOF_EVIDENCE_S3_BUCKET`, `GK_PROOF_EVIDENCE_S3_ACCESS_KEY_ID`, `GK_PROOF_EVIDENCE_S3_SECRET_ACCESS_KEY` and optional region in protected isolated runtime.

`--run` does **not** create a virtual account, budget, model provider, or TrueForge service. It does not automatically retry. If a precondition is absent, report **BLOCKED**, spend zero, and leave production unchanged.

## Limitations

Even a syntactically valid signed receipt **does not authenticate the issuer's entitlement** without an independently reviewed trust pin and true gateway policy observation. The source-only tests generate disposable mock keys to verify negative controls, not to assert a sponsor grant exists. TrueForge `totalCostInUsd` is an internal metric, not a gateway billing receipt. This small synthetic public fixture is a smoke test, not an independently qualified multi-tenant proof.
