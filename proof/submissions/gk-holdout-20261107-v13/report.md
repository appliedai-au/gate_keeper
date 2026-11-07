# Unseen holdout `gk-holdout-20261107-v13`: Gate Keeper v13.1 vs Codex vs Qodo

**Result: on a fresh sealed holdout, Gate Keeper v13.1 scored the highest net (63), ahead of the unchanged OpenAI Codex review rubric (60) and Qodo PR-Agent (53). The gap to Codex is within noise (paired test p = 0.27), so this is a tie on quality, with Gate Keeper ahead of Codex on cost (less than half), speed (under half the time) and false alarms (13 vs 15 vs 25 for Qodo), and level with Qodo on reliability (neither had unparsed replies). Qodo is cheaper and faster per review than Gate Keeper. The gap to Qodo is significant (p = 0.02).** Reported as measured. Costs are estimates from turn metrics and were not reconciled with gateway receipts. The p-values come from the harness's paired sign-flip test on per-review net; the raw rows are private and not committed, so they cannot be recomputed from this repository.

## What changed from v12
v12 lost to Codex on the previous holdout (net 33 vs 56, `gk-holdout-20261107-a`). v13 keeps Gate Keeper's learning loop and adds the best parts of the Codex rubric (Apache-2.0, attributed in the prompt):
- **From Codex:** its flagging test (introduced by the change, discrete, the author would fix it, provably affected, no unstated assumptions), "list every qualifying finding", per-finding confidence with a 0.5 floor, short line ranges.
- **Kept from Gate Keeper:** the six hunt passes (boundaries, untrusted input, identity and access, state and concurrency, failure paths, semantics), stated-context rules, "check what the language really does before dismissing" (v12's main miss), the same-line merge step, and the learning loop.
- **Dropped:** v12's "ok/BROKEN" checklist, which on the previous holdout talked itself out of real bugs, and the `quote` field, which broke JSON on code with double quotes.
- **Learning loop (TrueForge improve step):** run on the training tranches only (t4–t5 fit, t6 check), 4 rounds, 3 trials, gate = net +3 with neither split worse. It kept 2 rules (training net 144 → 151). v13.1 = v13 + those 2 rules, frozen before the holdout was opened. The loop also rejected a near-identical rule set in round 1 (net −13), so the training gain is within run-to-run noise.

## Setup
- **Tasks:** 39 code changes in Python, JavaScript, TypeScript and Go: 27 with one planted bug each, 12 clean. Written and sealed on 7 Nov 2026 before any v13 result was seen, and never used for tuning. Task hash `e93bc3d9…`, payload SHA-256 `5631e7e7…`. Tasks, answer key and raw replies stay private. The set is now burned.
- **Reviewers:** OpenAI Codex review rubric unchanged (sha `ec60e7f3…`); Qodo PR-Agent unchanged apart from the disclosed cap of 20; Gate Keeper v13.1 (sha `0f26ac16…`, `proof/three-agent/gate-keeper-v13.1.md`) with its line merge.
- **Model and settings:** same for all three. `truefoundry/deepseek-v4-flash-0731` via the Stranger Builds TrueFoundry gateway, temperature 0.2, max 8,000 output tokens, 3 trials, no tools.
- **Harness:** `proof/three-agent/run.mjs` at `86888bfaa1572c93073815ceb03e45ed780fb9ec`. Findings are scored deterministically by line (±1) against the private key.
- **Spend:** about US$0.16 over 351 calls (estimated).

## Results (117 reviews per reviewer)
| Reviewer | Real bugs caught | Catch rate | False alarms | Net | Clean changes flagged | Unparsed | Avg time | Avg cost / review (est.) |
|---|---|---|---|---|---|---|---|---|
| **Gate Keeper v13.1** | 76/81 | 94% | **13** | **63** | **9/36** | **0** | 5.8 s | $0.00035 |
| Codex rubric | 75/81 | 93% | 15 | 60 | 11/36 | 2 | 13.6 s | $0.00078 |
| Qodo PR-Agent | 78/81 | 96% | 25 | 53 | 14/36 | 0 | 4.7 s | $0.00026 |

Paired per-review sign-flip test on net (same task, same trial): Gate Keeper vs Codex +3 over 117 pairs (11 differ, 7 up, 4 down), one-sided p = 0.27. Gate Keeper vs Qodo +10 (17 differ, 13 up, 4 down), p = 0.02.

Gate Keeper and Codex missed the same two tasks: a Go map written by concurrent goroutines without a lock (missed in 2 of 3 trials), and an upload read fully into memory before its size check (missed in 3 of 3). Codex also missed a refund check that ignored earlier refunds in one trial. Qodo's only misses were the Go map race.

## Second check on the previous holdout's tasks
On the 42 tasks of `gk-holdout-20261107-a` (now burned, used here only as a development check, same model and settings): Gate Keeper v13.1 caught 75/81 with 19 false alarms, net **56**, the same as Codex's 56 and well ahead of v12 (33) and Qodo (27).

## Caveats
- One model, and each set is small. Against Codex, both sets show a tie on quality, not a clear win.
- I (Claude) wrote this holdout in the same session that designed v13. It was sealed before any v13 result was seen, but its author knew v13's design. Each task has one planted bug, and catch rates are above 92% for all three reviewers, so the set does not separate strong reviewers well.
- v13's quality gain comes mostly from adopting the Codex rubric's criteria. The learning loop's 2 rules gave a training gain within noise.
- This measures review findings only, not repair outcomes.
