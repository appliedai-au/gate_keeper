/**
 * Gate Keeper model catalog. TrueForge always owns model execution.
 * Never persist or log a provider API key in Git or model metadata.
 *
 * DeepSeek models are configured as an OpenAI-compatible CUSTOM provider in
 * TrueForge Settings -> Models, with a key stored in TrueForge's secret store.
 */
export const DEEPSEEK = Object.freeze({
  provider: "deepseek",
  auth: "api_key",
  baseUrl: "https://api.deepseek.com",
  models: Object.freeze({
    economy: "deepseek-flash",
    advanced: "deepseek-v4-pro",
  }),
  requires: "DEEPSEEK_API_KEY",
  transport: "openai-compatible",
});
export const CHATGPT = Object.freeze({
  provider: "chatgpt",
  auth: "oauth_pkce",
  scopes: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
  inference: "responses-api",
  localOpenSourceOnly: true,
  hostedStatus: "PARTNER_APPROVAL_REQUIRED",
  trueForgeAdapter: "NOT_CONFIGURED",
});

const MODEL_ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/;
export function resolveTrueForgeModel(env=process.env) {
  const provider=env.GK_MODEL_PROVIDER || "default";
  if(provider==="default") {
    if(env.GK_MODEL_TIER && env.GK_MODEL_TIER!=="standard")
      throw Error("MODEL_CONFIG_REJECTED: default provider has no tier override");
    return undefined; // Existing agent/agent.json remains source of truth.
  }
  if(provider!=="deepseek") throw Error("MODEL_CONFIG_REJECTED: unapproved model provider");
  const tier=env.GK_MODEL_TIER || "economy";
  if(!["economy","advanced"].includes(tier)) throw Error("MODEL_CONFIG_REJECTED: invalid DeepSeek tier");
  // The model identifier is assigned by TrueForge's configured provider
  // catalog and must be confirmed there, not guessed from DeepSeek API names.
  const id=env[tier==="economy"?"GK_TRUEFORGE_DEEPSEEK_ECONOMY_MODEL":"GK_TRUEFORGE_DEEPSEEK_ADVANCED_MODEL"];
  if(!id || !MODEL_ID.test(id)) throw Error("MODEL_CONFIG_REJECTED: configured TrueForge model ID missing");
  if(!id.includes("/")) throw Error("MODEL_CONFIG_REJECTED: expected provider-qualified TrueForge model ID");
  return id;
}
export function describeProviders(env=process.env) {
  return {
    deepseek: {
      configuredInTrueForge: !!(env.GK_TRUEFORGE_DEEPSEEK_ECONOMY_MODEL || env.GK_TRUEFORGE_DEEPSEEK_ADVANCED_MODEL),
      apiKeyPresentHere: !!env.DEEPSEEK_API_KEY,
      note: "API keys belong in TrueForge's protected provider settings, not the Gate Keeper repository",
    },
    chatgpt: {
      localOssFlow: "SUPPORTED",
      hostedInference: "NOT_ACTIVE",
      userConsentRequired: true,
      note: "The local OSS OAuth flow is separate from TrueForge inference and cannot be used as a generic API key",
    },
  };
}
