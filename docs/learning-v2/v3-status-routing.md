# Gate Keeper v3: single-service read-only status routing

This is an **opt-in source candidate** for issue #44. It leaves the
existing TrueForge process as the sole agent coordinator. After the already
qualified root-only mount bootstrap and privilege drop, a non-root Node
HTTP gateway starts one packaged TrueForge child on loopback 127.0.0.1:8790
and routes all ordinary HTTP traffic to it. The external listener uses
the existing Railway PORT (normally 8080). The exact learning-status path
is kept separate from TrueForge's agent endpoints.

The status endpoint remains **unavailable (503)** unless an explicit
`GK_V3_READONLY_STATUS=enabled` flag is present AND a private node-owned
0600 config file exists at the pinned journal path with owner/experiment/
source/public key pins and a read-only token. It does not fabricate an empty
learning experiment. Missing, invalid or corrupted state returns 503;
unauthorized identity does not gain a fallback to TrueForge. There are no
model, signing, writer, billing or activation methods in the status route.

This source does not install the Base44 owner function and does not
initialize a v3 experiment. Do not mark the ten-attempt pilot complete.
Actual production activation requires an isolated Railway boot/health/HTTP
positive-and-negative smoke, independent Gitar review and rollback evidence.
Switching production Dockerfile before those checks would be premature.
