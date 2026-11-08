/**
 * Local rehearsal of supabase/migrations/20261108030000_trip_media.sql on a
 * throwaway Postgres with a minimal stand-in of the live schema. Checks the
 * migration applies twice cleanly and that, as an `authenticated` renter:
 * other rentals' rows are invisible, GPS/original paths can't be selected,
 * direct inserts are refused, and renter_portal_file returns the share copy.
 *
 * Run: PG_BIN=... node scripts/trip-media-migration.test.cjs
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const { pgProgram, makeDataDir } = require("./pg-local.cjs");

const root = path.resolve(__dirname, "..");
const mig = fs.readFileSync(path.join(root, "supabase/migrations/20261108030000_trip_media.sql"), "utf8");
const portal = fs.readFileSync(path.join(root, "supabase/migrations/20261104210000_renter_portal.sql"), "utf8");
const liveRpc = portal.slice(portal.indexOf("CREATE OR REPLACE FUNCTION public.renter_portal_file"), portal.indexOf("GRANT EXECUTE ON FUNCTION public.renter_portal_file(text, uuid) TO authenticated;") + 80);
const mig2 = fs.readFileSync(path.join(root, "supabase/migrations/20261108030100_trip_media_portal_file.sql"), "utf8");
const dir = makeDataDir("trip-media-pg-");
const port = String(20000 + Math.floor(Math.random() * 20000));
const user = require("os").userInfo().username;
execFileSync(pgProgram("initdb"), ["-D", dir, "--username", user, "--auth=trust"], { stdio: "ignore" });
execFileSync(pgProgram("pg_ctl"), ["-D", dir, "-o", `-p ${port} -k ${dir} -c listen_addresses=''`, "-w", "start"], { stdio: "ignore" });
const psql = (sql, role) =>
  execFileSync(pgProgram("psql"), ["-h", dir, "-p", port, "-U", user, "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-c", role ? `SET ROLE ${role}; ${sql}` : sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const U1 = "00000000-0000-4000-8000-0000000000a1";
const U2 = "00000000-0000-4000-8000-0000000000a2";
let pass = 0;
const ok = (m) => (pass++, console.log("PASS", m));
try {
  psql(`
    CREATE ROLE authenticated; CREATE ROLE anon; CREATE ROLE service_role BYPASSRLS;
    CREATE SCHEMA auth; CREATE SCHEMA private;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('test.uid', true), '')::uuid $$;
    GRANT USAGE ON SCHEMA auth, private TO authenticated;
    CREATE TABLE public.applications (id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid);
    CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
    CREATE TABLE public.rentals (id uuid PRIMARY KEY, driver_id uuid, vehicle_id uuid, status text, end_date date, updated_at timestamptz DEFAULT now());
    CREATE TABLE public.documents (id uuid PRIMARY KEY, storage_bucket text, storage_path text, vehicle_id uuid, driver_id uuid, category text, is_current bool, visibility text[]);
    CREATE TABLE public.condition_media (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL, rental_id uuid, inspection_id uuid, incident_id uuid,
      phase text NOT NULL, angle text, media_type text NOT NULL DEFAULT 'photo', storage_bucket text NOT NULL DEFAULT 'condition-media',
      storage_path text NOT NULL, file_name text, mime_type text, size_bytes bigint, captured_by uuid, captured_by_role text NOT NULL DEFAULT 'staff',
      caption text, created_at timestamptz NOT NULL DEFAULT now(), taken_at timestamptz, taken_at_source text, gps_lat double precision, gps_lng double precision);
    CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
    CREATE FUNCTION private.driver_rents_vehicle(_v uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT EXISTS (SELECT 1 FROM public.rentals r WHERE r.vehicle_id=_v AND r.driver_id=auth.uid() AND r.status='active') $$;
    CREATE FUNCTION private.renter_portal_stage(s text, e date) RETURNS text LANGUAGE sql IMMUTABLE AS $$ SELECT CASE WHEN s='active' THEN 'active' ELSE 'returned' END $$;
    CREATE FUNCTION private.renter_visible_rental_ids() RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER AS $$ SELECT id FROM public.rentals WHERE driver_id = auth.uid() AND status='active' $$;
    GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA private, auth TO authenticated;
    GRANT SELECT, INSERT, UPDATE, DELETE ON public.condition_media TO authenticated; GRANT ALL ON public.condition_media TO service_role; GRANT USAGE ON SCHEMA private TO service_role;
    ALTER TABLE public.condition_media ENABLE ROW LEVEL SECURITY;
    CREATE POLICY "Staff manage condition media" ON public.condition_media FOR ALL TO authenticated USING (private.is_staff()) WITH CHECK (private.is_staff());
    CREATE POLICY "Drivers read condition media on their vehicle" ON public.condition_media FOR SELECT TO authenticated USING (captured_by = auth.uid() OR private.driver_rents_vehicle(vehicle_id));
    CREATE POLICY "Drivers add condition media on their vehicle" ON public.condition_media FOR INSERT TO authenticated WITH CHECK (captured_by = auth.uid() AND captured_by_role = 'driver' AND private.driver_rents_vehicle(vehicle_id));
    INSERT INTO public.vehicles VALUES ('10000000-0000-4000-8000-000000000001');
    INSERT INTO public.rentals VALUES ('20000000-0000-4000-8000-000000000001','${U1}','10000000-0000-4000-8000-000000000001','returned',null),
                                     ('20000000-0000-4000-8000-000000000002','${U2}','10000000-0000-4000-8000-000000000001','active',null);
    INSERT INTO public.condition_media (id, vehicle_id, rental_id, phase, storage_path, gps_lat, gps_lng, captured_by_role) VALUES
      ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','checkout','v/old.jpg',40.7,-73.9,'staff'),
      ('30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','checkout','v/new.jpg',40.7,-73.9,'staff');
  `);
  psql(liveRpc);
  // Before: the renter on the current rental can read the previous renter's row and its GPS.
  const before = psql(`SET test.uid='${U2}'; SELECT count(*)||':'||max(gps_lat) FROM public.condition_media`, "authenticated");
  assert.equal(before.split("\n").pop(), "2:40.7");
  ok("baseline reproduces the gap: renter sees another booking's row and GPS");

  psql(mig);
  psql(mig);
  ok("step 1 applies, and re-applies cleanly");

  // The code live today (bf2e20cc) reads and writes condition_media only as
  // service_role. Its exact statements must keep working after step 1.
  const live = [
    "SELECT * FROM public.condition_media WHERE vehicle_id='10000000-0000-4000-8000-000000000001' ORDER BY created_at DESC LIMIT 200",
    `INSERT INTO public.condition_media (vehicle_id, rental_id, inspection_id, phase, angle, media_type, storage_bucket, storage_path, file_name, mime_type, size_bytes, captured_by, captured_by_role, caption, taken_at, taken_at_source, gps_lat, gps_lng) VALUES ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',null,'checkin','front','photo','condition-media','v/live.jpg','a.jpg','image/jpeg',1,'${U2}','driver',null,now(),'upload',null,null)`,
    "SELECT id,storage_bucket,storage_path FROM public.condition_media WHERE id='30000000-0000-4000-8000-000000000001'",
    "SELECT id,phase,angle,media_type,captured_by_role,created_at,taken_at,taken_at_source FROM public.condition_media WHERE rental_id='20000000-0000-4000-8000-000000000002'",
    "SELECT id,inspection_id FROM public.condition_media WHERE rental_id='20000000-0000-4000-8000-000000000002'",
    "DELETE FROM public.condition_media WHERE storage_path='v/live.jpg'",
  ];
  for (const q of live) psql(q, "service_role");
  ok("today's live server statements (service role) still work after step 1");
  const oldRpc = psql(`SET test.uid='${U2}'; SELECT storage_path FROM public.renter_portal_file('photo','30000000-0000-4000-8000-000000000002')`, "authenticated").split("\n").pop();
  assert.equal(oldRpc, "v/new.jpg");
  ok("between step 1 and step 2 the old renter file RPC still works for today's code");

  psql(`UPDATE public.condition_media SET share_path = storage_path || '.share' WHERE id='30000000-0000-4000-8000-000000000002'`);
  const rows = psql(`SET test.uid='${U2}'; SELECT id FROM public.condition_media`, "authenticated").split("\n").pop();
  assert.equal(rows, "30000000-0000-4000-8000-000000000002");
  ok("renter sees only their own rental's rows");

  for (const col of ["gps_lat", "storage_path", "share_path", "*"]) {
    assert.throws(() => psql(`SET test.uid='${U2}'; SELECT ${col} FROM public.condition_media`, "authenticated"), /permission denied/);
  }
  ok("GPS, original and share paths (and select *) refused to a user JWT");

  assert.throws(
    () => psql(`SET test.uid='${U2}'; INSERT INTO public.condition_media (vehicle_id, rental_id, phase, storage_path, captured_by, captured_by_role) VALUES ('10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002','checkout','x','${U2}','driver')`, "authenticated"),
    /row-level security|permission denied/,
  );
  ok("direct renter insert refused (server-only writes)");

  psql(mig2);
  psql(mig2);
  ok("step 2 applies, and re-applies cleanly");
  const f = psql(`SET test.uid='${U2}'; SELECT storage_path FROM public.renter_portal_file('photo','30000000-0000-4000-8000-000000000002')`, "authenticated").split("\n").pop();
  assert.equal(f, "v/new.jpg.share");
  const none = psql(`SET test.uid='${U2}'; SELECT count(*) FROM public.renter_portal_file('photo','30000000-0000-4000-8000-000000000001')`, "authenticated").split("\n").pop();
  assert.equal(none, "0");
  ok("renter_portal_file returns the share copy only, and nothing from another booking");
} finally {
  execFileSync(pgProgram("pg_ctl"), ["-D", dir, "-m", "immediate", "stop"], { stdio: "ignore" });
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log(`${pass} passed`);
