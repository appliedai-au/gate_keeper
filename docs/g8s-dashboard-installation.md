# G8S functional dashboard — implementation and installation

8 November 2026. Read with `docs/g8s-dashboard-blueprint.md`. This is an implementation handoff for the existing Base44 app `6ae577c8f34f21f5eebe75d9`, not a replacement app, new marketing site, or publication receipt.

## Delivered source

`integrations/base44/product/product-client.mjs` is a portable browser-only fixed-route API client. It implements session, logout, explicit GitHub sign-in/install navigation, Overview/Reviews, run detail, finding closure, the six settings sections, repository list/refresh/overrides/disable, member update/removal, organization audit export and administrative lists/limits/pause. It has no provider credentials, localStorage authority, auto-retry or automatic navigation. The default preview mode performs no network activity, writes or redirects.

`product-state.mjs` implements newest-request-only report state, scope invalidation, authenticated organization selection, server-derived administrator checks, local data clearing on revocation/logout, and settings draft coordination. Saves capture the submitted draft/revision. A later edit survives an earlier save acknowledgement. Lost acknowledgement or a revision conflict requires readback before another submission; readback preserves the draft for comparison. Clearing the scope invalidates pending results even when the transport ignores cancellation.

`react-bindings.mjs` connects these stores to the existing React instance through `useSyncExternalStore`, with a Provider, `useDashboard`, `useReport` and `useConfigurationEditor`. It does not replace the existing components, router, styling or preview. Its screen map covers every supported read view; sign-in and pause are actions rather than invented report endpoints. The React bindings require actual hosted rendering/typecheck and interaction acceptance; Node tests alone do not establish this.

The separate `Dockerfile.dashboard-qualify` runs only the new dashboard tests and syntax checks in a credentialless remote service. It imports the actual product HTTP handler/public contracts for synthetic contract checks. It is NOT the backend release recipe, the historical recipe or proof of browser cookies/OAuth/GitHub acceptance. It changes neither PR73 nor its frozen qualification.

## Contract correction to blueprint v1

Actual source `scripts/product/service.mjs` defines the CSV route as `GET /orgs/{slug}/settings/audit/export`. The endpoint exports the whole permitted organization audit and does not implement date filtering. The client rejects an export `filters` argument rather than pretending a filtered export exists. The button must say **Export organization audit**. Date filters may still control report views; do not claim they filter this export. An oversized export displays the actual unsupported-size result, not a non-working shorter-range suggestion. This supersedes the abbreviated `audit/export` path and date-range export wording in blueprint v1.

## Phase plan and exit evidence

| Phase | Deliverable | Exit criterion | Current evidence category |
|---|---|---|---|
| D0: blueprint | Screen/action/API matrix, trust boundaries and acceptance IDs A01–A16 | Saved source and reviewed exact blueprint | Blueprint committed; review pending |
| D1: integration source | Client, scope/read/save stores, React hooks, synthetic tests | Exact-head isolated test result, source review and retained logs | Implemented here; use PR receipts for actual test/review result |
| D2: hosted wiring | Existing Base44 screens connected to one client/provider, all supported controls wired | Builder readback, production build/typecheck, browser controls work | Not installed by this lane |
| D3: backend commissioning | Backend PR73 plus release transition #74, private GitHub App configuration and schema | Qualified serving source/restart receipt; initially paused product | Controller-owned dependency, not changed here |
| D4: live acceptance | User/admin/non-owner scopes and complete PR-review flow | Real OAuth/install/webhook/review/publication/refresh evidence | Not run |
| D5: owner publication | Publish accepted Base44 revision, smoke and rollback reference | Owner publication readback and public smoke | Reserved for Owen; not published |

D1 is useful implementation, not completion of D2–D5. Do not add overlapping subset/backend test counts together or mark the dashboard done because backend tests pass. The previously completed learning pilot is never restarted by this plan.

## Installation order in the existing builder

1. Read the current router, product API module, session/provider, dashboard pages, configuration save handler and preview controls. Capture the exact preimages and existing design. Compare names and exports before adding any file. No blind whole-app replacement, bulk schema sync or new application.
2. Reconcile the three portable modules with the existing client/store rather than installing two competing sources of session truth. Import the application's existing React once. Create bindings once at module scope. Keep the product provider below the marketing router; do not fetch product data on marketing pages.
3. Preserve `/{slug}/dashboard` and `/{slug}/settings/configuration`, which the actual GitHub callbacks target. Resolve the requested slug against `/session.organizations`; a missing slug must show denial, not silently select another organization. On a user-initiated org change, clear private state before navigating.
4. Wire session/shell, Overview, Reviews, run detail and configuration first. Keep validated filter drafts separate from applied filters. An impossible date shows an inline error before network dispatch. Use a fresh settings editor per user/org scope. Display baseline/draft differences after conflict or unknown result.
5. Wire remaining settings/repositories/admin views using `SCREEN_READS` and fixed client actions. Derive ordinary organization permissions from actual membership; derive global admin only from the server's `isAdmin`. Server denial clears private data even if the controls were visible.
6. Keep the design preview permanently `mode: 'preview'`. Live product routes use the commissioned HTTPS API base and cookie transport only. Never put credentials, admin allowlists or tokens in builder prompts/client code. No query parameter or localStorage value can grant authority.
7. Read back exact hosted source, build and typecheck. Exercise error/empty/loading and supported mutations in the actual browser. Retain visual/mobile/keyboard evidence and compare the marketing pages. Do not publish; Owen publishes only after D4.

