# Gate Keeper live proof `gk-live-20261101-f` (run 3: adversarial vs lean vs standard)

**Result: INCONCLUSIVE** (no independent signer). This was a live run on the owner's TrueForge 0.180.0 with `anthropic/claude-sonnet-4-6`, at harness commit `0c2c789ce57b222bef3846effbebe6e83c216055`. Spend: **US$4.01** (run cap US$5.50, within the US$10 cap for the whole proof). Private evidence: 192 objects, manifest `c5f408111ada4f3a57239665350ade5385d9c8441654d2d3ba945d32c28f1491` at `railway-bucket://gk-proof-evidence-kylc9za/gate-keeper-proof/gk-live-20261101-f/`.

## Question
Does Gate Keeper's adversarial method earn its place? The owner's rule: if it is better, keep it; if it is better but costs more, make it selectable.

## Setup
- Three arms on identical inputs, model, parameters (temperature 0, 1,500 max tokens), output contract and limits:
  - **standard**: the plain TrueForge reviewer role
  - **adversarial**: Gate Keeper with the adversarial method (the default)
  - **lean**: Gate Keeper without it
- 3 trials × 12 tasks (4 public + 8 owner-private holdout v3, of which 2 are clean files; 12 issues), interleaved and shuffled.
- Holdout v3 SHA-256 is `6ea7823d0b18d11d495774915b136c94d3848125f0e594013d07b55a25f70053`. Holdout task ids are redacted as `holdout-N`.
- A blinded adjudicator session graded every finding. The frozen `evals/score.ts` ran as a deterministic cross-check.
- Repair drill: 6 fixtures × 3 arms, plus the archive lesson repeat.

## Review comparison (blinded adjudication)

| Metric | Standard | GK adversarial | GK lean |
|---|---|---|---|
| Defect recall (all) | 0.9583 | 1 | 0.9583 |
| Holdout recall | 0.9167 | 1 | 0.9167 |
| Precision (all) | 0.8242 | 0.8163 | 0.8636 |
| Holdout precision | 0.6923 | 0.6964 | 0.7755 |
| False positives (all) | 16 | 18 | 12 |
| Holdout false positives | 16 | 17 | 11 |
| Severity accuracy | 0.3188 | 0.4861 | 0.5217 |
| Explanation correctness | 0.9565 | 0.9722 | 0.9565 |
| Median latency (ms) | 14418.5 | 15665 | 13580.5 |
| Total tokens | 109342 | 93991 | 85000 |
| Reproducibility (mean Jaccard) | 1 | 1 | 1 |
| Deterministic score | 57.64 | 63.19 | 61.81 |

- **Adversarial was the only arm that found every key issue (72/72).** Standard and lean each missed one holdout issue in every trial (whether it was the same issue is in the private adjudication records).
- Temperature 0 made every trial identical (Jaccard 1.0, recall stdev 0). The three trials are therefore not independent: the recall gain is **one defect on one unseen task**.
- Adversarial cost **+10.6% tokens** vs lean (94.0k vs 85.0k) and **6 more holdout false positives** (17 vs 11). It was still **14% cheaper than standard**.
- Holdout precision for adversarial (0.696) is no better than standard (0.692). Lean is best on precision (0.776) and severity.
- Cache token counts are not reported in this run: the runner commit predates cache reporting.

## Repair-loop drill (6 fixtures per arm)

| Arm | V-model-passing patch | Kept after re-review | Kept if the gate blocked only on confirmed findings |
|---|---|---|---|
| Standard | 5/6 | 2/6 | 4/6 |
| GK adversarial | 5/6 | 2/6 | 4/6 |
| GK lean | 5/6 | 3/6 | 4/6 |

- **The arms do not differ on repair.**
- **Re-review gate:** 24 re-reviews raised 18 blocking findings. The adjudicator confirmed **5** and rejected **13**. The gate discarded 16 candidates that had passed all V-model levels, **12 of them with no confirmed finding**. Run 2 showed the same pattern (3/3 unconfirmed).
- **Path-traversal trap (`uploads`):** every arm failed the adversarial level on both attempts and was auto-discarded, with the origin verified unchanged. No arm repaired it.
- **Lesson repeat:** the archive fixture was REVERTED without the lesson (a false gate block on retry) and kept with it. That is n=1 under a noisy gate, so it is weak evidence.
- **Gates:** `No human in the loop = false` held at approval with no spend. `= true` was admitted under the owner's autonomy flag. Gate Keeper's budget gate refused without a signed lease. The negative control failed, was discarded, and the origin was verified unchanged. Six tenant-private lessons were captured; core selection held all of them.

| Cycle | Review findings | Attempts | Outcome | Origin unchanged |
|---|---|---|---|---|
| gate_keeper_lean-money | 2 | #1: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-money | 2 | #1: edits 7 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 11 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True | **REVERTED** | True |
| baseline-money | 3 | #1: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-uploads | 1 | #1: edits 13 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 7 lines, V-model FAIL (adversarial failed), discarded=True | **REVERTED** | True |
| baseline-uploads | 2 | #1: edits 10 lines, V-model FAIL (adversarial, integration failed), discarded=True; #2: edits 9 lines, V-model FAIL (adversarial, integration failed), discarded=True | **REVERTED** | True |
| gate_keeper_lean-uploads | 1 | #1: edits 7 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 13 lines, V-model FAIL (adversarial failed), discarded=True | **REVERTED** | True |
| gate_keeper_lean-pagination | 2 | #1: edits 6 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-pagination | 3 | #1: edits 6 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 6 lines, V-model PASS, re-review blocking 2 (confirmed 0), discarded=True | **REVERTED** | True |
| gate_keeper-pagination | 3 | #1: edits 9 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-escape | 2 | #1: edits 22 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper_lean-escape | 3 | #1: edits 14 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 19 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True | **REVERTED** | True |
| gate_keeper-escape | 2 | #1: edits 25 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 21 lines, V-model PASS, re-review blocking 1 (confirmed 1), discarded=True | **REVERTED** | True |
| baseline-redirect | 1 | #1: edits 18 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 16 lines, V-model PASS, re-review blocking 2 (confirmed 2), discarded=True | **REVERTED** | True |
| gate_keeper_lean-redirect | 1 | #1: edits 14 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 9 lines, V-model PASS, re-review blocking 1 (confirmed 1), discarded=True | **REVERTED** | True |
| gate_keeper-redirect | 1 | #1: edits 19 lines, V-model PASS, re-review blocking 1 (confirmed 1), discarded=True; #2: edits 22 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper_lean-retry | 3 | #1: edits 6 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-retry | 3 | #1: edits 11 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 14 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True | **REVERTED** | True |
| gate_keeper-retry | 3 | #1: edits 6 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 11 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True | **REVERTED** | True |
| gate_keeper-archive-control | 1 | #1: edits 10 lines, V-model FAIL (adversarial failed), discarded=True; #2: edits 11 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True | **REVERTED** | True |
| gate_keeper-archive-with-lesson | 1 | #1: edits 14 lines, V-model PASS, re-review blocking 1 (confirmed 0), discarded=True; #2: edits 12 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |

