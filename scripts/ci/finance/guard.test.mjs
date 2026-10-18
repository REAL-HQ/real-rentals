import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyResults, verifyScope, verifyFileHash } from './guard.mjs';
const coverage=JSON.parse(readFileSync(new URL('./test-coverage.json',import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('./source-manifest.json',import.meta.url)));
function good(){return {success:true,numTotalTests:314,numPassedTests:314,numFailedTests:0,numPendingTests:0,numTodoTests:0,numFailedTestSuites:0,numPendingTestSuites:0,testResults:Object.entries(coverage).map(([p,names])=>({name:resolve(p),status:'passed',message:'',assertionResults:names.map(fullName=>({fullName,status:'passed',failureMessages:[]}))}))};}
test('complete reviewed coverage accepted',()=>verifyResults(good(),process.cwd()));
for(const [name,mutate] of Object.entries({
 'missing test file':r=>r.testResults.pop(),
 'missing assertion':r=>r.testResults[0].assertionResults.pop(),
 'skipped check':r=>r.testResults[0].assertionResults[0].status='pending',
 'renamed assertion':r=>r.testResults[0].assertionResults[0].fullName='substitute',
 'financial failure':r=>r.testResults[0].assertionResults[0].status='failed',
 'tooling failure':r=>r.testResults[0].message='Cannot resolve module',
 'duplicate suite':r=>r.testResults[1]=r.testResults[0],
 'todo checks':r=>r.numTodoTests=1
})) test('reject '+name,()=>{const r=good();mutate(r);assert.throws(()=>verifyResults(r,process.cwd()));});
test('exact application scope accepted',()=>verifyScope(Object.keys(manifest.files)));
for(const path of ['package.json','bun.lock','supabase/migrations/unapproved.sql','src/lib/stripe-collections.server.ts','src/routes/admin.tsx'])test('reject unrelated '+path,()=>assert.throws(()=>verifyScope([...Object.keys(manifest.files),path])));

test('manifest requires 35 pinned source paths',()=>assert.equal(Object.keys(manifest.files).length,35));
test('coverage requires 314 assertions in 11 suites',()=>{assert.equal(Object.keys(coverage).length,11);assert.equal(Object.values(coverage).reduce((n,a)=>n+a.length,0),314);});
test('missing approved source path rejected',()=>assert.throws(()=>verifyScope(Object.keys(manifest.files).slice(1))));
test('old 257-count report rejected',()=>{const r=good();r.numTotalTests=r.numPassedTests=257;assert.throws(()=>verifyResults(r,process.cwd()));});
for(const path of Object.keys(manifest.files)) test('changed hash rejected: '+path,()=>assert.throws(()=>verifyFileHash(path,Buffer.from('unreviewed altered source'))));
test('adapter assertion substitution rejected',()=>{const r=good();const s=r.testResults.find(s=>s.name.endsWith('/unified-finance-data-adapters.test.ts'));s.assertionResults[0].fullName='substitute adapter check';assert.throws(()=>verifyResults(r,process.cwd()));});
test('adapter skipped assertion rejected',()=>{const r=good();const s=r.testResults.find(s=>s.name.endsWith('/unified-finance-data-adapters.test.ts'));s.assertionResults[0].status='pending';assert.throws(()=>verifyResults(r,process.cwd()));});
