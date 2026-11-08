#!/bin/sh
# Called only by the isolated Dockerfile.reviews-qualify release gate.
# No external database, GitHub, model, or production capability is accepted.
set -eu
set +x
umask 077
for name in DATABASE_URL PGHOST PGPORT PGDATABASE PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGPASSFILE \
  TRUEFORGE_API_KEY TRUEFORGE_TOKEN TRUEFOUNDRY_API_KEY OPENAI_API_KEY ANTHROPIC_API_KEY \
  G8S_GITHUB_CLIENT_SECRET G8S_GITHUB_APP_PRIVATE_KEY G8S_GITHUB_WEBHOOK_SECRET \
  GATEKEEPER_REVIEW_TOKEN GATEKEEPER_LEARNING_READ_TOKEN GK_AUTHORITY_DRIVER_TOKEN; do
  if printenv "$name" >/dev/null 2>&1; then
    echo 'G8S product qualification refused: external database or credential binding is present.' >&2
    exit 1
  fi
done
[ "$(id -u)" -eq 0 ] || {
  echo 'G8S product qualification requires the isolated build user.' >&2
  exit 1
}

g8s_pg_dir=$(mktemp -d /tmp/g8s-product-pg.XXXXXX)
g8s_pg_started=false
cleanup() {
  result=$?
  trap - EXIT INT TERM
  if [ "$g8s_pg_started" = true ]; then
    if ! runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$g8s_pg_dir" -m immediate -w stop >/dev/null 2>&1; then
      echo 'G8S product qualification cleanup failed.' >&2
      [ "$result" -ne 0 ] || result=1
    fi
  fi
  rm -rf "$g8s_pg_dir" || { [ "$result" -ne 0 ] || result=1; }
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
chown postgres:postgres "$g8s_pg_dir"
runuser -u postgres -- /usr/lib/postgresql/15/bin/initdb -D "$g8s_pg_dir" \
  -U g8s_product_qualification -A trust --no-locale > /tmp/gk-p6-product-pg-init.log
# Explicit loopback-only address, port, role and database match the guarded test.
# Mark cleanup ownership before start so an interrupted acknowledgement is safe.
g8s_pg_started=true
runuser -u postgres -- /usr/lib/postgresql/15/bin/pg_ctl -D "$g8s_pg_dir" -l "$g8s_pg_dir/server.log" \
  -o '-h 127.0.0.1 -p 55433 -k /tmp' -w start
runuser -u postgres -- /usr/lib/postgresql/15/bin/createdb -h 127.0.0.1 -p 55433 \
  -U g8s_product_qualification g8s_product_qualification
G8S_PRODUCT_POSTGRES_TEST=isolated-loopback node --test tests/product-postgres.integration.mjs
