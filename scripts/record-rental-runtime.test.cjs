const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {createRecordRentalTransportV2}=require('../src/lib/record-rental-runtime.server.ts'),{executeRecordRental}=require('../src/lib/record-rental-operation.server.ts');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,hash=b=>createHash('sha256').update(b).digest('hex'),bytes=Buffer.from('synthetic'),sha=hash(bytes),time='2026-01-01T12:00:00Z';
const terms={record_rental_terms_v1:{effectiveAt:time,weeklyCents:35000,currency:'usd'}};
const binding={version:sha,sha256:sha,agreement:id(7),application:id(2),driver:id(8),vehicle:id(3),bucket:'rental-agreements',path:`immutable-v1/${id(9)}/${sha}.pdf`,body_sha256:hash('signed'),merge_data:terms};
const doc={id:id(9),driver_id:id(2),content_sha256:sha,is_current:true,superseded_by:null,storage_bucket:binding.bucket,storage_path:binding.path,integrity_v1:binding};
const ag={id:id(7),application_id:id(2),vehicle_id:id(3),status:'signed',signed_at:time,voided_at:null,archive_status:'archived',document_id:id(9),completed_document_id:id(9),sha256:sha,body_sha256:binding.body_sha256,body:'signed',merge_data:terms};
let token=null,issues=0,calls=0,role='admin',lost=true;
const output={status:'recorded',rentalId:id(4),customerNumber:1,bookingNumber:2,recovered:false,billing:'unchanged',paymentsImported:0};
const context={userId:id(5),claims:{session_id:id(6)},supabase:{
 auth:{getClaims:async()=>({data:{claims:{sub:id(5),session_id:id(6),exp:Math.floor(Date.now()/1000)+1000}},error:null})},
 from(table){const data=table==='agreements'?ag:table==='documents'?doc:[{role}];const q={select(){return q},eq(){return q},single:async()=>({data,error:null}),limit:async()=>({data:[data],error:null}),then(resolve,reject){return Promise.resolve({data,error:null}).then(resolve,reject)}};return q},
 rpc:async(name,args)=>{assert.equal(name,'record_existing_rental_evidence_v1');assert.equal(args.token,id(11));calls++;if(lost){lost=false;return {error:'lost',data:null}}return {data:{...output,recovered:true},error:null}}
}};
const config={sql:{transaction:async cb=>cb(async(sql,args)=>{
 if(sql.includes('current_user'))return [{role:'rr_evidence_issuer'}];if(sql.includes('set_config'))return [{}];
 if(sql.includes('recover_record'))return [{value:token}];
 if(sql.includes('record_identity_reader'))return [{value:{applicationId:id(2),driverId:id(8),positiveReview:id(10),reviewVersion:'exact',currentVersion:'exact',licenseNumber:'SYN',licenseState:'FL',licenseExpires:'2099-01-01',licenseDocumentVersion:'bound',reviewedLicenseVersion:'bound',eligible:true}}];
 if(sql.includes('record_snapshot'))return [{value:{document:{id:id(9),version:sha,sha256:sha}}}];
 if(sql.includes('issue_record')){issues++;token=id(11);return [{value:token}]};throw Error(sql);
 })},download:async()=>bytes,linkage:async()=>({driverId:id(8),account:'acct_A',environment:'sandbox',currency:'usd',subscriptionId:'sub_A',customer:'cus_A'}),provider:{accounts:{retrieve:async()=>({id:'acct_A'})},subscriptions:{retrieve:async()=>({id:'sub_A',customer:'cus_A',livemode:false,status:'active',items:{has_more:false,data:[{quantity:1,current_period_end:null,price:{currency:'usd',unit_amount:35000,recurring:{interval:'week',interval_count:1}}}]}})}}};
const req={operationId:id(1),applicationId:id(2),vehicleId:id(3),startedAt:time,weeklyRate:350,deposit:null,pickupMileage:1000,subscriptionEvidenceId:null,reason:'synthetic'};
(async()=>{const transport=createRecordRentalTransportV2(context,'synthetic',config),signal=new AbortController().signal;
 await assert.rejects(executeRecordRental(req,id(5),transport,signal),/recover/);assert.equal(issues,1);assert.equal(calls,1);
 const r=await executeRecordRental(req,id(5),transport,signal);assert.equal(r.recovered,true);assert.equal(issues,1);assert.equal(calls,2);
 role='coordinator';await assert.rejects(executeRecordRental(req,id(5),transport,signal));assert.equal(calls,2);
 console.log('PASS 3 assembled runtime scenarios: trusted issuance/ambiguous response, original-token recovery, current-role denial; mocked SQL/provider only');
})().catch(e=>{console.error(e);process.exitCode=1});
