const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const { createRequire } = require("module");

const root = path.resolve(__dirname, "..");
const deps = createRequire(path.resolve(root, "package.json"));
const ts = deps("typescript");
const z = deps("zod");
const results = [];
function test(name, fn) {
  fn();
  results.push(name);
  console.log("PASS", name);
}

const numbers = fs.readFileSync(path.join(root, "src/lib/record-numbers.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "src/components/admin/BookingVehicleHistory.tsx"), "utf8");
const server = fs.readFileSync(path.join(root, "src/lib/vehicle-swap.functions.ts"), "utf8");
const sql = fs.readFileSync(path.join(root, "proposed/vehicle-swap-v1.sql"), "utf8");
const booking = fs.readFileSync(path.join(root, "src/components/admin/BookingDetails.tsx"), "utf8");
const profile = fs.readFileSync(path.join(root, "src/components/admin/VehicleProfile.tsx"), "utf8");
const timeline = fs.readFileSync(path.join(root, "src/components/admin/VehicleTimeline.tsx"), "utf8");

test("shipped swap flag is off", () => {
  assert.match(numbers, /export const SWAP_ENABLED = false;/);
});

test("swap form is mounted only while the flag is on", () => {
  const gate = ui.indexOf("SWAP_ENABLED && swapOpen && rentalId");
  const form = ui.indexOf("<SwapForm");
  assert.ok(gate !== -1 && form !== -1 && gate < form);
  assert.match(ui, /disabled=\{!SWAP_ENABLED\}/);
  assert.match(ui, /Swap Unavailable — coming after backend approval\./);
  assert.equal(ui.includes('.rpc("swap_rental_vehicle_tx"'), false);
  assert.equal(ui.includes(">Rate<"), false);
  assert.match(ui, /Fuel: —/);
  assert.doesNotMatch(ui, /weekly_rate|stripe|payments/);
});

test("history is read-only and booking and vehicle pages pass ids", () => {
  assert.match(ui, /listAssignmentHistory/);
  assert.match(ui, /No vehicle changes recorded\./);
  assert.match(booking, /rentalId=\{b\.id\}/);
  assert.match(booking, /showSwap=\{b\.phase === "active"\}/);
  assert.match(profile, /vehicleId=\{v\.id\}/);
  assert.equal(profile.includes("showSwap"), false);
  assert.equal(timeline.includes("BookingVehicleHistory"), false);
  for (const file of [
    "src/components/admin/BookingActions.tsx",
    "src/components/admin/VehiclesPanel.tsx",
    "src/components/admin/AddVehicleDialog.tsx",
    "src/components/admin/CloseoutReadiness.tsx",
    "src/components/admin/OverviewPanel.tsx",
  ]) {
    const full = path.join(root, file);
    if (!fs.existsSync(full)) continue;
    assert.equal(fs.readFileSync(full, "utf8").includes("swap_rental_vehicle_tx"), false, file);
  }
});

test("server checks the flag before the swap rpc", () => {
  const flag = server.indexOf("if (!SWAP_ENABLED)");
  const rpc = server.indexOf('.rpc("swap_rental_vehicle_tx"');
  assert.ok(flag !== -1 && rpc !== -1 && flag < rpc);
  assert.match(server, /requireManager/);
  assert.match(server, /list_assignment_history_v1/);
  assert.match(server, /PGRST202\|PGRST205/);
});

test("proposed sql documents the lock order and does not bill", () => {
  const start = sql.indexOf("CREATE FUNCTION public.swap_rental_vehicle_tx");
  const end = sql.indexOf("ALTER FUNCTION public.swap_rental_vehicle_tx");
  const body = sql.slice(start, end);
  let at = -1;
  for (const marker of [
    "PERFORM private.approval_lock()",
    "pg_try_advisory_xact_lock(710026,2)",
    "FROM public.applications WHERE id=app_id FOR UPDATE NOWAIT",
    "FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT",
    "IF old_vehicle<new_vehicle THEN",
    "FROM public.vehicles WHERE id=old_vehicle FOR UPDATE NOWAIT",
    "FROM public.vehicles WHERE id=new_vehicle FOR UPDATE NOWAIT",
    "private.swap_agreement_evidence",
    "FROM public.application_identity_reviews WHERE application_id=app_id FOR SHARE NOWAIT",
    "FROM public.booking_vehicle_assignments WHERE id=a.id FOR SHARE NOWAIT",
    "INSERT INTO private.assignment_closures",
    "INSERT INTO private.swap_operations",
    "INSERT INTO public.booking_vehicle_assignments",
  ]) {
    const next = body.indexOf(marker, at + 1);
    assert.ok(next > at, marker);
    at = next;
  }
  assert.doesNotMatch(sql, /INSERT\s+INTO\s+public\.payments/i);
  assert.doesNotMatch(body, /SET\s+status\s*=\s*'available'/i);
  assert.match(sql, /status='maintenance'/);
  assert.match(sql, /outgoing_available_refused/);
  assert.equal(body.includes("record_agreement_evidence"), false);
  const gateStart = sql.indexOf("CREATE FUNCTION private.swap_agreement_evidence");
  const gateEnd = sql.indexOf("REVOKE ALL ON FUNCTION private.swap_agreement_evidence");
  const gate = sql.slice(gateStart, gateEnd);
  assert.match(gate, /FROM private\.agreement_evidence WHERE agreement_id=_agreement FOR SHARE NOWAIT/);
  assert.match(gate, /ag\.sha256 IS DISTINCT FROM ev\.sha256/);
  assert.doesNotMatch(gate, /UPDATE\s+public\.agreements/i);
  assert.doesNotMatch(gate, /UPDATE\s+public\.documents/i);
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/vehicle-swap-v1.sql")), false);
});

function loadServer(swapEnabled) {
  const built = ts.transpileModule(server, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal((built.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const calls = [];
  let response = { data: null, error: null };
  const sandbox = {
    exports: {},
    console,
    require(name) {
      if (name === "@tanstack/react-start") {
        return {
          createServerFn() {
            let parse = (d) => d;
            return {
              middleware() { return this; },
              inputValidator(fn) { parse = fn; return this; },
              handler(fn) { return async (x) => fn({ ...x, data: parse(x.data) }); },
            };
          },
        };
      }
      if (name === "@/integrations/supabase/auth-middleware") return { requireSupabaseAuth: {} };
      if (name === "zod") return z;
      if (name === "@/lib/record-numbers") return { SWAP_ENABLED: swapEnabled };
      if (name === "@/lib/roles.server") {
        return {
          requireManager: async () => ({ tier: "manager" }),
          requireStaff: async () => ({ tier: "coordinator" }),
        };
      }
      throw new Error("Unexpected dependency: " + name);
    },
  };
  vm.runInNewContext(built.outputText, sandbox);
  return {
    calls,
    api: sandbox.exports,
    setResponse(next) { response = next; },
    context: {
      userId: "11111111-1111-4111-8111-111111111111",
      supabase: { rpc: async (...args) => { calls.push(args); return response; } },
    },
  };
}

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const swapData = {
  operationId: id(1),
  rentalId: id(2),
  expectedAssignmentId: id(3),
  replacementVehicleId: id(4),
  effectiveAt: "2026-10-20T15:00:00.000Z",
  returnMileage: 12000,
  pickupMileage: 8000,
  reason: "Damage from the road",
  agreementEvidenceId: id(5),
};

function psql(dir, sqlText) {
  return execFileSync(
    "psql",
    ["-h", dir, "-p", "55441", "-d", "swap", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-tA"],
    { input: sqlText, encoding: "utf8" },
  );
}

function startDatabase() {
  const dir = "/tmp/vehicle-swap-pg";
  fs.rmSync(dir, { recursive: true, force: true });
  execFileSync("/usr/lib/postgresql/16/bin/initdb", ["-D", dir, "--username", process.env.USER || "ubuntu", "--auth=trust", "--no-sync"], { stdio: "ignore" });
  execFileSync("/usr/lib/postgresql/16/bin/pg_ctl", ["-D", dir, "-l", path.join(dir, "log"), "-o", `-p 55441 -k ${dir} -c listen_addresses=`, "start"], { stdio: "ignore" });
  execFileSync("/usr/lib/postgresql/16/bin/createdb", ["-h", dir, "-p", "55441", "swap"], { stdio: "ignore" });
  return dir;
}

function stopDatabase(dir) {
  try {
    execFileSync("/usr/lib/postgresql/16/bin/pg_ctl", ["-D", dir, "-m", "immediate", "stop"], { stdio: "ignore" });
  } catch { /* already stopped */ }
}

const ACTOR = "11111111-1111-4111-8111-111111111111";
const APP = "22222222-2222-4222-8222-222222222222";
const DRIVER = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
const NEW = "55555555-5555-4555-8555-555555555555";
const RENTAL = "66666666-6666-4666-8666-666666666666";
const ASSIGNMENT = "77777777-7777-4777-8777-777777777777";
const RECORD = "88888888-8888-4888-8888-888888888888";
const AGREEMENT = "99999999-9999-4999-8999-999999999999";
const DOC = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const BARE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const STALE = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

const fixture = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE ROLE rr_record_executor NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
GRANT USAGE ON SCHEMA private, public, auth TO rr_record_executor;

CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;

CREATE FUNCTION private.record_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'record_history_immutable' USING ERRCODE='42501'; END $$;
CREATE FUNCTION private.approval_actor() RETURNS uuid LANGUAGE sql AS $$ SELECT '${ACTOR}'::uuid $$;
CREATE FUNCTION private.approval_lock() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;
CREATE FUNCTION public.vehicle_rental_ready_missing(uuid) RETURNS text[] LANGUAGE sql AS $$ SELECT '{}'::text[] $$;

CREATE TABLE public.applications (id uuid PRIMARY KEY, user_id uuid, status text);
CREATE TABLE public.vehicles (
  id uuid PRIMARY KEY, status text, archived_at timestamptz,
  unit_number text, year integer, make text, model text, current_odometer integer);
CREATE TABLE public.rentals (
  id uuid PRIMARY KEY, application_id uuid REFERENCES public.applications(id),
  vehicle_id uuid REFERENCES public.vehicles(id), driver_id uuid, status text,
  start_date date, end_date date, weekly_rate numeric, stripe_subscription_id text,
  autopay_active boolean, deposit_amount numeric, deposit_held boolean);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.documents (id uuid PRIMARY KEY);
CREATE TABLE public.agreements (
  id uuid PRIMARY KEY, application_id uuid, vehicle_id uuid, status text, sha256 text,
  document_id uuid, completed_document_id uuid, signed_at timestamptz);
CREATE TABLE public.odometer_readings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), vehicle_id uuid NOT NULL,
  mileage integer NOT NULL CHECK (mileage >= 0 AND mileage < 2000000),
  observed_on date NOT NULL, observed_at timestamptz, source_type text NOT NULL,
  source_id uuid, evidence_key text UNIQUE, status text NOT NULL DEFAULT 'valid',
  entered_by uuid, rental_id uuid, driver_id uuid);
CREATE TABLE public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text NOT NULL, actor_role text,
  actor_user_id uuid, entity_id text, entity_type text, metadata jsonb, summary text NOT NULL);
CREATE TABLE public.payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid, amount numeric, status text);
CREATE TABLE public.application_identity_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid);
CREATE TABLE private.record_operations (
  operation_id uuid PRIMARY KEY, actor_id uuid NOT NULL, application_id uuid NOT NULL,
  request jsonb NOT NULL, rental_id uuid NOT NULL UNIQUE, customer_number bigint NOT NULL,
  booking_number bigint NOT NULL, committed_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE public.booking_vehicle_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid NOT NULL REFERENCES public.rentals(id),
  vehicle_id uuid NOT NULL REFERENCES public.vehicles(id),
  assignment_start timestamptz NOT NULL CHECK (isfinite(assignment_start)),
  pickup_mileage integer CHECK (pickup_mileage BETWEEN 0 AND 2000000),
  assignment_kind text NOT NULL CHECK (assignment_kind IN ('original','replacement')),
  actor_id uuid NOT NULL, operation_id uuid NOT NULL REFERENCES private.record_operations(operation_id),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE (rental_id, assignment_start));
CREATE UNIQUE INDEX record_one_original ON public.booking_vehicle_assignments(rental_id) WHERE assignment_kind='original';
CREATE TABLE private.assignment_closures (
  assignment_id uuid PRIMARY KEY REFERENCES public.booking_vehicle_assignments(id),
  assignment_end timestamptz NOT NULL CHECK (isfinite(assignment_end)),
  return_mileage integer CHECK (return_mileage BETWEEN 0 AND 2000000),
  actor_id uuid NOT NULL, event_id uuid NOT NULL UNIQUE, reason text NOT NULL,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());

CREATE FUNCTION private.record_assignment_interval_guard() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE a public.booking_vehicle_assignments%ROWTYPE;
BEGIN
 IF NOT pg_try_advisory_xact_lock(710026,2) THEN RAISE EXCEPTION 'assignment_contention' USING ERRCODE='40001'; END IF;
 IF TG_TABLE_NAME='assignment_closures' THEN
  SELECT * INTO a FROM public.booking_vehicle_assignments WHERE id=NEW.assignment_id;
  IF NOT FOUND OR NEW.assignment_end<=a.assignment_start
   OR (NEW.return_mileage IS NOT NULL AND a.pickup_mileage IS NOT NULL AND NEW.return_mileage<a.pickup_mileage)
  THEN RAISE EXCEPTION 'invalid_assignment_close'; END IF;
 ELSE
  IF EXISTS (SELECT 1 FROM public.booking_vehicle_assignments s
    LEFT JOIN private.assignment_closures c ON c.assignment_id=s.id
    WHERE (s.rental_id=NEW.rental_id OR s.vehicle_id=NEW.vehicle_id)
      AND tstzrange(s.assignment_start,c.assignment_end,'[)') && tstzrange(NEW.assignment_start,NULL,'[)'))
  THEN RAISE EXCEPTION 'assignment_overlap'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER assignment_interval BEFORE INSERT ON public.booking_vehicle_assignments
 FOR EACH ROW EXECUTE FUNCTION private.record_assignment_interval_guard();
CREATE TRIGGER assignment_close_interval BEFORE INSERT ON private.assignment_closures
 FOR EACH ROW EXECUTE FUNCTION private.record_assignment_interval_guard();

ALTER TABLE public.booking_vehicle_assignments OWNER TO rr_record_executor;
ALTER TABLE private.assignment_closures OWNER TO rr_record_executor;
ALTER TABLE private.record_operations OWNER TO rr_record_executor;
ALTER TABLE public.booking_vehicle_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.assignment_closures ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.record_operations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.booking_vehicle_assignments, private.assignment_closures, private.record_operations
 FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, UPDATE ON public.applications, public.vehicles, public.rentals, public.user_roles, public.application_identity_reviews TO rr_record_executor;
GRANT SELECT ON public.odometer_readings TO rr_record_executor;
GRANT EXECUTE ON FUNCTION private.approval_actor(), private.approval_lock(), private.record_assignment_interval_guard() TO rr_record_executor;

INSERT INTO public.applications VALUES ('${APP}', '${DRIVER}', 'approved');
INSERT INTO public.vehicles VALUES
 ('${OLD}', 'rented', NULL, '12', 2020, 'Kia', 'Soul', 10000),
 ('${NEW}', 'available', NULL, '18', 2021, 'Toyota', 'Camry', 5000);
INSERT INTO public.rentals VALUES
 ('${RENTAL}', '${APP}', '${OLD}', '${DRIVER}', 'active', DATE '2026-10-01', NULL, 350, 'sub_test', true, 500, true);
INSERT INTO public.user_roles VALUES ('${ACTOR}', 'admin');
INSERT INTO public.documents VALUES ('${DOC}');
INSERT INTO public.agreements VALUES
 ('${AGREEMENT}', '${APP}', '${NEW}', 'signed', repeat('ab', 32), '${DOC}', '${DOC}', '2026-10-19 12:00:00+00'),
 ('${BARE}', '${APP}', '${NEW}', 'signed', repeat('ab', 32), '${DOC}', '${DOC}', '2026-10-19 12:00:00+00');
CREATE TABLE private.agreement_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 agreement_id uuid NOT NULL UNIQUE,
 rental_id uuid NOT NULL,
 application_id uuid NOT NULL,
 vehicle_id uuid NOT NULL,
 document_id uuid NOT NULL,
 sha256 text NOT NULL,
 signed_at timestamptz NOT NULL,
 signer_user_id uuid NOT NULL,
 actor_id uuid NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp());
