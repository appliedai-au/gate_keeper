# Existing Base44 app: TrueForge connectivity qualification

**Existing Base44 app ID:** `6ae577c8f34f21f5eebe75d9`  
**Public app:** https://secure-authentic-gate-flow.base44.app/  
**Branch:** stacked onto PR #7. Does not change the running Railway service or the published Base44 app by itself.

## Phase A implemented in source

- `integrations/base44/functions/gatekeeperReadiness.js` is a Base44 **editor/Deno** backend function. It requires an authenticated `admin` user, a POST invocation and backend-only secrets. It makes **exactly two fixed GET requests** to the existing Railway Caddy proxy: `/healthz` and `/api/v1/agents`.
- It checks the saved `gate-keeper` agent's existence and whether its manifest declares a model, but never returns model ID, internal agent configuration, upstream payloads, secrets, private session IDs or credentials.
- It bounds metadata response size, disables caching, rejects redirects, and times out. It does **not** call `sessions`, `turns`, provider APIs or paid inference. Response always sets `reviewEnabled: false`.
- `integrations/base44/components/GateKeeperReadinessPanel.jsx` is a Settings page diagnostics component. It deliberately does not offer a review-submit button.
- `tests/base44-trueforge-readiness.test.mjs` covers missing credentials, wrong methods, anonymous and ordinary users, fixed HTTP paths, unregistered agents, metadata errors and oversized payloads.

## Installation into the existing Base44 app (not yet performed)

1. In the authenticated editor for **this same app**, inspect whether its existing backend is the `Deno.serve` editor runtime. For the newer CLI `base44:runtime` variant, adapt to its `export default` handler and `secrets.get` rather than using this editor file as-is.
2. Create a **restore checkpoint**. Add `gatekeeperReadiness` to the existing app's backend functions; add `GateKeeperReadinessPanel` to **Settings**, without changing the currently functioning static demo.
3. Provision `GATEKEEPER_PROXY_USERNAME` and `GATEKEEPER_PROXY_PASSWORD` **as Base44 backend secrets only**. Never paste these into the Base44 AI chat, frontend or Git. The existing proxy credential currently allows broad TrueForge access, so **admin-only diagnostics is the maximum permitted scope** until a dedicated least-privilege identity is commissioned.
4. Authenticate as the app's admin and call `base44.functions.invoke("gatekeeperReadiness", {})`. Check runtime reachable and registered agent metadata. Then verify anonymous/non-admin requests are 401/403, missing credentials fail closed, and nobody can submit a model review.
5. Publish only after verifying the function works in the app's actual runtime and the existing desktop/mobile demo still functions.

## Phase B: real user reviews — held

The saved agent being registered does **not** prove its model exists or is billable. The current PR #7 TrueFoundry gateway config has `release.active: false` and billing / independent budget qualification outstanding. Even the recent live-proof submission is **INCONCLUSIVE** because sponsor/provider billing and independent verification are unverified.

A real public reviewer must NOT be connected directly to the broad proxy credential. Before implementing the public **Submit review** route:

- Dedicated **read-only, non-admin** TrueForge bridge identity, with gateway-side allowed paths/tools and rate limits, not just a browser-visible API key.
- Base44 authenticated user ID and tenant ID established by the trusted backend; durable session ownership, cross-tenant denial, idempotency/replay protection, and PII-minimising run records.
- Independent **signed pre-spend lease** with exact user, model, source, max tokens/cost, expiry and atomic settlement. An agent or UI cannot mint its own budget.
- Confirm the model ID against the same TrueForge instance's model catalogue and verify its provider/billing allocation. No fallback to personal Claude subscriptions.
- Queue controlled, read-only sessions and turns; no repo writes, sandbox repair, deployment, private evaluator data or automatic learning.
- Adversarial tests: wrong-tenant reads, concurrent duplicate submissions, over-budget rejection, provider outage, stale leases, secret leakage and denial of unscoped upstream URLs.

Only then execute **one explicitly authorised paid review** within a verified limit; inspect actual output and signed cost settlement before enabling the button generally.

## Honest state

The visual app is live as a static demo. This branch implements Phase A **source only**, and the Base44 developer MCP is not connected to this ChatGPT session. The existing site must continue to show **not connected/unverified** until the real backend is installed and tested. Nothing here claims a live integration or a qualified paid review.
