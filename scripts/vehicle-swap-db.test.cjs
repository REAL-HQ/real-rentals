// Local Postgres proof for supabase/migrations/20261120130000_rental_vehicle_swaps.sql.
//
// Builds a minimal copy of the production objects the swap touches (the
// guard triggers, odometer guard, rental_mileage_reading and end_rental_tx are
// copied verbatim from production, read-only, Nov 20 2026), applies the
// migration twice, then exercises complete_rental_vehicle_swap_tx.
// Needs postgres binaries: PG_BIN, pg_config, or the embedded build under
// /workspace/pg17. Skips (exit 0, "SKIP") when none is found.
const fs = require("fs");
const os = require("os");
const path = require("path");
const net = require("net");
const assert = require("assert/strict");
const { execFileSync, spawn, spawnSync } = require("child_process");

const root = path.resolve(__dirname, "..");
const MIGRATION = path.join(root, "supabase/migrations/20261120130000_rental_vehicle_swaps.sql");

function findBin() {
  const cands = [process.env.PG_BIN, "/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin"];
  try { cands.push(execFileSync("pg_config", ["--bindir"], { encoding: "utf8" }).trim()); } catch {}
  for (const c of cands) if (c && fs.existsSync(path.join(c, "postgres")) && fs.existsSync(path.join(c, "initdb"))) return c;
  return null;
}
function findPsql(bin) {
  for (const p of [path.join(bin, "psql"), "/usr/bin/psql", "/usr/lib/postgresql/17/bin/psql"]) if (fs.existsSync(p)) return p;
  return null;
}
const bin = findBin();
const psqlBin = bin && findPsql(bin);
if (!bin || !psqlBin) {
  console.log("SKIP vehicle-swap-db: no local postgres (set PG_BIN)");
  process.exit(0);
}

function freePort() {
  return new Promise((res) => { const s = net.createServer(); s.listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
}

const R = {
  app: "a0000000-0000-4000-8000-000000000001",
  appB: "a0000000-0000-4000-8000-000000000002",
  user: "b0000000-0000-4000-8000-000000000001",
  userB: "b0000000-0000-4000-8000-000000000002",
  staff: "b0000000-0000-4000-8000-0000000000ff",
  oldCar: "c0000000-0000-4000-8000-000000000001",
  newCar: "c0000000-0000-4000-8000-000000000002",
  busyCar: "c0000000-0000-4000-8000-000000000003",
  rental: "d0000000-0000-4000-8000-000000000001",
  rentalB: "d0000000-0000-4000-8000-000000000002",
  pickup: "e0000000-0000-4000-8000-000000000001",
  agreement: "f0000000-0000-4000-8000-000000000001",
  original: "f0000000-0000-4000-8000-000000000000",
  doc: "90000000-0000-4000-8000-000000000001",
  swap: "70000000-0000-4000-8000-000000000001",
  swap2: "70000000-0000-4000-8000-000000000002",
};

const STUB = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA auth; CREATE SCHEMA private; CREATE SCHEMA extensions;
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
GRANT USAGE ON SCHEMA public, private TO anon, authenticated, service_role;
CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE TYPE public.app_role AS ENUM ('admin','user','partner','driver','team','coordinator');
CREATE TABLE public.user_roles (user_id uuid, role public.app_role);
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN NEW.updated_at := now(); RETURN NEW; END $$;
CREATE TABLE public.applications (id uuid PRIMARY KEY, full_name text, vehicle_id uuid, status text DEFAULT 'approved');
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, year int, make text, model text, vin text, weekly_rate numeric, status text, archived_at timestamptz);
CREATE TABLE public.documents (id uuid PRIMARY KEY, label text);
CREATE TABLE public.inspections (id uuid PRIMARY KEY, inspection_type text);
CREATE TABLE public.odometer_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL REFERENCES public.vehicles(id) ON DELETE CASCADE,
  mileage integer NOT NULL CHECK (mileage >= 0 AND mileage < 2000000), observed_on date NOT NULL, source_type text NOT NULL CHECK (source_type = ANY (ARRAY['service','inspection','rental_checkout','rental_return','manual','fleet_inbox','title','registration','odometer_photo','incident','other'])),
  source_id uuid, document_id uuid, document_page integer, evidence_key text, status text NOT NULL DEFAULT 'valid' CHECK (status = ANY (ARRAY['valid','conflict','superseded'])),
  supersedes_id uuid, note text, entered_by uuid, created_at timestamptz DEFAULT now(), observed_at timestamptz, rental_id uuid, driver_id uuid);
