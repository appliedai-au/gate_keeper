# Gatekeeper adversarial checkbox and V-model strength — implementation contract

## Default (matches current Gatekeeper)
- **Adversarial review:** ON. `scripts/review-mode.mjs` defaults to `adversarial`; OFF switches to the existing `lean` method only.
- **V-model strength:** **0 — Current Gatekeeper**: read-only code review, no new V-model gate, repair or qualification claim.
- **Optional advisory gate:** ON; owner/tenant opt-out must be verified server-side and cannot remove mandatory security/spend controls.
- **No human in loop:** OFF; not a saved control and not permission for autonomous execution.
- The existing diagram pairing slider remains an independent visual inspector. It does **not** change validation strength.

Source of the four-level control contract:
`integrations/base44/data/controlProfiles.json`. The enforceable *source-level preflight*, not a capability grant, is `scripts/execution/review-controls.mjs`.

| Level | Name | Change from current | Release effect |
| --- | --- | --- | --- |
| 0 | Current Gatekeeper | Existing read-only reviewer | None |
| 1 | Enhanced review | Source-bound requirements and threat mapping; still read-only | None |
| 2 | Partial V-model | Isolated sandbox candidate, acceptance/adversarial/integration/unit/static checks and bounded polling | Candidate only; no automatic merge, no permission from the slider |
| 3 | Full V-model | Same plus sealed holdout, independent signed qualification and billing settlement | Qualification required; independently controlled promotion still separate |

Turning adversarial **review** OFF does not waive adversarial **tests** when V level 2 or 3 requires them. "No human in the loop" applies only to separately authorised sandbox work; no UI checkbox can waive tenant/source/budget/sandbox restrictions. Administrators may override the optional advisory gate for at most 15 minutes with a verified actor, scoped tenant, reason and expiry. That override never authorises paid inference, repairs or releases.

## Existing Base44 app — draft saved settings

The current GitHub source includes:
- `integrations/base44/components/ControlDeck.jsx` — a deterministic **demo**. Defaults to adversarial ON + V level 0. The second slider still highlights V pairings.
- `integrations/base44/components/GateKeeperControlSettings.jsx` — administrator panel using a single `gatekeeperControls` backend function; shown on Settings after deployment.
- `integrations/base44/functions/gatekeeperControls.js` — existing Base44 editor/Deno function, authenticated admin only, bounded request bodies, exact fields and version conflicts; no inference or upstream calls.
- `integrations/base44/cli/base44/functions/gatekeeper-controls/entry.ts` — alternative for Base44 CLI/sandbox runtime; **install only one backend variant** after inspecting the actual existing app.
- `integrations/base44/cli/base44/entities/gate-keeper-control-policy.jsonc` — matching private `GateKeeperControlPolicy` entity definition. **RLS read/create/update/delete=false**; only the backend service-role path can operate on it.

The saved row is scoped to authenticated `user.id` with `user.role=admin`, **not a caller-supplied tenant id**. No cross-tenant settings, tenant membership or remote execution are yet enabled; do not invent a tenant relationship from a browser payload. Revision checking is best effort: Base44 entity updates have not been proven to offer atomic compare-and-swap; never treat this store as a concurrency-safe operational policy authority. If the entity is missing, unauthorized, duplicates exist or stored settings are malformed, the endpoint fails closed. It never degrades to browser storage or a supposedly successful save.

### Installation — existing app only

Target existing app ID `6ae577c8f34f21f5eebe75d9`, URL `https://secure-authentic-gate-flow.base44.app/`. **Do not create a second app**.

1. In its authenticated Base44 editor, verify whether the project is editor/Deno or CLI/sandbox. Checkpoint before editing. Preserve existing auth and routes.
2. Install the **private entity schema first**; inspect that unauthenticated and ordinary users cannot list, create, read, update or delete settings.
3. Install the matching single backend variant. Confirm `load` returns the default only for an authenticated administrator. Test invalid settings, admin denial, oversized JSON, simulated missing database, stale-revision conflict and no external requests.
4. Install `GateKeeperControlSettings.jsx` and the amended `GateKeeper.jsx` Settings route; install the amended demo `ControlDeck.jsx`, CSS and `controlProfiles.json`. Preview and publish **inside the existing app**, with responsive/mobile and keyboard tests.
5. Verify saved owner settings survive refresh and do **not** change the live reviewer until the separately authenticated operational gateway is commissioned.
6. Once a trusted tenant-membership source and atomic store exist, separately implement tenant-scoped settings, admin overrides and a **server-owned** execution preflight. No trusting a slider, an admin-selected boolean, or a local receipt as proof of independent funding.

## Release gates that remain held

This release changes **source and UI draft settings only**. It does **not** register `gate-keeper-native`, enable a live model/repair API, confirm sponsor credits, permit GitHub writes, settle a US$1 gateway budget, publish private holdouts or sign qualification. `scripts/execution/review-controls.mjs` returns plans and conditional preflight decisions; an independently authenticated gateway **must reverify** external budget, tenant, model, source, sandbox and verifier receipts at the action boundary.

No claim of live Base44 publication is allowed from GitHub tests. Do not merge this work into a live release without isolated source qualification and adversarial review. The public website will remain unchanged until a verified owner editor deployment.
