# Gate Keeper vs standard reviewer — first live DeepSeek v4 Flash Playground A/B

**Run:** `gk-playground-deepseek-20261102-a` · **Date:** 2 November 2026 · **Verdict: INCONCLUSIVE** (methodology smoke only; *not* independent qualification).

## What actually ran

Two genuine, successful model requests using the owner's authenticated **Stranger Builds TrueFoundry Playground** and the **same** `tfy-managed/deepseek-v4-flash-0731` model. This was **not** an end-to-end call through the hosted TrueForge SDK/runner, and it did not activate any production review path. It tests the effect of review instructions, not two different LLM backends.

- Fixture: `evals/tasks/01-python-utils.json` at source commit `b0b4b359ce482ddc3dc42c7332f8cbb232c05412` (public Python helper code; three seeded problems).
- One trial per arm, fresh conversation per arm, same code and user task, same model, temperature 0, effective Playground max output 2,500 tokens. A 500-token limit was requested but the Playground would not expose that control.
- Arm A: simple TrueForge-style code reviewer with a shared JSON findings contract.
- Arm B: Gate Keeper reviewer core instructions + adversarial method + review checklist + equivalent JSON findings contract from the same GitHub source.
- No private holdout, tooling, repair, user database, learning, repository mutation, autonomous actions or additional model calls.

**The baseline arm is a plain reviewer run in the TrueFoundry Playground. Calling it “standard TrueForge” describes the review instructions only; no native TrueForge reviewer pipeline was invoked.** The full system-prompt byte sequences were not independently escrowed, so this is evidence for a smoke comparison rather than exact byte-for-byte benchmark parity.

## Findings and deterministic location matches

| Arm | Known defect locations detected | Missed locations | Known-defect recall | Severity on matched findings | False extra finding locations |
|---|---:|---|---:|---:|---:|
| Plain review | **2 of 3** | line 22 | 66.7% | 1/2 | 0 |
| Gate Keeper adversarial | **3 of 3** | none | 100% | 3/3 | 0 |

The three seeded defects in `utils.py`:

1. **Line 7 (bug, high):** `range(0, len(items) - size, size)` drops the last chunk and yields an empty result for small inputs.
2. **Line 12 (bug, medium):** `tags=[]` is a shared mutable default list, leaking state between calls.
3. **Line 22 (error handling, medium):** `except Exception: return {}` swallows failures (e.g. malformed JSON or permission errors) as if the configuration were legitimately empty.

The plain review found lines 7 and 12 but missed line 22; it rated line 12 `high`, rather than the benchmark's `medium`. Gate Keeper found all three known locations and matched their expected severities.

**Important adversarial caveat:** Gate Keeper added “size=0 causes an infinite loop” inside the line-7 explanation. This is **false**: Python's `range(..., step=0)` raises `ValueError`. Thus the automated location-level false positive count of zero does **not** imply a completely accurate explanation. Mark one unsupported subsidiary claim and do not call the explanation precision 100%.

## Reconciled gateway metrics (actual platform-reported request costs)

| Metric | Plain review | Gate Keeper |
|---|---:|---:|
| Model | `tfy-managed/deepseek-v4-flash-0731` | Same |
| Successful Playground requests | 1 | 1 |
| Total tokens, approximate | 529 | 1,200 |
| Gateway-measured latency | 3.14s | 2.62s |
| Gateway-reported charge | **US$0.00009408** | **US$0.00018522** |
| Observed trace/span ID suffix | `8db65042d03d` | `3f84ea8a69e4` |

**Combined gateway-reported charge: US$0.00027930 for two requests** (no independent invoice and no input/output token split). The total is based on the Request Traces' cost fields, **not** inferred by multiplying the model list price. Request trace full IDs and sponsor-credit deduction/remaining balance were not visible. The request traces showed the two respective system-prompt types and the same `utils.py` user task.

The tenant has an existing **US$50 lifetime Enforce** Applied_AI budget, but that is a ceiling, not proof of the remaining sponsored credit. This run did **not** create a virtual account or a separate US$1 policy. **Whether the platform deducted these charges from sponsored credits is unverified.** There was no intended fallback to a different provider.

## Interpretation and limits

- **Observed difference:** On this simple public test, Gate Keeper found the swallowed error that the plain reviewer missed, using ~2.3× the reported total tokens and ~1.97× the gateway-reported cost. Both calls cost far below one US cent.
- **Not a certified win:** One public fixture and one trial per arm, no independently sealed holdout, no independently verified correctness grader, nonidentical instruction lengths, and no native TrueForge SDK execution. Gate Keeper also made one wrong explanation claim.
- **Do not compare this to earlier full proof run as if they shared a setup.** Historical `gk-live-20261101-g` tested Claude models, two trials and private holdouts through an earlier TrueForge process and remains **INCONCLUSIVE**.
- **Next evidence needed:** repeat with fresh harder fixtures and independent grading, verify the exact sponsor-credit billing route, commission the dedicated capped identity and isolated TrueForge runtime, and compare other cheapest eligible models before deciding which reviewer is more economical.

The structured source of this report is [summary.json](./summary.json). Publication on the Base44 Runs/Evidence page should clearly label it **Playground smoke**, show the original INCONCLUSIVE status, and must not claim the production Gate Keeper agent is connected or qualified.
