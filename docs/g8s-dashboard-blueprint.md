# G8S dashboard blueprint and delivery plan

Version 1 — 8 November 2026. Owner: Owen Tyas.
Applies to Base44 app `6ae577c8f34f21f5eebe75d9` and `appliedai-au/gate_keeper`.

## 1. Outcome and definition of done

Deliver the signed-in G8S user and administrator product, using the requested Gitar-style information architecture with original G8S branding, wording and icons. A collection of rendered screens is not completion. An authorized user must be able to sign in, select an organization, connect selected repositories, inspect actual reviews, change supported settings, and see the result of a real pull-request trigger. An administrator must manage actual accounts, limits and pause controls without ordinary users receiving those permissions.

The existing marketing pages and protected headlines remain unchanged. The existing Base44 application is the frontend; do not replace it with a new app. Hosted edits go through its builder chat. Owen performs the final publication. Do not copy Gitar's name, logo, wording, plan names, metrics or commercial claims.

There are four distinct acceptance levels: repository implementation, isolated qualification, hosted integration, and live acceptance/publication. Report them separately. This blueprint is a delivery specification, not a claim that every phase is already complete.

## 2. Evidence baseline and ownership

- Backend dependency: PR #73, branch `feat/g8s-product-backend-20261108`, frozen candidate `49a6b3f5de086f5e6024516e17684f1f4b0b79a7`, base main `473cde01b7e3c1a0cff7453bd8ddfc0e3bf0366e`. It was open and unmerged at this blueprint's baseline. Its qualification run is separate; do not edit/restart it from this lane.
- API contract: `docs/g8s-product-api.d.ts`, `docs/g8s-product-v1.md` and `scripts/product/service.mjs` at that candidate. Backend session and installation redirects use `/{slug}/dashboard` and `/{slug}/settings/configuration` respectively. Keep these routes working.
- Frontend evidence: the 8 November `G8S-Product-Preview-and-Owner-Setup.pdf` records 17 reviewed preview screens, including phone/loading/empty/error states. It expressly does not establish real sign-in, mutations, live data or publication. Existing hosted source has not been read back in this lane; preserve it and compare before installation.
- Release dependency: issue #74 tracks an authenticated serving-image transition that preserves the immutable completed learning history. Do not rewrite old evidence, replay the learning pilot or treat an image-pin change as that transition.
- This lane: `feat/g8s-dashboard-integration-20261108`, initially based on the frozen PR73 candidate. Only dashboard documentation, portable browser integration code, tests and a separate source-only qualification recipe are in scope. It must not merge into PR73 while that candidate is under qualification.
- Backend integration/release remains with the controller; private GitHub App setup and final Base44 publication retain the owner's existing boundaries. No new blanket approval is needed to write this integration source.

At the baseline, the Browser connector returned an originating-context error. No hosted source edit, screenshot acceptance or publication is claimed. The blueprint and portable implementation can progress without inventing access to the editor.

## 3. Architecture and trust boundaries

Browser/Base44 views -> browser-only product client -> HTTPS Gate `/gatekeeper/product-v1` -> server session/organization authorization -> PostgreSQL product records. Separately: signed GitHub webhook -> durable inbox -> review queue -> existing TrueForge model path -> immutable review/finding records -> GitHub publication receipt -> dashboard.

The browser owns display, navigation, draft edits and explicit user gestures. The Gate owns authentication, membership, global administration, repository permission, review eligibility, spend estimates, pause/limits, queue custody and publication. UI hiding never substitutes for server authorization.

Only the nonsecret `VITE_G8S_API_BASE_URL` is configured in the frontend. Session cookies are Secure/HttpOnly and handled by the browser. Never put GitHub credentials, provider keys, shared tokens, private evidence, raw transcripts or server administration allowlists into client code, builder chat, localStorage or logs. There is no localStorage authority or client-side first-user-admin rule.

API reads use `credentials: include`, `cache: no-store` and no automatic redirects. JSON mutations additionally use `Content-Type: application/json` and `X-G8S-Request: 1`; the browser supplies Origin. OAuth/install are explicit top-level navigation to fixed API routes, not fetch calls that follow GitHub redirects. Production is `g8s.app` with the commissioned `api.g8s.app` origin. Cross-site preview-cookie failures must not be solved by exposing a server secret.

