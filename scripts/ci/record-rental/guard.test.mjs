import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {checkPaths,checkDigest,checkOutput} from './guard.mjs';
const m=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
const paths=Object.keys(m.application);let count=0;
function test(name,fn){fn();console.log('PASS '+name);count++;}
test('ten approved application paths accepted',()=>checkPaths(paths));
test('application plus separate CI paths accepted',()=>checkPaths([...paths,...m.ciFiles]));
for(const p of paths)test('missing application path rejected: '+p,()=>assert.throws(()=>checkPaths(paths.filter(x=>x!==p))));
for(const p of ['drizzle/migrations/new.sql','src/lib/stripe-new.ts','package.json','.github/workflows/paper-validation.yml'])test('unapproved path rejected: '+p,()=>assert.throws(()=>checkPaths([...paths,p])));
test('duplicate path rejected',()=>assert.throws(()=>checkPaths([...paths,paths[0]])));
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
assert.equal(m.suites.filter(x=>x.kind==='application assertions').reduce((a,x)=>a+x.checks,0),126);
assert.equal(m.suites.find(x=>x.kind==='scenario groups').checks,2);
console.log(`PASS ${count} CI guard controls`);
