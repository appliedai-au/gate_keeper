# Phase 4 source increment: read-only learning status

## Delivery and limits

This increment prepares the first app read path for the existing Gate Keeper
application. It adds a strict public projection, an authenticated read-capability
HTTP handler, two alternative Base44 entrypoints, and a Learning section in the
existing prepared React page. It builds on parent
`74c5eec6d2c0bae79c3345b91f55cd84fcb42e3c` without changing the learning controller,
runner, dispatch ledger, journals, TrueForge launch command or model settings.

It is **unqualified source**, not an installed Base44 feature or mounted route.
The current Dockerfile starts packaged TrueForge and has no Gate Keeper HTTP
router. The existing runner integration owner must mount this handler within
the accepted integration after the full source gate. It starts no additional
service. TrueForge remains the single coordinator.

Phase 2 runner integration and qualification remain incomplete, and Phase 3
BASE controls/pilot have not started. Preparing this read path in parallel does
not satisfy those exits. The new [source manifest](app-status-source-manifest.json)
binds this increment to its parent; the four earlier manifests remain unchanged
historical snapshots.

## Public contract and capability boundary

`shared/learning-status-contract.js` is a dependency-free Web API/JavaScript
module shared by the host endpoint, Base44 backend and React component. It
validates the exact public shape of `host.status()`, including the durable
dispatch projection. Unknown fields, accessors, hidden/symbol properties,
changed policy constants, malformed identities, invalid counts or contradictory
baseline failure codes are rejected. Returned objects are newly allocated;
the boundary does not spread arbitrary private state into a response.

The response is:

```typescript
{
  schema: 'gk-learning-v2-status-response',
  checkedAt: string, // canonical UTC ISO timestamp of this status read
  status: PublicLearningHostStatus
}
```

| Public field | Meaning and limit |
| --- | --- |
| Experiment, source and scope | Configured experiment identity and exact 40-character source commit; no browser selection |
| Original and incumbent versions | Immutable prompt-version identities; no procedure text or private history |
| Baseline | Not planned, planned, complete or failed, with only the fixed non-admitted/unresolved failure code |
| Attempt counts | Attempted and scored remain separate; invalid, duplicate, unresolved and no-coverage attempts remain visible |
| Confirmed versions | Counts confirmed learned versions, excluding the original frozen baseline |
| Activated count | Number of recorded activate events; reactivation after rollback can exceed the attempt count |
| Pending operation and dispatch stage | Recorded admission/settlement/non-admission observations; no assertion of a live worker or automatic recovery |
| Budget | Observed cumulative spend and reservations under the fixed US$50 total programme cap, inclusive of all historical charges and open holds; the external gateway remains authoritative |
| Qualification | Recorded managed source gate status; it is not an accuracy result, authorization to spend, activation or deployment |
| `checkedAt` | When the host produced this read; it is not a last-progress timestamp |

Detailed activation history, private evidence links, receipts, prompts, fit/check
content, bank rows, scorer truth, provider replies and error messages have no
public field. The owner ID and transport credentials are not returned either.
Broader reviewer access and tenant membership remain separate integration work.

`createLearningStatusEndpoint({ readStatus, authenticate, binding, clock })`
accepts only a captured read capability. It does not accept the whole host,
repository paths, controller mutations, model client, gateway or secret store.
The fixed binding is `{ ownerId, experimentId, sourceCommit }`; the endpoint
checks both the authenticated grant and returned status against it.

The companion `createLearningStatusTokenAuthenticator({ readToken, binding })`
checks an opaque machine token using a constant-time comparison of token hashes.
It returns a server-created `learning:status:read` grant for that fixed binding.
No request header or body can choose the owner, experiment or source. A distinct
read token is required in addition to the existing proxy Basic credential.
It must be provisioned by the runtime owner, with custody and rotation recorded
outside public source. No token has been created, fetched or installed here.

The owned integration can compose the read seam after authenticating and opening
its already-qualified host:

```js
const authenticate = createLearningStatusTokenAuthenticator({
  readToken: serverSecrets.learningReadToken,
  binding: configuredOwnerExperimentSource,
});
const handleLearningStatus = createLearningStatusEndpoint({
  readStatus: () => host.status(),
  authenticate,
  binding: configuredOwnerExperimentSource,
});
// Register this handler only for the fixed path in the existing owned router.
// No listener, host initialization, dispatch loop or deployment is supplied here.
```

The endpoint accepts only `GET /gatekeeper/learning-v2/status`, without query
parameters or a body. Authentication precedes the status read. Invalid grants
or identity substitutions cannot access state. A missing/corrupt store or
invalid projection yields a fixed 503 error without diagnostic content.
Every response is private/no-store, including authentication and error responses.

## Base44 ownership and transport

`createLearningStatusBackend` receives the selected Base44 runtime's auth and
secret capabilities, with fetch and clock injectable for managed regression
cases. Both entrypoints use the repository's established `auth.me()` approach.
They remain prepared alternatives; the actual installed app's convention and
module bundling have not been verified. Select one after inspecting the existing
app, and include the shared module dependencies in its function bundle.

The backend requires POST, a signed-in administrator with a valid server-derived
user ID, and an exact match with `GATEKEEPER_LEARNING_OWNER_ID`. It captures that
identity before asynchronous configuration reads. A different app administrator
receives 403 before any experiment secret or upstream credential is read. Role
alone does not grant access to the configured private experiment.