## Decision
1. **Adversarial stays the default; lean stays selectable.** It is better on the metric that matters most for a gate (no missed defect), costs about 11% more tokens than lean, and adds noise.
2. **Repair quality does not depend on the review mode.** The bottleneck is the re-review gate's false blocks.
3. **Recommended change (owner decision):** discard a V-passing candidate only when an independent adjudicator confirms a blocking finding. On this run that keeps 4/6 instead of 2–3/6 with no confirmed defect admitted.
4. False positives are the open problem in both review and re-review. The next run tests whether population learning (rules from many tenants' adjudicated errors, qualified per tenant and tested on a new tenant) reduces them without losing defects.

## Spend
- This run: US$4.01 (comparison 1.71, adjudication 0.78, drill 1.52; 226 calls, 0 refusals). Settled at tokens × list price.
- Proof to date: run 1 US$2.00, run 2 US$1.79 and this run US$4.01, plus two stopped runs (about US$0.20 and a few cents). That is about **US$8.05 of the US$10 cap**.

## Blockers and limitations
- No independent verifier/signing identity: qualification cannot be signed, so no PASS is claimable
- No independent budget gateway lease: spend was capped by the evaluator process (outside the agents), not a signed gateway
- Adjudicator is a separate, blinded TrueForge session on the same model as the candidates, not a human or a different model family
- actual_cost_usd is TrueForge's per-turn cost estimate (turn metrics), not a provider billing statement
- Node permission sandbox confines candidate file reads but not network sockets; network access by candidate code is blocked only by the patch denylist
- Re-review gate precision is judged by a same-model blinded adjudicator session
- TrueForge sandbox provider not enabled; candidate patches were validated in a disposable clone inside the one-shot runner container
- Holdouts were written by the evaluator (Claude), not by an independent party.

## Hashes
- `baseline_instructions_sha256`: `59cd16ce41a81706f387efe3972e6f1e1a7c518f821f8ffa3ac37789eeb70741`
- `gate_keeper_instructions_sha256`: `e2bd56f4c01fa87462156331f58ba60b21fdd8da14daf3f148f8aba3c9585b84`
- `gate_keeper_lean_instructions_sha256`: `cada3295fe49d0a032b99afe21da9f554cc5031e9c0079b25b117c3cd14bb685`
- `output_contract_sha256`: `2967a32a90a6b764d2f9d49d8636827e9651257ab79320327c0e97bcf5a15167`
- `repair_contract_sha256`: `db16284884efa0163c9cbbf4c4cf0c930d7f512fe2a2ee9150945acded19bdcc`
- `gate_keeper_repair_sha256`: `dc982a4ae4fa123ffcaf5256ede0e65909f9edff64e71efc300b5eddde1456d9`
- `scorer_sha256`: `8096f1c871b327ba425ff3368cec34fbac400f777a4061f2ff7ae6ac55aecefd`
- `public_benchmark_sha256`: `72bcee7d4bdcffe6ce9337f64cadc1ecdd9203d4e7596cd64983aea183708dd2`
- `private_holdout_sha256`: `6ea7823d0b18d11d495774915b136c94d3848125f0e594013d07b55a25f70053`
- `evidence_manifest_sha256`: `c5f408111ada4f3a57239665350ade5385d9c8441654d2d3ba945d32c28f1491`
- `gate_keeper_lean_repair_sha256`: identical to `gate_keeper_repair_sha256`: the repair role does not include the review method, so both Gate Keeper arms repaired with the same prompt.

## Sessions
| Phase | Arm | Trial | Session |
|---|---|---|---|
| comparison | baseline | 1 | `01m6a2s72a104jpsvz9nczm1xv` |
| comparison | gate_keeper | 1 | `01m6a2s72kmtdakv5z0qg4dnm2` |
| comparison | gate_keeper_lean | 1 | `01m6a2s72y41d345ewfyy85bg6` |
| comparison | baseline | 2 | `01m6a3ag4b541d8bvzkhxq3rv9` |
| comparison | gate_keeper | 2 | `01m6a3ag4qefpf5rmjdsk9zers` |
| comparison | gate_keeper_lean | 2 | `01m6a3ag54x7p18nfz418rrsaa` |
| comparison | baseline | 3 | `01m6a3w6k7p80mm5zz8jpyktwt` |
| comparison | gate_keeper | 3 | `01m6a3w6kphjk59yc7hp4prggq` |
| comparison | gate_keeper_lean | 3 | `01m6a3w6m0zjenkht9hw96zkfw` |
| adjudication | - | - | `01m6a4dm71pzw25hd8vkdz2nxr` |
| drill | gate_keeper_lean | - | `01m6a4pgntnswcq6fsbf62q8j1` |
| drill | gate_keeper_lean | - | `01m6a4pxzzpkaje2d8djm75nt0` |
| drill | gate_keeper_lean | - | `01m6a4qda1zj5wcdr97pkbsteq` |
| drill | gate_keeper | - | `01m6a4qxkcae98f95ravqbdvmw` |
| drill | gate_keeper | - | `01m6a4rfakwkb3527ht9cgk4yn` |
| drill | gate_keeper | - | `01m6a4rymh78bqcyctdc2tj9sa` |
| adjudication | - | - | `01m6a4sp9f37zxwc5tf5vmgf6j` |
| drill | gate_keeper | - | `01m6a4thd6j2hbcf938ekapwd5` |
| drill | baseline | - | `01m6a4vsb2654fec9vqkyf3k5a` |
| drill | baseline | - | `01m6a4wb33qcbwnb384tmm8gh6` |
| drill | baseline | - | `01m6a4wnz6ghg4nk7xj90cq1sx` |
| drill | gate_keeper | - | `01m6a4wywcq7frp8thz73akfbx` |
| drill | gate_keeper | - | `01m6a4xdnrc7d8cv2sqfqsec93` |
| drill | baseline | - | `01m6a4ydrm60jasmsxnj8x59y3` |
| drill | baseline | - | `01m6a4yv3csf9cp25yjfkzk306` |
| drill | gate_keeper_lean | - | `01m6a4znba8zx19k8c0nw5pwa5` |
| drill | gate_keeper_lean | - | `01m6a5016d3zx4jwg62tcyr6qj` |
| drill | gate_keeper_lean | - | `01m6a5119twzsqksg2a6w5wdtr` |
| drill | gate_keeper_lean | - | `01m6a51g3t5ekss8m1akzv4203` |
| drill | gate_keeper_lean | - | `01m6a51wf6ca8ejv05536srhsn` |
| drill | gate_keeper_lean | - | `01m6a536dqt0m2thmyb3ec0gcx` |
| drill | baseline | - | `01m6a53snrdmd17r9jckyc80p6` |
| drill | baseline | - | `01m6a549xy6f6k6w7np2hz2hem` |
| drill | baseline | - | `01m6a54p9e25behcw1mk6e318b` |
| drill | baseline | - | `01m6a5607a47fzv1af5g5kkh4e` |
| drill | gate_keeper | - | `01m6a570tyb2qwh0ca7e8r6tgc` |
| drill | gate_keeper | - | `01m6a57jjwkdawzgg69aes1sn3` |
| drill | gate_keeper | - | `01m6a584verfhd2pbrke12ehtw` |
| drill | baseline | - | `01m6a58v1yezfyhja44vfgfc01` |
| drill | baseline | - | `01m6a59bbrzvf5c0rh1tpy71yp` |
| drill | baseline | - | `01m6a59w4s01sk7acqpr69acy2` |
| drill | gate_keeper_lean | - | `01m6a5aktmk61rvzeejcvz7j30` |
| drill | gate_keeper_lean | - | `01m6a5b8h919rn9m7td7j23c62` |
| drill | gate_keeper_lean | - | `01m6a5c25rm05qeyrev3rgzaw3` |
| drill | gate_keeper_lean | - | `01m6a5e57t08v7qfqpq9zbfx6c` |
| drill | gate_keeper | - | `01m6a5fa7ch7zrcv5knbhkfwys` |
| drill | gate_keeper | - | `01m6a5fp1t7vwf2zbf774qtgfr` |
| drill | gate_keeper | - | `01m6a5gxfnz2zvwwh5wp6nh7w7` |
| drill | baseline | - | `01m6a5jjpjd7zcwfrgydn7rfdt` |
| drill | baseline | - | `01m6a5k00q9y3eb4chvd7eer6z` |
| drill | baseline | - | `01m6a5krsd78esfgb3x57w4z4r` |
| drill | gate_keeper_lean | - | `01m6a5pbhjk6dt930mx1yzv5tz` |
| drill | gate_keeper_lean | - | `01m6a5ptanwe3dp05535m5y1n2` |
| drill | gate_keeper_lean | - | `01m6a5r1s8dqah7ej384etsnw2` |
| drill | gate_keeper | - | `01m6a5sfkvjjy52r10fv25dr1s` |
| drill | gate_keeper | - | `01m6a5swxz1fvgyet02gzznw6s` |
| drill | gate_keeper | - | `01m6a5tdq9qyrx6sxkjz1v3jwd` |
| drill | gate_keeper | - | `01m6a5w20an0a1m06kf6jfpfb2` |
| drill | gate_keeper_lean | - | `01m6a5x2hpvzc324e498bfp1yn` |
| drill | gate_keeper_lean | - | `01m6a5xfvrv091zbdryene4xs1` |
| drill | gate_keeper_lean | - | `01m6a5y735zegnpsgntrqdfsp3` |
| drill | baseline | - | `01m6a5ymeq2de7mme4g8bbny14` |
| drill | baseline | - | `01m6a5z389tj9tc02ergrqycjq` |
| drill | baseline | - | `01m6a5zfkhagcfbexzfgnr9b1r` |
| drill | baseline | - | `01m6a60gqes49e7gsnjffy875b` |
| drill | gate_keeper | - | `01m6a61eb745c4hambnpc6m7n9` |
| drill | gate_keeper | - | `01m6a61vnnvgapsnqstpbhj289` |
| drill | gate_keeper | - | `01m6a62nx227atspevhczs152x` |
| drill | - | - | `01m6a63kftt4a22ymxbt3snssb` |
| drill | gate_keeper | - | `01m6a64h7pnd9cn6rxjjm3nqy6` |
| drill | gate_keeper | - | `01m6a64x327hjg7he1ravypq5p` |
| drill | gate_keeper | - | `01m6a65yn0k06cbmbhc9fwhn8f` |
| drill | gate_keeper | - | `01m6a679k51nkb8h6jh3zbrzjj` |
| drill | gate_keeper | - | `01m6a67vatnm34msxtcsmx8rey` |
| drill | gate_keeper | - | `01m6a68gjq76n5w0zb0tvzkkh3` |
| drill | gate_keeper | - | `01m6a6af5nkvysh0xpqa33r45v` |

## Private evidence
| Kind | Path | SHA-256 |
|---|---|---|
| preflight | `preflight.json` | `182bb824a4e7f17d3817b2ceebf755765758d2eee26f9006914b27c90e368e9a` |
| adjudication | `private/adjudication/01-python-utils-0-0.json` | `19908ecb6665e73e7ded51d3ca3d5013d7ca92698cd4e25a220cbe48e45c4305` |
| adjudication | `private/adjudication/02-express-users-0-0.json` | `0d7abb8f83a9d2ad0d8b50b5e9aa513f219ce6a0940391df955a33e3477bbf64` |
| adjudication | `private/adjudication/02-express-users-30-0.json` | `091a03f156e9fa0e008976dae37572b70e85b083b54f2ff768cc666ec264f5cc` |
| adjudication | `private/adjudication/03-python-deploy-0-0.json` | `40b567cc5ef327f9057518bcdbebfd808951e18e4090d952e1f25f160b208ba5` |
| adjudication | `private/adjudication/03-python-deploy-30-0.json` | `c8e60143781e883a07ab2dc9666f86a47f54d214e9d9b011d8b50407505e66dd` |
| adjudication | `private/adjudication/04-ts-fetch-0-0.json` | `ede0f6fb1edd8e409d1cd5bdba0cf15ffde459274da75c7ed6fc9bee22f2eab4` |
| adjudication | `private/adjudication/holdout-1-0-0.json` | `682b2dc12159ef6524a821afb06152c06c2f0a8f537ade438731548bfa359f60` |
| adjudication | `private/adjudication/holdout-2-0-0.json` | `61d858a4632bca55caaf95d977aaf6c32e9a96fddbcc24f72efb6e3f2416d5b1` |
| adjudication | `private/adjudication/holdout-3-0-0.json` | `fe1dfc91d38416b9b4c7c22232f5d7049a54c537beebe9b288cebf8a1251aaa1` |
| adjudication | `private/adjudication/holdout-4-0-0.json` | `2dcccbc2bb59deea78b4aaeacde76c1f8fc18b8245bd3287bb13ed6bcf72a0c5` |
| adjudication | `private/adjudication/holdout-5-0-0.json` | `f5aca9e09fd56a1088fdfd64a4fef716e31575fcbe117bf0e4d0df6e8972327a` |
| adjudication | `private/adjudication/holdout-6-0-0.json` | `28d95462462313801ad89fe26482141c7135cddf8ef4f37fcec93737a3d4d2a2` |
| adjudication | `private/adjudication/holdout-6-30-0.json` | `db2c9d3a332790764471a3353a928623e309a2efad0471847c17506c74f298b7` |
| adjudication | `private/adjudication/holdout-7-0-0.json` | `61b252c8e6b915f1b6ccf80a2f35fe369aadaadeaa249f5a0bd7328eb9f4cf92` |
| adjudication | `private/adjudication/holdout-8-0-0.json` | `e7eb48ff480b5d658b499331d4ea60c397e99957f72ba7beb7a91eea8d13dcc0` |
| unblinding_key | `private/blinding-key.json` | `8e6e904eed37049dcd8c9e3684e164076c3897a0bc851f185f9775a2e459166f` |
| candidate_replies | `private/comparison-replies.json` | `827be77ecbdba114d41c0f7512fbbb0fb02ae031f008950e0df9c087e4a9c1ff` |
| v_model_test_logs | `private/drill/baseline-escape-attempt1-validation.json` | `4e5dc27cd6b52e541e09de7089094974a389827bb66890b5e17e0dcaaef4fb41` |
| candidate_patch | `private/drill/baseline-escape-attempt1.diff` | `2f3fffe61719405d793f8fc805ab0f926cba26cbb1712dd249eaf0a44d4ab30c` |
| v_model_test_logs | `private/drill/baseline-money-attempt1-validation.json` | `72fe821c6eff53ffe30fe7c1fdfb4b0cb717ff761e9f6f6c70d6f573b1deb8c7` |
| candidate_patch | `private/drill/baseline-money-attempt1.diff` | `a911092bade1262843ee36d8d74eb065e9df9c062402954f316771934d79ea16` |
| gate_adjudication | `private/drill/baseline-pagination-attempt1-gate-adjudication.json` | `6a34b7b930b732124b2c7b0e236602332c9bea8c622c4908b34ab750bfd72941` |
| v_model_test_logs | `private/drill/baseline-pagination-attempt1-validation.json` | `6130215994e5cf124ed7f520f87265db0f4d66c8af7939b0b582eb635c6d0de8` |
| candidate_patch | `private/drill/baseline-pagination-attempt1.diff` | `1ec8307ac149373586146b430b07747390246d5b037e666d946af0325144b41f` |
| gate_adjudication | `private/drill/baseline-pagination-attempt2-gate-adjudication.json` | `65b7870f9967fd364b3f39c06edb4d5c4b49affbf3a392b4dcf8a4a58a5651d2` |
| v_model_test_logs | `private/drill/baseline-pagination-attempt2-validation.json` | `1dc1843e6967b40087973a08e712cc42ae963ccae7e03bb71b5675ceadc5af3a` |
| candidate_patch | `private/drill/baseline-pagination-attempt2.diff` | `85440a40c0e16a01c2fd9e7b406526eaa5b7183afb4eefc0918913eebd73fe36` |
| v_model_test_logs | `private/drill/baseline-redirect-attempt1-validation.json` | `97cf42e92b43e3a948ce3ae19d5f9f55df7ff095e9dc3e0d1e78a4d480209c42` |
| candidate_patch | `private/drill/baseline-redirect-attempt1.diff` | `07db9e91160f641b67a5d77df599fa88f0c198bfdf7d3e69a286b9030bdc2d28` |
| gate_adjudication | `private/drill/baseline-redirect-attempt2-gate-adjudication.json` | `fc30686b76ea9a47420b7d141c270c851b2664f400081c0edfd942caaa5680ba` |
| v_model_test_logs | `private/drill/baseline-redirect-attempt2-validation.json` | `5476162e13ffa1089a0c65ae5fd84523a0f0520bb40bf7e6691af58f57a8dbf3` |
| candidate_patch | `private/drill/baseline-redirect-attempt2.diff` | `89d390771a47491cf310e292855d55668dbdcea047768b5a1104afa85e0cdd71` |
| gate_adjudication | `private/drill/baseline-retry-attempt1-gate-adjudication.json` | `3ff3b20a664b7e7c95940a578f4c54220de75b45e3baf0fded3635ae4f1ed26f` |
| v_model_test_logs | `private/drill/baseline-retry-attempt1-validation.json` | `9b7ea771cda65c88d5e3d4c61b8a510142aa316a8dd5b9ff559ac0c112a1c239` |
| candidate_patch | `private/drill/baseline-retry-attempt1.diff` | `07defbdba58ffaa579e2260af912fa9af7e105b3c6d77c191e520573041618a4` |
| gate_adjudication | `private/drill/baseline-retry-attempt2-gate-adjudication.json` | `14d4cced4ecfd2b68a73a593ccb4df8dc7bfd443b1415b91c71ae0b3b0871a0d` |
| v_model_test_logs | `private/drill/baseline-retry-attempt2-validation.json` | `14f729bd16524f048891286b64e8a42980d1a17c5c2ca9d58f2d3bf15a7522f0` |
| candidate_patch | `private/drill/baseline-retry-attempt2.diff` | `44bd79e5dd9cb02ec29d04ed87f99ef917494cc0a286f8b896c085fbcae792fd` |
| v_model_test_logs | `private/drill/baseline-uploads-attempt1-validation.json` | `b6436911468ce201ea61689c14e1b10d705612423690ace66a3c2d1de853bfb7` |
| candidate_patch | `private/drill/baseline-uploads-attempt1.diff` | `47330e6e7cb728048a766e3ae6b6680d8dd4fd46674f8413907ed0ecf0ce4d05` |
| v_model_test_logs | `private/drill/baseline-uploads-attempt2-validation.json` | `657d9420ca07d66d5b00da522252b8f42709c083c9b66d534b8cbb2461bef86a` |
| candidate_patch | `private/drill/baseline-uploads-attempt2.diff` | `254a3d27bcaa46d08cf3852dc5743ed70c373f41c1d1fda3cf1556452d8e8e0d` |
| drill_record | `private/drill/cycles.json` | `b6d79169122736878dbd644137da415a572e390d4f565ad7464a220fb802c776` |
| gate_adjudication | `private/drill/gate_keeper_lean-escape-attempt1-gate-adjudication.json` | `6f9ed5eaa4fe9f1cdefcd8a3cebb5632fb81c478667e582793b131e588b37b91` |
| v_model_test_logs | `private/drill/gate_keeper_lean-escape-attempt1-validation.json` | `74c2e61791376c92713b7a3cabbef3a34670c54cbb1c1c4c8b11b8cdcf708e76` |
| candidate_patch | `private/drill/gate_keeper_lean-escape-attempt1.diff` | `1f3ffb2c38df28489fcbd4af101797ad38aca8356a729264f1e7a9a64a1837f8` |
| gate_adjudication | `private/drill/gate_keeper_lean-escape-attempt2-gate-adjudication.json` | `972fb89842d0979f844f318cfdde03af1cbd1372c7cfe6813776cbb84411fa38` |
| v_model_test_logs | `private/drill/gate_keeper_lean-escape-attempt2-validation.json` | `2a4ccd1beea66f41a0805c03e3b88796535b8adc5e6a5544287497cb90920c0b` |
| candidate_patch | `private/drill/gate_keeper_lean-escape-attempt2.diff` | `f7c79d7347a3e2ce38b9d8e55a2433e7fcd2097f17b5eac6764993bfb6214419` |
| v_model_test_logs | `private/drill/gate_keeper_lean-money-attempt1-validation.json` | `a3b3a7bdcb46c62356da334c7a61be6821ebbde64119d38d1152b5662cd5663a` |
| candidate_patch | `private/drill/gate_keeper_lean-money-attempt1.diff` | `206b3719a2cbf24ea4e0ce79d051c8abb4452165df33389a4a3c24bc347ba34f` |
| gate_adjudication | `private/drill/gate_keeper_lean-pagination-attempt1-gate-adjudication.json` | `6c376377249373658bd27b68662d020f82192e19d2b67237d23150af1714f6cf` |
| v_model_test_logs | `private/drill/gate_keeper_lean-pagination-attempt1-validation.json` | `d1aa9f6d691b78c2277f3fbabab4dcdacf7b9dfff2bb7b6de840b05914fb768b` |
| candidate_patch | `private/drill/gate_keeper_lean-pagination-attempt1.diff` | `29ca34be2f73fad7aeabfb6c8d2eb9c5ec343757ccd8b98f758a33c8e3fc6d59` |
| v_model_test_logs | `private/drill/gate_keeper_lean-pagination-attempt2-validation.json` | `0f77ed847db7bbeb1d6957864597d1fac5fb5d7208e3dc299ef942bca4339063` |
| candidate_patch | `private/drill/gate_keeper_lean-pagination-attempt2.diff` | `ef48aaa149db1788abb1afd3d4afa171f8d8386d8130f579aef88a6e8d18847c` |
| v_model_test_logs | `private/drill/gate_keeper_lean-redirect-attempt1-validation.json` | `6e741a81f10aee685e99657e7fd34414dbe56f453520619ed229412d942b25e9` |
| candidate_patch | `private/drill/gate_keeper_lean-redirect-attempt1.diff` | `bfa4d3a37b35c467e557c74725ff920f7155f0a3060fe60d113078a37f018c6c` |
| gate_adjudication | `private/drill/gate_keeper_lean-redirect-attempt2-gate-adjudication.json` | `7d8272021a58f18e27ee7f9ab5a0a75345bdf2c9ab454b2f50a7d940720e89c3` |
| v_model_test_logs | `private/drill/gate_keeper_lean-redirect-attempt2-validation.json` | `a6c8bc96bd84b04ff1d3f5582c7c2d71dc3950904d1466edc22e27c395645eb0` |
| candidate_patch | `private/drill/gate_keeper_lean-redirect-attempt2.diff` | `7febe6a16da13f0b19a948885f982338abcefd53c684185ba716f9fe8c52370e` |
| v_model_test_logs | `private/drill/gate_keeper_lean-retry-attempt1-validation.json` | `d94567f31d63c50d91f62f21231dadbd89f637a8ebd3baaf8dc2a907af4bb8a2` |
| candidate_patch | `private/drill/gate_keeper_lean-retry-attempt1.diff` | `a5e52255ff986feb430fc62657e26e3f1bf5c16008cf11ba9b0ccfa4ea50a80c` |
| v_model_test_logs | `private/drill/gate_keeper_lean-retry-attempt2-validation.json` | `ea5bf3a6193155ff730a47a0f020ea39b7f3c9c3376934a267a74abb4952b855` |
| candidate_patch | `private/drill/gate_keeper_lean-retry-attempt2.diff` | `eedd44d6c54cd166c555f9bf4510629123153fcd54d29e761bc2c03f192f322d` |
| v_model_test_logs | `private/drill/gate_keeper_lean-uploads-attempt1-validation.json` | `e6f3e1e82ec2e3794c7e3a40dc1e9bec766f66d15eb839a1e87b4f1ac093bf1e` |
| candidate_patch | `private/drill/gate_keeper_lean-uploads-attempt1.diff` | `8ddebd37c74262ea79ff91dab9fa3b1b34e9cca420e15672095cce6ca4f070d3` |
| v_model_test_logs | `private/drill/gate_keeper_lean-uploads-attempt2-validation.json` | `b3e7cde18bd6f495b9dbcf08cacf542beb209a6fb645bf17f29c4dbc9456ce60` |
| candidate_patch | `private/drill/gate_keeper_lean-uploads-attempt2.diff` | `6cfa3870958e31f80f9993d969459af0f0bf0bed67b14cb89eff488955888c44` |
| v_model_test_logs | `private/drill/gate_keeper-archive-control-attempt1-validation.json` | `85431a81349caa8a4b4820f31fdae9b2640de6d31a2d2b64b701c5c3dc1630a0` |
| candidate_patch | `private/drill/gate_keeper-archive-control-attempt1.diff` | `803de06e63e337d29381b6b72caaa4ad945a52d581cd978f8e0aa8239bb99e73` |
| gate_adjudication | `private/drill/gate_keeper-archive-control-attempt2-gate-adjudication.json` | `bf45807a8c9747e67f6dd5ccc69f317b13591f2a45b450566ef03a3ba2a5a1b1` |
| v_model_test_logs | `private/drill/gate_keeper-archive-control-attempt2-validation.json` | `3177b5ae287e9f48b06d0b71ea07c488f7f588d9642aa6da76a86b45ee578e95` |
| candidate_patch | `private/drill/gate_keeper-archive-control-attempt2.diff` | `1b3bfa40b9927d8211a72b3ac1ab14d92c69e8b0223f807be72c45c3762a8494` |
| gate_adjudication | `private/drill/gate_keeper-archive-with-lesson-attempt1-gate-adjudication.json` | `405dc947234f251e1a6fe104f22489267b86f9803595f29a5b39d54b4671ca45` |
| v_model_test_logs | `private/drill/gate_keeper-archive-with-lesson-attempt1-validation.json` | `22e97f518b66ac325141e0d15b933a65dddbe6efe39836b1b44d04682f3a6362` |
| candidate_patch | `private/drill/gate_keeper-archive-with-lesson-attempt1.diff` | `dc1345bcf77186789fe7af81b7dbe204afa2375f79663100b216fdb69d98f66e` |
| v_model_test_logs | `private/drill/gate_keeper-archive-with-lesson-attempt2-validation.json` | `eae2cc84e5b43a718c559e9f51535a6ef02042f52048c43fe2b15e46cd0b8ebb` |
| candidate_patch | `private/drill/gate_keeper-archive-with-lesson-attempt2.diff` | `9c50ace5889e6e5c52884a23c7cc9a2ad8725a41d1455c3b42b049d9b253cb65` |
| v_model_test_logs | `private/drill/gate_keeper-escape-attempt1-validation.json` | `bf7141a89d74fc1c5205697302c17be877e65582255209de3c02a84f87342d5e` |
| candidate_patch | `private/drill/gate_keeper-escape-attempt1.diff` | `3c84d8c3f53ee951e55856e3151ff62b3c626c6331b1e39d991f3fe131fd2d29` |
| gate_adjudication | `private/drill/gate_keeper-escape-attempt2-gate-adjudication.json` | `e86eebc63e3dca24f05669fa91058d285b465249e21ccfd3392f2e323982a331` |
| v_model_test_logs | `private/drill/gate_keeper-escape-attempt2-validation.json` | `2c5a6e448843d976511b62b0f637fdc819fe0d4da7f83574c4b60f3ed032f740` |
| candidate_patch | `private/drill/gate_keeper-escape-attempt2.diff` | `4e4f1eba8d4973ff815a8a1dbb8247a063692d25d3aa4b1bc25d642a9a7c2f03` |
| gate_adjudication | `private/drill/gate_keeper-money-attempt1-gate-adjudication.json` | `c63e1a4e6d02d9d57766f21a234532a1a20135bc902d8d7327c93e25313154f1` |
| v_model_test_logs | `private/drill/gate_keeper-money-attempt1-validation.json` | `7a3c61a85596967dd99b437962becb4dc2ab69e5ea5b4c885202f853d719bfb7` |
| candidate_patch | `private/drill/gate_keeper-money-attempt1.diff` | `206b3719a2cbf24ea4e0ce79d051c8abb4452165df33389a4a3c24bc347ba34f` |
| gate_adjudication | `private/drill/gate_keeper-money-attempt2-gate-adjudication.json` | `6cded92e9438db401eb8ca9d646de52e6e85e95cefd2efd414f377f0e0b5d7bc` |
| v_model_test_logs | `private/drill/gate_keeper-money-attempt2-validation.json` | `66972b9ae5020a34d2b71773d47c3fae419945a283ff5687cb8738f8bc7f4fc3` |
| candidate_patch | `private/drill/gate_keeper-money-attempt2.diff` | `3b0923a522c3b7ca657bab99cbb661678552ec2a7b18c9b4b99ae253a6d2686c` |
| v_model_test_logs | `private/drill/gate_keeper-pagination-attempt1-validation.json` | `842b6ae860436be6a96d63a9738f4ea57d6a9db01ad792cc17d28d8c504c86e8` |
| candidate_patch | `private/drill/gate_keeper-pagination-attempt1.diff` | `0eb44de79b18209f9820638a70055a94acef65536352e66ff212a485eaef90af` |
| gate_adjudication | `private/drill/gate_keeper-redirect-attempt1-gate-adjudication.json` | `062400464a546f64b80dcafdfb4bb85c9d63af6f50af392ff784a6ec96c848e6` |
| v_model_test_logs | `private/drill/gate_keeper-redirect-attempt1-validation.json` | `b80f2866fefe3d80cafcf4bdc02865592a625058a5a87b2a780e72951d453203` |
| candidate_patch | `private/drill/gate_keeper-redirect-attempt1.diff` | `b013efba120bd4d3a49f79bbdae91595ed9eb3970695277bc129c9fe89ecbc50` |
| v_model_test_logs | `private/drill/gate_keeper-redirect-attempt2-validation.json` | `ff07d978bdb3766fb96a4bfed50f743e0dda1ba04d67ada863f6f4f30861b845` |
| candidate_patch | `private/drill/gate_keeper-redirect-attempt2.diff` | `34134746291f712fa7ba0de7e151160ce1e66d01564489cc012e6cbf612bff6f` |
| v_model_test_logs | `private/drill/gate_keeper-retry-attempt1-validation.json` | `ab8e816d989b65e272dfca2a792c4fb4c2af1a3899cd67d8dddc874aa7de51e1` |
| candidate_patch | `private/drill/gate_keeper-retry-attempt1.diff` | `a5e52255ff986feb430fc62657e26e3f1bf5c16008cf11ba9b0ccfa4ea50a80c` |
| gate_adjudication | `private/drill/gate_keeper-retry-attempt2-gate-adjudication.json` | `d33166fdabd2d232458b1d171f50aa0fd912601e687368cbbc65d5911a787faa` |
| v_model_test_logs | `private/drill/gate_keeper-retry-attempt2-validation.json` | `ab3e4d971df79172ce6a67d502df7d4245a97b997e4b8f6a88d73d112535901b` |
| candidate_patch | `private/drill/gate_keeper-retry-attempt2.diff` | `8fc45782a3f14ea1650383adcdfe85508c53be72e8f87200fc4ce9a9ac4f79f1` |
| v_model_test_logs | `private/drill/gate_keeper-uploads-attempt1-validation.json` | `7f242ed51493ad53a9c285ccb6cf056482417c95f061892df1c3f0abc525a883` |
| candidate_patch | `private/drill/gate_keeper-uploads-attempt1.diff` | `d9c70f6cabc4978a2673dc90dc28a38ab7acfb4c5260111c1269260167a2c529` |
| v_model_test_logs | `private/drill/gate_keeper-uploads-attempt2-validation.json` | `a6c9b1077f6e4e1f5ded213c8ab2223fb943bddf94fe53e18f7985673c0fae54` |
| candidate_patch | `private/drill/gate_keeper-uploads-attempt2.diff` | `3dae6fb38081036ac4b5d55ec9b3547b01fbc5f1b6b07847cc6f0238995f345b` |
| private_holdout | `private/holdout-tasks.json` | `bd9f90555043cb89836d3f63b3679dc563b13ffdac3e2f25019ea7fbd4ad7042` |
| tenant_private_lesson | `private/lessons/tenant-alpha-money.json` | `8eefa2cc1b6605b493e969bdb584294273689bf64e6b5472a03a9395c1efd7ff` |
| tenant_private_lesson | `private/lessons/tenant-beta-uploads.json` | `e56ccc4adcb85c15bb44cf6b8ad9db657c39d22f546d984d43ef48b2000a099c` |
| tenant_private_lesson | `private/lessons/tenant-delta-escape.json` | `b78331f56b66a4c2e7d5c7967b808e6cd26654f6d0746068b88c01befb90a2d0` |
| tenant_private_lesson | `private/lessons/tenant-epsilon-redirect.json` | `0650248544cf62f02764d7c7a519d879cd24b8739e696fc8811c9f31cfb5516f` |
| tenant_private_lesson | `private/lessons/tenant-gamma-pagination.json` | `32e32fb6d984419548114c724587e5049fe1b6cc17d74882fda3bc86ecf448f6` |
| tenant_private_lesson | `private/lessons/tenant-zeta-retry.json` | `59379fecbeeaf4a478c9973f4628c634275b57a536ab429ecbc1b4c6b1155e14` |
| trueforge_session_trace | `private/sessions/01m6a2s72a104jpsvz9nczm1xv.json` | `bc74e643818168caa42765a5e6ae0e5773096fec7203766235fbf06254c86455` |
| trueforge_session_trace | `private/sessions/01m6a2s72kmtdakv5z0qg4dnm2.json` | `8da77685b86134c5b87578e27428957814be98f05ee611a80cf3dd48bf4b5dcd` |
| trueforge_session_trace | `private/sessions/01m6a2s72y41d345ewfyy85bg6.json` | `d4bf8ba6ac9fac0eb205e29e26db252796da1cf7cd79dafb8684bba9b027c00c` |
| trueforge_session_trace | `private/sessions/01m6a3ag4b541d8bvzkhxq3rv9.json` | `a060f7596f61365a05c03eebab3410461f3a39d5c92faf8758ff0d7ac8e20d4b` |
| trueforge_session_trace | `private/sessions/01m6a3ag4qefpf5rmjdsk9zers.json` | `7c2a16c2614f36b7b26b55ea1d94b48e5d149a513ca8cf08ce73c1461e5f6ff0` |
| trueforge_session_trace | `private/sessions/01m6a3ag54x7p18nfz418rrsaa.json` | `cf74ca4ef256ed182d23dbd5233aa3c5c042b4b1a9ffe916de0efd73caa1e418` |
| trueforge_session_trace | `private/sessions/01m6a3w6k7p80mm5zz8jpyktwt.json` | `7e88a5931ebb4dd979eeb9b30cab42874a9fb4ccf8fd40a7e4767f9696b9606d` |
| trueforge_session_trace | `private/sessions/01m6a3w6kphjk59yc7hp4prggq.json` | `5ee33be7c085f39a9d03ade164d7a6d8f9af348be4af01a9aa8cb0295e980c8d` |
| trueforge_session_trace | `private/sessions/01m6a3w6m0zjenkht9hw96zkfw.json` | `918370b07a8382c26887e1bf2ade46144442314ccc00041b8d223a56766ca7fa` |
| trueforge_session_trace | `private/sessions/01m6a4dm71pzw25hd8vkdz2nxr.json` | `f162a753b75d017908325760fd90fd4af2441af653696d9c61badf2b9e2b625e` |
| trueforge_session_trace | `private/sessions/01m6a4pgntnswcq6fsbf62q8j1.json` | `13abc2ed82477d0eaaf29ee9339e87785d11044713c8feaf2f9dae03ddee2c57` |
| trueforge_session_trace | `private/sessions/01m6a4pxzzpkaje2d8djm75nt0.json` | `0c7bc5145250e61497f131f032efdaa5b69aca2d8cefec1d00aba18d400a5a54` |
| trueforge_session_trace | `private/sessions/01m6a4qda1zj5wcdr97pkbsteq.json` | `411cc7292a546a3647a1f62160239f9c1acfd65254ff711f8f246b9fa0c375ff` |
| trueforge_session_trace | `private/sessions/01m6a4qxkcae98f95ravqbdvmw.json` | `ab7050f645c31287c503384fa428238db6a642c953b09a19622b5f867677eb99` |
| trueforge_session_trace | `private/sessions/01m6a4rfakwkb3527ht9cgk4yn.json` | `39e936b02eb8e7f28e19dd235d452f421c5037a4e83a413c35f58a0bcd88e8a3` |
| trueforge_session_trace | `private/sessions/01m6a4rymh78bqcyctdc2tj9sa.json` | `793ab460c74bcb6e69042aba8f6b04140621be94c2242bdf997afff39c8db46a` |
| trueforge_session_trace | `private/sessions/01m6a4sp9f37zxwc5tf5vmgf6j.json` | `c7df762847871e79b37e227ea89e9e181507b88d0a89ceaff160753a0aadd267` |
| trueforge_session_trace | `private/sessions/01m6a4thd6j2hbcf938ekapwd5.json` | `a1ce8ed59e9e101231622c542ef0bb4e86928054ff39b0f0054e97274385073c` |
| trueforge_session_trace | `private/sessions/01m6a4vsb2654fec9vqkyf3k5a.json` | `885e9a1e7d86bf976db03c96ae1390cd6c4965a6050345f84299d21f149ddca0` |
| trueforge_session_trace | `private/sessions/01m6a4wb33qcbwnb384tmm8gh6.json` | `07fd6a8b45b95a383ca312063afe3a45afc849eea9cf45542be605b2f0774977` |
| trueforge_session_trace | `private/sessions/01m6a4wnz6ghg4nk7xj90cq1sx.json` | `6e420558fba8bfceb695866febe5224dd846bafd49e7c93e7cb2e053846bfc29` |
| trueforge_session_trace | `private/sessions/01m6a4wywcq7frp8thz73akfbx.json` | `06f6b99ab543dced6c3ea9cedb426ceb945cda66a1a926f4a94ec76e31eb6ba7` |
| trueforge_session_trace | `private/sessions/01m6a4xdnrc7d8cv2sqfqsec93.json` | `1658ce1306fe7053962af365abc8bafb6db3d5164d715036287c34b808e5e119` |
| trueforge_session_trace | `private/sessions/01m6a4ydrm60jasmsxnj8x59y3.json` | `4d5526075ebbd81ce2d255a7a4ea63d5667667d33f04c878cbd06e9ae8f296c8` |
| trueforge_session_trace | `private/sessions/01m6a4yv3csf9cp25yjfkzk306.json` | `49d4a8a1300c14b3848520d4c1cbeb564027a044c67cbf91e80cd37cd0867c8a` |
| trueforge_session_trace | `private/sessions/01m6a4znba8zx19k8c0nw5pwa5.json` | `e699b0c09bc9ee319f11d9059a10be2279b4d5f6801af11a76dda51761d5591d` |
| trueforge_session_trace | `private/sessions/01m6a5016d3zx4jwg62tcyr6qj.json` | `2e977b081df2b351a2b07559e700d1ef70dc00c4be63f6c7db80704cf4cdc20a` |
| trueforge_session_trace | `private/sessions/01m6a5119twzsqksg2a6w5wdtr.json` | `db15978de7f50107e9f02e6b3828b271f985f8d54cfaa7f26a9a69844cede514` |
| trueforge_session_trace | `private/sessions/01m6a51g3t5ekss8m1akzv4203.json` | `dd133dd485df3d9551ed448597ca6206c45f94ef7ab4d7e727cfce983cb3bb45` |
| trueforge_session_trace | `private/sessions/01m6a51wf6ca8ejv05536srhsn.json` | `46e6908639bffe117213121f4c39208ee514a1e59b94c2a510cf4b11be874ba6` |
| trueforge_session_trace | `private/sessions/01m6a536dqt0m2thmyb3ec0gcx.json` | `4c71164b1b7a8dd8bd0f1d87fe146b6645497859438b9f897cc31234da9b96b0` |
| trueforge_session_trace | `private/sessions/01m6a53snrdmd17r9jckyc80p6.json` | `6884039f46862de18269421601df15d0dfc5a05aabb1f69d3f178461e1682cdf` |
| trueforge_session_trace | `private/sessions/01m6a549xy6f6k6w7np2hz2hem.json` | `7366b886d11671e9fb4ba30d4c003225398e54d761fef7c4564c12e5590be9f0` |
| trueforge_session_trace | `private/sessions/01m6a54p9e25behcw1mk6e318b.json` | `1d534c4fe089259596987dee15e0cda467f99247c2d0718168d3639f9d55c385` |
| trueforge_session_trace | `private/sessions/01m6a5607a47fzv1af5g5kkh4e.json` | `85722a3a039b57ea6e83e8416e8fa127bc834d307e233c4822f69afa5db6ddc8` |
| trueforge_session_trace | `private/sessions/01m6a570tyb2qwh0ca7e8r6tgc.json` | `a6368302dde2717fbb16cab7715f14841fe56b911c2a2b854062e780d8fe74f3` |
| trueforge_session_trace | `private/sessions/01m6a57jjwkdawzgg69aes1sn3.json` | `63fa279bea0a78e784f57f98facc8ed1b6979279f10a4774e671ea8c14002a42` |
| trueforge_session_trace | `private/sessions/01m6a584verfhd2pbrke12ehtw.json` | `b91b5ff8ee49fe88d31508ef30cb31e697f1a9148aef8a457f19b67e77a3f6b8` |
| trueforge_session_trace | `private/sessions/01m6a58v1yezfyhja44vfgfc01.json` | `a38962b53569241c3c1b1ddde70319a8d815621b7036feeda515d46c877ee0f7` |
| trueforge_session_trace | `private/sessions/01m6a59bbrzvf5c0rh1tpy71yp.json` | `48f4f994ceec34e4edc3708d2119c46a2cceb3859b217cb93f409ed8c37f87cb` |
| trueforge_session_trace | `private/sessions/01m6a59w4s01sk7acqpr69acy2.json` | `7e532f30e2db4407846383a3664c2377f76b3cccab903994bf65ebfa57903505` |
| trueforge_session_trace | `private/sessions/01m6a5aktmk61rvzeejcvz7j30.json` | `0ad0ba77d9c3d9773640ad20b40590f58e5152389e8124296e012a4e1ac1a07e` |
| trueforge_session_trace | `private/sessions/01m6a5b8h919rn9m7td7j23c62.json` | `f9e33a38e29227f7287512439b3d5f3d643e83410fe432e99b3beb253397390d` |
| trueforge_session_trace | `private/sessions/01m6a5c25rm05qeyrev3rgzaw3.json` | `64c06429144ece981960b1947d4a833ca88f80f721e5bea71c36a22d7817752d` |
| trueforge_session_trace | `private/sessions/01m6a5e57t08v7qfqpq9zbfx6c.json` | `5905554c75862e970fb7771c8dbe0bd2abf7060b2abd51c168d1f0e42d34c891` |
| trueforge_session_trace | `private/sessions/01m6a5fa7ch7zrcv5knbhkfwys.json` | `335808d202e2fb8888f005534964fe13a48fd0a1ba60194e29f4d63c4b08d293` |
| trueforge_session_trace | `private/sessions/01m6a5fp1t7vwf2zbf774qtgfr.json` | `0409bd241ccde632622cf20182df17861ced563e2d08029b39405c7a83b32ec0` |
| trueforge_session_trace | `private/sessions/01m6a5gxfnz2zvwwh5wp6nh7w7.json` | `0191ea05541e1f3a266497b08d98b9ce0f0d443860ee30478d55f2516bf6449d` |
| trueforge_session_trace | `private/sessions/01m6a5jjpjd7zcwfrgydn7rfdt.json` | `331d5e6b99c47a88d83b3c238430a99b3a4230a7337b57d43868e911f5664883` |
| trueforge_session_trace | `private/sessions/01m6a5k00q9y3eb4chvd7eer6z.json` | `88279698f1f9348d23bf8e5d8b8133e393cdf8655b854b758cd9c235b327b04b` |
| trueforge_session_trace | `private/sessions/01m6a5krsd78esfgb3x57w4z4r.json` | `ad6fc1fc31d672867d964fb53de616f749b51a77a1f854d37f21dc9face808f0` |
| trueforge_session_trace | `private/sessions/01m6a5pbhjk6dt930mx1yzv5tz.json` | `f9312df8a07dac78f0d120c839923275ef7d90019b01b6faef36b37d477d7d64` |
| trueforge_session_trace | `private/sessions/01m6a5ptanwe3dp05535m5y1n2.json` | `da6e5ae2cf382fede6697219ccac91d45db8d127817fc955597fc121b60b3745` |
| trueforge_session_trace | `private/sessions/01m6a5r1s8dqah7ej384etsnw2.json` | `8ffca69d090a3ed0f6b2ac50e95a90ef0461fce85fb157b859f4691bb0f806d1` |
| trueforge_session_trace | `private/sessions/01m6a5sfkvjjy52r10fv25dr1s.json` | `c113a019bbde61810315be0395512f6bf74179b6179f6a2c3491459142c2e2ed` |
| trueforge_session_trace | `private/sessions/01m6a5swxz1fvgyet02gzznw6s.json` | `f0c70e97e949e73e1082f2700f66578daaab6874273d2481e86a7717c86bf865` |
| trueforge_session_trace | `private/sessions/01m6a5tdq9qyrx6sxkjz1v3jwd.json` | `1d8856f977ff58d0f5f2b479c362c61ea9c29798a7c247391bd11c17562b3e17` |
| trueforge_session_trace | `private/sessions/01m6a5w20an0a1m06kf6jfpfb2.json` | `201d4d9e8b274625872c17fd8a7b6eee80bbe51a73a0c4853eaea8e2cc9f5f02` |
| trueforge_session_trace | `private/sessions/01m6a5x2hpvzc324e498bfp1yn.json` | `32ed03d816abc1da5ba5d91d767850c662b9a279d47dbdd9d8b40a72ae5bc992` |
| trueforge_session_trace | `private/sessions/01m6a5xfvrv091zbdryene4xs1.json` | `a406f233f6183e7660ccdd0d3c39d3413686d5c1ec0cc31cc8e8567f51c8a136` |
| trueforge_session_trace | `private/sessions/01m6a5y735zegnpsgntrqdfsp3.json` | `4b989540ee1f94733b754385209c04d6641a8ac20c9749eb53d0d7dcdba6aa86` |
| trueforge_session_trace | `private/sessions/01m6a5ymeq2de7mme4g8bbny14.json` | `2862591886986a762424e89a1d6e13188912aa25de7cdc5bd2ab874b65dbee35` |
| trueforge_session_trace | `private/sessions/01m6a5z389tj9tc02ergrqycjq.json` | `860752fc4155902a7400549220e218c8a55e934ee573e4d3a2bde9460ee74a4d` |
| trueforge_session_trace | `private/sessions/01m6a5zfkhagcfbexzfgnr9b1r.json` | `17935c19352964f3dad93f1ccf3c99d6b239a78fe72fdb33dfd7be2f5d2ea647` |
| trueforge_session_trace | `private/sessions/01m6a60gqes49e7gsnjffy875b.json` | `0bc7aa164bb070b64ffda87ec925ff2d5a11512c2bab6fabdb0f83eddfda0ab1` |
| trueforge_session_trace | `private/sessions/01m6a61eb745c4hambnpc6m7n9.json` | `de2713c1aa47825402b99aa68f79375524753f283a598c6a5d67dbf5993844e4` |
| trueforge_session_trace | `private/sessions/01m6a61vnnvgapsnqstpbhj289.json` | `5edc9154d1b4544b1f280d05f6bd8792f0c1297c6ade2f35ffa79f59b217c84f` |
| trueforge_session_trace | `private/sessions/01m6a62nx227atspevhczs152x.json` | `9457c99bd8410e82fb9d184f142736ca0d76b06a3bfbee0b665f14608ae890a5` |
| trueforge_session_trace | `private/sessions/01m6a63kftt4a22ymxbt3snssb.json` | `ac6c1fd720dcf886f261a5ef14b2a89f7494eed208368488a52061b72d1ee4bc` |
| trueforge_session_trace | `private/sessions/01m6a64h7pnd9cn6rxjjm3nqy6.json` | `85ab6c6dc49be83014855b824d8990ea776987d0ba2d2633124431a7987c674e` |
| trueforge_session_trace | `private/sessions/01m6a64x327hjg7he1ravypq5p.json` | `4a72abc7ac238d3134415875df749df5d92e86084350f24b960c01fd317db6b3` |
| trueforge_session_trace | `private/sessions/01m6a65yn0k06cbmbhc9fwhn8f.json` | `048b70c4d63f78f6bc1420cb9429522ab05441f6b926f38858ed55ff89417332` |
| trueforge_session_trace | `private/sessions/01m6a679k51nkb8h6jh3zbrzjj.json` | `07563b8138dda12dd074553307c43ae139bec83b04378473b0c65156d128e20c` |
| trueforge_session_trace | `private/sessions/01m6a67vatnm34msxtcsmx8rey.json` | `c3ac22856bae78b597e8654f09399bd270176844c6921dd402f47cc925901099` |
| trueforge_session_trace | `private/sessions/01m6a68gjq76n5w0zb0tvzkkh3.json` | `313608d4780aad1a789aea220798669755ef79c1a5c63561eeef8872ca93721b` |
| trueforge_session_trace | `private/sessions/01m6a6af5nkvysh0xpqa33r45v.json` | `4023db4e1de712524d844ea03c2bd380084d998dc1861e86d449c196cb81228e` |
| spend_ledger | `private/spend-ledger.json` | `710bf5efd002294e4e29438bcf51879069aa58a970b4959cb1d416cfcfea556c` |

## Reproduce
Deploy `Dockerfile.proof` at the commit above as a one-shot Railway service on the private network with TrueForge. Set `GK_PROOF_ARMS=baseline,gate_keeper,gate_keeper_lean`, `GK_PROOF_DRILL_ARMS=baseline,gate_keeper,gate_keeper_lean`, `GK_PROOF_TRIALS=3`, `GK_PROOF_PHASE_SHARE=0.5,0.15,0.35`, `GK_PROOF_CAP_USD=5.5` and an owner-private holdout in `GK_PRIVATE_HOLDOUT_B64`.
