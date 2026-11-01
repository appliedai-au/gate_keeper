/**
 * Gate Keeper model routing. TrueForge owns model access, credentials and
 * billing (Settings -> Models). Gate Keeper only selects an already-registered,
 * provider-qualified model ID and fails closed; it never holds provider keys
 * and runs no provider-specific adapters of its own.
 */
const MODEL_ID=/^[A-Za-z0-9][A-Za-z0-9._:/-]{2,127}$/;
export function resolveTrueForgeModel(env=process.env) {
  const provider=env.GK_MODEL_PROVIDER || "default";
  if(provider==="default") {
    if(env.GK_MODEL_TIER && env.GK_MODEL_TIER!=="standard")
      throw Error("MODEL_CONFIG_REJECTED: default provider has no tier override");
    return undefined; // agent/agent.json remains the source of truth.
  }
  // Any provider (Anthropic, OpenAI, DeepSeek, a TrueFoundry gateway...) is
  // configured inside TrueForge and selected here by its registered ID. Setup
  // verifies the ID against tf.models.list() before any agent mutation.
  if(provider!=="trueforge") throw Error("MODEL_CONFIG_REJECTED: unapproved model provider");
  if(env.TF_MODEL) throw Error("MODEL_CONFIG_REJECTED: TF_MODEL conflicts with TrueForge-managed routing");
  if(env.GK_MODEL_TIER) throw Error("MODEL_CONFIG_REJECTED: managed model tier must be resolved by TrueForge");
  const id=env.GK_TRUEFORGE_MODEL;
  if(!id || !MODEL_ID.test(id) || !id.includes("/") || id.includes(".."))
    throw Error("MODEL_CONFIG_REJECTED: approved TrueForge model ID missing");
  return id;
}
export function describeProviders(env=process.env) {
  return {
    trueforge: {
      managedModelConfigured:!!env.GK_TRUEFORGE_MODEL,
      providerKeysExposedToGateKeeper:false,
      mode:"ONLY",
      note:"Use a model already enabled in TrueForge Settings -> Models; provider billing stays with its owner",
    },
  };
}