### Existing React component wiring

```js
// Module scope: adapt import paths to the existing Base44 source layout after reading it.
import * as React from 'react';
import { createProductClient } from './product-client.mjs';
import { createDashboardBindings } from './react-bindings.mjs';
export const g8s = createDashboardBindings(React);
export const liveClient = createProductClient({
  baseUrl: import.meta.env.VITE_G8S_API_BASE_URL,
  mode: 'live', // only for real product routes; server setup and permissions still decide access
});
export const previewClient = createProductClient({ mode: 'preview' });
```

Wrap only the existing product area with `g8s.Provider`, passing the stable client and router-derived `initialSlug`. Do not wrap marketing pages. Use `g8s.useDashboard()` to render session/setup/error state. Show explicit sign-in/install buttons whose click handler navigates to `model.navigation('signin')` or `model.navigation('install')`; do not navigate from render/effects. Catch errors and display their safe message. Logout clears local private state immediately; unknown logout must not be presented as confirmed server logout.

```js
// Inside the existing Overview component:
const report = g8s.useReport('overview', { filters: appliedFilters });
// Render loading while idle/loading; render report.error on error.
// A successful report with hasData:false is the empty state, not a network failure.
// Render the actual stats/series/recentPrs fields without synthetic fallback values.

// Inside Configuration:
const form = g8s.useConfigurationEditor();
// Inputs read form.draft; onChange calls form.edit(nextDraft).
// Save is an explicit click invoking form.save(), disabled while saving/reconciling,
// when !form.dirty, or when form.status === 'readback_required'.
// 'Read saved state' invokes form.readBack(); compare baseline versus retained draft.
```

Use `useReport('reviews', {filters})`, `useReport('run', {id})`, `useReport('settings', {section})`, `useReport('repositories', {filters})` and `useReport('admin', {section, filters}, {enabled: state.session?.isAdmin === true})` in the corresponding existing views. A `ready` envelope is not a license to invent missing fields: render unsupported/malformed required data as unavailable and record an integration defect.

For other forms, instantiate `createEditor` with read/save adapters for that exact resource and register it through `model.track(editor)`. Do not wire a bare form submit to an automatic retry loop. Reset editors on identity/organization change. Use numeric repository `id`, not UUID `recordId`. The `finding` action confirms a user-selected open/closed state; it does not infer a fix.

CSV handling is a user-click-only Blob download with MIME `text/csv;charset=utf-8`, a fixed `g8s-audit.csv` filename, a detached object URL revoked after use, and no HTML insertion. The service performs CSV cell neutralization. PR links use `githubPullRequestHref`; null means no link. Model/PR/audit text is rendered through normal escaped React text, never `dangerouslySetInnerHTML`.

## Unsupported controls remain explicit

Invitation delivery/acceptance, non-GitHub integrations, billing checkout, PR-description auto-fill, automatic repairs/merges and force-retry of uncertain jobs are not added by this client. Disable those actions with an explanation. A pending invitation is not sent mail. An empty clean COMMENT is not an APPROVE. Unknown costs are not zero; `costDisplay` distinguishes reconciled spend, complete estimates, incomplete known subtotal and unavailable data.

## Live acceptance evidence to collect

A01–A08: preview issues no requests; missing configuration shows setup; session expiry clears views; slow old-scope responses never populate new scope; invalid filters do not fetch; edits survive concurrent saves; 409/timeout preserves draft and never retries; unknown costs remain unknown.

A09–A16: real owner/non-owner/admin denial; selected repository connect/refresh/disable round-trip; authentic signed delivery and duplicate deduplication; published review tied to immutable PR revision; genuine findings and evidence visible after refresh; held/truncated/failed runs not successful; administrative audit and limits persist; reload/restart and phone/keyboard workflow pass; marketing and historical learning unchanged.

Record exact frontend revision, API serving commit, browser/origin, roles, action, expected/actual result and timestamp. Keep private identities/evidence out of public receipts. No test checkbox is prechecked here. Browser access, hosted changes and live acceptance are unobserved in this lane.

## References

React external-store snapshots: https://react.dev/reference/react/useSyncExternalStore
Credentialed fetch and abort semantics: https://developer.mozilla.org/en-US/docs/Web/API/Fetch_API/Using_Fetch
Normative fetch/redirect behavior: https://fetch.spec.whatwg.org/
Application authority remains the pinned backend contract and server behavior, not these browser references.
