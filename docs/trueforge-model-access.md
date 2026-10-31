# Gate Keeper model access: TrueForge first

## Product contract

Gate Keeper is a TrueForge agent. It does **not** need its own API-key or ChatGPT-OAuth screen when an operator already configured the requested model in TrueForge.

1. **Default path:** Use a model available under **TrueForge → Settings → Models**. Credentials, rate limits, model administration, provider accounting and billing belong to the TrueForge model operator or their optional TrueFoundry AI Gateway. Individual Gate Keeper users should not have to re-enter provider credentials.
2. **Multiple models:** A TrueForge operator may configure several providers/models. The agent can use an explicitly selected, provider-qualified model name. Separate provider roles can be added later without changing the credential boundary.
3. **Optional user-owned connections:** DeepSeek BYOK and ChatGPT subscription OAuth remain supported as **advanced opt-in** operations, not required Gate Keeper logins. ChatGPT OAuth is restricted to an eligible user's local/controlled open-source runtime. Gate Keeper cannot expose a general-purpose ChatGPT OAuth API proxy or use a user's subscription in a shared Railway service.
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

## ChatGPT plan test (advanced, local only)

An eligible local user can explicitly register their own ChatGPT subscription for a one-request smoke test:

```bash
npm run connect:chatgpt -- login --email YOUR_OWN_EMAIL
npm run connect:chatgpt -- status
npm run connect:chatgpt -- select YOUR_ISSUED_CLIENT_ID
npm run test:chatgpt-sub -- --confirm --email YOUR_OWN_EMAIL
npm run connect:chatgpt -- deselect
```

The local test is not the production TrueForge model gateway. OAuth credentials must remain under the user's local control, with separate consent for plan usage. The hosted TrueForge integration is not approved/implemented. Do not copy OAuth tokens into TrueForge's model API key field.

**Why not an OAuth-to-OpenAI-compatible proxy?** ChatGPT plan usage supports the public Responses API with restricted fields/tools, `store:false`, `stream:true` and per-user limits. A generic Chat Completions facade backed by a user's subscription can misrepresent tool semantics or create a general-purpose third-party proxy. We will not expose it to shared TrueForge; a dedicated compliant local agent adapter would need independent qualification for every tool call and user boundary, plus permitted authentication and deployment.

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
- https://developers.openai.com/siwc/token-sharing-open-source
- https://openai.com/policies/sign-in-with-chatgpt-terms/
