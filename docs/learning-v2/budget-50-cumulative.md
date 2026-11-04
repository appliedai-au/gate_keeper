# Gate Keeper v2: US$50 cumulative budget activation contract

Owner instruction on 5 November 2026 supersedes the US$20 *total* programme
ceiling with US$50 *total*, **including every existing billable call, charged
token, and outstanding hold**. This is **not** an extra US$50 allowance.
The new fixed policy is version 2, ceiling `50_000_000` integer micro-USD.
The unchanged ten-attempt and three-pair rules still apply.

## Invariants

1. Import a real **independently signed** `gk-learning-v2-budget-state` receipt
   from the global TrueFoundry funding/gateway authority. It must bind the
   exact new experiment, source, configuration, gateway and programme budget
   identity; the global ceiling is `50_000_000`.
2. The opening `spentMicros` already includes all prior programme charges
   from earlier TrueForge/Gate Keeper experiments, *not only new v2 runs*.
   The opening `reservedMicros` already includes all unresolved or pending
   prior operations. A lost response, lease expiry, or unknown usage is not
   evidence of a zero cost.
3. `spentMicros + reservedMicros <= 50_000_000` at every admission and
   settlement; unsigned assertions, estimated costs, local counters and
   mutable environment variables cannot replace the independent gateway.
   The host must refuse if reconciliation or signing is unavailable.
4. The new programme ceiling does not amend old signed receipts or rewrite
   an old journal. Old policy-v1 journals and signatures **do not** silently
   migrate; a new version-2 experiment must be explicitly initialized with
   authenticated historical balances, and past evidence remains immutable.
5. Status displays the *observed signed cumulative totals*, not an inferred
   remaining spending allowance. Provider cost estimates are not authoritative.
6. The source test rig uses synthetic ed25519 keys only; its positive opening
   amounts do **not** certify real previous spend or authorize real inference.
7. The owner also withdrew the unavailable Spekky gate prerequisite.
   The review/qualification path is independent adversarial source review,
   Gitar, repair/review repetition, isolated Railway source-only qualification,
   merge and deployment. This does not waive independent budget custody.

## Operational hold

The main TrueForge service has source for the v2 controller but no verified
v2 host mount, durable owner journal, or independent evaluation/novelty/budget
receipt issuers. The live Base44 owner-bound Learning panel is also not yet
installed. **Paid model execution and automatic learning promotion remain
disabled** until the actual signing/gateway/volume and runtime are integrated
and individually qualified. First verify historic spend from real gateway
receipts, then import an opening signed global snapshot. Never start the pilot
using the synthetic default `2_000_000` fixture or an assumed zero balance.

Tracking: [Gate Keeper issue #44](https://github.com/appliedai-au/gate_keeper/issues/44).
