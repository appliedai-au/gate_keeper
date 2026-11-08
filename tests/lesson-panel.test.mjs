import test from 'node:test';
import assert from 'node:assert/strict';
import { createLearningPolicyClient, createLearningPolicyController } from '../integrations/base44/product/learning-policy-panel.mjs';
const deferred = () => { let resolve, reject; const promise = new Promise((a,b) => { resolve=a; reject=b; }); return { promise, resolve, reject }; };
const saved = (revision=1, value=true) => ({ revision, requireAdversarialVerification:value, automaticExecutionReady:false });

test('preview never performs an admin request or save', async () => {
 let calls=0; const client=createLearningPolicyClient({mode:'preview',fetcher(){calls++;throw Error();}});
 await assert.rejects(client.load(), /preview_only/u); await assert.rejects(client.save({}), /preview_only/u);
 assert.equal(calls,0);
});
test('client uses only established HTTPS product route with session credentials and CSRF', async () => {
 const calls=[]; const client=createLearningPolicyClient({baseUrl:'https://gate.g8s.test/gatekeeper/product-v1',mode:'live',
  fetcher:async (url,options)=>{calls.push({url,options});return new Response(JSON.stringify({data:saved(calls.length)}),{headers:{'Content-Type':'application/json'}});}});
 await client.load(); const body={requireAdversarialVerification:false,expectedRevision:1,reason:'Test'}; await client.save(body);
 assert.equal(calls[0].url,'https://gate.g8s.test/gatekeeper/product-v1/admin/learning-policy');
 assert.equal(calls[0].options.credentials,'include'); assert.equal(calls[0].options.cache,'no-store');
 assert.equal(calls[1].options.headers['X-G8S-Request'],'1'); assert.deepEqual(JSON.parse(calls[1].options.body),body);
});
test('client refuses noncanonical config before fetch', async () => {
 for(const baseUrl of ['http://gate.g8s.test/gatekeeper/product-v1','https://gate.g8s.test/other','https://user:pass@gate.g8s.test/gatekeeper/product-v1']){
  let calls=0;const client=createLearningPolicyClient({baseUrl,mode:'live',fetcher(){calls++;}});
  await assert.rejects(client.load());assert.equal(calls,0);
 }
});
test('unreported checkbox has no writable false default', async () => {
 const c=createLearningPolicyController({load:async()=>({revision:1}),save:()=>assert.fail()},{enabled:true});
 assert.equal(c.getSnapshot().value,null);await c.load(); assert.equal(c.getSnapshot().status,'readback_required');
 assert.deepEqual(c.edit(false,'Guess'),{blocked:true});assert.deepEqual(await c.save(),{blocked:true});
});
test('non-admin/disabled controller never loads or writes', async () => {
 let calls=0;const c=createLearningPolicyController({load(){calls++;},save(){calls++;}});
 assert.deepEqual(await c.load(),{blocked:true});assert.deepEqual(await c.save(),{blocked:true});assert.equal(calls,0);
});
test('checkbox save requires reason and real revision, and serializes double clicks', async () => {
 const pending=deferred(),writes=[];
 const c=createLearningPolicyController({load:async()=>saved(),save:input=>{writes.push(input);return pending.promise;}},{enabled:true});
 await c.load();c.edit(false,'');assert.deepEqual(await c.save(),{blocked:true});c.edit(false,'Deliberate policy change');
 const first=c.save();assert.deepEqual(await c.save(),{blocked:true});assert.deepEqual(c.edit(true,'during save'),{blocked:true});
 pending.resolve(saved(2,false));await first;
 assert.deepEqual(writes,[{requireAdversarialVerification:false,expectedRevision:1,reason:'Deliberate policy change'}]);
 assert.equal(c.getSnapshot().value,false);assert.equal(c.getSnapshot().revision,2);
});
test('conflict or lost acknowledgement requires readback and is never auto-retried', async () => {
 for(const message of ['revision_conflict','network_error']){
  let writes=0;const c=createLearningPolicyController({load:async()=>saved(),save:async()=>{writes++;throw Error(message);}},{enabled:true});
  await c.load();c.edit(false,'Synthetic');await c.save();assert.equal(c.getSnapshot().status,'readback_required');
  assert.deepEqual(await c.save(),{blocked:true});assert.equal(writes,1);
  await c.load();assert.equal(c.getSnapshot().value,true);
 }
});
test('unmount invalidates delayed results and previously retained actions', async () => {
 const pending=deferred();let writes=0;
 const c=createLearningPolicyController({load:()=>pending.promise,save(){writes++;}},{enabled:true});
 const loading=c.load();c.dispose();pending.resolve(saved());await loading;
 assert.equal(c.getSnapshot().value,null);assert.deepEqual(await c.save(),{blocked:true});assert.equal(writes,0);
});
test('successful HTTP response with malformed boolean is not a saved policy', async () => {
 const client=createLearningPolicyClient({baseUrl:'https://gate.g8s.test/gatekeeper/product-v1',mode:'live',fetcher:async()=>
  new Response(JSON.stringify({data:{revision:1,requireAdversarialVerification:'true'}}),{headers:{'Content-Type':'application/json'}})});
 await assert.rejects(client.load(),/protocol_error/u);
});
