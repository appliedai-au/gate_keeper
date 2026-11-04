# v2 opt-in root-to-node volume startup

This remains an **uncommissioned isolated-host candidate**. Do not change
the existing TrueForge production Dockerfile, deploy settings or live volume.

The new `Dockerfile.v2-host` uses a shell entrypoint that verifies an explicit
`GK_V2_HOST_BOOTSTRAP=enabled` operator flag, then invokes the root-only
volume startup preflight. The preparer only changes permissions of an empty,
dedicated, root-owned mount to UID/GID 1000:1000 and mode 0700. Later boots
verify a previously prepared node-owned leaf without rewriting the journal.
Wrong identity, unsafe ancestors, missing/duplicate mount, root-owned nonempty
volume or any unexpected ownership fail closed before server startup.

After preflight the entrypoint uses `setpriv --reuid=1000 --regid=1000
--clear-groups` with `exec` to permanently drop privileges and launch
the unchanged packaged TrueForge server. It does not launch the learning
controller, install the status handler, start model calls or create signing keys.

This **does not prove the mounted volume is the intended Railway volume ID**:
the operator must verify the volume ID, environment and service binding using
Railway's control plane before deploying. Root startup always has access to
the untrusted host mount; this candidate requires independent adversarial
review, test qualification on the *exact image*, actual disposable volume
start/restart/recovery, PID1/termination, mount type and ownership validation.

Source-only candidate, no active configuration changes or paid inference.
No production mount until the status integration and independent budget
authorities are ready. US$50 includes all historic spend and reservations.
