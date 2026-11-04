# Durable read-only status bridge for Gate Keeper v2

The v2 learning engine remains in the existing Gate Keeper repository and TrueForge
application. This increment supplies an actual **read-only FileJournal adapter**
for the already-authenticated status endpoint. It opens an **existing** POSIX
journal (create=false), verifies the fixed public signing-key fingerprints, owner
experiment/source binding, controller policy v2, dispatch-anchor consistency,
baseline denial evidence and required operation archives before producing the
bounded public status projection.

- It cannot create an experiment, issue a lease, settle billing, dispatch a
  model, sign a novelty/evaluation result, activate a procedure or edit rules.
- Missing, corrupted, stale, or mismatched journal data fails closed; it never
  returns fake empty progress or silently creates a new budget programme.
- The mounted HTTP endpoint must still use the existing
  createLearningStatusTokenAuthenticator and createLearningStatusEndpoint.
  Only the Base44 authenticated backend may present the configured owner
  assertion and status read token. Do not expose the journal directory or
  those credentials to the browser.
- This adapter accepts **public authority keys** and their exact pinned
  fingerprints, not private signing material.
- The existing private volume is currently provisioned but not mounted.
  It must remain unmounted until a qualified runtime owner safely prepares
  POSIX ownership for the non-root Node process. Attaching a root-owned empty
  volume directly to the running TrueForge instance is not an acceptable
  substitute for completing the host wiring.
- Source acceptance of this module does not supply a real gateway,
  authenticated historical spend or the Base44 owner editor session.
  US$50 is **total**, including all earlier charges and holds.
- Never bootstrap a synthetic experiment or a synthetic signed budget receipt
  on production to make the Learning page display a success.

The v2 activation task is tracked by Gate Keeper issue #44; this source bridge
does not represent operational qualification or measured learning.

The reader additionally requires a separately configured **64-character frozen
configuration digest**; experiment/source alone are insufficient to bind the
model, scorer, benchmark and initial policy. It recomputes that digest from the
stored configuration, trust pins, policy and historical bank on every read.

The FileJournal is now opened in explicit readOnly mode with create=false. It never obtains the writer lock or creates an evidence directory; append is categorically refused. A held writer lock or unstable directory listing returns unavailable rather than racing the real writer. It does not automatically retry or delete a held lock.
