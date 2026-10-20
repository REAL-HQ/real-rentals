const fs=require('fs'), path=require('path'), vm=require('vm'), assert=require('assert/strict');
const {createRequire}=require('module');
const deps=createRequire(path.resolve('package.json'));
const ts=deps('typescript'),z=deps('zod');
const source=fs.readFileSync(path.resolve('src/lib/rentals.functions.ts'),'utf8');
const built=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true});
assert.equal((built.diagnostics||[]).filter(x=>x.category===ts.DiagnosticCategory.Error).length,0);
let featureEnabled=true;
let calls=[],forbidden=0,deny=false,allowLegacy=false,legacyCalls=[],auditCalls=0;
let legacyResponse, rentalStatus='active';
const admin={from(){return {select(){return this},eq(){return this},async maybeSingle(){return {data:{id:id(1),vehicle_id:id(7),driver_id:id(8),status:rentalStatus}}}}},async rpc(...a){legacyCalls.push(a);return legacyResponse}};
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const good={contract:'record-close-v2',rentalId:id(1),operationId:id(2),assignmentId:id(3),vehicleStatus:'maintenance',releaseReasons:['Safety hold'],recovered:false,billing:'unchanged'};
let response={data:good,error:null};
const sandbox={exports:{},console,process:{env:{}},require(name){
 if(name==='@tanstack/react-start')return {createServerFn(){let parse;return {middleware(){return this},inputValidator(f){parse=f;return this},handler(f){return async x=>f({...x,data:parse(x.data)})}}}};
 if(name==='@/integrations/supabase/auth-middleware')return {requireSupabaseAuth:{}};
 if(name==='@/lib/vehicle-readiness')return {notReadyMessage:()=>null};
 if(name==='./record-rental-contract')return {get RECORD_RENTAL_CONTRACT_ENABLED(){return featureEnabled}};
 if(name==='zod')return z;
 if(name==='@/lib/roles.server')return {requireManager:async uid=>{if(deny)throw Error('forbidden');return {userId:uid}}};
 if(allowLegacy && name==='@/integrations/supabase/client.server')return {supabaseAdmin:admin};
 if(allowLegacy && name==='@/lib/audit.server')return {logAudit:async()=>{auditCalls++}};
 forbidden++;throw Error('Unexpected dependency: '+name);
}};
vm.runInNewContext(built.outputText,sandbox);
const data={rentalId:id(1),closeoutV2:{operationId:id(2),endedAt:'2026-10-16T16:42:12.123456Z'},vehicleStatus:'available',returnMileage:1200,reason:'synthetic closeout'};
const context={userId:id(4),supabase:{rpc:async (...args)=>{calls.push(args);return response}}};
let results=[];async function test(name,f){await f();results.push({name,result:'PASS'});console.log('PASS',name)}
(async()=>{
 await test('proposed caller transpiles',async()=>{});
 await test('authenticated RPC with exact timestamp and no actor override',async()=>{const r=await sandbox.exports.endRental({data,context});assert.equal(r.closeout.vehicleStatus,'maintenance');assert.equal(calls[0][0],'close_recorded_rental_v2');assert.equal(calls[0][1]._ended_at,data.closeoutV2.endedAt);assert.equal('_actor' in calls[0][1],false)});
 await test('recovery uses original operation before legacy closed shortcut',async()=>{response={data:{...good,recovered:true},error:null};const r=await sandbox.exports.endRental({data,context});assert.equal(r.closeout.recovered,true);assert.equal(calls.at(-1)[1]._operation_id,id(2))});
 await test('missing RPC fails without fallback',async()=>{response={data:null,error:{message:'function absent'}};await assert.rejects(sandbox.exports.endRental({data,context}),/function absent/);assert.equal(forbidden,0)});
 await test('ambiguous transport does not automatically retry',async()=>{const n=calls.length;response={data:null,error:{message:'response lost'}};await assert.rejects(sandbox.exports.endRental({data,context}),/response lost/);assert.equal(calls.length,n+1)});
 await test('mismatched operation response rejected',async()=>{response={data:{...good,operationId:id(9)},error:null};await assert.rejects(sandbox.exports.endRental({data,context}),/binding mismatch/)});
 await test('malformed response rejected',async()=>{response={data:{...good,billing:'charged'},error:null};await assert.rejects(sandbox.exports.endRental({data,context}))});
 await test('non-ISO infinite timestamp rejected before RPC',async()=>{const n=calls.length;await assert.rejects(sandbox.exports.endRental({data:{...data,closeoutV2:{...data.closeoutV2,endedAt:'-infinity'}},context}));assert.equal(calls.length,n)});
 await test('missing reason rejected before RPC',async()=>{const n=calls.length;await assert.rejects(sandbox.exports.endRental({data:{...data,reason:''},context}));assert.equal(calls.length,n)});
 await test('server role denial before RPC',async()=>{deny=true;const n=calls.length;await assert.rejects(sandbox.exports.endRental({data,context}),/forbidden/);assert.equal(calls.length,n)});
 deny=false;allowLegacy=true;
 const legacyData={rentalId:id(1),endDate:'2026-10-16',vehicleStatus:'available',returnMileage:1200,reason:'synthetic closeout'};
 const valid={contract:'safe-release-v1',alreadyClosed:false,vehicleStatus:'maintenance',releaseReasons:['Safety hold'],billing:'unchanged_unverified'};
 await test('nonledger exact named contract and actor',async()=>{legacyResponse={data:valid,error:null};const r=await sandbox.exports.endRental({data:legacyData,context});assert.deepEqual(Object.keys(legacyCalls[0][1]).sort(),['_actor','_end','_release_contract','_rental_id','_return_miles','_vehicle_status'].sort());assert.equal(legacyCalls[0][1]._release_contract,'safe-release-v1');assert.equal(legacyCalls[0][1]._actor,context.userId);assert.equal(legacyCalls[0][1]._end,'2026-10-16');assert.equal(legacyCalls[0][1]._return_miles,1200);assert.equal(r.lifecycle.vehicleStatus,'maintenance')});
 await test('nonledger structured alreadyClosed response',async()=>{legacyResponse={data:{contract:'safe-release-v1',alreadyClosed:true},error:null};const n=auditCalls;const r=await sandbox.exports.endRental({data:legacyData,context});assert.equal(r.alreadyClosed,true);assert.equal(auditCalls,n)});
 for (const [label,bad] of [['missing contract',{...valid,contract:undefined}],['wrong contract',{...valid,contract:'wrong'}],['missing disposition',{...valid,vehicleStatus:undefined}],['malformed reasons',{...valid,releaseReasons:'clear'}],['old string','already_closed']]) {
  await test('nonledger rejects '+label,async()=>{legacyResponse={data:bad,error:null};const n=auditCalls;await assert.rejects(sandbox.exports.endRental({data:legacyData,context}));assert.equal(auditCalls,n)});
 }
 await test('nonledger denied RPC is not retried',async()=>{legacyResponse={data:null,error:{message:'safe_release_client_required'}};const n=legacyCalls.length;await assert.rejects(sandbox.exports.endRental({data:legacyData,context}),/safe_release_client_required/);assert.equal(legacyCalls.length,n+1)});
 await test('ledger failure never falls back to legacy service client',async()=>{response={data:null,error:{message:'versioned error'}};const n=legacyCalls.length;await assert.rejects(sandbox.exports.endRental({data,context}),/versioned error/);assert.equal(legacyCalls.length,n)});
 await test('nonledger already closed precheck no second mutation',async()=>{rentalStatus='closed';const n=legacyCalls.length;const r=await sandbox.exports.endRental({data:legacyData,context});assert.equal(r.alreadyClosed,true);assert.equal(legacyCalls.length,n)});
 featureEnabled=false;rentalStatus='active';deny=false;
 await test('disabled ledger endpoint refuses before RPC',async()=>{const n=calls.length;await assert.rejects(sandbox.exports.endRental({data,context}),/disabled/);assert.equal(calls.length,n)});
 await test('disabled integration preserves legacy five-argument path',async()=>{legacyResponse={data:'already_closed',error:null};const r=await sandbox.exports.endRental({data:legacyData,context});assert.equal(r.alreadyClosed,true);assert.equal('_release_contract' in legacyCalls.at(-1)[1],false)});
 console.log(JSON.stringify({pass:results.length,fail:0}));
})().catch(e=>{console.error(e);process.exitCode=1});
