# Gate Keeper live proof `gk-live-20261101-g` (run 4: current models, per-role model selection)

**Result: INCONCLUSIVE** (no independent signer). **Billing: UNVERIFIED.** Model calls were routed through the owner's self-hosted TrueForge, but which provider or gateway account pays has not been confirmed. Spend figures are tokens × list price, not invoices.

- Harness commit: `9d2c7249836689fbd772069b753e3375e73f6f7b`, on TrueForge 0.180.0.
- Spend: **US$5.28** (run cap US$6.50; owner's cap for the whole proof raised to US$20).
- Private evidence: 142 objects, manifest `0405e9cafbf70eea0f5450b8e5e8d92f164f6bc21d6f476476ac752efaa39529` at `railway-bucket://gk-proof-evidence-kylc9za/gate-keeper-proof/gk-live-20261101-g/`.

## Why this run
Runs 1–3 used `claude-sonnet-4-6` because it was the configured default, not because it was chosen on merit. The owner directed that models be chosen per role on current merit. This run re-tests the method on the current models and measures which model each role needs.

| Role | Model in this run | Why |
|---|---|---|
| Main candidate (primary fair pair) | `anthropic/claude-sonnet-5-5` | Current mid-tier (/0 per Mtok) |
| Reviewer sweep | Opus 5.5 (/0), Haiku 5.5 (/bin/bash.10//bin/bash.50) | Is a stronger or much cheaper reviewer better value? |
| Repair sweep (drill) | Sonnet 5.5 vs Opus 5.5 | Review and re-review are held identical, so only the repairer varies |
| Grader and gate adjudicator | `anthropic/claude-fable-5-1` (0/0) | Stronger than, and different from, every model under test |

Prices are from platform.claude.com/docs/en/about-claude/pricing (checked 2026-11-01). All models are from one provider family, so the grader is not fully independent.

## Review comparison
2 trials × 12 tasks: the same 4 public tasks and 8 holdout-v3 tasks as run 3, so this replicates run 3 on the new models. Holdout v3 results were seen in run 3, but no prompt was tuned on them.

| Reviewer | Key issues found | False positives | Precision (all) | Precision (holdout) | Severity | Unparseable | Reproducibility | Median latency | Tokens | Est. cost / review |
|---|---|---|---|---|---|---|---|---|---|---|
| Plain TrueForge, Sonnet 5.5 | 48/48 | 15 | 0.7794 | 0.7297 | 0.6667 | 0 | 1 | 5.8 s | 44,263 | ~$0.0091 |
| Gate Keeper adversarial, Sonnet 5.5 | 48/48 | 7 | 0.8833 | 0.8235 | 0.625 | 0 | 1 | 6.2 s | 68,451 | ~$0.0118 |
| Gate Keeper adversarial, Opus 5.5 | 48/48 | 6 | 0.9 | 0.8485 | 0.625 | 0 | 1 | 10.1 s | 74,165 | ~$0.0284 |
| Gate Keeper adversarial, Haiku 5.5 | 43/48 | 10 | 0.8276 | 0.7568 | 0.5814 | 1 | 0.9167 | 5.3 s | 74,056 | ~$0.0007 |
| Plain, Haiku 5.5 | 40/48 | 7 | 0.8627 | 0.7692 | 0.6 | 3 | 0.75 | 5.4 s | 51,315 | ~$0.0006 |

Estimated cost per review = input tokens × input price + other tokens × output price, divided by the number of reviews. It ignores cache discounts.

**Findings**
1. **On Sonnet 5.5, the plain reviewer also found every key issue.** Gate Keeper's advantage moves from recall (run 3, 4.6) to precision: **7 vs 15 false positives** (precision 0.883 vs 0.779), for about 30% more cost per review (+55% tokens).
2. **Opus 5.5 as the reviewer** gave 6 false positives instead of 7, at about 2.4× the cost of Sonnet 5.5 and about 1.6× the latency. It is not worth it as the default.
3. **Haiku 5.5 is not a reviewer.** It missed 5–8 of 48 key issues, gave unparseable replies, and was not reproducible across trials. The Gate Keeper method lifted Haiku's recall (0.896 vs 0.833). Its only plausible role is cheap triage in front of Sonnet, which is untested.
4. Every trial was identical for the Sonnet and Opus arms (Jaccard 1.0).

## Repair drill (6 fixtures per arm; review and re-review on Sonnet 5.5; repairer varies)
| Arm | Kept | First attempt | V-model-passing patch |
|---|---|---|---|
| Plain, Sonnet 5.5 repairer | 6/6 | 6/6 | 6/6 |
| Gate Keeper, Sonnet 5.5 repairer | 6/6 | 6/6 | 6/6 |
| Gate Keeper, Opus 5.5 repairer | 6/6 | 6/6 | 6/6 |

- **Every arm repaired every fixture on the first attempt,** including the path-traversal trap that every arm failed on Sonnet 4.6.
- **Re-review gate:** 20 re-reviews raised **0** blocking findings. Run 3's false-block problem (12 of 16 discards unconfirmed) did not recur on Sonnet 5.5.
- **The fixture suite is now saturated.** It no longer distinguishes repair approaches or repair models. Harder fixtures are needed before repair claims can be made.

| Cycle | Review findings | Attempts | Outcome | Origin unchanged |
|---|---|---|---|---|
| gate_keeper-money | 2 | #1: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper@anthropic/claude-opus-5-5-money | 2 | #1: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-money | 2 | #1: edits 7 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper@anthropic/claude-opus-5-5-uploads | 1 | #1: edits 8 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-uploads | 1 | #1: edits 8 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-uploads | 1 | #1: edits 11 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-pagination | 3 | #1: edits 6 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-pagination | 3 | #1: edits 6 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper@anthropic/claude-opus-5-5-pagination | 3 | #1: edits 5 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper@anthropic/claude-opus-5-5-escape | 2 | #1: edits 14 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-escape | 2 | #1: edits 14 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-escape | 2 | #1: edits 13 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-redirect | 2 | #1: edits 11 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-redirect | 2 | #1: edits 11 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper@anthropic/claude-opus-5-5-redirect | 1 | #1: edits 25 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| baseline-retry | 3 | #1: edits 9 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper@anthropic/claude-opus-5-5-retry | 3 | #1: edits 11 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-retry | 3 | #1: edits 9 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-archive-control | 1 | #1: edits 8 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |
| gate_keeper-archive-with-lesson | 1 | #1: edits 11 lines, V-model PASS, re-review blocking 0, discarded=True | **CANDIDATE** | True |

## Model selection on this evidence
| Role | Choice | Basis |
|---|---|---|
| Reviewer | Gate Keeper adversarial on **Sonnet 5.5** | Full recall, about half the false positives of the plain reviewer; Opus adds little for 2.4× the cost |
| Repair | **Sonnet 5.5** | 6/6 first attempt; Opus showed no gain on this suite |
| Grader / gate adjudicator | **Fable 5.1** | Strongest available, never a candidate |
| Learning (lessons, shared rules) | **Opus 5.5** | Low volume, judgement-heavy; errors would spread to every tenant |
| Triage | Haiku 5.5, untested | Recall too low to review alone |

These choices should be re-tested when models change. The harness supports `method@model` arms for exactly that.

## Spend
- This run: US$5.28 (comparison 1.62, adjudication 2.51, drill 1.14; 203 calls, 0 refusals).
- Proof to date is about US$14.0 of the owner's US$20 cap:
  - completed runs: 1 (2.00), 2 (1.79), 3 (4.01), 4 (5.28)
  - stopped or failed runs: about 0.20 and a few cents; learning attempt a (0.42); learning attempt b, stopped when the model choice changed (at most 0.81, likely about 0.30)
- All figures are estimates pending billing verification.

## Blockers and limitations
- No independent verifier/signing identity: qualification cannot be signed, so no PASS is claimable
- No independent budget gateway lease: spend was capped by the evaluator process (outside the agents), not a signed gateway
- Adjudicator is a separate, blinded session on a different model (anthropic/claude-fable-5-1) from the same provider family, not a human
- actual_cost_usd is TrueForge's per-turn cost estimate (turn metrics), not a provider billing statement
- Node permission sandbox confines candidate file reads but not network sockets; network access by candidate code is blocked only by the patch denylist
- Re-review gate precision is judged by a same-model blinded adjudicator session
- TrueForge sandbox provider not enabled; candidate patches were validated in a disposable clone inside the one-shot runner container
- Model-comparison arms (gate_keeper@anthropic/claude-opus-5-5, gate_keeper@anthropic/claude-haiku-5-5, baseline@anthropic/claude-haiku-5-5) use the same method on a different model; fairness flags apply to the primary baseline/gate_keeper pair on anthropic/claude-sonnet-5-5
- Billing route unverified (direct Anthropic key vs TrueFoundry AI Gateway); see the PR #9 billing-provenance note.
- Holdouts were written by the evaluator (Claude), not by an independent party.

## Hashes
- `baseline_instructions_sha256`: `59cd16ce41a81706f387efe3972e6f1e1a7c518f821f8ffa3ac37789eeb70741`
- `gate_keeper_instructions_sha256`: `e2bd56f4c01fa87462156331f58ba60b21fdd8da14daf3f148f8aba3c9585b84`
- `gate_keeper_lean_instructions_sha256`: `cada3295fe49d0a032b99afe21da9f554cc5031e9c0079b25b117c3cd14bb685`
- `output_contract_sha256`: `2967a32a90a6b764d2f9d49d8636827e9651257ab79320327c0e97bcf5a15167`
- `repair_contract_sha256`: `db16284884efa0163c9cbbf4c4cf0c930d7f512fe2a2ee9150945acded19bdcc`
- `gate_keeper_repair_sha256`: `dc982a4ae4fa123ffcaf5256ede0e65909f9edff64e71efc300b5eddde1456d9`
- `gate_keeper_lean_repair_sha256`: `dc982a4ae4fa123ffcaf5256ede0e65909f9edff64e71efc300b5eddde1456d9`
- `scorer_sha256`: `8096f1c871b327ba425ff3368cec34fbac400f777a4061f2ff7ae6ac55aecefd`
- `public_benchmark_sha256`: `72bcee7d4bdcffe6ce9337f64cadc1ecdd9203d4e7596cd64983aea183708dd2`
- `private_holdout_sha256`: `6ea7823d0b18d11d495774915b136c94d3848125f0e594013d07b55a25f70053`
- `evidence_manifest_sha256`: `0405e9cafbf70eea0f5450b8e5e8d92f164f6bc21d6f476476ac752efaa39529`

## Sessions
| Phase | Arm | Trial | Session |
|---|---|---|---|
| comparison | baseline | 1 | `01m6a85hpfy3twnm6f7xy6brkx` |
| comparison | gate_keeper | 1 | `01m6a85hq0dxk7gk9ga6pc9z18` |
| comparison | gate_keeper@anthropic/claude-opus-5-5 | 1 | `01m6a85hqbdvm3et09swjnwjaf` |
| comparison | gate_keeper@anthropic/claude-haiku-5-5 | 1 | `01m6a85hqwc6m1kjeqr8sxsfa8` |
| comparison | baseline@anthropic/claude-haiku-5-5 | 1 | `01m6a85hraxcj0wnftcph7rkf1` |
| comparison | baseline | 2 | `01m6a8jvx1ntmk59kem20sqvhh` |
| comparison | gate_keeper | 2 | `01m6a8jvxce0wyy9vhsphercbn` |
| comparison | gate_keeper@anthropic/claude-opus-5-5 | 2 | `01m6a8jvxqn1ryhr7wbk949b83` |
| comparison | gate_keeper@anthropic/claude-haiku-5-5 | 2 | `01m6a8jvy36d959x49gdzs0h6b` |
| comparison | baseline@anthropic/claude-haiku-5-5 | 2 | `01m6a8jvye147nfg4t92dtw770` |
| adjudication | - | - | `01m6a90k7aqzkjpdr2vn9a6nz9` |
| drill | gate_keeper | - | `01m6a98ng4sxrgq2fn1z47bb62` |
| drill | gate_keeper | - | `01m6a98x6waxse15r9y0y60qdp` |
| drill | gate_keeper | - | `01m6a9954qdvzwv7abjpzxq1vm` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a99cm991tj2t5a00mptpta` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a99m279wccpdnceffnz7e4` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9a0e7ak7beytf6nnmtw79` |
| drill | baseline | - | `01m6a9a6e4atpve9ewvt12h1m4` |
| drill | baseline | - | `01m6a9acd6gk85nezf6g644r4x` |
| drill | baseline | - | `01m6a9afxdrc61xmte8ddb2m66` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9anxjxv42hrw9war84c2c` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9avw2njvv0fe9cvrvj4xs` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9bcns2hmm8nrm1tgt8r8b` |
| drill | baseline | - | `01m6a9bjn7ap8dafhtvenxtxj5` |
| drill | baseline | - | `01m6a9bq499es5cjzkqn0qpxdm` |
| drill | baseline | - | `01m6a9bxjsj7t03ff8tjm3yhry` |
| drill | gate_keeper | - | `01m6a9c3jpyhmyxsj6q9qw8jnc` |
| drill | gate_keeper | - | `01m6a9c9hfgqv41avf1m6kydry` |
| drill | gate_keeper | - | `01m6a9cnx6ms6cnkhs9zbnnzh8` |
| drill | baseline | - | `01m6a9cvwv2955an3wfwxqezv5` |
| drill | baseline | - | `01m6a9d1vhx1cs9v4ttf82ngbn` |
| drill | baseline | - | `01m6a9d6tv8zm20j4ty2y9qn2t` |
| drill | gate_keeper | - | `01m6a9dbavb9ejgsv9vp8hss7h` |
| drill | gate_keeper | - | `01m6a9djr8md8yzhttf8d49x0w` |
| drill | gate_keeper | - | `01m6a9ds6h7mrax9merjycgpnr` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9dz5s5a1xv3hm6k9t57t8` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9e6n5f4chpeg8ax4c93b5` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9ehjhq0xxg3mmq9a6qwzm` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9eqj8p4xjvqzmhvwzajz7` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9exhn5rp42sbdn3c8692f` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9ffvcy9x2ztpcdawxvgag` |
| drill | gate_keeper | - | `01m6a9frt5kxbyvcz2xqhqed9w` |
| drill | gate_keeper | - | `01m6a9fyrj90rr6jc2xx1txgka` |
| drill | gate_keeper | - | `01m6a9g6q8wsc9f870t2w5jcyz` |
| drill | baseline | - | `01m6a9ge61824tbtw1qs34gnw6` |
| drill | baseline | - | `01m6a9gm4kq03cw6xy0gdfepv8` |
| drill | baseline | - | `01m6a9gtk19yg2ebxw80sxxw0r` |
| drill | baseline | - | `01m6a9h21xxhshbm0hncftb261` |
| drill | baseline | - | `01m6a9h8087s271qz1b1r3hryd` |
| drill | baseline | - | `01m6a9hfxx8mc3bpee8fex9dn4` |
| drill | gate_keeper | - | `01m6a9hqd2mwbba2xagc2hm1d0` |
| drill | gate_keeper | - | `01m6a9hxbdqx5graph0gfvfeaq` |
| drill | gate_keeper | - | `01m6a9j9qbjfbz0wta2fq64z0x` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9jjnvxeq36fs1vmys0s67` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9jrm654ctpa1jgvmp038x` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9kccnnda3rxj7tsj5nt08` |
| drill | baseline | - | `01m6a9kptn1ac1w5zpntafd742` |
| drill | baseline | - | `01m6a9kv9vnny91g8n9crsthd8` |
| drill | baseline | - | `01m6a9m09jr69sahc4w4mmbwb0` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9m3ah02jv86884qe1c8dz` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9m992zz0j1tnskph2kbrr` |
| drill | gate_keeper@anthropic/claude-opus-5-5 | - | `01m6a9mnmw8a0v74pyjvyeeyym` |
| drill | gate_keeper | - | `01m6a9mvmgykgv9cf97gdxqzes` |
| drill | gate_keeper | - | `01m6a9n1kx3q6893524aj3dn1q` |
| drill | gate_keeper | - | `01m6a9nb122ekjfw4sd0zyz8eh` |
| drill | - | - | `01m6a9nfh7f87benqwe9n75dy9` |
| drill | gate_keeper | - | `01m6a9p1g65fc9aysq8kp18n01` |
| drill | gate_keeper | - | `01m6a9p7eh2vty97rz2ybs63qb` |
| drill | gate_keeper | - | `01m6a9pfcg0zv5pqb24dhmsjqe` |
| drill | gate_keeper | - | `01m6a9ppvpay3snkwzm21g702y` |
| drill | gate_keeper | - | `01m6a9py9smm70rhm6qybv7fkc` |
| drill | gate_keeper | - | `01m6a9qanx29dt26t1w2tb5rme` |

## Private evidence
| Kind | Path | SHA-256 |
|---|---|---|
| preflight | `preflight.json` | `525627eecefe17d085f3e3d5d8d617cc85a6d959cf04940a20917c4bf62a07b8` |
| adjudication | `private/adjudication/01-python-utils-0-0.json` | `fdd91993c809fba3e16e5d5710d3bf077485c919d235932da72ee2eede6f0528` |
| adjudication | `private/adjudication/01-python-utils-30-0.json` | `0cd9f82a5bf4860d37391a6cc7fad73a7cae5c7d47dae4e4fca215a0cfabd5dd` |
| adjudication | `private/adjudication/02-express-users-0-0.json` | `0cabff51d910c12dea627f09d71feebf1eb34afaee88612b28da9e4d3f3f19ea` |
| adjudication | `private/adjudication/02-express-users-30-0.json` | `60f0af1e42b3365ddd23702cdc2ccc605d5b020e57471aab14523bc0b90279e8` |
| adjudication | `private/adjudication/03-python-deploy-0-0.json` | `60c21623c7b993932bbb46a3830a33c3417151464f9712630cc33be362597603` |
| adjudication | `private/adjudication/03-python-deploy-30-0.json` | `1ce24961ac3bee41918f51c20d35c1149c466c439e0b6fdfe200822cfb58689b` |
| adjudication | `private/adjudication/04-ts-fetch-0-0.json` | `800cfb0fc2bdb73796ec9a0fbe08205ed36715c1654c9a43eca59c8ce51abd73` |
| adjudication | `private/adjudication/04-ts-fetch-30-0.json` | `800c91820eeb0b432c3fefb483bdeb2bfa4ebfa2c5888a355387c114bf5c6f3a` |
| adjudication | `private/adjudication/holdout-1-0-0.json` | `5b29f2499444907bcddbea227b04377248089c23bb193767e4d47fa10f0bf8a8` |
| adjudication | `private/adjudication/holdout-1-30-0.json` | `b817bf083e475b0cb2001ce01329d83c6a84f8c6cb7e51557d75443179a839d5` |
| adjudication | `private/adjudication/holdout-2-0-0.json` | `d337337e6bb0be58865f41bde6a106be6dd18f590968d6e7601b1d9a2ca23360` |
| adjudication | `private/adjudication/holdout-3-0-0.json` | `4157297172af7f92630f4b048fc8c678062984623d728465656695c8afe73ee3` |
| adjudication | `private/adjudication/holdout-4-0-0.json` | `9fcc751630949698f171e590a7d1845afab82d1ab3c3cb616c55db3ede8c4738` |
| adjudication | `private/adjudication/holdout-5-0-0.json` | `46f92703e2e6ec99fe258f0ae2b67d495565557f2a121412120f69e3a53c6364` |
| adjudication | `private/adjudication/holdout-6-0-0.json` | `19d44c7d8c7022615cc57299ed475ab2deecca9a472d53e1fab02277996c0f37` |
| adjudication | `private/adjudication/holdout-6-30-0.json` | `3183b5a7092428fdce1856dd08b9626b2948c9806b2169527f7ca2c844f8cece` |
| adjudication | `private/adjudication/holdout-8-0-0.json` | `a359802d61715df247bb2aba55a92ae8e6f1ae00e3ce4a87e4ece2f7929c1bbc` |
| unblinding_key | `private/blinding-key.json` | `1fed3135ebb970164ee6cbecb6a9c0a70645c4c3ab9e35520ccaa0926591315b` |
| candidate_replies | `private/comparison-replies.json` | `f434710f322fe763c7c82df09352d95b5625877dcf1f4800a7bb288e84ab5871` |
| v_model_test_logs | `private/drill/baseline-escape-attempt1-validation.json` | `0b817d7b4bc297147475a49e6c1c6b70b9ead5aaf5473a19b236c268838eda11` |
| candidate_patch | `private/drill/baseline-escape-attempt1.diff` | `78cfba3fc1d3001c8d597c1c1cabeeebc7688405fb3639af7edd94d32859c8cb` |
| v_model_test_logs | `private/drill/baseline-money-attempt1-validation.json` | `059e1784d474406f6f51b5317d757924ac44bf77e7845b186149530e3a91a7e0` |
| candidate_patch | `private/drill/baseline-money-attempt1.diff` | `5261671a16b410baf6e4734fdb3500c1a274decb0e3f5b16d2c5da6bad96ff32` |
| v_model_test_logs | `private/drill/baseline-pagination-attempt1-validation.json` | `dd97c86b8ee60a449021ab30709fb7aa6205f96e5a00919c11de0ebd9b84c567` |
| candidate_patch | `private/drill/baseline-pagination-attempt1.diff` | `d6194a55075be74426ad48d0ee64ecd03a90d5e3ee411c616044bf1a408d8de7` |
| v_model_test_logs | `private/drill/baseline-redirect-attempt1-validation.json` | `0fd100019d2bba7bdd38ccaa100175cebfe476c833ea195cb828bf97d92515fc` |
| candidate_patch | `private/drill/baseline-redirect-attempt1.diff` | `efadb9d7f6fb2e638aaf215de91eb0031a4545bdfac4a65607b506f8042a6964` |
| v_model_test_logs | `private/drill/baseline-retry-attempt1-validation.json` | `73b787a498f386a616ef2cf08eae60e8f821cacb29affd741852f07bebd0c6ba` |
| candidate_patch | `private/drill/baseline-retry-attempt1.diff` | `f4e39c7ff03d0a9fb91a663582c5da568dc371924171140c607800dcc279fd65` |
| v_model_test_logs | `private/drill/baseline-uploads-attempt1-validation.json` | `cdf5b44af3cbc26f51be9ad0fe43c26dd760a3c781eec5795a94aac9b21d7e56` |
| candidate_patch | `private/drill/baseline-uploads-attempt1.diff` | `1b04f2366d3ec3296a62be16db245538a5a65261f96faaedea267b0da04097f7` |
| drill_record | `private/drill/cycles.json` | `84571124a24cbd3411a0d3f985c6c192f145b9d62de485c209e65760a3679b27` |
| v_model_test_logs | `private/drill/gate_keeper-archive-control-attempt1-validation.json` | `05525f413aa9b8bf6ebed7dc40948078ac66ee881665053f65954503c240b764` |
| candidate_patch | `private/drill/gate_keeper-archive-control-attempt1.diff` | `98484cd773e404853360da9a630d0f02c8305e4d3cda7be1fe43920e65f01e62` |
| v_model_test_logs | `private/drill/gate_keeper-archive-with-lesson-attempt1-validation.json` | `102458e5da0bba8cedf3418840925b64b143c5c282a66c2ce4e8058b73b1e153` |
| candidate_patch | `private/drill/gate_keeper-archive-with-lesson-attempt1.diff` | `2bc305f0e846bbe87d5e5a7f75eba7e66b89ca3f01622b4d2df1106e0ab83e38` |
| v_model_test_logs | `private/drill/gate_keeper-escape-attempt1-validation.json` | `03d38302768d6b27a321634cec5b017be24c25789d554aa3256c90d8f8c7fe4b` |
| candidate_patch | `private/drill/gate_keeper-escape-attempt1.diff` | `d8d80a72804611e11ed96e59dabc0a71b509bbedd9bd0339cdb2a6aec07e21a6` |
| v_model_test_logs | `private/drill/gate_keeper-money-attempt1-validation.json` | `543191eccfd9134ddb65243e12db9fb931b8ed1bc8b8f827f4f62901873509a4` |
| candidate_patch | `private/drill/gate_keeper-money-attempt1.diff` | `42388e417ca07426c64ac47cded5c69b5a5e2a6b17fed34eb65dd29500cab732` |
| v_model_test_logs | `private/drill/gate_keeper-pagination-attempt1-validation.json` | `3390e1c8abd2ba94e593402fba111b101f5f121f75be102f4cee479597a226a8` |
| candidate_patch | `private/drill/gate_keeper-pagination-attempt1.diff` | `54a58ad40e0440a86b4a478cf28d37c32937ddc80ca49c383972c164018509b2` |
| v_model_test_logs | `private/drill/gate_keeper-redirect-attempt1-validation.json` | `2594e3e2c25e50e55bfba886732a30426092748687698b1739d7a02eb0edee1d` |
| candidate_patch | `private/drill/gate_keeper-redirect-attempt1.diff` | `4b5567c4cbbfa2b3a1e7105e6e1855f37bb8aeef4e55cdb68dea9a102aacf3e9` |
| v_model_test_logs | `private/drill/gate_keeper-retry-attempt1-validation.json` | `2a303c52fda31c7421ffe67f7125f50634d43a28b4060e707a935718c3d2a5cd` |
| candidate_patch | `private/drill/gate_keeper-retry-attempt1.diff` | `f4e39c7ff03d0a9fb91a663582c5da568dc371924171140c607800dcc279fd65` |
| v_model_test_logs | `private/drill/gate_keeper-uploads-attempt1-validation.json` | `54d267b5698fcc4f4de953007917dbff999db79c62c97336b06d2a6fdaf87f85` |
| candidate_patch | `private/drill/gate_keeper-uploads-attempt1.diff` | `19048d54cdec136d9fa998865ce55f86ad1f5a183fe4cd70e7b7a4a2b652b328` |
| v_model_test_logs | `private/drill/gate_keeper@anthropic/claude-opus-5-5-escape-attempt1-validation.json` | `212f8d4f4065c597a4120733570279d9813ade45495fa43aac334f7646b792c1` |
| candidate_patch | `private/drill/gate_keeper@anthropic/claude-opus-5-5-escape-attempt1.diff` | `bf168250b6be8c41749af091b49df5ebccff45eb882ea62e5594002c8c0015ec` |
| v_model_test_logs | `private/drill/gate_keeper@anthropic/claude-opus-5-5-money-attempt1-validation.json` | `85cce04e84d6278eacde86bcb712221b46d8be264923393df5998dd214cfbabf` |
| candidate_patch | `private/drill/gate_keeper@anthropic/claude-opus-5-5-money-attempt1.diff` | `843e98ea51297254fc99658bad72d65de3092340e1d11ecd5bed4fe4b2c9411d` |
| v_model_test_logs | `private/drill/gate_keeper@anthropic/claude-opus-5-5-pagination-attempt1-validation.json` | `9b8eea24a9d3a4ad772da966a4114d013f5221f464d3dd4c6ec554b9c8d9025e` |
| candidate_patch | `private/drill/gate_keeper@anthropic/claude-opus-5-5-pagination-attempt1.diff` | `d48b833623e274bf373f166957b654c33bed066e17308be9b64f7d889a112e27` |
| v_model_test_logs | `private/drill/gate_keeper@anthropic/claude-opus-5-5-redirect-attempt1-validation.json` | `a46f9bfe8690253edadb950456720c78b1907eba06318b5e34e77476cf55563f` |
| candidate_patch | `private/drill/gate_keeper@anthropic/claude-opus-5-5-redirect-attempt1.diff` | `51fe4fb3280ca495184b1be9032dfa035f213ebf7bece8faa3535f42e2600249` |
| v_model_test_logs | `private/drill/gate_keeper@anthropic/claude-opus-5-5-retry-attempt1-validation.json` | `37c82616924462aea45e527c494660f7ddcf4ff768bdc31a29905a9b5a7a10c5` |
| candidate_patch | `private/drill/gate_keeper@anthropic/claude-opus-5-5-retry-attempt1.diff` | `1e48f9ec3ddff057f753904d28022cada8a43aeb2788d589cf3ac598de94bb29` |
| v_model_test_logs | `private/drill/gate_keeper@anthropic/claude-opus-5-5-uploads-attempt1-validation.json` | `724a7028ab87912f51b440a2d4f0d10aad5a2df507af3094cce576110b9d5018` |
| candidate_patch | `private/drill/gate_keeper@anthropic/claude-opus-5-5-uploads-attempt1.diff` | `36cbabf073bea8c573beedaeddcd4529115cdf068668f4777905310d580834bd` |
| private_holdout | `private/holdout-tasks.json` | `bd9f90555043cb89836d3f63b3679dc563b13ffdac3e2f25019ea7fbd4ad7042` |
| tenant_private_lesson | `private/lessons/tenant-alpha-money.json` | `eee08bc844d748f10d1389dacd1a8427fcc88ca6d851d8be6afda3f6dc94f9bd` |
| tenant_private_lesson | `private/lessons/tenant-beta-uploads.json` | `95e788f2013f020af45e21b1966a01ac8da07fd03a79350f24c645e905051df3` |
| tenant_private_lesson | `private/lessons/tenant-delta-escape.json` | `ba4f6e21ed2a2c269f18c844e780fb96cefc4f86c768fa5d19a078e358cf57a9` |
| tenant_private_lesson | `private/lessons/tenant-epsilon-redirect.json` | `38cae938efb2da4dd61920746c7abdb39846bfee522de73dd8bc844c68160ac8` |
| tenant_private_lesson | `private/lessons/tenant-gamma-pagination.json` | `bbbdfb513675ff767286c019fc9fdd0fd873dbd2ad93cab64fa49d0bc4ed4347` |
| tenant_private_lesson | `private/lessons/tenant-zeta-retry.json` | `5f8e40586f1366b1495a34f7d89709f623dc6713c4967c589c10d1d3490db445` |
| trueforge_session_trace | `private/sessions/01m6a85hpfy3twnm6f7xy6brkx.json` | `4cbea5662b69bb409f4b8212e4e04483ea63cc2099d1e8d2971a39af27dda2a0` |
| trueforge_session_trace | `private/sessions/01m6a85hq0dxk7gk9ga6pc9z18.json` | `83d273e46fa90230ad533a049b4af6bcf83d78df16f06998d1aa8f40c740b17f` |
| trueforge_session_trace | `private/sessions/01m6a85hqbdvm3et09swjnwjaf.json` | `a24860ef0ad4250bbf108a9ea9b792286b61ca0d4da4e7328b0596f62c2da2ad` |
| trueforge_session_trace | `private/sessions/01m6a85hqwc6m1kjeqr8sxsfa8.json` | `5bc0664c4e669ab6b06e8409c441a71b059bf850a806d55c362cb033da610a1c` |
| trueforge_session_trace | `private/sessions/01m6a85hraxcj0wnftcph7rkf1.json` | `5e5e6ce2ed4351a8e1bc5615b35d769fa4f6e1bfd8ca37463c6716399f0698b7` |
| trueforge_session_trace | `private/sessions/01m6a8jvx1ntmk59kem20sqvhh.json` | `96d5ef7e8398f7edb53941a24a4e1ef4b75b743dcf82c5f6f6435d330bd505fa` |
| trueforge_session_trace | `private/sessions/01m6a8jvxce0wyy9vhsphercbn.json` | `227ffa75e08c363ca71440c80907041a15caa20091f5f557b87386c46a4e5f2a` |
| trueforge_session_trace | `private/sessions/01m6a8jvxqn1ryhr7wbk949b83.json` | `2bb114e07758d4818b199570959f1730b34bf1a8b1e2fd5428f7ad3973343c3a` |
| trueforge_session_trace | `private/sessions/01m6a8jvy36d959x49gdzs0h6b.json` | `eb6c525252c7ecfaecf5a4739f8b6377966770306c4349a86333c8eea909c86b` |
| trueforge_session_trace | `private/sessions/01m6a8jvye147nfg4t92dtw770.json` | `e461434351303b1d8d4cca12322733efd551d508d51a79faa1bfe22ea5e413e2` |
| trueforge_session_trace | `private/sessions/01m6a90k7aqzkjpdr2vn9a6nz9.json` | `3749c94aa0b804d5949a5bc433f312b6fdc272c0993a356199d3400d8fd2fb11` |
| trueforge_session_trace | `private/sessions/01m6a98ng4sxrgq2fn1z47bb62.json` | `c373eef4ce1d4daf2fa9c4e4dc1636897561138a4045e539ef2fc8acbb46a21e` |
| trueforge_session_trace | `private/sessions/01m6a98x6waxse15r9y0y60qdp.json` | `fe8b4f02db38697fc44ab9dc6ad093353d4fa22bca232080466669f748c081c0` |
| trueforge_session_trace | `private/sessions/01m6a9954qdvzwv7abjpzxq1vm.json` | `0af0d3460f08bdfdaaaab4c3496a54a731827b30c10db5c80da3eafcf4214ddc` |
| trueforge_session_trace | `private/sessions/01m6a99cm991tj2t5a00mptpta.json` | `067a2c50083e504f329ab3c53a206c8a6e91503feb0bd21cc2c2c566c3852a27` |
| trueforge_session_trace | `private/sessions/01m6a99m279wccpdnceffnz7e4.json` | `02a6af50a3bc26e2ea95339ab1732c7bf13a4107ace6a7d077a399f0a9a62ada` |
| trueforge_session_trace | `private/sessions/01m6a9a0e7ak7beytf6nnmtw79.json` | `6d1005a55c566027564a8ec28271a73508bb8b108eb363174131c8cce0105efb` |
| trueforge_session_trace | `private/sessions/01m6a9a6e4atpve9ewvt12h1m4.json` | `5288a3d500803920e7c93595debcd0e39fdb22d8801cd3af00ac4ca45a77dc76` |
| trueforge_session_trace | `private/sessions/01m6a9acd6gk85nezf6g644r4x.json` | `2a124e5a68890a5c6f23c8ddb994efb317001e00c573767e5d4deddac486314d` |
| trueforge_session_trace | `private/sessions/01m6a9afxdrc61xmte8ddb2m66.json` | `7c4899030ce1ee3f169ad3ebe3f017f3e256f71f3c0c70037706b9935d9afbe4` |
| trueforge_session_trace | `private/sessions/01m6a9anxjxv42hrw9war84c2c.json` | `89e75392ad6269c84ddef3977f81d8c326b2ebc3408dd18650f58c4ca42c83a9` |
| trueforge_session_trace | `private/sessions/01m6a9avw2njvv0fe9cvrvj4xs.json` | `5c846d127191862f896c903a1127c623342d76438e816383ecb21fad649942de` |
| trueforge_session_trace | `private/sessions/01m6a9bcns2hmm8nrm1tgt8r8b.json` | `bf941090e975e1082f3a14cbe8dd594f707b5ba619c4caeb242ff70b01d8fa7a` |
| trueforge_session_trace | `private/sessions/01m6a9bjn7ap8dafhtvenxtxj5.json` | `05655fffa47cdf9c8c1151a1707bf3a88f91cc890d4c2d49b9b897281557ca37` |
| trueforge_session_trace | `private/sessions/01m6a9bq499es5cjzkqn0qpxdm.json` | `e760d2512ca7d39a32af57e8e23fc359ae9151819e45fcf2086436ed5d18c3a3` |
| trueforge_session_trace | `private/sessions/01m6a9bxjsj7t03ff8tjm3yhry.json` | `34d85c891537e1ddba43470c8855fe4d84596b471da6f5849bacc5cee234dbab` |
| trueforge_session_trace | `private/sessions/01m6a9c3jpyhmyxsj6q9qw8jnc.json` | `5896018b525d2c9687ef2239a87b14308c533aff44126ed7333166ef5ed72390` |
| trueforge_session_trace | `private/sessions/01m6a9c9hfgqv41avf1m6kydry.json` | `ba557d18a1cc99d8b3d0a7e7049c36b5fade1674f49a0caa262e08b540bff9ed` |
| trueforge_session_trace | `private/sessions/01m6a9cnx6ms6cnkhs9zbnnzh8.json` | `b5d793001537e8d0e322c19297a8dfc261b3683bf785a0a12b354b023c67a773` |
| trueforge_session_trace | `private/sessions/01m6a9cvwv2955an3wfwxqezv5.json` | `c8aa35f119cd0022a7fff31a051ae326891f0184b681c182988579fde9b6d02e` |
| trueforge_session_trace | `private/sessions/01m6a9d1vhx1cs9v4ttf82ngbn.json` | `7ed28dc38a601d749af2b5fb8fb763e48e40f1b5f9a3516b51dd751bb9bb77a4` |
| trueforge_session_trace | `private/sessions/01m6a9d6tv8zm20j4ty2y9qn2t.json` | `233803e969c591b96188d6d2dba965993b069cfabf1dcc5df79b9b1ed511488f` |
| trueforge_session_trace | `private/sessions/01m6a9dbavb9ejgsv9vp8hss7h.json` | `4c03a711d2a8273e4361b472eb356fcae4a74e87ea07fc67c1dc1af3e6b59b5c` |
| trueforge_session_trace | `private/sessions/01m6a9djr8md8yzhttf8d49x0w.json` | `ae5166653c5985949de04d29a44c38a2c9cc523b58826e5417ceeaee628dfad0` |
| trueforge_session_trace | `private/sessions/01m6a9ds6h7mrax9merjycgpnr.json` | `f4b42927f3841f3b856a6df29807ba4ac4d2cba48d6f56f0e76bf18d1b616dbc` |
| trueforge_session_trace | `private/sessions/01m6a9dz5s5a1xv3hm6k9t57t8.json` | `d8394ba4c816e5abd1aedda5b18df28d862ec798b8a88b1666caec20056df462` |
| trueforge_session_trace | `private/sessions/01m6a9e6n5f4chpeg8ax4c93b5.json` | `42dfb4cccae26e71c620fa5738bb1d0de2058a144abcc3cf9ab79ed1e8a11c76` |
| trueforge_session_trace | `private/sessions/01m6a9ehjhq0xxg3mmq9a6qwzm.json` | `0df5e5c06fbee9ff9345302a8da538d82f98f25161a21b3508f482ca478563b5` |
| trueforge_session_trace | `private/sessions/01m6a9eqj8p4xjvqzmhvwzajz7.json` | `474ef1abf2715ec9e8313d73e9eb5b83411b64eff739eb24c3c71ebbe4e3cf4f` |
| trueforge_session_trace | `private/sessions/01m6a9exhn5rp42sbdn3c8692f.json` | `e5f7b70163551b778b823a1c5edf737f58e023f4986167bf5ddd90335a2121b2` |
| trueforge_session_trace | `private/sessions/01m6a9ffvcy9x2ztpcdawxvgag.json` | `b6305e6757c73cdbead40e7774bf4d5a335b6c379fd5de55fd78a5955e3c8461` |
| trueforge_session_trace | `private/sessions/01m6a9frt5kxbyvcz2xqhqed9w.json` | `244ad8d71b3734b16f65fbfc4df8fbbf36c4cc59cfcc1b1e89d774c639ffeb8a` |
| trueforge_session_trace | `private/sessions/01m6a9fyrj90rr6jc2xx1txgka.json` | `019059289d430155c3922c7ff0bbce5350edc0a3377779425fcc64fedafecd6a` |
| trueforge_session_trace | `private/sessions/01m6a9g6q8wsc9f870t2w5jcyz.json` | `3e74d3212e016151af480024b128a9c34b5642a1f327b56539a68bb19707ec7d` |
| trueforge_session_trace | `private/sessions/01m6a9ge61824tbtw1qs34gnw6.json` | `4426300a22d1106cea9e91f828e6f046499c82f98acf5b167b7e0f254e03d088` |
| trueforge_session_trace | `private/sessions/01m6a9gm4kq03cw6xy0gdfepv8.json` | `a399a934138a9b29481c7e920244c0127b6a72c95b1dfb74b3dca350d8bc0f7f` |
| trueforge_session_trace | `private/sessions/01m6a9gtk19yg2ebxw80sxxw0r.json` | `7c7adc55742bf4c844da001fddd5f939283918b695735305090619ba049ad511` |
| trueforge_session_trace | `private/sessions/01m6a9h21xxhshbm0hncftb261.json` | `9b4ae194e0879c7b4ea5ad86f8b6b9dc2f9edd1f6145e28d39ad64bfb7cca768` |
| trueforge_session_trace | `private/sessions/01m6a9h8087s271qz1b1r3hryd.json` | `b37df7caba894a2dbeee5f404516f267db09d48fe7ba0bf0976a48bd11b007b3` |
| trueforge_session_trace | `private/sessions/01m6a9hfxx8mc3bpee8fex9dn4.json` | `1ad5115bf06f44f703032ece8c691a6ead5651b1b949618ab931cefb3d3f6a9b` |
| trueforge_session_trace | `private/sessions/01m6a9hqd2mwbba2xagc2hm1d0.json` | `b876a886b9f2ee6f2f47f98ffdf5f565e211ec2396a1183d9ad81faab9cb7d43` |
| trueforge_session_trace | `private/sessions/01m6a9hxbdqx5graph0gfvfeaq.json` | `56e0edba338747713428fa27ffc7c9ec477b1f47d699a8f0bf785d796f3e5f8a` |
| trueforge_session_trace | `private/sessions/01m6a9j9qbjfbz0wta2fq64z0x.json` | `1968df46f9fc68ce539bd83e2964272802deac06695b830bce114c6406e5e083` |
| trueforge_session_trace | `private/sessions/01m6a9jjnvxeq36fs1vmys0s67.json` | `08ff225e1644d2b9fa1219d37ff00186da0939474925f979124fecad6ff5414f` |
| trueforge_session_trace | `private/sessions/01m6a9jrm654ctpa1jgvmp038x.json` | `fa3efc244d51d55e6c38d1d3ff1996ba3ce2e4240831ce851eab1cdbb2bbe9c6` |
| trueforge_session_trace | `private/sessions/01m6a9kccnnda3rxj7tsj5nt08.json` | `a6baf979923d4d952f0fa57c7d896f0372eab695a819ca1abca11df4570df6d9` |
| trueforge_session_trace | `private/sessions/01m6a9kptn1ac1w5zpntafd742.json` | `4c82b382d74229c524c9f07fc7748042fddad24bda63abfccad0cd1a353e25ab` |
| trueforge_session_trace | `private/sessions/01m6a9kv9vnny91g8n9crsthd8.json` | `a60ea2be47da5db0ac50fe8cbbd46d51a875861095c3ce75b30e51bad08a0d0b` |
| trueforge_session_trace | `private/sessions/01m6a9m09jr69sahc4w4mmbwb0.json` | `6950af98cefaa8661884ef479aff5bfaf574130d1cd835653bcf5cd994a0f52e` |
| trueforge_session_trace | `private/sessions/01m6a9m3ah02jv86884qe1c8dz.json` | `d2b26386187d151a21f3b7ea150beaeecd49b5918bf701a3e16e2903ace1f764` |
| trueforge_session_trace | `private/sessions/01m6a9m992zz0j1tnskph2kbrr.json` | `36ac9e2efe4571c90ced45c4501306f39da53fb93184e6fe2486a5b124d8e85e` |
| trueforge_session_trace | `private/sessions/01m6a9mnmw8a0v74pyjvyeeyym.json` | `6e06c2f9b2cc4d18f0d35bfd61aa308068b7320f8f5a31fdc6cf93cbc89cf90f` |
| trueforge_session_trace | `private/sessions/01m6a9mvmgykgv9cf97gdxqzes.json` | `d4223c74aae2988bea5cb0d52a7ea9c13af7762275fbba6abb701071b5ecddf5` |
| trueforge_session_trace | `private/sessions/01m6a9n1kx3q6893524aj3dn1q.json` | `40f695fe0f583c98fa0d6151479228bc543e5774db54f76c0e3ed04578b44300` |
| trueforge_session_trace | `private/sessions/01m6a9nb122ekjfw4sd0zyz8eh.json` | `1199d08589260d2ac508276d8381ddc10ca747b17315b4f2b79c926ae4577dc8` |
| trueforge_session_trace | `private/sessions/01m6a9nfh7f87benqwe9n75dy9.json` | `ab2ff4fbed599125806baee4befcdcc37d1ec7ab9146e2a7658117eddf147a19` |
| trueforge_session_trace | `private/sessions/01m6a9p1g65fc9aysq8kp18n01.json` | `b25c0a8c55dcf620a04a10f8ccc58c55a3f44c41452caaa4f1a5200811dd9778` |
| trueforge_session_trace | `private/sessions/01m6a9p7eh2vty97rz2ybs63qb.json` | `dba37060fb4c7f9628aa2f5edb71008418f229347e9d10602aca9c8a2c6e5b4b` |
| trueforge_session_trace | `private/sessions/01m6a9pfcg0zv5pqb24dhmsjqe.json` | `390641c1a8efec658ec50bfd58870f2eca33b11089b6a861aefe2cb5651a92fc` |
| trueforge_session_trace | `private/sessions/01m6a9ppvpay3snkwzm21g702y.json` | `b96ad51d701e7d2c545779b772a2f2c96529e039f21126e34666d1d8b26f4537` |
| trueforge_session_trace | `private/sessions/01m6a9py9smm70rhm6qybv7fkc.json` | `badb1d10df776a133b2d44da74f006058edb04e955bbef783fc737e7f065bc7c` |
| trueforge_session_trace | `private/sessions/01m6a9qanx29dt26t1w2tb5rme.json` | `75085687a5c41b57ea9a448250c935137e0b2c740fa1bbe3e35731c548f684ff` |
| spend_ledger | `private/spend-ledger.json` | `01bf56088a21254a71cf324ca4d4405fc3a94eec6d73ccd99d997961b88c20a3` |
