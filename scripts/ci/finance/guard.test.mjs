import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { verifyResults, verifyScope } from './guard.mjs';
const coverage=JSON.parse(readFileSync(new URL('./test-coverage.json',import.meta.url)));
const manifest=JSON.parse(readFileSync(new URL('./source-manifest.json',import.meta.url)));
function good(){return {success:true,numTotalTests:257,numPassedTests:257,numFailedTests:0,numPendingTests:0,numTodoTests:0,numFailedTestSuites:0,numPendingTestSuites:0,testResults:Object.entries(coverage).map(([p,names])=>({name:resolve(p),status:'passed',message:'',assertionResults:names.map(fullName=>({fullName,status:'passed',failureMessages:[]}))}))};}
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
