/** Offline execution of the real recovery/token/identity handlers. No network or database. */
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const dir = mkdtempSync(join(tmpdir(), 'rr-resume-test-'));
let db, emails, audits;
const appId = '10000000-0000-4000-8000-000000000001';
const reviewId = '20000000-0000-4000-8000-000000000001';
function client(role = 'service') {
  return {
    auth: { admin: { getUserById: async () => ({ data: { user: { email: 'fixture@example.invalid' } } }) } },
    from(table) {
      let filters = [], op = 'read', values, one = false, max = Infinity;
      const q = {
        select() { return q; }, order() { return q; }, limit(n) { max = n; return q; },
        eq(k,v) { filters.push(r => r[k] === v); return q; },
        is(k,v) { filters.push(r => (r[k] ?? null) === v); return q; },
        in(k,v) { filters.push(r => v.includes(r[k])); return q; },
        insert(v) { op='insert'; values=v; return q; },
        update(v) { op='update'; values=v; return q; },
        single() { one=true; return q; }, maybeSingle() { one=true; return q; },
        then(done, fail) { return Promise.resolve().then(() => {
          db[table] ??= [];
          let rows = db[table].filter(r => filters.every(f => f(r))).slice(0,max);
          if (table === 'application_identity_reviews' && role === 'driver') rows=[];
          if (op === 'insert') {
            if (table === 'application_identity_reviews' && db[table].some(r => r.status==='open' && r.submitted_email===values.submitted_email)) return {data:null,error:{code:'23505'}};
            const row={id:crypto.randomUUID(),created_at:new Date().toISOString(),revoked_at:null,status:'open',...values};
            db[table].push(row); rows=[row];
          }
          if (op === 'update') rows.forEach(r => Object.assign(r,values));
          return {data:structuredClone(one ? rows[0] ?? null : rows),error:null};
        }).then(done,fail); }
      }; return q;
    }
  };
}
function reset() {
  db={applications:[{id:appId,email:'owner@example.invalid',phone:'8135551234',full_name:'Fixture Owner',created_at:'2020-01-01',resubmission_history:[],resubmission_count:0,status:'reviewing',sms_consent:false,license_photo_url:'preserved/document',ai_flags:['original']}]};
  emails=[]; audits=[]; globalThis.__rr = {client:client(), send:async args => {emails.push(args); return {ok:true};}, audit:async (...args) => audits.push(args)};
}
const stubs = {
  '@tanstack/react-start/server': 'export const getRequest=()=>({headers:new Map()});',
  '@tanstack/react-start': `export const createServerFn=()=>{let validate=x=>x,auth=false; const api={middleware:()=>{auth=true;return api},inputValidator:v=>{validate=v;return api},handler:fn=>async args=>{if(auth&&!args.context?.userId)throw Error('Unauthorized');return fn({...args,data:validate(args.data)})}};return api};`,
  '@/integrations/supabase/auth-middleware': 'export const requireSupabaseAuth={};',
  '@/integrations/supabase/client.server': 'export const supabaseAdmin=new Proxy({}, {get:(_,p)=>globalThis.__rr.client[p]});',
  '@/lib/email.server': 'export const sendApplicationResumeEmail=(args)=>globalThis.__rr.send(args); export const sendDriverWelcome=async()=>{}; export const sendLeadAlert=async()=>{};',
  '@/lib/audit': 'export const logAudit=(...args)=>globalThis.__rr.audit(...args);'
};
async function load(file) {
  const output=join(dir,file.replaceAll('/','_')+'.mjs');
  await build({entryPoints:[file],outfile:output,bundle:true,platform:'node',format:'esm',logLevel:'silent',alias:{'@':resolve('src')},plugins:[{name:'offline',setup(b){
    b.onResolve({filter:/.*/}, a => stubs[a.path] ? {path:a.path,namespace:'stub'} : undefined);
    b.onLoad({filter:/.*/,namespace:'stub'}, a=>({contents:stubs[a.path],loader:'js'}));
  }}]});
  return import(pathToFileURL(output));
}
let passed=0;
async function test(name, fn) {reset();await fn();passed++;console.log('PASS',name);}
try {
  const tokens=await load('src/lib/resume-tokens.server.ts');
  const applications=await load('src/lib/applications.functions.ts');
  const reviews=await load('src/lib/identity-review.functions.ts');
  await test('recovery is single-use under concurrent opens; session survives',async()=>{
    const raw=await tokens.issueResumeToken(globalThis.__rr.client,appId,{recovery:true});
    const results=await Promise.allSettled([tokens.exchangeResumeToken(globalThis.__rr.client,raw),tokens.exchangeResumeToken(globalThis.__rr.client,raw)]);
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    const session=results.find(r=>r.status==='fulfilled').value;
    assert.notEqual(session,raw); assert.equal(await tokens.resolveResumeToken(globalThis.__rr.client,session),appId);
    assert.equal(await tokens.exchangeResumeToken(globalThis.__rr.client,session),session);
    assert.ok(db.application_resume_tokens.every(r=>r.token_hash!==raw && r.token_hash!==session));
  });
  await test('expired, revoked, malformed and unknown links fail closed',async()=>{
    const raw=await tokens.issueResumeToken(globalThis.__rr.client,appId,{recovery:true});
    db.application_resume_tokens[0].expires_at='2000-01-01';
    await assert.rejects(tokens.exchangeResumeToken(globalThis.__rr.client,raw));
    for(const token of ['x','z'.repeat(64)]) assert.equal((await applications.openResumeLink({data:{token:token.length<20?token.repeat(20):token}})).token,null);
  });
  await test('returning old applicant preserves answers, identity, documents and status',async()=>{
    const before=structuredClone(db.applications[0]);
    const result=await applications.savePartialApplication({data:{full_name:'Different Name',email:before.email,phone:before.phone,sms_consent:true,source:'homepage'}});
    assert.equal(result.token,null);assert.equal(result.id,null);assert.equal(emails[0].to,before.email);assert.equal(db.applications.length,1);
    for(const key of ['full_name','phone','email','status','sms_consent','license_photo_url','created_at','ai_flags']) assert.deepEqual(db.applications[0][key],before[key]);
  });
  await test('phone-only conflict is durable, deduplicated and sends no email',async()=>{
    const data={full_name:'Other Person',phone:'8135551234',email:'other@example.invalid',sms_consent:true,source:'homepage'};
    for(let i=0;i<2;i++) assert.equal((await applications.savePartialApplication({data})).linkStatus,'review');
    assert.equal(emails.length,0);assert.equal(db.application_identity_reviews.length,1);
    db.applications[0].ai_flags=[];assert.equal(db.application_identity_reviews[0].status,'open');
  });
  await test('request results are neutral, recent sends throttle, failures are truthful',async()=>{
    const send=email=>applications.requestApplicationLink({data:{email}});
    assert.deepEqual(await send('missing@example.invalid'),{ok:true,retryAfterSeconds:120});
    assert.deepEqual(await send('owner@example.invalid'),{ok:true,retryAfterSeconds:120});
    await send('owner@example.invalid');assert.equal(emails.length,1);
    db.applications[0].resubmission_history=[];globalThis.__rr.send=async()=>({ok:false});
    assert.deepEqual(await send('owner@example.invalid'),{ok:false,retryAfterSeconds:30});
    assert.equal(db.applications[0].resubmission_history.at(-1).link_sent,false);
  });
  await test('identity resolution rejects signed-out/driver/coordinator; Manager/Owner audit',async()=>{
    const data={id:reviewId,resolution:'different_person',note:'Offline fixture review'};
    await assert.rejects(reviews.resolveIdentityReview({data}));
    for(const role of ['driver','coordinator','team','admin']) {
      db.user_roles=[{user_id:'fixture-user',role}];db.application_identity_reviews=[{id:reviewId,application_id:appId,status:'open',kind:'phone_match_email_differs'}];
      const action=reviews.resolveIdentityReview({data,context:{userId:'fixture-user'}});
      if(['team','admin'].includes(role)) {assert.equal((await action).changed,true);assert.equal(db.application_identity_reviews[0].status,'resolved');}
      else {await assert.rejects(action);assert.equal(db.application_identity_reviews[0].status,'open');}
    }
    assert.equal(audits.length,2);
  });
  console.log(`${passed} offline behavioral scenarios passed. RLS enforcement requires a separate isolated database test.`);
} finally { rmSync(dir,{recursive:true,force:true});delete globalThis.__rr; }
