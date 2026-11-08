# G8S product-only HTTP serving — 9 November 2026

## Scope and reason

The app lives at `https://g8s.app`. Its established API base is `https://gate.g8s.app/gatekeeper/product-v1`. DNS and TLS are already verified. The old edge routes that path into legacy Basic Auth; it has no product API route. The old TrueForge image `f344f5f10207de33b75923da7edd5b367d4d5f83` also lacks the new product handlers and GitHub App configuration.

This composition provides the existing product/session/client HTTP handlers in a distinct process of the SAME G8S application. It does not replace Base44 or duplicate a reviewer. It does not mount, copy, rewrite, reopen or relax the archived learning records. The old TrueForge/history host stays pinned. Issue #74's historical freshness/restart work remains open; this composition does not claim to complete it or certify the old host can restart.

## Serving roles

- `Dockerfile.product-api` runs non-root `scripts/product/api-entry.mjs`, reusing `configuredProduct`, `ProductStore`, existing GitHub OAuth and the optional client API from #73/#77. It contains no startup migration or provider registration.
- The role requires `G8S_API_SERVICE=enabled`, `STANDALONE=false`, and an explicit `G8S_PRODUCT_SOURCE_COMMIT` equal to the platform's exact source. Only canonical HTTPS API/frontend origins are accepted. The archive mount, learning capability names, direct provider credentials and a model-worker enable flag are refused even when credential values are blank.
- This is an HTTP role, NOT a review execution worker. `G8S_PRODUCT_WORKER_ENABLED` stays disabled. `G8S_CLIENT_API_ENABLED` stays disabled until the separately qualified product worker and commissioned schema/limits are available. Do not enable repositories or unpause processing to imply that this API process executes models.
- `/healthz` is liveness, not readiness. `/readyz` returns503 while unconfigured. The startup receipt lists missing GitHub setting NAMES only, never values. A serving process or healthy container is not sign-in acceptance.
- `config/g8s-product-edge.Caddyfile` routes ONLY exact product-v1 paths to the new API process. Existing history/private-review routes continue to the old host. Ordinary TrueForge routes retain their exact existing Basic Auth. The historical Caddyfile and Dockerfile remain byte-identical in source.
- `Dockerfile.product-edge` packages that additive edge configuration with the existing startup wrapper. Do not enable it until `G8S_PRODUCT_HOST` and `G8S_PRODUCT_PORT` identify the new service in the same private Railway environment and the checked candidate passes real-Caddy routing tests.

## No fake sign-in and no Basic Auth workaround

Until GitHub and database configuration is valid, session and sign-in routes return503 JSON `setup_required`, with no Basic challenge. The exact `https://g8s.app` browser origin receives credentialed CORS even for that failure, so the installed client can show the actual setup state. Foreign origins are denied. Preflight does not grant access; all actual requests retain product/session/Bearer authorization and CSRF checks. No wildcard credentialed CORS, hardcoded identity, first-user-admin or backend token in the frontend.

Once commissioned, the actual product handler returns401 JSON `unauthenticated` for a missing session, and303 to GitHub with PKCE/browser-bound state for an explicit sign-in. These outcomes require actual acceptance; they are not implied by the disabled listener test.

## Configuration and secrets

Nonsecret API role settings:

```
G8S_API_SERVICE=enabled
STANDALONE=false
G8S_PRODUCT_SOURCE_COMMIT=<exact qualified deployed commit>
G8S_PUBLIC_API_ORIGIN=https://gate.g8s.app
G8S_FRONTEND_ORIGIN=https://g8s.app
G8S_PRODUCT_ENABLED=disabled
G8S_PRODUCT_WORKER_ENABLED=disabled
G8S_CLIENT_API_ENABLED=disabled
PORT=8080
```

