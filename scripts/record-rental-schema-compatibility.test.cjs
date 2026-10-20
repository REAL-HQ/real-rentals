const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {readEsign}=require('../src/lib/record-rental-readers.server.ts');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,h='a'.repeat(64),t='2026-01-01T12:00:00Z';
function fixture(){
 const ag={id:id(1),application_id:id(2),vehicle_id:id(3),status:'signed',signed_at:t,voided_at:null,archive_status:'archived',completed_document_id:id(4),sha256:h,body_sha256:h};
 const doc={id:id(4),driver_id:id(2),content_sha256:h,is_current:true,superseded_by:null,storage_bucket:'rental-agreements',storage_path:'synthetic.pdf'};
 const artifact={version:'external-verified-fixture-version',sha256:h,bodySha256:h,applicationId:id(2),driverId:id(5),vehicleId:id(3),effectiveAt:t,weeklyCents:35000,currency:'usd'};
 const client={from(){const q={select(){return q},eq(){return q},limit:async()=>({data:[ag]}),single:async()=>({data:doc})};return q}};
 return {ag,doc,artifact,run:()=>readEsign(client,{verify:async()=>artifact},id(2),id(3))};
}
(async()=>{let n=0;async function test(name,fn){await fn();console.log('PASS '+name);n++}
 await test('content_sha256 mapping with independently verified artifact',async()=>{const f=fixture(),r=await f.run();assert.equal(r.currentHash,h);assert.equal(r.documentId,id(4));assert.equal(r.currentVersion,f.artifact.version)});
 for(const [name,edit] of [['wrong document ID',f=>f.doc.id=id(99)],['missing authoritative hash',f=>f.doc.content_sha256=null],['changed hash',f=>f.doc.content_sha256='b'.repeat(64)],['changed signed hash',f=>f.ag.sha256='b'.repeat(64)],['superseded document',f=>f.doc.superseded_by=id(99)],['non-current document',f=>f.doc.is_current=false],['missing immutable version',f=>f.artifact.version=''],['wrong application',f=>f.artifact.applicationId=id(99)],['wrong vehicle',f=>f.artifact.vehicleId=id(99)]])await test(name+' rejected',async()=>{const f=fixture();edit(f);await assert.rejects(f.run())});
 await test('existing conflict reviews are not positive license verification',()=>{const sql=fs.readFileSync('drizzle/migrations/0019_application_identity_reviews.sql','utf8');assert.match(sql,/same_person.*different_person.*dismissed/);assert.doesNotMatch(sql,/approval_evidence|resolution='verified'/)});
 console.log(JSON.stringify({pass:n,fail:0,note:'synthetic immutable artifact; not proof of archive immutability'}));
})().catch(e=>{console.error(e);process.exitCode=1});
