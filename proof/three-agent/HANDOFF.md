# Gate Keeper dry run: handoff (3 Nov 2026)

This is an internal training dry run. It is not recorded, so nothing here is written up or signed. Gate Keeper is compared with the unchanged OpenAI Codex review rubric and Qodo PR-Agent (cap 20) on stock TrueForge, with models served through TrueFoundry. Owen's goal is to improve the agent, not to compare LLMs.

## State of the repo
- **PR #40** (`fix/native-four-runtime-tools`): the no-tools directive, failing closed on tool calls, and the TrueForge 0.182.0 allow-list. Its description was corrected on 3 Nov: 0.182.0 alone does **not** fix the DeepSeek stream error. What fixes it is the SSE reframing proxy in this folder (`sse-proxy.mjs`, custom provider `tfy-direct`).
- **PR #41** (`study/three-agent-review`): this harness (`run.mjs`, `boot.mjs`, `sse-proxy.mjs`, `mkimprove.mjs`), the Gate Keeper prompt versions v2–v12, and the training payloads. Gitar's one open finding is the tranche-6 contamination. It is addressed in `HOLDOUTS.md` and in the payload names (`train-t4-t5-t6burned-*`), but Gitar keeps restating it against the old file name. It can be dismissed.
- Merging is Owen's click. The agent's merge call was refused twice by the session's safety check.

## Frozen default
- **Model:** `glm-5.3-flash` through TrueFoundry (`tfy-managed/glm-5.3-flash`, registered in TrueForge as `glm-5-3-flash`). Owen picked it on 3 Nov.
- **Agent:** `gate-keeper-v12.md` (sha256 `c552b0b2e188fdb7b08aa4d13cd7ccd5c17602caf17c7e5476fbcf2d08ae8d2b`). It is v10 plus a required `quote` of each finding's line. In code, findings on the same or the next line are then merged.
- **Training score** (t4–t6, 15 tasks × 3 trials, 267 planted bugs): net 170, made of 199 caught and 29 false alarms. It takes about 10 s and costs about $0.0004 per review. Plain v10 on the same runs scored net 151 (194 caught, 43 false alarms).

| Version (all GLM) | Net | Caught | False alarms | Time | Cost per review |
|---|---|---|---|---|---|
| v12 quote + merge | 170 | 199 | 29 | 10 s | $0.0004 |
| v10 + 3 focused passes, merged | 170 | 229 | 59 | 14 s | $0.0016 |
| GLM + MiMo union, merged | 170 | 222 | 52 | 26 s | $0.0011 |
| v10 + merge | 156 | 194 | 38 | 10 s | $0.0004 |
| v10 | 151 | 194 | 43 | 10 s | $0.0004 |

All of these runs are on training tasks. Run-to-run noise is about ±10 net.

## Tranches
- Tranches 1–6 are used up for training. Tranche 6 was the holdout for v8 (GK 23/34 with 6 false alarms, Codex 20/34 with 1, Qodo 20/34 with 2) and was then folded into training. See `HOLDOUTS.md`.
- **Tranche 7 is sealed**: 5 tasks, 31 bugs, tranche hash `c40e1e243cc327fb5ca1124388c040f15c0f239d1ef8d28cb3258883aff37cd8`, at `/mnt/project-files/sealed-tranches/tranche-7/`. Do not open it or tune on it. Run it exactly once, after the config is frozen.

## Spend
- The dry run has spent about **US$0.63** of a **US$1.00** hard stop. The runner's own stop is US$5, and the team's TrueFoundry budget is US$50 lifetime.

## Improve step: built, not run
- Set `GK3_IMPROVE=1` with payload `payloads/train-t4-t5-t6burned-improve-v12.b64`. Each round:
  1. Gate Keeper reviews the training tasks.
  2. It sees its misses (with each bug's reason) and its false alarms.
  3. It writes at most two general rules.
  4. It keeps them only if net rises by `GK3_MIN_GAIN` (8) or more and neither split (t4–t5 fit, t6 check) gets worse.
- There are 3 rounds. The same run also scores focused passes with quotes required.
- Estimated cost is about 13¢, with a cap of 15¢. **It is waiting on Owen's go.** It was quoted on 3 Nov and hasn't been approved yet.

## Asks for whoever takes over
1. Get Owen's go, then run the improve step. Keep any learned rules only if they clear the gate, then freeze the result.
2. Quote the cost to Owen. Then run the **tranche-7 holdout once**: Codex, Qodo (cap 20) and the frozen Gate Keeper, on the same model and the same harness. Report caught, false alarms, time and cost per review for each.

## How to run (Railway project `gk-learning-qual-1031`, qualification environment, runner service)
- The runner loads `run.mjs` and the payload from the raw GitHub URL at `GK3_COMMIT`. Set `GK3_COMMIT` to a pushed SHA, and set `GK3_PAYLOAD` to a file name that exists at that SHA.
- Mode variables: `GK3_IMPROVE=1`, or `GK3_PIPE=1`, or `GK3_MATRIX=1`. With none of them set, a plain arm run uses `GK3_ARMS`.
- Model: `GK3_MODEL_B=glm-5.3-flash`.
- Budget and pacing: `GK3_TRIALS`, `GK3_CAP_USD`, `GK3_RESERVE_OUT=2000`, `GK3_CONCURRENCY=3`.
- Setting variables redeploys the runner. Only one runner deployment may run at a time, or the proxy breaks.
- TrueForge server must stay on 0.182.0 builds. TrueForge model names must be lowercase with hyphens and no dots; `boot.mjs` maps the dots.
- Results are in the deploy logs: `GK3_MATRIX`/`GK3_EVAL`/`GK3_IMPROVE` lines and `GK3_SUMMARY` (actual spend).

## Rules (Owen's, all still in force)
- Models run only through TrueFoundry.
- Never create, reveal, enter or paste API keys, tokens or passwords in chat, files or logs. Owen does those clicks himself.
- Quote the cost before every paid run, and keep to the hard stops.
- Never fabricate scores, costs or evidence. A run that fails is reported as it happened, and an INCONCLUSIVE result stays INCONCLUSIVE.
- Leave the Codex and Qodo prompts unaltered, apart from the disclosed Qodo cap of 20. Harness changes apply to every agent equally.
- Don't tune on the sealed holdout.
- PRs merge only on Owen's word. Signing happens only on his explicit word, on his Mac.
- Send no external messages without his approval.
