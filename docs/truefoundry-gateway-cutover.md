# TrueFoundry sponsor gateway → existing TrueForge runtime

**Status: STAGED ONLY, NO LIVE CUTOVER.** The owner activated `admin@appliedai.com.au` in the Stranger Builds TrueFoundry tenant and saw **22 TrueFoundry-managed models** and 7-day **My Usage: 0 requests, $0** on 1 November 2026. This is proof of model catalogue access, **not** an allocation of sponsor inference credits, an identity-specific budget, or evidence that current Gate Keeper requests use this gateway.

**Important owner billing boundary:** Claude's **engineering work stays on the existing Claude subscription**, not a TrueFoundry/Anthropic API. This bridge is only for the separately authorised **Gate Keeper application model runtime**. Never turn a coding subscription into an unofficial multi-tenant inference proxy or create a new service to imitate one.

## Ownership architecture (no new executor or coordinator)

```text
 Claude subscription (engineering / code changes)   [unchanged]
                         |
                     GitHub PR
                         |
 Gate Keeper reviewer / repair / validation / learning
                         |
             Existing TrueForge runtime
                 (Settings → Models)
                         |
         TrueForge native 'truefoundry' provider
                         |
            Dedicated Gate Keeper virtual account
                         |
     stranger-builds.truefoundry.cloud/api/llm
                         |
          TrueFoundry-managed provider models
```

The TrueForge agent loop, tools, sandbox, subagents and V-model stages remain the same. Gate Keeper does **not** hold provider keys or send its own inference HTTP requests. TrueForge's native `truefoundry` model provider is present in source tag `v0.180.0`; it uses an OpenAI-compatible model adapter and model names `truefoundry/<local-name>`. The upstream identifier is `tfy-managed/<remote-name>`. Confirm both against the TrueFoundry **Playground → Code Snippet** before approval; the owner screenshot establishes the provider account but not a working virtual-account token.

## Exact source-bound candidate configuration

`config/truefoundry-gateway.json` pins:
- tenant `stranger-builds`
- gateway HTTPS base URL `https://stranger-builds.truefoundry.cloud/api/llm`
- native TrueForge provider type/name `truefoundry`
- reviewer and repair `truefoundry/claude-sonnet-5-5` (upstream `tfy-managed/claude-sonnet-5-5`)
- learning `truefoundry/claude-opus-5-5` (upstream `tfy-managed/claude-opus-5-5`)
- grader/gate `truefoundry/claude-opus-5-5` (see below).

**Grader held until calibrated:** the baseline grader Fable 5.1 is **not present** in the owner's 22-model TrueFoundry list. On 2026-11-01 the owner chose `truefoundry/claude-opus-5-5` as the replacement, recorded in `agent/models.json` (`status: pending_calibration`) and `config/truefoundry-gateway.json` (`adjudicatorCalibration`). It is not the reviewer under test (Sonnet 5.5). Until it has re-graded the locked run `gk-live-20261101-g` and agreed with the Fable 5.1 judgements, `gateway:status` reports `ADJUDICATOR_CALIBRATION_PENDING`, and the proof harness refuses any comparison or learning run graded by it. Only an explicit calibration run (`GK_PROOF_CALIBRATION_RUN=1`) may use it; its output is stamped `adjudicator_calibration: "pending"` with a limitation line, and `validatePublicProof` refuses it as a PASS.

The source-only bridge's operator-only `buildProviderManifest({virtualAccountKey})` constructs a native TrueForge provider payload but never sends it anywhere. It is not a new inference client. Never print the resulting payload because it includes the protected credential.

## Provisioning sequence — no automatic writes

