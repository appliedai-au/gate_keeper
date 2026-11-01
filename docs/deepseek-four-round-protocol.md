# DeepSeek v4 Flash — four successive reviews per method

**Current state (2 November 2026): 1 of 4 observed per reviewer, 2 of 8 review turns total.**
The only real observed gateway calls are source-bound to the earlier
[gk-playground-deepseek-20261102-a](../proof/submissions/gk-playground-deepseek-20261102-a/report.md)
one-fixture report. No subsequent review, self-reflection or agent improvement
may be reported as completed without new gateway evidence.

## Two experiments, do not conflate

1. **Playground prompt-learning proxy (continuation):** use exactly
   `tfy-managed/deepseek-v4-flash-0731` under Stranger Builds. Retain the
   original baseline and Gate Keeper Round 1 only as *Playground* results.
   Finish six more review turns (three for each arm), plus independent
   same-DeepSeek self-reflection turns after each of rounds 1–3 for each arm.
   That is **six review and six learning turns remaining**. This does NOT
   demonstrate autonomous native TrueForge agent learning.
2. **Actual native agent comparison (separate series):** commission two
   isolated, identically funded TrueForge agents and new model-bound
   sessions with independent lesson stores. Start *both* at Round 1: eight
   review turns and six feedback/learning turns across four rounds. Do not
   merge their metrics with the earlier Playground study.

These are different execution channels. A switched model, provider, version
or agent runtime requires a new run ID and restarted baseline.

## Frozen schedule

| Round | Same public task for BOTH methods | Review calls | Feedback |
|---|---|---:|---|
| 1 | `evals/tasks/01-python-utils.json` | **2 OBSERVED** | self-reflection **NOT OBSERVED** |
| 2 | `evals/tasks/02-express-users.json` | 2 pending | own Round 1 lesson required first |
| 3 | `evals/tasks/03-python-deploy.json` | 2 pending | own Round 2 lesson required first |
| 4 | `proof/fixtures/four-rounds/05-ts-task-pagination.json` | 2 pending | own Round 3 lesson required first |

Each public fixture has three known seeded defects. **Do not give the model
the expected findings for the next fixture, or the other reviewer's
feedback.** All fixtures are public and vary in difficulty: trends across
them are **exploratory**, not causal proof of the learning mechanism.

## Controlled pass protocol

- **Model and parameters:** same `tfy-managed/deepseek-v4-flash-0731`,
  temperature 0, max output tokens 2,500, no tools, retries, repair or
  shared memory. The Playground locked the earlier maximum at 2,500;
  enforce this for subsequent Playground calls rather than silently
  changing a dimension. Verify no arbitrary model substitution.
- **Run 1 evidence:** plain reviewer 2/3 defects, 529 reported tokens,
  gateway charge US$0.00009408; Gate Keeper 3/3, approximately 1,200
  tokens, charge US$0.00018522. Gate Keeper's zero-step infinite-loop
  claim was wrong. Sponsor-credit deduction was not separately itemised.
- **Private independent feedback:** for each arm, review its OWN prior
  response and grade against the previous fixture without exposing the
  other arm. For Round 1, plain missed one error-handling defect and
  overstated one severity; Gate Keeper made a wrong subsidiary assertion
  about Python range semantics. Use the same feedback budget/form for
  each method, without writing the correct next answer into the lesson.
- **Agent's own learning turn:** make one *separate call to the SAME
  DeepSeek model* per arm after each of rounds 1–3, using
  `prepareSelfReflection()`. The model returns exactly one transferable
  review principle, no more than 40 words. Record its full response and
  gateway trace privately; an independent evaluator must check the
  lesson before the next review. This is prompt adaptation, not proof
  of self-directed agent improvement.
- **Next review:** only after both lesson turns are observed, use
  `prepareRound()` to produce the two pinned system/user prompts.
  The source file to review is identical per round; prompt hashes,
  parameters, model and output contract must be recorded for both arms.
  Only the review method and each arm's private cumulative lessons differ.
- **Cost:** verify full per-call gateway billed amount and token count.
  Do not multiply catalogue list prices and call them invoices. Underlying
  sponsor credit remaining and whether a charge hits sponsor balance must
  be separately verified; retain the existing hard budget controls.
- **Evidence:** keep complete replies, lesson turns and trace IDs in
  private owner storage. Sanitised `summary.json` may report only
  observed reviewed responses and legitimate discrepancies, with
  `INCONCLUSIVE` until independent validation. Do not report missing
  passes as zero detected defects. No private holdouts in GitHub.
- **Presentation:** for each model show all four rounds, with pending
  slots visibly pending (not zero scores). Show per-arm improvement
  conditional on task comparability, cost by arm, false-positive lines,
  incorrect *subclaims*, feedback/lesson evidence and qualification
  status. Never state native TrueForge was tested if it was Playground.

## Non-billable source validation

- `node scripts/proof/four-rounds.mjs --status` prints **2/8 observed**,
  **6/8 missing**, 1/4 per method and US$0.00027930 observed charges.
- `node scripts/proof/four-rounds.mjs --reflection-round-1` exports the
  two distinct non-billable model self-reflection requests. These prompts are
  not model replies and do NOT count toward any completed rounds.
- `node scripts/proof/four-rounds.mjs --prepare-round-2` deliberately
  refuses until the two own-model self-reflection turns are separately
  recorded and adjudicated. It does not send a request.
- The API is pure and cannot call gateway endpoints or use secrets.
  Unit tests use synthetic lessons/transcripts only to verify invariants;
  never treat those as actual completed passes.

**Operational blocker at this check:** the account's connected browser
automation wallet was negative (US$-0.456) and this chat lacked the
originating browser extension to operate the open TrueFoundry session.
No new actual DeepSeek calls occurred during this change. Use an
authorised browser/Work session or commissioned isolated TrueForge
connection, then resume under the exact route and capture new traces.

**Frozen benchmark protection:** The original fourth suggested task (`evals/tasks/04-ts-fetch.json`) is marked `holdout: true` and is *not* exposed in this public four-round series. The new fourth fixture is stored outside the sealed `evals/tasks` corpus to avoid changing historical scoring baselines.
