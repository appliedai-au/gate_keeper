# Gate Keeper: operational closeout phase plan

## Latest verified checkpoint — 7 November 2026 AEDT

**Prepared:** 7 November 2026, 05:50:54 AEDT / 6 November 2026, 18:50:54 UTC. This additive checkpoint advances the published 02:54:17 AEDT plan. The complete earlier text is retained below; its older current-status labels, queued qualifiers and unfinished original-pilot custody statements describe their recorded times.

**The original ten-attempt pilot and its final-state custody and persistence checks are complete. The completed-history and private-review release is still being qualified.** Main and the installed production source remain actual E `30e429680f9da8ef8f5307f5fde4ef6bcfa2e70c`, tree `601efb446e0f7aeab2276d851abb7d377703e0d1`. There is no qualified final C release, observed final-qualifier cleanup, C merge/deployment or live app acceptance at this checkpoint. [Issue #44](https://github.com/appliedai-au/gate_keeper/issues/44) remains open.

### Completed original-pilot evidence

The [completed-pilot result](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727) remains **10 genuine attempts, all 10 invalid; 0 scored, 0 confirmed and 0 activated**. Original BASE remains active. All **24 actual model calls** are accounted for across **11 settled operations**: fourteen BASE calls and ten proposal calls, with no pending dispatch or active authority call. The independent audit classified eight proposal outputs as whole-text JSON failures and two as invalid procedures. This establishes a completed experiment with no activated improvement. All actual prices remain unknown; zero known charges is not a zero total cost.

The [custody and final-ten persistence acceptance](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689770096), published at **7 November 03:24:48 AEDT** (`2026-11-06T16:24:48Z`), records an independent data audit of 419 records across seventeen chains, all ninety referenced artifacts, thirty-one distinct Ed25519 envelopes and all eleven exact host/authority admission and settlement pairs. The original BASE archive, original fourth-proposal failure and its later observation using the existing settlement remain preserved. The fourth-result recovery added no model call. The audit retained at `completed-custody-independent-data-audit-20261106.json` is 17,076 bytes, SHA-256 `14219a6473a92c23cd8df6a5d62b9128b4e37feff5a423259904c3feb83497bf`; its data-only verification completed at **03:21:24 AEDT** (`2026-11-06T16:21:24Z`). It did not execute the candidate or independently access the live runtime.

The operator's separate same-E restart, deployment `2bb6a9b2-dbb1-4a6f-8580-2254f0a23b60`, ran only `status`, returned the final ten-invalid / twenty-four-call / eleven-settlement state with exit 0 at **7 November 03:07:43.636 AEDT** (`2026-11-06T16:07:43.636256328Z`), and added no call. Native Console custody verification at **03:19:32.024 AEDT** (`2026-11-06T16:19:32.024Z`) matched all 234 experiment files, totaling 86,972,882 bytes, plus all five proof/authorization sidecars to the pre-restart capture. Each was a regular file with UID 1000, mode 0600 and one link; there were no custody violations. The path-ordered experiment aggregate remains `f75f5438f48a36ee40c565de3e9450ae20bda8b3f6e13545642fbb3705f52072`. This accepts persistence of the final completed pilot on E. Actual C history serving and Base44 product acceptance remain separate work. The controller's last durable record and the later runtime completion event retain their distinct original timestamps.

### Repaired release source and current qualification

The earlier full qualifier for PR #59 head `80068789cc55639914d89855daa65105fb6f6495`, deployment `d92fec26-3a72-4152-b65d-0020753eb599`, **FAILED at 7 November 04:28:11 AEDT** (`2026-11-06T17:28:11Z`). Its source suite reported **1,150 tests: 1,149 passed, 1 failed, 0 skipped, 0 cancelled and 0 TODO**. The real PostgreSQL stage was not reached. The failing existing authorization test used `contracts.copy` on an already signed status, sorting the nested historical envelope fields and causing a signature mismatch before the intended authorization-scope check. The failure and its logs remain retained; earlier source review and earlier successful runs do not qualify this failed head. The [exact repair review request](https://github.com/appliedai-au/gate_keeper/pull/59#issuecomment-6692480951) records the failure and its bounded correction.

Draft [PR #59](https://github.com/appliedai-au/gate_keeper/pull/59) now contains the independently accepted three-file repair at **`d1ba34fa96cfb2bb98b31f3c016772bd46fe3199`**, tree **`6a9334d8ac1176447753479e90040c5e0f98bc55`**. Two files implement and cover the authenticated historical fixed-by marker's observed paired-backtick form while preserving the plain form, exact owner/fix pairing, pinned body, bot identity and ancestry checks. The third amends only the failing test: it preserves the original signed JSON order, proves the original remainder authorization, accepts an authentic consume-only authorization, checks the exact remainder refusal through both verifiers and proves the original status bytes remain unchanged. Production signature verification is unchanged. Independent source review reconstructed the three postimages and full result tree; the other 497 file blobs and modes are unchanged from the 80068789 base. The accepted repair manifest is SHA-256 `ce70c9bb5f90f734efb05b4913136f8deb222decf911f35923237d39611e8636` (5,903 bytes), with patch `fb3f914245d454dd1560bf55945a1a32cb06f8101877663fb95cf3680c3a23e0` (13,039 bytes).

Gitar's [exact-head acknowledgement](https://github.com/appliedai-au/gate_keeper/pull/59#issuecomment-6692491391) at **7 November 05:36:57 AEDT** (`2026-11-06T18:36:57Z`) was followed by the [final dashboard](https://github.com/appliedai-au/gate_keeper/pull/59#issuecomment-6692485286) at **05:37:06 AEDT** (`2026-11-06T18:37:06Z`): **Approved, five closed of five, no open findings**. This is accepted dashboard-mode source review; Gitar functional validation is not enabled. The three native reviews remain historical `COMMENTED` records and are not relabelled as formal current approvals. The acknowledgement's provisional stored verdict is superseded by the later finalized dashboard.

The fresh complete `Dockerfile.reviews-qualify` run is deployment **`230dd9e9-8d00-4601-88ff-b73c21cf1f6e`**, pinned to exact d1ba34fa source. It was created at **7 November 05:38:48.883 AEDT** (`2026-11-06T18:38:48.883Z`) and is **BUILDING in the operator's 7 November 05:49:25 AEDT observation** (`2026-11-06T18:49:25Z`). Logs at **05:39:09–05:39:11 AEDT** (`2026-11-06T18:39:09Z`–`2026-11-06T18:39:11Z`) record nine passing privacy-canary checks, a passing typecheck and five passing scorer checks. The full source suite is in progress; PostgreSQL has not been reached. The complete source suite, real PostgreSQL/Caddy gates, actual terminal result and cleanup must be captured for this changed head. No complete qualification success, PostgreSQL pass or final qualification receipt is claimed at this checkpoint.

**Disposable cleanup is pending.** For the owned qualifier service `5ebe81b4-81e9-47eb-991b-e6ab8d6c5e68`, the prospective supported cleanup is **Remove deployment** followed by observation of the actual result. This may retain an empty service configuration pinned to the reviewed source. Any eventual cleanup record must inventory all remaining owned deployments, establish that no qualifier workload remains and state exactly what configuration is retained; it must not claim service absence from deployment removal. The same 05:49:25 AEDT read still showed historical successful deployment `e2f8632c-0a0b-4bad-8763-062c46062736` active pending replacement, so removing only the failed run would not establish complete cleanup. The prior cleanup request ended without a result, and the subsequent read still showed the service. No successful cleanup or service absence has been observed for this final release. Preserve the failed and successful-run evidence before cleanup and retain the production journals and volumes.

### Current phase matrix — this checkpoint supersedes earlier progress labels

| Phase | Deliverable | Current status | Remaining exit evidence |
| --- | --- | --- | --- |
| P0 | Current-state reconciliation and evidence inventory | Complete for the original experiment | Preserve dated source, deployment and accounting records. |
| P1 | Authentic qualification receipts and disposable cleanup | Complete for original A/B and recovery D/E | Track final PR #59 qualification and actual cleanup separately under P6. |
| P2 | Owner Learning view and real access acceptance | Incomplete | Exact hosted installation/readback and bindings; actual owner, anonymous and authenticated non-owner sessions; published revision and desktop/mobile/error-state acceptance. |
| P3 | Serving authority, initialized host and genuine original BASE | Complete: fourteen original BASE calls verified and settled | Preserve original evidence and unknown pricing; no repeat of BASE. |
| P4 | Exactly ten genuine proposal attempts | Complete on E: ten invalid, no scored/confirmed/activated proposal, original BASE unchanged, twenty-four calls and eleven settlements, no pending work | Preserve the completed result and all original evidence; no further pilot proposal invocation. |
| P5 | Persistence, accounting, privacy, closure and #44 disposition | Partial overall: final original-pilot custody, host/authority agreement, same-E status-only persistence and truthful call/settlement accounting are accepted | Finish protected closure and app access/privacy acceptance, remaining scoped cleanup and independent #44 closeout. Unknown actual prices remain explicitly unknown and alone do not block closeout. |
| P6 | Authenticated live reviews and completed private history | Exact d1 source repair and Gitar review accepted; full qualification BUILDING; C is not yet qualified, merged, deployed or live-accepted | Complete remote gates and cleanup, authentic source receipt and actual C transition, private capsule/owner activation, exact hosted release, ordinary model commissioning, measured delivery latency and genuine private-review/results/history acceptance. |

### Next actions — release and app acceptance

1. Finish the current exact-d1 full qualifier and retain its complete logs, actual test totals, PostgreSQL/Caddy results and terminal deployment state. Resolve any concrete failure through the same bounded source-repair, independent review, Gitar and complete exact-source qualification process. Capture actual scoped cleanup before publishing the final qualification receipt, describing any retained empty service configuration accurately.
2. After those gates pass, publish and pin authentic qualification evidence, verify the actual merge against E with the qualified tree and ordered parents, and record the resulting C identity. Complete the protected authority capsule transfer, host evidence capture and exact owner closure pin/activation using the reviewed path. Keep original A/B/D/E identities, signed receipts, bank/configuration, original failed archives and recovery linkage intact. Deploy the qualified read-only completed-history serving profile only through that concrete transition.
3. Install the permitted hash-pinned Base44 files and server bindings, read them back, and verify the actual owner, anonymous and authenticated non-owner sessions. Accept loading, unavailable, freshness and error behavior at desktop and mobile sizes; measure delivery latency and publish the accepted revision. Source tests and direct transport checks do not satisfy these app-session criteria.
4. Commission the separate ordinary-review provider/model route, dedicated capability and reviewed PostgreSQL schema. Accept a genuine authenticated submission through actual retained findings and private history, same-identity idempotency, refresh/restart recovery and cross-user denial. Retain actual provider/usage evidence and label unknown prices explicitly. This work is separate from the completed learning pilot and adds no replacement pilot attempt.
5. Finish independent accounting, privacy, persistence and closure review and update #44 only when its mandatory app and closeout criteria are met. Report P6 product acceptance separately from P4's all-invalid pilot result. Existing owner authorization covers the remaining scoped implementation and acceptance work; this checkpoint creates no new approval requirement.

The documentation branch remains separate from production. Preparation-only PR #60 and diagnostics PR #63 remain separate records, not dependencies of this final release. Gate Keeper remains the scope; Spekky remains waived. Preserve all earlier source packets, qualifications, failures and plan sections as dated history. The older d92 QUEUED statement is superseded by its recorded failure above, and the earlier locally accepted two-file marker repair is superseded by the published, independently accepted three-file d1 repair. No earlier pending-state instruction authorizes replaying the completed experiment.

## Earlier checkpoint — 7 November 2026, 02:54:17 AEDT (retained verbatim)

**Current update:** 7 November 2026, 02:54:17 AEDT / 6 November 2026, 15:54:17 UTC  
**Owner:** Owen Tyas  
**Repository:** `appliedai-au/gate_keeper`  
**Delivery record:** [issue #44](https://github.com/appliedai-au/gate_keeper/issues/44)  
**Working status:** The original ten-attempt pilot is complete on installed/main E `30e429680f9da8ef8f5307f5fde4ef6bcfa2e70c`. Actual runtime output at **6 November 14:40:18.680 UTC / 7 November 01:40:18.680 AEDT** reports ten genuine attempts, all ten invalid, with zero scored, confirmed or activated proposals. Original BASE is complete and the original/incumbent version is unchanged. The host reports **24 actual calls across 11 settled operations**, no pending controller or dispatch operation, zero pending execution operations and a clean parent exit 0. Actual monetary prices remain unknown. These results are recorded in the [final-pilot reconciliation](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727); the later read-only post-command status agrees.

P0, P1, P3 and P4 are complete for the original experiment. P2 remains pending actual hosted acceptance. P5 has accepted fourth-result recovery persistence, with final ten-outcome custody/persistence, closure evidence and app acceptance still to finish. P6 has substantial draft source, but its current combined release is not yet qualified or live. **#44 remains open.** Ten invalid outcomes establish an honestly completed experiment with no learned promotion; they do not demonstrate a model improvement.

### Current recovery and release checkpoint

- **Original fourth result:** The existing ordinary B settlement was reused. Actual E preparation succeeded without additional model calls; [owner authorization 6684719636](https://github.com/appliedai-au/gate_keeper/pull/62#issuecomment-6684719636) binds the actual qualification/preparation/retained/settlement digests and includes `allowRemainingExperiment:true`. The separate consume completed at 6 November 13:22:10.770 UTC / 7 November 00:22:10.770 AEDT with four invalid outcomes, eighteen calls and exit 0. The [same-source restart check](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6686101812) accepted that exact completed recovery linkage at 13:28:26.073 UTC / 00:28:26.073 AEDT. The ordinary remainder was a later, separately authorized invocation; it has now completed.
- **Actual execution:** Host deployment `bd253e99-9a7f-41dc-9649-a055bd9a153a` contains the completed original remainder. The current [reconciliation record](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727) confirms main and both production services remain E. No new invocation, repeated fourth call or replacement experiment was made by that reconciliation.
- **App/history source:** Draft [PR #59](https://github.com/appliedai-au/gate_keeper/pull/59) is at `a252599e422b885345a49b2ed11347c1e6439f73`. Its historical qualifier `e2f8632c-0a0b-4bad-8763-062c46062736` passed 1,098/1,098 source tests and 15/15 real PostgreSQL tests, with canary, typecheck, scorer and Caddy gates, for earlier head `94540e00dbb18d7e878d7a386df33fb56fc14792`. That result does **not** qualify the current head. The accepted complete private/public history-v2 packet remains unpublished; reconciliation with actual E, current review findings and final combined-source qualification are pending. Earlier accepted manifests and test runs remain historical inputs.
- **Diagnostics source:** [PR #63](https://github.com/appliedai-au/gate_keeper/pull/63) is still draft/unmerged at `952618474ae2b72ba578a236d14d96a24582150e`. Its isolated 1,063/1,063 source tests, nine canary checks, typecheck, five scorer checks, Gitar approval and observed qualifier cleanup establish source qualification. Its application diagnostics/bootstrap correction is **not installed** in production.
- **Operational ownership:** [PR #60's coordination acknowledgement](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6678541106) and [completion record](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6678637906) leave the existing operational repair with the sole closeout operator and impose no extra approval or coordination hold. PR #60 remains separate and is not a release dependency. Existing owner instructions cover the remaining scoped implementation and acceptance work; no new approval checkpoint is created here.

### Current source identities

| Role | Actual identity | Meaning and evidence |
| --- | --- | --- |
| Frozen definition A | `a35c83ccb2e3743c4d4f3b9ae13406507dfd297a` | Original experiment, configuration and trust binding; retained unchanged. |
| Historical execution B | `45ed2b6ef74f53a0940329066d0fe126ad87a7fa` | Original BASE continuation and first four proposal dispatches; authentic ordinary fourth settlement. |
| Recovery predecessor D | `3e5b8bd07119b477a5abe2b9f061082e4735390e` | [PR #61](https://github.com/appliedai-au/gate_keeper/pull/61) merged after the revised 709/709 qualification; its exact source/proof remains predecessor evidence. |
| Installed final execution E | `30e429680f9da8ef8f5307f5fde4ef6bcfa2e70c` | [PR #62](https://github.com/appliedai-au/gate_keeper/pull/62) successor, tree `601efb446e0f7aeab2276d851abb7d377703e0d1`; [1,030/1,030 qualification and cleanup receipt](https://github.com/appliedai-au/gate_keeper/pull/62#issuecomment-6682365828). Actual recovery and remaining pilot executed on E. |
| Future completed-history serving C | No actual merged/deployed C identity yet | PR #59 is draft. Final integration must preserve A/B/D/E evidence and identify its own actual qualified serving source without relabelling historical execution. |

Keep main and the retained production evidence on E until the concrete completed-history transition passes its source, closure and operational gates. The documentation branch stays isolated: updating this plan does not authorize deploying it, silently replacing create-once source evidence or repeating the completed pilot. Final ten-outcome persistence and private custody are P5 acceptance work; the successful four-outcome restart is not substituted for them.

## Historical opening checkpoint — as of 6 November 2026, 17:12 AEDT / 06:12 UTC

The following opening metadata and checkpoints are retained verbatim as historical evidence. Their statements about B being current, D being unqualified, the fourth result being held or an earlier C qualifier still running describe that recorded time. The current checkpoint above and current phase matrix below supersede them for action.

**Prepared:** 6 November 2026, Australia/Melbourne  
**Updated:** 6 November 2026, 17:12 AEDT / 06:12 UTC; latest host status is 16:55:06.708 AEDT / 05:55:06.708 UTC  
**Owner:** Owen Tyas  
**Repository:** `appliedai-au/gate_keeper`  
**Primary delivery record:** [issue #44](https://github.com/appliedai-au/gate_keeper/issues/44)  
**Working status:** P0 and P1 are complete; qualified implementation B remains current main. The original BASE completed at 16:11:27.884 AEDT / 05:11:27.884 UTC with fourteen verified calls and no repeat of the first paid call. A subsequent host deployment, whose initiating action is not established by the available records, left proposal four held after three invalid proposals. The original fourth provider turn and full event inventory are now independently verified, and its existing ordinary B settlement succeeded at 16:47:01.960 AEDT / 05:47:01.960 UTC. **The authority accounts for all eighteen actual model calls and four invalid proposals; the host still shows 4/10 attempted, three invalid and the fourth pending.** All actual billed prices remain unknown. The next-start host command is `status`; no fifth attempt has been dispatched.

Independent verification of the original host capture and the post-settlement authority capture is complete. Every retained journal chain, authority delta/state digest, referenced artifact, original admission and settlement signature was checked. The original operation archive still records its unresolved read failure and has no final result artifact; that history remains intact. A separate, B-derived implementation D is being authored to add a later independent observation, consume that exact existing invalid result and reuse its authentic settlement without another model call. D has not been qualified, merged or deployed. Its recovery command must stop after the fourth result; remainder execution is a separate invocation under an explicit signed purpose.

PR #59 now contains the accepted private review/history source plus the browser-clock repair at `2776c09b8c45fa44e28f494732b052f139434513`. Gitar approved that exact head with three closed findings and no open findings. Its complete isolated PostgreSQL/Caddy qualification is running. The Base44 redirect compatibility delta remains uninstalled. C still needs an explicit A/B/D/C provenance amendment after D is settled; its existing B-only archive cannot describe the later D recovery.

### Current review, settlement and qualification checkpoint — 17:12 AEDT / 06:12 UTC

- **Original evidence and settlement:** Read-only captures preserved unchanged host heads and the post-settlement authority head. Independent review reconstructed all 143 authority ledger deltas and verified all 66 content-addressed artifacts. The authority has five ordinary settled operations accounting for eighteen calls, no active or ambiguous call, no unverified call, no fifth proposal and no promotion. Host and authority counts are intentionally reported separately until qualified recovery consumes the fourth result.
- **Preserved failure:** The host's fourth-operation archive has five records ending in a `turn-read` unresolved failure after three running observations. It retains no original exception cause. The original provider turn was already complete; the entire output fails the unchanged strict proposal parser. The successful ordinary settlement does not rewrite the host archive or prove the exact cause of the earlier read failure. The overlapping authority deployment is not claimed as a proven cause.
- **D recovery:** Its source-only implementation and adversarial review are in progress. The host prepares its own exact checkpoint through the existing authenticated authority RPC. The authority independently reads the owned provider turn and complete inventory and compares the original B admission/settlement. There is no model create/POST, new admission or new settlement in the recovery path. Separate D qualification/preparation/owner records preserve all original A/B proofs. A mandatory additive observation link precedes controller consumption; crash/reopen checks must reject missing links, changed original failure bytes and unsupported journal suffixes.
- **C review:** Complete published tree `1844f46307629fc2aeeb85cbcdb32ec0ab67e62f` contains all 479 verified file blobs and modes. Fresh Gitar request [6678132932](https://github.com/appliedai-au/gate_keeper/pull/59#issuecomment-6678132932) received exact-head acknowledgement [6678145312](https://github.com/appliedai-au/gate_keeper/pull/59#issuecomment-6678145312). Final dashboard [6678138516](https://github.com/appliedai-au/gate_keeper/pull/59#issuecomment-6678138516), updated at 16:59:48 AEDT / 05:59:48 UTC, is Approved, three closed / three findings. The three native review submissions are historically `COMMENTED`, not formal `APPROVED` reviews; no current-head changes request was present in the retrieved inventory.
- **C qualification:** Deployment `b9cc9eef-18e0-4c0b-bb16-5618ee3e6d5c` on disposable service `5ebe81b4-81e9-47eb-991b-e6ab8d6c5e68` is pinned to the exact reviewed head and remains BUILDING. Its preflight verified no variables, mounted volumes, domains, TCP proxies or staged changes. Observed runtime versions are Node 24.19.0, TrueForge 0.182.0, SDK 0.180.0 and pg 8.23.1. The nine privacy-canary tests, typecheck and five scorer self-tests passed. The full source suite is running with buffered output; real PostgreSQL qualification follows it. No full-suite or deployment success is claimed yet.

The private evidence package is retained separately from public Git history: 3,136,809 bytes, SHA-256 `5e222beb73a1a146e46176bb159a92f81eb137d499bccc05348cbc72b5a3c40e`. It contains the two original custody captures, signed fourth settlement and a provenance manifest, without credentials or signing keys. The original bank digest remains unchanged.

### Historical review and custody checkpoint — 16:45 AEDT / 05:45 UTC

The exact published PR #59 composition at `0f127944d20a47907e4e0a21a6d4d56352c988d7`, tree `3dbafd33f2435e2d4456bfbb16b13cdf63f4c7d9`, has now passed independent complete-tree review. Fresh Gitar request [6677920827](https://github.com/appliedai-au/gate_keeper/pull/59#issuecomment-6677920827) names that exact head. Gitar acknowledged it and requested one additional repair: a skewed browser clock must not reject a history response already verified for freshness by the server. The bounded UI repair is in progress; server freshness enforcement remains mandatory. Full combined remote qualification remains pending.

Independent examination of the captured controller, dispatch and held-operation journals verified every canonical record, predecessor hash, sequential filename and head checkpoint. The original admission signature, request, call, session, turn and input match the separately retrieved terminal provider result. The host still has no final result or disposition artifact and remains unconsumed/unsettled. Its retained failure is at `turn-read` after three running observations; it retains no original exception cause, so the precise transport/restart cause is not established. This verified evidence supports designing a qualified original-result recovery, without overwriting the terminal failure or repeating inference. No recovery, fourth-call settlement or completed pilot is claimed by this checkpoint.

## 1. Intended outcome and scope

**As-of note:** This original scope and its standing owner constraints remain in force. Descriptions below of missing source or an unfinished pilot are historical as of 6 November 06:12 UTC; the pilot is now complete and P6 source exists in draft, with actual app/review acceptance still pending.

Finish the owner Learning view and protected learning pilot in the existing Gate Keeper app. The existing host must execute a genuine, bounded ten-attempt experiment on the concurrency/atomicity fault family; retain successful, unsuccessful and unresolved outcomes; carry retained learning into later proposals; and expose truthful, owner-only status in the existing Base44 app. Any promoted rule must pass the existing independent evaluation, three fresh confirmation pairs and separate activation boundary. An honestly measured all-negative result is an acceptable experimental outcome.

**Product boundary:** P0–P5 commission owner-only Learning and the protected pilot. The public live-review submission flow is still a demonstration: no qualified submission backend function exists. Completing the pilot and connecting its status does not make the public review workflow operational. P6 below specifies the separate implementation and live acceptance needed before that claim can be made.

P0–P5 close the protected-learning operational work in #44. They do not promise that the model will improve, establish generalization from development fixtures, or commission a general autonomous code-writing service. [Draft PR #42](https://github.com/appliedai-au/gate_keeper/pull/42), “Gate Keeper rule bag, heuristics, fingerprints and response cache,” is a separate optional backlog item. Do not merge it or introduce its experimental arms, cache changes or heuristics into the frozen pilot to achieve this closeout. That PR is also not a substitute for P6's missing authenticated submission workflow.

Owen's current instruction is to prepare the phase plan and implement it. Existing closeout authorization covers the necessary Gate Keeper-scoped configuration, reversible deployments, protected identities, qualified source repairs, app integration, real inference and final reporting. Do not introduce another approval checkpoint for those already-authorized actions. If an actual platform authentication or automatic approval restriction prevents a specific operation, report that exact restriction and continue independent authorized work. The old request for renewed deletion confirmation is not a new requirement under the current instruction.

Two settled owner decisions remain in force:

- **No aggregate programme spending cap.** Maintain actual calls, known charges, estimates and outstanding prices distinctly for each operation. Unknown cost is not zero and is not an execution ceiling.
- **Spekky is waived for Gate Keeper.** If a source repair is needed, use independent adversarial review → Gitar → repair/re-review → complete isolated Railway qualification → merge → deploy → live acceptance. Do not add another application's gate or implementation work to this scope.

## 2. Starting evidence and immutable identities

**As-of note:** The entire starting table below is preserved unchanged. Its deployment, main-B and zero-attempt statements are historical; current installed/final execution is E and the actual ten-attempt completion is recorded above. Original A/configuration/bank identities remain evidence to preserve and verify in final custody.

The starting record is the [verified execution update on #44](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6664862988), published at 17:35 UTC on 5 November / 04:35 AEDT on 6 November. The table below retains those original identities. Frozen definition A remains unchanged; current main and the qualified implementation are now B under the separately reviewed PR #58 transition described below. Recheck affected live records before subsequent mutations.

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
| Plan publication | [Draft PR #57](https://github.com/appliedai-au/gate_keeper/pull/57), isolated branch `work/gatekeeper-closeout-phase-plan-20261106`; current main B must remain unchanged through the original pilot |

The two raw qualification captures are separate retained artifacts. Preserve the original byte count/digest as historical provenance; identify the actual capture used by the new receipt rather than relabeling either artifact as the other.

The imported legacy bank is an immutable historical input: revision 65; original groups **0 accepted / 35 harmful / 18 unproven / 47 history**. Its source-file digest is `2f679a49712b9dbefc992c03a1437ec9dff7e2f989b90bcb130aa3a4dc42b7ab`; its complete projection digest is `549a00b379e7819cd6b0ea1141f58d4ded306cb1a41c7909de186ee531f568f2`. The normalized view contains 100 procedure references, 66 rejected and 34 unproven, plus one non-procedure historical record. These are different representations of the same history, not contradictory counts. They are not new signed promotions or new-pilot attempts.

### Preserve the frozen source while publishing this plan

**Current application of this rule:** Preserve installed E and its actual successor proof, including historical B/D facts, until the completed-history transition is concretely qualified and accepted. Keep PR #57 isolated. The B-specific operational language that follows is the earlier 6 November 06:12 UTC checkpoint, not a direction to roll back or relabel E.

The authority’s implementation source proof checks current `main`, the actual deployed B source, two ordered merge parents and the qualified tree, while preserving frozen A. This plan is published through [draft PR #57](https://github.com/appliedai-au/gate_keeper/pull/57) on `work/gatekeeper-closeout-phase-plan-20261106`. **Keep that documentation branch isolated; do not merge it or the P6 candidate into `main` before the original pilot is durably complete.** B authority restarts and protected decisions still require current main B. Do not deploy the documentation branch, modify the frozen bundle, or relabel actual C as B. Update the ledger in #44 and on this documentation branch.

Keep the existing production host, authority service, volumes, app and controller ownership. Do not create a second learning coordinator or copy provider credentials into the host or Base44 app.

## 3. Roles and execution order

### Current phase matrix — 7 November 2026 AEDT

| Phase | Deliverable | Current status | Remaining exit evidence |
| --- | --- | --- | --- |
| P0 | Current-state reconciliation and evidence inventory | Complete; the original remainder's actual terminal result has been reconciled | Preserve the dated source/deployment/accounting evidence. |
| P1 | Authentic qualification receipts and disposable cleanup | Complete for original A/B and recovery D/E releases | Track the separate final PR #59 qualifier and its actual cleanup under P6. |
| P2 | Owner Learning view and real access acceptance | Incomplete; hosted compatibility/history release and actual app-session acceptance remain outstanding | Exact installed variants and bindings, real owner/anonymous/non-owner results, published revision and desktop/mobile/error-state checks. |
| P3 | Serving authority, initialized host and genuine original BASE | Complete; fourteen original BASE calls verified and settled | Retain original evidence and unknown pricing; no repeated BASE call. |
| P4 | Exactly ten genuine proposal attempts | Complete on E: ten invalid, zero scored/confirmed/activated; BASE unchanged; twenty-four calls across eleven settled operations; no pending work | Retain concrete per-attempt custody and final acceptance through P5; no additional proposal invocation. |
| P5 | Persistence, accounting, privacy, closure and #44 disposition | Partial: original fourth-result recovery/restart accepted; completed-pilot custody and app closeout continue | Final ten-outcome host/authority agreement, persistence, private closure evidence, accounting/privacy review and remaining cleanup. |
| P6 | Authenticated live reviews and completed private history | Draft implementation; current PR #59 head is not qualified or deployed | Accepted v2/E integration, exact-head review/full PostgreSQL-Caddy qualification, actual C source/closure, review commissioning and genuine owner workflow. |

### Current next actions — completed pilot to app acceptance

1. Record and retain the terminal ten-attempt result from [6689009727](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727). Establish final quiescence and the supported status-only next-start configuration before any controlled same-E restart. Verify the complete final host and authority custody, original failed fourth archive, later-observation linkage, bank/configuration/trust identities and eleven settled operations. The completed pilot needs no additional inference.
2. Accept the final ten-outcome persistence state and concrete closure inputs. The 13:28 UTC restart proved the four-outcome recovery state; obtain evidence for the final completed state without rewriting historical journals or substituting a fresh experiment. Keep actual calls, verified charges, SDK estimates and unknown prices distinct. Unknown pricing alone does not block operational closeout.
3. Reconcile the accepted private/public history-v2 packet with current PR #59 and actual E, close concrete review findings, and verify the complete composed tree. Obtain fresh independent/Gitar acceptance and the full isolated exact-source qualification, including real PostgreSQL and Caddy. Preserve earlier failures and qualifications as dated records; observe actual disposable cleanup before final receipt publication.
4. Complete the actual C source and closure transition using authentic final host/authority evidence, supported authenticated private staging, the exact owner closure pin and the qualified read-only serving profile. Preserve A/B/D/E identities, original receipts and recovery linkage. A future C SHA must come from the actual qualified merge and deployment.
5. Install only the permitted hash-pinned Base44 files and server bindings, read them back, and accept actual owner, anonymous and authenticated non-owner access plus loading/unavailable/freshness behavior at desktop/mobile sizes. Publish the accepted revision. These checks remain separate from backend source tests and direct proxy transport checks.
6. Commission the distinct ordinary-review route, dedicated review capability and reviewed PostgreSQL schema. Accept a genuine authenticated submission through retained findings and private history, idempotent recovery/refresh and cross-user denial. Retain real provider/usage evidence. Finish independent closeout review and update #44 only after its mandatory app/persistence/privacy criteria pass; report P6 separately from the all-invalid pilot outcome.

### Historical roles and phase matrix — as of 6 November 2026, 17:12 AEDT / 06:12 UTC

The matrix and immediate actions below are retained unchanged as the earlier plan. They are superseded by the current phase matrix and next actions above; their held-fourth and pending-D instructions are not current dispatch instructions.

The existing closeout lead owns reconciliation, operational changes and the evidence ledger. An independent reviewer checks any new source repair and final acceptance. The semantic reviewer identified in the frozen authority configuration owns actual novelty/applicability decisions; the proposing model does not approve its own rule.

| Phase | Deliverable | Current status | Depends on |
| --- | --- | --- | --- |
| P0 | Current-state reconciliation and complete evidence inventory | Complete; fresh `main`/deployment reads reconciled | Existing access |
| P1 | Verified disposable cleanup and authentic source-qualification receipt | Complete; immutable PR #56 receipt accepted by actual source-gate RPC | P0 |
| P2 | Updated Base44 bridge, scoped bindings and real access acceptance | Owner and all four bindings verified; actual diagnostic fetch fails on workerd's unsupported `redirect: error`; accepted compatibility delta not installed | Exact-source qualification, permitted installation/readback and actual app-session acceptance after the runtime hold |
| P3 | Serving authority, registered provider, initialized host and genuine BASE execution | Complete: B qualified/merged, signed prepare and owner authorization verified, original BASE complete with fourteen calls and unknown prices | Preserve original A/B proof and BASE evidence |
| P4 | Exactly ten genuine proposal attempts with retained outcomes and qualified promotions, if any | Host held at 4/10 attempted: three invalid and fourth pending; authority has four invalid and all eighteen calls ordinarily settled | Qualify D, consume the exact original fourth result without re-dispatch or placeholder classification, then separately continue the remaining six attempts |
| P5 | Restart, accounting, privacy, final evidence and #44 disposition | Pending; next-start command is `status`; runtime mutation held | P2, full P4 settlement/closure and evidence recovery |
| P6 | Authenticated live-review submission, real results and private run history | Combined draft PR #59 head `2776c09…` independently accepted and Gitar approved; exact full isolated qualification running; no main merge or production deployment | Full real-PostgreSQL/Caddy qualification, explicit D provenance amendment and final exact-source gates; original pilot closure before C commissioning |

P2's final app-session checks can now use the initialized host. The seven successful scoped HTTP checks establish transport authorization, not Base44 owner/non-owner session behavior. If browser access is unavailable, advance independent backend work; full #44 closure still requires actual app acceptance.

### Current next actions

**Historical as of 6 November 2026, 17:12 AEDT / 06:12 UTC.** These were the then-current actions. Recovery and the separate whole remainder are now complete; use the current next actions above for all further work.

1. Preserve main B, the original journals, all historical qualification and BASE-continuation records, the authentic fourth settlement and the next-start `status` command. D must be fully source reviewed, Gitar reviewed and remotely qualified before any source transition or host recovery. No fifth call, generic recovery, placeholder outcome, archive overwrite or repeated paid call is authorized by the evidence-capture step.
2. Complete the narrowly bounded D implementation. Its preparation verifies the exact original host checkpoint and ordinary B settlement against independent provider reads. Require a distinct actual-D qualification and owner authorization, preserve B history, durably link the additive observation before consuming the fourth invalid result, then stop. Verify restart and identical replay, original archive bytes, four genuine invalid results, no pending operation and unchanged eighteen-call count before any remainder invocation.
3. Finish the exact C qualification already running; capture actual test totals, failures if any and terminal deployment state. Repair any concrete failure through the same independent review/Gitar gate. Later evolve its closure and public history explicitly to A/B/D/C rather than treating D as B. An earlier approved or qualified C head does not qualify changed source.
4. After D recovery acceptance, invoke the separately authorized remainder of the original pilot. Retain all original attempts and accounting; reach ten genuine settled outcomes, with independent novelty, evaluation, confirmation and activation evidence for any candidate that reaches those gates. No improved rule or promotion is promised.
5. Finish C source gates for the actual closed history, export and pin the retained private closure, install only the permitted hash-pinned Base44 variants, and verify actual owner, anonymous and non-owner access. Commission the distinct authenticated review flow with a real result and private run history. Finish restart/accounting/privacy acceptance, disposable cleanup, phase results and #44 disposition.

The bounded D transition is the explicit exception to keeping main B while this original pilot remains open. It is permitted only after its concrete source/qualification/owner evidence exists; C and the documentation branch remain isolated until their own completion conditions are met. No approval or D identity is invented in advance.

## P0 — Reconcile before dispatch

**Current status:** Complete for the latest reconciliation. Any dispatch/recovery instructions below are retained as of the original 6 November checkpoint; the ten-attempt pilot has now completed and further work concerns evidence and app acceptance.

**Status:** Initial reconciliation is complete. Preserve that evidence; the unexplained subsequent deployment now requires a focused read-only provenance and pending-operation reconciliation. Current `main` remains qualified B.

**Action.** Read current GitHub `main`, #44 and the distinct PR #56/A and PR #58/B qualification records. Read current Railway deployment/configuration state for the existing host, Proxy and authority, including any in-flight or staged changes. Inspect protected operation status before starting, restarting or replacing a process. Reconcile already-dispatched work without assuming its actor; do not start a duplicate run.

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

**Current status:** Original commissioning/source prerequisites and A/B/D/E qualification cleanup are complete. Preserve their receipts. Final PR #59 qualification and cleanup remain a distinct P6 gate. The commissioning detail below is the retained earlier checkpoint.

**Action.** Preserve and verify the complete existing successful qualification evidence. Do not rerun the full suite merely because time passed when the exact source and receipt still match.

**Status:** Complete. Actual cleanup, immutable PR #56 receipt and accepted source-gate evidence are identified in section 2. The original and fresh raw captures remain separate retained artifacts.

Completed cleanup scope:

- Project `963f87a2-3e3c-4cc0-a92a-f96f010ac73e`.
- Environment `eb286452-9989-451b-9254-0832cb803957`.
- Service `730fa701-cc2e-4246-9c86-c55586e3dde1`.

Retain the actual absence readback and do not recreate this service. No additional project, unrelated service or production journal deletion is part of this cleanup. A queued, canceled or failed delete would not have been sufficient; the observed absence is the accepted evidence.

**Receipt handling.** [PR #56 comment 6675649613](https://github.com/appliedai-au/gate_keeper/pull/56#issuecomment-6675649613) is the immutable `GK_AUTHORITY_QUALIFICATION` receipt, using the schema in the [commissioning document](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/detached-authority-commissioning.md). The authoritative receipt belongs on PR #56, not issue #44; #44 can link it. Never edit the pinned comment. Keep its source, qualification, cleanup and Gitar identities distinct from subsequent runtime results. Preserve native review states accurately; `COMMENTED` is not `APPROVED`.

The original source-gate RPC accepted the pinned receipt and returned its authentic signed gate evidence. Maintain the exact receipt body, real comment/author bindings, ordered merge parents `[a546ad56321b2080f7b0a6dfbebe00667259173b, 7b99341226a06388276fd540b98d6db4891dec4b]` and tested/merged tree equality as historical A proof. The initial A-only main binding has since transitioned through the qualified B implementation/continuation proof; current main must remain B while the original pilot is open. The original source gate alone did not establish live model execution.

**Exit evidence.** Cleanup is observed, the complete qualification receipt is authentic and retrievable, and all proof fields bind the existing qualified source. Synthetic receipts, placeholder IDs, unverified cleanup or an old review of a different head do not qualify.

**Recovery.** If cleanup or proof verification fails, keep the authority non-dispatching and fix that concrete discrepancy. Existing host status, app preparation and evidence review can continue. Recreate a disposable qualifier only if a specific new source repair requires qualification; never as a substitute for deleting the old one truthfully.

## P2 — Connect the existing Base44 Learning view

**Current status — 7 November AEDT:** Actual hosted owner/non-owner acceptance remains incomplete. Integrate the final qualified history/compatibility source appropriate to the accepted C closure, then perform exact installation/readback and real app-session checks. The installed-source observations and status paragraph below are historical as of 6 November 06:12 UTC.

**Status:** The configured owner is authenticated with role `admin`; owner/body checks pass and all four scoped bindings are installed. The actual qualified diagnostic invocation at 15:57:36.668 AEDT / 04:57:36.668 UTC returned 503 after four nonempty-secret observations, `FETCH_BEGIN` and `FETCH_ERROR` classified `unsupported-option`. Read-only inspection identified workerd in the installed Base44 runtime. Its documented unsupported `redirect: error` option is present in the existing bridge; `cache: no-store` remains supported. The separately accepted hosted-only compatibility delta is not installed. The UI truthfully displays no figures, and owner-success/non-owner app-session acceptance remain outstanding.

**Accepted compatibility source.** Manifest SHA-256 `029b91ecea93a21a7bf5fc9aa13576eafb0fd6f632c7ff3ba63c618f6d50a611`; patch SHA-256 `e805bfa44a83b79c69728eec33f3caa2bb9861900b8f412afd9e73c6bb2f8cb6` (59,667 bytes). Independent review verified all twenty supplied identities, seventeen accepted baselines, twelve changed paths, nine import mappings and eighteen exact hosted variants. Only the three hosted adapters translate the explicit error policy to manual and reject every 3xx/already-redirected response before headers/body use; portable backends are byte-identical. The installation manifest permits only its exact import rewrites and optional removal of one terminal LF byte. No follow, retry, arbitrary whitespace normalization or editor-policy bypass is allowed. Source acceptance is separate from combined qualification and actual hosted success.

**Historical installed checkpoint.** The starting app revision was `626e72166f0e0356855e67550c3158e3b445a145`. The builder reported exactly three tracked file changes and a clean remote Vite build. Backend SHA-256 at that checkpoint was `de9e1fd110a1fa1cd7f874bef82e981eedc7241897f1a6f84a6167c8ba7d846d`; both contract copies were identical at `ec17f8eff89a8054b171e1c3818b03c7083539749be1101e7dc4464610338125`. Their logic matched frozen qualified source A, with the documented import/provenance adaptation. Backend deployment ID `68085da97714459499006b9f74af4028` was observed; it is not a published frontend revision. The later installed diagnostic adapter uses the established SDK 0.8.54/default-export/`secrets.get` convention. Its observed import-adapted bytes are pinned by the compatibility manifest, including the permitted one-LF omission. No frontend publication or compatibility installation is claimed.

**Next integration step, after the hold and source gates.** Retain the current app/source/settings checkpoint. Apply only the reviewed hosted compatibility files and exact import adaptations appropriate to the active Learning profile, using permitted editor writes and complete byte/hash readback. The existing four bindings remain installed. The later completed-history function requires the separate C profile, closure and additional provenance pins; do not switch it on for the partial pilot. Do not deploy both backend variants or bulk-sync the sparse integration tree.

Preserve these four existing server-side bindings through the protected app settings:

- `GATEKEEPER_LEARNING_OWNER_ID`: the server-verified owner matching the frozen authority binding.
- `GATEKEEPER_LEARNING_EXPERIMENT_ID`: `gk-v4-concurrency-20261105`.
- `GATEKEEPER_LEARNING_SOURCE_COMMIT`: `a35c83ccb2e3743c4d4f3b9ae13406507dfd297a`.
- `GATEKEEPER_LEARNING_READ_TOKEN`: the actual separate, scoped owner-status capability, distinct from the authority driver credential.

The fixed upstream is `https://proxy-production-9553.up.railway.app/gatekeeper/learning-v3/status`. The browser must not select arbitrary owner, experiment, source or upstream URL. It receives neither upstream tokens nor general Proxy credentials. Preserve ordinary TrueForge Basic Auth, existing app entities, unrelated functions and auth routes.

**Live acceptance.** After the current runtime hold clears, the exact compatibility source passes its gates and the permitted installed files match their manifest, verify the existing app against the retained real host journal and publish the accepted revision. Retain actual results:

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

**Current status — 7 November AEDT:** Original BASE remains complete with fourteen genuine calls. Actual installed/final execution is E, preserving historical A/B and recovery-predecessor D evidence. Initialization, BASE continuation and the later whole pilot have finished. The B-specific runtime/hold wording below is retained as of 6 November 06:12 UTC, not a direction to initialize or repeat execution.

**Status:** Complete for the original BASE. B is merged and qualified with 670/670 full tests, 9/9 canary, typecheck and five scorer checks. Signed prepare evidence was verified, followed by the exact owner continuation authorization in [PR #58 comment 6677415111](https://github.com/appliedai-au/gate_keeper/pull/58#issuecomment-6677415111). BASE completed at 16:11:27.884 AEDT / 05:11:27.884 UTC with fourteen verified calls and unknown actual prices. The first paid call was not repeated. The earlier pagination hold is retained in the historical table; it is no longer the current P3 action. The separate fourth-proposal hold belongs to P4.

**Authority.** Preserve the existing custody, identities, relay prefix, bank projection and frozen bundle. Maintain `Dockerfile.authority`, explicit start command `node /app/scripts/learning-v2/authority-service.mjs`, and `GK_AUTHORITY_MODE=serve` with the verified source proof. Do not execute the old legacy boot or reinitialize custody.

The one-shot provider-registration flag has been cleared using the supported no-deploy variable update. Keep it cleared on subsequent starts and verify the existing scoped route rather than registering another provider. Keep authorized provider credentials on the authority service. Maintain actual backend-version/model/relay checks and only `/healthz` public without authentication. Registration and bootstrap success remain zero-inference readiness evidence, not a model smoke result.

**Host.** Initialization has completed against the verified small bootstrap descriptor and frozen public pins. Keep the production driver limited to its scoped bearer credential and separate read token. Retain `GK_V2_HOST_BOOTSTRAP=enabled`, `GK_V3_HTTP_ROUTER=enabled` and `GK_V3_READONLY_STATUS=enabled`. Preserve the installed `GK_PRODUCTION_BOOTSTRAP_B64` configuration without also setting its full alternative. Preserve UID 1000, private directory mode 0700 and private file mode 0600.

The experiment exists; do not initialize again or replace its journal. The all-zero initialization is a historical checkpoint. Current next-start configuration is `status`, with no further runtime mutation pending original-evidence recovery. Any later authorized command/configuration change must retain frozen definition A, actual implementation B and the current configuration rather than reuse a historical deployment's command snapshot. Observe terminal deployment status and actual driver evidence after each change.

**Completed BASE and continuation boundary.** B's separately qualified `prepare-baseline` and `continue-baseline` path preserved the original paid result and completed the remaining slots under the signed authorization. The explicit continuation exited successfully; it did not justify a subsequent untracked `run` deployment. Retain fourteen-call BASE settlement as completed evidence. The later unexplained deployment and four proposal dispatches are separately recorded in the incident ledger. Do not repeat BASE, add a smoke call or start a new attempt to conceal the current gap.

Verify actual owned SDK session/turn and outbound call observations, complete two-pass coverage, independent evaluation/settlement evidence and the frozen model/runtime identity. Distinguish submitted intent, an HTTP response, complete model output and settled evidence. A backend health response or an initialized journal alone proves none of those execution results.

**Exit evidence.** Authority serving and model route are verified; the host is bound to the existing experiment; owner-status read works against the initialized state; original BASE evidence is genuine and complete; every incurred call belongs to a retained operation. If the driver pauses at the first proposal, carry that exact operation into P4. Record its attempt count immediately.

**Recovery.** On ambiguous execution, stop new dispatch and inspect protected state. Reconcile the original operation using actual terminal provider artifacts. Never retry an unresolved session/turn intent, change source/configuration/keys midway, or claim zero usage because a response was lost.

## P4 — Complete exactly ten genuine learning attempts

**Current status — COMPLETE:** The existing remainder finished on E at 6 November 14:40:18.680 UTC / 7 November 01:40:18.680 AEDT. Ten genuine proposals are invalid; zero are scored, confirmed or activated. BASE is unchanged, all eleven execution operations are settled, twenty-four calls have unknown actual prices, no operation is pending and the parent exited 0. [Actual completion evidence](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727). Final custody/persistence and app acceptance remain P5/P2 work.

**Historical P4 checkpoint — as of 6 November 2026, 17:12 AEDT / 06:12 UTC:** The held state, recovery assessment and per-attempt procedure below are preserved as the original plan. They do not direct another run, repeated fourth result or replacement proposal after the completed original pilot.

**Status:** Held. At 16:29:41.206 AEDT / 05:29:41.206 UTC the public projection records four attempted, three invalid and one pending. Three proposals have genuine settled invalid outcomes. The fourth provider turn reached done/stop at 16:15:53.901 AEDT / 05:15:53.901 UTC, but host consumption and settlement remain unresolved. The seventeen settled calls comprise fourteen BASE plus three proposals, all with unknown prices; the fourth proposal makes eighteen actual dispatches. These are distinct execution/accounting facts, not a ten-attempt completion claim.

The subsequent host deployment's creation is unexplained by the visible task history. An authority restart for status export overlapped the fourth proposal; that timing does not establish causation or another actor. Preserve the evidence and resolve the original operation before applying the continuation procedure below.

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

**Recovery.** Use the existing `reconcile-operation` path only for independently established failed execution or already-consumed evidence needing settlement. It cannot consume the original invalid proposal if that result has not already been consumed. Authenticated read-only custody capture is now complete: the held archive contains session, turn and failure records with code `TRUEFORGE_CALL_UNRESOLVED`, but no final result/artifact. Independent chain and provider-binding verification are still in progress. Preserve the original evidence while the bounded recovery design is assessed. A terminal charged call must not be replaced with a failed placeholder, and a pending semantic review cannot be erased as a failed call. Any necessary D repair must retain B proof and establish explicit recovery linkage; the current C reader's sole historical-execution-B contract cannot silently represent B-to-D execution. No D source change, host recovery or additional model call is claimed. If a confirmed version must be rolled back, use a valid rollback authorization for an eligible prior version and retain the history; do not edit the journal.

## P5 — Verify persistence, accounting, privacy and final closeout

**Current status — PARTIAL:** The original fourth-result recovery and its 13:28 UTC same-E restart are accepted. The later whole pilot is complete. Final ten-outcome host/authority custody comparison, persistence/closure acceptance, privacy/accounting evidence, hosted access acceptance and remaining cleanup are still open. The pending-fourth status below is historical as of 6 November 06:12 UTC; the acceptance requirements that follow remain relevant to the final completed state.

**Status:** Pending. The configured next-start command is already `status`; this does not prove that the held fourth proposal is consumed or settled. Further restarts and runtime mutations remain on hold until original-evidence recovery and closure eligibility are established.

Keep `GK_PRODUCTION_COMMAND=status` after completion and remove operation-specific command variables when authorized recovery and closure permit. Check no provider call is active before controlled restarts. Capture protected host/authority projections, restart/reopen the existing services against the same source and volumes, and verify unchanged experiment/configuration identities, bank history, active version, ten-attempt disposition and operation/receipt identities. The restart must not create an additional proposal, provider call or activation.

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

**Current status — draft integration and release gates pending:** PR #59 head `a252599e422b885345a49b2ed11347c1e6439f73` is not qualified by the successful earlier `94540e00dbb18d7e878d7a386df33fb56fc14792` run. That historical run passed 1,098 source tests and fifteen real PostgreSQL tests plus the inherited gates. The accepted complete private/public history-v2 packet remains unpublished and must be reconciled with actual E and current review findings before new exact-source acceptance. No completed-history C serving or genuine owner-review acceptance is claimed. [Current release checkpoint](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727).

**Historical P6 source/specification checkpoint — as of 6 November 2026, 17:12 AEDT / 06:12 UTC:** Earlier C hashes, B-only provenance and then-pending qualifications below remain unchanged as history. Preserve their source packets; final integration must bind actual A/B/D/E history and the future qualified serving C. The product acceptance requirements remain in force.

**Current implementation checkpoint.** The thirty-six-path completed-history/product overlay is independently source accepted: manifest SHA-256 `2ed328acf02d7bec99b9ee6e520e656c39a025517e9530ec19c51a12f6bce2a4` (18,250 bytes); patch SHA-256 `e12cdb153586117b54bb1fd28aa7dd97a48ca0d69e5d226bce7988517ddb76a6` (344,168 bytes). Its freeze at 16:30:37 AEDT / 05:30:37 UTC remains the original source checkpoint.

The combined source is now published in draft PR #59 as head `0f127944d20a47907e4e0a21a6d4d56352c988d7`, tree `3dbafd33f2435e2d4456bfbb16b13cdf63f4c7d9`, with ordered parents `[e346b34dac0751643645574dd1ad615b41d7487d, 45ed2b6ef74f53a0940329066d0fe126ad87a7fa]`. B's twenty-two-path delta and P6's twenty-three-path delta are disjoint; the full published tree's 479 file blobs and modes have been verified. Fresh independent review of this exact combined tree precedes a new Gitar cycle and complete qualification. Earlier e346b34 approval and overlay acceptance do not qualify the combined head. **C is a draft candidate, not merged main or an actual deployed serving source.** No combined qualification or hosted acceptance has occurred.

**Initial source checkpoint, retained as history.** [Draft PR #59](https://github.com/appliedai-au/gate_keeper/pull/59) first published the independently accepted source at `22cf97d3f4a3608f193e1e2f92b2c2e2a5dcc0e6`, tree `ec04370850878f725d9dbaeb87c0a4d5301aa7c4`, based on frozen A. All 21 published changed-file Git blobs matched the reviewed packet. Patch SHA-256 was `757f61d53afc705362307d87817397e963f8b5ef2e89a131cecb66eae73b7bba` (118,346 bytes); manifest SHA-256 was `86ebae651b8b4db81a8a12ba9e993a63274b506711e339b7e4edcbbe0879572d`. Gitar acknowledged that exact head in comment `6676476840`; its final verdict and remote qualification were pending at that historical checkpoint. No candidate code was executed locally.

The implementation adds authenticated owner-only submission and private results/history, committed PostgreSQL dispatch intents, conservative holds for uncertain writes, exact session/input/result verification and separate scoped transport. It is disabled by default. The first release is restricted to the configured authenticated administrator owner. `Dockerfile.reviews-qualify` includes all inherited gates plus actual runtime-version evidence, Caddy tests and mandatory isolated PostgreSQL concurrency/uncertainty tests; the ordinary qualification recipe alone is insufficient. The approved ordinary review model, distinct review capability, schema migration, hosted installation and genuine owner review remain commissioning work.

The completed-history composition preserves frozen A and historical execution B under a future actual serving C, using original signed evidence and a separately pinned closed-history capsule. It has no Learning driver startup path and cannot turn the current partial/unsettled pilot into a completed archive. The hosted redirect compatibility packet is included in the published draft, but source acceptance is not runtime acceptance. Current main stays B while recovery design is pending. If a later qualified D repair becomes necessary, explicitly evolve the current strict B-only provenance/schema to retain B proofs and the mandatory recovery linkage; do not relabel D as B or activate the present reader against unsupported history.

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

### Qualified B implementation checkpoint

[PR #58](https://github.com/appliedai-au/gate_keeper/pull/58) qualified head `9bea70c29ca037c9c14810c64b5a10fdfefbb0bf`, tree `39060d5df53d3741bc1ee936c1910d96a3d74e43`, was merged as actual B `45ed2b6ef74f53a0940329066d0fe126ad87a7fa`. Fresh GitHub reads verified the exact qualified tree and ordered parents `[A, qualified head]`, with main B. The original frozen A binding is unchanged.

Remote deployment `c3039e16-a26b-4390-abe8-c87572d5af13` succeeded at `2026-11-06T04:35:01.631Z` / 15:35:01.631 AEDT. Actual logs show 670/670 full Node tests, 9/9 privacy canary, typecheck and five scorer checks; no failure, cancellation, skip or TODO. The independently inspected 335,602-byte capture has SHA-256 `6d77d781f848586452ce74fa1ffc97520dae48d5b2ae1bdda0729e4b94167770`. Its empty-service preflight had no configured variables, volumes, domains or TCP proxy. Actual disposable-service absence and `staged: null` were separately observed at `2026-11-06T04:54:13Z` / 15:54:13 AEDT.

The immutable [qualification receipt](https://github.com/appliedai-au/gate_keeper/pull/58#issuecomment-6677263803) has exact body SHA-256 `4c9a82e307aee8b4129b89daadbf0637dfe7e4f3f014c13b70e83b14aa1fdce0`. Gitar’s exact-head request/acknowledgement/final dashboard are `6676942614` / `6676949170` / `6676885297`; the dashboard approved with 1/1 finding closed. Its earlier native review remains honestly recorded as COMMENTED.

At the historical B serving checkpoint, authority deployment `fb06a41a-a780-4a1e-9965-2b8f86c36a06` succeeded at `2026-11-06T04:56:37.863Z`; implementation status returned signed B qualification and null continuation authorization. That checkpoint established qualification-only serving. Subsequently, signed prepare evidence was verified and the owner authorization was published in [PR #58 comment 6677415111](https://github.com/appliedai-au/gate_keeper/pull/58#issuecomment-6677415111). The original BASE then completed at `2026-11-06T05:11:27.884Z` / 16:11:27.884 AEDT with fourteen verified calls, no repeated first call and unknown actual prices. Preserve both checkpoints without treating the earlier null authorization as current state.

**Earlier P6 review checkpoint.** Head `e346b34dac0751643645574dd1ad615b41d7487d`, tree `62cdd8c13a21cfb549d262bcff27000e7631f9ff`, contained the independently accepted seven-file recovery delta; all supplied published blobs matched. Gitar dashboard `6677000221`, updated `2026-11-06T04:36:35Z`, approved with both findings closed after exact-head acknowledgement `6677010522`. The separate four-file hosted Review adapter was source accepted at patch SHA-256 `337b5e6f7529707f846e5d5c15431d4eb65cc2b8a7e581f160cbfb70f376c223`. These accepted inputs are retained in the newer combined draft head described above; the combined C qualification and live acceptance remain outstanding.

## 4. Failure and source-repair rule

Fix routine configuration and integration defects within the already-authorized scope. If a defect requires a different runtime source, pause new dispatch, retain the current frozen experiment and journals unchanged, and open a bounded source repair for independent review/Gitar/full isolated qualification. Document whether the immutable experiment must be superseded; never silently change its source, trust pins, policy or historic result. A replacement experiment is a separate explicit record with inherited historical evidence, not a reset that hides failure. Do not rerun broad tests without a concrete source or qualification reason.

## 5. Execution ledger

### Current continuation ledger — 6 November UTC / 6–7 November AEDT

| Event time UTC | Event time AEDT | Verified event | Disposition and evidence |
| --- | --- | --- | --- |
| 6 Nov 07:37:24 | 6 Nov 18:37:24 | PR #61 merged as D `3e5b8bd…` after revised exact candidate `da27e58…`, 709/709 tests and observed cleanup | [Qualification](https://github.com/appliedai-au/gate_keeper/pull/61#issuecomment-6679789911); preserve original failed qualification as history. |
| 6 Nov 10:08:51 | 6 Nov 21:08:51 | PR #62 merged as E `30e4296…`, qualified candidate `751e200…`, 1,030/1,030 tests, complete inherited gates and cleanup | [Exact receipt](https://github.com/appliedai-au/gate_keeper/pull/62#issuecomment-6682365828); E later installed on both existing services. |
| 6 Nov 12:21:35.397 | 6 Nov 23:21:35.397 | Existing E preparation completed with zero additional model calls | [Preparation/authorization checkpoint](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6685161182). |
| 6 Nov 12:22:25 | 6 Nov 23:22:25 | Exact owner authorization published with `allowRemainingExperiment:true` | [6684719636](https://github.com/appliedai-au/gate_keeper/pull/62#issuecomment-6684719636); accepted by authority at 12:23:28 UTC. |
| 6 Nov 13:22:10.770 | 7 Nov 00:22:10.770 | Original fourth invalid result consumed once using the existing settlement, zero additional model calls, child exit 0 | [Recovery accepted](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6685849917); four invalid, eighteen calls, no pending work. |
| 6 Nov 13:28:26.073 | 7 Nov 00:28:26.073 | Same-E restart/read-only check accepted original recovery linkage and the four-outcome state | [Persistence acceptance](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6686101812); separate ordinary remainder subsequently queued. |
| 6 Nov 14:40:18.680 | 7 Nov 01:40:18.680 | Existing sole remainder returned `complete`: ten genuine invalid proposals, zero scored/confirmed/activated, twenty-four actual calls across eleven settled operations, no pending work and parent exit 0 | [Final-pilot record](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727); later read-only post-command status agrees. Actual prices unknown; no learned improvement. |
| Reconciled 6 Nov 15:50 | Reconciled 7 Nov 02:50 | PR #59 earlier `94540e…` qualifier passed 1,098/1,098 source and 15/15 PostgreSQL tests; current head is `a252599…` | Historical qualification only. Accepted complete v2 packet/E integration and current-head review/full qualification remain pending. |

The ledger above is the current continuation. Every older table and checkpoint below is preserved as an **as-of historical record**. Statements there about zero/four attempts, B main, absent recovery or running earlier qualifiers do not describe the completed E pilot and do not authorize replay.

The original table below is retained as historical provenance. Its 0/10, BASE-held and pending-source-review entries describe the earlier checkpoints; they are superseded for current action by the phase status and dated incident ledger that follows. Update the incident ledger from actual receipts rather than inferred progress.

| Phase | Observation time (AEDT, with UTC in receipt) | Exact source/deployment/operation | Evidence | Disposition |
| --- | --- | --- | --- | --- |
| P0 | 6 November 2026, before the P1 cleanup | `main` remains `a35c83c…`; existing deployments reconciled | Fresh lead GitHub/Railway readbacks | Complete |
| P1 cleanup | 6 November 2026, 13:55:55 AEDT (`2026-11-06T02:55:55Z`) | Service `730fa701-cc2e-4246-9c86-c55586e3dde1` absent | Actual `services: []`, `staged: null`; new 242,625-byte capture with SHA-256 `bd2cb592…` retained | Cleanup complete |
| P1 receipt and gate | Receipt: 6 November 2026, 13:58:59 AEDT; gate subsequently verified | PR #56 comment `6675649613`; signed gate receipt in section 2 | Exact body digest `63bab68f…`; actual RPC evidence retained as `authority-source-gate.json` | Complete |
| P2 source/config | 6 November 2026, current lead app session | Existing app; starting revision `626e721…`; exact three-file update; four scoped bindings | Owner/admin verified; backend deployment `68085da…`; owner-body check 400, empty-object invocation 503; direct upstream 200/valid | Installed; runtime diagnosis and actual success/non-owner acceptance pending; unpublished |
| P3 authority/bootstrap | 6 November 2026; serve SUCCESS at 13:59:39.535 AEDT | Existing authority deployment and fixed HTTPS domain | Bootstrap 200 with retained body digest; anonymous 401, health 200; source gate accepted | Bootstrap/authentication accepted; no model-execution claim |
| P3 host initialization | 6 November 2026, 14:24:52.943 AEDT (`2026-11-06T03:24:52.943Z`) | Deployment `db6bf291-ed3c-426a-9e79-1f8e1996dbcc`, frozen experiment | SUCCESS, `initialized`, driver exit 0; all counts 0, BASE selected, no pending operation | Initialization complete |
| P3 HTTP access | 6 November 2026, 14:25:38 AEDT (`2026-11-06T03:25:38Z`) | Initialized host/proxy scoped status route | `host-status-access-20261106.json`: 7/7 expected responses | Transport accepted; no Base44-session acceptance |
| P3 run / BASE | First real turn completed 6 November 2026, 14:27:31.390 AEDT (`2026-11-06T03:27:31.390Z`) | Deployment `3eb27c23-9e17-40d4-905d-d3d5a6ab198d`; original BASE operation retained | One completed turn; verifier `listTurns(limit: 100)` receives HTTP 400 before second call; 3,194 tokens, US$0.0004338 SDK estimate only | Held; narrow pagination repair in preparation, no baseline pass/retry |
| P4 | Current accepted observation: 0/10 | Same experiment | No proposal outcome or qualified BASE yet | Pending; BASE call is not a learning attempt |
| P5 | Pending | Same retained journal and source | Restart, usage, privacy and independent acceptance | Pending |
| P6 source | 6 November 2026, 14:57:30 AEDT (`2026-11-06T03:57:30Z`) | Draft PR #59, head `22cf97d…`, tree `ec04370…` | Independent final source acceptance; all 21 published changed blobs verified; exact-head Gitar acknowledgement | Source implemented; final review/qualification/commissioning pending; public review remains demo |
| Plan publication | 6 November 2026 | Draft PR #57; `work/gatekeeper-closeout-phase-plan-20261106` | Isolated documentation branch; `main` unchanged | Published as draft; preserve frozen source |

### Current incident and continuation ledger — 6 November 2026

**Historical as of 6 November 2026, 17:12 AEDT / 06:12 UTC.** The title and entries below are preserved from that checkpoint; the later continuation and completed-pilot evidence are recorded immediately above.

All local times below are Melbourne AEDT (UTC+11). Deployment and provider identifiers remain in protected evidence; this ledger publishes no private IDs or raw model/oracle material.

| UTC | AEDT | Observed event | Current implication |
| --- | --- | --- | --- |
| 04:57:36.668 | 15:57:36.668 | Actual owner diagnostic invocation: all four secret-presence checks passed; fetch began and reported bounded `unsupported-option`; HTTP 503 | Workerd redirect incompatibility subsequently verified; accepted hosted-only fix is not installed |
| 05:11:27.884 | 16:11:27.884 | Authorized original BASE continuation completed successfully with fourteen verified calls and no repeat of the first paid call | P3 BASE complete; actual prices unknown; original evidence retained |
| 05:13:34.084 | 16:13:34.084 | A subsequent B host deployment was created after the explicit continuation exited successfully; creation is not attributable from the visible task history | Unexplained deployment; no evidence establishes another actor; preserve provenance for read-only reconciliation |
| 05:15:53.901 | 16:15:53.901 | Fourth proposal provider turn reached done/stop after three genuine invalid proposal outcomes; authority restart for status export overlapped this proposal | Provider terminality does not prove host consumption or settlement; overlap alone establishes no cause |
| 05:29:41.206 | 16:29:41.206 | Latest public projection: four attempted, three invalid, one pending; seventeen settled calls with unknown prices; eighteen actual dispatches including the fourth unsettled proposal | Next-start command `status`; no further runtime mutation pending recovery of the original fourth result; no failed-placeholder substitution |
| 05:30:37 | 16:30:37 | Thirty-six-path completed-history/product overlay frozen at manifest `2ed328acf02d7bec99b9ee6e520e656c39a025517e9530ec19c51a12f6bce2a4` | Independent review ongoing; no complete C qualification, deployment or closure claim |

The existing host recovery cannot consume an original invalid result that has not already been consumed. At the status checkpoint, the raw host archive was unavailable through the then-used interface. The dated updates below progress from capture access to completed custody capture; they do not establish consumed original evidence or settlement. Preserve the implementation gap for original-evidence recovery or a separately reviewed bounded repair. No additional proposal, repeat provider call, fabricated failed record or replacement attempt can resolve it truthfully.

### Investigation update — 16:37:31 AEDT / 05:37:31 UTC

The lead has located the authenticated Railway dashboard Console for the current
host deployment, including a read-only file browser and download capability.
Capture of the original controller, dispatch and held-operation archives is in
progress through native read-only file tools, preserving every journal head. No
capture result, validated recovery change, consumed fourth result or new settlement
is claimed yet. This updates the available investigation capability only: the
05:29:41.206 UTC public-status snapshot and the hold on further runtime mutation
remain unchanged.

### Custody and draft-source checkpoint — recorded 16:42:15 AEDT / 05:42:15 UTC

Read-only host custody capture is complete: **2,230,426 bytes**, SHA-256
`ef7f6fe44e9557b867fc94c5535633192bd2dece52bfd38eda75a1dbd32e3b20`.
It contains twenty controller records, twenty dispatch records and five held-operation
archive records, together with all head files. Before/after head-file hashes are
identical. The held archive records session, turn and failure, with
`TRUEFORGE_CALL_UNRESOLVED`; it contains no final result/artifact. Independent review
is checking the hash chains and original provider binding. No host mutation,
recovery action, added model call or new settled outcome followed from capture.
The 05:29:41.206 UTC status counts remain the latest recorded public snapshot.

Separately, the C overlay is independently source accepted and the exact combined
draft source is published at PR #59 head `0f127944d20a47907e4e0a21a6d4d56352c988d7`.
All 479 file blobs/modes were verified; fresh combined independent review, Gitar and
full qualification remain pending. Main is still B. A possible bounded D recovery
and any corresponding C provenance amendment remain design work, not an implemented
or qualified recovery path. Private archive paths, operation/provider identifiers
and raw content are retained only in protected custody evidence.

## 6. Primary references

### Current completion and release references

- [Original ten-attempt completion and current app-release checkpoint](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6689009727).
- [Current installed/final execution E](https://github.com/appliedai-au/gate_keeper/tree/30e429680f9da8ef8f5307f5fde4ef6bcfa2e70c).
- [PR #61 revised qualification/cleanup](https://github.com/appliedai-au/gate_keeper/pull/61#issuecomment-6679789911) and [PR #62 exact successor qualification](https://github.com/appliedai-au/gate_keeper/pull/62#issuecomment-6682365828).
- [Exact owner recovery/remainder authorization](https://github.com/appliedai-au/gate_keeper/pull/62#issuecomment-6684719636), [actual recovery](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6685849917) and [four-result restart acceptance](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6686101812).
- [Separate whole-remainder scope clarification](https://github.com/appliedai-au/gate_keeper/pull/63#issuecomment-6685703338).
- [Current draft app/history PR #59](https://github.com/appliedai-au/gate_keeper/pull/59) and [qualified but undeployed diagnostic PR #63](https://github.com/appliedai-au/gate_keeper/pull/63).
- [Sole-operator coordination acknowledgement](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6678541106) and [no additional coordination/approval hold](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6678637906).

### Historical references — as of 6 November 2026, 17:12 AEDT / 06:12 UTC

The labels “current” in the preserved references below refer to that historical checkpoint. Use the current completion/release references above for action.

- [Current #44 execution record](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6664862988).
- [Immutable source-qualification receipt on PR #56](https://github.com/appliedai-au/gate_keeper/pull/56#issuecomment-6675649613).
- [Isolated phase-plan draft PR #57](https://github.com/appliedai-au/gate_keeper/pull/57).
- [BASE pagination and bounded continuation repair PR #58](https://github.com/appliedai-au/gate_keeper/pull/58).
- [Owner continuation authorization on PR #58](https://github.com/appliedai-au/gate_keeper/pull/58#issuecomment-6677415111).
- [Current B source](https://github.com/appliedai-au/gate_keeper/tree/45ed2b6ef74f53a0940329066d0fe126ad87a7fa), distinct from frozen experiment A and the future actual serving C.
- [Separate private live-review implementation PR #59](https://github.com/appliedai-au/gate_keeper/pull/59).
- [Combined draft source head 0f127944](https://github.com/appliedai-au/gate_keeper/commit/0f127944d20a47907e4e0a21a6d4d56352c988d7), published on PR #59 and not merged into main.
- [Retained-history recovery](https://github.com/appliedai-au/gate_keeper/issues/44#issuecomment-6649714244).
- [Production pilot composition at the frozen source](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/production-pilot-v4.md).
- [Detached-authority commissioning and recovery](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/detached-authority-commissioning.md).
- [Owner-bound public status transport](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/docs/learning-v2/public-status-transport.md).
- [Frozen A driver](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/scripts/learning-v2/production-driver.mjs) and [original A launcher](https://github.com/appliedai-au/gate_keeper/blob/a35c83ccb2e3743c4d4f3b9ae13406507dfd297a/scripts/learning-v2/launch-production-pilot.mjs), retained as historical source; current B is linked separately above.
- [Official workerd/Workers Request redirect restrictions](https://developers.cloudflare.com/workers/runtime-apis/request/) and [Fetch cache support](https://developers.cloudflare.com/workers/runtime-apis/fetch/).
- [Optional draft PR #42](https://github.com/appliedai-au/gate_keeper/pull/42).

