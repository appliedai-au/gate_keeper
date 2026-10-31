import {describeProviders,resolveTrueForgeModel} from "./registry.mjs";
const status=describeProviders();
let chosen=null,selectionError=null;
try {chosen=resolveTrueForgeModel();}
catch(e){selectionError=e.message;}
const selection=process.env.GK_MODEL_PROVIDER||"default";
console.log(JSON.stringify({
  executionRuntime:"TrueForge",
  connectionPolicy:"trueforge-only",
  activeRoute:selectionError?"blocked":selection==="trueforge"?"trueforge-managed":"agent-manifest",
  selectedModel:selectionError?null:(chosen||"agent/agent.json default"),
  selectionError,
  credentialsExposedToGateKeeper:false,
  providers:{
    trueforge:{
      managedModelConfigured:status.trueforge.managedModelConfigured,
      setup:"Choose an enabled model in TrueForge Settings -> Models (any provider, including DeepSeek or a TrueFoundry gateway); Gate Keeper never asks for a raw provider key",
      underlyingModelCharges:"Owned by the configured model provider or TrueFoundry AI Gateway, not included by default",
    },
  },
},null,2));