An authorized browser may submit only an empty JSON object, with no query
parameters. Its body is limited to 1 KiB. Source and experiment pins come only
from server secrets. The configured read token is scoped by the upstream
authenticator to the same fixed owner/experiment/source.

The bridge always fetches this one URL:

`https://proxy-production-9553.up.railway.app/gatekeeper/learning-v2/status`

It sends the proxy Basic authorization and `X-Gatekeeper-Learning-Token` only
upstream. A separate `X-Gatekeeper-Learning-Owner` assertion is taken from the
backend's captured, authorized owner binding, never a browser header. The host
requires it to match its fixed owner after token/grant authentication and before
reading status. This detects a wrong-owner token or mixed configuration during
rotation, even if two owners use the same experiment/source identifiers. The
assertion cannot select another host or experiment. Redirects are refused.
A seven-second timeout covers headers and body
streaming. Actual response bytes are limited to 16 KiB independently of
Content-Length, and the response must be 200 with JSON content. The projection
is checked again against the server pins. A response more than 60 seconds old
or more than five seconds ahead of the backend clock is unavailable. Those
bounds protect transport freshness; they do not infer experiment progress.

No raw upstream body, exception, credential or owner configuration is forwarded
on failure. Missing configuration, an absent route, transport failure, incorrect
source, private extra fields and stale responses all yield the same sanitized
unavailable response. There is no fallback to `/healthz`, fixture data, another
experiment or a learning mutation.

Required secret **names**, without values, are documented in the
[Base44 staging README](../../integrations/base44/README.md). Existing broad proxy
credentials remain unsuitable as general multi-tenant authorization. This
increment supplies only the explicit single-owner read boundary, not a claim
that the broader runtime or production tenant model is secured.

## App behavior

The new Learning navigation item uses the existing page and design tokens. Its
only action is Refresh status. It performs a read on mount and explicit refresh;
it does not poll, initialize an experiment, propose a rule, admit an evaluation,
recover an operation or activate a version.

The component validates the full response before placing it in display state.
Refresh clears the previous snapshot, and generation/unmount guards prevent a
late response from replacing a newer view. A 20-second UI deadline invalidates
a stalled request and re-enables manual refresh; it does not claim to abort the
underlying Base44 transport. Timers are cleared on completion, replacement and
unmount. Auth failures and unavailability use fixed messages.
No old snapshot or illustrative record is presented as current
learning progress. The last-checked label is formatted for Australia/Melbourne.

Other app walkthroughs remain clearly identified as demonstrations. The Learning
page identifies recorded state separately. The existing `LearningLab.jsx`
fixtures and runtime-reachability probe cannot populate this view. CSS and JSX
were reviewed as source; no browser render, installation or UI compatibility
result is claimed.

## Prepared verification and required integration

The new regression source exercises strict public projection and isolation,
policy/identity/count boundaries, fixed owner and source binding, scoped token
grants, auth-before-I/O, fixed upstream routing, sanitized failures, bounded and
fresh JSON responses, and read-only endpoint composition. These tests are
prepared for the existing full Node discovery path. Written declarations are
not discovered, executed or passed cases.

Only source reads/writes, independent source review and byte/hash sealing are
permitted in this workstream. No candidate parser/import, unit test, typecheck,
build, install, formatter, hook, browser execution or model inference was run.
The complete Spekky-managed dedicated remote gate remains the sole execution
and qualification path, including all inherited checks. The owner must include
actual Base44 bundling/type/UI verification in the reviewed integrated recipe;
the repository Node wildcard alone does not render JSX or prove hosted-editor
compatibility.

At **23:31 AEDT on 4 November 2026** (12:31 UTC), the served Spekky deployment
was still `5d15c5d1-5572-4162-881a-53f309625ed1`, running source
`2882f1c67d77a17a42840c2eb738fa8e9c07891e`. Neither that served target/profile
table nor main `179e6095a9f2bbffb17d5dffa98fec30388d016a` registered Gate Keeper.
The exact-source admission guard still requires an open, non-draft PR, including
explicit prepared operator dispatch. This PR remains draft until integration
and registration are ready for that gate.

[Gitar approved the preceding baseline-recovery head with both findings closed](https://github.com/appliedai-au/gate_keeper/pull/43#issuecomment-6630543280).
That approval applies to parent `74c5eec6d2c0bae79c3345b91f55cd84fcb42e3c`, not
this later app increment. External review and full runtime qualification of the
new source remain separate requirements.

The next operational steps remain with the existing runner, gate and app owners:
reconcile the runner and real signed authorities/gateway/durable volume, register
and release the full Gate Keeper target/profile, qualify the exact integrated
source, and mount this read capability with its owner binding. Install only the
verified existing-app source and selected function convention after the required
authorization. Do not bulk deploy this sparse directory, push its entities or
force-replace unrelated hosted functions. BASE controls, the fixed ten-attempt
pilot and separately authorized activation follow their existing phase exits.

Sources: [served target table](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/server-go/internal/services/executor_check.go),
[served output profile](https://github.com/appliedai-au/Spekky-V1/blob/2882f1c67d77a17a42840c2eb738fa8e9c07891e/scripts/executor/run-task.sh),
[current main target table](https://github.com/appliedai-au/Spekky-V1/blob/179e6095a9f2bbffb17d5dffa98fec30388d016a/server-go/internal/services/executor_check.go),
and [existing Gate Keeper operational handoff](https://github.com/appliedai-au/Spekky-V1/pull/809#issuecomment-6621027317).
