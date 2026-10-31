# Existing Base44 Gate Keeper site — integration staging

**Target:** https://secure-authentic-gate-flow.base44.app/ (REUSE this app; do not create a new Base44 project).

This folder holds **source-only integration assets**, not an installed Base44 app. It does not change Base44's currently published pages.

## Built visual demo (source-ready, not yet published)

- `pages/GateKeeper.jsx` is a complete responsive React application page. It includes Overview, interactive code review walkthrough, Runs, Evidence, Settings and a meaningful, non-deceptive empty state for unfinished live functionality.
- `pages/GateKeeper.css` contains the visual system: charcoal/navy navigation, pale editorial surfaces, lime signal accents, crisp monospace technical details, accessible focus states and mobile layouts.
- `components/GateKeeperConnectionPanel.jsx` displays actual runtime reachability, not invented agent activity.
- `functions/gatekeeperStatus.js` is a narrowly scoped admin-only server-side probe.
- The walkthrough uses a **clearly labeled static review fixture**. Selectable findings highlight real code lines and expose proposed mitigations; it performs no chargeable model call.

To install these into the **existing** Base44 app, first inspect its actual source layout in the owner editor. Place files under its matching `pages/`, `components/` and `functions/` directories; ensure the default landing route renders `GateKeeper`. Import its stylesheet, preserve existing app auth/layout plumbing, and remove any redundant Asteroids navigation. Inspect and adapt the auth integration for the actual app version. The files are integration inputs, not evidence of a deployed site.
 The present site contains links and an Asteroids demo. **Do not preserve Asteroids as a requirement.** Replace the placeholder landing experience with a polished, functional Gate Keeper demo; remove the game and extraneous links if they distract from the actual product. Preserve the existing Base44 app, domain, and owner settings.

## Confirmed deployment (31 October 2026)

- Railway project: `Gate Keeper` (`507ae09d-7dbb-444a-bd62-a5a16405c874`).
- TrueForge service: `72340647-f083-4fe1-97e1-3e9415007bd9`, successfully deployed from `appliedai-au/gate_keeper` `main`.
- Public HTTPS proxy: `https://proxy-production-9553.up.railway.app/`. It requires Basic Authentication; TrueForge itself has **no direct public Railway domain**.
- Railway HTTP logs contain successful `POST /api/v1/sessions` (201) and subsequent session/turn reads (200). This proves the HTTP path was previously used, **not** that Gate Keeper's current model selection, spend controls, or independent learning are qualified.

## Architecture

```text
Existing Base44 browser UI
     | Base44 user's authenticated session
     v
Base44 backend function (role check, response minimization)
     | server-side secret; fixed HTTPS origin, fixed path
     v
Railway Caddy authenticated proxy
     v
Private TrueForge runtime + PostgreSQL + Redis
```

The frontend **must never** receive the proxy password or a TrueForge API token. Do not add a generic URL-forwarding function, automatically merge a reviewed PR, or enable model calls under the guise of a health check.

## Product demo quality bar (owner-approved)

**The Gate Keeper demo must be compelling enough to stand on its own.** Prioritise a fast, mobile-friendly product story and real usefulness over a placeholder game.

- Landing view: a clear one-sentence explanation of Gate Keeper, a strong **Try a code review** action, connection/operational status, and a concise explanation of TrueForge's role.
- Interactive walkthrough: choose a small, non-sensitive code-review example, show the submitted change and structured findings with file/line references, severity, and recommendations. Clearly label **sample fixture** content until a real verified TrueForge run exists; never pass a canned result off as live AI output.
- Real review path: once the server-side adapter and model/budget checks are qualified, allow an authorised user to submit a read-only review and inspect actual findings. No automatic fixes, merges, deployments or paid training.
- Confidence: honest loading, empty, error and degraded-service states, explicit model/cost controls, privacy and authentication protections. Never expose upstream secrets or raw internal sessions.
- Navigation: **Overview · Review · Runs · Evidence · Settings**. Hide or disable non-functional features with an explanation; do not present misleading buttons.
- UX acceptance: responsive mobile and desktop layout; keyboard accessibility; clear typography; no unnecessary animation or slow introductory sequence.
- Remove the Asteroids game if replacing it with this cohesive demo improves the user experience; preserving it is **not** part of acceptance.

## Base44 editor vs current CLI runtime: choose ONE integration mode

Base44 currently publishes more than one backend-function convention, depending on the project creation/runtime pathway. **Do not deploy the earlier editor-style file into a current CLI or sandbox project without adapting it.**