CREATE UNIQUE INDEX odometer_readings_evidence_uidx ON public.odometer_readings (evidence_key) WHERE evidence_key IS NOT NULL;
CREATE TABLE public.rentals (
  id uuid PRIMARY KEY, driver_id uuid REFERENCES auth.users(id), vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE RESTRICT,
  application_id uuid REFERENCES public.applications(id), start_date date, end_date date, status text, weekly_rate numeric,
  autopay_active boolean DEFAULT true, stripe_subscription_id text, pickup_reading_id uuid REFERENCES public.odometer_readings(id), return_reading_id uuid REFERENCES public.odometer_readings(id),
  created_at timestamptz DEFAULT now(), updated_at timestamptz DEFAULT now());
CREATE UNIQUE INDEX rentals_one_active_per_vehicle_idx ON public.rentals (vehicle_id) WHERE status = 'active';
CREATE UNIQUE INDEX rentals_one_reserved_per_vehicle_idx ON public.rentals (vehicle_id) WHERE status = 'reserved';
CREATE TABLE public.automation_enrollments (application_id uuid, status text, cancelled_reason text, next_run_at timestamptz);
CREATE TABLE public.agreements (id uuid PRIMARY KEY, application_id uuid, vehicle_id uuid, rental_id uuid, status text, signed_at timestamptz, voided_at timestamptz, document_id uuid, metadata jsonb DEFAULT '{}');
CREATE TABLE public.audit_log (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_email text, actor_role text, action text NOT NULL, entity_type text, entity_id text, summary text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz DEFAULT now());
CREATE TABLE public.app_settings (key text PRIMARY KEY, value jsonb, updated_at timestamptz);
CREATE FUNCTION public.vehicle_rental_ready_missing(_vehicle_id uuid) RETURNS text[] LANGUAGE sql STABLE AS $$
  SELECT array_remove(ARRAY[CASE WHEN v.vin IS NULL THEN 'vin' END, CASE WHEN coalesce(v.weekly_rate,0) <= 0 THEN 'weekly_rate' END], NULL) FROM public.vehicles v WHERE v.id = _vehicle_id $$;

-- Verbatim from production (read-only, Nov 20 2026)
CREATE OR REPLACE FUNCTION public.guard_rental_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF current_setting('app.rental_tx', true) = 'on' THEN RETURN COALESCE(NEW, OLD); END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'active' THEN RAISE EXCEPTION 'rental_lifecycle_guard: start a rental through activation' USING ERRCODE = 'P0001'; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    IF OLD.status = 'active' THEN RAISE EXCEPTION 'rental_lifecycle_guard: end the rental instead of deleting it' USING ERRCODE = 'P0001'; END IF;
    RETURN OLD;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status AND (OLD.status = 'active' OR NEW.status = 'active') THEN
    RAISE EXCEPTION 'rental_lifecycle_guard: rentals start and end only through activation / End Rental' USING ERRCODE = 'P0001';
  END IF;
  IF OLD.status = 'active' AND (NEW.vehicle_id IS DISTINCT FROM OLD.vehicle_id OR NEW.driver_id IS DISTINCT FROM OLD.driver_id) THEN
    RAISE EXCEPTION 'rental_lifecycle_guard: an active rental''s vehicle and driver cannot be changed' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER guard_rental_lifecycle BEFORE INSERT OR DELETE OR UPDATE ON public.rentals FOR EACH ROW EXECUTE FUNCTION guard_rental_lifecycle();
