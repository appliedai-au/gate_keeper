# Gate Keeper model access: TrueForge first

## Product contract

Gate Keeper is a TrueForge agent. It does **not** need its own API-key or OAuth screen when an operator already configured the requested model in TrueForge.

1. **Default path:** Use a model available under **TrueForge → Settings → Models**. Credentials, rate limits, model administration, provider accounting and billing belong to the TrueForge model operator or their optional TrueFoundry AI Gateway. Individual Gate Keeper users should not have to re-enter provider credentials.
2. **Multiple models:** A TrueForge operator may configure several providers/models. The agent can use an explicitly selected, provider-qualified model name. Separate provider roles can be added later without changing the credential boundary.
3. **No provider adapters in Gate Keeper:** the earlier local ChatGPT-OAuth and DeepSeek BYOK adapters were removed (November 2026) as duplicates of TrueForge Settings -> Models. Configure any provider in TrueForge and select its registered ID.
4. **No silent fallback:** Unavailable or unapproved models must fail closed. Do not silently route code to another provider, use another user's account, or bypass budget and source-sharing policy.

## Managed TrueForge model selection

Configure the required model in TrueForge's protected Settings → Models UI. This might be a model provider key held by TrueForge, or a managed TrueFoundry AI Gateway registry. **TrueForge being hosted does not imply provider inference is prepaid.** TrueFoundry's AI Gateway documents BYOK; its own fees do not include external model-provider charges.

Then configure the Gate Keeper worker:

```bash
GK_MODEL_PROVIDER=trueforge
GK_TRUEFORGE_MODEL=anthropic/claude-sonnet-4-6  # example only: copy the exact registered TrueForge ID
npm run providers:status
npm run setup
```

The configured model name is checked against `tf.models.list()` before `syncAgent`; unknown names are rejected, without fallback. Never put provider API keys in Git, Gate Keeper task metadata or the user-facing UI. A single operator key for the managed TrueForge model catalog does not turn ChatGPT subscription OAuth into an approved hosted provider.

Keep `TF_MODEL` and `GK_MODEL_TIER` unset when `GK_MODEL_PROVIDER=trueforge`; conflicting overrides are rejected.

For compatibility, the existing default agent manifest still selects its model when `GK_MODEL_PROVIDER` is unset. Operators can explicitly set the managed route after configuring the model. This release does **not** turn on a new model or change production credentials automatically.

## Release gates

- Model exists in the exact TrueForge environment used for the run.
- No unknown or stale model IDs; no unauthorized provider fallback.
- Tenant source-data-use consent is enforced independently of model selection.
- User-scoped auth if/when a legally approved hosted model-access flow exists.
- Independent spend gateway before paid autonomous learning; do not imply TrueForge's rate limits replace the learning budget gate.
- Full end-to-end evaluation and adversarial review before promoting a new model.

Official references:
- https://github.com/truefoundry/trueforge/blob/main/docs/quickstart.mdx
- https://www.truefoundry.io/trueforge
- https://www.truefoundry.com/blog/byok-ai-gateway
