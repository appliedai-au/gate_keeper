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

**Protect the existing app's data models.** Base44's documented `entities push` is an entire-directory synchronization: a remote entity missing from the local `base44/entities/` directory is removed from the remote schema. The current Gatekeeper integration folder includes **only one new entity**, not the existing app's full entity inventory. **Never run `npx base44 entities push` or `npx base44 deploy` from this partial folder, and never use `--force` or `base44 create`**. Doing so could remove existing schema definitions and break existing functions. Reference: [Base44 entities push](https://docs.base44.com/developers/references/cli/commands/entities-push) and [Base44 functions deploy](https://docs.base44.com/developers/references/cli/commands/functions-deploy).

**Safe existing-app sequence:**
- Authenticate and inspect app ID, active runtime convention, all currently deployed entities, functions and website source. Create a rollback checkpoint and export/save the **complete** prechange schema inventory; preserve original pages, auth, secrets, URL and existing user data.
- To bootstrap a *separate working directory for this existing app*, prefer `npx base44 scaffold --app-id 6ae577c8f34f21f5eebe75d9 --no-skills` with owner authentication; never `create`. Scaffolding alone does not deploy. Its backend-only output is not a copy of the live frontend or all existing remote entities.
- Use the authenticated Base44 app API's **create-one-entity-schema** operation, scoped to exactly `GateKeeperControlPolicy`, after verifying it does not already exist. Alternatively, perform a full entity synchronization only when **every existing remote entity** is present locally and a no-deletion comparison has been reviewed. The private entity must retain `rls: { create:false,read:false,update:false,delete:false }`. Direct client reads/writes remain denied; backend service role bypasses RLS only after admin identity validation.
- Install exactly the required backend function by name, without `--force` or a bulk delete. For editor/Deno, its name is `gatekeeperControls`; for CLI/sandbox, the function directory is `gatekeeper-controls`. The settings component defaults to editor/Deno:
  `<GateKeeperControlSettings />`. For CLI/sandbox, use
  `<GateKeeperControlSettings functionName="gatekeeper-controls" />` in `GateKeeper.jsx` after verifying that the app uses the CLI runtime. The same principle applies to the health probe:
  `<GateKeeperConnectionPanel functionName="gatekeeper-status" />` only in CLI mode.
- Deploy **no site assets** until the private entity, admin function, no-auth denial, owner draft persistence, and one-user refresh behaviour pass. Test on the existing app's branch/preview first; preserve its route and publish the same app through normal owner deployment. The site must continue to show `INCONCLUSIVE` for exploratory DeepSeek evidence.
- Compare pre/post entity names and function names: **zero unrelated removals**; check anonymous/user/admin access and mobile and keyboard UX. If any preexisting entity or function disappears or data access changes, restore from the saved checkpoint and hold publication.

**The above is a deployment contract, not an assertion that an authenticated Base44 deployment has occurred.** The connected browser cannot open an owner editor in this session.

1. In its authenticated Base44 editor, verify whether the project is editor/Deno or CLI/sandbox. Checkpoint before editing. Preserve existing auth and routes.
2. Install the **private entity schema first**; inspect that unauthenticated and ordinary users cannot list, create, read, update or delete settings.
3. Install the matching single backend variant. Confirm `load` returns the default only for an authenticated administrator. Test invalid settings, admin denial, oversized JSON, simulated missing database, stale-revision conflict and no external requests.
4. Install `GateKeeperControlSettings.jsx` and the amended `GateKeeper.jsx` Settings route; install the amended demo `ControlDeck.jsx`, CSS and `controlProfiles.json`. Preview and publish **inside the existing app**, with responsive/mobile and keyboard tests.
5. Verify saved owner settings survive refresh and do **not** change the live reviewer until the separately authenticated operational gateway is commissioned.
6. Once a trusted tenant-membership source and atomic store exist, separately implement tenant-scoped settings, admin overrides and a **server-owned** execution preflight. No trusting a slider, an admin-selected boolean, or a local receipt as proof of independent funding.

## Release gates that remain held

This release changes **source and UI draft settings only**. It does **not** register `gate-keeper-native`, enable a live model/repair API, confirm sponsor credits, permit GitHub writes, settle a US$1 gateway budget, publish private holdouts or sign qualification. `scripts/execution/review-controls.mjs` returns plans and conditional preflight decisions; an independently authenticated gateway **must reverify** external budget, tenant, model, source, sandbox and verifier receipts at the action boundary.

No claim of live Base44 publication is allowed from GitHub tests. Do not merge this work into a live release without isolated source qualification and adversarial review. The public website will remain unchanged until a verified owner editor deployment.
