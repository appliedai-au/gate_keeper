#!/bin/sh
# Explicit actual-C startup. The root preflight never prepares an empty mount.
set -eu
test "$#" -eq 0
test "$(id -u)" -eq 0
node scripts/learning-v2/completed-history-control.mjs preflight
exec setpriv --reuid=1000 --regid=1000 --init-groups --no-new-privs \
  node scripts/learning-v2/completed-history-control.mjs
