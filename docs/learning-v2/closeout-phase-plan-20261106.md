# Gate Keeper: operational closeout phase plan

**Prepared:** 6 November 2026, Australia/Melbourne  
**Owner:** Owen Tyas  
**Repository:** `appliedai-au/gate_keeper`  
**Primary delivery record:** [issue #44](https://github.com/appliedai-au/gate_keeper/issues/44)  
**Working status:** P0 and P1 complete; bootstrap/source gate, host initialization and scoped HTTP access are verified. BASE is held after its first real completed model turn: the authority verifier requests 100 turns from an endpoint limited to 25 and receives HTTP 400 before the second call. A narrow pagination repair is being prepared separately; the frozen bundle and pending operation remain unchanged. Base44 app-session acceptance and separate P6 product acceptance remain pending.

## 1. Intended outcome and scope

Finish the owner Learning view and protected learning pilot in the existing Gate Keeper app. The existing host must execute a genuine, bounded ten-attempt experiment on the concurrency/atomicity fault family; retain successful, unsuccessful and unresolved outcomes; carry retained learning into later proposals; and expose truthful, owner-only status in the existing Base44 app. Any promoted rule must pass the existing independent evaluation, three fresh confirmation pairs and separate activation boundary. An honestly measured all-negative result is an acceptable experimental outcome.

**Product boundary:** P0–P5 commission owner-only Learning and the protected pilot. The public live-review submission flow is still a demonstration: no qualified submission backend function exists. Completing the pilot and connecting its status does not make the public review workflow operational. P6 below specifies the separate implementation and live acceptance needed before that claim can be made.

P0–P5 close the protected-learning operational work in #44. They do not promise that the model will improve, establish generalization from development fixtures, or commission a general autonomous code-writing service. [Draft PR #42](https://github.com/appliedai-au/gate_keeper/pull/42), “Gate Keeper rule bag, heuristics, fingerprints and response cache,” is a separate optional backlog item. Do not merge it or introduce its experimental arms, cache changes or heuristics into the frozen pilot to achieve this closeout. That PR is also not a substitute for P6's missing authenticated submission workflow.

Owen's current instruction is to prepare the phase plan and implement it. Existing closeout authorization covers the necessary Gate Keeper-scoped configuration, reversible deployments, protected identities, qualified source repairs, app integration, real inference and final reporting. Do not introduce another approval checkpoint for those already-authorized actions. If an actual platform authentication or automatic approval restriction prevents a specific operation, report that exact restriction and continue independent authorized work. The old request for renewed deletion confirmation is not a new requirement under the current instruction.

Two settled owner decisions remain in force:

- **No aggregate programme spending cap.** Maintain actual calls, known charges, estimates and outstanding prices distinctly for each operation. Unknown cost is not zero and is not an execution ceiling.
- **Spekky is waived for Gate Keeper.** If a source repair is needed, use independent adversarial review → Gitar → repair/re-review → complete isolated Railway qualification → merge → deploy → live acceptance. Do not add another application's gate or implementation work to this scope.

## 2. Starting evidence and immutable identities

The starting record is the [verified execution update on #44](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6664862988), published at 17:35 UTC on 5 November / 04:35 AEDT on 6 November. The lead completed P0's fresh `main` and deployment reconciliation on 6 November before the cleanup below. The frozen source remains unchanged. Recheck the affected live records before subsequent mutations.

| Item | Verified starting identity or state |
| --- | --- |
| Frozen source / merged PR #56 | `a35c83ccb2e3743c4d4f3b9ae13406507dfd297a` |
| Qualified PR head | `7b99341226a06388276fd540b98d6db4891dec4b` |
| Merge base / first parent | `a546ad56321b2080f7b0a6dfbebe00667259173b` |
| Qualified and merged Git tree | `d167b859a9928ed2afac1f23d934946853f341df` |
| Frozen experiment | `gk-v4-concurrency-20261105` |
| Frozen configuration digest | `bd1221efb5946cab549bcb2a6e7205e776a5cef4e43a0bb44c3c1713211d66ed` |
| Live backend version observed at authority initialization | TrueForge `0.182.0` |
| Configured model route | `gk-v4-authority/glm-5-3-flash` → `tfy-managed/glm-5.3-flash` |
| Complete source qualification | Deployment `fdd57133-47dc-424b-845a-27be553c8c9b`: SUCCESS; 641/641 Node tests, 9/9 privacy canary, TypeScript and five scorer self-tests; no failures, skips, cancellations or TODOs |
| Original qualification capture | Historical record: SHA-256 `b5e40d7f6667297d076a2cf78a7f1b233032d2f58f9ca9bb27e8a80f8351be85`, 347,334 retained bytes |
| Fresh qualification evidence capture | Retained on 6 November: 242,625 bytes, SHA-256 `bd2cb592a51081796ad894af9b53fe5af5b153715b30c76ba84b5d4d9abbe7c3` |
| Disposable qualifier cleanup | Service `730fa701-cc2e-4246-9c86-c55586e3dde1` observed absent at `2026-11-06T02:55:55Z` / 13:55:55 AEDT; exact readback `services: []`, `staged: null` |
| Immutable source-qualification receipt | [PR #56 comment 6675649613](https://github.com/appliedai-au/gate_keeper/pull/56#issuecomment-6675649613), published `2026-11-06T02:58:59Z` / 13:58:59 AEDT; exact body SHA-256 `63bab68f35ae5b035beb32a9db2f775f9db41fdde703109bb92d257488f6cdf1` |
| Accepted source-gate evidence | Actual authenticated RPC passed, with signed receipt `authority-gate-b47ee699d2015bc09144ba63c01d5db09db45b11e608e4528aa4611d5f259809`; retained evidence `authority-source-gate.json` |
| Original production host deployment | `62f11d3b-f002-45e1-85e6-7d040770e4a1`, SUCCESS on the frozen source; later initialization/run deployments are listed below |
| Scoped status Proxy deployment | `d396f37f-dbd6-45ed-8510-3406ce1b38cc`, reported SUCCESS on the same source |
| Protected authority initialization | `da34ef0d-6ed8-44fc-b4eb-b7a1bd40d34c`, successful one-shot initialization; this does not establish a serving authority |
| Authority serving deployment | `e4bd438e-89d5-405c-832f-1d607f11e0da`, frozen `a35c83c…`, terminal SUCCESS at `2026-11-06T02:59:39.535Z` / 13:59:39.535 AEDT |
| Authority HTTPS endpoint | `https://gk-native-runner-qualification.up.railway.app`; authenticated authority API, only `/healthz` public |
| Authenticated bootstrap | 200; retained body 427,938 bytes, SHA-256 `f0787f5f5a3656ac8527030f22f259780f8e9b7a6a138a9ad92ea61f079c3a1d`; anonymous bootstrap 401, public health 200; protected bundle contents are not published |
| Host initialization | Deployment `db6bf291-ed3c-426a-9e79-1f8e1996dbcc` SUCCESS; `GK_PRODUCTION_PILOT` reported `initialized`, driver exit 0 at `2026-11-06T03:24:52.943Z` / 14:24:52.943 AEDT |
| Initialized host state | All attempt/result counts 0, baseline `not-planned`, pending operation null; active BASE `27cd5c0e56ad9d9f7cd08fb1b2a015ed864a2d783d6f6e88f05755c12a4ef6fe` |
| Scoped HTTP access | At `2026-11-06T03:25:38Z` / 14:25:38 AEDT, all seven transport checks passed: anonymous 401, wrong token 401, wrong owner 403, owner 200, query 400, POST 405, ordinary Proxy 401; retained evidence `host-status-access-20261106.json` |
| Host run / BASE hold | Deployment `3eb27c23-9e17-40d4-905d-d3d5a6ab198d`, pinned frozen source/current configuration; BASE held because `authority-provider.mjs` sends `listTurns(limit: 100)` to the observed 0.182.0 endpoint with maximum 25 |
| First real BASE call | Turn completed at `2026-11-06T03:27:31.390Z` / 14:27:31.390 AEDT; 2,550 input + 644 output = 3,194 tokens; SDK estimate US$0.0004338, actual billed charge unknown; full BASE evaluation is not complete |
| New-pilot result | **0/10 genuine learning attempts**; one completed BASE model turn does not count as a proposal attempt or a qualified baseline |
| Existing Base44 app | App ID `6ae577c8f34f21f5eebe75d9`; [secure-authentic-gate-flow.base44.app](https://secure-authentic-gate-flow.base44.app/) |
| Plan publication | [Draft PR #57](https://github.com/appliedai-au/gate_keeper/pull/57), isolated branch `work/gatekeeper-closeout-phase-plan-20261106`; `main` remains the frozen source |

The two raw qualification captures are separate retained artifacts. Preserve the original byte count/digest as historical provenance; identify the actual capture used by the new receipt rather than relabeling either artifact as the other.

The imported legacy bank is an immutable historical input: revision 65; original groups **0 accepted / 35 harmful / 18 unproven / 47 history**. Its source-file digest is `2f679a49712b9dbefc992c03a1437ec9dff7e2f989b90bcb130aa3a4dc42b7ab`; its complete projection digest is `549a00b379e7819cd6b0ea1141f58d4ded306cb1a41c7909de186ee531f568f2`. The normalized view contains 100 procedure references, 66 rejected and 34 unproven, plus one non-procedure historical record. These are different representations of the same history, not contradictory counts. They are not new signed promotions or new-pilot attempts.

### Preserve the frozen source while publishing this plan

The authority's source proof checks current `main`, the deployed source, two ordered merge parents and the qualified tree. This plan is published through [draft PR #57](https://github.com/appliedai-au/gate_keeper/pull/57) on `work/gatekeeper-closeout-phase-plan-20261106`. **Keep that documentation branch isolated; do not merge it into `main` before the frozen pilot is complete.** Do not deploy the documentation branch, modify the existing frozen bundle, or rebind the experiment to a later commit to accommodate documentation changes. The execution ledger can be updated in #44 and on that documentation branch.

Keep the existing production host, authority service, volumes, app and controller ownership. Do not create a second learning coordinator or copy provider credentials into the host or Base44 app.

## 3. Roles and execution order

The existing closeout lead owns reconciliation, operational changes and the evidence ledger. An independent reviewer checks any new source repair and final acceptance. The semantic reviewer identified in the frozen authority configuration owns actual novelty/applicability decisions; the proposing model does not approve its own rule.

| Phase | Deliverable | Initial status | Depends on |
| --- | --- | --- | --- |
| P0 | Current-state reconciliation and complete evidence inventory | Complete; fresh `main`/deployment reads reconciled | Existing access |
| P1 | Verified disposable cleanup and authentic source-qualification receipt | Complete; immutable PR #56 receipt accepted by actual source-gate RPC | P0 |
| P2 | Updated Base44 bridge, scoped bindings and real access acceptance | Base44 authentication interrupted; actual app-session acceptance pending | Initialized host is now available; resume app authentication |
| P3 | Serving authority, registered provider, initialized host and genuine BASE execution | Bootstrap/gate/init verified; HTTP transport 7/7; BASE held on turn-pagination HTTP 400 after one completed call | Narrow source repair, independent review and remote qualification; preserve pending operation |
| P4 | Exactly ten genuine proposal attempts with retained outcomes and qualified promotions, if any | 0/10 | P3 and protected status/control observability |
| P5 | Restart, accounting, privacy, final evidence and #44 disposition | Pending | P2, P4 |
| P6 | Authenticated live-review submission, real results and private run history | Separate source work; no qualified/deployed live submission acceptance | Preserve P0–P5's frozen runtime; qualify P6's own source and release |

P2's final app-session checks can now use the initialized host. The seven successful scoped HTTP checks establish transport authorization, not Base44 owner/non-owner session behavior. If browser access is unavailable, advance independent backend work; full #44 closure still requires actual app acceptance.

### Current next actions

1. Preserve the held BASE operation and its actual first-call evidence. Prepare only the bounded source repair: turns page size 25, events page size 100, full pagination/cursor checks and root-turn exclusivity retained. Qualify it independently before any operational recovery; do not retry BASE or mutate the frozen bundle.
2. Resume the interrupted Base44 authentication flow, complete the bridge/bindings, and verify actual anonymous, non-owner and owner app sessions. Do not substitute the passed transport matrix for those app checks.
3. After a separately reviewed recovery/source-transition decision and genuine BASE qualification, continue through original operations and independent review pauses. No proposal attempt has yet been accepted; do not turn the completed BASE call into attempt 1 or fabricate a complete baseline.
4. Keep P6 source implementation on its separate branch/release path. It must not change the frozen pilot's `main`, source, bundle or authority bindings.

## P0 — Reconcile before dispatch

**Status:** Complete. Preserve the reconciled evidence and repeat only affected readbacks before subsequent operations; `main` remains frozen.

**Action.** Read current GitHub `main`, #44, PR #56 and its exact-head Gitar records. Read current Railway deployment/configuration state for the existing host, Proxy and authority, including any in-flight or staged changes. Inspect protected operation status before starting, restarting or replacing a process. Reconcile work already dispatched by another active owner; do not start a duplicate run.

Confirm these existing resource scopes from live readback:

| Resource | Identity |
| --- | --- |
| Production project / environment | `507ae09d-7dbb-444a-bd62-a5a16405c874` / `09f8dc82-3d95-4c8c-8d8a-f427ebe240b0` |
| Production TrueForge host | Service `72340647-f083-4fe1-97e1-3e9415007bd9` |
| Host private journal | Volume `0eab4790-3333-4c90-b17c-820a129eff38`, mounted at `/var/lib/gk-v2-private-journal` |
| Existing authority project / environment | `a8f4c4a4-0f32-4166-ba92-dad9baf2b652` / `03fb9181-2f19-409b-a9b1-823cb32e56c2` |
| Existing authority service | `e885493f-229a-40ea-8ba5-04f55dd6465d`, preserving `/data` |
| Legacy bank / new authority custody | `/data/gk3-rule-bank.json` read only / existing `/data/gk-v4-authority` |

Record the actual current public fingerprints and frozen binding without exposing private keys, tokens, procedure text or private model traces. Verify whether the one-shot authority initialization already created custody; reuse it. Check whether a production experiment or pending operation now exists before invoking `init` or `run`.

**Exit evidence.** One dated inventory binds exact source, qualified tree, deployments, volumes, frozen configuration, service ownership and operation state. If current observations differ from the starting snapshot, record the difference and reconcile it before that affected action. A healthy container is recorded separately from model readiness and learning completion.

**Recovery.** P0 is read only. Preserve uncertain operations for original-evidence reconciliation; do not turn a missing response into permission to repeat a call.

## P1 — Finish commissioning prerequisites and cleanup

**Action.** Preserve and verify the complete existing successful qualification evidence. Do not rerun the full suite merely because time passed when the exact source and receipt still match.

**Status:** Complete. Actual cleanup, immutable PR #56 receipt and accepted source-gate evidence are identified in section 2. The original and fresh raw captures remain separate retained artifacts.

Completed cleanup scope:

- Project `963f87a2-3e3c-4cc0-a92a-f96f010ac73e`.
- Environment `eb286452-9989-451b-9254-0832cb803957`.
- Service `730fa701-cc2e-4246-9c86-c55586e3dde1`.

Retain the actual absence readback and do not recreate this service. No additional project, unrelated service or production journal deletion is part of this cleanup. A queued, canceled or failed delete would not have been sufficient; the observed absence is the accepted evidence.

**Receipt handling.** [PR #56 comment 6675649613](https://github.com/appliedai-au/gate_keeper/pull/56#issuecomment-6675649613) is the immutable `GK_AUTHORITY_QUALIFICATION` receipt, using the schema in the [commissioning document](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/detached-authority-commissioning.md). The authoritative receipt belongs on PR #56, not issue #44; #44 can link it. Never edit the pinned comment. Keep its source, qualification, cleanup and Gitar identities distinct from subsequent runtime results. Preserve native review states accurately; `COMMENTED` is not `APPROVED`.

The actual source-gate RPC has now accepted the pinned receipt and returned its authentic signed gate evidence. Maintain the exact receipt body, real comment/author bindings, ordered merge parents `[a546ad56321b2080f7b0a6dfbebe00667259173b, 7b99341226a06388276fd540b98d6db4891dec4b]` and tested/merged tree equality. Keep `main` at `a35c83c…` while this proof is required. This accepted source gate does not establish live model execution.

**Exit evidence.** Cleanup is observed, the complete qualification receipt is authentic and retrievable, and all proof fields bind the existing qualified source. Synthetic receipts, placeholder IDs, unverified cleanup or an old review of a different head do not qualify.

**Recovery.** If cleanup or proof verification fails, keep the authority non-dispatching and fix that concrete discrepancy. Existing host status, app preparation and evidence review can continue. Recreate a disposable qualifier only if a specific new source repair requires qualification; never as a substitute for deleting the old one truthfully.

## P2 — Connect the existing Base44 Learning view

**Status:** Authentication interrupted; no actual Base44 owner/non-owner app-session acceptance claimed. The host transport matrix passed independently and is not a substitute for this phase.

**Preparation.** Open the existing owner app and inspect its actual function runtime, current source, published revision and settings. Retain a source/settings checkpoint. Compare the installed Learning bridge with the qualified `integrations/base44/` snapshot. Apply the remaining bridge files and their dependencies in the app's real editor convention, recording the exact delta; the previous handoff expects a three-file bridge update, which must be checked against the app rather than assumed. Do not deploy both backend variants or bulk-sync the sparse integration tree.

Configure exactly these four server-side bindings through the protected app settings:

- `GATEKEEPER_LEARNING_OWNER_ID`: the server-verified owner matching the frozen authority binding.
- `GATEKEEPER_LEARNING_EXPERIMENT_ID`: `gk-v4-concurrency-20261105`.
- `GATEKEEPER_LEARNING_SOURCE_COMMIT`: `a35c83ccb2e3743c4d4f3b9ae13406507dfd297a`.
- `GATEKEEPER_LEARNING_READ_TOKEN`: the actual separate, scoped owner-status capability, distinct from the authority driver credential.

The fixed upstream is `https://proxy-production-9553.up.railway.app/gatekeeper/learning-v3/status`. The browser must not select arbitrary owner, experiment, source or upstream URL. It receives neither upstream tokens nor general Proxy credentials. Preserve ordinary TrueForge Basic Auth, existing app entities, unrelated functions and auth routes.

**Live acceptance.** After the app's remote build succeeds and P3 has initialized a real host journal, publish the existing app and retain actual results:

| Actor or request | Required observation |
| --- | --- |
| Anonymous visitor/session | Sign-in state; no learning figures; backend denies unauthorized access |
| Authenticated non-owner account | Backend returns 403 and the UI exposes no selected-experiment data |
| Configured authenticated owner | 200 with the real fixed experiment/source and journal-derived counts |
| Wrong owner/token, altered query/method or invalid binding | Refusal; no fallback to ordinary TrueForge or sample numbers |
| Upstream unavailable, stale or invalid response | Clear unavailable/error state; no stale success or fabricated progress |

Use real authenticated app sessions for owner and non-owner acceptance. A unit fixture or a hand-crafted owner header is not a substitute for the Base44 identity check. If an authorized non-owner session cannot be obtained, record that precise unverified item and continue other work; do not mark the access matrix complete.

**Exit evidence.** App URL and published revision, exact installed bridge files, server binding identities without secret values, and captured anonymous/non-owner/owner results. Confirm owner-visible counts agree with the protected host projection before and after the pilot. Check the Learning view at desktop and mobile widths and its loading/error states; do not expand this into an unrelated redesign.

**Rollback.** Restore the prior bridge/published app revision and prior scoped settings from the checkpoint. Preserve app entities, existing history, Railway volumes and the experiment. If necessary restore the prior Proxy image/start configuration without weakening ordinary-route authentication.

## P3 — Serve the authority, initialize the host and prove real BASE execution

**Status:** Serving, bootstrap, source-gate verification, initialization and scoped HTTP access are accepted. BASE is held after one real completed turn because the authority's turn-list page size exceeds the backend maximum. This establishes genuine inference, not a qualified baseline. Retain the pending operation and prepare the narrow source repair on a separate branch; no generic recovery or frozen-bundle mutation is included in that repair.

**Authority.** Preserve the existing custody, identities, relay prefix, bank projection and frozen bundle. Maintain `Dockerfile.authority`, explicit start command `node /app/scripts/learning-v2/authority-service.mjs`, and `GK_AUTHORITY_MODE=serve` with the verified source proof. Do not execute the old legacy boot or reinitialize custody.

The one-shot provider-registration flag has been cleared using the supported no-deploy variable update. Keep it cleared on subsequent starts and verify the existing scoped route rather than registering another provider. Keep authorized provider credentials on the authority service. Maintain actual backend-version/model/relay checks and only `/healthz` public without authentication. Registration and bootstrap success remain zero-inference readiness evidence, not a model smoke result.

**Host.** Initialization has completed against the verified small bootstrap descriptor and frozen public pins. Keep the production driver limited to its scoped bearer credential and separate read token. Retain `GK_V2_HOST_BOOTSTRAP=enabled`, `GK_V3_HTTP_ROUTER=enabled` and `GK_V3_READONLY_STATUS=enabled`. Preserve the installed `GK_PRODUCTION_BOOTSTRAP_B64` configuration without also setting its full alternative. Preserve UID 1000, private directory mode 0700 and private file mode 0600.

The experiment now exists: reopen it with `status` when observation is needed; do not initialize again or replace its journal. The accepted initialization showed all counts zero, baseline not planned and no pending operation. Subsequent command/configuration changes must use the same frozen source and current configuration, rather than a historical deployment's stale command snapshot. Observe terminal deployment status and actual driver evidence after each change.

**BASE and first real execution.** The qualified launcher exposes `init`, `run`, `resume-review`, `reconcile-usage`, `reconcile-operation` and `status`; it has no baseline-only CLI command. The existing `run` action records the source gate, executes frozen BASE and may immediately reserve/propose the first attempt before pausing for independent review. That bounded action has been invoked through the deploying pinned run; do not start another. Accept its genuine BASE execution as smoke evidence only once verified, and count any first proposal toward the same ten-attempt pilot. Do not invent an extra smoke command, add an untracked model call or restart to create a fresh first attempt.

Verify actual owned SDK session/turn and outbound call observations, complete two-pass coverage, independent evaluation/settlement evidence and the frozen model/runtime identity. Distinguish submitted intent, an HTTP response, complete model output and settled evidence. A backend health response or an initialized journal alone proves none of those execution results.

**Exit evidence.** Authority serving and model route are verified; the host is bound to the existing experiment; owner-status read works against the initialized state; original BASE evidence is genuine and complete; every incurred call belongs to a retained operation. If the driver pauses at the first proposal, carry that exact operation into P4. Record its attempt count immediately.

**Recovery.** On ambiguous execution, stop new dispatch and inspect protected state. Reconcile the original operation using actual terminal provider artifacts. Never retry an unresolved session/turn intent, change source/configuration/keys midway, or claim zero usage because a response was lost.

## P4 — Complete exactly ten genuine learning attempts

Continue the same controller, fault family, frozen BASE, model, corpus, scorer, bank and experiment. The corpus contains five fit and two already-burned development check cases, with 16 focused defects. Tranche 7 remains sealed and unused. These results are development evidence, not holdout or generalization evidence.

For each attempt:

1. Retain its durable attempt/proposal operation, exact incumbent and actual proposal call. Later proposer inputs must include the permitted retained positive and negative procedure outcomes. Preserve check truth, private reviewer metadata and other excluded evidence outside model inputs.
2. Verify the complete protected review export by ordered parts, byte count and SHA-256. The configured independent semantic reviewer compares the actual procedure and guard/scope against every retained prior reference and verifies applicability against supplied code. Different wording alone does not prove novelty.
3. Relay the real review bound to the exact `reviewId` and `contextDigest`. Retain novel, equivalent or uncertain outcomes accurately. Do not re-propose or re-evaluate an already rejected identical/equivalent procedure to seek a different verdict.
4. Clear stale review/export control variables with the supported no-deploy variable update while the driver is paused; then use `resume-review` for the original operation. This consumes the original proposal and its authentic decision without repeating the paid proposal.
5. Screen eligible candidates against the confirmed incumbent. A provisional gain needs net improvement of at least +1, no fit/check regression and complete required output. A missing or malformed response is not an empty successful finding list.
6. For a promising candidate only, require exactly three fresh full paired confirmations, with alternating incumbent/candidate order and the predeclared original-BASE controls where applicable. Enforce the frozen source policy; no replacement pairs, extra favorable blocks or optional stopping. Only confirmed evidence plus a distinct authentic activation receipt can change the incumbent.
7. Bank the actual result and carry it forward. Invalid, duplicate, rejected, unproven and unresolved outcomes consume their reserved attempt according to the existing controller; do not add replacement attempts to obtain ten scored candidates.

Ten reserved IDs are insufficient for closeout. Completion requires **ten settled proposal operations, each with one authenticated actual proposal call**, and a controller completion result for the same experiment. If an execution exception leaves that requirement unsatisfied, report and reconcile the actual shortfall; do not silently replace the frozen experiment or relabel reserved work as genuine attempts.

**Per-attempt acceptance table.** Retain attempt number/ID, proposer operation and call evidence, incumbent version, candidate digest, novelty disposition, screen result, confirmation pair results if used, final disposition, activated version if any, before/after bank state and per-operation usage state. Use private evidence references for protected material; public reports must not publish raw procedure or oracle contents.

**Exit evidence.** Exactly ten genuine attempts are accounted for, every operation is settled or explicitly identified as preventing completion, the retained bag carries forward, rejected rules are not silently retried, host and authority agree on the active version, and each activation has qualifying evidence. An all-negative pilot completes with BASE active and zero new accepted rules. Do not call that an improvement.

**Recovery.** Use the existing `reconcile-operation` path only for independently established failed execution or already-consumed evidence needing settlement. A pending semantic review cannot be erased as a failed call. Preserve lost successful output for original-evidence continuation. If a confirmed version must be rolled back, use a valid rollback authorization for an eligible prior version and retain the history; do not edit the journal.

## P5 — Verify persistence, accounting, privacy and final closeout

Set `GK_PRODUCTION_COMMAND=status` after completion and remove operation-specific command variables. Check no provider call is active before controlled restarts. Capture protected host/authority projections, restart/reopen the existing services against the same source and volumes, and verify unchanged experiment/configuration identities, bank history, active version, ten-attempt disposition and operation/receipt identities. The restart must not create an additional proposal, provider call or activation.

Reconstruct the complete protected acceptance export using one matching status ID, every indexed part, exact bytes and SHA-256. Compare authority results with durable host state: an authority-issued activation is not proof the host consumed it. Confirm the owner app renders that same state after restart.

For accounting, report actual call counts separately from SDK event counts and intent records. List verified charges where genuine billing evidence exists, SDK estimates as estimates, and unknown prices as unknown. The current authority integration has no independently verified invoice API and truthfully returns unknown for unsupported usage reconciliation. Unknown price alone does not prevent operational closeout; ambiguous call execution or unresolved custody does. Any later price reconciliation must reference the original operation and incur no new inference.

Verify scoped authentication still holds, ordinary Proxy routes retain Basic Auth, the driver and app never received provider/signing secrets, and public/UI/log projections contain no keys, tokens, raw prompts, private oracle data or protected traces. Confirm the historical bank digest is unchanged and disposable resources are actually cleaned up.

Update the working phase ledger and closeout report with:

- Exact source, deployed services and final health observations.
- Real model/runtime, experiment/configuration and protected authority identities.
- The ten-attempt table and positive/negative/unproven rule-bank outcomes.
- Original BASE and final retained evidence, including net findings and false positives, their actual evaluation population and honest limitations. Do not invent an additional final full-corpus run from confirmation results.
- Actual calls, verified charges, estimates and outstanding pricing by operation.
- Source qualification/review, live access acceptance, persistence/restart and cleanup receipts.
- Rollback configuration and any remaining optional backlog.

Reconcile stale roadmap and handoff statements only as a documented update. Preserve old manifests and historical records as dated snapshots. Keep the documentation branch unmerged while `main` equality is still required for this frozen run. Before a later documentation merge, verify deployment source pinning and source-proof behavior so it cannot silently deploy new code or invalidate a required restart. If that binding still applies, publish the completed ledger on its branch and #44 and track the documentation merge separately.

**Exit evidence.** Independent final review accepts the real protected-pilot execution, owner Learning access, persistence, accounting truthfulness and source/deployment bindings. Close #44 only when its mandatory protected-learning operational criteria are met. If a criterion remains blocked, leave it open and name the exact remaining action, affected resource and evidence; do not substitute another plan or claim source tests prove live acceptance. Keep optional PR #42 outside this completion decision. Report P6 separately: P0–P5 completion alone does not mean the public app accepts live reviews.

## P6 — Implement the authenticated live-review product workflow

**Starting boundary.** The current public review interaction is a sample demonstration. There is no qualified submission backend function to connect merely by enabling a flag. This phase requires new application source, its own reviewed and qualified release, and actual user-facing acceptance. Keep sample content labeled and keep any nonfunctional live-submit action disabled with an accurate explanation until this phase passes.

**Specification.** Preserve the existing app and implement an authenticated, read-only review path:

1. An authenticated user submits a supported code change through a bounded form. The server derives user/tenant identity from the authenticated session, validates input size/type and authorizes that request. The browser cannot choose an arbitrary upstream URL, provider credential, account or session owner.
2. The backend creates a durable user-owned job with an idempotency key before dispatch. It uses an explicitly configured Gate Keeper model/agent route and a separate product request identity; it must not insert arbitrary public code into the frozen learning experiment or use its evaluation/activation authority as a general model proxy.
3. A single owned provider operation produces actual structured findings with file/line, severity and explanation. Submission acknowledgement, queued/running state, completed result and failure are distinguished in the UI. Unknown dispatch remains a reconciliation case, not an automatic duplicate paid request.
4. The authenticated user can reopen their own run and its results after refresh. Ownership checks protect submission, polling, result retrieval and history. Provider credentials, protected pilot records, unrelated user code and raw internal sessions remain server-side.
5. Record actual usage for the product run, with unknown prices and estimates labeled separately. Apply practical input/concurrency/abuse limits without silently restoring the removed aggregate programme ceiling. This phase submits reviews; it does not acquire automatic fix, merge, deploy or learning-promotion powers.

Plan and source preparation may proceed separately while P0–P5 run, but do not change the frozen runtime/main binding or deploy P6 source into its services midway. Qualify new source through independent review, Gitar and complete isolated Railway qualification before the separate deployment. Reuse established infrastructure where suitable; introducing another coordinator is not required.

**Live acceptance.** Verify one real authenticated submission from form to retained findings, using actual provider evidence. Verify a repeated submission with the same idempotency identity does not create another provider operation; refresh preserves the same job/result. Verify a second authenticated user cannot read, poll or alter the first user's job; anonymous access is refused. Verify malformed/oversized input, provider failure, timeout, pending reconciliation, empty findings and reconnect states behave truthfully. Inspect desktop/mobile usability and confirm sample results are never presented as live output.

**Exit evidence.** Exact frontend/backend release identities, deployed submission function/API and persistence bindings, actual product run/provider receipt, authenticated cross-user access checks, idempotency/restart behavior, actual usage state and independent acceptance. Only then describe authenticated live code review as operational. P6 does not retroactively turn the ten-attempt pilot into public-review acceptance, and optional PR #42 remains separately assessed.

**Rollback.** Disable new submissions and restore the last qualified app/backend release while retaining existing job records and any ambiguous operations for reconciliation. Keep a clear status for pending users and preserve the completed pilot, historical bank and Learning view. Do not discard submitted work or rerun it to make the interface appear healthy.

## 4. Failure and source-repair rule

Fix routine configuration and integration defects within the already-authorized scope. If a defect requires a different runtime source, pause new dispatch, retain the current frozen experiment and journals unchanged, and open a bounded source repair for independent review/Gitar/full isolated qualification. Document whether the immutable experiment must be superseded; never silently change its source, trust pins, policy or historic result. A replacement experiment is a separate explicit record with inherited historical evidence, not a reset that hides failure. Do not rerun broad tests without a concrete source or qualification reason.

## 5. Execution ledger

Use one entry per observed phase exit or blocking event; update this table from actual receipts rather than inferred progress.

| Phase | Observation time (AEDT, with UTC in receipt) | Exact source/deployment/operation | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| P0 | 6 November 2026, before the P1 cleanup | `main` remains `a35c83c…`; existing deployments reconciled | Fresh lead GitHub/Railway readbacks | Complete |
| P1 cleanup | 6 November 2026, 13:55:55 AEDT (`2026-11-06T02:55:55Z`) | Service `730fa701-cc2e-4246-9c86-c55586e3dde1` absent | Actual `services: []`, `staged: null`; new 242,625-byte capture with SHA-256 `bd2cb592…` retained | Cleanup complete |
| P1 receipt and gate | Receipt: 6 November 2026, 13:58:59 AEDT; gate subsequently verified | PR #56 comment `6675649613`; signed gate receipt in section 2 | Exact body digest `63bab68f…`; actual RPC evidence retained as `authority-source-gate.json` | Complete |
| P2 | Current app authentication interrupted | Existing Base44 app/published revision | Actual app-session matrix not yet obtained | Pending; HTTP transport success is separate |
| P3 authority/bootstrap | 6 November 2026; serve SUCCESS at 13:59:39.535 AEDT | Existing authority deployment and fixed HTTPS domain | Bootstrap 200 with retained body digest; anonymous 401, health 200; source gate accepted | Bootstrap/authentication accepted; no model-execution claim |
| P3 host initialization | 6 November 2026, 14:24:52.943 AEDT (`2026-11-06T03:24:52.943Z`) | Deployment `db6bf291-ed3c-426a-9e79-1f8e1996dbcc`, frozen experiment | SUCCESS, `initialized`, driver exit 0; all counts 0, BASE selected, no pending operation | Initialization complete |
| P3 HTTP access | 6 November 2026, 14:25:38 AEDT (`2026-11-06T03:25:38Z`) | Initialized host/proxy scoped status route | `host-status-access-20261106.json`: 7/7 expected responses | Transport accepted; no Base44-session acceptance |
| P3 run / BASE | First real turn completed 6 November 2026, 14:27:31.390 AEDT (`2026-11-06T03:27:31.390Z`) | Deployment `3eb27c23-9e17-40d4-905d-d3d5a6ab198d`; original BASE operation retained | One completed turn; verifier `listTurns(limit: 100)` receives HTTP 400 before second call; 3,194 tokens, US$0.0004338 SDK estimate only | Held; narrow pagination repair in preparation, no baseline pass/retry |
| P4 | Current accepted observation: 0/10 | Same experiment | No proposal outcome or qualified BASE yet | Pending; BASE call is not a learning attempt |
| P5 | Pending | Same retained journal and source | Restart, usage, privacy and independent acceptance | Pending |
| P6 | Separate source work | Separate qualified product release required | Real authenticated submission, private results/history and end-to-end acceptance pending | Public review flow remains demo |
| Plan publication | 6 November 2026 | Draft PR #57; `work/gatekeeper-closeout-phase-plan-20261106` | Isolated documentation branch; `main` unchanged | Published as draft; preserve frozen source |

## 6. Primary references

- [Current #44 execution record](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6664862988).
- [Immutable source-qualification receipt on PR #56](https://github.com/appliedai-au/gate_keeper/pull/56#issuecomment-6675649613).
- [Isolated phase-plan draft PR #57](https://github.com/appliedai-au/gate_keeper/pull/57).
- [Retained-history recovery](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6649714244).
- [Production pilot composition at the frozen source](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/production-pilot-v4.md).
- [Detached-authority commissioning and recovery](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/detached-authority-commissioning.md).
- [Owner-bound public status transport](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/public-status-transport.md).
- [Actual driver](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/scripts/learning-v2/production-driver.mjs) and [supported launcher commands](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/scripts/learning-v2/launch-production-pilot.mjs).
- [Optional draft PR #42](https://github.com/appliedai-au/gate_keeper/pull/42).

