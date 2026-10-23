const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),ts=require('typescript');
let enabled=false, role='admin',calls=0,roleCalls=0,ensures=0;
function load(file,imports){const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:n=>{if(n in imports)return imports[n];throw Error('Unexpected dependency '+n)},console});return exports;}
const contract=load('src/lib/record-rental-contract.ts',{zod:require('zod')});
assert.equal(contract.RECORD_RENTAL_CONTRACT_ENABLED,false);
const modules={zod:require('zod'),'./record-rental-contract':{...contract,get RECORD_RENTAL_CONTRACT_ENABLED(){return enabled}},'@/integrations/supabase/auth-middleware':{requireSupabaseAuth:{}},'@tanstack/react-start':{createServerFn(){let parse;return {middleware(){return this},inputValidator(f){parse=f;return this},handler(fn){return async arg=>fn({...arg,data:parse(arg.data)})}}}},'./roles.server':{requireManager:async()=>{roleCalls++;if(!['admin','team'].includes(role))throw Error('forbidden')}}};
modules['@tanstack/react-start/server']={getRequest:()=>new Request('https://synthetic.invalid',{headers:{authorization:'Bearer synthetic'}})};
modules['./record-rental-resources.server']={ensureRecordRentalResources:async()=>{assert.ok(roleCalls>0,'resources built before the Manager check');ensures++}};
modules['./record-rental-runtime.server']={getRecordRentalTransportV2:(c,t)=>{assert.equal(t,'synthetic');return c.supabase}};
modules['./record-rental-operation.server']={executeRecordRental:async(req,actor,transport)=>{const r=await transport.rpc('record_existing_rental_evidence_v1',{token:id(9),req});if(r.error)throw Error(r.error.message);return contract.recordResult.parse(r.data)}};
const handler=load('src/lib/record-rental.functions.ts',modules).recordExistingRentalV3;
const recovery=load('src/lib/record-rental-recovery.ts',{'./record-rental-contract':contract});
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const req={operationId:id(1),applicationId:id(2),vehicleId:id(3),startedAt:'2026-10-15T10:00:00-04:00',weeklyRate:350,deposit:null,pickupMileage:null,subscriptionEvidenceId:null,reason:'synthetic intake'};
let response={data:{status:'recorded',rentalId:id(4),customerNumber:1,bookingNumber:2,recovered:false,billing:'unchanged',paymentsImported:0},error:null};
const context={userId:id(5),supabase:{rpc:async(name,args)=>{calls++;assert.equal(name,'record_existing_rental_evidence_v1');assert.equal(args.req.deposit,null);assert.equal(args.req.operationId,req.operationId);assert.equal(args.token,id(9));assert.equal('_actor' in args,false);return response}}};
const data={request:req,expectedActorId:id(5)};
let pass=0;async function test(name,f){await f();pass++;console.log('PASS',name)}
(async()=>{
await test('disabled before any database or role read',async()=>{await assert.rejects(handler({data,context}),/disabled/);assert.equal(calls+roleCalls+ensures,0)});
enabled=true;
await test('Owner uses exact authenticated RPC',async()=>{await handler({data,context})});
await test('Manager allowed',async()=>{role='team';await handler({data,context})});
for(const r of ['coordinator','driver','anonymous'])await test(r+' denied',async()=>{role=r;const n=calls;await assert.rejects(handler({data,context}),/forbidden/);assert.equal(calls,n)});
role='admin';
await test('account switch rejects request binding',async()=>{const n=calls;await assert.rejects(handler({data:{...data,expectedActorId:id(8)},context}),/Session changed/);assert.equal(calls,n)});
await test('missing RPC no fallback or retry',async()=>{response={data:null,error:{message:'RPC absent'}};const n=calls;await assert.rejects(handler({data,context}),/RPC absent/);assert.equal(calls,n+1)});
await test('unknown and zero deposits distinct',async()=>{assert.equal(contract.recordRpcArgs(req)._deposit,null);assert.equal(contract.recordRpcArgs({...req,deposit:0})._deposit,0)});
await test('timestamp must contain time and offset',async()=>{assert.throws(()=>contract.recordRequest.parse({...req,startedAt:'2026-10-15'}))});
const map=new Map(),store={getItem:k=>map.get(k)??null,setItem:(k,v)=>map.set(k,v)};
await test('recovery survives reload exact operation',async()=>{recovery.saveRecovery(store,id(5),req);assert.equal(JSON.stringify(recovery.readRecovery(store,id(5),id(2))),JSON.stringify(req))});
await test('recovery isolated from other actor and applicant',async()=>{assert.equal(recovery.readRecovery(store,id(8),id(2)),null);assert.equal(recovery.readRecovery(store,id(5),id(7)),null)});
await test('forged storage binding rejected',async()=>{map.set(recovery.recoveryKey(id(5),id(7)),map.get(recovery.recoveryKey(id(5),id(2))));assert.throws(()=>recovery.readRecovery(store,id(5),id(7)))});
await test('storage error prevents operation persistence',async()=>{assert.throws(()=>recovery.saveRecovery({setItem(){throw Error('storage denied')}},id(5),req),/storage denied/)});
await test('disabled UI and no Stripe/payment import path',async()=>{const ui=fs.readFileSync('src/components/admin/RecordRentalDialog.tsx','utf8');assert.match(ui,/disabled=\{!RECORD_RENTAL_CONTRACT_ENABLED/);const s=fs.readFileSync('src/lib/record-rental.functions.ts','utf8');assert.doesNotMatch(s,/supabaseAdmin|createStripeClient|\.insert\(|\.update\(/)});
console.log(JSON.stringify({pass,fail:0}));
})().catch(e=>{console.error(e);process.exitCode=1});
