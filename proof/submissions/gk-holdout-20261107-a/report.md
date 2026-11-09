# Unseen holdout `gk-holdout-20261107-a`: Gate Keeper vs Codex vs Qodo

**Result: on changes it had never seen, the unchanged OpenAI Codex review rubric did best. Gate Keeper v12 was the cheapest and fastest and raised fewer false alarms than Qodo, but missed more real bugs than either.** Reported as measured. Billing: the gateway's own receipts were not reconciled. The figures below come from the run's turn metrics.

## Setup
- **Tasks:** 42 code changes, 27 with real bugs and 15 clean changes written to look risky. They come from two private sets written on 1 Nov 2026 and never used for any tuning: SHA-256 `a5b2203c…` (10 tasks) and `fff2e269…` (32 tasks). Gate Keeper v12 was tuned only on tranches 1–6. Both sets are now burned. The tasks, answer key and raw replies stay private. The private payload SHA-256 is `6b3a5a20…842e`.
- **Reviewers:**
  - OpenAI Codex review rubric, unchanged (sha `ec60e7f3…`)
  - Qodo PR-Agent prompt, unchanged except the disclosed cap of 20
  - Gate Keeper v12 (sha `c552b0b2…`) with its line merge
- **Model and settings:** same for all three. `truefoundry/deepseek-v4-flash-0731` through the Stranger Builds TrueFoundry gateway, temperature 0.2, max 8,000 output tokens, 3 trials, no tools.
- **Harness:** `proof/three-agent/run.mjs` at `9f12a8ec97cf3ff5ca8a4c7c38a769f2825b33c3`. Each finding is scored deterministically by line (±1) against the private key.
- **Spend:** about US$0.18 over 378 calls (estimated from turn metrics, not reconciled with gateway receipts).

## Results (126 reviews per reviewer)
| Reviewer | Real bugs caught | Catch rate | False alarms | Net | Clean changes flagged | Avg time | Avg cost / review (est.) |
|---|---|---|---|---|---|---|---|
| Codex rubric | 78/81 | 96% | 22 | **56** | 12/45 | 16.2 s | $0.00090 |
| Qodo PR-Agent | 81/81 | 100% | 54 | 27 | 26/45 | 6.6 s | $0.00031 |
| Gate Keeper v12 | 72/81 | 89% | 39 | 33 | 14/45 | 6.5 s | $0.00025 |

Codex had 3 reviews that did not return a parseable answer within the output limit; they scored zero. Two were on bug tasks and one on a clean task, so they account for 2 of its 3 misses. Excluding them, Codex caught 78/79 (99%).

## Where Gate Keeper lost
- **Go: `defer rows.Close()` before the error check.** Missed in 0/3 trials. Its checklist talked itself out of the bug, wrongly concluding "Close on nil rows is safe".
- **Python: `os.path.join` with an absolute file name bypassing a `..` check.** Caught in 1/3 trials.
- **The `os.path.join` and goroutine-leak tasks** also drew most of its false alarms.

## Caveats
- One model and one task set.
- The tasks and answer key were written by the evaluator, not an independent party.
- Scoring is by line.
- Gate Keeper v12 was tuned on GLM-5.3 Flash, not DeepSeek. GLM was reachable in the test environment only through the learning authority's service, which was left untouched.

## What this means for the decision rule
"If Gate Keeper wins on real review outcomes, productise its specialist verification and learning layer; if not, retain the governance code and eliminate duplication." On this unseen holdout Gate Keeper's reviewer prompt did not win. The learning pilot (10 attempts, all invalid) has not shown an improvement either.
