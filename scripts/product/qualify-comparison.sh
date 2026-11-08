#!/bin/sh
set -eu
set +x
umask 077
for name in DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE \
  TRUEFORGE_API_KEY TRUEFORGE_TOKEN TRUEFOUNDRY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY \
  G8S_GITHUB_CLIENT_SECRET G8S_GITHUB_APP_PRIVATE_KEY G8S_GITHUB_WEBHOOK_SECRET \
  GATEKEEPER_REVIEW_TOKEN GATEKEEPER_LEARNING_READ_TOKEN GK_AUTHORITY_DRIVER_TOKEN; do
  if printenv "$name" >/dev/null 2>&1; then
    echo 'Comparison qualification refuses external credentials or database bindings.' >&2
    exit 1
  fi
done
[ "$(id -u)" -eq 0 ] || exit 1
pg_dir=$(mktemp -d /tmp/g8s-comparison-pg.XXXXXX)
started=false
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$started" = true ]; then
    if ! runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$pg_dir" -m immediate -w stop >/dev/null 2>&1; then
      echo 'Comparison PostgreSQL cleanup failed.' >&2
      [ "$result" -ne 0 ] || result=1
    fi
  fi
  rm -rf "$pg_dir" || { [ "$result" -ne 0 ] || result=1; }
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
chown postgres:postgres "$pg_dir"
runuser -u postgres -- /usr/lib/postgresql/15/bin/initdb -D "$pg_dir" -U g8s_comparison_qualification \
  -A trust --no-locale >/tmp/g8s-comparison-pg-init.log
started=true
runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$pg_dir" -l "$pg_dir/server.log" \
  -o '-h 127.0.0.1 -p 55435 -k /tmp' -w start
runuser -u postgres -- /usr/lib/postgresql/15/bin/createdb -h 127.0.0.1 -p 55435 \
  -U g8s_comparison_qualification g8s_comparison_qualification
if G8S_COMPARISON_POSTGRES_TEST=isolated-loopback timeout --signal=TERM --kill-after=10s 180s \
  node --test tests/comparison-postgres.integration.mjs >/tmp/g8s-comparison-postgres.log 2>&1; then
  cat /tmp/g8s-comparison-postgres.log
else
  result=$?; cat /tmp/g8s-comparison-postgres.log; exit "$result"
fi
