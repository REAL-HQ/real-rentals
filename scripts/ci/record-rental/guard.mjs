// Default inspect() is the isolated candidate gate: ancestry, then checkPaths
// against manifest.baseline. A release candidate is not that candidate, so
// `node scripts/ci/record-rental/guard.mjs --rc` is the RC checklist. It still
// requires a full fetch (a shallow clone is refused) and the three manifest
// commits to be ancestors. It skips checkPaths. It still hash-pins the Record
// Rental contract, handler, the other files that read that flag, the three
// contract importers, and the locked package.json and bun.lock. It rejects a
// true flag, a deleted handler check, a hidden `|| __on` gate, and handler
// writes. Do not pass --rc on release/record-rental-base.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const manifest=JSON.parse(readFileSync(new URL('./manifest.json',import.meta.url)));
const hash=b=>createHash('sha256').update(b).digest('hex');
export function checkPaths(changed){
 const app={...manifest.application,...manifest.evidence},allowed=new Set([...Object.keys(app),...manifest.ciFiles,...Object.keys(manifest.lockedFiles)]);
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
 assertRecordRentalDisabled(read);
}
export const RECORD_RENTAL_FLAG_FILES=[
 'src/lib/record-rental-contract.ts',
 'src/lib/record-rental.functions.ts',
 'src/lib/rentals.functions.ts',
 'src/components/admin/DriversPanel.tsx',
 'src/components/admin/RecordedRentalCloseout.tsx',
 'src/components/admin/RecordRentalDialog.tsx',
];
export function executableSource(source){
 return source.toString().replace(/\/\*[\s\S]*?\*\//g,'').split('\n').filter(line=>!/^\s*\/\//.test(line)).join('\n');
}
export function assertRecordRentalDisabled(read){
 const contract=executableSource(read('src/lib/record-rental-contract.ts'));
 assert.match(contract,/^export const RECORD_RENTAL_CONTRACT_ENABLED = false;$/m,'Record Rental flag must stay the hard false export');
 assert.doesNotMatch(contract,/RECORD_RENTAL_CONTRACT_ENABLED\s*=\s*true\b/,'Record Rental flag is true');
 const handler=executableSource(read('src/lib/record-rental.functions.ts'));
 assert.match(handler,/if\s*\(\s*!RECORD_RENTAL_CONTRACT_ENABLED\s*\)\s*throw new Error\('Record Rental is disabled pending contract installation and acceptance'\)/,'handler must keep the disabled-flag check');
 assert.doesNotMatch(handler,/supabaseAdmin|createStripeClient|\.(?:insert|update|upsert|rpc|delete)\s*\(/,'handler write');
 for(const path of RECORD_RENTAL_FLAG_FILES){
  const text=executableSource(read(path));
  assert.doesNotMatch(text,/\|\|\s*__on/,'hidden record-rental gate: '+path);
  assert.doesNotMatch(text,/RECORD_RENTAL_CONTRACT_ENABLED\s*=\s*true\b/,'Record Rental flag is true: '+path);
 }
}
export function checkRecordRentalPins(read){
 for(const path of RECORD_RENTAL_FLAG_FILES){
  assert.equal(hash(read(path)),pinnedSha256(manifest.application[path],path),'Source hash: '+path);
 }
}
export const RECORD_RENTAL_CONTRACT_IMPORTERS=[
 'src/lib/record-rental-operation.server.ts',
 'src/lib/record-rental-recovery.ts',
 'src/lib/record-rental-evidence.server.ts',
];
export function checkLockedFilePins(read){
 for(const [path,expected] of Object.entries(manifest.lockedFiles)){
  assert.equal(hash(read(path)),pinnedSha256(expected,path),'Locked hash: '+path);
 }
}
export function checkContractImporterPins(read){
 const pins={...manifest.application,...manifest.evidence};
 for(const path of RECORD_RENTAL_CONTRACT_IMPORTERS){
  assert.equal(hash(read(path)),pinnedSha256(pins[path],path),'Contract importer hash: '+path);
 }
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
  const read=p=>readFileSync(p);
  checkRecordRentalPins(read);
  checkLockedFilePins(read);
  checkContractImporterPins(read);
  assertRecordRentalDisabled(read);
  console.log('PASS RC ancestry, pinned record-rental sources, locked files, contract importers, and disabled flag; isolated path allowlist skipped');
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
  console.log('PASS 130 application assertions plus 1 validation-recovery scenario group plus 8 Record Rental dialog scenarios plus 31 evidence assertions');
 }
}
