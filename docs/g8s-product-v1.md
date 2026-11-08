# G8S signed-in product backend — implementation candidate

Owner: Owen Tyas. Source baseline: `473cde01b7e3c1a0cff7453bd8ddfc0e3bf0366e`.
Frontend: existing Base44 app `6ae577c8f34f21f5eebe75d9`, edited through its builder;
the owner publishes. The marketing pages and their two protected headlines are
outside this change.

This is a disabled-by-default source candidate. It has not been deployed, its
schema has not been applied to production, and no live GitHub OAuth, webhook,
review, or model invocation is claimed. The owner creates the GitHub App, enters
all secrets privately, chooses the global administrator, commissions the backend,
and publishes the frontend after qualification.

## What this adds

The existing Gate proxy and learning-v2 gateway receive a separate
`/gatekeeper/product-v1` route family. A new `g8s_product` PostgreSQL schema holds
product users, personal organizations, hashed sessions, installations, repository
configuration, rules, audit records, a webhook inbox, review jobs, findings,
actual rule evaluations, usage limits, and a global pause control. The source does
not alter learning experiments, sealed holdouts, competitor prompts or benchmark
evidence. No demo users, repositories, runs, savings or costs are seeded.

Models are invoked only through the existing loopback TrueForge SDK. The selected
model must be an owner-configured `truefoundry/…` registry reference. There is no
direct provider HTTP client, provider registration, model fallback, checkout,
shell, test execution, code repair, merge or deployment action in the product
reviewer. The operational review contract stays in server source. It does not
load the benchmark comparison prompts or claim that this new product adapter is
itself the v13.1 benchmark experiment.

The browser talks directly to the product API using a host-only, HttpOnly, Secure
session cookie. No API key, GitHub token, private key, shared service credential,
model prompt, or raw TrueForge transcript is returned to Base44. Every ordinary
read and write is scoped to the authenticated owner **and** organization on the
server. Global admin routes additionally require an immutable GitHub user ID in
the owner-controlled allowlist. There is no first-user-is-admin behavior.

## GitHub flow and permission explanation

Before redirecting, the signup screen should explain:

> G8S uses GitHub to identify your account. You choose the repositories during
> installation. G8S reads their contents and pull requests, receives pull-request
> and comment events, and posts reviews. This implementation does not push code,
> merge pull requests, or deploy your application. You can remove its repository
> access in GitHub at any time.

The concrete flow is:

1. `GET /auth/github/start` creates a short-lived, one-use state record, browser
   binding and PKCE S256 challenge, then redirects to GitHub.
2. The exact callback exchanges the code on Gate, verifies the GitHub user, and
   upserts by immutable GitHub ID. First signup creates a personal organization
   named after the actual GitHub account. An absent verified email remains absent.
3. The signed-in user chooses **Connect GitHub** or **Add another organization**.
   `GET /auth/github/install?org={slug}` checks ownership and starts the GitHub App
   repository-selection flow.
4. The setup callback treats `installation_id` only as a candidate. It starts a
   second, account-bound OAuth verification. Gate then checks the authenticated
   user's accessible installation repositories and the app's installation record.
   Only repositories with actual write/maintain/admin permission for that user
   are linked. Existing installation ownership cannot be taken over by another
   user.
5. Gate issues a new session and returns to the org-scoped dashboard or settings
   page. User access tokens are transient and are not stored.

This candidate uses a separate setup URL: leave **Request user authorization
(OAuth) during installation** off. Turning that option on changes GitHub's flow
and removes the separate setup URL; do not mix the two configurations.

The signed `github_app_authorization` revocation event invalidates the user's
sessions and disables their installation/repository execution rights at verified
ingress, even if the model worker is stopped. An OAuth flow started before that
revocation cannot recreate a session. Reconnection requires fresh authorization.
An exact delivery-ID retry is acknowledged without revoking a newer session;
a new revocation delivery is retained even when its signed body matches an older
revocation. Expired authorization states and sessions are pruned, and bounded
admission prevents unauthenticated sign-in requests from growing state forever.

## Run triggers and safety boundaries

