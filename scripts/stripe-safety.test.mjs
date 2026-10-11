import { build } from 'esbuild';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHmac } from 'node:crypto';
import assert from 'node:assert/strict';
const dir=mkdtempSync(join(tmpdir(),'rr-stripe-tests-')); let passed=0;
const test=async(name,fn)=>{await fn();passed++;console.log('PASS',name)};
async function load(name, plugins=[]){const outfile=join(dir,name.replaceAll('/','_')+'.mjs'); await build({entryPoints:[name],outfile,bundle:true,platform:'node',format:'esm',plugins,logLevel:'silent',alias:{'@':resolve('src')}});return import(pathToFileURL(outfile));}
try {
 const safety=await load('src/lib/payment-safety.ts');
 for(const [role,owner,ok] of [['driver',null,false],['driver','other',false],['driver','u',true],['coordinator','u',false],['admin',null,true],['team',null,true]]) await test(`card guard ${role}/${owner}`,()=>assert.equal(safety.canSaveCard('u',owner,[role]),ok));
 await test('anonymous fails closed',()=>assert.equal(safety.canSaveCard('',null,[]),false));
 await test('cancel failure never clears mapping',async()=>{let clear=false;await assert.rejects(()=>safety.cancelMappedSubscription('sub',async()=>{throw Error()},async()=>{clear=true}),/Retry Required/);assert.equal(clear,false)});
 await test('unconfirmed cancellation never clears',async()=>{let clear=false;await assert.rejects(()=>safety.cancelMappedSubscription('sub',async()=>({status:'active'}),async()=>{clear=true}));assert.equal(clear,false)});
 await test('confirmed cancellation clears exact mapping',async()=>{let clear;await safety.cancelMappedSubscription('sub',async()=>({status:'canceled'}),async id=>{clear=id});assert.equal(clear,'sub')});
 await test('local persistence failure propagates',async()=>assert.rejects(()=>safety.cancelMappedSubscription('sub',async()=>({status:'canceled'}),async()=>{throw Error('save')}),/save/));
 await test('price uses supported Prices shape',()=>assert.deepEqual(safety.weeklyPriceInput('r',350),{currency:'usd',unit_amount:35000,recurring:{interval:'week'},product_data:{name:'Weekly Rent — Rental r'}}));
 for(const rate of [0,-1,NaN,Infinity])await test(`invalid rate ${rate}`,()=>assert.throws(()=>safety.weeklyPriceInput('r',rate)));
 const report=await load('src/lib/revenue-report.ts');
 await test('overdue uses balance including explicit zero',()=>{assert.equal(report.outstanding({amount:350,balance_due:100}),100);assert.equal(report.outstanding({amount:350,balance_due:0}),0)});
 await test('collections separate deposit refunds and unpaid',()=>assert.deepEqual(report.collectionSummary([{type:'rent',status:'paid',net_collected:300,refunded_amount:50},{type:'deposit',status:'paid',net_collected:200},{type:'damage',status:'paid',net_collected:25},{type:'rent',status:'pending',net_collected:999}]),{revenue:325,refunds:50,deposits:200}));
 for(const tz of ['UTC','America/New_York','America/Los_Angeles'])await test(`calendar week ${tz}`,()=>{process.env.TZ=tz;assert.equal(new Date(report.weekStart('2026-10-11')).toISOString(),'2026-10-11T00:00:00.000Z');assert.equal(report.weekStart('2026-03-08'),Date.UTC(2026,2,8))});
 await test('invalid money rejected',()=>assert.throws(()=>report.collectionSummary([{status:'paid',net_collected:null}])));
 const paging=await load('src/lib/waitlist-reads.server.ts');
 await test('complete pagination honors lower response caps',async()=>{const all=Array.from({length:451},(_,i)=>({id:String(i)}));assert.equal((await paging.completeRead(async from=>({data:all.slice(from,from+37),count:451,error:null}))).length,451)});
 for(const r of [{data:null,count:1,error:{}},{data:[],count:1,error:null},{data:[],count:null,error:null}])await test('incomplete query rejected',()=>assert.rejects(()=>paging.completeRead(async()=>r)));
 const recon=await load('src/lib/stripe-reconciliation.ts');
 const input={complete:true,subscriptions:[{id:'sub',customerId:'cus'}],rentals:[],invoices:[],refunds:[],payments:[],paymentIntents:[],financialRecords:[]};
 await test('external subscription never guessed',()=>assert.equal(recon.reconcileStripe(input).issues[0].kind,'unmatched_subscription'));
 await test('dry run never mutates input and replay stable',()=>{const before=JSON.stringify(input);assert.deepEqual(recon.reconcileStripe(input),recon.reconcileStripe(input));assert.equal(JSON.stringify(input),before)});
 await test('duplicate rental associations flagged',()=>assert.equal(recon.reconcileStripe({...input,rentals:[{id:'r1',subscriptionId:'sub',customerId:'cus'},{id:'r2',subscriptionId:'sub',customerId:'cus'}]}).issues[0].kind,'ambiguous_subscription'));
 await test('partial export rejected',()=>assert.throws(()=>recon.reconcileStripe({...input,complete:false})));
 const stripe=await load('src/lib/stripe.server.ts');process.env.PAYMENTS_SANDBOX_WEBHOOK_SECRET='synthetic-test-secret';
 const body=JSON.stringify({type:'invoice.paid',data:{object:{id:'synthetic'}}});
 const request=(t,b=body,secret='synthetic-test-secret')=>new Request('https://test.invalid',{method:'POST',body:b,headers:{'stripe-signature':`t=${t},v1=${createHmac('sha256',secret).update(`${t}.${body}`).digest('hex')}`}});
 await test('signed synthetic webhook accepted',async()=>assert.equal((await stripe.verifyWebhook(request(Math.floor(Date.now()/1000)),'sandbox')).type,'invoice.paid'));
 await test('tampered webhook rejected',()=>assert.rejects(()=>stripe.verifyWebhook(request(Math.floor(Date.now()/1000),'{}'),'sandbox')));
 await test('wrong secret rejected',()=>assert.rejects(()=>stripe.verifyWebhook(request(Math.floor(Date.now()/1000),body,'wrong'),'sandbox')));
 await test('expired webhook rejected',()=>assert.rejects(()=>stripe.verifyWebhook(request(1),'sandbox')));
 await test('NaN timestamp rejected even with valid HMAC',()=>assert.rejects(()=>stripe.verifyWebhook(request('NaN'),'sandbox')));
 // Exercise actual card server handler, with network-free dependencies.
 const stubs={
 '@tanstack/react-start':`export const createServerFn=()=>{let protectedCall=false;const a={middleware:()=>{protectedCall=true;return a},inputValidator:()=>a,handler:f=>async x=>{if(protectedCall&&!x.context?.userId)throw Error('Unauthorized');return f(x)}};return a}`,
 '@/integrations/supabase/auth-middleware':'export const requireSupabaseAuth={}',
 '@/integrations/supabase/client.server':'export const supabaseAdmin={from:(...a)=>globalThis.db.from(...a)}',
 '@/lib/stripe.server':'export const createStripeClient=()=>{globalThis.stripeCalls++;if(globalThis.stripeOverride)return globalThis.stripeOverride;return {customers:{create:async()=>({id:"cus"})},checkout:{sessions:{create:async()=>({client_secret:"synthetic"})}}}};export const getStripeErrorMessage=e=>e.message;',
 };
 const plugin={name:'fixtures',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:a.path.startsWith('@/') && a.path!=='@/lib/payment-safety'?{path:a.path,external:true}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'js'}))}};
 const handler=await load('src/lib/payments.functions.ts',[plugin]);
 for(const [role,owner,allowed] of [['driver',null,false],['driver','wrong',false],['driver','u',true],['admin',null,true],['team',null,true],['coordinator','u',false]])await test(`actual card endpoint ${role}/${owner}`,async()=>{
 globalThis.stripeCalls=0;globalThis.db={from(table){const q={select:()=>q,eq:()=>q,update:()=>q,maybeSingle:async()=>({data:{id:'app',user_id:owner,stripe_customer_id:'cus'},error:null}),then:(ok)=>Promise.resolve({data:table==='user_roles'?[{role}]:[],error:null}).then(ok)};return q}};
 const r=await handler.createCardOnFileSession({data:{applicationId:'app',environment:'sandbox',returnUrl:'https://test.invalid'},context:{userId:'u',supabase:globalThis.db}});assert.equal('clientSecret' in r,allowed);assert.equal(globalThis.stripeCalls,allowed?1:0);
 });
 await test('card middleware denies anonymous before database',()=>assert.rejects(()=>handler.createCardOnFileSession({data:{},context:{}}),/Unauthorized/));
 const rentalHandlers=await load('src/lib/rental-payments.functions.ts',[plugin]);
 let writes, cancelled, created, failCancel, failWrite;
 const rental={id:'r',application_id:'a',weekly_rate:350,stripe_customer_id:'cus',stripe_payment_method_id:'pm',stripe_subscription_id:'sub'};
 const resetRental=()=>{
 writes=[];cancelled=false;created=null;failCancel=false;failWrite=false;
 globalThis.db={from(){let mutation=null;const q={select:()=>q,eq:()=>q,update:x=>{mutation=x;return q},maybeSingle:async()=>({data:{...rental},error:null}),then:ok=>{if(mutation)writes.push(mutation);return Promise.resolve({data:mutation?[{id:'r'}]:[],error:failWrite?{}:null}).then(ok)}};return q},rpc:async()=>({data:true,error:null})};
 globalThis.stripeOverride={customers:{update:async()=>{}},prices:{create:async p=>{assert.equal(p.recurring.interval,'week');assert.equal(p.unit_amount,35000);return {id:'price'}}},subscriptions:{cancel:async()=>{if(failCancel)throw Error('provider down');cancelled=true;return {status:'canceled'}},create:async p=>{created=p;return {id:'sub_new'}}}};
 };
 const ctx=()=>({userId:'u',supabase:globalThis.db});
 await test('actual cancellation endpoint retains mapping on provider failure',async()=>{resetRental();failCancel=true;const r=await rentalHandlers.stopRentalAutopay({data:{rentalId:'r',environment:'sandbox'},context:ctx()});assert.match(r.error,/Retry Required/);assert.equal(writes.length,0)});
 await test('actual cancellation endpoint clears only after provider success',async()=>{resetRental();const r=await rentalHandlers.stopRentalAutopay({data:{rentalId:'r',environment:'sandbox'},context:ctx()});assert.equal(r.ok,true);assert.equal(cancelled,true);assert.deepEqual(writes,[{stripe_subscription_id:null,autopay_active:false}])});
 await test('actual cancellation endpoint reports local write failure',async()=>{resetRental();failWrite=true;const r=await rentalHandlers.stopRentalAutopay({data:{rentalId:'r',environment:'sandbox'},context:ctx()});assert.match(r.error,/reconciliation/)});
 await test('actual weekly creation passes price ID not unsupported product_data',async()=>{resetRental();rental.stripe_subscription_id=null;const r=await rentalHandlers.startRentalAutopay({data:{rentalId:'r',environment:'sandbox'},context:ctx()});assert.equal(r.ok,true);assert.deepEqual(created.items,[{price:'price'}]);assert.equal(created.collection_method,'charge_automatically');assert.equal(writes[0].stripe_subscription_id,'sub_new')});
 console.log(`${passed} tests passed; synthetic only; no network calls`);
} finally {rmSync(dir,{recursive:true,force:true})}
