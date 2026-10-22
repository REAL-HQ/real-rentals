import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {assertRecordRentalDisabled,checkContractImporterPins,checkLockedFilePins,checkPaths,checkDigest,checkOutput,checkRecordRentalPins,checkScope,inspectOptionsFromArgv} from './guard.mjs';
const m=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
const paths=Object.keys({...m.application,...m.evidence});let count=0;
function test(name,fn){fn();console.log('PASS '+name);count++;}
test('ten original plus four approved evidence paths accepted',()=>checkPaths(paths));
test('application plus separate CI paths accepted',()=>checkPaths([...paths,...m.ciFiles]));
for(const p of paths)test('missing application path rejected: '+p,()=>assert.throws(()=>checkPaths(paths.filter(x=>x!==p))));
for(const p of ['drizzle/migrations/new.sql','src/lib/stripe-new.ts','docs/extra.md','.github/workflows/paper-validation.yml'])test('unapproved path rejected: '+p,()=>assert.throws(()=>checkPaths([...paths,p])));
test('pinned package.json and bun.lock are allowed paths',()=>checkPaths([...paths,'package.json','bun.lock']));
test('altered package.json hash rejected',()=>assert.throws(()=>checkScope(paths,f=>f==='package.json'?Buffer.from('{}\n'):readFileSync(f))));
test('altered bun.lock hash rejected',()=>assert.throws(()=>checkScope(paths,f=>f==='bun.lock'?Buffer.from('changed\n'):readFileSync(f))));
test('duplicate path rejected',()=>assert.throws(()=>checkPaths([...paths,paths[0]])));
test('rc mode is opt-in and does not replace checkPaths',()=>{
 assert.deepEqual(inspectOptionsFromArgv(['node','guard.mjs']),{rc:false});
 assert.deepEqual(inspectOptionsFromArgv(['node','guard.mjs','--rc']),{rc:true});
 assert.throws(()=>checkPaths([...paths,'docs/stripe-reconciliation-review.md']));
 assertRecordRentalDisabled(readFileSync);
 checkRecordRentalPins(readFileSync);
 checkLockedFilePins(readFileSync);
 checkContractImporterPins(readFileSync);
});
function mutate(path,change){
 return p=>p===path?change(readFileSync(p).toString()):readFileSync(p);
}
test('commented false export does not hide a true record-rental flag',()=>{
 assert.throws(()=>assertRecordRentalDisabled(mutate('src/lib/record-rental-contract.ts',src=>src.replace(
  'export const RECORD_RENTAL_CONTRACT_ENABLED = false;',
  '// export const RECORD_RENTAL_CONTRACT_ENABLED = false;\nexport const RECORD_RENTAL_CONTRACT_ENABLED = true;'
 ))));
});
test('deleted handler flag check is rejected',()=>{
 assert.throws(()=>assertRecordRentalDisabled(mutate('src/lib/record-rental.functions.ts',src=>src.replace(
  "if (!RECORD_RENTAL_CONTRACT_ENABLED) throw new Error('Record Rental is disabled pending contract installation and acceptance');",
  ''
 ))));
});
test('hidden __on gate in a flag file is rejected',()=>{
 assert.throws(()=>assertRecordRentalDisabled(mutate('src/lib/rentals.functions.ts',src=>src+"\nconst open = RECORD_RENTAL_CONTRACT_ENABLED || __on;\n")));
});
test('handler upsert, rpc, and delete are rejected',()=>{
 for(const call of ['.upsert(','.rpc(','.delete(']){
  assert.throws(()=>assertRecordRentalDisabled(mutate('src/lib/record-rental.functions.ts',src=>src+`\nvoid db${call}row);\n`)));
 }
});
test('locked package.json and bun.lock are pinned in the RC check',()=>{
 assert.throws(()=>checkLockedFilePins(mutate('package.json',src=>src+'\n')));
 assert.throws(()=>checkLockedFilePins(mutate('bun.lock',src=>src+'\n')));
});
test('an insert in a contract importer is rejected',()=>{
 assert.throws(()=>checkContractImporterPins(mutate('src/lib/record-rental-operation.server.ts',src=>src+"\nvoid db.insert(row);\n")));
 assert.throws(()=>checkContractImporterPins(mutate('src/lib/record-rental-recovery.ts',src=>src+'\n')));
 assert.throws(()=>checkContractImporterPins(mutate('src/lib/record-rental-evidence.server.ts',src=>src+'\n')));
});
const bytes=Buffer.from('reviewed'),digest=createHash('sha256').update(bytes).digest('hex');
test('exact bytes accepted',()=>checkDigest(bytes,digest));
test('changed bytes rejected',()=>assert.throws(()=>checkDigest(Buffer.from('changed'),digest)));
for(const suite of m.suites){
 const ok={status:0,signal:null,stdout:suite.stdout,stderr:''};
 test('complete output accepted: '+suite.file,()=>checkOutput(suite,ok));
 for(const [label,patch] of Object.entries({failure:{status:1},missing:{stdout:''},skip:{stdout:suite.stdout+'\nSKIP'},substitution:{stdout:suite.stdout.replace('PASS','OMITTED')},tooling:{stderr:'Module not found'},timeout:{signal:'SIGTERM'},runner:{error:new Error('spawn')}}))test(label+' rejected: '+suite.file,()=>assert.throws(()=>checkOutput(suite,{...ok,...patch})));
}
const identity=m.suites.find(s=>s.stderrKind==='identity-esbuild-progress');
const progress='.identity-build/docs.mjs  147.1kb\n\n⚡ Done in 7ms\n\n  .identity-build/apps.mjs  3.4mb ⚠️\n\n⚡ Done in 59ms';
const built={status:0,signal:null,stdout:identity.stdout,stderr:progress};
test('specific successful esbuild progress accepted',()=>checkOutput(identity,built));
test('additional error after progress rejected',()=>assert.throws(()=>checkOutput(identity,{...built,stderr:progress+'\nerror: failure'})));
assert.equal(m.suites.filter(x=>x.kind==='application assertions').reduce((a,x)=>a+x.checks,0),130);
assert.equal(m.suites.find(x=>x.kind==='scenario groups').checks,2);
assert.equal(m.suites.find(x=>x.kind==='evidence assertions').checks,31);
const driversPanel=m.application['src/components/admin/DriversPanel.tsx'];
test('DriversPanel pin records the RC3–RC7 justification',()=>{
 assert.equal(driversPanel.sha256,'e83587096bc3953414817f39d338d67d2d4e7087a1e84308d73f7fa799b45fb5');
 assert.match(driversPanel.justification,/9c6cc91670d353b955c4337e8db9eed5a76c355c2036aaad04c9b6c09b13e07f/);
 assert.match(driversPanel.justification,/0ebddd0f/);
 assert.match(driversPanel.justification,/67348401/);
 assert.match(driversPanel.justification,/9e5cb3fd/);
 assert.match(driversPanel.justification,/e25ec28b/);
 assert.match(driversPanel.justification,/8ca05d51/);
 assert.match(driversPanel.justification,/8ef7f8c5/);
 assert.match(driversPanel.justification,/a53f837f/);
 assert.match(driversPanel.justification,/b175d63c/);
 assert.match(driversPanel.justification,/d3be19d9/);
 assert.match(driversPanel.justification,/17807108/);
 assert.match(driversPanel.justification,/cff56f56/);
 assert.match(driversPanel.justification,/146028a7/);
 assert.match(driversPanel.justification,/69ecfeec/);
});
test('full source including evidence hashes accepted',()=>checkScope(paths,readFileSync));
for(const p of Object.keys(m.evidence)) {
 test('altered evidence hash rejected: '+p,()=>assert.throws(()=>checkScope(paths,f=>f===p?Buffer.from('altered'):readFileSync(f))));
 test('missing evidence source rejected: '+p,()=>assert.throws(()=>checkScope(paths,f=>{if(f===p)throw Error('missing');return readFileSync(f)})));
}
for(const p of ['drizzle/migrations/evidence-v1.sql','supabase/migrations/evidence-v1.sql','proposed/extra.sql'])test('unapproved SQL path rejected: '+p,()=>assert.throws(()=>checkPaths([...paths,p])));
console.log(`PASS ${count} CI guard controls`);
