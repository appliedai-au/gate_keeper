export declare const DEEPSEEK: Readonly<{provider:"deepseek";auth:"api_key";baseUrl:string;models:Readonly<{economy:string;advanced:string}>;requires:string;transport:string}>;
export declare const CHATGPT: Readonly<{provider:"chatgpt";auth:"oauth_pkce";scopes:string;inference:string;localOpenSourceOnly:boolean;hostedStatus:string;trueForgeAdapter:string}>;
export declare function resolveTrueForgeModel(env?:NodeJS.ProcessEnv):string|undefined;
export declare function describeProviders(env?:NodeJS.ProcessEnv):{trueforge:{managedModelConfigured:boolean;providerKeysExposedToGateKeeper:boolean;mode:string;note:string};deepseek:{configuredInTrueForge:boolean;apiKeyPresentHere:boolean;note:string};chatgpt:{localOssFlow:string;hostedInference:string;userConsentRequired:boolean;note:string}};
