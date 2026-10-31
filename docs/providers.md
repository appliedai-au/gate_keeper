# Gate Keeper: DeepSeek API and ChatGPT OAuth

TrueForge remains the agent runtime and safety boundary. Connecting a model does **not** enable automatic learning, repair execution, or promotion.

## DeepSeek API (BYOK)

Gate Keeper supports DeepSeek through a **TrueForge OpenAI-compatible custom provider**.

| Role | Official DeepSeek API model ID |
| --- | --- |
| Economical classification and first-pass review | `deepseek-flash` |
| More demanding code reasoning | `deepseek-v4-pro` |

- API base URL: `https://api.deepseek.com`
- Obtain a key in the [DeepSeek API console](https://platform.deepseek.com/api_keys).
- In the **private TrueForge administration UI**, open **Settings → Models → Configure provider**. Select a custom OpenAI-compatible provider and enter the DeepSeek API base URL and API key into TrueForge's protected settings. Add the two model IDs above.
- Confirm the exact **provider-qualified model name** exposed by TrueForge. Do not assume it is `deepseek/...` or `custom/...`; the running instance's model registry is authoritative.
- On a trusted Gate Keeper worker set `GK_MODEL_PROVIDER=deepseek`, `GK_MODEL_TIER=economy` or `advanced`, and the applicable `GK_TRUEFORGE_DEEPSEEK_ECONOMY_MODEL` / `GK_TRUEFORGE_DEEPSEEK_ADVANCED_MODEL` to that verified name. Run `npm run providers:status` to see whether selection is correctly configured.
- **Do not** set `TF_MODEL` simultaneously with `GK_MODEL_PROVIDER=deepseek`; the agent rejects conflicting selections.
- **Do not** enter the DeepSeek API key in ChatGPT, commit it to `.env`, a public repo or provider metadata. A tenant BYOK connection must use a separate tenant-scoped credential broker; the present model registry is an operator-level configuration.

Official sources: https://api-docs.deepseek.com/en/ and https://api-docs.deepseek.com/quick_start/pricing/ .

The previous Claude default in `agent/agent.json` remains unchanged. Model migration requires new benchmark and security qualification; lower cost is not evidence of equal defect-detection quality.

## ChatGPT OAuth — local open-source connection

The **local OSS** connection supports the officially documented OpenAI *Sign in with ChatGPT* flow with OAuth 2.0 authorization-code + PKCE. It uses a loopback callback on `127.0.0.1`, issued dynamic client IDs, JWKS-verified ID tokens, a nonce and state, separately granted inference scopes, and protected local credential files.

### Use

From a local machine running Gate Keeper (not a Railway service):

```bash
npm ci
npm run connect:chatgpt -- login
# Open the printed OpenAI authorization URL, sign in and approve the scopes you want.
npm run connect:chatgpt -- status
```

The command stores individual account records under `~/.config/gate-keeper/chatgpt-oauth/` using owner-only permissions. Multiple authorised registrations can be stored without exposing the tokens in the status output.

**Identity login is separate from ChatGPT-plan inference consent.** The local connection requests `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`; it reports whether `chatgpt.tokens.use.direct` and `resource.invoke` were granted. It never retrieves a user's OpenAI Platform API key, conversations or memories.

### Important activation limit

The connection authenticates and stores a local account; it **does not** make a ChatGPT-plan model available to TrueForge yet. TrueForge is not configured to interpret these OAuth access tokens as its model provider keys. Do not copy tokens to the custom-provider API key field or use undocumented ChatGPT backend endpoints.

The documented OSS dynamic-registration flow is for locally hosted/open-source clients. **Commercial hosted Gate Keeper / Railway integration requires separate OpenAI partner eligibility and an approved integration**, plus a tenant-scoped token broker, refresh/revocation controls, independently enforced usage budgets and an adapter respecting the Responses API requirements. The hosted option must remain disabled until these are qualified.

The official inference contract for eligible OAuth access uses the public OpenAI Responses API with `store:false` and `stream:true`, with account-specific model discovery; model availability depends on the authenticated account and its granted entitlements.

Official sources:
- https://developers.openai.com/siwc/token-sharing-open-source
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference

## Security constraints

- Each provider/account has a separate identity; account switching does not mix credentials.
- A user's permission for provider routing and source sharing must be explicit. DeepSeek API data-use and residency policy must be evaluated separately for customer code.
- Gate Keeper's independent spend control, signed learning baseline, verifier, private holdouts and admin gate are **not replaced** by OAuth subscription limits.
- Automatic model fallback and automatic learning remain disabled pending independently verified policy.
- No live credential or paid inference test is performed by `providers:status` or the source test suite.

## Current scope

| Capability | Implemented | Live on hosted Gate Keeper |
| --- | --- | --- |
| DeepSeek API model catalog and TrueForge model selection | Yes | No; requires protected key, verified model IDs and qualification |
| ChatGPT local OAuth registration and validated identity | Yes | No; local open-source clients only |
| Multiple stored ChatGPT account registrations | Yes | No tenant account manager yet |
| ChatGPT-plan inference through TrueForge | No | No |
| TrueForge-hosted multi-tenant BYOK | No | No |
