import {DEEPSEEK,CHATGPT,describeProviders,resolveTrueForgeModel} from "./registry.mjs";
const status=describeProviders();
let chosen=null,selectionError=null;
try {chosen=resolveTrueForgeModel();}
catch(e){selectionError=e.message;}
console.log(JSON.stringify({
  executionRuntime:"TrueForge",
  selectedModel:chosen||"agent/agent.json default",
  selectionError,
  providers:{
    deepseek:{
      apiBaseUrl:DEEPSEEK.baseUrl,models:DEEPSEEK.models,
      configuredInTrueForge:status.deepseek.configuredInTrueForge,
      credentialPresentLocally:status.deepseek.apiKeyPresentHere,
      active:!!chosen && !selectionError,
    },
    chatgpt:{
      method:"OAuth2 + PKCE; open-source local client only",
      localConnectionCommand:"npm run connect:chatgpt -- login",
      hostedInference:"DISABLED_PENDING_PARTNER_AUTHORIZATION",
      trueForgeModelRouting:"NOT_YET_CONNECTED",
      consentRequired:true,
    },
  },
},null,2));
