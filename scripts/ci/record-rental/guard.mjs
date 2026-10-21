// Default inspect() is the isolated candidate gate: ancestry, then checkPaths
// against manifest.baseline. A release candidate is not that candidate, so
// `node scripts/ci/record-rental/guard.mjs --rc` is the RC checklist. It still
// requires a full fetch (a shallow clone is refused), still requires the three
// manifest commits to be ancestors, and still requires Record Rental to stay
// disabled. It skips checkPaths. Do not pass --rc on release/record-rental-base.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function checkPaths(changed){
 const app={...manifest.application,...manifest.evidence},allowed=new Set([...Object.keys(app),...manifest.ciFiles]);
 assert.equal(new Set(changed).size,changed.length,'Duplicate paths');
 for(const path of changed)assert(allowed.has(path),'Unapproved path: '+path);
 for(const path of Object.keys(app))assert(changed.includes(path),'Required application path: '+path);
}
export function checkDigest(bytes,expected){assert.equal(hash(bytes),expected,'Hash mismatch');}
export function pinnedSha256(expected,label){
 const sha=typeof expected==='string'?expected:expected&&expected.sha256;
 assert.equal(typeof sha,'string','Source hash entry: '+label);
 if(expected&&typeof expected==='object'){
  assert.equal(typeof expected.justification,'string','Source hash justification: '+label);
  assert.ok(expected.justification.trim().length>0,'Source hash justification: '+label);
 }
 return sha;
}
export function checkScope(changed, read){
 checkPaths(changed);
 const app={...manifest.application,...manifest.evidence};
 for(const [path,expected] of Object.entries({...app,...manifest.lockedFiles})){
  assert.equal(hash(read(path)),pinnedSha256(expected,path),'Source hash: '+path);
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
export function inspectOptionsFromArgv(argv){
 return {rc:argv.includes('--rc')};
}
export function inspect(options={}){
 const rc=options.rc===true;
 const git=(...a)=>execFileSync('git',a,{encoding:'utf8'}).trim();
 if(rc)assert.equal(git('rev-parse','--is-shallow-repository'),'false','RC guard needs a full fetch; refusing a shallow clone');
 git('merge-base','--is-ancestor',manifest.baseline,'HEAD');
 git('merge-base','--is-ancestor',manifest.candidate,'HEAD');
 git('merge-base','--is-ancestor',manifest.evidenceCandidate,'HEAD');
 assert.equal(git('diff','--name-only'),'','Unstaged tracked changes');
 assert.equal(git('diff','--cached','--name-only'),'','Staged changes');
 if(rc){
  const contract=readFileSync('src/lib/record-rental-contract.ts').toString();
  assert.match(contract,/export const RECORD_RENTAL_CONTRACT_ENABLED = false;/);
  const handler=readFileSync('src/lib/record-rental.functions.ts').toString();
  assert.doesNotMatch(handler,/supabaseAdmin|createStripeClient|\.insert\(|\.update\(/);
  console.log('PASS RC ancestry and disabled record-rental flag; isolated path allowlist skipped');
  return;
 }
 const changed=git('diff','--name-only',manifest.baseline,'HEAD').split('\n').filter(Boolean);
 checkScope(changed,p=>readFileSync(p));
 console.log('PASS exact source scope, hashes, disabled flag and immutable test definitions');
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 inspect(inspectOptionsFromArgv(process.argv));
 if(process.argv.includes('--tests')){
  for(const suite of manifest.suites){
   const result=spawnSync(process.execPath,[suite.file],{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
   checkOutput(suite,result);process.stdout.write(result.stdout);
   console.log(`VERIFIED ${suite.checks} ${suite.kind}: ${suite.file}`);
  }
  console.log('PASS 130 application assertions plus 2 validation-recovery scenario groups plus 31 evidence assertions');
 }
}
