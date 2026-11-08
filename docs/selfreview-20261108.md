# Self-review of Gate Keeper's own main — 8 November 2026

Gate Keeper v13.1, the unchanged Codex rubric and the unchanged Qodo PR-Agent prompt each reviewed the 142 production source files of this repository at `6775548` (scripts, Base44 integration, three-agent harness, evals; tests and vendored code excluded), split into 216 windows of up to 160 lines. One trial per window, `truefoundry/deepseek-v4-flash-0731`, temperature 0.2, 8,000 max output tokens, same settings for all three. There is no answer key: every finding is a candidate that a person has to check against the code. Spend: US$1.35 (cap US$3).

## What came back

| Reviewer | Reviews | Returned nothing (cut off at the 8,000-token cap) | Candidate findings |
|---|---|---|---|
| Gate Keeper v13.1 | 216 | 139 | 27 (from 41 reviews with an extractable findings block) |
| Codex rubric | 216 | 144 | 26 |
| Qodo PR-Agent | 216 | 9 | 514 |

**The main result is a reliability problem, not a bug list.** On real code windows, about two thirds of Gate Keeper and Codex reviews ended without a usable answer, where the sealed holdout had none. Qodo returned an answer almost every time but produced 514 speculative findings. A reviewer that goes silent on most real code is not usable as it is run here; output length handling has to be fixed before any production claim.

## Hand-check of Gate Keeper's findings (15 of 27 checked)

Checked by reading the code at `6775548` (and running Node where a behaviour claim was testable). Line numbers are file lines.

| Finding | File:line | Verdict |
|---|---|---|
| Verdict is PASS when no checks ran (`every` over an empty set) | `scripts/proof/live/drill.mjs:169` | **Real**, medium: a finished job with no rounds reports PASS |
| Revision check is not atomic with the update (two findings, same issue) | `integrations/base44/functions/gatekeeperControls.js:103`, `.../gatekeeper-controls/entry.ts:104` | **Real**, low to medium: lost update on concurrent saves; single admin owner limits exposure |
| Approved-host check ignores the port, so the token can go to any port on an approved host | `scripts/truefoundry/gateway.mjs:173` | **Real**, low: the host list is owner-configured |
| Plaintext password in the command line of `caddy hash-password` at start-up | `scripts/learning-v2/start-status-proxy.sh:8` | **Real**, low: short-lived, container-local |
| Non-numeric `GK_PROOF_DEADLINE_MIN` gives a NaN deadline that never expires | `scripts/proof/live/run.mjs:105` | **Real**, low: needs a misconfigured env value |
| Holdout guard matches the directory by substring (`/tranche-6/`) | `proof/three-agent/mkimprove.mjs:12` | **Real**, low: a dev script; a name like `tranche-60` would pass |
| Header copy throws on forbidden headers | `scripts/learning-v2/status-listener.mjs:38` | **False alarm**: Node's `Request` accepts those headers (tested on v22) |
| 304 rejected as a redirect | `.../gatekeeperReview/entry.ts:16`, `.../gatekeeperLearningStatus/entry.ts:70` | **False alarm**: the request is an unconditional POST, so no 304 occurs |
| `estimatedCostUsd.toFixed` can crash | `integrations/base44/components/GateKeeperReview.jsx:177` | **False alarm**: the contract allows only a number or null, and null is handled |
| Spreading `reply.jobs` can throw | `integrations/base44/shared/review-pending.js:21` | **Likely unreachable**: validated replies always carry a `jobs` array; callers not fully traced |
| Lease leaked if `reserveOperation` rejects | `scripts/learning-v2/runtime.mjs:31` | Unresolved (design may intend durable reservation) |
| CAS rejection retains the journal lock | `scripts/learning-v2/journal.mjs:454` | Unresolved (may be the intended "operator recovery" path) |
| Un-awaited `evidenceStore.put` | `scripts/proof/sponsor-smoke.mjs:124` | Unresolved (depends on whether `put` is synchronous) |

12 findings were not checked and are not claimed as defects. Codex's and Qodo's findings were not hand-checked.

## What this does and does not show

- It shows Gate Keeper can find genuine, minor defects in real production code, including one fail-open verdict, at a cost of well under US$1 per full pass.
- Of the 15 checked, 6 were real, 5 were false alarms and 4 were unresolved: roughly 40% precision on what was checked, with the highest-confidence finding (0.8) a false alarm. Confidence did not rank real above false in this sample.
- It does not show recall, because there is no list of the real defects in this code.
- One model, one pass, no repair outcomes. The findings above are candidates for fix PRs, not fixed.