INSERT INTO private.agreement_evidence
 (agreement_id, rental_id, application_id, vehicle_id, document_id, sha256, signed_at, signer_user_id, actor_id)
 VALUES ('${AGREEMENT}', '${RENTAL}', '${APP}', '${NEW}', '${DOC}', repeat('ab', 32), '2026-10-19 12:00:00+00', '${DRIVER}', '${ACTOR}');
INSERT INTO public.payments (rental_id, amount, status) VALUES ('${RENTAL}', 100, 'paid');
INSERT INTO private.record_operations VALUES
 ('${RECORD}', '${ACTOR}', '${APP}', '{}'::jsonb, '${RENTAL}', 1, 1);
INSERT INTO public.booking_vehicle_assignments
 (id, rental_id, vehicle_id, assignment_start, pickup_mileage, assignment_kind, actor_id, operation_id)
 VALUES ('${ASSIGNMENT}', '${RENTAL}', '${OLD}', '2026-10-01 12:00:00+00', 10000, 'original', '${ACTOR}', '${RECORD}');
`;

const call = (op, expected, agreement = AGREEMENT) => `public.swap_rental_vehicle_tx(
 '${op}', '${RENTAL}', '${expected}', '${NEW}',
 '2026-10-20 15:00:00+00', 12000, 8000, 'Damage from the road', '${agreement}')`;

function transactionTests(dir) {
  psql(dir, fixture);
  psql(dir, fs.readFileSync(path.join(root, "proposed/vehicle-swap-v1.sql"), "utf8"));
  test("direct projection without the swap context is refused", () => {
    psql(dir, `
      DO $$ BEGIN
        PERFORM private.swap_project_vehicle_v1(
          '${OP}', '${RENTAL}', '${OLD}', '${NEW}', '2026-10-20 15:00:00+00',
          12000, 8000, '${ACTOR}', '${DRIVER}', 1, 'Damage from the road');
        RAISE EXCEPTION 'projection was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%swap_projection_context_required%' THEN RAISE; END IF;
      END $$;
    `);
  });
  test("stale expected assignment is rejected and writes nothing", () => {
    psql(dir, `
      DO $$ BEGIN
        PERFORM ${call(OP, STALE)};
        RAISE EXCEPTION 'stale assignment was accepted';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%stale_assignment%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        IF (SELECT vehicle_id FROM public.rentals WHERE id='${RENTAL}') <> '${OLD}' THEN
          RAISE EXCEPTION 'rental pointer moved';
        END IF;
        IF (SELECT status FROM public.vehicles WHERE id='${OLD}') <> 'rented' THEN
          RAISE EXCEPTION 'outgoing status changed';
        END IF;
        IF EXISTS (SELECT 1 FROM private.assignment_closures) THEN RAISE EXCEPTION 'closure written'; END IF;
        IF EXISTS (SELECT 1 FROM private.swap_operations) THEN RAISE EXCEPTION 'operation written'; END IF;
        IF (SELECT count(*) FROM public.payments) <> 1 THEN RAISE EXCEPTION 'payment count changed'; END IF;
      END $$;
    `);
  });
  test("a held rental lock fails nowait and rolls back", () => {
    const holder = `${"/usr/lib/postgresql/16/bin/psql"}`;
    const { spawn } = require("child_process");
    const child = spawn("psql", ["-h", dir, "-p", "55441", "-d", "swap", "-v", "ON_ERROR_STOP=1", "-X"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    child.stdin.write(`BEGIN; SELECT id FROM public.rentals WHERE id='${RENTAL}' FOR UPDATE; SELECT pg_sleep(20); COMMIT;\n`);
    const started = Date.now();
    let held = false;
    while (Date.now() - started < 5000) {
      const n = psql(dir, `SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
        WHERE c.relname='rentals' AND l.granted AND l.mode='RowShareLock'`).trim();
      if (n !== "0") { held = true; break; }
      execFileSync("sleep", ["0.05"]);
    }
    assert.equal(held, true);
    psql(dir, `
      DO $$ BEGIN
        PERFORM ${call(OP, ASSIGNMENT)};
        RAISE EXCEPTION 'locked swap succeeded';
      EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM NOT LIKE '%swap_contention_retry_whole_transaction%' THEN
          RAISE EXCEPTION 'unexpected lock error: %', SQLERRM;
        END IF;
      END $$;
    `);
    psql(dir, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query LIKE '%pg_sleep%'`);
    child.kill();
    psql(dir, `
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM private.swap_operations) THEN RAISE EXCEPTION 'contention wrote an operation'; END IF;
        IF (SELECT status FROM public.vehicles WHERE id='${OLD}') <> 'rented' THEN RAISE EXCEPTION 'contention changed status'; END IF;
      END $$;
    `);
  });
  test("an agreement without recorded evidence is refused", () => {
    psql(dir, `
      DO $$ BEGIN
        PERFORM ${call(OP, ASSIGNMENT, BARE)};
        RAISE EXCEPTION 'bare agreement was accepted';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%agreement_evidence_required%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        IF (SELECT vehicle_id FROM public.rentals WHERE id='${RENTAL}') <> '${OLD}' THEN
          RAISE EXCEPTION 'rental pointer moved';
        END IF;
        IF EXISTS (SELECT 1 FROM private.swap_operations) THEN RAISE EXCEPTION 'bare agreement wrote an operation'; END IF;
      END $$;
    `);
  });
  test("swap holds the outgoing car, keeps billing, and replays one number", () => {
    const out = psql(dir, `SELECT ${call(OP, ASSIGNMENT)}::text`).trim();
    const parsed = JSON.parse(out);
    assert.equal(parsed.contract, "vehicle-swap-v1");
    assert.equal(parsed.outgoingStatus, "maintenance");
    assert.equal(parsed.billing, "unchanged");
    assert.equal(parsed.recovered, false);
    assert.equal(parsed.swapNumber, 1);
    psql(dir, `
      DO $$ BEGIN
        IF (SELECT status FROM public.vehicles WHERE id='${OLD}') <> 'maintenance' THEN
          RAISE EXCEPTION 'outgoing car was not held';
        END IF;
        IF (SELECT status FROM public.vehicles WHERE id='${OLD}') = 'available' THEN
          RAISE EXCEPTION 'outgoing car became available';
        END IF;
        IF (SELECT status FROM public.vehicles WHERE id='${NEW}') <> 'rented' THEN
          RAISE EXCEPTION 'replacement was not marked rented';
        END IF;
        IF (SELECT vehicle_id FROM public.rentals WHERE id='${RENTAL}') <> '${NEW}' THEN
          RAISE EXCEPTION 'pointer did not move';
        END IF;
        IF (SELECT weekly_rate FROM public.rentals WHERE id='${RENTAL}') <> 350
         OR (SELECT stripe_subscription_id FROM public.rentals WHERE id='${RENTAL}') IS DISTINCT FROM 'sub_test'
         OR (SELECT autopay_active FROM public.rentals WHERE id='${RENTAL}') IS NOT TRUE
         OR (SELECT deposit_amount FROM public.rentals WHERE id='${RENTAL}') <> 500
        THEN RAISE EXCEPTION 'billing columns changed'; END IF;
        IF (SELECT count(*) FROM public.payments) <> 1
         OR (SELECT amount FROM public.payments) <> 100
        THEN RAISE EXCEPTION 'payments changed'; END IF;
        IF (SELECT count(*) FROM public.audit_log WHERE action='rental.vehicle_swapped') <> 1 THEN
          RAISE EXCEPTION 'audit was not one row';
        END IF;
        IF (SELECT count(*) FROM private.assignment_closures) <> 1 THEN RAISE EXCEPTION 'closure missing'; END IF;
        IF (SELECT assignment_kind FROM public.booking_vehicle_assignments WHERE id <> '${ASSIGNMENT}') <> 'replacement' THEN
          RAISE EXCEPTION 'replacement kind missing';
        END IF;
      END $$;
    `);
    const replay = JSON.parse(psql(dir, `SELECT ${call(OP, ASSIGNMENT)}::text`).trim());
    assert.equal(replay.recovered, true);
    assert.equal(replay.swapNumber, 1);
    psql(dir, `
      DO $$ BEGIN
        IF (SELECT count(*) FROM private.swap_operations) <> 1 THEN RAISE EXCEPTION 'replay stored a second operation'; END IF;
        IF (SELECT count(*) FROM public.audit_log WHERE action='rental.vehicle_swapped') <> 1 THEN
          RAISE EXCEPTION 'replay wrote a second audit';
        END IF;
        IF (SELECT last_value FROM private.swap_number_seq) <> 1 THEN RAISE EXCEPTION 'replay took a new number'; END IF;
        UPDATE private.swap_operations SET swap_number = swap_number;
        RAISE EXCEPTION 'history update was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%record_history_immutable%' THEN RAISE; END IF;
      END $$;
    `);
  });
  test("assignment history reads both intervals and refuses an anonymous caller", () => {
    psql(dir, `
      DO $$ BEGIN
        PERFORM public.list_assignment_history_v1('${RENTAL}', NULL);
        RAISE EXCEPTION 'anonymous history was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%staff_required%' THEN RAISE; END IF;
      END $$;
    `);
    const rows = JSON.parse(psql(dir, `
      CREATE TEMP TABLE hist_rental (doc jsonb);
      DO $$ BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${ACTOR}', true);
        INSERT INTO hist_rental SELECT public.list_assignment_history_v1('${RENTAL}', NULL);
      END $$;
      SELECT doc::text FROM hist_rental;
    `).trim());
    assert.equal(rows.length, 2);
    assert.equal(rows[0].status, "closed");
    assert.equal(rows[1].status, "open");
    assert.equal(rows[1].swapNumber, 1);
    assert.equal(rows[1].vehicle, "18 2021 Toyota Camry");
    const byVehicle = JSON.parse(psql(dir, `
      CREATE TEMP TABLE hist_vehicle (doc jsonb);
      DO $$ BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${ACTOR}', true);
        INSERT INTO hist_vehicle SELECT public.list_assignment_history_v1(NULL, '${OLD}');
      END $$;
      SELECT doc::text FROM hist_vehicle;
    `).trim());
    assert.equal(byVehicle.length, 1);
    assert.equal(byVehicle[0].status, "closed");
  });
}

