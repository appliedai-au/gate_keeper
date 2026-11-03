# Preparing the v12 comparison

This is preparation, not approval to dispatch, spend, merge or open tranche 7.
Use `comparison-v12.env.example` as a review checklist, not a live service update.
Its zero cap prevents model calls; commit and payload are deliberately unset.

## Frozen behavior

- Same GLM-5.3-flash model, temperature 0.2 and 8000-token limit for every arm.
  Set **GK3_MODEL**, not only GK3_MODEL_B. Boot registers the TrueForge name
  `tfy-direct/glm-5-3-flash` with upstream ID `tfy-managed/glm-5.3-flash`.
- Codex rubric unchanged. Qodo templates unchanged with the disclosed **20-finding
  cap**, as rendered by `build.mjs`. This is not an uncapped Qodo comparison.
- Gate Keeper v12 requires quotes. Set `GK3_GK_MERGE=1` to apply the same existing
  start-line merge used by pipeline/improve to the plain `gate_keeper` arm.
  It retains sorted findings whose starts are more than one line apart from the
  last retained finding. It does not transitively collapse an adjacent chain.
  This is Gate Keeper behavior; Codex and Qodo findings and shared scoring stay
  unchanged. Quote presence is requested by the prompt, not enforced by scoring.
- The supplied prompt hash pins original v12. If approved improvement yields a
  different frozen prompt, update the reviewed hash and payload before dispatch.
  `GK3_EXPECT_GK_SHA256` checks the actual prompt, not its claimed payload hash.
- Plain runs remain unchanged when `GK3_GK_MERGE` is unset. `GK3_START` records
  the merge choice, actual Gate Keeper prompt hash and source commit.

## Before any approved dispatch

1. Reconcile actual spend, including incomplete/failed runs. The handoff's US$0.63
   is historical. Obtain Owen's explicit approval for the concrete run quote/cap.
   The US$1 dry-run hard stop takes precedence over runner/team budgets. The
   per-run reservation is an estimate, so preserve enough headroom and provider
   controls; a configured cap alone is not a billing guarantee.
2. Validate the patch with the full repository gate through Spekky's Maintenance
   Executor on a verified dedicated runner. Record provider, exact SHA or sealed
   patch, run ID, checks and results. Do not use this qualification app runner as
   a replacement for the managed repository gate or run checks locally.
3. Inspect current deployment/run state. Keep one runner deployment at a time.
   Preserve credentials, private-network allowlists and TrueForge 0.182.0.
   Never apply the example blindly: setting service variables redeploys it.
4. Pin `GK3_COMMIT` to the reviewed full SHA and `GK3_PAYLOAD` to an approved
   payload present at that SHA. Confirm actual decoded arm prompts, hashes,
   temperature and token limit using training/synthetic data before holdout.
   Do not open/build a tranche-7 payload during this preparation.
5. Once the final config is frozen and the separate holdout quote approved,
   tranche 7 may be run once. Keep `GK3_IMPROVE`, `GK3_PIPE`, `GK3_MATRIX` and
   `GK3_MODEL_B` empty. Use `codex,qodo,gate_keeper` and one trial. All model
   calls go through TrueFoundry via the existing private SSE proxy.

Remote validation must include `npm run typecheck`, `npm run test:learning-policy`
and any additional checks required by the repository gate preset. The latter
includes `tests/three-agent-comparison.test.mjs`, which exercises the real plain
worker with a fake SDK and synthetic tasks, with no network/model calls.

Report caught, false alarms, unparsed/failed turns, elapsed time, actual cost and
run identity per arm. Source validation, model evaluation, merge and deployment
are separate evidence. Failed or budget-stopped evaluation stays inconclusive.
