# Holdout status (internal dry run)

| Tranche | Status | Notes |
|---|---|---|
| 1–5 | training | Used to tune Gate Keeper v2–v8. |
| 6 | **burned** | Was the holdout for frozen v8 (3 Nov, commit 16738f6). It was then folded into training for v10/v11 (`payloads/train-t4-t6-*`), so any score on it after v8 is a training score, not a holdout score. |
| 7 | **sealed holdout** | 5 tasks, 31 bugs. Tranche hash `c40e1e243cc327fb5ca1124388c040f15c0f239d1ef8d28cb3258883aff37cd8`. Not opened; to be run once, after the Gate Keeper config is frozen, against Codex and Qodo. |

Results on tranche 6 for v10, v11, the vote/duo arms and the 20-config matrix must not be reported as holdout results.
