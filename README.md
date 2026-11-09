# Gate Keeper: review agent and public test evidence

Gate Keeper reviews code changes and returns findings. This repository contains review-agent source, frozen prompts, evaluation code, public fixtures and published results. The proprietary product executor, API, website and hosted learning services remain excluded.

## Agent code
- [Reviewer implementation: rule selection and finding postprocessing](proof/three-agent/gk-bag.mjs)
- [Frozen v13.1 reviewer used in the reported holdout](proof/three-agent/gate-keeper-v13.1.md), [v12](proof/three-agent/gate-keeper-v12.md), [v13](proof/three-agent/gate-keeper-v13.md)
- [Core TrueForge manifest and instructions](agent/)
- [Review-method composition](scripts/review-mode.mjs)
- [Comparative review/evaluation harness](proof/three-agent/run.mjs)

The core manifest and frozen benchmark prompts are distinct assets; each report identifies the prompt used. The historical harness includes optional prompt-training experiments. It is benchmark tooling, not the proprietary product runtime or repair executor.

## Published test evidence
- [v12 unseen holdout](proof/submissions/gk-holdout-20261107-a/report.md)
- [v13.1 unseen holdout](proof/submissions/gk-holdout-20261107-v13/report.md)
- [Live comparison report](proof/submissions/gk-live-20261101-g/report.md) and [summary](proof/submissions/gk-live-20261101-g/summary.json)
- [DeepSeek playground report](proof/submissions/gk-playground-deepseek-20261102-a/report.md) and [summary](proof/submissions/gk-playground-deepseek-20261102-a/summary.json)
- [Self-review and hand-check](docs/selfreview-20261108.md)
- [All submissions](proof/submissions/), [baseline](proof/baseline.json), [evaluation fixtures](evals/tasks/), and [proof fixtures/tests](proof/fixtures/)

Reports are historical and restored without changing findings or caveats. Costs are estimates where stated. Private holdout tasks, answer keys and raw replies remain private; their statistics cannot be independently recomputed from this snapshot. Restoration is not a new benchmark run or production-readiness claim.

## Local source checks
With Node.js 24+, run `npm test` and `npm run score:selftest`. No credentials, network access or paid model calls are needed. Proof fixtures deliberately contain defects, so their baseline tests are not expected to all pass.

The historical harness requires the TrueForge SDK, an authorised TrueForge instance/model, a prepared task payload and an explicitly controlled spend budget. Do not run it as a source check. When using the bag, set `GK3_BAG_PATH` to the absolute path of `proof/three-agent/gk-bag.mjs`. The payload builder `proof/three-agent/build.mjs` additionally requires Python 3.11+ and Jinja2. Hosted deployment configuration and private payload blobs are not included.

## Scope and provenance
Selected files were restored from the preserved snapshot without reconnecting old product history. Historical commit references inside reports identify provenance, not guaranteed public links. Website evidence links should use these restored paths on main or a clean restoration commit.

See [LICENSE](LICENSE), [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) and [comparator licences](proof/three-agent/vendor/). Prior grants and third-party attribution are unchanged.
