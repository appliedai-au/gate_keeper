# Holdout status (internal dry run)

| Tranche | Status | Notes |
|---|---|---|
| 1–5 | training | Used to tune Gate Keeper v2–v8. |
| 6 | **burned** | Was the holdout for frozen v8 (3 Nov, commit 16738f6). It was then folded into training for v10/v11 (`payloads/train-t4-t5-t6burned-*`), so any score on it after v8 is a training score, not a holdout score. |
| 7 | **sealed holdout** | 5 tasks, 31 bugs. Tranche hash `c40e1e243cc327fb5ca1124388c040f15c0f239d1ef8d28cb3258883aff37cd8`. Not opened; to be run once, after the Gate Keeper config is frozen, against Codex and Qodo. |

The training payloads are named `train-t4-t5-t6burned-*` so the name says t6 is burned. Results on tranche 6 for v10, v11, the vote/duo arms and the 20-config matrix must not be reported as holdout results.

## gk-holdout-20261107-v13 (burned 7 Nov 2026)
39 private tasks (27 bugs, 12 clean), task hash `e93bc3d9…`, payload `5631e7e7…`. Written and sealed before any v13 result; run once on v13.1 vs Codex vs Qodo. Report: `proof/submissions/gk-holdout-20261107-v13/report.md`. Now burned.

## lang-holdout-1 (54 tasks, 6 per language) — used 7 Nov 2026 for DeepSeek
Sealed by a separate thread (manifest b2d7de4e…794343). Run once at commit 934b94c with the frozen DeepSeek packs
(packs/deepseek-v4-flash-0731.json). Result: run 1 (rule-free 13.1 core) net 383, run 2 (packs) net 349, Codex rubric 377.
The packs did not generalise. This set is no longer clean for DeepSeek.
