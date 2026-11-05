#!/bin/sh
set -eu
[ "${GK_V2_HOST_BOOTSTRAP:-}" = "enabled" ] || { echo 'GK_V3_REFUSED: journal startup flag missing' >&2; exit 75; }
[ "${GK_V3_HTTP_ROUTER:-}" = "enabled" ] || { echo 'GK_V3_REFUSED: routing flag missing' >&2; exit 75; }
[ "$(id -u)" = "0" ] || { echo 'GK_V3_REFUSED: startup must be root before privilege drop' >&2; exit 75; }
node scripts/learning-v2/prepare-v2-volume.mjs
exec setpriv --reuid=1000 --regid=1000 --clear-groups node scripts/learning-v2/launch-status-gateway.mjs
