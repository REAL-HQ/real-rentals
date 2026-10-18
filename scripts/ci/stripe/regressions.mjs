import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
import { pathToFileURL } from 'node:url';
const coverage=JSON.parse(fs.readFileSync(new URL('./regression-coverage.json',import.meta.url),'utf8'));
export function requiredTest(name,cwd){
 const file=path.join(cwd,`scripts/${name}.test.mjs`);
 assert.ok(fs.statSync(file).isFile() && fs.statSync(file).size>0,'missing or empty required test: '+name);
 return file;
}
function inspect(name,result){
 assert.ifError(result.error);assert.equal(result.signal,null,name+' signalled');
 assert.ok([0,1].includes(result.status),name+' unexpected exit');
 const text=result.stdout+'\n'+result.stderr;
 assert.ok(!/(?:MODULE_NOT_FOUND|SyntaxError|TypeError|ReferenceError|ERR_MODULE|ENOENT|(?:^|\n)\s*Error:)/.test(text),name+' parser/module/tool failure');
 assert.ok(!/(?:^|\n)\s*(?:SKIP|SKIPPED|TODO|NOT RUN|NOT AVAILABLE)\b/i.test(text),name+' unexpected skip');
 const rows=result.stdout.split(/\r?\n/).map(s=>s.match(/^\s+(PASS|BLOCKER|FAIL|ok)\s+(.+)$/)).filter(Boolean).map(m=>({status:m[1],label:m[2]}));
 // Only the two documented grep path spellings may differ across OSes.
 const labels=rows.map(({label})=>name==='bookings-actions' && ['exactly one module in src/ CALLS end_rental_tx (src//lib/rentals.functions.ts)','and exactly one calls activate_rental_tx (src//lib/rentals.functions.ts)'].includes(label) ? label.replace('src//lib/','src/lib/') : label);
 assert.ok(Array.isArray(coverage[name]) && coverage[name].length>0,name+' missing coverage inventory');
 assert.deepEqual(labels,coverage[name],name+' mandatory assertion coverage');
 return {rows,failures:result.stdout.split(/\r?\n/).filter(s=>s.includes('BLOCKER')||s.includes('FAIL'))};
}
export function verifyPair(name,current,previous,knownFailures){
 const a=inspect(name,current),b=inspect(name,previous);
 if(current.status===0 && previous.status===0){
  for(const result of [a,b]){
   assert.deepEqual(result.failures,[],name+' failure in successful output');
   assert.ok(result.rows.every(r=>['PASS','ok'].includes(r.status)),name+' incomplete success');
  }
  return 'PASS paired regression: '+name+'; all mandatory assertions passed on baseline and candidate';
 }
 assert.equal(current.status,1,name+' asymmetric baseline/candidate outcome');
 assert.equal(previous.status,1,name+' candidate-only failure');
 for(const result of [a,b])assert.deepEqual(result.failures,knownFailures,name+' exact known failure signatures');
 assert.deepEqual(a.rows,b.rows,name+' equivalent assertion outcomes');
 return 'KNOWN BASELINE FAILURE (not PASS): '+name+'; exact assertions match baseline';
}
export function main(){
execFileSync(process.execPath,['--test',path.join(process.cwd(),'scripts/ci/stripe/regressions.test.mjs')],{stdio:'inherit'});
const root=process.cwd();
const base='ce8f7969e1656b455bd8ffce93e0da00a8d114c1';
const allowedSource=new Set(["src/components/admin/StripeCollections.tsx", "src/lib/stripe-collections.ts", "src/lib/stripe-collections.server.ts", "src/lib/stripe-collections.functions.ts", "scripts/stripe-collections.test.ts", "scripts/stripe-collections-server.test.ts", "scripts/stripe-collections-auth.test.ts", "scripts/stripe-collections.vitest.config.ts", "src/components/admin/OverviewPanel.tsx", "src/routes/admin.tsx"]);
for(const changed of execFileSync('git',['diff','--name-only',base,'--','src','scripts'],{encoding:'utf8'}).trim().split('\n').filter(Boolean)) assert.ok(allowedSource.has(changed)||changed.startsWith('scripts/ci/'),'unreviewed source drift invalidates baseline exceptions: '+changed);
const expected={
  "admin-reads-access": [
    "  BLOCKER    drivers-list.ts is untouched",
    "  BLOCKER    documents.functions.ts is untouched",
    "  BLOCKER    applications.functions.ts is untouched",
    "  BLOCKER    agreements.functions.ts is untouched",
    "  BLOCKER    readiness.ts is untouched",
    "5 BLOCKER(S)"
  ],
  "driver-access": [
    "  FAIL a pre-existing account with no application of its own is not adopted",
    "FAIL \u2014 1 assertion(s)"
  ],
  "bookings-actions": [
    "  BLOCKER  exactly one module in src/ CALLS end_rental_tx (src//lib/rentals.functions.ts)",
    "  BLOCKER  and exactly one calls activate_rental_tx (src//lib/rentals.functions.ts)"
  ]
};
const logs=path.join(root,'.stripe-ci-logs');fs.mkdirSync(logs,{recursive:true});
function run(name,cwd,env={}){
 const file=requiredTest(name,cwd);
 const result=spawnSync(process.execPath,[file],{cwd,env:{...process.env,...env},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
 assert.ifError(result.error);assert.equal(result.signal,null);
 fs.writeFileSync(path.join(logs,`${cwd===root?'candidate':'baseline'}-${name}.log`),result.stdout+result.stderr);
 return result;
}
for(const name of ['grants','agreement-pdf-access','vehicle-doc-permissions','client-chunks']){
 const r=run(name,root);assert.equal(r.status,0,name);
 const excluded = name==='grants' ? '  SKIP  no SUPABASE_DB_URL in the environment.' : null;
 const lines=r.stdout.split(/\r?\n/);
 for(const line of lines) if(/^\s*(?:SKIP|SKIPPED|BLOCKER|FAIL)\b/.test(line)) assert.equal(line,excluded,name+' unexpected missing/failed assertions');
 if(name==='grants') {
  assert.ok(lines.includes(excluded));
  assert.equal(lines.filter(s=>/^\s*PASS\b/.test(s)).length,8);
  console.log('NOT RUN: hosted grant inspection (deliberately excluded; static eight assertions only)');
 }
 console.log('PASS affected-area regression: '+name);
}
// Paired execution preserves known failures without count-only exemptions.
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'stripe-baseline-'));
const archive=path.join(temp,'source.tar');const snapshot=path.join(temp,'source');fs.mkdirSync(snapshot);
execFileSync('git',['archive','--format=tar',`--output=${archive}`,base]);
execFileSync('tar',['-xf',archive,'-C',snapshot]);
fs.symlinkSync(path.join(root,'node_modules'),path.join(snapshot,'node_modules'),'dir');
const gitdir=execFileSync('git',['rev-parse','--absolute-git-dir'],{encoding:'utf8'}).trim();
for(const [name,failures] of Object.entries(expected)){
 const file=`scripts/${name}.test.mjs`;
 assert.deepEqual(fs.readFileSync(file),execFileSync('git',['show',`${base}:${file}`]),'baseline exception requires unchanged test');
 const current=run(name,root);const previous=run(name,snapshot,{GIT_DIR:gitdir,GIT_WORK_TREE:snapshot});
 console.log(verifyPair(name,current,previous,failures));
}
console.log('Paired regression coverage verified; known baseline failures remain explicit; hosted/browser coverage excluded.');

}
if(process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url) main();
