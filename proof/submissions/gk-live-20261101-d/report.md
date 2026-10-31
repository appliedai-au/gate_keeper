# Gate Keeper live proof `gk-live-20261101-d` (run 2: lean reviewer, measurement fixes)

**Result: INCONCLUSIVE** (no independent signer). This was a live run on the owner's TrueForge 0.180.0 with `anthropic/claude-sonnet-4-6`, at harness commit `f527ea05c307f12502c742ae0353a255b8f2a365`. Spend: **US$1.79** (cap US$10). Private evidence: 90 objects, manifest `dc6d0030a4edd3bc96d49ea6313140d1811b54be66ca305eca6ffd6359e977d0` at `railway-bucket://gk-proof-evidence-kylc9za/gate-keeper-proof/gk-live-20261101-d/`.

**Important caveat:** the Gate Keeper arm in this run is the **lean** reviewer: core instructions, severity rubric and checklist, **without** the adversarial method. The adversarial method was removed in error during the slim-down and has since been restored as a selectable module (default on). Run 3 (`gk-live-20261101-f`) tests adversarial, lean and the standard reviewer side by side.

## Changes since run 1 (`gk-live-20261101-c`)
- The Gate Keeper review prompt no longer restates TrueForge orchestration (run 1: 2.26× the tokens, lower precision).
- Repairs use targeted `find`/`replace` edits (whole file as a fallback).
- Every blocking re-review finding is independently adjudicated, which measures the repair gate's false-block rate.
- Explicit severity keys for public tasks 02–04, from a generic rubric.
- 4 repair fixtures per arm (added pagination and an HTML/XSS trap).
- **A fresh owner-private holdout (v2):** 4 unseen tasks (Java, Ruby, C#, plus one clean Python file), 9 issues, SHA-256 `25161c4b…35ef`, matched in-run. The run-1 holdout is retired.

## Review comparison (3 trials × 8 tasks; identical model, params, contract and limits)

| Metric | Standard TrueForge reviewer | Gate Keeper (lean) |
|---|---|---|
| Defect recall | 0.984 | **1.000** |
| Precision (FP) | **0.848** (12) | 0.821 (14) |
| Holdout recall | 0.963 | **1.000** |
| Holdout precision (FP) | 0.703 (11) | **0.730** (10) |
| Severity accuracy | 0.355 | **0.667** |
| Explanation correctness | 1.00 | 1.00 (ceiling) |
| Median latency | **15.1 s** | 16.3 s |
| Total tokens | 76,618 | **59,397** (×0.78) |
| Reproducibility (mean Jaccard) | 0.972 | **1.000** |
| Deterministic score (`evals/score.ts`) | 70.1 | 70.8 |

## Repair-loop drill (4 fixtures per arm, plus the lesson repeat)

| Cycle | Review findings | Attempts | Outcome | Origin unchanged |
|---|---|---|---|---|
| gate_keeper-money | 2 | #1: edits 7 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-money | 3 | #1: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-uploads | 1 | #1: edits 5 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 6 lines, V-model FAIL (adversarial failed), discarded=True | **REVERTED** | True |
| gate_keeper-uploads | 2 | #1: edits 5 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 14 lines, V-model FAIL (adversarial failed), discarded=True | **REVERTED** | True |
| baseline-pagination | 3 | #1: edits 6 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 6 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True | **REVERTED** | True |
| gate_keeper-pagination | 3 | #1: edits 6 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-escape | 2 | #1: rejected FORBIDDEN_API: restricted core module, discarded=True; #2: edits 13 lines, V-model FAIL (acceptance failed), discarded=True | **REVERTED** | True |
| gate_keeper-escape | 2 | #1: rejected FORBIDDEN_API: restricted core module, discarded=True; #2: edits 8 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-archive-control | 1 | #1: edits 11 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-archive-with-lesson | 1 | #1: edits 16 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 13 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
- **Kept candidates:** Gate Keeper **3/4**, baseline **1/4**. V-model-passing patches: Gate Keeper 3/4, baseline 2/4.
- **Over-size rejections:** **0** of 14 attempts (run 1: 5 of 12). Targeted edits fixed the bound problem.
- **Re-review gate precision:** the gate discarded 3 V-passing candidates, and the independent adjudicator judged **0 of 3** blocking findings real. **The gate's false-block rate was 100%.** It cost the baseline its pagination fix twice and cost Gate Keeper one money attempt, recovered on retry.
- **Path-traversal trap (`uploads`):** both arms failed the adversarial level on both attempts and every candidate was auto-discarded. The protection worked, but neither arm repaired it.
- **Harness flaw found:** the first `escape` attempt of both arms was rejected as a restricted module because a scheme allow-list contained the string `"http"`. This was fixed in `0c2c789` (import positions only) and affects both arms equally here.
- **Lesson repeat:** the archive fixture passed first time **without** the lesson, and needed a second attempt **with** it. **No improvement from lessons was shown.** Four tenant-private lessons were captured, and core selection correctly selected none.
- **Gates:** `No human in the loop = false` held at approval with no spend. Gate Keeper's own budget gate refused without a signed lease. The negative control was discarded with the origin verified unchanged.

## Findings
1. The lean Gate Keeper reviewer matches or beats the standard reviewer on recall, holdout precision and severity, and **costs 22% less**. Overall precision is within 2 false positives over 24 reviews.
2. Gate Keeper repairs succeeded more often (3/4 vs 1/4), but n=4 per arm is still small.
3. **The post-repair re-review gate, as designed, only destroyed good work in this run.** It should not discard a candidate on a same-model reviewer's say-so without independent confirmation. Recommendation: require confirmation, or treat it as advisory, before discarding.
4. Lessons have not yet produced a measurable improvement.

## Blockers and limitations
- No independent verifier or signer; no independent budget gateway lease (spend capped by the evaluator outside the agents).
- The adjudicators are blinded sessions on the same model.
- `actual_cost_usd` is null (TrueForge 0.180.0 reports no per-turn cost), so spend was settled at tokens × list price.
- No TrueForge sandbox provider is configured, so validation ran in a disposable clone under Node's permission model, with network blocked only by the denylist.
- Small samples; temperature-0 trials mainly measure stability.

## Private evidence
Holdout task ids are redacted as `holdout-N`.

| Kind | Private path | SHA-256 |
|---|---|---|
| preflight | `preflight.json` | `008d90441494dfc1f1f284a944a525b8e6a918c08622398ff26b399a76cbaaf6` |
| adjudication | `private/adjudication/01-python-utils-0-0.json` | `8e3331b9fb6c9b1f6524c64eef08da09df91dcf6167c1fba267e4ae098dc339e` |
| adjudication | `private/adjudication/02-express-users-0-0.json` | `4cd079da9ecca0a326bde0c770fac97cc26be3286d6b72286baa2540ef79fd13` |
| adjudication | `private/adjudication/03-python-deploy-0-0.json` | `1e0e8e547df78827d3be918a34dd46fc15248d52b265ec8bab8b48688c04e9b4` |
| adjudication | `private/adjudication/04-ts-fetch-0-0.json` | `a481878995324922ab841df8ca268ae21f6dd34db133116e8802661001290189` |
| adjudication | `private/adjudication/holdout-1-0-0.json` | `cdba8d910d1ac0783cad7e7f6a69d7264e34fe1aa4a137947d1fd5733ca27cba` |
| adjudication | `private/adjudication/holdout-2-0-0.json` | `825e6a636a2fbd64117e499ac27971ad232741d08226c0463fd03b52df5313d4` |
| adjudication | `private/adjudication/holdout-3-0-0.json` | `681eddb0c75c40518a5fcd257619cfa2be0307376b835325a5a1a1f96ebe53af` |
| adjudication | `private/adjudication/holdout-4-0-0.json` | `7a64c076a633b7dc4485fc55a2dfe3ef490fa18d50fe46b3421b93f4ddc64c4d` |
| unblinding_key | `private/blinding-key.json` | `0065a4b9f100569235665f4a9a315df0cfef2ded55cdb32b15e4c826a22d996d` |
| candidate_replies | `private/comparison-replies.json` | `140e7813ddc2a99d8d491bf8707f10694814579836745bd3cb7f90d43661461f` |
| v_model_test_logs | `private/drill/baseline-escape-attempt2-validation.json` | `8e97963be566b2feab82a8fbc45c28e3f8309bf5b8f65422c6c5fd9189bef0bd` |
| candidate_patch | `private/drill/baseline-escape-attempt2.diff` | `84464716c2a6a2d5e1721cf7b1bc4e0b7700a6c4dfb9e5bc4b01b0b736f3e7e8` |
| v_model_test_logs | `private/drill/baseline-money-attempt1-validation.json` | `ed8910edbb0e72ad264e70050893efca9dc2cfebb2382234db6466406ade5884` |
| candidate_patch | `private/drill/baseline-money-attempt1.diff` | `10b51da59cda1bc8ec4e7d0656bb8dc780d3d08afec30fdff8d51f543fc1ce98` |
| gate_adjudication | `private/drill/baseline-pagination-attempt1-gate-adjudication.json` | `846543b776659675774ed6ee12274010853a68c02b86def5fa226c8f1ada4c3d` |
| v_model_test_logs | `private/drill/baseline-pagination-attempt1-validation.json` | `20c7df79716a903cc720a5052dc51242922541fab0156c0f8821a026861791cd` |
| candidate_patch | `private/drill/baseline-pagination-attempt1.diff` | `2a3f6cd72fa8a014d0c3f2b93175da0a5b541e9c37b5b588fc254699b207e278` |
| gate_adjudication | `private/drill/baseline-pagination-attempt2-gate-adjudication.json` | `dc8e58e092a806d0c88a116c988d87599e7386a20c9cb3615d93b50a1099d7ab` |
| v_model_test_logs | `private/drill/baseline-pagination-attempt2-validation.json` | `11784040701ff21d4b7172a0cfd74cc200b8e1ae323d55b68b88f2cfaa79a451` |
| candidate_patch | `private/drill/baseline-pagination-attempt2.diff` | `a0e2ec6d341209cf8dfe8dd8d7214fa4b08a572b833133b1d6364f9185439f93` |
| v_model_test_logs | `private/drill/baseline-uploads-attempt1-validation.json` | `f670f43cd48553f2d5d5cbbd2bb6f2a9328aacfb7c7e544178a9335c0241ec50` |
| candidate_patch | `private/drill/baseline-uploads-attempt1.diff` | `38ad1944802f836db412b1b6b494f6d1de35555a18abf7ad505cada252f209ff` |
| v_model_test_logs | `private/drill/baseline-uploads-attempt2-validation.json` | `e5b3b713c1d78e995ad1acb3d75c12cd784c8eafee3f9ce79cd074482a03ec48` |
| candidate_patch | `private/drill/baseline-uploads-attempt2.diff` | `6ef6c6ae805f3b136f2082357306b70a8107d4883d282a2b3f5559f10a7a4a4f` |
| drill_record | `private/drill/cycles.json` | `bf11a91245d701e4cad1a2208470e0a2f944e77a589fe0083e466f870bef5aa7` |
| v_model_test_logs | `private/drill/gate_keeper-archive-control-attempt1-validation.json` | `159ddfe7c4f305669440c9c9ee6369126b44cf063e7b6449b3fe37a6f1b2d3c4` |
| candidate_patch | `private/drill/gate_keeper-archive-control-attempt1.diff` | `58c9908eab2447265b441ce3427dfa14017cc9d92d86d0a84a184385395ce261` |
| v_model_test_logs | `private/drill/gate_keeper-archive-with-lesson-attempt1-validation.json` | `85dbbdcac3b444a899e94c8e5a25a95d4eba1fbb0aa0ffb1edd76e7ff0abe935` |
| candidate_patch | `private/drill/gate_keeper-archive-with-lesson-attempt1.diff` | `76679573ae1616948992eb7bce3e346f05d702a991366560fe7f7ab2b2bcd2ac` |
| v_model_test_logs | `private/drill/gate_keeper-archive-with-lesson-attempt2-validation.json` | `baf8e12454608ed0b85302b2ddd3ad288d83d98a50cbc6d207dc22867718c4ae` |
| candidate_patch | `private/drill/gate_keeper-archive-with-lesson-attempt2.diff` | `4985980b1fa5cd6f0d3731934a4080754f0dbe77518c7eea25fc6dbf30052d18` |
| v_model_test_logs | `private/drill/gate_keeper-escape-attempt2-validation.json` | `29dffc40f97162cce495ba0e47ec848941f0961feb784d7c02611934ed8cf748` |
| candidate_patch | `private/drill/gate_keeper-escape-attempt2.diff` | `0efa0341ef2da4fdf5661cd50de2d7cfab090ba71e01e5598de84ddd29c2c3ab` |
| gate_adjudication | `private/drill/gate_keeper-money-attempt1-gate-adjudication.json` | `c53811b0225631ade3d220b3c4e04670ea183391dc9b9d1131c20bae83b07f5e` |
| v_model_test_logs | `private/drill/gate_keeper-money-attempt1-validation.json` | `3cb9a7ec4191f93c2550003297bc1f5dd32b5c33132b6e15912c8d81c5160ca4` |
| candidate_patch | `private/drill/gate_keeper-money-attempt1.diff` | `4c656b9992ca053fd85e50581a0efd80c337bbb11b95a7b5aa8c9eabdfcc5663` |
| v_model_test_logs | `private/drill/gate_keeper-money-attempt2-validation.json` | `b1dbff4681e37c7e9e415d3aad34291cc74cd80f7d78361e91d062eacf9ecc56` |
| candidate_patch | `private/drill/gate_keeper-money-attempt2.diff` | `90b059f818fb9251ff0a725b48c1cfe052702ab84f5e718ee8c8b1ed65450a93` |
| v_model_test_logs | `private/drill/gate_keeper-pagination-attempt1-validation.json` | `f1fd47c8fbb41ec1b427b54417d16d20c8bf2c17c25b051698d2ce2ce6bad146` |
| candidate_patch | `private/drill/gate_keeper-pagination-attempt1.diff` | `2a3f6cd72fa8a014d0c3f2b93175da0a5b541e9c37b5b588fc254699b207e278` |
| v_model_test_logs | `private/drill/gate_keeper-uploads-attempt1-validation.json` | `41cc4136bb92f0c383b024bcebd416c411d56ec65765b72bf7dedba855577110` |
| candidate_patch | `private/drill/gate_keeper-uploads-attempt1.diff` | `4ee932a75a89d53ebe581ac0e27a504355cd0e795851b249467f118cece2861f` |
| v_model_test_logs | `private/drill/gate_keeper-uploads-attempt2-validation.json` | `c08383251b72b7fa8de21aa190b5bda9aecd116af2fd2b09059b8d986d09c082` |
| candidate_patch | `private/drill/gate_keeper-uploads-attempt2.diff` | `2ff64cdde06a5f1c7a42ece92a626948d9c99201677b24aee77a798cf952b592` |
| private_holdout | `private/holdout-tasks.json` | `c207e7270c09d835ca0f38abd41ed0a68b6c9938dee39922c7d89cc5a6f07f25` |
| tenant_private_lesson | `private/lessons/tenant-alpha-money.json` | `79cb6c30677f381cf11b57ae1cbfa662f0a0389202bb7f958eefecbc4f44f5dd` |
| tenant_private_lesson | `private/lessons/tenant-beta-uploads.json` | `ef57a928e4463ffd2f7454548b8a25e5b591c417a987deb596ba79c00a76b2fd` |
| tenant_private_lesson | `private/lessons/tenant-delta-escape.json` | `9a63afe302fd865bc85521fd6c739e1103369490de33d1348a30dd61d4547dfe` |
| tenant_private_lesson | `private/lessons/tenant-gamma-pagination.json` | `208dc877136f1d5a28be07cee940319ada4f0839a38da3ddff47b2d3049ca572` |
| trueforge_session_trace | `private/sessions/01m6a0snd35w50xdzwm80mpwrw.json` | `f6da39a7d124cd28869e711a00ee6f9c9269d07c483e471a890b86c140ff9f4e` |
| trueforge_session_trace | `private/sessions/01m6a0sndkxegqge74tz5wxt6k.json` | `8c126343c1420a378e4530a66082f229819143e1f9b6d44842b9035952912701` |
| trueforge_session_trace | `private/sessions/01m6a12cym7jzfjm7pcf6z8yn0.json` | `a99242db02a1408f2098e589b6ffabaa3345c1dac0656de3fa6d7c5bff041693` |
| trueforge_session_trace | `private/sessions/01m6a12cz4mbyp4yghts764b4m.json` | `a649e6b679e19e6a532616a9b0266c53fb9185a5b6c6d06c9c7941628b651786` |
| trueforge_session_trace | `private/sessions/01m6a1anp24fbyep972e2q2z8w.json` | `dc1197acc90be9df511f3fcfb235dd9068ff66439bdab2724f4e64d428bba29c` |
| trueforge_session_trace | `private/sessions/01m6a1anpcw8dxtde8qnvaqxt5.json` | `c7644dba7b984dbee8a85bd52488c4bbd7613bda955da18139ef98ca3754dfc8` |
| trueforge_session_trace | `private/sessions/01m6a1jfkbs22zmsytjwtvb793.json` | `4be668b1e3381369f5b48cf406861292ee28f288d968bc397dd48607ef1b1c06` |
| trueforge_session_trace | `private/sessions/01m6a1qec8qwjrnpgapcrd8wrj.json` | `156005bb82d4cd40404eedce21be06609a2e92b0821efedd3bab67677d5d512f` |
| trueforge_session_trace | `private/sessions/01m6a1qymt7bbvgq24zqpkg5hg.json` | `084c28679d3033f64d0691ef7ea8917abec7e63dd8f3118a92bd7f1b19a92563` |
| trueforge_session_trace | `private/sessions/01m6a1r9h9tmp5dqvxxx86wn94.json` | `c822ae33c40da218f6fffddf8e446f1d24f3dd0b43a9f99ede262199f80b462d` |
| trueforge_session_trace | `private/sessions/01m6a1rv8wgt8yp6p9r7wv2xtx.json` | `5eb07966d7b46118233eef396979c1a99d560994d33a733543a89c7fcf5736ca` |
| trueforge_session_trace | `private/sessions/01m6a1smyf3k4ktskmzr0vmqst.json` | `f659254b26c51f11e4388376d8f840d7173ed99333dcf2c034a29906f8739236` |
| trueforge_session_trace | `private/sessions/01m6a1t6qchhty59yph14k1f6y.json` | `a9a8ef597cc67fa7b3a9905a149954537e0f5ca45be9e51eaf38bcce2df66cfd` |
| trueforge_session_trace | `private/sessions/01m6a1tq03ptz7g03ep1va536d.json` | `89ee91a1ad98bdfb1649ab4d85ac31293aea95726e014d29f98715208455f4f0` |
| trueforge_session_trace | `private/sessions/01m6a1v4tzk0np9t7jbt1b5ptv.json` | `8ea087954d273f53b3f2ca8cb7d8534f5db27c341e4dcb0e4f268d602f9ad358` |
| trueforge_session_trace | `private/sessions/01m6a1vdsr3faktj1yyyey71fv.json` | `cbbaf0db1d3ec2112eca4cc39c4cbbfd03076d31e78838c2ab9e726fd550acec` |
| trueforge_session_trace | `private/sessions/01m6a1vsn1s1sb8jgnq9bakg3n.json` | `3e0886458e4f6b236eb04d00cd0f5916c9267bdcd1d4578ba6ec815d84181cf7` |
| trueforge_session_trace | `private/sessions/01m6a1wcey2v8e2fz7tg54a26t.json` | `fba3a0478c3433e38a6862b8298e39dfd7e576d26064bb49f171b4987a695a9d` |
| trueforge_session_trace | `private/sessions/01m6a1wsteyq4efm5w32cmqj9w.json` | `5de30d3000fa996d936f2ce93eb445ec09daaa58a44ae489dab1bf1708b43c8c` |
| trueforge_session_trace | `private/sessions/01m6a1xzt9ag0mq0pahjpfb5er.json` | `a7debdb4868a8eba6fe481ed1c79a2fd7a44067485ce32b8cf342f5a7721f58b` |
| trueforge_session_trace | `private/sessions/01m6a1yg3ktjg69xgfd20fmp6y.json` | `7afd02ad8464b37fecab69ec6afa38af7c63daff15041d7f32a6db6f41913670` |
| trueforge_session_trace | `private/sessions/01m6a1ywf367yywedxn7qnq73f.json` | `91b13e314001af2cb3bbb760b68c9682fa726a899a345a0f8b298e3edef42f55` |
| trueforge_session_trace | `private/sessions/01m6a1zw2nvjbdtg0byxt01gp0.json` | `5bb65d167ebe27ff0e7d689f4d90e3be6404bc91b4e1a831a2e554ad78746729` |
| trueforge_session_trace | `private/sessions/01m6a20pqav4xxtz9da2jytwr4.json` | `cb600772dc1d8702ea15509774d4738d043d702cea6b2552953a8762598f397c` |
| trueforge_session_trace | `private/sessions/01m6a2170c523hmpe3p9ye7ky4.json` | `4a3431aa65b05eccf6895a7ddc08f2baf7a3d7cfc10f7cfc6b728aedda6424b6` |
| trueforge_session_trace | `private/sessions/01m6a21mv248ks29kt08epra11.json` | `6007e63f54ed3524c59c40cdcdc639710aa332d0ffe55a523cdb2c09ead9a6da` |
| trueforge_session_trace | `private/sessions/01m6a2254tyz6e8amzj1a8mhgf.json` | `388d8520fda77fcef9e74e0d15cfae61e730e8c82209c2ea0da8a06fe1f1f6ca` |
| trueforge_session_trace | `private/sessions/01m6a22ndyztjm584cwc5g20ps.json` | `3b5e21215284dd8be69ec58cbf4e64d8eca91817940cbf1cc513b5bdbaecf56f` |
| trueforge_session_trace | `private/sessions/01m6a23ar23tv6nwmv8p46hdst.json` | `9f7262bc1fdde2cdb5c77776d91c1524c6f772c081905ea9af45dde13f29f3f7` |
| trueforge_session_trace | `private/sessions/01m6a23sh9e1cbmhek76bn4ba5.json` | `b2dcc17e7a6a1eab6db27a5ba69967f0414bcbe04ffe2161f9040493d73741ba` |
| trueforge_session_trace | `private/sessions/01m6a24w21sa90afx22y451xv8.json` | `498fdf92bb4e23d55311c4854973567c215279c39552b93b986e7cf8c7e60b22` |
| trueforge_session_trace | `private/sessions/01m6a25pngm3v5keyshwq4k8h5.json` | `c1b1705b0d095f04e4c0092fc17649fdd459ee5fd368a81dee1c4eef56e9cc66` |
| trueforge_session_trace | `private/sessions/01m6a26ed93y1w32qszh5fxa5n.json` | `36dc9be4b7c21b27d8021e4ecf79e8ff033010aa934e51bb7c72e7b8ba4b1a25` |
| trueforge_session_trace | `private/sessions/01m6a26t8f4cng6v47w0cjbst7.json` | `ef7db8e14152653e169a94b493f82de5dce67beac2cf5f4804389ec9d16ab5cf` |
| trueforge_session_trace | `private/sessions/01m6a27cggg6be2zvkm0r2ahbr.json` | `a78dc084055b567e7d7fe86108e354548a3984f5caf0edb25c6bf28d4586eb99` |
| trueforge_session_trace | `private/sessions/01m6a2817jwtghgtgjvzpkcv9e.json` | `59e5a022aa1cc99e92da1e1fc63662d0ce6c080250097b98409dd45e38b374c8` |
| trueforge_session_trace | `private/sessions/01m6a28ehm57dgm4drdkkw19b5.json` | `3e2c289b8311df67a952816c36a2faf1560fc1f665c0916277de53deb83add69` |
| trueforge_session_trace | `private/sessions/01m6a2a0b2yh7vjxczzewa2evk.json` | `20f5dc034d80eb5fdc972e41871242e4b09f77065b703c778cad4cd074a6dec6` |
| spend_ledger | `private/spend-ledger.json` | `6ec4cfedd741fc63ba70cea3d96285932b5a9e5b6dbf272681a2eb5d58d92a3a` |
## TrueForge sessions

| Phase | Arm | Trial | Session id |
|---|---|---|---|
| comparison | baseline | 1 | `01m6a0snd35w50xdzwm80mpwrw` |
| comparison | gate_keeper | 1 | `01m6a0sndkxegqge74tz5wxt6k` |
| comparison | baseline | 2 | `01m6a12cym7jzfjm7pcf6z8yn0` |
| comparison | gate_keeper | 2 | `01m6a12cz4mbyp4yghts764b4m` |
| comparison | baseline | 3 | `01m6a1anp24fbyep972e2q2z8w` |
| comparison | gate_keeper | 3 | `01m6a1anpcw8dxtde8qnvaqxt5` |
| adjudication | - | - | `01m6a1jfkbs22zmsytjwtvb793` |
| drill | gate_keeper | - | `01m6a1qec8qwjrnpgapcrd8wrj` |
| drill | gate_keeper | - | `01m6a1qymt7bbvgq24zqpkg5hg` |
| drill | gate_keeper | - | `01m6a1r9h9tmp5dqvxxx86wn94` |
| adjudication | - | - | `01m6a1rv8wgt8yp6p9r7wv2xtx` |
| drill | gate_keeper | - | `01m6a1smyf3k4ktskmzr0vmqst` |
| drill | baseline | - | `01m6a1t6qchhty59yph14k1f6y` |
| drill | baseline | - | `01m6a1tq03ptz7g03ep1va536d` |
| drill | baseline | - | `01m6a1v4tzk0np9t7jbt1b5ptv` |
| drill | baseline | - | `01m6a1vdsr3faktj1yyyey71fv` |
| drill | baseline | - | `01m6a1vsn1s1sb8jgnq9bakg3n` |
| drill | gate_keeper | - | `01m6a1wcey2v8e2fz7tg54a26t` |
| drill | gate_keeper | - | `01m6a1wsteyq4efm5w32cmqj9w` |
| drill | baseline | - | `01m6a1xzt9ag0mq0pahjpfb5er` |
| drill | baseline | - | `01m6a1yg3ktjg69xgfd20fmp6y` |
| drill | baseline | - | `01m6a1ywf367yywedxn7qnq73f` |
| drill | baseline | - | `01m6a1zw2nvjbdtg0byxt01gp0` |
| drill | gate_keeper | - | `01m6a20pqav4xxtz9da2jytwr4` |
| drill | gate_keeper | - | `01m6a2170c523hmpe3p9ye7ky4` |
| drill | gate_keeper | - | `01m6a21mv248ks29kt08epra11` |
| drill | baseline | - | `01m6a2254tyz6e8amzj1a8mhgf` |
| drill | baseline | - | `01m6a22ndyztjm584cwc5g20ps` |
| drill | gate_keeper | - | `01m6a23ar23tv6nwmv8p46hdst` |
| drill | gate_keeper | - | `01m6a23sh9e1cbmhek76bn4ba5` |
| drill | gate_keeper | - | `01m6a24w21sa90afx22y451xv8` |
| drill | - | - | `01m6a25pngm3v5keyshwq4k8h5` |
| drill | gate_keeper | - | `01m6a26ed93y1w32qszh5fxa5n` |
| drill | gate_keeper | - | `01m6a26t8f4cng6v47w0cjbst7` |
| drill | gate_keeper | - | `01m6a27cggg6be2zvkm0r2ahbr` |
| drill | gate_keeper | - | `01m6a2817jwtghgtgjvzpkcv9e` |
| drill | gate_keeper | - | `01m6a28ehm57dgm4drdkkw19b5` |
| drill | gate_keeper | - | `01m6a2a0b2yh7vjxczzewa2evk` |
