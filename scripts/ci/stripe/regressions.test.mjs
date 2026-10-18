import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {verifyPair,requiredTest} from './regressions.mjs';
const coverage=JSON.parse(fs.readFileSync(new URL('./regression-coverage.json',import.meta.url),'utf8'));
const passed=(name)=>({status:0,signal:null,error:undefined,stderr:'',stdout:coverage[name].map(s=>'  PASS '+s).join('\n')+'\n'});
const name='bookings-actions';
const known=['  BLOCKER  exactly one module in src/ CALLS end_rental_tx (src//lib/rentals.functions.ts)','  BLOCKER  and exactly one calls activate_rental_tx (src//lib/rentals.functions.ts)'];
const failed=()=>{const r=passed(name);r.status=1;for(const line of known){const label=line.replace(/^\s*BLOCKER\s+/,'').replace('src//lib/','src/lib/');r.stdout=r.stdout.replace('  PASS '+label,line);}return r;};
for(const n of Object.keys(coverage))test('accept paired complete success: '+n,()=>assert.match(verifyPair(n,passed(n),passed(n),[]),/^PASS paired/));
test('retain exact known failure as non-PASS',()=>assert.match(verifyPair(name,failed(),failed(),known),/^KNOWN BASELINE FAILURE \(not PASS\)/));
test('account-adoption failure stays explicit',()=>{
 const n='driver-access',label='a pre-existing account with no application of its own is not adopted';const r=passed(n);r.status=1;r.stdout=r.stdout.replace('  PASS '+label,'  FAIL '+label)+'FAIL — 1 assertion(s)\n';
 assert.match(verifyPair(n,r,r,['  FAIL '+label,'FAIL — 1 assertion(s)']),/^KNOWN BASELINE FAILURE \(not PASS\): driver-access/);
});
test('reject candidate-only failure',()=>assert.throws(()=>verifyPair(name,failed(),passed(name),known),/candidate-only failure/));
test('reject asymmetric baseline failure',()=>assert.throws(()=>verifyPair(name,passed(name),failed(),known),/asymmetric/));
test('reject reduced candidate coverage',()=>{const r=passed(name);r.stdout=r.stdout.split('\n').slice(1).join('\n');assert.throws(()=>verifyPair(name,r,passed(name),known),/mandatory assertion coverage/);});
test('reject both silently omitting same assertion',()=>{const r=passed(name);r.stdout=r.stdout.split('\n').slice(1).join('\n');assert.throws(()=>verifyPair(name,r,r,known),/mandatory assertion coverage/);});
test('reject no assertions and exit zero',()=>{const r={...passed(name),stdout:''};assert.throws(()=>verifyPair(name,r,r,known),/mandatory assertion coverage/);});
test('reject unexpected skipped checks',()=>{const r=passed(name);r.stdout+='SKIP missing dependency\n';assert.throws(()=>verifyPair(name,r,passed(name),known),/unexpected skip/);});
test('reject changed known failure signature',()=>{const r=failed();r.stdout=r.stdout.replace('  BLOCKER  exactly','  FAIL  exactly');assert.throws(()=>verifyPair(name,r,failed(),known),/exact known failure signatures/);});
test('reject parser failure',()=>{const r={...passed(name),stderr:'SyntaxError: unexpected token'};assert.throws(()=>verifyPair(name,r,passed(name),known),/parser\/module\/tool/);});
test('reject module failure',()=>{const r={...passed(name),stderr:'ERR_MODULE_NOT_FOUND'};assert.throws(()=>verifyPair(name,r,passed(name),known),/parser\/module\/tool/);});
test('reject unexpected exit status',()=>{const r={...passed(name),status:2};assert.throws(()=>verifyPair(name,r,passed(name),known),/unexpected exit/);});
test('reject timeout signal',()=>{const r={...passed(name),signal:'SIGTERM'};assert.throws(()=>verifyPair(name,r,passed(name),known),/signalled/);});
test('reject failure text with zero exit',()=>{const r={...failed(),status:0};assert.throws(()=>verifyPair(name,r,r,known),/failure in successful output/);});
test('reject missing/empty required test file',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'stripe-test-presence-'));
 try{assert.throws(()=>requiredTest(name,dir),/ENOENT/);fs.mkdirSync(path.join(dir,'scripts'));fs.writeFileSync(path.join(dir,`scripts/${name}.test.mjs`),'');assert.throws(()=>requiredTest(name,dir),/missing or empty/);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('reject generic tooling failure alongside known failures',()=>{const r={...failed(),stderr:'Error: test tool failed'};assert.throws(()=>verifyPair(name,r,failed(),known),/parser\/module\/tool/);});
