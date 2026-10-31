/**
 * Local-only, one-shot ChatGPT plan test transport.
 * Uses OpenAI's public Responses API, not ChatGPT private/backend endpoints.
 * No retries, no arbitrary tools, no source-code transmission.
 * This DOES NOT create a TrueForge provider adapter or hosted integration.
 */
const ORIGIN="https://api.openai.com";
const MODEL_ENDPOINT=ORIGIN+"/v1/models";
const RESPONSE_ENDPOINT=ORIGIN+"/v1/responses";
const SMOKE_INPUT="Reply with exactly the token GATE_KEEPER_OAUTH_OK and no other text.";
function held(message){throw Error("CHATGPT_SMOKE_HELD: "+message);}
function credential(token){
 if(typeof token!=="string"||token.length<20||/[\r\n]/.test(token))held("OAuth access token missing or malformed");
 return token;
}
async function request(fetchImpl,url,token,options) {
 let response;
 try {response=await fetchImpl(url,{...options,redirect:"error",signal:AbortSignal.timeout(20000)});}
 catch {held("network or response timeout; no automatic retry");}
 if(!response.ok)held("OpenAI returned HTTP "+response.status+"; no automatic retry");
 return response;
}
export async function listChatGPTPlanModels({accessToken,fetchImpl=fetch}){
 const token=credential(accessToken);
 const response=await request(fetchImpl,MODEL_ENDPOINT,token,{
   method:"GET",headers:{Authorization:"Bearer "+token,Accept:"application/json"},
 });
 const raw=await response.text();
 if(raw.length>250000)held("model catalog too large");
 let data;
 try {data=JSON.parse(raw);}catch{held("invalid model catalog");}
 const names=data?.models;
 if(!Array.isArray(names))held("no account-specific model catalog");
 return names.filter(x=>x?.visibility==="list"&&typeof x.slug==="string"&&
   /^[a-zA-Z0-9._-]{2,120}$/.test(x.slug))
   .map(x=>({id:x.slug,name:typeof x.display_name==="string"?x.display_name:x.slug}));
}
export async function runChatGPTPlanSmoke({accessToken,model,fetchImpl=fetch}){
 const token=credential(accessToken);
 if(typeof model!=="string"||!/^[a-zA-Z0-9._-]{2,120}$/.test(model))held("unverified model name");
 const response=await request(fetchImpl,RESPONSE_ENDPOINT,token,{
   method:"POST",headers:{Authorization:"Bearer "+token,"Content-Type":"application/json",
     Accept:"text/event-stream"},
   body:JSON.stringify({model,input:[{role:"user",content:SMOKE_INPUT}],store:false,stream:true}),
 });
 if(!response.body)held("no response event stream");
 let bytes=0,buffer="",done=false,terminal=false,output="";
 const decoder=new TextDecoder();
 for await(const chunk of response.body){
   bytes+=chunk.length;
   if(bytes>300000)held("event stream exceeded safe bound");
   buffer+=decoder.decode(chunk,{stream:true}).replaceAll("\r\n","\n");
   let pos;
   while((pos=buffer.indexOf("\n\n"))>=0){
     const event=buffer.slice(0,pos);buffer=buffer.slice(pos+2);
     const payload=event.split("\n").filter(x=>x.startsWith("data:"))
       .map(x=>x.slice(5).trimStart()).join("\n");
     if(!payload||payload==="[DONE]")continue;
     let value;
     try{value=JSON.parse(payload);}catch{held("malformed response event");}
     if(value.type==="response.output_text.delta"){
       if(terminal)held("output after terminal event");
       output+=String(value.delta||"");
       if(output.length>5000)held("output exceeded safe bound");
     }else if(value.type==="response.completed"){
       if(terminal)held("duplicate terminal event");
       terminal=true;done=true;
     }else if(["response.failed","response.incomplete","error"].includes(value.type)){
       held("response not completed: "+String(value.response?.error?.code||value.error?.code||value.type).slice(0,80));
     }
   }
 }
 if(!done)held("stream ended without response.completed");
 return Object.freeze({completed:true,model,outputMatchesExpected:output.trim()==="GATE_KEEPER_OAUTH_OK"});
}
