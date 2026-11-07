#!/bin/sh
set -eu
: "${PORT:?PORT is required}"
: "${UPSTREAM_HOST:?UPSTREAM_HOST is required}"
: "${UPSTREAM_PORT:?UPSTREAM_PORT is required}"
: "${BASIC_AUTH_USERNAME:?BASIC_AUTH_USERNAME is required}"
: "${BASIC_AUTH_PASSWORD:?BASIC_AUTH_PASSWORD is required}"
GK_PROXY_PASSWORD_HASH="$(caddy hash-password --plaintext "$BASIC_AUTH_PASSWORD")"
export GK_PROXY_PASSWORD_HASH
unset BASIC_AUTH_PASSWORD
cd "$(dirname "$0")/../.."
exec caddy run --config config/gatekeeper-status-proxy.Caddyfile --adapter caddyfile