CREATE OR REPLACE FUNCTION public.guard_vehicle_rented_status() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'rented' THEN
      RAISE EXCEPTION 'vehicle_status_guard: a new vehicle cannot start as Rented; activate a rental instead' USING ERRCODE = 'P0001';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    IF NEW.status = 'rented' AND NOT EXISTS (SELECT 1 FROM public.rentals r WHERE r.vehicle_id = NEW.id AND r.status = 'active') THEN
      RAISE EXCEPTION 'vehicle_status_guard: Rented is set only by activating a rental' USING ERRCODE = 'P0001';
    END IF;
    IF OLD.status = 'rented' AND EXISTS (SELECT 1 FROM public.rentals r WHERE r.vehicle_id = NEW.id AND r.status = 'active') THEN
      RAISE EXCEPTION 'vehicle_status_guard: this vehicle is on an active rental; end the rental to change its status' USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER vehicles_guard_rented_status BEFORE INSERT OR UPDATE OF status ON public.vehicles FOR EACH ROW EXECUTE FUNCTION guard_vehicle_rented_status();
CREATE OR REPLACE FUNCTION public.odometer_readings_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $function$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.mileage <> OLD.mileage OR NEW.observed_on <> OLD.observed_on OR NEW.vehicle_id <> OLD.vehicle_id
       OR NEW.source_type <> OLD.source_type OR NEW.document_id IS DISTINCT FROM OLD.document_id
       OR NEW.observed_at IS DISTINCT FROM OLD.observed_at
       OR (OLD.rental_id IS NOT NULL AND NEW.rental_id IS DISTINCT FROM OLD.rental_id) THEN
      RAISE EXCEPTION 'odometer_immutable: add a correcting reading instead';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.status = 'valid' AND EXISTS (
    SELECT 1 FROM public.odometer_readings r WHERE r.vehicle_id = NEW.vehicle_id AND r.status = 'valid'
      AND r.observed_on <= NEW.observed_on AND r.mileage > NEW.mileage + 500) THEN
    NEW.status := 'conflict';
  END IF;
  RETURN NEW;
END $function$;
CREATE TRIGGER odometer_readings_guard BEFORE INSERT OR UPDATE ON public.odometer_readings FOR EACH ROW EXECUTE FUNCTION odometer_readings_guard();
CREATE OR REPLACE FUNCTION private.rental_mileage_reading(_vehicle uuid, _rental uuid, _driver uuid, _miles integer, _kind text, _insp_type text, _actor uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE v_id uuid; v_today date := (now() AT TIME ZONE 'America/New_York')::date;
BEGIN
  SELECT o.id INTO v_id FROM public.odometer_readings o
    JOIN public.inspections i ON i.id = o.source_id
   WHERE o.vehicle_id = _vehicle AND o.source_type = 'inspection' AND o.mileage = _miles
     AND o.rental_id IS NULL AND i.inspection_type = _insp_type AND o.observed_on >= v_today - 7
   ORDER BY o.observed_on DESC LIMIT 1;
  IF v_id IS NOT NULL THEN
    UPDATE public.odometer_readings SET rental_id = _rental, driver_id = _driver WHERE id = v_id;
    RETURN v_id;
  END IF;
  INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, observed_at, source_type, source_id, evidence_key, entered_by, rental_id, driver_id)
  VALUES (_vehicle, _miles, v_today, now(), _kind, _rental, _kind || ':' || _rental, _actor, _rental, _driver)
  RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
