# Hard native DeepSeek A/B — four rounds per reviewer

**Study:** `native-deepseek-hard-four-v1`  
**State:** source prepared; model execution held until independently verified sponsor-funded budget.  
**Historical Playground study:** NOT reused. Its earlier two turns are a different inference channel.

## Experiment and hardness

Two agent methods run through the actual **TrueForge SDK session/turn API**, at exactly the same `truefoundry/deepseek-v4-flash-0731` mapping to `tfy-managed/deepseek-v4-flash-0731` in the Stranger Builds gateway. The plain arm is TrueForge's minimal reviewer role and the Gate Keeper arm uses its adversarial instructions and review checklist. No tool access, code execution, repair, agent-generated repository writes or provider fallback.

| Round | Public scenario | Seeded defects per arm |
| --- | --- | ---: |
| 1 | Concurrent multi-tenant ledger settlement | 6 |
| 2 | Signed payout webhooks under retries and reordering | 8 |
| 3 | Tenant export, callbacks, key prefixes, cursor and backpressure | 7 |
| 4 | Versioned entitlements, billing, downgrade and concurrency | 8 |

**29 expected issues per reviewer**, more than twice the earlier four-round suite's 12. These fixtures intentionally carry explicit runtime/database/billing assumptions and interact across authorization, concurrency, monetary correctness and event delivery. They are **public seeded fixtures**, not a sealed independent holdout. The source and expected-answer key are stored together for deterministic scoring, but candidate prompts contain **only task context, numbered code and shared output contract**. Native sessions are configured with no tools and cannot fetch the key.

## Review versus adaptation

- 4 paired review rounds = **8 actual review turns**. Both arms receive the exact same task input, DeepSeek model/provider identity, temperature 0, review output allowance 2,500 tokens, and review protocol. Order alternates between arms; each turn uses a fresh native TrueForge session.
- After each of rounds 1–3, each arm separately sees **only its own prior response** and deterministic feedback about its own prior fixture. It makes one more turn **on the same DeepSeek model** to propose one general transferable principle (40 words max).
- 3 reflection turns per arm = **6 additional model turns**, for **14 total**. The runner stores each arm's lessons privately and injects only that arm's cumulative lessons before the next review's shared output contract. There is no shared state between arms.
- The resulting within-agent changes measure **controlled memory/prompt adaptation inside native TrueForge sessions**. Do **not** call this proven autonomous model weight learning or general intelligence improvement; independent evaluation is needed. Comparing round 4 to round 1 is **not causal**, because fixtures grow harder.

## Security and spending admission

`node --import tsx scripts/proof/native-four-run.mjs --plan` is nonbillable and safe on any machine. The **--run** entrypoint refuses to make even a metadata request unless:

1. The service is in the separate `gk-learning-qual-1031` Railway **qualification** project/environment, with a unique full-commit SHA and private `http://trueforge.railway.internal:8080` endpoint.
2. An independently trusted sponsor issuer has an explicitly reviewed `VERIFIED` public-key fingerprint in `config/gk-sponsor-issuer-pin.json`, which is currently **UNCOMMISSIONED**. A test-generated key or agent-authored receipt cannot replace the sponsor proof.
3. A genuine Ed25519-signed short-lived statement binds the 40-character source commit, all four tasks' digest (including keys), one DeepSeek provider/model, owner funding, nonpersonal billing, **exactly 8 reviews + 6 reflections**, 2,500/400 max output tokens and no tools/repair/retry.
4. A *read-back verified* dedicated TrueFoundry virtual account holds a **US$1 lifetime, per-VA, Enforce** rule, with sponsor credit available, overage and personal fallback disabled. This rule is the true external cap. The local `BudgetController` is secondary and cannot prove gateway settlement.
5. The isolated TrueForge runtime contains one registered native `truefoundry` route to exactly the selected `tfy-managed` upstream; private owner-controlled S3 is configured with **create-if-absent** writes.

The runner claims a unique run ID atomically in private S3 before sending any native session requests. It saves raw instructions, prompts, outputs and turn/session references privately **immediately after each call**, then private scoring/lesson evidence. Any error becomes a **non-retryable unreconciled run**. Public logs report only sanitized aggregates; no private session identifiers, holdout keys, object paths or authentication tokens.

## Scoring and independent verdict

The frozen deterministic `evals/score.ts` computes line/category defect matching (±1 line), 0.5 noise penalty and missed seeded issues. It does **not** independently prove the semantic correctness of explanations. The new evaluator also preserves strict JSON parsing and keeps semantic judgement `NOT_RUN` until a separate *blinded* and independent adjudicator evaluates every claim, including false subsidiary assertions. A trusted verifier must reconcile true gateway traces, exact source/model/prompt hashes, non-overwritten S3 evidence and sponsored billing before signing qualification. Until then the result is **INCONCLUSIVE**, even if Gate Keeper has greater line recall.

**Do not** publish invented progress or merge the old Playground and new native time series. The Base44 report must show model, method, each four-round score and missing slots as **not run**, never zero. It must show price estimates separately from reconciled actual billed costs.

## Source-only qualification

`Dockerfile.qualify` runs TypeScript checking, the frozen scorer self-test and all offline Node tests. `tests/native-deepseek-four.test.mjs` uses only disposable synthetic signing keys and a fake TrueForge API; a mock test proves no leakage but cannot count as a live DeepSeek turn. The qualification environment must not connect to a production database or provider credential.

**Operational blockers at preparation:** sponsor grant and separate US$1 account/rule unverified; the isolated qualification project currently has no TrueForge service, DB or budget identity. The connected browser automation balance was negative, so the authenticated TrueFoundry account could not be commissioned from this chat. No evidence of actual native DeepSeek review/learning turns has been produced.