Product enablement additionally requires the existing explicit database configuration, applied `scripts/product/schema.sql`, and these private-owner GitHub App bindings: `G8S_GITHUB_APP_ID`, `G8S_GITHUB_APP_SLUG`, `G8S_GITHUB_CLIENT_ID`, `G8S_GITHUB_CLIENT_SECRET`, `G8S_GITHUB_APP_PRIVATE_KEY`, `G8S_GITHUB_WEBHOOK_SECRET`. The public IDs are not secret, but the three secret values must be entered directly in protected server configuration. Never post them in chat, GitHub, Base44 builder source or frontend config. No generated placeholder qualifies as a credential. Configure `G8S_ADMIN_GITHUB_IDS` from explicitly authorized immutable account IDs; no first-signup shortcut. Missing monthly run limits remain zero.

Use Railway reference variables for database bindings rather than copying secret values. Do not inherit all variables or mount the historical volume. The current runtime requires the packaged TrueForge0.182.0 pg dependency for database access; this HTTP role does not start the TrueForge server or SDK worker. All existing database TLS settings remain authoritative. No startup DDL.

## GitHub App registration values

Use the owner-approved app if one already exists; do not create a duplicate. Otherwise register the G8S GitHub App in the intended owner account and store secrets privately.

- Website: `https://g8s.app`.
- User authorization callback: `https://gate.g8s.app/gatekeeper/product-v1/auth/github/callback`.
- Setup URL: `https://gate.g8s.app/gatekeeper/product-v1/auth/github/setup`.
- Webhook URL: `https://gate.g8s.app/gatekeeper/product-v1/webhooks/github`.
- Repository permissions: Metadata read; Contents read; Pull requests read/write; Issues read. Do not grant contents-write, Actions, administration or provider access.
- Subscribe to pull requests, issue comments and pull-request review comments. Installation/repository-selection and authorization-revocation events must reach the existing handler as documented by GitHub.
- Keep `request_oauth_on_install=false`: this implementation uses the setup callback followed by its own browser-bound OAuth verification. Do not replace it with automatic install-time OAuth or an unbound state parameter.
- Begin with explicitly selected repositories. Register the app as public only when the owner intends clients outside the owning account to install it; this is not authorization to install it broadly or enable review runs.

GitHub supports prefilled registration URLs but does not allow a webhook secret in query parameters. App creation and its secret configuration still require the authorized account. No GitHub App registration, new credential, installation or permission expansion is claimed by this document.

Primary documentation checked for this integration:
https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-using-url-parameters
https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url
https://docs.railway.com/variables
https://docs.railway.com/networking/private-networking

## Qualification and rollout

`Dockerfile.api-serving-qualify` runs actual HTTP/entrypoint tests, real Caddy, all existing product tests, all client API unit/rate tests, real product PostgreSQL and real client PostgreSQL integration. Synthetic OAuth exercises the actual handler without external GitHub calls. No source test is a live-user acceptance. This targeted composition receipt is not the historical full-release receipt and does not authorize changing/restarting the archive host, enabling model work or merging unrelated branches.

Before a traffic switch: source/review receipts on the exact candidate, confirmed target service without archive/provider capabilities, and public checks of the new API profile. Preserve the old Proxy source/config for rollback. Switch only its additive edge Dockerfile/private product target, not the legacy TrueForge source/start command, data or credentials. Confirm legacy protected routes still challenge, product endpoints no longer challenge with Basic Auth, and exact-origin CORS/no-store are preserved. Never announce sign-in fixed from503 setup_required.

Before sign-in acceptance: configure the real GitHub App and database privately, enable only the product HTTP feature, then test an actual owner OAuth callback and session, signed-out and wrong-owner denial, selected installation and persistent settings/readback. Keep publication and model execution under their separate controls. Base44's installed three modules are reused; its marketing and owner-publication boundary stay unchanged.

The missing GitHub App settings, unverified database schema and disabled worker are concrete readiness dependencies, not additional consent requests or grounds for fabricating a working API. Record source, targeted tests, deployed routing and live sign-in as separate facts.
