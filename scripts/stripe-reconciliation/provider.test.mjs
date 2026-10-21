import {build} from 'esbuild';import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {pathToFileURL} from 'node:url';import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'stripe-provider-test-'));let n=0;const test=async(name,f)=>{await f();console.log('PASS',name);n++};
globalThis.fetch=async()=>{throw Error('Network forbidden in synthetic suite')};
try{
 await build({entryPoints:['src/lib/stripe-reconciliation.server.ts'],outfile:join(dir,'server.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent'});
 const {invoiceSnapshot,subscriptionSnapshot,routeReconciliationEvent,billingDate}=await import(pathToFileURL(join(dir,'server.mjs')));
 const iterable=rows=>({async *[Symbol.asyncIterator](){for(const r of rows)yield r}});
 let invoice,pi,charge,refunds,payments,subscription;const reset=()=>{
 invoice={id:'in_test',livemode:false,parent:{subscription_details:{subscription:'sub_test'}},customer:'cus_test',currency:'usd',status:'paid',amount_due:35000,amount_paid:35000,period_start:1791691200};
 pi={id:'pi_test',livemode:false,status:'succeeded',currency:'usd',customer:'cus_test',amount_received:35000,latest_charge:'ch_test',metadata:{}};
 charge={id:'ch_test',payment_intent:'pi_test',amount_captured:35000,livemode:false,paid:true,captured:true,currency:'usd',customer:'cus_test',amount_refunded:0,created:1791691200};refunds=[];
 payments=[{invoice:'in_test',payment:{type:'payment_intent',payment_intent:'pi_test'},amount_paid:35000}];
 subscription={id:'sub_test',livemode:false,status:'active',customer:'cus_test',items:{has_more:false,data:[{quantity:1,price:{currency:'usd',unit_amount:35000,recurring:{interval:'week',interval_count:1}}}]}};
 };
 const stripe={invoices:{retrieve:async()=>invoice},invoicePayments:{list:()=>iterable(payments)},paymentIntents:{retrieve:async()=>pi},charges:{retrieve:async()=>charge},refunds:{list:()=>iterable(refunds)},subscriptions:{retrieve:async()=>subscription},checkout:{sessions:{retrieve:async()=>({livemode:false,subscription:'sub_test'})}}};
 await test('verified single-card invoice normalized',async()=>{reset();const s=await invoiceSnapshot(stripe,'in_test','sandbox');assert.equal(s.paid_cents,35000);assert.equal(s.payment_intent_id,'pi_test');assert.equal(s.review_reason,null)});
 await test('external credits never inferred cash',async()=>{reset();payments=[];const s=await invoiceSnapshot(stripe,'in_test','sandbox');assert.equal(s.paid_cents,0);assert.ok(s.review_reason)});
 await test('mixed payment allocation held',async()=>{reset();payments.push({...payments[0]});assert.ok((await invoiceSnapshot(stripe,'in_test','sandbox')).review_reason)});
 await test('wrong provider customer held',async()=>{reset();pi.customer='cus_wrong';assert.ok((await invoiceSnapshot(stripe,'in_test','sandbox')).review_reason)});
 await test('partial invoice held instead of overstated collections',async()=>{reset();invoice.status='open';assert.ok((await invoiceSnapshot(stripe,'in_test','sandbox')).review_reason)});
 await test('live object denied in test environment',async()=>{reset();invoice.livemode=true;await assert.rejects(()=>invoiceSnapshot(stripe,'in_test','sandbox'),/mode mismatch/)});
 await test('successful refunds only and cumulative checked',async()=>{reset();refunds=[{id:'re_1',amount:5000,status:'succeeded'},{id:'re_pending',amount:1000,status:'pending'}];charge.amount_refunded=5000;const s=await invoiceSnapshot(stripe,'in_test','sandbox');assert.equal(s.refunded_cents,5000);assert.equal(s.refunds.length,1)});
 await test('refund changed during read causes retry',async()=>{reset();charge.amount_refunded=100;await assert.rejects(()=>invoiceSnapshot(stripe,'in_test','sandbox'),/snapshot changed/)});
 await test('subscription weekly contract validation',async()=>{reset();assert.equal((await subscriptionSnapshot(stripe,'sub_test','sandbox')).weekly_cents,35000);subscription.items.data[0].price.recurring.interval='month';assert.ok((await subscriptionSnapshot(stripe,'sub_test','sandbox')).review_reason)});
 for(const tz of ['UTC','America/New_York','America/Los_Angeles'])await test('business date independent of process TZ '+tz,()=>{process.env.TZ=tz;process.env.STRIPE_REPORT_TIMEZONE='America/New_York';assert.equal(billingDate(Date.parse('2026-10-21T02:00:00Z')/1000),'2026-10-20')});
 await test('verified Checkout only queues receipt, never links by email',async()=>{reset();let calls=[];const db={rpc:async(name,args)=>{calls.push({name,args});return {data:{state:'review'},error:null}}};await routeReconciliationEvent(db,stripe,{id:'evt_1',livemode:false,type:'checkout.session.completed',data:{object:{id:'cs_test',mode:'subscription',customer_email:'not-used@example.invalid'}}},'sandbox');assert.deepEqual(calls.map(c=>c.name),['stripe_ingest']);assert.ok(!JSON.stringify(calls).includes('example.invalid'))});
 await test('wrong event environment denied',async()=>{await assert.rejects(()=>routeReconciliationEvent({},stripe,{id:'evt',livemode:true,data:{}},'sandbox'))});
 await test('invoice PI event never also runs standalone collection',async()=>{reset();const calls=[];await routeReconciliationEvent({rpc:async(name,args)=>{calls.push(args);return {data:{},error:null}}},stripe,{id:'evt_pi',livemode:false,type:'payment_intent.succeeded',data:{object:{id:'pi_test'}}},'sandbox');assert.equal(calls.length,1);assert.equal(calls[0]._s.kind,'invoice')});
 // Actual server role checks use the existing roles.server module.
 const stubs={
 '@tanstack/react-start':`export const createServerFn=()=>{const a={middleware:()=>a,inputValidator:()=>a,handler:f=>f};return a}`,
 '@/integrations/supabase/auth-middleware':'export const requireSupabaseAuth={}',
 '@/integrations/supabase/client.server':'export const supabaseAdmin={from:(...a)=>globalThis.fixture.from(...a),auth:{admin:{getUserById:async()=>({data:{user:{email:null}}})}}}',
 };
 await build({entryPoints:['src/lib/stripe-reconciliation.functions.ts'],outfile:join(dir,'functions.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',alias:{'@':resolve('src')},plugins:[{name:'stub',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}))}}]});
 const handlers=await import(pathToFileURL(join(dir,'functions.mjs')));process.env.STRIPE_RECONCILIATION_ENABLED='true';process.env.STRIPE_RECONCILIATION_ENV='sandbox';
 let role,reads;globalThis.fixture={from(table){reads.push(table);const q={select:()=>q,eq:()=>q,neq:()=>q,in:()=>q,or:()=>q,order:()=>q,limit:()=>q,then:ok=>Promise.resolve({data:table==='user_roles'?(role?[{role}]:[]):[],error:null}).then(ok)};return q}};
 for(const r of ['coordinator','driver',null])await test('all staff reconciliation handlers deny '+r,async()=>{role=r;reads=[];for(const fn of Object.values(handlers))await assert.rejects(()=>fn({context:{userId:'synthetic'},data:{}}));assert.ok(reads.every(t=>t==='user_roles'))});
 for(const r of ['admin','team'])await test('review list authorized for '+r,async()=>{role=r;reads=[];const x=await handlers.listStripeReview({context:{userId:'synthetic'}});assert.deepEqual(x.events,[]);assert.ok(reads.includes('stripe_event_receipts'))});
 await build({entryPoints:['src/lib/stripe-operations.server.ts'],outfile:join(dir,'ops.mjs'),bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'fake-provider',setup(b){b.onResolve({filter:/stripe-reconciliation\.server$/},a=>({path:a.path,namespace:'fake'}));b.onLoad({filter:/.*/,namespace:'fake'},()=>({contents:'export const reconciliationClient=async()=>globalThis.provider',loader:'js'}))}}]});
 const ops=await import(pathToFileURL(join(dir,'ops.mjs')));
 await test('concurrent creation uses identical provider idempotency parameters',async()=>{
  const requests=new Map();let creations=0;
  globalThis.provider={prices:{create:async(p,o)=>{const old=requests.get(o.idempotencyKey);if(old)assert.deepEqual(old,p);else requests.set(o.idempotencyKey,p);return {id:'price_test'}}},subscriptions:{create:async(p,o)=>{const old=requests.get(o.idempotencyKey);if(old)assert.deepEqual(old,p);else{requests.set(o.idempotencyKey,p);creations++}return {id:'sub_test'}}}};
  const db={rpc:async name=>({data:name==='stripe_claim_creation'?{operation_id:'op_test',created_at:'2026-10-11T12:00:00Z',parameters:{cents:35000,customer:'cus_test',payment_method:'pm_test'}}:{},error:null})};
  await Promise.all(Array.from({length:8},()=>ops.createReservedSubscription(db,'r','sandbox','owner')));assert.equal(creations,1);
 });
 await test('provider cancellation failure persists retry state',async()=>{const states=[];globalThis.provider={subscriptions:{retrieve:async()=>({id:'sub_test',status:'active'}),cancel:async()=>{throw Error('synthetic timeout')}}};await assert.rejects(()=>ops.cancelDurably({rpc:async(n,a)=>{states.push(a._state);return {data:{attempt_id:'attempt'},error:null}}},'r','sub_test','sandbox','owner'),/Cancellation Unknown/);assert.deepEqual(states,['requested','unknown'])});
 await test('already canceled retry confirms without another provider mutation',async()=>{const states=[];globalThis.provider={subscriptions:{retrieve:async()=>({id:'sub_test',status:'canceled'}),cancel:async()=>{throw Error('must not call')}}};await ops.cancelDurably({rpc:async(n,a)=>{states.push(a._state);return {data:{attempt_id:'attempt'},error:null}}},'r','sub_test','sandbox','owner');assert.deepEqual(states,['requested','confirmed'])});
 for(const scenario of ['rejection','timeout','malformed','read failure','confirmation write failure'])await test('cancellation '+scenario+' cannot falsely confirm',async()=>{
  const calls=[];let cancels=0;
  globalThis.provider={subscriptions:{retrieve:async()=>{if(scenario==='read failure')throw Error('secret');return {id:'sub_test',status:'active'}},cancel:async()=>{cancels++;if(scenario==='rejection')throw {type:'StripeInvalidRequestError',statusCode:400,message:'secret'};if(scenario==='timeout')throw Error('secret');return {id:'sub_test',status:scenario==='malformed'?'active':'canceled'}}}};
  const db={rpc:async(n,a)=>{calls.push(a);return {data:{attempt_id:'attempt'},error:scenario==='confirmation write failure'&&a._state==='confirmed'?{}:null}}};
  await assert.rejects(()=>ops.cancelDurably(db,'r','sub_test','sandbox','owner'),e=>!e.message.includes('secret'));
  assert.equal(calls[1]._state,scenario==='rejection'?'failed':scenario==='confirmation write failure'?'confirmed':'unknown');
  assert.equal(calls[1]._attempt,'attempt');assert.ok(!JSON.stringify(calls).includes('secret'));
  if(scenario==='read failure')assert.equal(cancels,0);
 });
 await test('missing durable request receipt prevents provider cancellation',async()=>{globalThis.provider={subscriptions:{retrieve:async()=>{throw Error('must not reach provider')}}};await assert.rejects(()=>ops.cancelDurably({rpc:async()=>({data:{},error:null})},'r','sub_test','sandbox','owner'),/request not recorded/)});
 console.log(`${n} provider and server authorization tests passed`);
}finally{rmSync(dir,{recursive:true,force:true})}
