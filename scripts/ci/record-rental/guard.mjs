import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function checkPaths(changed){
 const app=manifest.application,allowed=new Set([...Object.keys(app),...manifest.ciFiles]);
 assert.equal(new Set(changed).size,changed.length,'Duplicate paths');
 for(const path of changed)assert(allowed.has(path),'Unapproved path: '+path);
 for(const path of Object.keys(app))assert(changed.includes(path),'Required application path: '+path);
}
export function checkDigest(bytes,expected){assert.equal(hash(bytes),expected,'Hash mismatch');}
export function checkScope(changed, read){
 checkPaths(changed);
 const app=manifest.application;
 for(const [path,expected] of Object.entries({...app,...manifest.lockedFiles})){
  assert.equal(hash(read(path)),expected,'Source hash: '+path);
 }
 for(const path of Object.keys(app))assert(changed.includes(path),'Required application path: '+path);
 for(const suite of manifest.suites)assert.equal(hash(read(suite.file)),suite.sha256,'Test hash: '+suite.file);
 const contract=read('src/lib/record-rental-contract.ts').toString();
 assert.match(contract,/export const RECORD_RENTAL_CONTRACT_ENABLED = false;/);
 const handler=read('src/lib/record-rental.functions.ts').toString();
 assert.doesNotMatch(handler,/supabaseAdmin|createStripeClient|\.insert\(|\.update\(/);
}
export function checkOutput(suite,result){
 assert.equal(result.error,undefined,'Runner error');
 assert.equal(result.signal,null,'Runner signal');
 assert.equal(result.status,0,'Nonzero test exit');
 if(suite.stderrKind==='identity-esbuild-progress' && result.stderr.trim()) {
  assert.match(result.stderr.trim(),/^\.identity-build\/docs\.mjs\s+\d+(?:\.\d+)?[km]b\s*\n\s*⚡ Done in \d+ms\s*\n\s*\.identity-build\/apps\.mjs\s+\d+(?:\.\d+)?[km]b(?: ⚠️)?\s*\n\s*⚡ Done in \d+ms$/,'Unexpected bundler output');
 } else assert.equal(result.stderr.trim(),'','Unexpected test stderr');
 assert.equal(result.stdout.replace(/\r\n/g,'\n').trim(),suite.stdout,'Missing, changed, skipped or substituted assertion output');
}
export function inspect(){
 const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
 git('merge-base','--is-ancestor',manifest.baseline,'HEAD');
 git('merge-base','--is-ancestor',manifest.candidate,'HEAD');
 const changed=git('diff','--name-only',manifest.baseline,'HEAD').split('\n').filter(Boolean);
 checkScope(changed,p=>readFileSync(p));
 assert.equal(git('diff','--name-only'),'','Unstaged tracked changes');
 assert.equal(git('diff','--cached','--name-only'),'','Staged changes');
 console.log('PASS exact source scope, hashes, disabled flag and immutable test definitions');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 inspect();
 if(process.argv.includes('--tests')){
  for(const suite of manifest.suites){
   const result=spawnSync(process.execPath,[suite.file],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
   checkOutput(suite,result);process.stdout.write(result.stdout);
   console.log(`VERIFIED ${suite.checks} ${suite.kind}: ${suite.file}`);
  }
  console.log('PASS 126 application assertions plus 2 validation-recovery scenario groups');
 }
}
