# Population learning run `gk-learn-20261101-c`: stopped at ingestion (no shared rule passed)

**Result: NO EVIDENCE on population learning.** The run worked as designed and stopped before qualification, because no shared rule passed ingestion. **Billing: UNVERIFIED.** Spend figures are tokens × list price.

- Harness commit: `14e464ce07703d9c5d07ad97ca53a46d0067104b`, on TrueForge 0.180.0.
- Models (the locked per-role baseline, `agent/models.json`): reviewer `anthropic/claude-sonnet-5-5` (Gate Keeper adversarial), grader `anthropic/claude-fable-5-1`, learning `anthropic/claude-opus-5-5`.
- Spend: **US$0.96** of a US$4.50 cap (dev 0.82, learn 0.13; 27 calls, 0 refusals).
- Private evidence: 30 objects, manifest `647a98a23e38fe5cfb8ad9e2f7e54f9afc1fcc8b0bae4f83f5369a97642e40b2` at `railway-bucket://gk-proof-evidence-kylc9za/gate-keeper-proof/gk-learn-20261101-c/`.
- Dev holdout v3 SHA-256: `6ea7823d0b18d11d495774915b136c94d3848125f0e594013d07b55a25f70053`.
- Unseen new-tenant holdout v4 SHA-256: `a5b2203cad77a13a8100e5c111745f50eeca9d483322336d3075b1adfaeb93f7`. It was **not used**, so it stays sealed for the next attempt.

## What happened
| Stage | Result |
|---|---|
| Dev review (12 tasks across 6 tenants, 2 each; `tenant-f` non-consenting) | PASS: 24/24 key issues, **5 false positives**, 0 misses, precision 0.844 |
| Tenant-private lesson capture (one isolated session per tenant with errors) | PASS: 3 lessons (tenant-b 1, tenant-c 2). Other tenants had no errors, or their capture returned none |
| Population ingestion (≥2 consenting tenants, anonymisation filter) | **FAIL.** The selector merged the 3 lessons into **one** rule supported by 2 tenants. The rule was rejected by the `LENGTH` check (over 320 characters). Only its hash is public: `9f8b4c56719fc212b8c24dc4a9bf504b178cb5c6ae938bf042157517cb79ae36` |
| Qualification / new-tenant proof | NOT RUN |

## Why this is not yet a test of population learning
1. **There were too few errors to learn from.** At the locked baseline (Gate Keeper adversarial on Sonnet 5.5), 12 dev tasks produced 5 false positives and no misses, from only 2 tenants. A meaningful test needs a dev set large and hard enough that the baseline makes dozens of errors across 6 or more tenants.
2. **The length limit was set for single-sentence rules.** The Opus 5.5 selector wrote one long, merged rule. A selector-side word limit with a looser character cap (for example, 40 words / 600 characters) would test the idea without weakening the anonymisation checks, which are separate from length.

## Next (owner decision; part of "tune further afterwards")
- **Enlarge and harden the dev set:** about 30–40 tasks from 6–8 tenants, including subtle false-positive bait. Keep holdout v4 sealed for the new-tenant proof.
- **Ask the selector for ≤40-word rules** and cap at 600 characters.
- Re-run the population learning test against `proof/baseline.json`.
