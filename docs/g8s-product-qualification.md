# G8S product release qualification

Use `Dockerfile.product-qualify` for the complete G8S product candidate in the
existing isolated Railway qualification environment. It accepts no provider,
GitHub, production-database or historical-volume capability. Do not use a
production service, shared secret, live model or mounted experiment journal.

## Required sequence

The product recipe runs, in order:

1. All `tests/product*.test.mjs`, including real Caddy transport, exact historical
   recipe hashes, process exit-status/timeout regressions and credential refusal.
2. The existing `tests/learning-v2-completed-proof.test.mjs` unchanged. This is an
   early compatibility check, not a substitute for the full historical suite.
3. The G8S real PostgreSQL integration using a new empty loopback-only cluster,
   its exact test role/database, independent pools and cleanup.
4. The complete, unchanged `scripts/reviews/qualify.sh` in a separate shell. This
   runs version validation, privacy canary, typecheck, scorer self-tests, all
   `tests/*.test.mjs`, and the inherited real PostgreSQL integration.

Every command must succeed. There is no fast-only or skip mode. Product stages
have a twenty-minute failure deadline; the inherited release has a ninety-minute
failure deadline, based on the previously observed 57.5-minute accepted run.
Timeouts and log-reader failures fail qualification. The one-second stage budget
exists solely for the synthetic shell timeout regression and is not used by the
release recipe. All command output is retained in the isolated test image.

## Immutable historical recipe

Do not modify `Dockerfile.reviews-qualify`, `scripts/reviews/qualify.sh`, their
SHA256 pins in `completed-history-proof.mjs`, or the historical test fixtures to
accommodate product tests. Historical source verification checks those exact
recipe bytes. Product additions belong in the separately named product recipe.
The product image contains both historical files unchanged and executes the
historical runner rather than copying or editing its commands.

The rejected candidate `24d19fa82db1a82d6fd83e20b2846e2bb2d9608d` changed the
historical runner. Deployment `b6711d4a-fe9b-4a08-b98b-648509a12eed` consequently
failed its full suite: 1,246 tests, 1,191 pass and 55 fail, with no skips,
cancellations or TODOs. The recorded error was `actual C qualification recipe
changed or omitted a required gate`. This failure is retained in PR #73; earlier
product/database passes do not qualify that candidate. Restoring the historical
runner does not itself constitute a passing rerun.

## Evidence and release boundary

Record the exact PR head, base, tree, Dockerfile and deployment identity. Retain
the terminal summaries and hashes of these files after actual success:

- `/tmp/gk-g8s-product-source.log`
- `/tmp/gk-g8s-historical-proof.log`
- `/tmp/gk-g8s-product-postgres.log`
- `/tmp/gk-g8s-inherited-release.log`
- `/tmp/gk-p6-versions.log`, `/tmp/gk-p6-canary.log`,
  `/tmp/gk-p6-typecheck.log`, `/tmp/gk-p6-score.log`,
  `/tmp/gk-p6-full-source.log`, `/tmp/gk-p6-real-postgres.log`

The product-stage logs are synthetic test evidence, not real provider or user
results. Do not label the new product Dockerfile as the historical C Dockerfile
in a qualification receipt. Preserve any historical receipts and use the current
controller's explicit product-release contract for integration. Remove only this
operation's disposable service after evidence retention and observe its absence.

Source review, including exact-head Gitar review, remains separate from actual
execution. Merge/deployment and live product commissioning remain the acting
controller's responsibilities. GitHub App/private-secret setup, admin/usage
policy, schema application, API origin, product/worker enablement and signed-in
end-to-end acceptance are not established by synthetic tests. Base44 publication
remains the owner's action. The old completed learning pilot is not rerun.
