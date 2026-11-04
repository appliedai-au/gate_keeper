# Gate Keeper v2: dedicated volume preparation, source slice

**Status: unqualified, unexecuted, no service change.** This is a bounded
implementation for issue #44, not evidence of a mounted or running v2 host.

The production TrueForge Dockerfile remains unchanged. The existing Railway
volume `gk-v2-private-journal` is still unmounted. Do not attach it to the
production service as part of this source publication.

`scripts/learning-v2/volume-bootstrap.mjs` exports
`prepareEmptyJournalMount()`. An operator-controlled, isolated startup process
can invoke it exactly once **only after** the reviewed build and matching
volume have been attached at `/var/lib/gk-v2-private-journal`. It requires:

- Linux mountinfo showing exactly one mount at that fixed leaf.
- Root-run preparation with the reviewed Node image identity 1000:1000.
- Root-owned, non-group/world-writable ancestors and mount root.
- An **empty** volume. Never modify or re-own existing journal files.
- A postcondition of UID/GID 1000:1000 and mode 0700 at the leaf.

This function is deliberately not an executable bootstrap command, service
entrypoint or recursive `chown`. Invoking it does not launch TrueForge or
create an experiment. The next integration revision needs an independently
reviewed least-privilege entrypoint that calls it once and permanently drops
privileges before the packaged TrueForge server begins. Qualification must
exercise the real Railway filesystem and verify signals, PID 1, startup, safe
volume placement, restart and rollback. Do not put root preparation in the
default production image without a complete independently reviewed release.

The status-reader route is still not mounted. No signing authority, confirmed
opening budget receipt, TrueFoundry inference credentials or Base44 owner
binding is provisioned. Under policy v2 the cumulative US$50 includes all
past spending and reservations. Keep paid inference and learning disabled.

Validation pending: focused negative contract tests, full project suite,
adversarial review, Gitar, isolated Railway qualification and service smoke.
A source merge, even with green tests, does not prove operational startup.
