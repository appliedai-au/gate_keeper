# Gate Keeper live proof `gk-live-20261101-c`

**Result: INCONCLUSIVE.** This is a real, live comparison on the owner's TrueForge, with real repair-loop execution. INCONCLUSIVE is the highest result available without an independent signer. On the evidence collected, **Gate Keeper is not demonstrably better than the standard TrueForge reviewer at review**. It matched recall, had lower precision, and used 2.26× the tokens. Its repair-loop edge (1 kept candidate vs 0) rests on n=2 and is not significant.

| | |
|---|---|
| Harness source (runner build) | `293d7485fb0b8f7d2733887b1a6efd275cc49858` (branch `proof/gk-proof-blocked-20261101`) |
| Gate Keeper methodology under test | committed `agent/native-trueforge-instructions.md`, `agent/instructions.md`, `agent/skills/review-checklist` at that commit (unchanged from PR #7 head `d62ae2f`) |
| TrueForge | `@truefoundry/trueforge@0.180.0`, Railway project "Gate Keeper", reached over the private network (`trueforge.railway.internal:8080`) |
| Model / provider | `anthropic/claude-sonnet-4-6` (Gate Keeper's configured model; same for both arms, adjudicator and drill) |
| Runner | one-shot Railway service `gk-proof-runner`, restart policy NEVER, run-once marker in the bucket |
| Run window | 2026-10-31 15:18:57 to 15:42:49 UTC (24 min) |
| Spend | **US$2.00** ledgered (cap US$10; comparison 1.14, adjudication 0.24, drill 0.62; 78 calls, 0 refusals) |
| Structural validation | `node scripts/proof/validate-public-proof.mjs proof/submissions/gk-live-20261101-c/summary.json` returns valid and INCONCLUSIVE (structure only) |

`summary.json` is the runner's own emitted public summary, decoded verbatim and pretty-printed. Nothing in it was edited by hand.

## 1. Experiment

**Arms (identical model, params `temperature 0, maxTokens 1500`, runtime config, tasks, output contract, iteration limit 4, no tools):**
- **A, baseline:** a one-line standard TrueForge reviewer role plus the shared output contract (`59cd16ce…0741`). TrueForge 0.180.0 ships no reviewer template.
- **B, Gate Keeper:** the TrueForge-native profile, reviewer instructions and review-checklist skill as committed, plus the same contract (`0826c376…a5d6`).
- Shared output contract: `2967a32a…5167`. Frozen scorer `evals/score.ts`: `8096f1c8…cefd`.

**Benchmark:** 4 public tasks (`evals/tasks`, 12 issues) plus 4 **owner-private holdout** tasks (10 issues in Go, Python, TypeScript and JavaScript, written for this run and never committed). The holdout reached the runner only as a Railway variable. Its SHA-256 `bfece0d5…79dc` was sealed before the run and matched inside the runner. 3 trials × 8 tasks × 2 arms = 48 review turns. Task order was shuffled per trial and arm order shuffled per task, interleaved so a budget stop would hit both arms equally.

**Independent adjudication:** a separate, blinded TrueForge session saw anonymised, shuffled findings (opaque ids, no arm or trial) plus the answer key, and judged match, real-defect and explanation correctness. Severity was scored deterministically against the evaluator's key. The deterministic line and category scorer ran alongside as a cross-check (agreement 0.82 to 0.86). Neither candidate graded itself.

**Spend control (outside every agent):** the evaluator process reserved a worst-case amount before every call and refused calls that would breach the phase caps (55/20/25%) or the total cap. Settlement used tokens × list price, because TrueForge 0.180.0 returned no `totalCostInUsd` in turn metrics.

## 2. Review comparison (all tasks, 3 trials, 66 expected issue-instances per arm)

| Metric | Baseline TrueForge | Gate Keeper | Difference |
|---|---|---|---|
| Defect recall | **0.9545** | **0.9545** | tie |
| Precision | **0.9167** (6 FP) | 0.8533 (11 FP) | GK −0.063 |
| Explanation correctness (adjudicated) | 1.00 | 1.00 | tie (ceiling) |
| Severity accuracy | 0.222 | **0.318** | GK +0.10 |
| Median latency per review | **14.7 s** | 18.0 s | GK +22% |
| Total tokens | **73,991** | 167,469 | GK ×2.26 |
| Approx. comparison cost (token-proportional share of US$1.14) | **~US$0.35** | ~US$0.79 | GK ×2.26 |
| Reproducibility (mean Jaccard of matched issues across trials) | 0.931 | **1.000** | GK slightly steadier |
| Deterministic score (`evals/score.ts`, mean) | **77.4** | 72.6 | GK −4.9 |
| Unlisted real defects found | 3 | 1 | |

**Holdout only (unseen, 10 issues × 3 trials):** recall 0.90 vs 0.90; precision **0.871 vs 0.771** (4 vs 8 FP); severity 0.333 vs **0.407**; tokens 34,886 vs 78,268.
**Public only:** recall 1.00 vs 1.00; precision **0.951 vs 0.925**; severity 0.139 vs 0.250.

## 3. Autonomous loop drill (disposable fixtures; same model; both arms)

The fixtures are throwaway git repositories created inside the runner:
- `money` (tenant-alpha): decimal parsing defect.
- `uploads` (tenant-beta): path-traversal trap, where the naive fix breaks a legitimate requirement.
- `archive` (tenant-beta): zip-slip variant, used for the after-improvement repeat.

Each fixture carries V-model tests: acceptance↔requirements, adversarial↔threat model, integration↔architecture, unit and static↔implementation. The repairer saw source and spec documents only, never the tests. Patches were bounded to the one allowed file, 30 changed lines and a forbidden-API list.

Validation ran as a polled background job, two rounds per level, under the Node permission sandbox (reads confined to the clone). Then came a fresh-session adversarial re-review, where any critical or high finding discards the candidate. Every failed candidate was discarded, the origin repository's SHA, working tree and file hash were re-verified, and no merge or deploy path exists.

| Cycle | Review findings | Attempts | Outcome | Origin unchanged |
|---|---|---|---|---|
| baseline-money | 2 | #1: 5 lines, V-model PASS, re-review blocking 2, discarded=True; #2: rejected PATCH_TOO_LARGE (44 lines), discarded=True | **REVERTED** | True |
| gate_keeper-money | 3 | #1: 15 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-uploads | 2 | #1: rejected PATCH_TOO_LARGE (68 lines), discarded=True; #2: 8 lines, V-model FAIL (adversarial failed), discarded=True | **REVERTED** | True |
| baseline-uploads | 1 | #1: rejected PATCH_TOO_LARGE (39 lines), discarded=True; #2: 8 lines, V-model PASS, re-review blocking 1, discarded=True | **REVERTED** | True |
| gate_keeper-archive-control | 2 | #1: rejected PATCH_TOO_LARGE (40 lines), discarded=True; #2: 10 lines, V-model FAIL (adversarial failed), discarded=True | **REVERTED** | True |
| gate_keeper-archive-with-lesson | 2 | #1: 30 lines, V-model FAIL (adversarial failed), discarded=True; #2: rejected PATCH_TOO_LARGE (51 lines), discarded=True | **REVERTED** | True |
**Repair success (money + uploads):** Gate Keeper **1/2** kept candidates (first attempt), baseline **0/2**. Note the inversion. The baseline produced a patch that **passed every V-model level in 2/2 cycles**, but its own fresh-session re-review raised high-severity findings and the gate discarded both. Gate Keeper produced a V-passing patch in 1/2 cycles. Whether those baseline re-review blocks were genuine is recorded in the private traces and was not independently adjudicated. With n=2 per arm this is **not a significant difference**.

**Controls and gates (as Gate Keeper's own code answered):**
- `No human in the loop = false`: `executionAdmission` → `HUMAN_APPROVAL_REQUIRED`. The job was held with no repair and no spend.
- `No human in the loop = true` with owner autonomy approval: admitted. Cycles ran with no approval prompt.
- Gate Keeper `budgetAdmission` with no signed lease → `INDEPENDENT_LEASE_REQUIRED`. The gate held correctly. The drill ran under the owner-authorised evaluator cap instead.
- Harness negative control: the unchanged defect submitted as a candidate failed acceptance, integration and unit, was **discarded**, and the origin was verified unchanged (`84921b5b…0f38`).
- Architect: not invoked. All changes were single-file with no cross-service impact, which the rule records.

**Learning loop:**
- **User lessons captured:** 2 tenant-private lessons (tenant-alpha/money, tenant-beta/uploads), written by Gate Keeper from run evidence and stored privately. Their text hashes are published in the private manifest.
- **Core candidate selection:** ran on both real lessons, and **none was selected**. Reasons: CONSENT_REQUIRED, ANONYMIZATION_REQUIRED, SUCCESS_PROOF_REQUIRED, CROSS_TENANT_GENERALITY_REQUIRED, HOLDOUT_REQUIRED, SECURITY_REVIEW_REQUIRED, VERIFIER_SIGNATURE_REQUIRED, CORE_POLICY_DISABLED, and SENSITIVE_CONTENT (proprietary-code status unknown). That is the correct outcome.
- **Repeat after improvement:** the archive fixture ran without the lesson, then with the tenant-beta lesson injected. **Both reverted** (adversarial failures and over-size patches). **No improvement from the lesson was demonstrated.**
- **Independent qualification:** BLOCKED (no independent signer).

## 4. Findings

1. **The review methodology adds cost, not accuracy.** Gate Keeper's prompt more than doubles tokens and adds 22% latency for identical recall and lower precision. It is worse still on the unseen holdout (8 vs 4 false positives). Its only edge is severity labelling (+0.10), and that is partly an artefact of a coarse evaluator key for public tasks 02 to 04, which use category defaults.
2. **Explanation correctness is at ceiling** (1.00 for both). The blinded adjudicator never marked a matched explanation wrong, so this metric does not discriminate on this benchmark.
3. **The verification layer did its job, regardless of arm.** Independent, polled, sandboxed V-model validation plus discard caught 3 adversarial failures (path-traversal and zip-slip fixes that passed the happy path) and 5 over-size patches. It never let a failing candidate through, and every origin stayed untouched. That is the part of Gate Keeper with demonstrated value.
4. **The 30-line patch bound rejected 5 of 12 attempts in both arms.** Models tend to re-emit whole files with comments. The bound is a protective choice, but it depresses repair success equally for both arms.
5. **The re-review gate cuts both ways.** It blocked a V-passing baseline candidate twice. A re-review gate that uses the same model as the repairer needs its own precision measured before it is trusted to discard work.

## 5. Blockers and limitations

- **No independent verifier or signing identity:** qualification cannot be signed, so no PASS is claimable.
- **No independent budget gateway lease:** spend was capped by the evaluator process (outside the agents). Gate Keeper's own lease gate correctly refused.
- The adjudicator is a separate, blinded session on the **same model** as the candidates, not a human or a different model family.
- `actual_cost_usd` is null: TrueForge 0.180.0 returned no per-turn cost, so spend was settled at tokens × list price (US$3/US$15 per Mtok). No provider billing statement was available.
- No TrueForge sandbox provider is configured (`sandbox_enabled: false`). Candidate validation ran in a disposable clone inside the one-shot runner under Node's permission model. Network sockets are not restricted by Node 24 permissions, only by the patch denylist.
- Spend could exceed the cap by at most one call's overrun beyond its reservation (bounded by `maxTokens` and a conservative input estimate). It did not happen here: US$2.00 of US$10.
- Sample sizes: 22 issues × 3 trials for review; 2 cycles per arm for repair. Outputs at temperature 0 were near-deterministic, so the trials mostly measure stability, not variance.
- **Aborted runs:** `gk-live-20261101-a` crashed at its first session creation (non-string metadata), with **zero spend**. `gk-live-20261101-b` was deliberately stopped after 8 comparison turns so a newly found harness race could be fixed before it could destroy evidence. Its spend was about US$0.20 (estimated from TrueForge turn logs × run c's mean cost per turn), and none of its evidence was retained. **Total proof spend ≈ US$2.20.**

## 6. Private evidence (owner-controlled Railway bucket, project "Gate Keeper")

Reference: `railway-bucket://gk-proof-evidence-kylc9za/gate-keeper-proof/gk-live-20261101-c/`. There are 52 objects, including `MANIFEST.json` with SHA-256 **`626bc9343bfd422c87b254f14bbc7cf780dc5ad48eb0a24088126bb5c8ebb1f6`**. Each object also carries its SHA-256 as object metadata. To verify, download the prefix with the bucket's own credentials (Railway dashboard → gk-proof-evidence) and compare `sha256sum` of each object against the table and `MANIFEST.json`.

Holdout task ids in object paths are redacted here as `holdout-N`; the manifest holds the real paths.

| Kind | Private path | SHA-256 |
|---|---|---|
| preflight | `preflight.json` | `59d54a24c5099b1973c12365d06a1a33b02300a14a6495ecca54b52fe0df40d6` |
| adjudication | `private/adjudication/01-python-utils-0-0.json` | `e02373430780d395b5f371cf134a5f80977c79ed8562f9e6e3f33c49794bcc11` |
| adjudication | `private/adjudication/02-express-users-0-0.json` | `82ecf49373ec9041260d08904ce88df3a0ce4cca32a071567bc32cfc13a0c142` |
| adjudication | `private/adjudication/03-python-deploy-0-0.json` | `639c4001cd2651d855095378d21883caa3302b85efe7a6a8dd0e7432c56ef734` |
| adjudication | `private/adjudication/04-ts-fetch-0-0.json` | `1a499beeebdbd8a934cf0be5d3227ba90e9f04350a9573922b74b786eda985a1` |
| adjudication | `private/adjudication/holdout-1-0-0.json` | `6f6e3262213d96a2e12f299e16bbfa694d6306501da867209d3c625ed862ddc5` |
| adjudication | `private/adjudication/holdout-2-0-0.json` | `8123d2389b42288ac1328e10b0960c64eb17731b194dfaa2762060c0577d067f` |
| adjudication | `private/adjudication/holdout-3-0-0.json` | `1502d8d3c1e95a2ce3170cb401e3b85e58cb37d1597ce2cb8a0d9cff8583fd33` |
| adjudication | `private/adjudication/holdout-4-0-0.json` | `c8dd848ff31843e6da6cb9fdb7c79347197972df6e1fe057e2aa8a524815c75e` |
| unblinding_key | `private/blinding-key.json` | `182d5f83e1a82fce9d2437963858a5498ce7a69dd8c225e8ac752ed388b5e985` |
| candidate_replies | `private/comparison-replies.json` | `0a8d76340cfc98f66eb0931b3a0e47bd4c064a79a3bca2034e3d081443be226b` |
| v_model_test_logs | `private/drill/baseline-money-attempt1-validation.json` | `8419ef81acb5c50ee5ed9efef2b0ce5c28cb54e8dfe07ca0be0d25790cf2dd38` |
| candidate_patch | `private/drill/baseline-money-attempt1.diff` | `92bdbc571c8cbb78ec5c01501f82c94abb5fd8a95512e92cda657d160fe0a7b1` |
| v_model_test_logs | `private/drill/baseline-uploads-attempt2-validation.json` | `7d3305b052979c754b19840b3776c9f1ec37b92e5f73cd1b1bca975bbc3ebf52` |
| candidate_patch | `private/drill/baseline-uploads-attempt2.diff` | `a8093dbf2427db10d8f4d52a9ed27ee2ec2d99a93e9d54ff26f6b81827fdf047` |
| drill_record | `private/drill/cycles.json` | `21040d1e57dbeb09d0543dea0032fc7649390a254c9ad1baad7ce0a24cccddd1` |
| v_model_test_logs | `private/drill/gate_keeper-archive-control-attempt2-validation.json` | `f2f9813015f8cf1a034163468bc1c2b7b3afbc554e2b95c5bc7c465ed0e9fadc` |
| candidate_patch | `private/drill/gate_keeper-archive-control-attempt2.diff` | `dfa3080d4137375baf31633028cad0179dc3d4fdc6d99d595b822408b5a0a978` |
| v_model_test_logs | `private/drill/gate_keeper-archive-with-lesson-attempt1-validation.json` | `b7db203c376b9a041aaa2c6125634064ce038699a928ecf99de7a77ed6d9a539` |
| candidate_patch | `private/drill/gate_keeper-archive-with-lesson-attempt1.diff` | `568f329a1a0d15f7069341ee6608000d4560eb431611b1900a109b1aaa55f424` |
| v_model_test_logs | `private/drill/gate_keeper-money-attempt1-validation.json` | `9d0be8f657998736c6b51eddc44e5f11f9f23ebc0ef7dc803b0f09cfbdd8bf8e` |
| candidate_patch | `private/drill/gate_keeper-money-attempt1.diff` | `c80c912d21131c717db762d03576eaacce45336fd680eddffe0ebd0a46f7bf15` |
| v_model_test_logs | `private/drill/gate_keeper-uploads-attempt2-validation.json` | `0dfed91815c5ca43dfdbd21b73840cbf62023103e16c9bd5d37276d1e2ab9f27` |
| candidate_patch | `private/drill/gate_keeper-uploads-attempt2.diff` | `c10bad0074c23d8487f85b9c7c7dba106e0fd43c8e2b8ca3f0f9c5876fcfeef9` |
| private_holdout | `private/holdout-tasks.json` | `5c79610254155a0f42cd50c355f07a05e817f52213e6759f75c8bce3b693c0f3` |
| tenant_private_lesson | `private/lessons/tenant-alpha-money.json` | `53e15fa8943a997c53f63edb48ba1ac8672491e5abdc94ec705560878df0c9af` |
| tenant_private_lesson | `private/lessons/tenant-beta-uploads.json` | `f37702cd09a457c0f1a5677dd3110ea7ee257a28dd5fe0cc956faef56200ba57` |
| trueforge_session_trace | `private/sessions/01m698nqqq634m2yktygre96qw.json` | `ab6b814a43fa3733257de495e0fc8a0e34377b1fb8b374b17d20fcc90502ff2f` |
| trueforge_session_trace | `private/sessions/01m698nqr1x8k7w11xm8wc230x.json` | `0eb74216c720bf37b9ab862ecb8a1e28375a19862c9db921fa2583041d9d9b14` |
| trueforge_session_trace | `private/sessions/01m698xqq36918r5rhndkghg9v.json` | `d8cc8cdb90f6d1ac170c5ae38cbbe5fec10505c311b7c61d3349e88338e76d0f` |
| trueforge_session_trace | `private/sessions/01m698xqqrn54hhcjk1mx3net1.json` | `a65dc8d05c6f7e0ec915c63e1caac6c23f5ca044d7e0ad53b481b3f4ddf82ffd` |
| trueforge_session_trace | `private/sessions/01m6996j67djjwdsf33m7xxbr7.json` | `a34560c7badab9edd12cdd7395548dbc0e92e8e146be1646aecb371884048574` |
| trueforge_session_trace | `private/sessions/01m6996j6gv4bw4052egvqw1e4.json` | `94279fa78159621543775298b485eb791f38563b5e1506d1ed25f5d8433543ac` |
| trueforge_session_trace | `private/sessions/01m699f6sb17h430yqw0gszffn.json` | `4a34bc0961c380388ac1599bc9c4e0c1781df3d09b579e31a8c6ae17d0e4899b` |
| trueforge_session_trace | `private/sessions/01m699kvaafqz59snaxq7ppj3s.json` | `b49cdcc8e3632dfd43973981abb37d2477e60a6d5955a319ddd49d1fec893dc5` |
| trueforge_session_trace | `private/sessions/01m699m75rs90k203jgg13xv7d.json` | `4670903a8389311a7f00eb3448eb6fe9c84a1b0f824b53099bc199d64405dd8c` |
| trueforge_session_trace | `private/sessions/01m699msetmxdtg8vcwbkmsyeg.json` | `dd8bdfcd21f5ad04d85e15f23946da1d8dc6fe47b71c4a4965cb39ccd50967e6` |
| trueforge_session_trace | `private/sessions/01m699p302j8r7ea3z4t5ec810.json` | `550ae3f56055bf42d7979f72b4ac0610583826e98e600f1dce017989234500e6` |
| trueforge_session_trace | `private/sessions/01m699pqp8fvt66gtx6h9wt460.json` | `e26e600ab27554ccd68ba98a14d0154d3849db6e8552128cf8f7bc3daf3e50bf` |
| trueforge_session_trace | `private/sessions/01m699q9z01c5r2ac3pxesknre.json` | `92d1347bbb0b828cd44c5892cccb249f5dc2e33ad4298805035cdcd75053b976` |
| trueforge_session_trace | `private/sessions/01m699rey4btrdbzyee1pxrwnh.json` | `0ce7072734882f42325f4019413468296cfe8f22dafb92c4fc4c2154333bc711` |
| trueforge_session_trace | `private/sessions/01m699s3m8k4cj5vc8eb2rdfks.json` | `2257636e4d633e8c05111eae9d62e7e258aac4f8754d9a10cf2a8f2dbcd51502` |
| trueforge_session_trace | `private/sessions/01m699tgkze8bwayvdkkakzsn6.json` | `e829f93a81d702edefe99aff8e11692563b233f57e7a2ac1f1a9ad767d0d68da` |
| trueforge_session_trace | `private/sessions/01m699ttzsfcrt5jft37htyjzv.json` | `bf89fd8116cca6189ed377637433a145ae272f31648d165b82714b54aa761db4` |
| trueforge_session_trace | `private/sessions/01m699vp4k7tavhxc7ny35dm9t.json` | `19ee88facd0c23e6263390d2581be47d876c379da0a3b7729d31b7c2fc3a7f43` |
| trueforge_session_trace | `private/sessions/01m699waw6dgwmmm8jtc5n538q.json` | `8f364f57dcfe799f37a99dc4b6f02979db004327e2ecb26672b6aaf3a39d93a7` |
| trueforge_session_trace | `private/sessions/01m699wpscq39b8jp6z64w6cz7.json` | `4062b88af78cd11099db0e52ee9b72876f685497b01cd58f87e29e66995e5b4b` |
| trueforge_session_trace | `private/sessions/01m699xbfv6k6bjk11m3mnfmad.json` | `9eb5e441c982b68cdaefec7950b9a665e35f4ffd2b2363d5910ebd80c3bea400` |
| trueforge_session_trace | `private/sessions/01m699yjg2hg8avertqb83hvt8.json` | `b7d600bc521721091e38090bc984a4c3f03a6a9cc58d8dadddc31361bd20d8b8` |
| trueforge_session_trace | `private/sessions/01m699za5zennmp8wvnarx2pmj.json` | `1a40620628debce156995d5dbee8ac5203536ef46ef924fb356fb6c0d613bfee` |
| spend_ledger | `private/spend-ledger.json` | `3f9b8f95c2f719a502f49095641a1a628d79e153cd3d926662a1b8ac0958d476` |
### TrueForge sessions (raw traces in the bucket under `private/sessions/`)

| Phase | Arm | Trial | Session id |
|---|---|---|---|
| comparison | baseline | 1 | `01m698nqqq634m2yktygre96qw` |
| comparison | gate_keeper | 1 | `01m698nqr1x8k7w11xm8wc230x` |
| comparison | baseline | 2 | `01m698xqq36918r5rhndkghg9v` |
| comparison | gate_keeper | 2 | `01m698xqqrn54hhcjk1mx3net1` |
| comparison | baseline | 3 | `01m6996j67djjwdsf33m7xxbr7` |
| comparison | gate_keeper | 3 | `01m6996j6gv4bw4052egvqw1e4` |
| adjudication | - | - | `01m699f6sb17h430yqw0gszffn` |
| drill | baseline | - | `01m699kvaafqz59snaxq7ppj3s` |
| drill | baseline | - | `01m699m75rs90k203jgg13xv7d` |
| drill | baseline | - | `01m699msetmxdtg8vcwbkmsyeg` |
| drill | gate_keeper | - | `01m699p302j8r7ea3z4t5ec810` |
| drill | gate_keeper | - | `01m699pqp8fvt66gtx6h9wt460` |
| drill | gate_keeper | - | `01m699q9z01c5r2ac3pxesknre` |
| drill | gate_keeper | - | `01m699rey4btrdbzyee1pxrwnh` |
| drill | gate_keeper | - | `01m699s3m8k4cj5vc8eb2rdfks` |
| drill | baseline | - | `01m699tgkze8bwayvdkkakzsn6` |
| drill | baseline | - | `01m699ttzsfcrt5jft37htyjzv` |
| drill | baseline | - | `01m699vp4k7tavhxc7ny35dm9t` |
| drill | - | - | `01m699waw6dgwmmm8jtc5n538q` |
| drill | gate_keeper | - | `01m699wpscq39b8jp6z64w6cz7` |
| drill | gate_keeper | - | `01m699xbfv6k6bjk11m3mnfmad` |
| drill | gate_keeper | - | `01m699yjg2hg8avertqb83hvt8` |
| drill | gate_keeper | - | `01m699za5zennmp8wvnarx2pmj` |
## 7. Reproduction

```bash
git checkout 293d7485fb0b8f7d2733887b1a6efd275cc49858
npm ci && npm install --no-save @aws-sdk/client-s3@3.705.0
node --test tests/proof-live-harness.test.mjs        # offline: harness + synthetic fake (not evidence)
# Live: deploy Dockerfile.proof as a one-shot service inside the TrueForge project with
#   TRUEFORGE_BASE_URL=http://trueforge.railway.internal:8080  GK_PROOF_RUN_ID=<new id>
#   GK_PROOF_CAP_USD=10 GK_PROOF_TRIALS=3 GK_OWNER_APPROVED_AUTONOMY=1
#   GK_PRIVATE_HOLDOUT_B64=<gzip+base64 owner holdout>  GK_EVIDENCE_S3_*=<bucket references>
# and restart policy NEVER. The runner prints GK_PROOF_PUBLIC_SUMMARY_B64 chunks; decode and validate:
node scripts/proof/validate-public-proof.mjs summary.json
```

Tools: Node 24.19.0 (runner image), Node 22.23.4 (local tests), TypeScript 5.9.3, `@truefoundry/trueforge-sdk` 0.180.0, `@aws-sdk/client-s3` 3.705.0.

## 8. Verdict

- **Better than the standard TrueForge reviewer?** **No, not demonstrably.** Recall is identical, precision is lower (worse on the unseen holdout), and cost is 2.26×. The severity gain is small and rests on a coarse key.
- **What Gate Keeper's code uniquely contributes:**
  - the independent verification and governance layer: V-model mapped, polled, sandboxed validation with automatic discard and origin-integrity checks
  - execution and spend admission (correctly held without approval or a signed lease)
  - tenant-private lesson capture with strict core-candidate gating
  - the frozen scorer, the public-proof validator and this live comparison harness

  None of this is TrueForge-native.
- **Remove as duplication:**
  - the long TrueForge-native methodology text that restates TrueForge's coordinator, subagents and sandbox. It costs tokens and precision for no recall. Use a lean reviewer prompt instead.
  - `scripts/providers/*`, since TrueForge Settings → Models owns model access.
- **Full learning loop proven?** **No.** Every stage executed live except independent qualification, but no lesson improved a later cycle, none qualified for core, and nothing is signed. The loop is *operational*, not *proven to improve*.
