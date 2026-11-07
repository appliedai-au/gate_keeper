# Per-model rule overlays

Rules the improve loop learns are **not model-agnostic**: the same two rules learned on `deepseek-v4-flash-0731` moved net by +6 on one model and −9 on another in the 7 Nov 2026 sweep. So:

- `gate-keeper-v13.md` is the shared core and is the same for every model.
- A file here, `<provider>-<model>.md`, holds the rules learned **on that model only**, one `- rule` per line. The launcher loads it for that model and no other.
- A rule is promoted into the core only after it clears the improve gate (net +3, neither split worse) on **two different model families**.
- Each file records where its rules came from: the run's `GK3_RULES` line (model, rules, prompt hash) and the training gain.