Client aborts stop waiting; they do not prove a dispatched mutation was cancelled at the server. An ambiguous write must show an uncertain result and require readback, not automatic replay. No automatic POST/PUT/PATCH/DELETE retry. Errors never become zero metrics or empty successful reports.

Technical references: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch and https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort . These explain credentialed fetch and cancellation, not this app's release status.

## 4. Information architecture and interaction contract

The shell has the selected organization on the left, settings and account controls on the right, a real organization switcher, and an explicit connect/add-organization action. Account identity comes from `/session`; switching identity or organization clears all private view state and cancels outstanding reads before rendering the new scope. No global-admin view is requested until the server session says `isAdmin: true`; 403 still clears data.

Use `/{slug}/dashboard` for the Overview/Reviews tabs, `/{slug}/settings/{section}` for settings, and an org-scoped run-detail route compatible with the existing router. Preserve backend callback destinations. Proposed additional route names must be reconciled against the existing Base44 router before installation, not guessed or bulk-replaced.

| Screen / area | Required behavior | API and authoritative fields | Acceptance |
|---|---|---|---|
| GitHub sign-in | Explain repository permissions, sign in on explicit click, show callback/setup failures without loops | `/auth/github/start`, `/session`; no returned token | Real owner sign-in and revoked/anonymous denial |
| Shell / onboarding | Actual organization selector; connect GitHub with selected org; account menu/logout | session organizations; `/auth/github/install?org=...`; `/auth/logout` | Switch org during a delayed response; old data never appears |
| Overview | Repository/date/grouping filters; four activity metrics; activity chart, PR types, risk split, rule activity, recent PR table | `overview`: `stats`, `series`, `prTypes`, `riskSplit`, `unclassifiedRiskCount`, `ruleActivity`, `recentPrs`, `page` | Filter values match backend; current approval vs COMMENT remains distinct |
| Reviews | Reported/closed findings, closure rate, merged-PR findings, category/repository charts, 7/30-day unresolved report | `reviews`; `resolutionSource: user_confirmed` | Null percentages remain unavailable; unresolved links open the correct run |
| Run detail | Status timeline, duration, risk, model, estimated cost, summary; findings with file/line/evidence; rule evaluations | `runs/{uuid}` and finding status update | Exact permitted run; wrong-org UUID refused; held run is not successful |
| Configuration | Draft/author/bot/branch scope, review/severity controls, org guidance, summaries/risk instructions; save feedback and dirty-state handling | settings/configuration, `revision`, `capabilities` | Later edits survive earlier save completion; conflict and unknown outcome retain the draft |
| Repository controls | Actual connected repositories, search/page, enable/disable, overrides, refresh; explicit confirmation for disable-all | repositories list/refresh/disable-all and PATCH numeric GitHub ID | Numeric `id`, not internal `recordId`; refresh failures visible |
| Organization | Name/slug/logo and real members; preserve unsupported invitation limitations | settings/organization and member endpoints | Slug change navigates only after success; no 'invitation sent' claim |
| Integrations | GitHub installation state/repository access; all unsupported services marked unavailable | settings/integrations and capabilities | No decorative connected badges or dead actionable buttons |
| Rules | Real rules, descriptions, severities, enabled state and recorded evaluations | settings/rules | Empty state distinct from failure; no fabricated met percentage |
| Audit | Actual actor/action/time/details; pagination/filtering; scoped CSV export | settings/audit and audit/export | Export is downloaded as CSV, never inserted as HTML; formula neutralization remains server-owned |
| Billing / usage | Actual members/seats, run allowance and concurrency; observed estimates clearly separated from unknown spend | settings/billing, usage | Null spend is not zero; partial subtotal is not displayed as a complete total |
| Admin overview | Actual counts and authoritative pause state | admin/overview | Anonymous and ordinary user never receive admin data |
| Admin users / limits | Real users, monthly/concurrent allocations, disable control | admin/users and users/{uuid}/limits | Explicit save/readback; no implied plan/payment changes |
| Admin installations | Actual owners, installations, disabled reasons | admin/installations | Correct owner labels; no invented reconnect action |
| Admin repositories | Actual owner/repository/availability state | admin/repositories | Paginated real records; no cross-user ordinary route exposure |
| Admin runs | Runs, durations, failures and held states; no force-retry | admin/runs | Never relabel uncertain external writes as successful |
| Admin pause | Reason required; clear paused/unpaused state; explicit confirmation | admin/controls | Pause does not claim cancellation of requests already accepted externally |
| Admin audit | Recorded administrative actions | admin/audit | Actual identity and server timestamps; scoped and paginated |

