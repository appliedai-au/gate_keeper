# Gate Keeper learning v3: run-balance policy (owner change 5 Nov 2026)

## Status
**Source candidate, not automatically activated.** The owner withdrew the
US$50 programme-wide spending ceiling and historical-spend reconciliation
as criteria for operating Gate Keeper. This v3 policy is a new experiment
version and must not reinterpret or alter immutable v1/v2 signed evidence.

The v3 controller records observed charges and outstanding run accounting
as usage, not an admissions budget. The programme ceiling is explicitly
`null`; neither spend nor reservations are compared with a dollar cap.
A new run starts with zero run charges and no historical account opening
is required. An optional signed zero opening receipt is accepted for
continuity; previous programme balances must NOT be imported as a run.
Authenticated operation receipts bind `global=false`, `ceilingMicros=null`,
`providerLimitEnforced=false`, and exact call identity/namespace. A lease
can have zero monetary reservation; its real purpose is single-use execution
authorization. Provider-reported, independently verified actual costs may
exceed an estimate and are recorded without suppressing a valid result.

A separate append-only `RunBalance` journal retains unknown charges as
unreconciled, accepts actual charges independently of an aggregate cap,
and refuses duplicate or misbound receipts. The view labels usage as
per-run, not a programme ceiling.

## Unchanged evidence gates
The user did **not** waive independent evaluation, novelty assessment,
nonce and call-count isolation, durable evidence, replay refusal, three fresh
paired confirmations, explicit activation, or exactly ten honest attempted
cycles on one fault family. An unknown charge is not proof of a zero cost.
An external provider may still impose its own account rules, which this
repository does not change.

## Operational migration
A new policy-v3 experiment must be initialized explicitly with exact
source, model, scoring rules and separately owned evaluation/novelty
authorities. Existing v2 state cannot be reopened by this controller
because the recorded policy digest differs; preserve it intact.
Do not represent passing source tests as evidence that real inference,
Base44 status routing, model scoring or ten-cycle learning was performed.

Review/qualification: adversarial → Gitar → fix/re-review → isolated Railway
full suite → merge/deploy → genuine runtime, independent outcome and
restart acceptance. No Spekky gate prerequisite.

Closeout: https://github.com/appliedai-au/gate_keeper/issues/44
