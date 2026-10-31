# Existing Base44 Gate Keeper site — integration staging

**Target:** https://secure-authentic-gate-flow.base44.app/ (REUSE this app; do not create a new Base44 project).

This folder holds **source-only integration assets**, not an installed Base44 app. It does not change Base44's currently published pages. The present site contains links and an Asteroids demo; preserve the game as a separate optional page when updating the dashboard.

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
- Asteroids page still accessible; default landing page becomes the real Gate Keeper dashboard.
- Closeout includes app URL, exact revision, acceptance evidence and rollback procedure.

## Current status

The code in `functions/` and `components/` is **prepared only**. It has not been installed, deployed or tested inside the Base44 app. The CLI and Base44 editor require the authenticated owner's Base44 session. Railway has not been changed by this source-only work.
