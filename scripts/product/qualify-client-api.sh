#!/bin/sh
# Additive, credentialless client API qualification. Not the full release gate.
set -eu
set +x
umask 077
for name in DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE \
  TRUEFORGE_API_KEY TRUEFORGE_TOKEN TRUEFOUNDRY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY \
  G8S_GITHUB_CLIENT_SECRET G8S_GITHUB_APP_PRIVATE_KEY G8S_GITHUB_WEBHOOK_SECRET \
  GATEKEEPER_REVIEW_TOKEN GATEKEEPER_LEARNING_READ_TOKEN GK_AUTHORITY_DRIVER_TOKEN; do
  if printenv "$name" >/dev/null 2>&1; then
    echo 'Client API qualification refuses external database or credential bindings.' >&2
    exit 1
  fi
done
[ "$(id -u)" -eq 0 ] || exit 1
if timeout --signal=TERM --kill-after=10s 180s node --test tests/client-api*.test.mjs > /tmp/g8s-client-api-unit.log 2>&1; then
  cat /tmp/g8s-client-api-unit.log
else
  result=$?; cat /tmp/g8s-client-api-unit.log; exit "$result"
fi
pg_dir=$(mktemp -d /tmp/g8s-client-pg.XXXXXX)
started=false
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$started" = true ]; then
    if ! runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$pg_dir" -m immediate -w stop >/dev/null 2>&1; then
      echo 'Client API qualification PostgreSQL cleanup failed.' >&2
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
runuser -u postgres -- /usr/lib/postgresql/15/bin/initdb -D "$pg_dir" -U g8s_client_api_qualification \
  -A trust --no-locale > /tmp/g8s-client-api-pg-init.log
started=true
runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$pg_dir" -l "$pg_dir/server.log" \
  -o '-h 127.0.0.1 -p 55434 -k /tmp' -w start
runuser -u postgres -- /usr/lib/postgresql/15/bin/createdb -h 127.0.0.1 -p 55434 \
  -U g8s_client_api_qualification g8s_client_api_qualification
if G8S_CLIENT_API_POSTGRES_TEST=isolated-loopback timeout --signal=TERM --kill-after=10s 180s \
  node --test tests/client-api-postgres.integration.mjs > /tmp/g8s-client-api-postgres.log 2>&1; then
  cat /tmp/g8s-client-api-postgres.log
else
  result=$?; cat /tmp/g8s-client-api-postgres.log; exit "$result"
fi
printf '%s\n' 'G8S_CLIENT_API_TARGETED_PASS: actual HTTP handler, PostgreSQL and independent-pool races; not a full release or live-client acceptance.'
