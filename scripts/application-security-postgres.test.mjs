/** Real PostgreSQL tests against a disposable synthetic database ONLY.
 * Requires a locally started PostgreSQL on this fixed Unix socket. Never reads production env.
 */
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {build} from 'esbuild';
import {resolve as pathResolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import postgres from 'postgres';
const options={host:'/private/tmp/rr-pg-socket',port:55439,username:process.env.USER,database:'postgres',max:20};
const root=postgres(options);
const name='rr_security_fixture';
await root.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
await root.unsafe(`CREATE DATABASE ${name}`);
const sql=postgres({...options,database:name});
let passed=0;
const buildDir=mkdtempSync(join(tmpdir(),'rr-pg-handler-'));
await build({entryPoints:['src/lib/application-recovery.server.ts'],outfile:join(buildDir,'recovery.mjs'),bundle:true,platform:'node',format:'esm',alias:{'@':pathResolve('src')},logLevel:'silent',plugins:[{name:'mail-boundary',setup(b){b.onResolve({filter:/^@\/lib\/email.server$/},()=>({path:'email',namespace:'fixture'}));b.onLoad({filter:/.*/,namespace:'fixture'},()=>({contents:'export const sendApplicationResumeEmail=(a)=>globalThis.__rrPgSend(a);',loader:'js'}));}}]});
const {deliverApplicationRecovery}=await import(pathToFileURL(join(buildDir,'recovery.mjs')));
const app='10000000-0000-4000-8000-000000000001', actor='30000000-0000-4000-8000-000000000001',review='20000000-0000-4000-8000-000000000001';
const roleCall=(role,fn)=>sql.begin(async tx=>{await tx.unsafe(`SET LOCAL ROLE ${role}`);await tx`SELECT set_config('request.jwt.claim.role',${role},true),set_config('request.jwt.claim.sub',${actor},true)`;return fn(tx);});
const reserve=()=>roleCall('service_role',tx=>tx`SELECT public.reserve_application_recovery(${app},${crypto.randomUUID().replaceAll('-','').repeat(2)}) AS result`.then(r=>r[0].result));
const resolve=()=>roleCall('authenticated',tx=>tx`SELECT public.resolve_application_identity_review(${review},'same_person','Synthetic fixture') AS result`.then(r=>r[0].result));
async function test(label,fn){await sql`TRUNCATE public.application_recovery_attempts,public.application_resume_tokens,public.application_identity_reviews,public.audit_log`;await sql`UPDATE public.user_roles SET role='team'`;await fn();console.log('PASS',label);passed++;}
try {
  for(const role of ['anon','authenticated','service_role']) if(!(await root`SELECT 1 FROM pg_roles WHERE rolname=${role}`).length) await root.unsafe(`CREATE ROLE ${role} NOLOGIN`);
  await sql.unsafe(`CREATE SCHEMA auth;CREATE SCHEMA private;
    GRANT USAGE ON SCHEMA auth,private,public TO anon,authenticated,service_role;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$ SELECT current_setting('request.jwt.claim.role',true) $$;
    CREATE TABLE auth.users(id uuid PRIMARY KEY,email text);
    CREATE TABLE public.user_roles(user_id uuid,role text);
    CREATE TABLE public.applications(id uuid PRIMARY KEY,email text,full_name text,deleted_at timestamptz,purged_at timestamptz,resubmission_history jsonb DEFAULT '[]',answers jsonb DEFAULT '{"preserved":true}');
    CREATE TABLE public.application_resume_tokens(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),application_id uuid REFERENCES public.applications(id),token_hash text UNIQUE NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL,revoked_at timestamptz);
    CREATE TABLE public.audit_log(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id uuid REFERENCES auth.users(id),actor_email text,actor_role text,action text NOT NULL,entity_type text,entity_id text,summary text NOT NULL,metadata jsonb NOT NULL DEFAULT '{}',created_at timestamptz DEFAULT now());
    CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('team','admin')) $$;
    CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=auth.uid() AND role IN ('team','admin','coordinator')) $$;`);
  await sql`INSERT INTO public.applications(id,email,full_name) VALUES (${app},'owner@example.invalid','Fixture Owner')`;
  await sql`INSERT INTO auth.users VALUES (${actor},'manager@example.invalid')`;
  await sql`INSERT INTO public.user_roles VALUES (${actor},'team')`;
  await sql`UPDATE applications SET resubmission_history=${sql.json([{link_sent:true,at:new Date().toISOString()},{link_sent:true,at:'bad date'},{link_sent:true,at:'2020-01-01'},{link_sent:false,at:new Date().toISOString()}])}::jsonb`;
  for(const file of ['0019_identity_reviews.sql','0020_identity_reviews_lockdown.sql','0021_application_resume_atomic_security.sql']) {
    // Resolve exact existing migration names without changing any existing file.
    const {readdirSync}=await import('node:fs');const actual=readdirSync('drizzle/migrations').find(n=>n.startsWith(file.slice(0,5))&&n.endsWith('.sql'));
    await sql.unsafe(readFileSync('drizzle/migrations/'+actual,'utf8'));
  }
  assert.equal((await reserve()).reserved,false);
  assert.equal((await sql`SELECT * FROM application_recovery_attempts`).length,1);
  console.log('PASS migration retains historical cooldown and ignores malformed/stale metadata');passed++;
  await test('40 concurrent independent connections reserve exactly one token/send slot',async()=>{
    const rows=await Promise.all(Array.from({length:40},reserve));assert.equal(rows.filter(x=>x.reserved).length,1);
    assert.equal((await sql`SELECT * FROM application_resume_tokens`).length,1);assert.equal((await sql`SELECT * FROM application_recovery_attempts`).length,1);
    assert.equal(rows.find(x=>x.reserved).email,'owner@example.invalid');
  });
  await test('real server helper sends once across 40 database-backed concurrent calls; missing RPC fails closed',async()=>{
    let sends=[];globalThis.__rrPgSend=async args=>{sends.push(args);return {ok:true,id:'synthetic-provider-id'};};
    const admin={rpc:async(name,args)=>{try {
      const rows=await roleCall('service_role',tx=> name==='reserve_application_recovery'
        ? tx`SELECT reserve_application_recovery(${args._application_id},${args._token_hash}) AS result`
        : tx`SELECT finish_application_recovery(${args._attempt_id},${args._status},${args._provider_id}) AS result`);
      return {data:rows[0].result,error:null};
    } catch(error) {return {data:null,error};}}};
    const results=await Promise.all(Array.from({length:40},()=>deliverApplicationRecovery(admin,app)));
    assert.equal(sends.length,1);assert.equal(results.filter(r=>r.outcome==='sent').length,1);
    assert.equal(sends[0].to,'owner@example.invalid');assert.match(sends[0].token,/^[A-Za-z0-9_-]{43}$/);
    assert.equal((await sql`SELECT status FROM application_recovery_attempts`)[0].status,'sent');
    await assert.rejects(deliverApplicationRecovery({rpc:async()=>({data:null,error:{message:'missing RPC'}})},app));assert.equal(sends.length,1);
  });
  await test('cooldown, six-per-day ceiling, and expiry of window',async()=>{
    for(let i=0;i<6;i++){assert.equal((await reserve()).reserved,true);assert.equal((await reserve()).reserved,false);await sql`UPDATE application_recovery_attempts SET created_at=created_at-interval '121 seconds'`;}
    assert.equal((await reserve()).reserved,false);
    await sql`UPDATE application_recovery_attempts SET created_at=created_at-interval '24 hours'`;
    assert.equal((await reserve()).reserved,true);
  });
  await test('failed delivery consumes quota, revokes only its token; finalization idempotent',async()=>{
    await sql`INSERT INTO application_resume_tokens(application_id,token_hash,expires_at) VALUES (${app},${'a'.repeat(64)},now()+interval '30 days')`;
    const r=await reserve();
    await roleCall('service_role',tx=>tx`SELECT finish_application_recovery(${r.attempt_id},'failed',null)`);
    await roleCall('service_role',tx=>tx`SELECT finish_application_recovery(${r.attempt_id},'sent','late')`);
    assert.equal((await reserve()).reserved,false);
    const tokens=await sql`SELECT * FROM application_resume_tokens`;
    assert.equal(tokens.find(t=>t.token_hash==='a'.repeat(64)).revoked_at,null);assert.equal(tokens.filter(t=>t.revoked_at).length,1);
    assert.equal((await sql`SELECT status FROM application_recovery_attempts`)[0].status,'failed');
  });
  await test('uncertain delivery preserves token but cannot bypass quota',async()=>{
    const r=await reserve();await roleCall('service_role',tx=>tx`SELECT finish_application_recovery(${r.attempt_id},'unknown',null)`);
    assert.equal((await reserve()).reserved,false);assert.equal((await sql`SELECT revoked_at FROM application_resume_tokens`)[0].revoked_at,null);
  });
  await test('reservation insert failure rolls back token creation',async()=>{
    await sql.unsafe(`CREATE FUNCTION fixture_fail() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected failure'; END $$; CREATE TRIGGER fixture_fail BEFORE INSERT ON application_recovery_attempts FOR EACH ROW EXECUTE FUNCTION fixture_fail()`);
    await assert.rejects(reserve(),/injected failure/);assert.equal((await sql`SELECT * FROM application_resume_tokens`).length,0);
    await sql`DROP TRIGGER fixture_fail ON application_recovery_attempts`;
  });
  const insertReview=()=>sql`INSERT INTO application_identity_reviews(id,application_id,kind) VALUES (${review},${app},'phone_match_email_differs')`;
  await test('audit insert failure rolls back identity resolution',async()=>{
    await insertReview();await sql`CREATE TRIGGER fixture_fail BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fixture_fail()`;
    await assert.rejects(resolve(),/injected failure/);assert.equal((await sql`SELECT status FROM application_identity_reviews`)[0].status,'open');assert.equal((await sql`SELECT * FROM audit_log`).length,0);
    await sql`DROP TRIGGER fixture_fail ON audit_log`;
  });
  await test('20 simultaneous resolutions produce one change and one authenticated audit',async()=>{
    await insertReview();const rows=await Promise.all(Array.from({length:20},resolve));assert.equal(rows.filter(r=>r.changed).length,1);
    const logs=await sql`SELECT * FROM audit_log`;assert.equal(logs.length,1);assert.equal(logs[0].actor_user_id,actor);assert.equal(logs[0].actor_email,'manager@example.invalid');assert.equal(logs[0].metadata.review_id,review);
  });
  await test('public/staff cannot reserve, finalize, or mutate quota directly; driver/coordinator cannot resolve',async()=>{
    for(const role of ['anon','authenticated']) {
      await assert.rejects(roleCall(role,tx=>tx`SELECT reserve_application_recovery(${app},${'b'.repeat(64)})`),/permission denied/);
      await assert.rejects(roleCall(role,tx=>tx`SELECT finish_application_recovery(${review},'sent',null)`),/permission denied/);
      await assert.rejects(roleCall(role,tx=>tx`INSERT INTO application_recovery_attempts(application_id) VALUES (${app})`),/permission denied/);
    }
    await insertReview();for(const role of ['driver','coordinator']) {await sql`UPDATE user_roles SET role=${role}`;await assert.rejects(resolve(),/Forbidden/);}
    assert.equal((await sql`SELECT status FROM application_identity_reviews`)[0].status,'open');
    assert.deepEqual((await sql`SELECT answers FROM applications`)[0].answers,{preserved:true});
  });
  console.log(`${passed} real PostgreSQL scenarios passed (synthetic fixture; not live Supabase verification)`);
} finally {rmSync(buildDir,{recursive:true,force:true});delete globalThis.__rrPgSend;await sql.end();await root.unsafe(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);await root.end();}
