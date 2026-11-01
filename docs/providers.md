# Model providers

Gate Keeper does not connect to model providers directly. TrueForge owns model access, credentials, rate limits and billing.

1. Configure a provider and model in **TrueForge -> Settings -> Models**. This can be Anthropic, OpenAI, DeepSeek (an OpenAI-compatible custom provider) or a TrueFoundry AI Gateway.
2. Either leave `GK_MODEL_PROVIDER` unset to use `agent/agent.json`, or set `GK_MODEL_PROVIDER=trueforge` and `GK_TRUEFORGE_MODEL=<provider/model>` with the exact registered ID.
3. Run `npm run providers:status`, then `npm run setup`. Setup verifies the ID against `tf.models.list()` before any agent change, and unknown IDs fail closed.

Source-code sharing consent for a third-party provider is an operator decision made in TrueForge, separate from model selection. Gate Keeper never stores provider keys, never falls back to another provider, and runs no provider-specific login or adapter code.

History: local ChatGPT-OAuth and DeepSeek BYOK adapters (PRs #4 to #6) were removed in November 2026 as duplicates of TrueForge's model management.