| Existing app mode | Source file to install | UI status function name |
| --- | --- | --- |
| Existing editor / Deno.serve runtime (verify in the app) | `functions/gatekeeperStatus.js` | `gatekeeperStatus` |
| Current CLI / cloud sandbox (export-default entrypoint) | `cli/base44/functions/gatekeeper-status/entry.ts` | `gatekeeper-status` |

For the CLI/sandbox variant, put the entry file in the app's `base44/functions/gatekeeper-status/entry.ts` directory and configure secrets via Base44 app settings. It uses `secrets.get()` from `base44:runtime`. The `GateKeeperConnectionPanel` accepts a `functionName` prop; for this mode use `<GateKeeperConnectionPanel functionName="gatekeeper-status" />`. The sample page currently uses the editor-style default, which must be adjusted after confirming the project's runtime. The two examples are alternatives, not simultaneous deployments.

**Source verification does not establish which runtime your current Base44 demo uses.** Inspect its app source first and preserve existing auth routes and secrets. Authentication and upstream health must be tested after installation.

## Phase 0: safe integration preflight

1. In the **existing** Base44 app's editor, confirm the owner workspace, plan and app ID. Do not provision a new app.
2. Prefer Base44 CLI `npx base44 link --app-id <existing-app-id>` from a configured local `base44/config.jsonc` project. Linking requires account login. Do not execute `base44 create`. If the existing editor app uses a different source tree, inspect/sync that tree before modifying it.
3. Add `functions/gatekeeperStatus.js` from this folder as a backend function in the **existing** Base44 app. Call with `base44.functions.invoke('gatekeeperStatus', {})`; it checks only `GET /healthz` through the proxy.
4. Configure the following **Base44 backend secrets**; never commit credential values:
   - `GATEKEEPER_PROXY_USERNAME` — existing Railway proxy authentication username.
   - `GATEKEEPER_PROXY_PASSWORD` — existing Railway proxy authentication password.
5. Add the included `GateKeeperConnectionPanel.jsx` to the dashboard and verify the Base44 authenticated administrator can obtain a status while an anonymous visitor and non-administrator are denied.
6. Verify TrueForge remains inaccessible without authentication. Verify the function never returns raw upstream bodies or secrets. Verify upstream down/unreachable produces `connected: false`.

**Security note:** the existing proxy credential protects broad upstream access rather than only `/healthz`. For a production, multi-tenant Base44 rollout, replace that shared credential with a **separately scoped, rate-limited bridge identity** and server-side authorization. Until then, limit the integration to trusted admin preflight; do not grant general user access.

## Phase 1: read-only reviewer API (NOT IMPLEMENTED)

- Verify current TrueForge agent `gate-keeper` is registered and a permitted model is configured. Do not infer registration from a healthy container.
- Design a server-side **per-user** session ownership store with strict tenant isolation, limits, audit events and idempotent review submission. The authenticated user's ID must be established by Base44 server-side code and never be accepted from the client payload.
- Map TrueForge's documented Session → Turn → Event API into narrowly scoped endpoints. Do not expose arbitrary TrueForge URLs, admin tokens, saved session IDs, private evidence, raw prompts or tool permissions.
- Allow manual, explicitly authorised **read-only** code review only after model costs and per-user budget limits are confirmed. Long operations should use durable jobs, not a browser request held open.
- Do not run `run-evals`, `improve`, or any autonomous promotion. Existing independent budget gateway, signed evidence and private holdout requirements remain hard gates.

## Release checks

- Base44 existing app ID and ownership verified; no duplicate app created.
- Authenticated admin status probe works; anonymous and ordinary users cannot call the probe.
- Wrong/missing proxy credentials produce a failure, not fallback or credentials in logs.
- A single authorised read-only review yields real, private, per-user findings; no simulated results.
- Tests for cross-user session access, injection via user-supplied URLs, replay/idempotency, budget exhaustion and proxy-down fail gracefully.
- Browser refresh retains run history, while private evaluator evidence stays outside the public Git repository.
- Existing Base44 URL remains unchanged; the default landing page becomes a polished, functional Gate Keeper demo. The Asteroids game may be deleted without replacement.
- Closeout includes app URL, exact revision, acceptance evidence and rollback procedure.

## Current status

The code in `functions/` and `components/` is **prepared only**. It has not been installed, deployed or tested inside the Base44 app. The CLI and Base44 editor require the authenticated owner's Base44 session. Railway has not been changed by this source-only work.
