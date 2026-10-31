import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {listChatGPTPlanModels,runChatGPTPlanSmoke} from "../scripts/providers/chatgpt-plan-smoke.mjs";

const accessToken="test_token_not_real_1234567890123";
const modelCatalog={models:[
 {slug:"model-eligible-1",display_name:"Qualified model",visibility:"list"},
 {slug:"model-hidden-1",display_name:"Hidden model",visibility:"hidden"},
]};
const sse=parts=>new ReadableStream({
 start(controller){
   for(const part of parts) controller.enqueue(new TextEncoder().encode(part));
   controller.close();
 }
});
const okStream=[
 'event: response.created\ndata: {"type":"response.created"}\n\n',
 'data: {"type":"response.output_text.delta","delta":"GATE_KEEPER_OAUTH_OK"}\n\n',
 'data: {"type":"response.completed","response":{"status":"completed"}}\n\n',
 'data: [DONE]\n\n',
];
test("model listing shows only models available to the selected OAuth token",async()=>{
 const calls=[];
 const fetchImpl=async(url,opt)=>{
   calls.push({url,opt});
   return new Response(JSON.stringify(modelCatalog),{status:200});
 };
 const models=await listChatGPTPlanModels({accessToken,fetchImpl});
 assert.deepEqual(models,[{id:"model-eligible-1",name:"Qualified model"}]);
 assert.equal(calls.length,1);
 assert.equal(calls[0].url,"https://api.openai.com/v1/models");
 assert.equal(calls[0].opt.headers.Authorization,"Bearer "+accessToken);
});
test("one minimal subscription request uses public Responses with stream=true and store=false",async()=>{
 let call;
 const fetchImpl=async(url,opt)=>{call={url,opt};return new Response(sse(okStream),{status:200});};
 const result=await runChatGPTPlanSmoke({accessToken,model:"model-eligible-1",fetchImpl});
 assert.equal(result.completed,true);
 assert.equal(result.outputMatchesExpected,true);
 assert.equal(call.url,"https://api.openai.com/v1/responses");
 assert.equal(call.opt.redirect,"error");
 const request=JSON.parse(call.opt.body);
 assert.equal(request.store,false);
 assert.equal(request.stream,true);
 assert.equal(request.model,"model-eligible-1");
 assert.deepEqual(Object.keys(request).sort(),["input","model","store","stream"]);
 assert.equal(JSON.stringify(request).includes("source code"),false);
});
test("stream completion requires a terminal response.completed",async()=>{
 const fetchImpl=async()=>new Response(sse(['data: {"type":"response.output_text.delta","delta":"partial"}\n\n']),{status:200});
 await assert.rejects(()=>runChatGPTPlanSmoke({accessToken,model:"model-eligible-1",fetchImpl}),/without response.completed/);
});
test("incomplete or failed stream never counts as successful",async()=>{
 for(const event of ["response.failed","response.incomplete","error"]) {
   const fetchImpl=async()=>new Response(sse(['data: '+JSON.stringify({type:event})+'\n\n']),{status:200});
   await assert.rejects(()=>runChatGPTPlanSmoke({accessToken,model:"model-eligible-1",fetchImpl}),/response not completed/);
 }
});
test("usage-limit HTTP response stops and does not retry",async()=>{
 let calls=0;
 const fetchImpl=async()=>{calls++;return new Response("",{status:429});};
 await assert.rejects(()=>runChatGPTPlanSmoke({accessToken,model:"model-eligible-1",fetchImpl}),/HTTP 429/);
 assert.equal(calls,1);
});
test("SSE JSON can be split across chunks",async()=>{
 const fetchImpl=async()=>new Response(sse([
 'data: {"type":"response.output_text.del','ta","delta":"GATE_KEEPER_OAUTH_OK"}\n\n',
 'data: {"type":"response.com','pleted"}\n\n'
 ]),{status:200});
 const result=await runChatGPTPlanSmoke({accessToken,model:"model-eligible-1",fetchImpl});
 assert.equal(result.outputMatchesExpected,true);
});

// This public URL has DIFFERENT response shapes depending on credential type.
// The officially documented ChatGPT-plan OAuth catalog uses models/slug/visibility;
// ordinary API-key GET /v1/models uses data/id. Never silently substitute the
// API-key catalog when an OAuth account is selected.
test("OAuth catalog refuses ordinary API-key model response instead of using another billing route",async()=>{
  const apiKeyShape={object:"list",data:[{id:"gpt-test-api-key",object:"model",owned_by:"openai"}]};
  const fetchImpl=async()=>new Response(JSON.stringify(apiKeyShape),{status:200});
  await assert.rejects(()=>listChatGPTPlanModels({accessToken,fetchImpl}),/OAuth account-specific model catalog unavailable/);
});
test("OAuth catalog preserves account-specific order and rejects unlisted models",async()=>{
  const catalog={models:[
    {slug:"model-first",display_name:"First eligible",visibility:"list"},
    {slug:"model-hidden",display_name:"Not eligible",visibility:"hidden"},
    {slug:"model-second",display_name:"Second eligible",visibility:"list"},
    {slug:"../../bad",display_name:"Unsafe",visibility:"list"}
  ]};
  const fetchImpl=async()=>new Response(JSON.stringify(catalog),{status:200});
  assert.deepEqual(await listChatGPTPlanModels({accessToken,fetchImpl}),[
    {id:"model-first",name:"First eligible"},
    {id:"model-second",name:"Second eligible"}
  ]);
});

test("stream completion tolerates CRLF frame boundaries split between TCP chunks",async()=>{
  const fetchImpl=async()=>new Response(sse([
    'data: {"type":"response.output_text.delta","delta":"GATE_KEEPER_OAUTH_OK"}\r',
    '\n\r','\n',
    'data: {"type":"response.completed","response":{"status":"completed"}}\r',
    '\n\r','\n'
  ]),{status:200});
  const result=await runChatGPTPlanSmoke({accessToken,model:"model-eligible-1",fetchImpl});
  assert.equal(result.completed,true);
  assert.equal(result.outputMatchesExpected,true);
});

test("completed stream with wrong answer is not a successful smoke verdict",async()=>{
 const fetchImpl=async()=>new Response(sse([
   'data: {"type":"response.output_text.delta","delta":"unexpected answer"}\n\n',
   'data: {"type":"response.completed","response":{"status":"completed"}}\n\n'
 ]),{status:200});
 const result=await runChatGPTPlanSmoke({accessToken,model:"model-eligible-1",fetchImpl});
 assert.equal(result.completed,true);
 assert.equal(result.outputMatchesExpected,false);
 const cli=readFileSync(new URL("../scripts/providers/chatgpt-subscription-test.mjs",import.meta.url),"utf8");
 assert.match(cli,/if\(!verdict\.outputMatchesExpected\)fail/);
});
