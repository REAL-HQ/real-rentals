// Executes the real agreement handlers and role helpers with synthetic DB/RLS fixtures.
import { build } from 'esbuild';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const dir=mkdtempSync(path.join(tmpdir(),'agreement-auth-'));
const id='10000000-0000-4000-8000-000000000001';
const source=readFileSync('src/lib/agreements.functions.ts','utf8');
const auth=`export const requireSupabaseAuth={}; export function createServerFn(){return {middleware(){return this},inputValidator(){return this},handler(fn){return async arg=>{if(!arg.context?.userId)throw Error('Unauthenticated');return fn(arg)}}}}`;
const client=`export const supabaseAdmin={from(table){if(table!=='user_roles')globalThis.fixture.privileged++;const q={select(){return q},eq(){return q},order(){return q},in(){return q},then(resolve){return Promise.resolve({data:table==='user_roles'?(globalThis.fixture.role?[{role:globalThis.fixture.role}]:[]):[]}).then(resolve)},async maybeSingle(){return {data:{storage_bucket:'synthetic',storage_path:'fixture.pdf'}}}};return q},auth:{admin:{async getUserById(){return {data:{user:{email:null}}}}}},storage:{from(){return {async download(){globalThis.fixture.downloads++;return {data:new Blob(['%PDF-synthetic'])}}}}}};`;
const stubs={'@tanstack/react-start':auth,'@/integrations/supabase/auth-middleware':auth,'@/integrations/supabase/client.server':client,'@tanstack/react-start/server':'export function getRequest(){return {headers:new Headers()}}; export function getRequestHeader(){return undefined}'};
const ctx={userId:id,supabase:{from(){globalThis.fixture.reads++;return {select(){return this},eq(){return this},async maybeSingle(){return {data:globalThis.fixture.own?{id,status:'signed',document_id:id,archive_status:'archived'}:null}}}}}};
async function bundle(text,name){const outfile=path.join(dir,name+'.mjs');await build({stdin:{contents:text,resolveDir:process.cwd(),loader:'ts'},bundle:true,format:'esm',platform:'node',outfile,plugins:[{name:'synthetic',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'stub'}:a.path.startsWith('@/')?{path:path.resolve('src',a.path.slice(2)+'.ts')}:undefined);b.onLoad({filter:/.*/,namespace:'stub'},a=>({contents:stubs[a.path],loader:'ts'}));}}]});return import(pathToFileURL(outfile));}
let count=0;function reset(role,own=true){globalThis.fixture={role,own,reads:0,privileged:0,downloads:0}}
try {
 const m=await bundle(source,'protected');
 for(const role of ['admin','team']){reset(role);await m.listAgreements({context:ctx,data:{applicationId:id}});assert.equal(fixture.privileged,1);count++;reset(role);const pdf=await m.getAgreementPdf({context:ctx,data:{agreementId:id}});assert.equal(pdf.contentType,'application/pdf');assert.equal(fixture.downloads,1);count++;}
 for(const name of ['listAgreements','getAgreementPdf']){reset('coordinator');await assert.rejects(m[name]({context:ctx,data:{applicationId:id,agreementId:id}}),/Forbidden/);assert.equal(fixture.reads+fixture.privileged+fixture.downloads,0);count++;reset(null);await assert.rejects(m[name]({context:{},data:{applicationId:id,agreementId:id}}),/Unauthenticated/);count++;}
 reset(null);await m.getAgreementPdf({context:ctx,data:{agreementId:id}});assert.equal(fixture.downloads,1);count++;
 reset(null,false);await assert.rejects(m.getAgreementPdf({context:ctx,data:{agreementId:id}}),/not found/);assert.equal(fixture.privileged+fixture.downloads,0);count++;
 reset(null);await assert.rejects(m.listAgreements({context:ctx,data:{applicationId:id}}),/Forbidden/);count++;
 const mutant=await bundle(source.replace('if (await getActor(context.userId)) await requireManager(context.userId);',''),'mutant');reset('coordinator');await mutant.getAgreementPdf({context:ctx,data:{agreementId:id}});assert.equal(fixture.downloads,1);count++;
 console.log(`PASS ${count} synthetic handler assertions including guard-removal control; driver RLS is a fixture, not hosted verification.`);
} finally {rmSync(dir,{recursive:true,force:true});delete globalThis.fixture;}
