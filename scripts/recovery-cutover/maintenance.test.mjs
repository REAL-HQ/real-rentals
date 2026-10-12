import {build} from 'esbuild';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
const dir=mkdtempSync('/private/tmp/rr-maintenance-test-'),src=path.resolve('src');
const stubs={
 '@tanstack/react-start':`export function createServerFn(){return {middleware(){return this},inputValidator(){return this},handler(f){return f}}}`,
 '@/integrations/supabase/auth-middleware':'export const requireSupabaseAuth={}',
 '@/lib/roles.server':`export async function requireManager(){if(globalThis.fx.role!=='manager')throw Error('Forbidden')} export const requireStaff=requireManager; export const requireOwner=requireManager; export const requireTier=requireManager; export async function getActor(){return {tier:globalThis.fx.role}}`,
 '@/integrations/supabase/client.server':`export const supabaseAdmin={from(table){if(table!=='app_settings'){globalThis.fx.domain++;throw Error('OPEN_BOUNDARY')}return {select(){return this},eq(){return this},async maybeSingle(){if(globalThis.fx.mode==='throw')throw Error('offline');return {data:globalThis.fx.mode==='missing'?null:{value:globalThis.fx.mode==='malformed'?null:{mode:globalThis.fx.mode}},error:globalThis.fx.mode==='error'?{}:null}}}},rpc(){globalThis.fx.domain++;throw Error('OPEN_BOUNDARY')}}`,
 '@tanstack/react-start/server':'export function getRequest(){return {headers:new Headers()}} export function getRequestHeader(){return undefined}',
};
let count=0;
try {
 for(const [file,names] of [['applications.functions.ts',['savePartialApplication','requestApplicationLink']],['waitlist.functions.ts',['promoteToApplicant']]]){
 const out=dir+'/'+file+'.mjs';
 await build({entryPoints:[src+'/lib/'+file],bundle:true,format:'esm',platform:'node',outfile:out,plugins:[{name:'synthetic',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'fixture'}:a.path.startsWith('@/')?{path:src+'/'+a.path.slice(2)+'.ts'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'ts'}));}}]});
 const m=await import(pathToFileURL(out));
 for(const name of names){
 for(const mode of ['paused','missing','malformed','error','throw']){
 globalThis.fx={mode,domain:0,role:'manager'};
 const result=await m[name]({data:{email:'synthetic@example.invalid',phone:'5555555555',entryId:'synthetic'},context:{userId:'synthetic'}});
 assert.equal(result.maintenance,true);assert.equal(globalThis.fx.domain,0);count++;
 }
 globalThis.fx={mode:'open',domain:0,role:'manager'};
 await assert.rejects(m[name]({data:{email:'synthetic@example.invalid',phone:'5555555555',entryId:'synthetic'},context:{userId:'synthetic'}}),/OPEN_BOUNDARY/);assert.equal(globalThis.fx.domain,1);count++;
 // Re-activation affects the very next request: there is no cached open state.
 globalThis.fx.mode='paused';globalThis.fx.domain=0;
 assert.equal((await m[name]({data:{},context:{userId:'synthetic'}})).maintenance,true);assert.equal(globalThis.fx.domain,0);count++;
 }
 }
 for(const file of ['src/routes/apply.tsx','src/components/site/CityHeroLeadForm.tsx']){
 const s=readFileSync(file,'utf8');assert.ok(s.indexOf('"maintenance" in data')<s.indexOf('if (!data.token)'));count++;
 }
 console.log(`PASS ${count} maintenance boundary/restoration checks (real handlers; synthetic dependencies)`);
} finally {rmSync(dir,{recursive:true,force:true});}
