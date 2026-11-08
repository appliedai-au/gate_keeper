#!/bin/sh
# Run only in Dockerfile.reviews-qualify on an isolated remote source-gate service.
# Every stage is mandatory; preserve a nonzero result and complete log evidence.
set -eu
for name in TRUEFORGE_API_KEY TRUEFORGE_TOKEN TRUEFOUNDRY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GATEKEEPER_REVIEW_TOKEN GATEKEEPER_LEARNING_READ_TOKEN G8S_GITHUB_CLIENT_SECRET G8S_GITHUB_APP_PRIVATE_KEY G8S_GITHUB_WEBHOOK_SECRET GK_AUTHORITY_DRIVER_TOKEN; do
  if printenv "$name" >/dev/null 2>&1; then
    echo "Qualification refused: production/provider credential binding is present."
    exit 1
  fi
done
run_gate() {
  gate_name=$1
  shift
  gate_log="/tmp/gk-p6-$gate_name.log"
  # The accepted PR59 full source run took 3,449,392 ms (57.5 minutes).
  # Keep a finite deadline with headroom rather than aborting a known-good
  # inherited suite after twenty minutes. A timeout still fails qualification.
  case "$gate_name" in full-source) gate_deadline=90m ;; *) gate_deadline=20m ;; esac
  printf '\nG8S_QUAL_STAGE_START %s\n' "$gate_name"
  timeout --signal=TERM --kill-after=30s "$gate_deadline" "$@" >"$gate_log" 2>&1 &
  gate_pid=$!
  tail --pid="$gate_pid" -n +1 -f "$gate_log" &
  gate_tail=$!
  if wait "$gate_pid"; then gate_result=0; else gate_result=$?; fi
  # tail follows only the local synthetic log and exits after the command ends.
  wait "$gate_tail" || true
  printf 'G8S_QUAL_STAGE_END %s exit=%s\n' "$gate_name" "$gate_result"
  if [ "$gate_result" -ne 0 ]; then
    tail -n 160 "$gate_log"
    exit "$gate_result"
  fi
}
run_gate versions node scripts/reviews/qualification-versions.mjs
run_gate canary node --test tests/proof-log-redaction-canary.test.mjs
run_gate typecheck npm run typecheck
run_gate score npm run score -- --selftest
# Fast feedback is additional coverage, never a replacement for full-source.
# This includes the actual Caddy/session/CORS/raw-webhook transport test.
run_gate product-source node --test tests/product*.test.mjs

gk_pg_dir=$(mktemp -d /tmp/gk-review-pg.XXXXXX)
chown postgres:postgres "$gk_pg_dir"
cleanup() {
  runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$gk_pg_dir" -m immediate -w stop >/dev/null 2>&1 || true
  rm -rf "$gk_pg_dir"
}
trap cleanup EXIT INT TERM
runuser -u postgres -- /usr/lib/postgresql/15/bin/initdb -D "$gk_pg_dir" -A trust --no-locale > /tmp/gk-p6-pg-init.log
runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$gk_pg_dir" -l "$gk_pg_dir/server.log" \
  -o '-h 127.0.0.1 -p 55432 -k /tmp' -w start
runuser -u postgres -- /usr/lib/postgresql/15/bin/createdb -h 127.0.0.1 -p 55432 gk_reviews_qualification
export GK_REVIEWS_TEST_DATABASE_URL=postgresql://postgres@127.0.0.1:55432/gk_reviews_qualification
run_gate real-postgres node --test tests/reviews-postgres.integration.mjs
run_gate product-postgres /bin/sh scripts/product/qualify-postgres.sh
# Restore the inherited full suite's original database-free environment.
cleanup
trap - EXIT INT TERM
unset GK_REVIEWS_TEST_DATABASE_URL
run_gate full-source npm run test:learning-policy
echo 'P6 qualification passed: canary, typecheck, scorer selftest, full source suite, real PostgreSQL suite and G8S product PostgreSQL suite.'
