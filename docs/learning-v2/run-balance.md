# Gate Keeper: per-run usage ledger (owner directive, 5 Nov 2026)

The owner has withdrawn the programme-wide spending ceiling as a closeout
condition. Track **one run's actual charges**, without a programme budget
admission gate. The v2 policy and its signed journal schema remain immutable:
never reinterpret old US$50 receipts as run-balance v1 records.

`RunBalance` uses the existing durable journal CAS and a separately supplied
provider charge-receipt verifier. It stores one run ID, model and provider,
with a distinct identity for every call. Record the call *before* dispatch.
Unknown, timed-out, errored or not-yet-reconciled calls remain **unreconciled**
and cannot be silently counted as free. The visible balance is the sum of
**verified actual charges only**, with the count of unreconciled calls and a
`complete` flag. Never invent or infer charges from token estimates.

A verified receipt can settle exactly one matching call. Replay of the exact
same settled receipt is idempotent. Conflicting receipts, cross-run IDs and
another call reusing a receipt ID are refused. There is **no US$50 cap** or
aggregate spending comparison in this ledger. Even $125 of genuine per-run
charge is recorded accurately.

This is a necessary run-accounting component, **not yet a full migration of
the v2 controller**: its old policy, signed operation-lease gateway and host
capability contract still impose the historical US$50 programme limit.
Do NOT claim the pilot can run without that gate until its v3 operation
interface, status schema, trust/call lifecycle, and tests are revised and
independently qualified. Do not patch old signed evidence or bypass the
existing gateway. No live provider API calls or learning activation in this
change.

End-to-end acceptance remains issue #44.
