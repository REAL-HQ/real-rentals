import postgres from 'postgres';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
// Hardcoded local Unix socket only: no hosted connection can be supplied.
const config={host:'/private/tmp/rr-stripe-pg/socket',port:55439,username:'postgres',onnotice:()=>{}};
const admin=postgres({...config,database:'postgres'}),name='release_test_'+process.pid;
await admin.unsafe('CREATE DATABASE '+name);const db=postgres({...config,database:name});
const owner='00000000-0000-0000-0000-000000000001',manager='00000000-0000-0000-0000-000000000002',coordinator='00000000-0000-0000-0000-000000000003',driver='00000000-0000-0000-0000-000000000004';
let n=0;const test=async(name,fn)=>{await fn();n++;console.log('PASS '+name)};
try{
 await db.unsafe(`DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 DO $$ BEGIN CREATE ROLE service_role BYPASSRLS; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
 CREATE SCHEMA private;
 CREATE TABLE user_roles(user_id uuid,role text);INSERT INTO user_roles VALUES('${owner}','admin'),('${manager}','team'),('${coordinator}','coordinator'),('${driver}','driver');
 CREATE TABLE vehicles(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,archived_at timestamptz,current_odometer int,year int DEFAULT 2020,make text DEFAULT 'Ford',model text DEFAULT 'Fusion',vin text DEFAULT '3FA6P0H77GR351009',weekly_rate numeric DEFAULT 350);
 CREATE TABLE applications(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),status text,user_id uuid,vehicle_id uuid);
 CREATE TABLE rentals(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,driver_id uuid,application_id uuid,status text,pickup_reading_id uuid,return_reading_id uuid,start_date date,end_date date,weekly_rate numeric,deposit_amount numeric,deposit_held bool,next_payment_due date,autopay_active bool DEFAULT true,stripe_subscription_id text DEFAULT 'sub_synthetic',created_at timestamptz DEFAULT clock_timestamp());
 CREATE UNIQUE INDEX one_active_vehicle ON rentals(vehicle_id) WHERE status='active';
 CREATE TABLE odometer_readings(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,mileage int,status text);
 CREATE TABLE agreements(rental_id uuid,application_id uuid);
 CREATE TABLE automation_enrollments(application_id uuid,status text,cancelled_reason text,next_run_at timestamptz);
 CREATE TABLE inspections(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),rental_id uuid,vehicle_id uuid,inspection_type text,status text,completed_at timestamptz,created_at timestamptz DEFAULT clock_timestamp());
 CREATE TABLE inspection_items(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),inspection_id uuid,result text,is_critical bool);
 CREATE TABLE incidents(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,status text);
 CREATE TABLE maintenance_records(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),vehicle_id uuid,status text,due_date date,due_mileage int);
 CREATE TABLE audit_log(actor_user_id uuid,actor_role text,action text,entity_type text,entity_id text,summary text,metadata jsonb);
 CREATE FUNCTION vehicle_rental_ready_missing(uuid) RETURNS text[] LANGUAGE sql AS $$ SELECT '{}'::text[] $$;
 CREATE FUNCTION private.rental_mileage_reading(uuid,uuid,uuid,integer,text,text,uuid) RETURNS uuid LANGUAGE sql AS $$ SELECT null::uuid $$;
 `);
 const lifecycle=readFileSync('supabase/migrations/20261006014406_0abdea2e-a87c-4adc-9431-d697b5bb30bb.sql','utf8');
 await db.unsafe(lifecycle.slice(0,lifecycle.indexOf('CREATE OR REPLACE FUNCTION public.activate_rental_tx')));
 const ready=readFileSync('supabase/migrations/20261006084912_1bf46cf7-571d-4014-b3d3-df8f58bb7ad3.sql','utf8');
 await db.unsafe(ready.slice(0,ready.indexOf('CREATE OR REPLACE FUNCTION public.guard_vehicle_ready_status')));
 const vehicleGuard=readFileSync('supabase/migrations/20261006012455_0e19926e-9f07-438a-a62d-534e9f14673f.sql','utf8');
 await db.unsafe(vehicleGuard.slice(vehicleGuard.indexOf('CREATE OR REPLACE FUNCTION public.guard_vehicle_rented_status'),vehicleGuard.indexOf('CREATE OR REPLACE FUNCTION public.activate_rental_tx')));
 const original=readFileSync('supabase/migrations/20261006112250_6c73a4f7-a851-44fd-bdf1-f8fc85906eda.sql','utf8');
 await db.unsafe(original.slice(original.indexOf('CREATE FUNCTION public.activate_rental_tx'),original.indexOf('DROP POLICY IF EXISTS')));
 const migration=readFileSync('scripts/safe-vehicle-release/migration.proposed.sql','utf8');
 await test('installation rollback retains original transaction',async()=>{await assert.rejects(()=>db.begin(async tx=>{await tx.unsafe(migration);throw Error('rollback')}));assert.equal((await db`select to_regprocedure('private.vehicle_release_reasons(uuid,uuid)') p`)[0].p,null)});
 await db.begin(tx=>tx.unsafe(migration));
 async function fixture(kind='passed'){
  const v=(await db`insert into vehicles(status) values('maintenance') returning id`)[0].id;
  const a=(await db`insert into applications(status,user_id) values('approved',gen_random_uuid()) returning id,user_id`)[0];
  // Baseline active rental set up with real activation, with no prior return requirement.
  await db`update vehicles set status='available' where id=${v}`;
  const r=(await db`select activate_rental_tx(${a.id},${v},${a.user_id},350,0,false,current_date,null,null,${owner}) id`)[0].id;
  if(kind!=='missing'){
   const i=(await db`insert into inspections(rental_id,vehicle_id,inspection_type,status,completed_at) values(${r},${v},'return',${kind==='failed'?'failed':'passed'},now()) returning id`)[0].id;
   if(kind!=='empty') await db`insert into inspection_items(inspection_id,result,is_critical) values(${i},${kind==='critical'?'fail':'pass'},true)`;
  }
  return {v,r};
 }
 const close=async(f,actor=owner)=>(await db`select end_rental_tx(${f.r},current_date,'available',null,${actor},'safe-release-v1') r`)[0].r;
 for(const kind of ['passed','missing','failed','critical'])await test('return '+kind,async()=>{const f=await fixture(kind),r=await close(f);assert.equal(r.vehicleStatus,kind==='passed'?'available':'maintenance');assert.equal((await db`select status from rentals where id=${f.r}`)[0].status,'closed');assert.equal((await db`select autopay_active from rentals where id=${f.r}`)[0].autopay_active,true);assert.equal((await db`select stripe_subscription_id from rentals where id=${f.r}`)[0].stripe_subscription_id,'sub_synthetic');if(kind!=='passed'){await assert.rejects(()=>db`update vehicles set status='available' where id=${f.v}`,/vehicle_safety_hold/)}});
 for(const table of ['incidents','maintenance_records'])await test('unresolved '+table,async()=>{const f=await fixture();await db.unsafe(`insert into ${table}(vehicle_id,status) values($1,'open')`,[f.v]);assert.equal((await close(f)).vehicleStatus,'maintenance')});
 await test('Manager authorized and one attributed atomic audit',async()=>{const f=await fixture();await close(f,manager);await close(f,manager);const rows=await db`select * from audit_log where entity_id=${f.r}`;assert.equal(rows.length,1);assert.equal(rows[0].actor_user_id,manager)});
 for(const actor of [coordinator,driver,null])await test('unauthorized actor '+actor,async()=>{const f=await fixture();await assert.rejects(()=>close(f,actor),/Forbidden/);assert.equal((await db`select status from rentals where id=${f.r}`)[0].status,'active')});
 for(const role of ['anon','authenticated'])await test('direct '+role+' RPC denied',async()=>{const f=await fixture();await assert.rejects(()=>db.begin(async tx=>{await tx.unsafe('set local role '+role);await tx`select public.end_rental_tx(${f.r},current_date,'available',null,${owner},'safe-release-v1')`}),/permission denied/)});
 await test('audit failure rolls back closure and release',async()=>{const f=await fixture();await db.unsafe("CREATE FUNCTION reject_audit() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'audit_failure'; END$$;CREATE TRIGGER reject_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION reject_audit()");await assert.rejects(()=>close(f),/audit_failure/);assert.equal((await db`select status from rentals where id=${f.r}`)[0].status,'active');assert.equal((await db`select status from vehicles where id=${f.v}`)[0].status,'rented');await db.unsafe('DROP TRIGGER reject_audit ON audit_log;DROP FUNCTION reject_audit()')});
 await test('old client cannot invoke unsafe contract',async()=>{const f=await fixture();await assert.rejects(()=>db`select end_rental_tx(${f.r},current_date,'available',null,${owner})`,/safe_release_client_required/)});
 await test('new adverse evidence holds available vehicle; clearance does not auto release',async()=>{const f=await fixture();await close(f);await db`insert into incidents(vehicle_id,status) values(${f.v},'open')`;assert.equal((await db`select status from vehicles where id=${f.v}`)[0].status,'maintenance');await db`update incidents set status='closed' where vehicle_id=${f.v}`;assert.equal((await db`select status from vehicles where id=${f.v}`)[0].status,'maintenance');await db`update vehicles set status='available' where id=${f.v}`});
 await test('concurrent close is idempotent',async()=>{const f=await fixture();const r=await Promise.all([close(f),close(f)]);assert.equal(r.filter(x=>x.alreadyClosed).length,1);assert.equal((await db`select count(*)::int n from audit_log where entity_id=${f.r}`)[0].n,1)});
 await test('concurrent incident/closure cannot leave vehicle available',async()=>{const f=await fixture();await Promise.all([close(f),db`insert into incidents(vehicle_id,status) values(${f.v},'open')`]);assert.equal((await db`select status from vehicles where id=${f.v}`)[0].status,'maintenance')});
 await test('concurrent assignment cannot bypass failed return hold',async()=>{const f=await fixture('failed');const a=(await db`insert into applications(status,user_id) values('approved',gen_random_uuid()) returning id,user_id`)[0];const outcomes=await Promise.allSettled([close(f),db`select activate_rental_tx(${a.id},${f.v},${a.user_id},350,0,false,current_date,null,null,${owner})`]);assert.equal(outcomes[0].status,'fulfilled');assert.equal(outcomes[1].status,'rejected');assert.equal((await db`select status from vehicles where id=${f.v}`)[0].status,'maintenance')});
 await test('empty checklist never clears return',async()=>{const f=await fixture('empty');assert.equal((await close(f)).vehicleStatus,'maintenance')});
 await test('unknown maintenance schedule holds vehicle',async()=>{const f=await fixture();await db`insert into maintenance_records(vehicle_id,status) values(${f.v},'upcoming')`;assert.equal((await close(f)).vehicleStatus,'maintenance')});
 await test('future scheduled service does not block safe return',async()=>{const f=await fixture();await db`insert into maintenance_records(vehicle_id,status,due_date) values(${f.v},'upcoming',current_date+30)`;assert.equal((await close(f)).vehicleStatus,'available')});
 await test('latest critical inspection failure blocks despite older passed return',async()=>{const f=await fixture();const i=(await db`insert into inspections(vehicle_id,inspection_type,status,completed_at) values(${f.v},'pre_delivery','failed',now()) returning id`)[0].id;await db`insert into inspection_items(inspection_id,result,is_critical) values(${i},'fail',true)`;assert.equal((await close(f)).vehicleStatus,'maintenance')});
 await test('requested maintenance remains a hold after passed inspection',async()=>{const f=await fixture();const r=(await db`select end_rental_tx(${f.r},current_date,'maintenance',null,${owner},'safe-release-v1') r`)[0].r;assert.equal(r.vehicleStatus,'maintenance');assert.ok(r.releaseReasons.includes('Staff requested maintenance'))});
 await test('missing Rental Ready profile holds despite passed return',async()=>{const f=await fixture();await db`update vehicles set weekly_rate=null where id=${f.v}`;assert.equal((await close(f)).vehicleStatus,'maintenance')});
 await test('original lifecycle guard still rejects split writes',async()=>{const f=await fixture();await assert.rejects(()=>db`update rentals set status='closed' where id=${f.r}`,/rental_lifecycle_guard/)});

 await test('draft, empty passed inspection and later pass cannot erase historical critical failure',async()=>{
  const f=await fixture('critical');
  for(const state of ['in_progress','passed']) {
   await db`insert into inspections(vehicle_id,inspection_type,status,completed_at) values(${f.v},'pre_delivery',${state},${state==='passed'?new Date():null})`;
  }
  const later=(await db`insert into inspections(vehicle_id,inspection_type,status,completed_at) values(${f.v},'pre_delivery','passed',now()) returning id`)[0].id;
  await db`insert into inspection_items(inspection_id,result,is_critical) values(${later},'pass',true)`;
  const draft=(await db`insert into inspections(vehicle_id,inspection_type,status) values(${f.v},'pre_delivery','in_progress') returning id`)[0].id;
  await db`insert into inspection_items(inspection_id,result,is_critical) values(${draft},'pending',true)`;
  assert.equal((await close(f)).vehicleStatus,'maintenance');
  await assert.rejects(()=>db`update vehicles set status='available' where id=${f.v}`,/vehicle_safety_hold/);
  await assert.rejects(()=>db`update inspection_items set result='pass' where inspection_id in(select id from inspections where rental_id=${f.r})`,/immutable/);
  await assert.rejects(()=>db`delete from inspections where rental_id=${f.r}`,/immutable/);
 });
 await test('completed maintenance cannot fabricate resolution of inspection failure',async()=>{
  const f=await fixture('critical');await db`insert into maintenance_records(vehicle_id,status) values(${f.v},'completed')`;
  assert.equal((await close(f)).vehicleStatus,'maintenance');
 });
 await test('valid incident and maintenance resolution permits explicit release',async()=>{
  const f=await fixture();await db`insert into maintenance_records(vehicle_id,status) values(${f.v},'in_progress')`;
  await close(f);await db`update maintenance_records set status='completed' where vehicle_id=${f.v}`;
  assert.equal((await db`select status from vehicles where id=${f.v}`)[0].status,'maintenance');
  await db`update vehicles set status='available' where id=${f.v}`;
 });
 await test('metadata edits do not invoke release transition gate',async()=>{
  const f=await fixture('missing');await close(f);
  // Simulate a pre-install legacy available vehicle with missing evidence, locally only.
  await db.unsafe('ALTER TABLE vehicles DISABLE TRIGGER safe_release_guard');
  await db`update vehicles set status='available' where id=${f.v}`;
  await db.unsafe('ALTER TABLE vehicles ENABLE TRIGGER safe_release_guard');
  await db`update vehicles set model='Corrected model' where id=${f.v}`;
  await db`update vehicles set status='onboarding' where id=${f.v}`;
  await db`update vehicles set model='Corrected again' where id=${f.v}`;
  await assert.rejects(()=>db`update vehicles set status='available' where id=${f.v}`,/vehicle_safety_hold/);
 });

 await test('concurrent safe assignments cannot double assign',async()=>{
  const f=await fixture();await close(f);
  const apps=await db`insert into applications(status,user_id) values('approved',gen_random_uuid()),('approved',gen_random_uuid()) returning id,user_id`;
  const results=await Promise.allSettled(apps.map(a=>db`select activate_rental_tx(${a.id},${f.v},${a.user_id},350,0,false,current_date,null,null,${owner})`));
  assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
  assert.equal((await db`select count(*)::int n from rentals where vehicle_id=${f.v} and status='active'`)[0].n,1);
 });
 // Install the real proposed Stripe RPCs against supplemental synthetic tables.
 await db.unsafe(`CREATE SCHEMA auth; CREATE TABLE auth.users(id uuid PRIMARY KEY);
 INSERT INTO auth.users SELECT user_id FROM user_roles;
 CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id=auth.uid() AND role IN ('admin','team'))$$;
 CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$SELECT private.is_manager()$$;
 ALTER TABLE rentals ADD COLUMN stripe_customer_id text DEFAULT 'cus_synthetic', ADD COLUMN stripe_payment_method_id text DEFAULT 'pm_synthetic';`);
 await db`update rentals set stripe_subscription_id=null`;
 await db.unsafe('CREATE UNIQUE INDEX rentals_stripe_subscription_id_key ON rentals(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL');
 const stripeFixture=readFileSync('scripts/stripe-reconciliation/fixture.sql','utf8');
 await db.unsafe(stripeFixture.slice(stripeFixture.indexOf('CREATE TABLE public.payments'),stripeFixture.indexOf('CREATE FUNCTION private.is_staff')));
 const refund=readFileSync('supabase/migrations/20261006020456_cf3a2cce-fa6e-4f72-85b9-c95c5d634bb4.sql','utf8').split('CREATE OR REPLACE FUNCTION public.vehicle_pl')[0];
 await db.unsafe(refund);
 await db.begin(tx=>tx.unsafe(readFileSync('scripts/stripe-reconciliation/0033_stripe_reconciliation.proposed.sql','utf8')));
 await test('actual Stripe cancellation and closeout serialize without deadlock',async()=>{
  const f=await fixture('missing');const sub='sub_'+f.r;
  await db`update rentals set stripe_subscription_id=null where id=${f.r}`;
  await db`select stripe_link('sandbox',${sub},'cus_synthetic',${f.r},${owner},'Synthetic review')`;
  let ready;const entered=new Promise(r=>ready=r);
  const stripe=db.begin(async tx=>{
   await tx`set local statement_timeout='5s'`;
   await tx`select stripe_cancel_state(${f.r},'sandbox',${sub},'requested',${owner})`;
   ready();await new Promise(r=>setTimeout(r,100));
  });
  await entered;await Promise.all([stripe,close(f)]);
  assert.equal((await db`select status from vehicles where id=${f.v}`)[0].status,'maintenance');
  assert.equal((await db`select stripe_subscription_id from rentals where id=${f.r}`)[0].stripe_subscription_id,sub);
 });
 await test('closeout and actual Stripe ingestion serialize without deadlock',async()=>{
  const f=await fixture();const sub='sub_'+f.r;await db`update rentals set stripe_subscription_id=null where id=${f.r}`;
  await db`select stripe_link('sandbox',${sub},'cus_synthetic',${f.r},${owner},'Synthetic review')`;
  await Promise.all([close(f),db`select stripe_ingest('sandbox',${'evt_'+f.r},${db.json({kind:'subscription',id:sub,subscription_id:sub,customer_id:'cus_synthetic',status:'canceled'})})`]);
  assert.equal((await db`select status,autopay_active from rentals where id=${f.r}`)[0].status,'closed');
  assert.equal((await db`select autopay_active from rentals where id=${f.r}`)[0].autopay_active,false);
 });
 await test('repeat installation refused',()=>assert.rejects(()=>db.begin(tx=>tx.unsafe(migration))));
 console.log(`${n} disposable database checks passed`);
}finally{await db.end();await admin.unsafe('DROP DATABASE '+name+' WITH (FORCE)');await admin.end()}
