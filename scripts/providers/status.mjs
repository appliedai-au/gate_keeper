import {DEEPSEEK,describeProviders,resolveTrueForgeModel} from "./registry.mjs";
const status=describeProviders();
let chosen=null,selectionError=null;
try {chosen=resolveTrueForgeModel();}
catch(e){selectionError=e.message;}
const selection=process.env.GK_MODEL_PROVIDER||"default";
console.log(JSON.stringify({
  executionRuntime:"TrueForge",
  connectionPolicy:"trueforge-first",
  activeRoute:selection==="trueforge"?"trueforge-managed":selection==="deepseek"?"trueforge-configured-deepseek":selection==="default"?"agent-manifest":"invalid",
  selectedModel:chosen||"agent/agent.json default",
  selectionError,
  credentialsExposedToGateKeeper:false,
  providers:{
    trueforge:{
      preferred:true,managedModelConfigured:status.trueforge.managedModelConfigured,
      setup:"Choose an enabled model in TrueForge Settings -> Models; Gate Keeper never asks for a raw provider key",
      underlyingModelCharges:"Owned by the configured model provider or TrueFoundry AI Gateway, not included by default",
    },
    deepseek:{
      availableAsOptionalTrueForgeProvider:true,
      apiBaseUrl:DEEPSEEK.baseUrl,
      modelIds:DEEPSEEK.models,
      configuredInTrueForge:status.deepseek.configuredInTrueForge,
      requiresAdminSourceSharingApproval:true,
    },
    chatgpt:{
      localOpenSourcePlanConnection:"OPT_IN",
      localCommand:"npm run connect:chatgpt -- login",
      hostedInference:"NOT_AUTHORISED",
      trueForgeHostedModelRouting:"NOT_CONFIGURED",
      consentRequired:true,
    },
  },
},null,2));
