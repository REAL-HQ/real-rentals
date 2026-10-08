/** Actual mail helper, with provider/DB/settings boundaries intercepted; no mail sent. */
import assert from 'node:assert/strict';
import {build} from 'esbuild';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const dir=mkdtempSync(join(tmpdir(),'rr-email-test-'));
const savedFetch=globalThis.fetch,savedKey=process.env.RESEND_API_KEY;
const stubs={
 '@/integrations/supabase/client.server':`const q={insert:()=>q,select:()=>q,single:async()=>({data:{id:'fixture-delivery'},error:null}),update:()=>q,eq:async()=>({error:null})};export const supabaseAdmin={from:()=>q,rpc:async()=>({error:null})};`,
 '@/lib/company.server':`export const getBusinessPhone=async()=>({tel:'tel:000',display:'Fixture phone'});`
};
try {
 await build({entryPoints:['src/lib/email.server.ts'],outfile:join(dir,'email.mjs'),bundle:true,platform:'node',format:'esm',alias:{'@':resolve('src')},logLevel:'silent',plugins:[{name:'boundaries',setup(b){b.onResolve({filter:/.*/},a=>stubs[a.path]?{path:a.path,namespace:'fixture'}:undefined);b.onLoad({filter:/.*/,namespace:'fixture'},a=>({contents:stubs[a.path],loader:'js'}));}}]});
 const email=await import(pathToFileURL(join(dir,'email.mjs')));process.env.RESEND_API_KEY='synthetic-not-a-secret';
 let calls=[];
 globalThis.fetch=async(url,options)=>{assert.equal(url,'https://api.resend.com/emails');calls.push(options);return new Response(JSON.stringify({id:'fixture-provider'}),{status:200});};
 const args={to:'owner@example.invalid',firstName:'Fixture',applicationId:crypto.randomUUID(),attemptId:crypto.randomUUID(),token:'a'.repeat(43)};
 assert.equal((await email.sendApplicationResumeEmail(args)).ok,true);
 assert.equal(calls[0].headers['Idempotency-Key'],`application-resume/${args.attemptId}`);
 const body=JSON.parse(calls[0].body);assert.deepEqual(body.to,[args.to]);assert.ok(body.html.includes(args.token));
 assert.equal(calls.length,1);console.log('PASS recovery sends reserved token/address with stable attempt idempotency key');
 for(const status of [400,429,500,503,409]) {
  globalThis.fetch=async()=>new Response('synthetic error',{status});
  const result=await email.sendApplicationResumeEmail(args);assert.equal(result.ok,false);assert.equal(result.uncertain,status>=500||status===409);
 }
 console.log('PASS explicit rejection and uncertain provider responses classified');
 globalThis.fetch=async()=>{throw Error('synthetic network failure')};assert.equal((await email.sendApplicationResumeEmail(args)).uncertain,true);
 console.log('PASS network exception preserves uncertainty');
 delete process.env.RESEND_API_KEY;globalThis.fetch=async()=>{throw Error('must not contact provider')};
 const missing=await email.sendApplicationResumeEmail(args);assert.equal(missing.ok,false);assert.equal(missing.uncertain,undefined);
 console.log('PASS missing secret fails without provider call');
} finally {globalThis.fetch=savedFetch;if(savedKey===undefined)delete process.env.RESEND_API_KEY;else process.env.RESEND_API_KEY=savedKey;rmSync(dir,{recursive:true,force:true});}
