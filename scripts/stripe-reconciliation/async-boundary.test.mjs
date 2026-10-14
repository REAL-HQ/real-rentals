// Actual rental handlers + durable operations; all database/provider boundaries mocked.
import {build} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
const dir=mkdtempSync('/private/tmp/rr-stripe-boundary-');
const originalFlag=process.env.STRIPE_RECONCILIATION_ENABLED;
const originalFetch=globalThis.fetch;
let network=0,passed=0,scenario,calls,states,writes,method;
const unhandled=[];const onUnhandled=e=>unhandled.push(e);
process.on('unhandledRejection',onUnhandled);
globalThis.fetch=async()=>{network++;throw Error('Network forbidden')};
const stubs={
 '@tanstack/react-start':'export const createServerFn=()=>{const q={middleware:()=>q,inputValidator:()=>q,handler:f=>f};return q}',
 '@/integrations/supabase/auth-middleware':'export const requireSupabaseAuth={}',
 '@/integrations/supabase/client.server':'export const supabaseAdmin={from:(...a)=>globalThis.fixture.from(...a),rpc:(...a)=>globalThis.fixture.rpc(...a)}',
 '@/lib/roles.server':'export const requireManager=async()=>{}',
 '@/lib/stripe.server':'export const createStripeClient=()=>globalThis.provider;export const getStripeErrorMessage=e=>e?.raw?.message??e?.message??"Stripe request failed"',
 './stripe-reconciliation.server':'export const reconciliationClient=async()=>globalThis.provider',
};
async function load(mutation){
 const outfile=dir+'/'+(mutation??'actual')+'.mjs';
 await build({entryPoints:['src/lib/rental-payments.functions.ts'],outfile,bundle:true,platform:'node',format:'esm',logLevel:'silent',plugins:[{name:'fixtures',setup(b){
 b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'fixture'}:a.path.startsWith('@/')?(['@/lib/stripe-operations.server','@/lib/payment-safety'].includes(a.path)?{path:resolve('src',a.path.slice(2)+'.ts')}:{path:a.path,external:true}):undefined);
 b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}));
 if(mutation)b.onLoad({filter:/rental-payments\.functions\.ts$/},a=>({contents:readFileSync(a.path,'utf8').replace('return await '+mutation+'(', 'return '+mutation+'('),loader:'ts'}));
 }}]});return import(pathToFileURL(outfile));
}
function setup(name,which){
 scenario=name;method=which;calls=[];states=[];writes=[];
 const rental={id:'r',weekly_rate:350,stripe_customer_id:'cus',stripe_payment_method_id:'pm',stripe_subscription_id:which==='stopRentalAutopay'?'sub_test':null};
 globalThis.fixture={
  async rpc(n,a){calls.push(n);if(n==='has_role')return {data:true,error:null};
   if(scenario==='network rejection')throw Error('Synthetic database transport unavailable');
   if(['schema absent','missing RPC','permission denied'].includes(scenario))return {data:null,error:{code:scenario==='permission denied'?'42501':scenario==='missing RPC'?'PGRST202':'42P01'}};
   if(n==='stripe_cancel_state')states.push(a._state);
   return {data:n==='stripe_claim_creation'?{operation_id:'op',created_at:'2026-10-14T00:00:00Z',parameters:{cents:35000,customer:'cus',payment_method:'pm'}}:{attempt_id:'attempt'},error:null};
  },
  from(table){let mutation;const q={select:()=>q,eq:()=>q,update:x=>{mutation=x;return q},maybeSingle:async()=>({data:rental,error:null}),then:ok=>{if(mutation)writes.push({table,mutation});return Promise.resolve({data:[{id:'r'}],error:null}).then(ok)}};return q},
 };
 const hit=()=>{calls.push('provider mutation');if(scenario==='provider timeout')throw Error('Synthetic provider timeout')};
 globalThis.provider={customers:{update:async()=>{}},prices:{create:async()=>{hit();return {id:'price'}}},subscriptions:{create:async()=>{hit();return {id:'sub_test'}},retrieve:async()=>({id:'sub_test',status:'active'}),cancel:async()=>{hit();return {id:'sub_test',status:'canceled'}}}};
}
const invoke=(h,name)=>h[name]({data:{rentalId:'r',environment:'sandbox'},context:{userId:'synthetic-manager',supabase:globalThis.fixture}});
try{
 const handlers=await load();
 for(const name of ['startRentalAutopay','stopRentalAutopay'])for(const state of ['schema absent','missing RPC','permission denied','network rejection','provider timeout','success','disabled']){
  setup(state,name);if(state==='disabled')delete process.env.STRIPE_RECONCILIATION_ENABLED;else process.env.STRIPE_RECONCILIATION_ENABLED='true';
  const result=await invoke(handlers,name); // A rejected promise fails the suite, even if the UI would catch it.
  if(['success','disabled'].includes(state)){assert.equal(result.ok,true);assert.ok(!('error' in result))}else{assert.equal(typeof result.error,'string');assert.ok(result.error.length>0);assert.ok(!('ok' in result))}
  if(['schema absent','missing RPC','permission denied','network rejection'].includes(state)){assert.ok(!calls.includes('provider mutation'));assert.equal(writes.length,0)}
  if(state==='provider timeout'&&name==='stopRentalAutopay'){assert.deepEqual(states,['requested','unknown']);assert.match(result.error,/Unknown/);assert.equal(writes.length,0)}
  if(state==='success'&&name==='stopRentalAutopay')assert.deepEqual(states,['requested','confirmed']);
  if(state==='disabled'){assert.ok(calls.every(n=>!n.startsWith('stripe_')));assert.ok(writes.every(w=>w.table==='rentals'))}
  console.log('PASS '+name+' / '+state);passed++;
 }
 for(const [fn,operation] of [['startRentalAutopay','createReservedSubscription'],['stopRentalAutopay','cancelDurably']]){
  const mutant=await load(operation);setup('missing RPC',fn);process.env.STRIPE_RECONCILIATION_ENABLED='true';
  await assert.rejects(()=>invoke(mutant,fn),/Billing operation requires staff reconciliation/);
  console.log('PASS negative control detects missing await in '+fn);passed++;
 }
 await new Promise(r=>setImmediate(r));assert.deepEqual(unhandled,[]);assert.equal(network,0);
 console.log(`${passed} async boundary checks passed; zero unhandled rejections; zero network calls`);
}finally{process.off('unhandledRejection',onUnhandled);globalThis.fetch=originalFetch;if(originalFlag===undefined)delete process.env.STRIPE_RECONCILIATION_ENABLED;else process.env.STRIPE_RECONCILIATION_ENABLED=originalFlag;rmSync(dir,{recursive:true,force:true})}
