# Agent instructions

## Execute before publish (owner instruction, 15 November 2026)

The full gate confirms work; it must never be the first time code runs. Source that
has not been executed may not be published for a PR gate or marked ready for review.
This applies at the publish/ready boundary, not during exploration: iterate, prototype and
try bold changes freely, then execute in full before you publish.

- Before publishing any source change, execute every package/module it touches in
  full (the whole package, the whole test file set, every changed test file), not
  only the tests you expect to be affected. Include architecture, census, manifest
  and lint guards that live in those packages. Named-test runs are not enough.
- Run it in a permitted execution location: a Spekky-managed remote runner lane, or
  the reviewer's isolated cloud sandbox. Never run builds, tests or gates on the
  developer workstation (owner instruction, 22 October 2026). If no permitted
  location can execute it, hold the change as validation-pending with the concrete
  blocker. Do not publish it unexecuted.
- Report what ran: exact commit/tree, the packages and test files executed, pass
  counts, and every failure classified as caused-by-change, pre-existing (fails
  identically on the base) or environment-only (with the reason). Fix pre-existing
  failures that surface; do not wave them through as "already failing".
- When you change one side of a contract, find and update the other side in the
  same change: schema/nullability and every reader that scans it; an ordering or
  admission rule and every list, fixture and caller that encodes it; a file or
  directory layout and every fixture, path list and probe; a test count, roster or
  manifest and every pin that asserts it. Search for the old value before publishing.
- If this repository's gate restores protected paths from the base before judging,
  an ordinary PR cannot change or validate those paths. Route such changes through
  the protected release process; never add an exception or bypass to make a PR pass.
- One gate run per verified head. If a gate fails, reproduce the failure where you
  are allowed to execute, fix every related failure you can find, re-execute in full,
  then dispatch once more. Do not use repeated gate runs to discover defects one at a time.