// The sync test() helper above cannot await. Run the async cases explicitly.
(async () => {
  const boxOff = loadServer(false);
  await assert.rejects(boxOff.api.swapRentalVehicle({ data: swapData, context: boxOff.context }), /disabled pending installation/);
  assert.equal(boxOff.calls.length, 0);
  results.push("flag off throws before the rpc");
  console.log("PASS flag off throws before the rpc");

  boxOff.setResponse({ data: null, error: { code: "PGRST202", message: "Could not find the function public.list_assignment_history_v1" } });
  const missing = await boxOff.api.listAssignmentHistory({ data: { rentalId: id(2) }, context: boxOff.context });
  assert.equal(missing.ready, false);
  assert.equal(missing.entries.length, 0);
  assert.equal(boxOff.calls[0][0], "list_assignment_history_v1");
  assert.equal(boxOff.calls.some((c) => c[0] === "swap_rental_vehicle_tx"), false);
  results.push("missing history function degrades");
  console.log("PASS missing history function degrades");

  const boxOn = loadServer(true);
  const payload = {
    contract: "vehicle-swap-v1",
    rentalId: swapData.rentalId,
    operationId: swapData.operationId,
    closedAssignmentId: id(3),
    replacementAssignmentId: id(6),
    swapNumber: 1,
    outgoingStatus: "maintenance",
    billing: "unchanged",
    recovered: false,
  };
  boxOn.setResponse({ data: payload, error: null });
  const saved = await boxOn.api.swapRentalVehicle({ data: swapData, context: boxOn.context });
  assert.equal(saved.swapNumber, 1);
  assert.equal(boxOn.calls[0][0], "swap_rental_vehicle_tx");
  assert.equal("_actor" in boxOn.calls[0][1], false);
  boxOn.setResponse({ data: { ...payload, billing: "charged" }, error: null });
  await assert.rejects(boxOn.api.swapRentalVehicle({ data: swapData, context: boxOn.context }));
  results.push("flag on names the swap rpc");
  console.log("PASS flag on names the swap rpc");

  const dir = startDatabase();
  try {
    transactionTests(dir);
  } finally {
    stopDatabase(dir);
  }
  console.log(JSON.stringify({ pass: results.length, fail: 0 }));
})().catch((error) => {
  console.error(error);
  try { stopDatabase("/tmp/vehicle-swap-pg"); } catch { /* already stopped */ }
  process.exit(1);
});
