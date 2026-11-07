#!/bin/sh
# Opt-in dedicated v2 host only; NOT installed in the production Dockerfile.
set -eu
[ "${GK_V2_HOST_BOOTSTRAP:-}" = "enabled" ] || { echo 'GK_V2_STARTUP_REFUSED: explicit flag absent' >&2; exit 75; }
[ "$(id -u)" = "0" ] || { echo 'GK_V2_STARTUP_REFUSED: root preflight required' >&2; exit 75; }
node scripts/learning-v2/prepare-v2-volume.mjs
# setpriv clears supplemental groups and exec replaces this process so signals
# reach the packaged TrueForge server. No root fallback or shell supervisor.
exec setpriv --reuid=1000 --regid=1000 --clear-groups node node_modules/@truefoundry/trueforge/dist/main.js
