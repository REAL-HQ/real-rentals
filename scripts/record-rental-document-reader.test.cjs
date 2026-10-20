const fs=require('fs'),ts=require('typescript'),assert=require('node:assert/strict'),{createHash}=require('node:crypto');
require.extensions['.ts']=(m,f)=>m._compile(ts.transpileModule(fs.readFileSync(f,'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,f);
const {assertCompletedDownloadV2,boundSignedTermsV2}=require('../src/lib/record-rental-document-reader.server.ts');
const id=n=>`10000000-0000-4000-8000-${String(n).padStart(12,'0')}`,bytes=Buffer.from('synthetic PDF'),hash=s=>createHash('sha256').update(s).digest('hex');
const terms={record_rental_terms_v1:{effectiveAt:'2026-01-01T12:00:00Z',weeklyCents:35000,currency:'usd'}};
function fixture(){const b={version:hash(bytes),sha256:hash(bytes),agreement:id(1),application:id(2),driver:id(3),vehicle:id(4),bucket:'rental-agreements',path:`immutable-v1/${id(5)}/${hash(bytes)}.pdf`,body_sha256:hash('signed terms'),merge_data:terms};return {a:{id:id(1),application_id:id(2),vehicle_id:id(4),document_id:id(5),completed_document_id:id(5),sha256:b.sha256,body_sha256:b.body_sha256,status:'signed',voided_at:null,archive_status:'archived',body:'signed terms',merge_data:terms},d:{id:id(5),driver_id:id(2),content_sha256:b.sha256,storage_bucket:b.bucket,storage_path:b.path,integrity_v1:b}}}
let n=0;function test(name,f){f();n++;console.log('PASS '+name)}
test('valid bound download and terms',()=>{const {a,d}=fixture();assertCompletedDownloadV2(a,d,bytes);assert.equal(boundSignedTermsV2(a,d,bytes).weeklyCents,35000)});
for(const key of ['document_id','completed_document_id','vehicle_id','application_id'])test(key+' mismatch rejected',()=>{const {a,d}=fixture();a[key]=id(99);assert.throws(()=>assertCompletedDownloadV2(a,d,bytes))});
test('downloaded hash mismatch rejected',()=>{const {a,d}=fixture();assert.throws(()=>assertCompletedDownloadV2(a,d,Buffer.from('wrong')))});
test('legacy access unchanged but not evidence',()=>{const {a,d}=fixture();delete d.integrity_v1;d.storage_path='legacy.pdf';assertCompletedDownloadV2(a,d,bytes);assert.throws(()=>boundSignedTermsV2(a,d,bytes))});
test('protected path missing binding rejects',()=>{const {a,d}=fixture();delete d.integrity_v1;assert.throws(()=>assertCompletedDownloadV2(a,d,bytes))});
test('legacy formatted date cannot become exact signed terms',()=>{const {a,d}=fixture();a.merge_data=d.integrity_v1.merge_data={start_date:'January 1'};assert.throws(()=>boundSignedTermsV2(a,d,bytes))});
test('voided evidence rejected',()=>{const {a,d}=fixture();a.voided_at='2026-01-02';assert.throws(()=>boundSignedTermsV2(a,d,bytes))});
console.log(JSON.stringify({pass:n,fail:0}));
