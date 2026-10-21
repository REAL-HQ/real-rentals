const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const { execFileSync, spawn } = require("child_process");
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

const lib = fs.readFileSync(path.join(root, "src/lib/extend-rental.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "src/components/admin/ExtendRental.tsx"), "utf8");
const server = fs.readFileSync(path.join(root, "src/lib/extend-rental.functions.ts"), "utf8");
const sql = fs.readFileSync(path.join(root, "proposed/extend-rental-v1.sql"), "utf8");
const booking = fs.readFileSync(path.join(root, "src/components/admin/BookingDetails.tsx"), "utf8");
const actions = fs.readFileSync(path.join(root, "src/components/admin/BookingActions.tsx"), "utf8");
const rentalsFn = fs.readFileSync(path.join(root, "src/lib/rentals.functions.ts"), "utf8");

function sliceExport(source, name) {
  const start = source.indexOf(`export const ${name}`);
  const next = source.indexOf("\nexport const ", start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test("shipped extend flag is off", () => {
  assert.match(lib, /export const EXTEND_RENTAL_ENABLED = false;/);
});

test("button and dialog stay unmounted while the flag is off", () => {
  const button = ui.indexOf("export function ExtendRentalButton");
  const state = ui.indexOf("useState(false)", button);
  const hidden = ui.indexOf("if (!EXTEND_RENTAL_ENABLED || phase !== \"active\" || !canManage) return null;");
  const gate = ui.indexOf("EXTEND_RENTAL_ENABLED && open");
  const dialog = ui.indexOf("<ExtendRentalDialog");
  const dialogFn = ui.indexOf("function ExtendRentalDialog");
  const hook = ui.indexOf("useServerFn(extendRental)");
  assert.ok(button !== -1 && button < state && state < hidden);
  assert.ok(gate !== -1 && gate < dialog && dialogFn < hook);
  assert.equal(ui.includes('.rpc('), false);
  assert.match(ui, /Extend Rental/);
  assert.match(ui, /New End Date/);
  assert.match(ui, /Extra Weeks/);
  assert.match(ui, /Extension Cost/);
  assert.match(ui, /Next Billing Date/);
  assert.match(ui, /Reason/);
  assert.match(ui, /Eastern Time/);
  assert.match(ui, /Stripe is not called\. Proration is none\./);
  assert.match(booking, /<ExtendRentalButton/);
  assert.ok(booking.indexOf("<BookingActions") < booking.indexOf("<ExtendRentalButton"));
  assert.equal(actions.includes("ExtendRental"), false);
  assert.equal(actions.includes("extend_rental"), false);
  assert.equal(rentalsFn.includes("extend_rental_tx"), false);
});

test("server throws on the flag before any read or rpc", () => {
  for (const name of ["loadExtendContext", "extendRental"]) {
    const body = sliceExport(server, name);
    const flag = body.indexOf("if (!EXTEND_RENTAL_ENABLED)");
    const io = Math.min(
      ...[".from(", '.rpc("extend_rental_tx"'].map((marker) => {
        const at = body.indexOf(marker);
        return at === -1 ? Number.MAX_SAFE_INTEGER : at;
      }),
    );
    const role = body.indexOf("requireManager");
    assert.ok(flag !== -1 && flag < role && role < io, name);
  }
  assert.match(server, /requireManager/);
  assert.equal(server.includes("stripe.subscriptions.update("), false);
  assert.doesNotMatch(server, /from ["']stripe["']/);
  assert.equal(server.includes("logAudit"), false);
  assert.equal(server.includes("app.rental_tx"), false);
});

test("proposed sql locks in order and does not call stripe", () => {
  const start = sql.indexOf("CREATE FUNCTION public.extend_rental_tx");
  const end = sql.indexOf("REVOKE ALL ON FUNCTION public.extend_rental_tx");
  const body = sql.slice(start, end);
  let at = -1;
  for (const marker of [
    "PERFORM private.approval_lock()",
    "pg_try_advisory_xact_lock(710026,2)",
    "FROM public.applications WHERE id=app_id FOR UPDATE NOWAIT",
    "FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT",
    "FROM public.user_roles WHERE user_id=actor AND role::text IN ('admin','team') FOR SHARE NOWAIT",
    "FROM private.extend_operations WHERE operation_id=_operation_id",
    "rental_not_active",
  ]) {
    const next = body.indexOf(marker, at + 1);
    assert.ok(next > at, marker);
    at = next;
  }
  assert.equal(body.includes("app.rental_tx"), false);
  assert.equal(body.includes("public.vehicles"), false);
  assert.equal(body.includes("public.payments"), false);
  assert.equal(body.includes("stripe.subscriptions.update("), false);
  assert.match(body, /'stripe\.subscriptions\.update'/);
  assert.match(body, /'performed',false/);
  assert.match(body, /'proration','none'/);
  assert.match(body, /SET end_date=_new_end/);
  assert.ok(body.indexOf("manager_required") < body.indexOf("PERFORM private.approval_lock()"));
  assert.equal(body.includes("private.approval_actor()"), false);
  assert.equal(body.includes("actor_after"), false);
  assert.match(body, /public\.booking_vehicle_assignments/);
  assert.equal(body.includes("subscriptionId"), false);
  assert.match(body, /'linked',r\.stripe_subscription_id IS NOT NULL/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.extend_rental_tx\(uuid,uuid,date,date,text,uuid\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.extend_rental_tx\(uuid,uuid,date,date,text,uuid\) TO service_role/);
  assert.equal(server.includes("subscriptionId"), false);
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/extend-rental-v1.sql")), false);
  assert.equal(sql.slice(sql.indexOf("CREATE TABLE")).includes("ALTER OWNER"), false);
});

function loadPreview() {
  const built = ts.transpileModule(lib, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const sandbox = { exports: {}, console };
  vm.runInNewContext(built.outputText, sandbox);
  return sandbox.exports;
}

const preview = loadPreview();

test("preview cost, weeks, and billing effect match the sql formula", () => {
  assert.equal(preview.EXTEND_RENTAL_ENABLED, false);
  const row = preview.extensionPreview({
    currentEnd: "2026-10-25",
    newEnd: "2026-11-08",
    weeklyRate: 350,
    nextPaymentDue: "2026-10-20",
    today: "2026-10-21",
  });
  assert.equal(row.ok, true);
  assert.equal(row.extraDays, 14);
  assert.equal(row.extraWeeksLabel, "2 weeks");
  assert.equal(row.extensionCost, 700);
  assert.equal(row.effect, "next_charge_unchanged");
  assert.equal(JSON.stringify(row.includedCharges), JSON.stringify(["2026-10-27", "2026-11-03"]));
  assert.equal(preview.formatExtraWeeks(10), "1 week 3 days");
  assert.equal(preview.formatExtraWeeks(8), "1 week 1 day");
  assert.equal(preview.formatExtraWeeks(7), "1 week");
  assert.equal(preview.formatExtraWeeks(1), "1 day");
  assert.equal(preview.extensionCost(100, 1), 14.29);
  const open = preview.extensionPreview({
    currentEnd: null,
    newEnd: "2026-11-08",
    weeklyRate: 350,
    nextPaymentDue: null,
    today: "2026-10-21",
  });
  assert.equal(open.ok, false);
  const todayEnd = preview.extensionPreview({
    currentEnd: "2026-10-20",
    newEnd: "2026-10-21",
    weeklyRate: 350,
    nextPaymentDue: null,
    today: "2026-10-21",
  });
  assert.equal(todayEnd.ok, false);
  assert.equal(todayEnd.error, "The new end date must be after today, Eastern Time.");
});

function loadServer(extendEnabled) {
  const built = ts.transpileModule(server, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  assert.equal((built.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const outputText = built.outputText.replace(
    /await import\((["']@\/integrations\/supabase\/client\.server["'])\)/g,
    "require($1)",
  );
  const calls = [];
  let response = { data: null, error: null };
  let rentalRow = null;
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
      if (name === "@/lib/roles.server") return { requireManager: async () => ({ tier: "manager" }) };
      if (name === "@/lib/extend-rental") {
        return { EXTEND_RENTAL_ENABLED: extendEnabled, BILLING_EFFECTS: preview.BILLING_EFFECTS };
      }
      if (name === "@/integrations/supabase/client.server") {
        return {
          supabaseAdmin: {
            rpc: async (...args) => {
              calls.push(["rpc", ...args]);
              return response;
            },
          },
        };
      }
      throw new Error("Unexpected dependency: " + name);
    },
  };
  vm.runInNewContext(outputText, sandbox);
  return {
    calls,
    api: sandbox.exports,
    setResponse(next) { response = next; },
    setRental(next) { rentalRow = next; },
    context: {
      userId: "11111111-1111-4111-8111-111111111111",
      supabase: {
        rpc: async (...args) => {
          calls.push(["rpc", ...args]);
          return response;
        },
        from(table) {
          calls.push(["from", table]);
          return {
            select() {
              return {
                eq() {
                  return { maybeSingle: async () => ({ data: rentalRow, error: null }) };
                },
              };
            },
          };
        },
      },
    },
  };
}

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const extendData = {
  operationId: id(1),
  rentalId: id(2),
  expectedEnd: "2026-10-25",
  newEnd: "2026-11-08",
  reason: "  Driver asked to keep the car  ",
};

function plan(overrides = {}) {
  return {
    contract: "extend-rental-v1",
    rentalId: extendData.rentalId,
    operationId: extendData.operationId,
    previousEnd: "2026-10-25",
    newEnd: "2026-11-08",
    extraDays: 14,
    extraWeeks: 2,
    weeklyRate: 350,
    extensionCost: 700,
    billingPlan: {
      effect: "next_charge_unchanged",
      nextPaymentDue: "2026-10-20",
      includedCharges: ["2026-10-27", "2026-11-03"],
      cancelAt: "2026-11-09T04:59:59+00:00",
      proration: "none",
      stripe: {
        performed: false,
        linked: true,
        call: "stripe.subscriptions.update",
        params: { cancel_at: 1794000000, proration_behavior: "none" },
      },
    },
    recovered: false,
    ...overrides,
  };
}

const PORT = "55443";
const DB = "extendrental";

function psql(dir, sqlText) {
  return execFileSync(
    "psql",
    ["-h", dir, "-p", PORT, "-d", DB, "-v", "ON_ERROR_STOP=1", "-X", "-q", "-tA"],
    { input: sqlText, encoding: "utf8" },
  );
}

function pgTool(name) {
  if (process.env.PG_BIN) return path.join(process.env.PG_BIN, name);
  const initdb = execFileSync("bash", ["-lc", "command -v initdb"], { encoding: "utf8" }).trim();
  if (!initdb) throw new Error("initdb not on PATH; set PG_BIN");
  return path.join(path.dirname(initdb), name);
}

function startDatabase() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "extend-rental-pg-"));
  try {
    execFileSync(pgTool("initdb"), ["-D", dir, "--username", process.env.USER || "ubuntu", "--auth=trust", "--no-sync"], { stdio: "ignore" });
    execFileSync(pgTool("pg_ctl"), ["-D", dir, "-l", path.join(dir, "log"), "-o", `-p ${PORT} -k ${dir} -c listen_addresses=`, "start"], { stdio: "ignore" });
    execFileSync(pgTool("createdb"), ["-h", dir, "-p", PORT, DB], { stdio: "ignore" });
  } catch (error) {
    stopDatabase(dir);
    throw error;
  }
  return dir;
}

function stopDatabase(dir) {
  if (!dir) return;
  try {
    execFileSync(pgTool("pg_ctl"), ["-D", dir, "-m", "immediate", "stop"], { stdio: "ignore" });
  } catch { /* already stopped */ }
  fs.rmSync(dir, { recursive: true, force: true });
}

const ACTOR = "11111111-1111-4111-8111-111111111111";
const APP = "22222222-2222-4222-8222-222222222222";
const DRIVER = "33333333-3333-4333-8333-333333333333";
const VEHICLE = "44444444-4444-4444-8444-444444444444";
const RENTAL = "66666666-6666-4666-8666-666666666666";
const OP = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const APP_BARE = "12121212-1212-4121-8121-121212121212";
const APP_LATER = "13131313-1313-4131-8131-131313131313";
const APP_DELETED = "14141414-1414-4141-8141-141414141414";
const RENTAL_LATER = "15151515-1515-4151-8151-151515151515";
const DRIVER_LATER = "16161616-1616-4161-8161-161616161616";
const CONFLICT = "17171717-1717-4171-8171-171717171717";
const CONFLICT_DRIVER = "18181818-1818-4181-8181-181818181818";
const WAIT = "19191919-1919-4191-8191-191919191919";
const HOLD_APP = "1a1a1a1a-1a1a-41a1-81a1-1a1a1a1a1a1a";
const SAME_DAY = "1b1b1b1b-1b1b-41b1-81b1-1b1b1b1b1b1b";
const RENTAL_OPEN = "1c1c1c1c-1c1c-41c1-81c1-1c1c1c1c1c1c";
const VEHICLE_OPEN = "1d1d1d1d-1d1d-41d1-81d1-1d1d1d1d1d1d";
const DRIVER_OPEN = "1e1e1e1e-1e1e-41e1-81e1-1e1e1e1e1e1e";
const APP_OPEN = "1f1f1f1f-1f1f-41f1-81f1-1f1f1f1f1f1f";
const RENTAL_PAST = "20202020-2020-4020-8020-202020202020";
const VEHICLE_PAST = "21212121-2121-4121-8121-212121212121";
const DRIVER_PAST = "23232323-2323-4232-8232-232323232323";
const APP_PAST = "24242424-2424-4242-8242-242424242424";
const RENTAL_NOSUB = "25252525-2525-4252-8252-252525252525";
const VEHICLE_NOSUB = "26262626-2626-4262-8262-262626262626";
const DRIVER_NOSUB = "27272727-2727-4272-8272-272727272727";
const APP_NOSUB = "28282828-2828-4282-8282-282828282828";
const OP_NOSUB = "29292929-2929-4292-8292-292929292929";

const fixture = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION private.record_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'record_history_immutable' USING ERRCODE='42501'; END $$;
CREATE FUNCTION private.approval_lock() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;
-- Real M2 packet functions from cf71e104 proposed/m2-packet/01.sql.
-- approval_actor calls approval_provider_actor, which refuses service_role.
CREATE ROLE rr_approval_executor NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE FUNCTION private.approval_provider_actor() RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE claims jsonb; actor uuid; sid uuid; gateway boolean; issuer boolean;
BEGIN
 gateway := session_user='authenticator' AND current_setting('role',true)='authenticated';
 issuer := session_user='rr_evidence_transport' AND current_setting('role',true) IN ('rr_evidence_issuer','rr_approval_executor');
 IF NOT gateway AND NOT issuer THEN RAISE EXCEPTION 'trusted_authentication_context_required' USING ERRCODE='42501'; END IF;
 IF issuer AND NOT pg_has_role(session_user,current_setting('role',true),'MEMBER') THEN RAISE EXCEPTION 'trusted_authentication_context_required' USING ERRCODE='42501'; END IF;
 BEGIN
  claims:=nullif(current_setting('request.jwt.claims',true),'')::jsonb;
  actor:=(claims->>'sub')::uuid; sid:=(claims->>'session_id')::uuid;
 EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'authenticated_session_required' USING ERRCODE='42501'; END;
 IF actor IS NULL OR sid IS NULL OR claims->>'role' IS DISTINCT FROM 'authenticated' THEN RAISE EXCEPTION 'authenticated_session_required' USING ERRCODE='42501'; END IF;
 IF gateway THEN
  IF jsonb_typeof(claims->'exp') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'authenticated_session_required' USING ERRCODE='42501'; END IF;
  IF (claims->>'exp')::numeric<=extract(epoch FROM clock_timestamp()) THEN RAISE EXCEPTION 'session_expired' USING ERRCODE='42501'; END IF;
 END IF;
 PERFORM 1 FROM auth.sessions WHERE id=sid AND user_id=actor
  AND (not_after IS NULL OR not_after>clock_timestamp()) FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'session_unavailable' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team') FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'manager_required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION private.approval_provider_actor() FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION private.approval_provider_actor() TO rr_approval_executor;
CREATE FUNCTION private.approval_actor() RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path='' SET lock_timeout='500ms' AS $$
DECLARE actor uuid;
BEGIN
 actor:=private.approval_provider_actor();
 IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team')) THEN
 RAISE EXCEPTION 'approval_manager_required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
REVOKE ALL ON FUNCTION private.approval_actor() FROM PUBLIC,anon,authenticated,service_role;

CREATE TABLE public.vehicles (id uuid PRIMARY KEY, status text);
CREATE TABLE public.applications (
 id uuid PRIMARY KEY, user_id uuid, status text, vehicle_id uuid, deleted_at timestamptz,
 pickup_date date, start_date date, waitlist_signed_up_at timestamptz);
CREATE TABLE public.application_waitlist_holds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid, removed_at timestamptz);
CREATE TABLE public.rentals (
 id uuid PRIMARY KEY, application_id uuid REFERENCES public.applications(id),
 vehicle_id uuid REFERENCES public.vehicles(id), driver_id uuid, status text,
 start_date date, end_date date, weekly_rate numeric, stripe_subscription_id text,
 autopay_active boolean, deposit_amount numeric, next_payment_due date, stripe_customer_id text);
CREATE UNIQUE INDEX rentals_one_active_per_vehicle_idx ON public.rentals (vehicle_id) WHERE status = 'active';
CREATE UNIQUE INDEX rentals_one_active_per_driver_idx ON public.rentals (driver_id) WHERE status = 'active';
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text NOT NULL, actor_role text,
 actor_user_id uuid, entity_id text, entity_type text, metadata jsonb, summary text NOT NULL);
CREATE TABLE public.payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid, amount numeric, status text);

INSERT INTO public.vehicles VALUES
 ('${VEHICLE}', 'rented'), ('${VEHICLE_OPEN}', 'available'),
 ('${VEHICLE_PAST}', 'rented'), ('${VEHICLE_NOSUB}', 'rented');
INSERT INTO public.applications
 (id, user_id, status, vehicle_id, deleted_at, pickup_date, start_date, waitlist_signed_up_at) VALUES
 ('${APP}', '${DRIVER}', 'active', '${VEHICLE}', NULL, DATE '2026-10-28', NULL, NULL),
 ('${APP_BARE}', NULL, 'approved', '${VEHICLE}', NULL, NULL, NULL, NULL),
 ('${APP_LATER}', NULL, 'approved', '${VEHICLE}', NULL, DATE '2026-11-20', NULL, NULL),
 ('${APP_DELETED}', NULL, 'approved', '${VEHICLE}', now(), DATE '2026-10-28', NULL, NULL),
 ('${APP_OPEN}', '${DRIVER_OPEN}', 'active', '${VEHICLE_OPEN}', NULL, NULL, NULL, NULL),
 ('${APP_PAST}', '${DRIVER_PAST}', 'active', '${VEHICLE_PAST}', NULL, NULL, NULL, NULL),
 ('${APP_NOSUB}', '${DRIVER_NOSUB}', 'active', '${VEHICLE_NOSUB}', NULL, NULL, NULL, NULL);
INSERT INTO public.rentals
 (id, application_id, vehicle_id, driver_id, status, start_date, end_date, weekly_rate,
  stripe_subscription_id, autopay_active, deposit_amount, next_payment_due, stripe_customer_id) VALUES
 ('${RENTAL}', '${APP}', '${VEHICLE}', '${DRIVER}', 'active', DATE '2026-10-01', DATE '2026-10-25', 350,
  'sub_test', true, 500, DATE '2026-10-20', 'cus_test'),
 ('${RENTAL_LATER}', NULL, '${VEHICLE}', '${DRIVER_LATER}', 'reserved', DATE '2026-11-09', DATE '2026-11-20', 100,
  NULL, false, 0, NULL, NULL),
 ('${RENTAL_OPEN}', '${APP_OPEN}', '${VEHICLE_OPEN}', '${DRIVER_OPEN}', 'active', DATE '2026-10-01', NULL, 350,
  NULL, false, 0, NULL, NULL),
 ('${RENTAL_PAST}', '${APP_PAST}', '${VEHICLE_PAST}', '${DRIVER_PAST}', 'active', DATE '2026-09-01', DATE '2026-10-01', 350,
  NULL, false, 0, NULL, NULL),
 ('${RENTAL_NOSUB}', '${APP_NOSUB}', '${VEHICLE_NOSUB}', '${DRIVER_NOSUB}', 'active', DATE '2026-10-01', DATE '2026-10-25', 350,
  NULL, false, 0, DATE '2026-10-28', NULL);
INSERT INTO public.user_roles VALUES ('${ACTOR}', 'admin');
INSERT INTO public.payments (rental_id, amount, status) VALUES ('${RENTAL}', 100, 'paid');
CREATE TABLE public.booking_vehicle_assignments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 rental_id uuid,
 vehicle_id uuid,
 assignment_start timestamptz NOT NULL);
CREATE TABLE private.assignment_closures (
 assignment_id uuid PRIMARY KEY,
 assignment_end timestamptz NOT NULL);

CREATE FUNCTION public.guard_rental_lifecycle() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
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
END $$;
CREATE TRIGGER guard_rental_lifecycle BEFORE INSERT OR UPDATE OR DELETE ON public.rentals
 FOR EACH ROW EXECUTE FUNCTION public.guard_rental_lifecycle();
`;

function call(op, rental, expected, next) {
  return `public.extend_rental_tx('${op}', '${rental}', DATE '${expected}', DATE '${next}', 'Driver asked to keep the car', '${ACTOR}')`;
}

function easternToday() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function expectError(dir, statement, code) {
  psql(dir, `
    DO $$ BEGIN
      ${statement}
      RAISE EXCEPTION 'accepted unexpectedly';
    EXCEPTION WHEN OTHERS THEN
      IF SQLERRM NOT LIKE '%${code}%' THEN RAISE EXCEPTION 'unexpected error: %', SQLERRM; END IF;
    END $$;
  `);
}

function unchanged(dir) {
  psql(dir, `
    DO $$ BEGIN
      IF (SELECT end_date FROM public.rentals WHERE id='${RENTAL}') <> DATE '2026-10-25' THEN
        RAISE EXCEPTION 'end date moved';
      END IF;
      IF EXISTS (SELECT 1 FROM private.extend_operations) THEN RAISE EXCEPTION 'operation written'; END IF;
      IF EXISTS (SELECT 1 FROM public.audit_log) THEN RAISE EXCEPTION 'audit written'; END IF;
      IF (SELECT count(*) FROM public.payments) <> 1 OR (SELECT amount FROM public.payments) <> 100 THEN
        RAISE EXCEPTION 'payments changed';
      END IF;
      IF (SELECT status FROM public.vehicles WHERE id='${VEHICLE}') <> 'rented' THEN
        RAISE EXCEPTION 'vehicle status changed';
      END IF;
    END $$;
  `);
}

function transactionTests(dir) {
  psql(dir, fixture);
  psql(dir, fs.readFileSync(path.join(root, "proposed/extend-rental-v1.sql"), "utf8"));
  psql(dir, `
    DO $$ BEGIN
      IF round(100::numeric * 1 / 7, 2) <> 14.29 THEN RAISE EXCEPTION 'cost formula drifted'; END IF;
      IF has_function_privilege('service_role', 'public.extend_rental_tx(uuid,uuid,date,date,text,uuid)', 'EXECUTE') IS NOT TRUE THEN
        RAISE EXCEPTION 'service role cannot execute';
      END IF;
      IF has_function_privilege('authenticated', 'public.extend_rental_tx(uuid,uuid,date,date,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'authenticated can execute';
      END IF;
      IF has_function_privilege('anon', 'public.extend_rental_tx(uuid,uuid,date,date,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'anon can execute';
      END IF;
      IF has_function_privilege('public', 'public.extend_rental_tx(uuid,uuid,date,date,text,uuid)', 'EXECUTE') THEN
        RAISE EXCEPTION 'public can execute';
      END IF;
      IF position('app.rental_tx' IN (SELECT prosrc FROM pg_proc WHERE proname='extend_rental_tx')) > 0 THEN
        RAISE EXCEPTION 'function sets the lifecycle bypass';
      END IF;
      IF position('approval_actor' IN (SELECT prosrc FROM pg_proc WHERE proname='extend_rental_tx')) > 0 THEN
        RAISE EXCEPTION 'extend still calls approval_actor';
      END IF;
    END $$;
  `);

  test("the real approval_actor refuses service_role, and extend does not call it", () => {
    expectError(dir, "PERFORM private.approval_actor();", "trusted_authentication_context_required");
    psql(dir, `
      BEGIN;
      SET LOCAL ROLE service_role;
      SELECT ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};
      ROLLBACK;
    `);
    unchanged(dir);
  });

  test("a manager role is required and a stale end writes nothing", () => {
    psql(dir, `DELETE FROM public.user_roles WHERE user_id='${ACTOR}'`);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "manager_required");
    psql(dir, `INSERT INTO public.user_roles VALUES ('${ACTOR}', 'admin')`);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-24", "2026-11-08")};`, "stale_end");
    unchanged(dir);
  });

  test("the next booking and an inclusive same-day start conflict", () => {
    psql(dir, `
      INSERT INTO public.rentals
       (id, application_id, vehicle_id, driver_id, status, start_date, end_date, weekly_rate, autopay_active, deposit_amount)
      VALUES
       ('${CONFLICT}', NULL, '${VEHICLE}', '${CONFLICT_DRIVER}', 'reserved', DATE '2026-10-28', DATE '2026-11-01', 100, false, 0);
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "vehicle_conflict_booking");
    psql(dir, `DELETE FROM public.rentals WHERE id='${CONFLICT}'`);
    psql(dir, `
      INSERT INTO public.rentals
       (id, application_id, vehicle_id, driver_id, status, start_date, end_date, weekly_rate, autopay_active, deposit_amount)
      VALUES
       ('${SAME_DAY}', NULL, '${VEHICLE}', '${CONFLICT_DRIVER}', 'pending', DATE '2026-11-08', DATE '2026-11-15', 100, false, 0);
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "vehicle_conflict_booking");
    psql(dir, `DELETE FROM public.rentals WHERE id='${SAME_DAY}'`);
    unchanged(dir);
  });

  test("an assignment on the vehicle conflicts, and this rental's own assignment does not", () => {
    psql(dir, `
      INSERT INTO public.booking_vehicle_assignments (rental_id, vehicle_id, assignment_start)
      VALUES ('${CONFLICT}', '${VEHICLE}', '2026-10-20 16:00:00+00');
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "vehicle_conflict_booking");
    psql(dir, `DELETE FROM public.booking_vehicle_assignments`);
    psql(dir, `
      INSERT INTO public.booking_vehicle_assignments (id, rental_id, vehicle_id, assignment_start)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${CONFLICT}', '${VEHICLE}', '2026-10-01 16:00:00+00');
      INSERT INTO private.assignment_closures (assignment_id, assignment_end)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-28 16:00:00+00');
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "vehicle_conflict_booking");
    psql(dir, `DELETE FROM private.assignment_closures; DELETE FROM public.booking_vehicle_assignments;`);
    psql(dir, `
      INSERT INTO public.booking_vehicle_assignments (id, rental_id, vehicle_id, assignment_start)
      VALUES
       ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbc', '${RENTAL}', '${VEHICLE}', '2026-10-01 16:00:00+00'),
       ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '${CONFLICT}', '${VEHICLE}', '2026-10-01 16:00:00+00');
      INSERT INTO private.assignment_closures (assignment_id, assignment_end)
      VALUES ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '2026-10-25 20:00:00-04');
    `);
    psql(dir, `BEGIN; SELECT ${call(OP, RENTAL, "2026-10-25", "2026-11-08")}; ROLLBACK;`);
    psql(dir, `DELETE FROM private.assignment_closures; DELETE FROM public.booking_vehicle_assignments;`);
    unchanged(dir);
  });

  test("a waitlist date, a dateless hold, and a dateless signup conflict", () => {
    psql(dir, `
      INSERT INTO public.applications
       (id, status, vehicle_id, pickup_date) VALUES ('${WAIT}', 'approved', '${VEHICLE}', DATE '2026-11-01');
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "vehicle_conflict_waitlist");
    psql(dir, `DELETE FROM public.applications WHERE id='${WAIT}'`);
    psql(dir, `
      INSERT INTO public.applications (id, status, vehicle_id) VALUES ('${HOLD_APP}', 'approved', '${VEHICLE}');
      INSERT INTO public.application_waitlist_holds (application_id) VALUES ('${HOLD_APP}');
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "vehicle_conflict_waitlist");
    psql(dir, `
      DELETE FROM public.application_waitlist_holds WHERE application_id='${HOLD_APP}';
      UPDATE public.applications SET waitlist_signed_up_at=now() WHERE id='${HOLD_APP}';
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "vehicle_conflict_waitlist");
    psql(dir, `DELETE FROM public.applications WHERE id='${HOLD_APP}'`);
    unchanged(dir);
  });

  test("a held rental lock fails nowait and rolls back", () => {
    const child = spawn("psql", ["-h", dir, "-p", PORT, "-d", DB, "-v", "ON_ERROR_STOP=1", "-X"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    child.stdin.write(`BEGIN; SELECT id FROM public.rentals WHERE id='${RENTAL}' FOR UPDATE; SELECT pg_sleep(30); COMMIT;\n`);
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
        PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};
        RAISE EXCEPTION 'locked extend succeeded';
      EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM NOT LIKE '%extend_contention_retry_whole_transaction%' THEN
          RAISE EXCEPTION 'unexpected lock error: %', SQLERRM;
        END IF;
      END $$;
    `);
    psql(dir, `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query LIKE '%pg_sleep%'`);
    child.kill();
    unchanged(dir);
  });

  test("extend updates only the end date, logs one plan, and replays", () => {
    const out = psql(dir, `SELECT ${call(OP, RENTAL, "2026-10-25", "2026-11-08")}::text`).trim();
    const parsed = JSON.parse(out);
    const cancelAt = Number(psql(dir, `SELECT floor(extract(epoch FROM (('2026-11-09'::timestamp AT TIME ZONE 'America/New_York') - interval '1 second')))`).trim());
    assert.equal(parsed.contract, "extend-rental-v1");
    assert.equal(parsed.recovered, false);
    assert.equal(parsed.previousEnd, "2026-10-25");
    assert.equal(parsed.newEnd, "2026-11-08");
    assert.equal(parsed.extraDays, 14);
    assert.equal(Number(parsed.extraWeeks), 2);
    assert.equal(Number(parsed.weeklyRate), 350);
    assert.equal(Number(parsed.extensionCost), 700);
    assert.equal(parsed.billingPlan.effect, "next_charge_unchanged");
    assert.equal(parsed.billingPlan.proration, "none");
    assert.deepEqual(parsed.billingPlan.includedCharges, ["2026-10-27", "2026-11-03"]);
    assert.equal(parsed.billingPlan.stripe.performed, false);
    assert.equal(parsed.billingPlan.stripe.linked, true);
    assert.equal(Object.hasOwn(parsed.billingPlan.stripe, "subscriptionId"), false);
    assert.equal(JSON.stringify(parsed).includes("sub_"), false);
    assert.equal(parsed.billingPlan.stripe.call, "stripe.subscriptions.update");
    assert.equal(parsed.billingPlan.stripe.params.proration_behavior, "none");
    assert.equal(parsed.billingPlan.stripe.params.cancel_at, cancelAt);
    psql(dir, `
      DO $$ BEGIN
        IF (SELECT end_date FROM public.rentals WHERE id='${RENTAL}') <> DATE '2026-11-08' THEN
          RAISE EXCEPTION 'end date was not extended';
        END IF;
        IF (SELECT weekly_rate FROM public.rentals WHERE id='${RENTAL}') <> 350
         OR (SELECT stripe_subscription_id FROM public.rentals WHERE id='${RENTAL}') IS DISTINCT FROM 'sub_test'
         OR (SELECT stripe_customer_id FROM public.rentals WHERE id='${RENTAL}') IS DISTINCT FROM 'cus_test'
         OR (SELECT autopay_active FROM public.rentals WHERE id='${RENTAL}') IS NOT TRUE
         OR (SELECT next_payment_due FROM public.rentals WHERE id='${RENTAL}') <> DATE '2026-10-20'
         OR (SELECT deposit_amount FROM public.rentals WHERE id='${RENTAL}') <> 500
         OR (SELECT status FROM public.rentals WHERE id='${RENTAL}') <> 'active'
         OR (SELECT vehicle_id FROM public.rentals WHERE id='${RENTAL}') <> '${VEHICLE}'
        THEN RAISE EXCEPTION 'a column other than end_date changed'; END IF;
        IF (SELECT status FROM public.vehicles WHERE id='${VEHICLE}') <> 'rented' THEN
          RAISE EXCEPTION 'vehicle status changed';
        END IF;
        IF (SELECT count(*) FROM public.payments) <> 1 OR (SELECT amount FROM public.payments) <> 100 THEN
          RAISE EXCEPTION 'payments changed';
        END IF;
        IF position('sub_' IN (SELECT metadata::text FROM public.audit_log WHERE action='rental.extended')) > 0 THEN
          RAISE EXCEPTION 'audit stored a subscription id';
        END IF;
        IF position('sub_' IN (SELECT result::text FROM private.extend_operations)) > 0 THEN
          RAISE EXCEPTION 'result stored a subscription id';
        END IF;
        IF (SELECT result->'billingPlan'->'stripe'->>'linked' FROM private.extend_operations) IS DISTINCT FROM 'true' THEN
          RAISE EXCEPTION 'subscription link boolean missing';
        END IF;
        IF (SELECT count(*) FROM public.audit_log WHERE action='rental.extended') <> 1 THEN
          RAISE EXCEPTION 'audit was not one row';
        END IF;
        IF (SELECT count(*) FROM private.extend_operations) <> 1 THEN RAISE EXCEPTION 'operation missing'; END IF;
      END $$;
    `);
    const replay = JSON.parse(psql(dir, `SELECT ${call(OP, RENTAL, "2026-10-25", "2026-11-08")}::text`).trim());
    assert.equal(replay.recovered, true);
    assert.equal(replay.newEnd, "2026-11-08");
    assert.equal(replay.billingPlan.stripe.performed, false);
    psql(dir, `
      DO $$ BEGIN
        IF (SELECT count(*) FROM private.extend_operations) <> 1 THEN RAISE EXCEPTION 'replay stored a second operation'; END IF;
        IF (SELECT count(*) FROM public.audit_log WHERE action='rental.extended') <> 1 THEN
          RAISE EXCEPTION 'replay wrote a second audit';
        END IF;
        IF (SELECT end_date FROM public.rentals WHERE id='${RENTAL}') <> DATE '2026-11-08' THEN
          RAISE EXCEPTION 'replay moved the end date';
        END IF;
        UPDATE private.extend_operations SET request = request;
        RAISE EXCEPTION 'history update was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%record_history_immutable%' THEN RAISE; END IF;
      END $$;
    `);
  });

  test("open-ended and past ends are rejected, and a rental with no subscription logs no stripe call", () => {
    expectError(dir, `PERFORM ${call(OP_NOSUB, RENTAL_OPEN, "2026-10-25", "2026-11-08")};`, "end_date_required");
    expectError(dir, `PERFORM ${call(OP_NOSUB, RENTAL_PAST, "2026-10-01", "2026-10-15")};`, "end_before_today");
    expectError(dir, `PERFORM ${call(OP_NOSUB, RENTAL_PAST, "2026-10-01", easternToday())};`, "end_before_today");
    const quiet = JSON.parse(psql(dir, `SELECT ${call(OP_NOSUB, RENTAL_NOSUB, "2026-10-25", "2026-11-01")}::text`).trim());
    assert.equal(quiet.billingPlan.stripe.performed, false);
    assert.equal(quiet.billingPlan.stripe.linked, false);
    assert.equal(JSON.stringify(quiet).includes("sub_"), false);
    assert.equal(quiet.billingPlan.stripe.call, null);
    assert.equal(quiet.billingPlan.stripe.params, null);
    assert.equal(quiet.billingPlan.proration, "none");
    assert.equal(quiet.billingPlan.effect, "next_charge_now_inside_term");
    assert.equal(Number(quiet.extensionCost), 350);
    psql(dir, `
      DO $$ BEGIN
        IF (SELECT end_date FROM public.rentals WHERE id='${RENTAL_OPEN}') IS NOT NULL THEN
          RAISE EXCEPTION 'open-ended rental was written';
        END IF;
        IF (SELECT end_date FROM public.rentals WHERE id='${RENTAL_PAST}') <> DATE '2026-10-01' THEN
          RAISE EXCEPTION 'past rental was written';
        END IF;
        IF (SELECT end_date FROM public.rentals WHERE id='${RENTAL}') <> DATE '2026-11-08' THEN
          RAISE EXCEPTION 'main rental moved again';
        END IF;
        IF (SELECT stripe_subscription_id FROM public.rentals WHERE id='${RENTAL_NOSUB}') IS NOT NULL THEN
          RAISE EXCEPTION 'a subscription id was invented';
        END IF;
        IF (SELECT count(*) FROM public.payments) <> 1 THEN RAISE EXCEPTION 'payments changed'; END IF;
        UPDATE public.rentals SET weekly_rate = 400 WHERE id='${RENTAL}';
      END $$;
    `);
    expectError(dir, `PERFORM ${call(OP, RENTAL, "2026-10-25", "2026-11-08")};`, "operation_conflict");
    psql(dir, `
      DO $$ BEGIN
        IF (SELECT count(*) FROM public.audit_log WHERE action='rental.extended' AND entity_id='${RENTAL}') <> 1 THEN
          RAISE EXCEPTION 'rate change wrote another audit';
        END IF;
        IF (SELECT end_date FROM public.rentals WHERE id='${RENTAL}') <> DATE '2026-11-08' THEN
          RAISE EXCEPTION 'rate change moved the end date';
        END IF;
        UPDATE public.rentals SET status='closed' WHERE id='${RENTAL}';
        RAISE EXCEPTION 'lifecycle guard allowed a status change';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%rental_lifecycle_guard%' THEN RAISE; END IF;
      END $$;
    `);
    const status = psql(dir, `SELECT status FROM public.rentals WHERE id='${RENTAL}'`).trim();
    assert.equal(status, "active");
  });
}

let dataDir;
(async () => {
  const boxOff = loadServer(false);
  await assert.rejects(
    boxOff.api.extendRental({ data: extendData, context: boxOff.context }),
    /disabled pending installation/,
  );
  await assert.rejects(
    boxOff.api.loadExtendContext({ data: { rentalId: id(2) }, context: boxOff.context }),
    /disabled pending installation/,
  );
  assert.equal(boxOff.calls.length, 0);
  results.push("flag off throws before the rpc");
  console.log("PASS flag off throws before the rpc");

  const boxOn = loadServer(true);
  boxOn.setResponse({ data: plan(), error: null });
  const saved = await boxOn.api.extendRental({ data: extendData, context: boxOn.context });
  assert.equal(saved.billingPlan.stripe.performed, false);
  assert.equal(saved.billingPlan.stripe.linked, true);
  assert.equal(JSON.stringify(saved).includes("sub_"), false);
  assert.equal(boxOn.calls.length, 1);
  assert.equal(boxOn.calls[0][0], "rpc");
  assert.equal(boxOn.calls[0][1], "extend_rental_tx");
  assert.equal(boxOn.calls[0][2]._reason, "Driver asked to keep the car");
  assert.equal(boxOn.calls[0][2]._actor_id, boxOn.context.userId);
  assert.equal(boxOn.calls.some((call) => call[0] === "from"), false);
  boxOn.setResponse({ data: plan({ billingPlan: { ...plan().billingPlan, stripe: { ...plan().billingPlan.stripe, performed: true } } }), error: null });
  await assert.rejects(boxOn.api.extendRental({ data: extendData, context: boxOn.context }));
  boxOn.setResponse({
    data: plan({ billingPlan: { ...plan().billingPlan, proration: "create_prorations" } }),
    error: null,
  });
  await assert.rejects(boxOn.api.extendRental({ data: extendData, context: boxOn.context }));
  const leaked = plan();
  leaked.billingPlan.stripe.subscriptionId = "sub_test";
  boxOn.setResponse({ data: leaked, error: null });
  await assert.rejects(boxOn.api.extendRental({ data: extendData, context: boxOn.context }));
  boxOn.setResponse({ data: null, error: { message: "vehicle_conflict_booking" } });
  await assert.rejects(
    boxOn.api.extendRental({ data: extendData, context: boxOn.context }),
    /another booking/,
  );
  assert.equal(boxOn.calls.some((call) => String(call).includes("stripe.subscriptions")), false);
  results.push("flag on rejects stripe execution");
  console.log("PASS flag on rejects stripe execution");

  boxOn.setRental({
    id: id(2),
    status: "active",
    end_date: "2026-10-25",
    weekly_rate: 350,
    next_payment_due: "2026-10-20",
    stripe_subscription_id: "sub_test",
  });
  const before = boxOn.calls.length;
  const loaded = await boxOn.api.loadExtendContext({ data: { rentalId: id(2) }, context: boxOn.context });
  assert.equal(loaded.endDate, "2026-10-25");
  assert.equal(loaded.hasSubscription, true);
  assert.equal(boxOn.calls[before][0], "from");
  assert.equal(boxOn.calls[before][1], "rentals");
  results.push("context read is the rentals row");
  console.log("PASS context read is the rentals row");

  dataDir = startDatabase();
  try {
    transactionTests(dataDir);
  } finally {
    stopDatabase(dataDir);
    dataDir = null;
  }
  console.log(JSON.stringify({ pass: results.length, fail: 0 }));
})().catch((error) => {
  console.error(error);
  try { stopDatabase(dataDir); } catch { /* already stopped */ }
  process.exit(1);
});