The table describes functional areas; it does not change the prior 17-screen inventory into a new screen-count claim. Repository controls and analytics panels may remain subviews of existing screens.

## 5. Data, state and accessibility rules

- Loading, verified-empty, ready, authentication-required, forbidden, setup-required, recoverable read error, invalid draft, saving, save conflict and uncertain write are distinct states. Provide a single relevant action per error. Do not automatically route an error to sign-in indefinitely.
- Use stable server IDs. UUIDs identify runs/findings/members; numeric GitHub IDs identify repositories/installations. Slugs are validated path segments, not arbitrary URLs.
- Dates are UTC calendar dates as defined by the backend, inclusive. Reject impossible/reversed/overlong ranges before fetch; preserve the user's invalid draft with an inline error. Page changes and filter changes must not race one another.
- A new read supersedes the old one even if an aborted transport eventually returns. Scope reset clears data immediately. API failures clear stale privileged data; views may preserve a non-sensitive filter draft.
- Save one resource at a time. Capture the submitted draft/version; keep edits made while that request is running. Only the matching successful acknowledgement updates the saved baseline. Configuration revision conflicts require reload/compare, not silent overwrite.
- Never render source, model text, PR title, finding evidence or audit details as raw HTML. Display code as escaped text. External PR links must be validated GitHub HTTPS URLs, with safe new-tab behavior.
- Null monetary values render 'Unavailable'; estimates carry an 'Estimated' label; partially known subtotals carry 'Known subtotal — incomplete'. Zero is only valid when the server supplies a finite confirmed zero.
- Every control has a label and keyboard path, focus remains visible, async feedback is announced, destructive controls require confirmation, and narrow screens scroll tables locally rather than the entire page. Check at 360px and desktop widths. Existing 358px preview evidence is not a new live acceptance result.

## 6. Capability limits, not fake completion

PR-description auto-fill, invitation email/acceptance, non-GitHub integrations, billing checkout, inferred automatic finding closure, automatic repairs and automatic merging are not implemented by this product API. Show an explanation and disable the unsupported action; do not remove the structure that the user requested. Recording a pending invitation must never be labeled 'sent'. A clean COMMENT is not APPROVE. No unsafe manual-success or force-retry button for held jobs.

## 7. Phased implementation and exit criteria

| Phase | Work and owner | Exit evidence | Baseline state |
|---|---|---|---|
| D0 — Blueprint and contract freeze | This dashboard worker: map every screen/action to the existing API; record dependencies and test IDs | Reviewed blueprint, exact branch/API baseline, no competing hosted writer | This document; source review pending |
| D1 — Browser integration foundation | This worker: portable fixed-route client, error mapping, preview lock, scope-safe async resource and draft-save coordinator; synthetic tests | Exact-head isolated tests and Gitar/adversarial disposition; no real secrets | Implement now in separate integration lane |
| D2 — Wire existing Base44 views | Frontend worker through builder: inspect current source, reconcile adapter duplication, wire shell/session, Overview, Reviews, run detail and configuration first; then remaining settings/admin | Hosted source readback, build/typecheck, actual browser states and controls; no marketing diff | Blocked on usable builder/browser session; not complete |
| D3 — Qualify and commission serving backend | Existing backend controller: finish PR73 qualification, resolve #74, deploy exact approved source, apply schema, configure GitHub App and exact origins/admin/limits privately | Successful source/deployment/restart receipts; immutable history unchanged; product initially paused | Backend dependency, not satisfied by dashboard tests |
| D4 — Live end-to-end acceptance | Frontend worker + controller: real owner/non-owner/admin sessions; selected repository install; PR trigger; signed delivery; queued review; published review and displayed findings; settings round-trip; restart/readback | Pass/fail matrix with exact sources, timestamps, actual IDs kept private as appropriate; no duplicate inference | Not run |
| D5 — Owner publish and closeout | Owen publishes after D4; operator checks public route/health and archives evidence | Publication readback, smoke tests, rollback reference and explicit residuals | Not published |