1. **Account administrator:** Abhilash or another authorised `stranger-builds` tenant admin confirms *whether sponsor credits are allocated*, who is entitled to use them, whether the grant covers **underlying inference** rather than just gateway infrastructure, expiry, and a funding limit. Save a non-secret attestation to private evidence. The owner currently holds `member` role, not tenant-admin.
2. **Gateway admin:** In **Access → Virtual Accounts**, create a dedicated `gate-keeper-runtime` application identity (do not use `admin@appliedai.com.au` personal PAT). Allow only the expressly qualified `tfy-managed` models. In **Policies → Budget Limiting**, configure an **enforced**, not audit-only, **cumulative** spend ceiling scoped to that virtual account; set rate limits too. Confirm the budget counts sponsor credits and model inference, and prohibit provider/model fallback to a personal or unauthorised account.
3. **TrueForge operator:** In the existing Railway TrueForge **Settings → Models**, add a separate **native TrueFoundry model provider** using the exact HTTPS base URL above and the virtual-account key. Do this in TrueForge's protected provider credentials UI; never pass the key via chat, Git, a build argument, or a plaintext Railway service env var. Model names must be exactly `claude-sonnet-5-5` and `claude-opus-5-5`, with upstream IDs `tfy-managed/claude-sonnet-5-5` and `tfy-managed/claude-opus-5-5`. The agent operates only through TrueFoundry: the direct `anthropic` provider and the agent that used it were removed on 2026-11-01 (run `gk-anthropic-off-20261101-a`, agent and sessions exported to private evidence first), and the proof harness refuses any model not served by a `truefoundry` provider.
4. **Read-only verification:** From an authorised workspace that can reach TrueForge, use `TRUEFORGE_BASE_URL=http://trueforge.railway.internal:8080` only within the existing private Railway project. For any public HTTPS TrueForge URL, set `GK_TRUEFORGE_APPROVED_HOSTS` to its exact hostname **and** provide `TRUEFORGE_TOKEN` from protected configuration. Arbitrary Railway-internal service names, unapproved HTTPS hosts, credentials embedded in URLs and public URLs without a token are rejected before any request. Run `npm run gateway:status`. The command uses only `tf.settings.modelProviders.list()` and `tf.models.list()`; it exposes neither API keys nor sessions and always refuses to declare production release-ready. Examine the returned gateway host, provider type, exact model IDs and blocked roles.
5. **Test and qualification:** A tiny, explicitly authorised single-turn nonproduction model call with a gateway-side allowance may then establish reachability and a correlated **Request Trace** and **Metrics** receipt; compare gateway receipt to TrueForge turn ID and actual gateway model ID. Confirm billing source and remaining credits. This step is NOT executed by `gateway:status` and must not run without a signed budget lease and spend authorisation.
6. **Independently qualify every production role**, the review → repair → V-model tests → polling → re-review → tenant-private learning → external holdout sequence, fail-closed under gateway outages, actual sandbox isolation and unmodified origin source. No paid learning or unattended production repair until independent verifier and settlement work.
7. **Explicit cutover/rollback:** after approval, select `GK_MODEL_PROVIDER=trueforge` and `GK_TRUEFORGE_MODEL=truefoundry/claude-sonnet-5-5` for the review agent and explicitly map each other qualified role. Take a snapshot of the original model provider/agent and record a rollback plan. Never change production configuration automatically.

## Running the bridge preflight

```bash
npm ci
npm run typecheck
npm run test:learning-policy

# No token, no host => returns HELD and the missing gates.
npm run gateway:status

# In a secure, authorised operator environment only:
# TRUEFORGE_BASE_URL=https://<approved-host> TRUEFORGE_TOKEN=(protected secret)
# npm run gateway:status
```

`gateway:status` intentionally exits non-zero for incomplete release evidence **even if** the provider is registered. Its status is a configuration discovery result, not a credential test or an inference receipt. A dashboard model label, a local CLI `PASS`, or a working Playground does **not** prove that the application uses sponsor credits.

## Existing blockers at time of authoring

- No saved virtual-account credential or confirmed application identity accessible to this chat.
- No sponsor funding/balance or gateway-side budget evidence.
- Existing TrueForge production operator authentication is not available here; the user is authenticated to TrueFoundry in an iPad browser session **not shared** with the connected browser tool.
- Grader replacement (Opus 5.5 for Fable 5.1) chosen by the owner but not yet calibrated against the Fable 5.1 judgements.
- No independent signed budget lease or qualified end-to-end TrueForge repair/learning gate.
- **No changes to production TrueForge, Railway variables, model provider, or production billing were made by this staged bridge.**

References:
- TrueForge source schema: `truefoundry/trueforge@v0.180.0/packages/trueforge/src/schemas/modelProvider.ts`
- TrueForge model provider runtime: `truefoundry/trueforge@v0.180.0/packages/trueforge-core/src/core/llm/VercelAILLM.ts`
- TrueFoundry model gateway: https://www.truefoundry.com/ai-gateway
- TrueFoundry budget control: https://www.truefoundry.io/blog/ai-gateway-budgets-quotas
