# Gate Keeper: per-run usage ledger (owner directive, 5 Nov 2026)

The owner has withdrawn the programme-wide spending ceiling as a closeout
condition. Track **one run's actual charges**, without a programme budget
admission gate. The v2 policy and its signed journal schema remain immutable:
never reinterpret old US$50 receipts as run-balance v1 records.

`RunBalance` uses the existing durable journal CAS and a separately supplied
provider charge-receipt verifier. It stores one run ID, model and provider,
with a distinct identity for every call. It appends bounded, immutable
`opened`, `call` and `settled` delta events, not repeated full-state
snapshots. Journal storage grows linearly with calls. Record the call *before* dispatch.
Unknown, timed-out, errored or not-yet-reconciled calls remain **unreconciled**
and cannot be silently counted as free. The visible balance is the sum of
**verified actual charges only**, with the count of unreconciled calls and a
`complete` flag. Never invent or infer charges from token estimates.

A verified receipt can settle exactly one matching call. Replay of the exact
same settled receipt is idempotent. Conflicting receipts, cross-run IDs and
another call reusing a receipt ID are refused. There is **no US$50 cap** or
aggregate spending comparison in this ledger. Even $125 of genuine per-run
charge is recorded accurately.

The v3 controller policy removes the historical US$50 programme admission gate
and reports run-level charges without treating reservations as a monetary
ceiling. This ledger can be connected to independently verified provider
settlement receipts; it does not itself make inference calls or activate
learning. Previous policy-v2 signed evidence remains unchanged.


End-to-end acceptance remains issue #44.
