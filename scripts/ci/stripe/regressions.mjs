import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync,spawnSync} from 'node:child_process';
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
 const file=`scripts/${name}.test.mjs`;assert.ok(fs.statSync(path.join(cwd,file)).size>0);
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
 for(const r of [current,previous]){
  assert.equal(r.status,1,name+' must reproduce known failure, not parser/tool failure');
  assert.deepEqual(r.stdout.split(/\r?\n/).filter(s=>s.includes('BLOCKER')||s.includes('FAIL')),failures,name+' exact known assertions');
  assert.ok(!/(?:SKIPPED|MODULE_NOT_FOUND|SyntaxError|TypeError)/.test(r.stdout+r.stderr));
 }
 // Equal full assertion output prevents a missing pass from being masked.
 const assertions=s=>s.split(/\r?\n/).filter(s=>/^\s*(?:PASS|BLOCKER|FAIL|ok)\b/.test(s));
 assert.deepEqual(assertions(current.stdout),assertions(previous.stdout),name+' baseline parity');
 console.log('KNOWN BASELINE FAILURE (not PASS): '+name+'; exact assertions match baseline');
}
console.log('No additional failures in the three baseline-failing suites; hosted/browser coverage excluded.');