CREATE OR REPLACE FUNCTION public.end_rental_tx(_rental_id uuid, _end date, _vehicle_status text, _return_miles integer DEFAULT NULL::integer, _actor uuid DEFAULT NULL::uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE r record; v_pick integer; v_hist integer; v_read uuid;
BEGIN
  PERFORM set_config('app.rental_tx', 'on', true);
  IF _vehicle_status NOT IN ('available','maintenance') THEN RAISE EXCEPTION 'invalid_vehicle_status'; END IF;
  IF _return_miles IS NOT NULL AND (_return_miles < 0 OR _return_miles > 2000000) THEN RAISE EXCEPTION 'invalid_mileage'; END IF;
  SELECT id, vehicle_id, driver_id, application_id, status, pickup_reading_id INTO r FROM public.rentals WHERE id = _rental_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'rental_not_found'; END IF;
  IF r.status <> 'active' THEN PERFORM set_config('app.rental_tx', 'off', true); RETURN 'already_closed'; END IF;
  PERFORM 1 FROM public.vehicles WHERE id = r.vehicle_id FOR UPDATE;
  IF _return_miles IS NOT NULL THEN
    SELECT mileage INTO v_pick FROM public.odometer_readings WHERE id = r.pickup_reading_id;
    IF v_pick IS NOT NULL AND _return_miles < v_pick THEN RAISE EXCEPTION 'return_below_pickup:%', v_pick; END IF;
    SELECT max(mileage) INTO v_hist FROM public.odometer_readings WHERE vehicle_id = r.vehicle_id AND status = 'valid';
    IF v_hist IS NOT NULL AND _return_miles + 500 < v_hist THEN RAISE EXCEPTION 'return_below_history:%', v_hist; END IF;
    v_read := private.rental_mileage_reading(r.vehicle_id, _rental_id, r.driver_id, _return_miles, 'rental_return', 'return', _actor);
  END IF;
  UPDATE public.rentals SET status = 'closed', end_date = _end, autopay_active = false,
    return_reading_id = COALESCE(v_read, return_reading_id) WHERE id = _rental_id;
  UPDATE public.vehicles SET status = _vehicle_status WHERE id = r.vehicle_id;
  IF r.application_id IS NOT NULL THEN
    UPDATE public.automation_enrollments SET status = 'cancelled', cancelled_reason = 'rental ended', next_run_at = NULL
      WHERE application_id = r.application_id AND status = 'active';
  END IF;
  PERFORM set_config('app.rental_tx', 'off', true);
  RETURN 'closed';
END $function$;
`;

const SEED = `
INSERT INTO auth.users VALUES ('${R.user}'),('${R.userB}'),('${R.staff}');
INSERT INTO public.user_roles VALUES ('${R.staff}','team');
INSERT INTO public.applications(id, full_name, vehicle_id) VALUES ('${R.app}','James Test','${R.oldCar}'),('${R.appB}','Other Renter','${R.busyCar}');
INSERT INTO public.vehicles(id, year, make, model, vin, weekly_rate, status) VALUES
  ('${R.oldCar}',2018,'Toyota','Camry','4T1B11HK5JU000001',375,'available'),
  ('${R.newCar}',2019,'Honda','Accord','1HGCV1F30KA000002',400,'available'),
  ('${R.busyCar}',2017,'Nissan','Altima','1N4AL3AP5HC000003',350,'available');
INSERT INTO public.odometer_readings(id, vehicle_id, mileage, observed_on, source_type, evidence_key, rental_id) VALUES
  ('${R.pickup}','${R.oldCar}',50000,current_date - 8,'rental_checkout','rental_checkout:${R.rental}','${R.rental}');
INSERT INTO public.odometer_readings(vehicle_id, mileage, observed_on, source_type) VALUES ('${R.newCar}', 30000, current_date - 30, 'service');
INSERT INTO public.rentals(id, driver_id, vehicle_id, application_id, start_date, status, weekly_rate, stripe_subscription_id, pickup_reading_id)
  VALUES ('${R.rental}','${R.user}','${R.oldCar}','${R.app}',current_date - 8,'reserved',375,'sub_test','${R.pickup}');
SET app.rental_tx = 'on';
UPDATE public.rentals SET status = 'active' WHERE id = '${R.rental}';
RESET app.rental_tx;
UPDATE public.vehicles SET status = 'rented' WHERE id = '${R.oldCar}';
INSERT INTO public.documents VALUES ('${R.doc}','Signed rental agreement');
INSERT INTO public.agreements(id, application_id, vehicle_id, rental_id, status, signed_at) VALUES ('${R.original}','${R.app}','${R.oldCar}','${R.rental}','signed', now() - interval '8 days');
`;

let dir, port, proc;
function psql(sql, { role = null, expectFail = false } = {}) {
  const full = role ? `SET ROLE ${role};\n${sql}` : sql;
  const r = spawnSync(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtX", "-c", full], { encoding: "utf8" });
  if (expectFail) {
    assert.notEqual(r.status, 0, `expected failure: ${sql}\n${r.stdout}`);
    return r.stderr;
  }
  if (r.status !== 0) throw new Error(`psql failed: ${r.stderr}\n${sql}`);
  return r.stdout.trim();
}
function psqlFile(file) {
  const r = spawnSync(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtX", "-f", file], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`psql -f failed: ${r.stderr}`);
}
const results = [];
function test(name, fn) { fn(); results.push(name); console.log("PASS", name); }
const call = (swap, status = "maintenance", ret = 50250, pick = 30010) =>
  `SELECT public.complete_rental_vehicle_swap_tx('${swap}', ${status === null ? "NULL" : `'${status}'`}, ${ret === null ? "NULL" : ret}, ${pick === null ? "NULL" : pick}, '1/2', 'F', '${R.staff}')::text`;

(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "swap-pg-"));
  port = await freePort();
  execFileSync(path.join(bin, "initdb"), ["-D", path.join(dir, "data"), "-U", "postgres", "--auth=trust", "-E", "UTF8"], { stdio: "ignore" });
  proc = spawn(path.join(bin, "postgres"), ["-D", path.join(dir, "data"), "-p", String(port), "-k", dir, "-c", "listen_addresses="], { stdio: "ignore" });
  for (let i = 0; i < 100; i++) {
    const r = spawnSync(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-c", "select 1"], { encoding: "utf8" });
    if (r.status === 0) break;
    await new Promise((res) => setTimeout(res, 100));
  }
  try {
    psql(STUB);
    psql(SEED);

    test("migration applies twice and keeps one copy", () => {
      psqlFile(MIGRATION);
      psqlFile(MIGRATION);
      assert.equal(psql(`SELECT count(*) FROM pg_proc WHERE proname = 'complete_rental_vehicle_swap_tx'`), "1");
      assert.equal(psql(`SELECT count(*) FROM pg_class WHERE relname = 'rental_vehicle_swaps'`), "1");
      assert.equal(psql(`SELECT count(*) FROM pg_policy WHERE polrelid = 'public.rental_vehicle_swaps'::regclass`), "1");
      assert.equal(psql(`SELECT count(*) FROM public.app_settings`), "0", "the migration does not switch anything on");
    });

    test("only service_role may run the swap; staff read the table, nobody else writes it", () => {
      const f = "public.complete_rental_vehicle_swap_tx(uuid,text,integer,integer,text,text,uuid)";
      assert.equal(psql(`SELECT has_function_privilege('anon','${f}','EXECUTE')::text || has_function_privilege('authenticated','${f}','EXECUTE')::text || has_function_privilege('service_role','${f}','EXECUTE')::text`), "falsefalsetrue");
      assert.equal(psql(`SELECT has_table_privilege('authenticated','public.rental_vehicle_swaps','INSERT')::text || has_table_privilege('authenticated','public.rental_vehicle_swaps','UPDATE')::text || has_table_privilege('anon','public.rental_vehicle_swaps','SELECT')::text`), "falsefalsefalse");
      assert.equal(psql(`SELECT relrowsecurity::text FROM pg_class WHERE oid = 'public.rental_vehicle_swaps'::regclass`), "true");
    });

    test("gate probe: a null status is refused before any read", () => {
      const err = psql(call("00000000-0000-0000-0000-000000000000", null, null, null), { expectFail: true });
      assert.match(err, /invalid_vehicle_status/);
    });

    psql(`INSERT INTO public.agreements(id, application_id, vehicle_id, rental_id, status, metadata) VALUES ('${R.agreement}','${R.app}','${R.newCar}','${R.rental}','sent', jsonb_build_object('amendment', jsonb_build_object('kind','vehicle_swap','swap_id','${R.swap}')))`);
    psql(`INSERT INTO public.rental_vehicle_swaps(id, rental_id, application_id, from_vehicle_id, to_vehicle_id, reason_code, reason, weekly_rate, previous_agreement_id, previous_document_id, requested_by_label, agreement_id)
          VALUES ('${R.swap}','${R.rental}','${R.app}','${R.oldCar}','${R.newCar}','maintenance','Check engine light on',375,'${R.original}','${R.doc}','staff test','${R.agreement}')`);

    test("swap numbers start at 1000; one open swap per rental and per replacement car", () => {
      assert.equal(psql(`SELECT swap_number FROM public.rental_vehicle_swaps WHERE id = '${R.swap}'`), "1000");
      const e1 = psql(`INSERT INTO public.rental_vehicle_swaps(rental_id, application_id, from_vehicle_id, to_vehicle_id, reason_code, reason, weekly_rate, previous_document_id, requested_by_label)
        VALUES ('${R.rental}','${R.app}','${R.oldCar}','${R.busyCar}','other','second open swap',375,'${R.doc}','x')`, { expectFail: true });
      assert.match(e1, /rental_vehicle_swaps_one_open_per_rental/);
      const e2 = psql(`INSERT INTO public.rental_vehicle_swaps(rental_id, application_id, from_vehicle_id, to_vehicle_id, reason_code, reason, weekly_rate, requested_by_label)
        VALUES ('${R.rental}','${R.app}','${R.oldCar}','${R.newCar}','other','follows nothing',375,'x')`, { expectFail: true });
      assert.match(e2, /follows_something|one_open/);
    });

    test("an unsigned swap is refused and writes nothing", () => {
      assert.match(psql(call(R.swap), { expectFail: true }), /swap_not_signed/);
      psql(`UPDATE public.rental_vehicle_swaps SET status = 'signed', signed_at = now() WHERE id = '${R.swap}'`);
      assert.match(psql(call(R.swap), { expectFail: true }), /swap_agreement_not_signed/, "the agreement row itself must be signed");
      assert.equal(psql(`SELECT vehicle_id FROM public.rentals WHERE id = '${R.rental}'`), R.oldCar);
      assert.equal(psql(`SELECT count(*) FROM public.odometer_readings WHERE evidence_key LIKE 'swap_%'`), "0");
    });

    psql(`UPDATE public.agreements SET status = 'signed', signed_at = now() WHERE id = '${R.agreement}'`);

    test("a signed agreement for a different car is refused", () => {
      psql(`UPDATE public.agreements SET vehicle_id = '${R.busyCar}' WHERE id = '${R.agreement}'`);
      assert.match(psql(call(R.swap), { expectFail: true }), /swap_agreement_not_signed/);
      psql(`UPDATE public.agreements SET vehicle_id = '${R.newCar}' WHERE id = '${R.agreement}'`);
    });

    test("a replacement held by another booking is refused and rolls back", () => {
      psql(`INSERT INTO public.rentals(id, driver_id, vehicle_id, application_id, status, weekly_rate) VALUES ('${R.rentalB}','${R.userB}','${R.newCar}','${R.appB}','reserved',350)`);
      assert.match(psql(call(R.swap), { expectFail: true }), /replacement_on_other_rental/);
      psql(`DELETE FROM public.rentals WHERE id = '${R.rentalB}'`);
      assert.equal(psql(`SELECT status FROM public.vehicles WHERE id = '${R.newCar}'`), "available");
    });

    test("a return reading below the pickup is refused", () => {
      assert.match(psql(call(R.swap, "maintenance", 49000), { expectFail: true }), /return_below_pickup:50000/);
    });

    test("a replacement that is not Rental Ready is refused", () => {
      psql(`UPDATE public.vehicles SET weekly_rate = NULL WHERE id = '${R.newCar}'`);
      assert.match(psql(call(R.swap), { expectFail: true }), /replacement_not_rental_ready:weekly_rate/);
      psql(`UPDATE public.vehicles SET weekly_rate = 400 WHERE id = '${R.newCar}'`);
    });

    test("a held rental lock fails fast with 40001 and writes nothing", () => {
      const holder = spawn(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-qAtX", "-c", `BEGIN; SELECT 1 FROM public.rentals WHERE id = '${R.rental}' FOR UPDATE; SELECT pg_sleep(4); COMMIT;`], { stdio: "ignore" });
      spawnSync("sleep", ["1"]);
      const r = spawnSync(psqlBin, ["-h", dir, "-p", String(port), "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtX", "-c", call(R.swap)], { encoding: "utf8", env: { ...process.env, PGOPTIONS: "" } });
      psql(`SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity WHERE query LIKE '%pg_sleep(4)%' AND pid <> pg_backend_pid()`);
      holder.kill();
      assert.notEqual(r.status, 0);
      assert.match(r.stderr, /40001|swap_contention/);
      spawnSync("sleep", ["1"]);
      assert.equal(psql(`SELECT vehicle_id FROM public.rentals WHERE id = '${R.rental}'`), R.oldCar);
    });

    test("completing moves the rental, keeps billing, records readings and one audit row", () => {
      const out = JSON.parse(psql(call(R.swap)));
      assert.equal(out.result, "completed");
      assert.equal(out.swap_number, 1000);
      const rental = psql(`SELECT vehicle_id || '|' || weekly_rate || '|' || stripe_subscription_id || '|' || autopay_active || '|' || status FROM public.rentals WHERE id = '${R.rental}'`);
      assert.equal(rental, `${R.newCar}|375|sub_test|true|active`);
      assert.equal(psql(`SELECT status FROM public.vehicles WHERE id = '${R.newCar}'`), "rented");
      assert.equal(psql(`SELECT status FROM public.vehicles WHERE id = '${R.oldCar}'`), "maintenance");
      assert.equal(psql(`SELECT vehicle_id FROM public.applications WHERE id = '${R.app}'`), R.newCar);
      assert.equal(psql(`SELECT r.mileage FROM public.rentals x JOIN public.odometer_readings r ON r.id = x.pickup_reading_id WHERE x.id = '${R.rental}'`), "30010");
      assert.equal(psql(`SELECT string_agg(evidence_key, ',' ORDER BY evidence_key) FROM public.odometer_readings WHERE evidence_key LIKE 'swap_%'`), `swap_checkout:${R.swap},swap_return:${R.swap}`);
      const s = psql(`SELECT status || '|' || from_vehicle_status || '|' || return_fuel || '|' || pickup_fuel || '|' || (replaced_pickup_reading_id = '${R.pickup}')::text FROM public.rental_vehicle_swaps WHERE id = '${R.swap}'`);
      assert.equal(s, "completed|maintenance|1/2|F|true");
      assert.equal(psql(`SELECT count(*) FROM public.audit_log WHERE action = 'rental.vehicle_swapped' AND entity_id = '${R.rental}'`), "1");
      assert.equal(psql(`SELECT metadata->>'billing' FROM public.audit_log WHERE action = 'rental.vehicle_swapped'`), "unchanged");
    });

    test("a repeat call replays the result and writes nothing more", () => {
      const out = JSON.parse(psql(call(R.swap)));
      assert.equal(out.result, "already_completed");
      assert.equal(psql(`SELECT count(*) FROM public.audit_log WHERE action = 'rental.vehicle_swapped'`), "1");
      assert.equal(psql(`SELECT count(*) FROM public.odometer_readings WHERE evidence_key LIKE 'swap_%'`), "2");
    });

    test("the lifecycle guard still refuses a direct vehicle change outside the function", () => {
      assert.match(psql(`UPDATE public.rentals SET vehicle_id = '${R.oldCar}' WHERE id = '${R.rental}'`, { expectFail: true }), /rental_lifecycle_guard/);
    });

    test("End Rental after a swap compares against the new car's pickup and does not collide", () => {
      assert.match(psql(`SELECT public.end_rental_tx('${R.rental}', current_date, 'available', 30005, '${R.staff}')`, { expectFail: true }), /return_below_pickup:30010/);
      assert.equal(psql(`SELECT public.end_rental_tx('${R.rental}', current_date, 'available', 30400, '${R.staff}')`), "closed");
      assert.equal(psql(`SELECT status FROM public.vehicles WHERE id = '${R.newCar}'`), "available");
      assert.equal(psql(`SELECT count(*) FROM public.odometer_readings WHERE evidence_key = 'rental_return:${R.rental}'`), "1");
    });

    console.log(`vehicle-swap-db: ${results.length} passed`);
  } finally {
    proc.kill("SIGINT");
    await new Promise((res) => setTimeout(res, 500));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => {
  console.error(e);
  try { proc && proc.kill("SIGKILL"); } catch {}
  process.exit(1);
});