D1 can progress while D3 runs. D2 cannot be claimed from repository-only tests. D4 requires D2 and D3. D5 requires real D4 evidence, not a screenshot or a healthy container alone. No Spekky gate. No local imports/tests/builds/installs of repository candidate code; execute qualification only on an isolated credentialless remote service. Preserve the historical qualification files and existing qualifier unchanged.

## 8. Acceptance matrix

| ID | Test | Required result |
|---|---|---|
| A01 | Preview mode with reads, mutation and OAuth clicks | No network request, redirect, account mutation or privilege |
| A02 | Missing/wrong API configuration, HTML response, invalid JSON | Setup/protocol error, never empty success |
| A03 | Missing/expired/revoked session and logout | Private state cleared; real sign-in required; no stale admin shell |
| A04 | Org A read finishes after switching to B | A result ignored, regardless of transport abort behavior |
| A05 | Filter A read finishes after newer filter B | Only B result shown; invalid dates issue no fetch |
| A06 | Edit draft while earlier save runs | Newer edit retained; successful save updates only submitted baseline |
| A07 | Save conflict / timeout / lost acknowledgement | Draft retained; no replay; uncertain write requires readback |
| A08 | Overview/review null costs, zero counts, empty data | Honest unavailable/zero/empty distinction; no invented metrics |
| A09 | Forged org/run/user route and ordinary-user admin request | Server denies; UI clears forbidden data |
| A10 | Real repository connect, refresh and disable round-trip | Selected GitHub repositories only; actual server state read back |
| A11 | Raw signed webhook / duplicate delivery / stale PR | Authentic delivery only; no duplicate publication; stale revision held |
| A12 | Review command and finding detail | Real persisted finding with exact permitted PR and evidence |
| A13 | Held/failed/truncated review | Visible non-success; no automatic force-retry |
| A14 | Administrative limits/pause and audit | Actual durable effect; ordinary user cannot invoke it |
| A15 | Reload/restart, phone width, keyboard and errors | Persisted state survives; responsive accessible real workflow |
| A16 | Marketing and historical learning regression | Protected content unchanged; no replay or historical rewrite |

Source-level tests cover only the IDs they actually execute. A synthetic server or fake fetch never proves live OAuth, GitHub access, publication, cookie acceptance or real provider output quality.

## 9. Base44 installation procedure

1. Open the existing app through builder chat; read the current product router, API client, session provider, dashboard pages and save handlers. Preserve screenshots/source preimages. Do not bulk-sync old sparse schemas or replace the app.
2. Compare the portable integration exports to any existing equivalent. Reuse or adapt the existing component design; avoid installing a second competing session store or API client. Keep preview controls separate from live components.
3. Install the reviewed adapter/state files as private app source, fix import paths, and set only the nonsecret commissioned API base. Use a separate client instance with explicit live mode; never infer live mode from URL parameters or a demo user object.
4. Wire session first; validate the active organization against server membership, handle server-derived admin status, and clear all resources on identity/logout/scope changes. Then bind read views, settings saves, and admin actions in that order.
5. Exercise read errors and save uncertainty before enabling any new mutation. Hosted testing may use a deliberately isolated authorized test environment, never seeded fake production analytics.
6. Read back exact hosted edits; run Base44 build/typecheck and real browser acceptance. Record actual tool output and screenshots without session-bearing URLs. Owen publishes only after D4.

## 10. Reporting and rollback

Keep one delivery record with four columns: implemented source, qualified source, hosted integration, live acceptance. Each completed phase names its exact source and evidence. Preserve failed runs; never combine different heads' partial passes into a final qualification.

Rollback means restoring the last accepted frontend publication and its compatible qualified backend composition, with writes paused where necessary. Do not restore or overwrite historical journals, claim a timed-out external write did not occur, or change a production source pin around issue #74. Unknown model charges remain unknown. The app is closed out only after D5 evidence exists.