Automatic reviews respond to `opened`, `reopened`, `synchronize`,
`ready_for_review`, and relevant `edited` PR events. An automatic review is
deduplicated per repository, PR, head commit, base commit and target branch. Closed events update actual merge
state without manufacturing resolutions.

The initial command surface is deliberately small:

| Comment | Result |
| --- | --- |
| `@g8s review` | Queue another review of the current PR head. A later new comment can request a repeat review. |
| `@g8s explain <finding-id>` | Post the saved evidence for that finding, scoped to the same owner, repository and PR. No new model call. |
| `@g8s help` | Post the command reference. No new model call. |

Commands must be a single standalone line with exact lowercase spelling. Quoted
commands, multiline instructions, extra arguments and arbitrary natural-language
actions are rejected. PR conversation comments and inline review comments are
supported. The commenter's current repository write permission is verified;
bots must also be explicitly allowed. The installation owner's current write
permission is rechecked before inference and publication. Both permission checks
must match the immutable GitHub user ID, so a renamed or reused login cannot
authorize a different person.

GitHub's exact current Gitar control commands were checked in its official
[Commands & Interactions documentation](https://docs.gitar.ai/commands). G8S does
not copy Gitar's unblock, autofix, automerge or presentation-control commands.
Gitar's natural-language review requests are distinct from its exact control
command table.

The webhook route verifies the raw request bytes using HMAC-SHA256 and a
constant-time comparison. It acknowledges only a committed inbox record. It
does not fetch a repository or start inference in the request path. Delivery IDs,
signed event content and immutable comment IDs supply durable replay boundaries.
The asynchronous consumer fetches the current PR rather than treating event text
as execution instructions.

Every external model or GitHub publication write has a committed intent first.
A lost acknowledgement or receipt-store failure holds the run; it is not
automatically replayed. Known model runs are polled with GETs only, in fair
last-observed order. Running jobs without a terminal observation after one hour
are held for operator review; later jobs continue to receive observation slots. The global
pause and user/repository status are checked under PostgreSQL locks before each
subsequent outbound intent. Pause prevents further work; it does not claim that a
request already accepted by GitHub or TrueForge was cancelled.

The reviewer accepts bounded complete text diffs. Unsupported binary/missing or
truncated patches, excessive diffs, invalid model JSON, unknown files, impossible
line ranges, unquoted evidence, unexpected tools or multiple model iterations
produce a failed/held run, never a fabricated clean result. The diff is fetched
using exact base/head SHAs through GitHub's comparison API and checked against
the PR's actual changed-file count. Base, head and target branch are rechecked
during preparation and before subsequent inference or publication.

The first model pass receives organization instructions and code only; repository
overrides and `.g8s/review.md` are structurally absent. If additional repository
guidance exists, a second independent pass receives it alongside the unchanged
organization instructions and the saved organization risk. Organization findings
and rule evaluations are retained, and the publication transaction enforces that
the second pass cannot remove findings, lower their severity, or lower the saved
risk. The file is read at the exact PR base commit. This optional second pass has
its own observed TrueForge cost; totals are available only when both costs exist.

## Frontend API contract

Prefix every path below with the configured non-secret API base ending in
`/gatekeeper/product-v1`. Requests use `credentials: 'include'`. Mutations require
`Content-Type: application/json`, `X-G8S-Request: 1`, and the exact configured
frontend Origin. The API returns `{data: …}` or
`{error:{code,message}}`, with `private, no-store` caching. A missing owner setup
returns 503 `setup_required`; an absent session returns 401 `unauthenticated`.
Neither failure is an empty successful query.

| Method and path | Purpose |
| --- | --- |
| `GET /session` | Actual user, owned organizations, server-derived `isAdmin`, command reference. |
| `POST /auth/logout` | Delete the current session. |
| `GET /orgs/{slug}/overview` | Activity, charts, risk/type counts, rule evaluations, recent PRs. |
| `GET /orgs/{slug}/reviews` | Findings, actual closure records, merged PR findings, unresolved report. |
| `GET /orgs/{slug}/runs/{uuid}` | Scoped run, findings with evidence, rule evaluations. |
| `PUT /orgs/{slug}/findings/{uuid}` | `{status:'open'|'closed'}` records explicit user-confirmed resolution. |
| `GET /orgs/{slug}/settings/{section}` | Configuration, organization, integrations, rules, audit or billing. |
| `PUT /orgs/{slug}/settings/{configuration|organization|rules}` | Save supported settings. |
| `GET /orgs/{slug}/settings/audit/export` | Scoped CSV, with spreadsheet-formula neutralization. |
| `GET /orgs/{slug}/repositories` | Search/filter/page repositories. |
| `POST /orgs/{slug}/repositories/refresh` | Reconcile real selected repositories and current owner access. |
| `POST /orgs/{slug}/repositories/disable-all` | Disable that owner's repositories in this organization. |
| `PATCH /orgs/{slug}/repositories/{github-id}` | `{enabled?,overrides?}`. |
| `POST /orgs/{slug}/members/invite` | Save a pending invitation request; no email is sent. |
| `PATCH` or `DELETE /orgs/{slug}/members/{uuid}` | Manage an existing non-owner membership. |
| `GET /admin/{overview|users|installations|repositories|runs|audit}` | Global-admin views only. |
| `PUT /admin/users/{uuid}/limits` | Monthly run allocation, concurrent-run limit and optional account disable. |
| `PUT /admin/controls` | `{paused:boolean,reason:string}` with durable admin audit. |

Analytics filters are `repository=all|{github-id}`, `from` and `to` in `YYYY-MM-DD`,
`groupBy=daily|weekly`, `merged=true|false`, and zero-based `page`. The unresolved
window uses `window=7|30`. The default date window is the last thirty UTC calendar
dates, inclusive. Repository table filters are `search`, `enabled=all|true|false`
and `page`.

### Response shapes used by Base44

The complete field names and nullability are declared in
[`g8s-product-api.d.ts`](g8s-product-api.d.ts). Those declarations contain types
only, with no sample activity. Repository/installation IDs in public routes are
numeric GitHub identifiers serialized as strings; run, rule and finding IDs are
internal UUIDs.

- Overview: `hasData`, `filters`, `stats` (each of `prsReviewed`, `findings`,
  `failedRuns`, `userRequests` has `value` and `perWeekday`), `series`, `prTypes`,
  `riskSplit`, `unclassifiedRiskCount`, `totalReviews`, `ruleActivity`, `recentPrs`,
  and `page`.
- Reviews: `hasData`, `filters`, `reported`, `closed`, `findingsOnMergedPrs`,
  `closureRate`, `resolutionSource:'user_confirmed'`, `resolutionByCategory`,
  `closureByRepository`, `series`, and `unresolved`.
- Run: `{run,findings,ruleEvaluations}`. A public run has status, duration,
  failure reason and nullable `estimatedCostUsd`/`costSource`; no submitted source
  input or TrueForge IDs.
- Configuration: `{configuration,revision,repositories,connections,capabilities}`.
  Save `{configuration,revision}`. Configuration keys are `skipDraftPRs`,
  `autoFillSummaries`, `blockMergeSeverity`, `autoApprove`, `autoApproveMaxRisk`,
  `allowedAuthors`, `excludedAuthors`, `allowedBots`, `allowedBranches`,
  `excludedBranches`, `customInstructions`, `summaryInstructions`, `riskInstructions`.
- Organization: `{organization,members,invitations}`; save `{name,slug?,logoUrl?}`.
  Logo upload accepts a bounded PNG/JPEG/WebP data URL, not SVG or remote URLs.
- Rules: `{rules:[{id,name,description,severity,enabled,…}]}`. Met percentages are
  computed only from real recorded rule evaluations.
- Billing: `{plan:{name:'G8S access',paid:false,featuresUnlocked:true,seats},seatAssignments,usage}`.
  Seat count comes from actual members. There are no payments, plan locks, ROI,
  dollar-savings or inferred billing totals.
- Admin overview: `{controls:{paused,reason,revision,updatedAt},counts:{users,installations,repositories,runs,queued,failed}}`.

Unknown costs/percentages are `null`. A confirmed empty database can return zero
counts, but an API error must remain an error. Model costs from TrueForge turn
metrics are labeled **estimates**, never reconciled spend. PR type is taken from
one actual `type:` GitHub label, otherwise it remains Unclassified. “Approved”
requires an actual `APPROVE` publication receipt for the current base/head/target revision; a clean
`COMMENT` review is not mislabeled as an approval.

## Owner must set

No secret values are included below. Do not paste any into chat or the Base44
builder. Enter them privately in the intended backend service configuration.

### GitHub App and public URLs

Use these proposed exact URLs after connecting `api.g8s.app` to the existing Gate
proxy. They are configuration targets, not a claim that the domain/routes are live.

| Setting | Value |
| --- | --- |
| Homepage | `https://g8s.app` |
| User authorization callback | `https://api.g8s.app/gatekeeper/product-v1/auth/github/callback` |
| Post-install setup URL | `https://api.g8s.app/gatekeeper/product-v1/auth/github/setup` |
| Webhook URL | `https://api.g8s.app/gatekeeper/product-v1/webhooks/github` |
| Frontend API base | `https://api.g8s.app/gatekeeper/product-v1` |

The existing proxy is recorded as
`https://proxy-production-9553.up.railway.app`; if the owner chooses it for a
commissioning preview, replace the API origin consistently in all three GitHub
URLs and backend/frontend configuration. Cross-site cookies may be blocked by
browser privacy settings on a Base44/Railway preview. The sibling `g8s.app` and
`api.g8s.app` production domains avoid that third-party-cookie dependency.

- Create the GitHub App and select the desired account installation availability.
- Configure exact callback matching, no wildcard. Leave OAuth-during-installation
  off for this two-step flow. Configure JSON webhook payloads and HTTPS validation.
- Request repository Metadata **read**, Contents **read**, Pull requests **read
  and write**, Issues **read**. Optional user Email addresses **read** supplies a
  verified email; account creation does not require an email. No contents-write,
  repository administration, actions, secrets, or checks permission is used.
- Subscribe to Pull request, Issue comment, Pull request review comment,
  Installation, and Installation repositories. Authorization revocation is also
  handled.
- If request-changes reviews must block merges, the repository owner must configure
  required review/branch rules. A posted review alone does not create a required
  GitHub rule.

### Backend configuration names

| Name | Owner action |
| --- | --- |
| `G8S_GITHUB_APP_ID` | Set the registered App's numeric identifier. |
| `G8S_GITHUB_APP_SLUG` | Set its actual GitHub App URL slug. |
| `G8S_GITHUB_CLIENT_ID` | Set its OAuth client identifier. |
| `G8S_GITHUB_CLIENT_SECRET` | Secret: owner creates and sets privately. |
| `G8S_GITHUB_APP_PRIVATE_KEY` | Secret: owner creates/downloads and sets privately. |
| `G8S_GITHUB_WEBHOOK_SECRET` | Secret: owner creates and sets identically in GitHub and Gate. |
| `G8S_PUBLIC_API_ORIGIN` | Set the chosen exact HTTPS API origin. |
| `G8S_FRONTEND_ORIGIN` | Set the exact published or commissioned preview origin; no wildcard. |
| `G8S_ADMIN_GITHUB_IDS` | Set the owner-confirmed immutable numeric GitHub IDs of global administrators; absent means none. |
| `G8S_DEFAULT_MONTHLY_RUN_LIMIT` | Choose the initial run allowance for new accounts; absent defaults to zero. Existing user limits are not overwritten. |
| `G8S_REVIEW_MODEL` | Select the approved existing `truefoundry/…` model reference. |
| `G8S_PRODUCT_SOURCE_COMMIT` | Set the exact qualified serving commit; it must equal `RAILWAY_GIT_COMMIT_SHA`. |
| `G8S_PRODUCT_ENABLED` | Set `enabled` only after schema, source and auth acceptance. |
| `G8S_PRODUCT_WORKER_ENABLED` | Set `enabled` only after run/publication acceptance. |
| Existing `TRUEFORGE_API_KEY` | Retain the existing server-only binding; never copy it into Base44. |
| Existing database binding | Reuse the intended PostgreSQL connection/TLS settings; never copy values into the frontend. |

The owner must select the actual GitHub admin account and verify its immutable
numeric ID. Do not assume a login from a repository name or grant administration
to the first signup.

Apply `scripts/product/schema.sql` explicitly on the intended database after
qualification. The runtime never runs DDL. The optional migration entrypoint is
`G8S_APPLY_PRODUCT_SCHEMA=apply-v1 node scripts/product/migrate.mjs`, executed by
the owner within the configured backend environment, with no credential values
on the command line. The schema creates a paused control record, no example
activity. Verify admin access, set usage policy and repository opt-ins, then
unpause deliberately. The frontend owner publishes through Base44.

## Verification and remaining work

Targeted Node tests exercise auth/isolation boundaries, CSRF/CORS, raw-byte
signatures, durable acknowledgement, OAuth state/PKCE, bounded commands, diff
evidence, risk monotonicity, approval semantics, escaped publication, uncertain
writes and public-prefix traversal. The store tests additionally exercise
configuration/identity boundaries and public projection filtering. Typecheck is
run separately. No test invokes a real model, GitHub write or production service.

The schema and query scenarios also execute in an isolated PGlite PostgreSQL/WASM
database. The current snapshot passes **47 targeted Node tests**, typecheck, and
**14 PGlite scenario groups**. That is single-connection SQL verification. The authored
`tests/product-postgres.integration.mjs` is the separate real-PostgreSQL,
multi-connection qualification entrypoint; it still needs to run in the isolated
release gate alongside the complete inherited source and real-Caddy suites.
Never substitute a product unit-test pass for that release gate.

A second independent read-only source review closed its reported identity,
revision-binding, revocation/replay, queue fairness, risk-baseline, admission and
foreign-key lock-order findings. That review accepts this disabled draft source;
it is not deployment or end-to-end qualification. The real PostgreSQL suite also
includes deterministic refresh/admission and refresh/reinstallation interleavings.

The deliberately incomplete pieces are:

1. **Live activation:** GitHub App creation, owner secrets, API domain/cookie
   commissioning, schema application, qualified backend deployment, admin/usage
   policy, repository opt-in, and Base44 publication remain owner setup.
2. **PR-description auto-fill:** preference is stored but capability is false.
   Review summaries are posted; existing human PR descriptions are not patched
   without a verified atomic conditional-write contract.
3. **Invitations:** requests are saved as pending with `delivery:'not_sent'`.
   There is no email delivery or invitation acceptance flow. Membership does not
   grant visibility into another user's repositories/runs in this strict-owner v1.
4. **Other integrations:** GitLab, Azure DevOps, Bitbucket, CI integrations,
   ticketing, Slack and custom MCP connections are not wired.
5. **Model billing receipts:** only recorded TrueForge metric estimates are
   available. No billing, ROI or savings plumbing exists.
6. **Uncertain-write reconciliation:** held jobs require private operator review.
   There is no unsafe force-retry, release-hold or manual-success button.
7. **Resolution source:** closures are explicit G8S user confirmations. GitHub
   thread-resolution synchronization and automatic fix inference are not claimed.

## Primary reference provenance

- [GitHub App OAuth and PKCE](https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/generating-a-user-access-token-for-a-github-app)
- [GitHub setup URL and installation-ID verification](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url)
- [Webhook validation](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries)
- [Webhook event permissions and revocation](https://docs.github.com/en/webhooks/webhook-events-and-payloads)
- [GitHub pull-request reviews](https://docs.github.com/en/rest/pulls/reviews#create-a-review-for-a-pull-request)
- [Immutable GitHub commit comparisons](https://docs.github.com/en/rest/commits/commits#compare-two-commits)
- [Repository access for a GitHub App user](https://docs.github.com/en/rest/apps/installations#list-repositories-accessible-to-the-user-access-token)
- [Gitar's exact documented command set](https://docs.gitar.ai/commands)

These references describe the external interfaces. They do not establish a live
acceptance result for this implementation candidate.
