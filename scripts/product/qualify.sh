#!/bin/sh
# G8S product release qualification only. Historical C recipe bytes are immutable.
# Deploy Dockerfile.product-qualify on an isolated credentialless remote service.
set -eu
set +x
for name in DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE \
  GK_REVIEWS_TEST_DATABASE_URL G8S_PRODUCT_POSTGRES_TEST \
  TRUEFORGE_API_KEY TRUEFORGE_TOKEN TRUEFOUNDRY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY \
  GATEKEEPER_REVIEW_TOKEN GATEKEEPER_LEARNING_READ_TOKEN GK_AUTHORITY_DRIVER_TOKEN \
  G8S_GITHUB_CLIENT_SECRET G8S_GITHUB_APP_PRIVATE_KEY G8S_GITHUB_WEBHOOK_SECRET; do
  if printenv "$name" >/dev/null 2>&1; then
    echo 'G8S product qualification refused: external database or credential binding is present.' >&2
    exit 1
  fi
done
. ./scripts/product/qualification-stage.sh

# Hash-preservation regression and actual historical proof checks run before
# expensive fixtures. They cannot be replaced by a later aggregate PASS.
run_product_gate product-source 20m node --test tests/product*.test.mjs
run_product_gate historical-proof 20m node --test tests/learning-v2-completed-proof.test.mjs
run_product_gate product-postgres 20m /bin/sh scripts/product/qualify-postgres.sh
# This is a separate shell, not a rewritten or sourced historical recipe.
# It retains ALL version/privacy/typecheck/scorer/full-source/real-PG checks.
# The accepted PR59 full-source run took 3,449,391.706 ms; keep finite headroom.
run_product_gate inherited-release 90m /bin/sh scripts/reviews/qualify.sh
printf 'G8S_QUAL_COMPLETE: product source, real Caddy, historical proof, product PostgreSQL and unchanged full inherited release gate passed.\n'
