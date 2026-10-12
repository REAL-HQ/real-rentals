import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'rr-recovery-correction-'));
const S={sends:0,result:{ok:true,id:'synthetic-provider'},finish:null,reserveError:false,reserved:false};
globalThis.__recoveryFixture=S;
const stubs={
 '@/lib/email.server':`export async function sendApplicationResumeEmail(){const s=globalThis.__recoveryFixture;s.sends++;if(s.throwSend)throw Error('uncertain');return s.result;}`,
 '@/lib/resume-tokens.server':`export const newRawToken=()=> 'synthetic-only';export const hashResumeToken=async()=> 'a'.repeat(64);`
};
try {
 await build({entryPoints:['src/lib/application-recovery.server.ts'],outfile:join(dir,'test.mjs'),bundle:true,platform:'node',format:'esm',alias:{'@':resolve('src')},logLevel:'silent',plugins:[{name:'synthetic',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'mock'}:undefined);b.onLoad({filter:/.*/,namespace:'mock'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
 const {deliverApplicationRecovery:deliver}=await import(pathToFileURL(join(dir,'test.mjs')));
 const admin={async rpc(name,args){if(name==='reserve_application_recovery'){
  if(S.reserveError)return {error:{message:'missing dependency'}};
  if(S.reserved)return {data:{reserved:false,retry_after_seconds:120}};
  S.reserved=true;return {data:{reserved:true,retry_after_seconds:120,attempt_id:'10000000-0000-4000-8000-000000000001',email:'fixture@example.invalid',full_name:'Synthetic'}};
 } S.finished=args;if(S.finish==='throw')throw Error('connection lost');return {error:S.finish};}};
 let checks=0;const check=(name,fn)=>{fn();checks++;console.log('PASS '+name)};
 for(const mode of [null,'error','throw']){
  Object.assign(S,{reserved:false,finish:mode,sends:0,throwSend:false,result:{ok:true,id:'synthetic-provider'}});
  const r=await deliver(admin,'synthetic-application');
  check('accepted send finalization '+mode,()=>assert.equal(r.outcome,mode?'unknown':'sent'));
  check('provider ID preserved '+mode,()=>assert.equal(S.finished._provider_id,'synthetic-provider'));
  check('reservation survives '+mode,()=>assert.equal(S.reserved,true));
  const again=await deliver(admin,'synthetic-application');
  check('no duplicate provider send '+mode,()=>{assert.equal(again.outcome,'recent');assert.equal(S.sends,1)});
 }
 Object.assign(S,{reserved:false,finish:null,throwSend:true});
 check('unknown network outcome preserved',()=>{});
 assert.equal((await deliver(admin,'synthetic-application')).outcome,'unknown');assert.equal(S.finished._status,'unknown');
 Object.assign(S,{reserved:false,throwSend:false,result:{ok:false,uncertain:false}});
 assert.equal((await deliver(admin,'synthetic-application')).outcome,'failed');checks++;
 Object.assign(S,{reserveError:true,sends:0});await assert.rejects(()=>deliver(admin,'synthetic-application'));assert.equal(S.sends,0);checks++;
 console.log(`${checks} checks passed; no network or hosted writes`);
}finally{delete globalThis.__recoveryFixture;rmSync(dir,{recursive:true,force:true})}
