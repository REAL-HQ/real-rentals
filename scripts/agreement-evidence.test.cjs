const fs = require("fs");
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

const server = fs.readFileSync(path.join(root, "src/lib/replacement-agreement.functions.ts"), "utf8");
const ui = fs.readFileSync(path.join(root, "src/components/admin/ReplacementAgreement.tsx"), "utf8");
const history = fs.readFileSync(path.join(root, "src/components/admin/BookingVehicleHistory.tsx"), "utf8");
const sql = fs.readFileSync(path.join(root, "proposed/agreement-evidence-v1.sql"), "utf8");
const backfill = fs.readFileSync(path.join(root, "proposed/backfill-damon-assignment-history.sql"), "utf8");
const numbers = fs.readFileSync(path.join(root, "src/lib/record-numbers.ts"), "utf8");

test("shipped swap flag stays off", () => {
  assert.match(numbers, /export const SWAP_ENABLED = false;/);
});

test("replacement send is offered only after a recorded swap while the flag is on", () => {
  const mount = history.indexOf("SWAP_ENABLED && rentalId && entries.some((e) => e.swapNumber != null)");
  const tag = history.indexOf("<ReplacementAgreement");
  assert.ok(mount !== -1 && tag > mount);
  assert.match(ui, /if \(!SWAP_ENABLED\) return null/);
  assert.match(ui, /Send Replacement Agreement/);
  assert.match(ui, /Link Evidence/);
  assert.match(ui, />Replacement Agreement</);
  const dialog = ui.indexOf("function ReplacementAgreementDialog");
  const serverFn = ui.indexOf("useServerFn(", dialog);
  assert.ok(dialog !== -1 && serverFn > dialog);
  assert.equal(ui.slice(0, dialog).includes("useServerFn("), false);
  assert.match(ui, /vehicleId: readiness\.rentalVehicleId/);
  assert.equal(ui.includes("esign.server"), false);
  assert.doesNotMatch(ui, /stripe/i);
  assert.doesNotMatch(history, /weekly_rate|stripe|payments/);
});

test("server checks the flag before reads, the send, and the evidence rpc", () => {
  const loadHandler = server.slice(
    server.indexOf("export const loadReplacementAgreement"),
    server.indexOf("export const sendReplacementAgreement"),
  );
  const sendHandler = server.slice(
    server.indexOf("export const sendReplacementAgreement"),
    server.indexOf("export const linkReplacementAgreement"),
  );
  const linkHandler = server.slice(server.indexOf("export const linkReplacementAgreement"));
  assert.ok(loadHandler.indexOf("if (!SWAP_ENABLED)") < loadHandler.indexOf("currentVehicles("));
  assert.ok(sendHandler.indexOf("if (!SWAP_ENABLED)") < sendHandler.indexOf("currentVehicles("));
  assert.ok(sendHandler.indexOf("currentVehicles(") < sendHandler.indexOf('import("@/lib/agreements.functions")'));
  assert.match(sendHandler, /vehicleId: vehicles\.rentalVehicleId/);
  assert.ok(sendHandler.indexOf('import("@/lib/agreements.functions")') < sendHandler.indexOf('import("@/integrations/supabase/client.server")'));
  assert.ok(linkHandler.indexOf("if (!SWAP_ENABLED)") < linkHandler.indexOf('.rpc("link_replacement_agreement_v1"'));
  assert.match(server, /requireManager/);
  assert.doesNotMatch(server, /from ["']@\/lib\/esign\.server["']/);
  assert.doesNotMatch(server, /import\(["']@\/lib\/esign\.server["']\)/);
  assert.doesNotMatch(server, /stripe/i);
  assert.equal(server.includes("_sha256"), false);
});

test("proposed sql keeps the four-argument deny and the swap lock order", () => {
  const start = sql.indexOf("CREATE FUNCTION private.record_agreement_evidence(_rental_id uuid, _agreement_id uuid)");
  const end = sql.indexOf("CREATE FUNCTION public.link_replacement_agreement_v1");
  const body = sql.slice(start, end);
  assert.ok(start !== -1 && end > start);
  let at = -1;
  for (const marker of [
    "PERFORM private.approval_lock()",
    "pg_catalog.pg_try_advisory_xact_lock(710026,2)",
    "FROM public.applications WHERE id=app_id FOR UPDATE NOWAIT",
    "FROM public.rentals WHERE id=_rental_id FOR UPDATE NOWAIT",
    "FROM public.vehicles WHERE id=r.vehicle_id FOR UPDATE NOWAIT",
    "FROM public.agreements WHERE id=_agreement_id FOR SHARE NOWAIT",
    "FROM public.documents WHERE id=ag.document_id FOR SHARE NOWAIT",
    "FROM public.application_identity_reviews WHERE application_id=app_id FOR SHARE NOWAIT",
    "actor_after:=private.approval_actor()",
    "FROM public.user_roles WHERE user_id=actor AND role::text IN ('admin','team') FOR SHARE NOWAIT",
    "SELECT * INTO existing FROM private.agreement_evidence WHERE agreement_id=_agreement_id",
    "INSERT INTO private.agreement_evidence(",
  ]) {
    const next = body.indexOf(marker, at + 1);
    assert.ok(next > at, marker);
    at = next;
  }
  const fourStart = sql.indexOf("CREATE OR REPLACE FUNCTION private.record_agreement_evidence(uuid,uuid,timestamptz,numeric)");
  const fourEnd = sql.indexOf("CREATE TABLE private.agreement_evidence");
  const four = sql.slice(fourStart, fourEnd);
  assert.match(four, /agreement_contract_unverified/);
  assert.equal(body.includes("agreement_contract_unverified"), false);
  assert.doesNotMatch(body, /UPDATE\s+public\.agreements/i);
  assert.doesNotMatch(body, /UPDATE\s+public\.documents/i);
  assert.doesNotMatch(body, /app\.rental_tx/);
  assert.doesNotMatch(sql, /stripe/i);
  assert.doesNotMatch(sql, /ALTER\s+OWNER/i);
  assert.match(sql, /EXECUTE FUNCTION private\.record_immutable\(\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE OR TRUNCATE ON private\.agreement_evidence/);
  assert.match(sql, /after packet step 19/i);
  assert.match(sql, /before swap step 20/i);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.link_replacement_agreement_v1\(uuid,uuid\) TO authenticated;/);
  assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION private\.record_agreement_evidence\(uuid,uuid\) TO/);
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/agreement-evidence-v1.sql")), false);
  assert.equal(
    fs.readdirSync(path.join(root, "supabase/migrations")).some((name) => name.includes("agreement-evidence")),
    false,
  );
});

test("backfill proposes no rows and refuses until live records are read", () => {
  assert.match(backfill, /LIVE DATA/);
  assert.match(backfill, /NOT EXECUTED/);
  assert.match(backfill, /OWNER APPROVAL/);
  assert.match(backfill, /backfill_refused_live_records_unread/);
  assert.doesNotMatch(backfill, /INSERT\s+INTO/i);
});

test("esign.server.ts is unchanged from the published branch", () => {
  const diff = execFileSync(
    "git",
    ["diff", "origin/codex/revenue-publication", "--", "src/lib/esign.server.ts"],
    { cwd: root, encoding: "utf8" },
  );
  assert.equal(diff, "");
});

const id = (n) => `10000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const ACTOR = "11111111-1111-4111-8111-111111111111";
const APP = "22222222-2222-4222-8222-222222222222";
const DRIVER = "33333333-3333-4333-8333-333333333333";
const OLD = "44444444-4444-4444-8444-444444444444";
const NEW = "55555555-5555-4555-8555-555555555555";
const RENTAL = "66666666-6666-4666-8666-666666666666";
const RENTAL2 = "77777777-7777-4777-8777-777777777777";
const OTHER = "88888888-8888-4888-8888-888888888888";
const AGREEMENT = "99999999-9999-4999-8999-999999999999";
const BAD = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const DOC = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const COORD = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const PRE = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const HASH = "ab".repeat(32);

function loadServer(swapEnabled) {
  const built = ts.transpileModule(server, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal((built.diagnostics || []).filter((d) => d.category === ts.DiagnosticCategory.Error).length, 0);
  const calls = [];
  const required = [];
  const issueCalls = [];
  let response = { data: null, error: null };
  let rows = { rentals: null, applications: null };
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
      if (name === "@/lib/roles.server") return { requireManager: async () => ({ tier: "manager", userId: ACTOR }) };
      if (name === "@/lib/agreements.functions") {
        required.push(name);
        return {
          issueAgreement: async (_admin, applicationId, opts) => {
            issueCalls.push({
              applicationId,
              fingerprint: opts.fingerprint,
              createdBy: opts.createdBy,
              vehicleId: opts.vehicleId,
            });
            return {
              id: AGREEMENT,
              url: "https://example.test/sign/token",
              delivery: { email: "queued", sms: "skipped", delivered: true },
            };
          },
        };
      }
      if (name === "@/integrations/supabase/client.server") {
        required.push(name);
        return { supabaseAdmin: { tag: "admin" } };
      }
      throw new Error("Unexpected dependency: " + name);
    },
  };
  vm.runInNewContext(built.outputText, sandbox);
  return {
    calls,
    required,
    issueCalls,
    api: sandbox.exports,
    setResponse(next) { response = next; },
    setRows(next) { rows = next; },
    context: {
      userId: ACTOR,
      supabase: {
        from(table) {
          calls.push(["from", table]);
          const chain = {
            select() { return chain; },
            eq() { return chain; },
            maybeSingle: async () => ({ data: rows[table] ?? null, error: null }),
          };
          return chain;
        },
        rpc: async (...args) => {
          calls.push(["rpc", ...args]);
          return response;
        },
      },
    },
  };
}

const PG = "/tmp/agreement-evidence-pg";
const PORT = "55444";

function psql(sqlText) {
  return execFileSync(
    "psql",
    ["-h", PG, "-p", PORT, "-d", "evidence", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-tA"],
    { input: sqlText, encoding: "utf8" },
  );
}

function startDatabase() {
  fs.rmSync(PG, { recursive: true, force: true });
  execFileSync("/usr/lib/postgresql/16/bin/initdb", ["-D", PG, "--username", process.env.USER || "ubuntu", "--auth=trust", "--no-sync"], { stdio: "ignore" });
  execFileSync("/usr/lib/postgresql/16/bin/pg_ctl", ["-D", PG, "-l", path.join(PG, "log"), "-o", `-p ${PORT} -k ${PG} -c listen_addresses=`, "start"], { stdio: "ignore" });
  execFileSync("/usr/lib/postgresql/16/bin/createdb", ["-h", PG, "-p", PORT, "evidence"], { stdio: "ignore" });
}

function stopDatabase() {
  try {
    execFileSync("/usr/lib/postgresql/16/bin/pg_ctl", ["-D", PG, "-m", "immediate", "stop"], { stdio: "ignore" });
  } catch { /* already stopped */ }
}

const fixture = `
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE SCHEMA IF NOT EXISTS private;
CREATE ROLE rr_record_executor NOLOGIN NOSUPERUSER NOBYPASSRLS;
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;
CREATE FUNCTION private.record_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'record_history_immutable' USING ERRCODE='42501'; END $$;
CREATE FUNCTION private.approval_actor() RETURNS uuid LANGUAGE plpgsql AS $$
DECLARE actor uuid;
BEGIN
 actor := NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
 IF actor IS NULL OR NOT EXISTS (
   SELECT 1 FROM public.user_roles WHERE user_id=actor AND role IN ('admin','team')
 ) THEN RAISE EXCEPTION 'approval_manager_required' USING ERRCODE='42501'; END IF;
 RETURN actor;
END $$;
CREATE FUNCTION private.approval_lock() RETURNS void LANGUAGE plpgsql AS $$ BEGIN PERFORM 1; END $$;
CREATE TABLE public.applications (
 id uuid PRIMARY KEY, user_id uuid, vehicle_id uuid, deleted_at timestamptz, status text);
CREATE TABLE public.vehicles (id uuid PRIMARY KEY, status text);
CREATE TABLE public.rentals (
 id uuid PRIMARY KEY, application_id uuid REFERENCES public.applications(id),
 vehicle_id uuid REFERENCES public.vehicles(id), status text, weekly_rate numeric,
 stripe_subscription_id text);
CREATE TABLE public.user_roles (user_id uuid, role text);
CREATE TABLE public.documents (id uuid PRIMARY KEY);
CREATE TABLE public.agreements (
 id uuid PRIMARY KEY, application_id uuid REFERENCES public.applications(id),
 vehicle_id uuid REFERENCES public.vehicles(id), status text, sha256 text,
 document_id uuid REFERENCES public.documents(id), completed_document_id uuid,
 signed_at timestamptz, archive_status text);
CREATE TABLE public.audit_log (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), action text NOT NULL, actor_role text,
 actor_user_id uuid, entity_id text, entity_type text, metadata jsonb, summary text NOT NULL);
CREATE TABLE public.payments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), rental_id uuid, amount numeric, status text);
CREATE TABLE public.application_identity_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid);
INSERT INTO public.applications VALUES ('${APP}', '${DRIVER}', '${OLD}', NULL, 'approved');
INSERT INTO public.vehicles VALUES ('${OLD}', 'maintenance'), ('${NEW}', 'rented'), ('${OTHER}', 'available');
INSERT INTO public.rentals VALUES
 ('${RENTAL}', '${APP}', '${NEW}', 'active', 350, 'sub_test'),
 ('${RENTAL2}', '${APP}', '${OTHER}', 'active', 350, NULL);
INSERT INTO public.user_roles VALUES ('${ACTOR}', 'admin'), ('${COORD}', 'coordinator');
INSERT INTO public.documents VALUES ('${DOC}');
INSERT INTO public.agreements VALUES
 ('${AGREEMENT}', '${APP}', '${NEW}', 'signed', '${HASH}', '${DOC}', '${DOC}', '2026-10-19 12:00:00+00', 'archived'),
 ('${BAD}', '${APP}', '${NEW}', 'signed', '${HASH}', '${DOC}', '${DOC}', '2026-10-19 12:00:00+00', 'pending');
INSERT INTO public.payments (rental_id, amount, status) VALUES ('${RENTAL}', 100, 'paid');
`;

function linkSql(rentalId, agreementId) {
  return `
    CREATE TEMP TABLE evidence_out (doc jsonb);
    DO $$ BEGIN
      PERFORM set_config('request.jwt.claim.sub', '${ACTOR}', true);
      INSERT INTO evidence_out
      SELECT public.link_replacement_agreement_v1('${rentalId}', '${agreementId}');
    END $$;
    SELECT doc::text FROM evidence_out;
  `;
}

function transactionTests() {
  psql(fixture);
  psql(fs.readFileSync(path.join(root, "proposed/agreement-evidence-v1.sql"), "utf8"));
  test("evidence privileges stay off the private function and the table", () => {
    const priv = psql(`
      SELECT concat_ws(' ',
        has_function_privilege('authenticated', 'public.link_replacement_agreement_v1(uuid,uuid)', 'execute')::text,
        has_function_privilege('anon', 'public.link_replacement_agreement_v1(uuid,uuid)', 'execute')::text,
        has_function_privilege('authenticated', 'private.record_agreement_evidence(uuid,uuid)', 'execute')::text,
        has_function_privilege('rr_record_executor', 'private.record_agreement_evidence(uuid,uuid)', 'execute')::text,
        has_function_privilege('rr_record_executor', 'private.record_agreement_evidence(uuid,uuid,timestamptz,numeric)', 'execute')::text,
        has_table_privilege('authenticated', 'private.agreement_evidence', 'select')::text,
        (SELECT relrowsecurity::text FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE n.nspname='private' AND c.relname='agreement_evidence'),
        (SELECT count(*)::text FROM pg_policies WHERE schemaname='private' AND tablename='agreement_evidence'));
    `).trim();
    assert.equal(priv, "true false false false true false true 0");
  });
  test("the four-argument adapter still denies every call", () => {
    psql(`
      DO $$ BEGIN
        PERFORM private.record_agreement_evidence('${APP}', '${NEW}', '2026-10-19 12:00:00+00', 350);
        RAISE EXCEPTION 'four arg was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%agreement_contract_unverified%' THEN RAISE; END IF;
      END $$;
    `);
  });
  test("a coordinator is refused and writes nothing", () => {
    psql(`
      DO $$ BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${COORD}', true);
        PERFORM public.link_replacement_agreement_v1('${RENTAL}', '${AGREEMENT}');
        RAISE EXCEPTION 'coordinator was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%approval_manager_required%' AND SQLERRM NOT LIKE '%manager_required%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM private.agreement_evidence) THEN RAISE EXCEPTION 'coordinator wrote evidence'; END IF;
      END $$;
    `);
  });
  test("an unarchived agreement is refused", () => {
    psql(`
      DO $$ BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${ACTOR}', true);
        PERFORM public.link_replacement_agreement_v1('${RENTAL}', '${BAD}');
        RAISE EXCEPTION 'pending archive was accepted';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%agreement_evidence_required%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM private.agreement_evidence) THEN RAISE EXCEPTION 'pending archive wrote evidence'; END IF;
        IF (SELECT archive_status FROM public.agreements WHERE id='${BAD}') <> 'pending' THEN
          RAISE EXCEPTION 'archive status was rewritten';
        END IF;
      END $$;
    `);
  });
  test("a held rental lock fails nowait and writes nothing", () => {
    const child = spawn("psql", ["-h", PG, "-p", PORT, "-d", "evidence", "-v", "ON_ERROR_STOP=1", "-X"], {
      stdio: ["pipe", "ignore", "pipe"],
    });
    child.stdin.write(`BEGIN; SELECT id FROM public.rentals WHERE id='${RENTAL}' FOR UPDATE; SELECT pg_sleep(20); COMMIT;\n`);
    const started = Date.now();
    let held = false;
    while (Date.now() - started < 5000) {
      const n = psql(`SELECT count(*) FROM pg_locks l JOIN pg_class c ON c.oid=l.relation
        WHERE c.relname='rentals' AND l.granted AND l.mode='RowShareLock'`).trim();
      if (n !== "0") { held = true; break; }
      execFileSync("sleep", ["0.05"]);
    }
    assert.equal(held, true);
    psql(`
      DO $$ BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${ACTOR}', true);
        PERFORM public.link_replacement_agreement_v1('${RENTAL}', '${AGREEMENT}');
        RAISE EXCEPTION 'locked evidence succeeded';
      EXCEPTION WHEN SQLSTATE '40001' THEN
        IF SQLERRM NOT LIKE '%agreement_evidence_contention_retry_whole_transaction%' THEN
          RAISE EXCEPTION 'unexpected lock error: %', SQLERRM;
        END IF;
      END $$;
    `);
    psql(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid <> pg_backend_pid() AND query LIKE '%pg_sleep%'`);
    child.kill();
    psql(`
      DO $$ BEGIN
        IF EXISTS (SELECT 1 FROM private.agreement_evidence) THEN RAISE EXCEPTION 'contention wrote evidence'; END IF;
      END $$;
    `);
  });
  test("a signed archive links once and cannot be updated or deleted", () => {
    const linked = JSON.parse(psql(linkSql(RENTAL, AGREEMENT)).trim());
    assert.equal(linked.contract, "agreement-evidence-v1");
    assert.equal(linked.recovered, false);
    assert.equal(linked.rentalId, RENTAL);
    assert.equal(linked.agreementId, AGREEMENT);
    assert.equal(linked.applicationId, APP);
    assert.equal(linked.vehicleId, NEW);
    assert.equal(linked.documentId, DOC);
    assert.equal(linked.sha256, HASH);
    assert.equal(linked.signerUserId, DRIVER);
    assert.notEqual(linked.signerUserId, ACTOR);
    psql(`
      DO $$ BEGIN
        IF (SELECT count(*) FROM private.agreement_evidence) <> 1 THEN RAISE EXCEPTION 'evidence count'; END IF;
        IF (SELECT count(*) FROM public.audit_log WHERE action='rental.agreement_evidence_linked') <> 1 THEN
          RAISE EXCEPTION 'audit count';
        END IF;
        IF (SELECT sha256 FROM public.agreements WHERE id='${AGREEMENT}') <> '${HASH}'
         OR (SELECT archive_status FROM public.agreements WHERE id='${AGREEMENT}') <> 'archived'
         OR (SELECT document_id FROM public.agreements WHERE id='${AGREEMENT}') <> '${DOC}'
         OR (SELECT completed_document_id FROM public.agreements WHERE id='${AGREEMENT}') <> '${DOC}'
        THEN RAISE EXCEPTION 'agreement archive changed'; END IF;
        IF (SELECT vehicle_id FROM public.rentals WHERE id='${RENTAL}') <> '${NEW}'
         OR (SELECT weekly_rate FROM public.rentals WHERE id='${RENTAL}') <> 350
         OR (SELECT stripe_subscription_id FROM public.rentals WHERE id='${RENTAL}') IS DISTINCT FROM 'sub_test'
        THEN RAISE EXCEPTION 'rental changed'; END IF;
        IF (SELECT count(*) FROM public.payments) <> 1 OR (SELECT amount FROM public.payments) <> 100 THEN
          RAISE EXCEPTION 'payments changed';
        END IF;
        IF EXISTS (
          SELECT 1 FROM information_schema.columns
          WHERE table_schema='private' AND table_name='agreement_evidence'
            AND column_name IN ('signer_name','signer_email','phone')
        ) THEN RAISE EXCEPTION 'personal column on evidence'; END IF;
      END $$;
    `);
    const replay = JSON.parse(psql(linkSql(RENTAL, AGREEMENT)).trim());
    assert.equal(replay.recovered, true);
    assert.equal(replay.evidenceId, linked.evidenceId);
    psql(`
      DO $$ BEGIN
        IF (SELECT count(*) FROM private.agreement_evidence) <> 1 THEN RAISE EXCEPTION 'replay stored a second row'; END IF;
        IF (SELECT count(*) FROM public.audit_log WHERE action='rental.agreement_evidence_linked') <> 1 THEN
          RAISE EXCEPTION 'replay wrote a second audit';
        END IF;
        UPDATE private.agreement_evidence SET sha256 = sha256;
        RAISE EXCEPTION 'update was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%record_history_immutable%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        DELETE FROM private.agreement_evidence;
        RAISE EXCEPTION 'delete was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%record_history_immutable%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        TRUNCATE private.agreement_evidence;
        RAISE EXCEPTION 'truncate was allowed';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%record_history_immutable%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        IF (SELECT count(*) FROM private.agreement_evidence) <> 1 THEN RAISE EXCEPTION 'evidence row was removed'; END IF;
      END $$;
    `);
  });
  test("evidence names the agreement vehicle while the rental is still on the previous car", () => {
    psql(`
      INSERT INTO public.agreements VALUES
       ('${PRE}', '${APP}', '${NEW}', 'signed', '${HASH}', '${DOC}', '${DOC}', '2026-10-19 12:00:00+00', 'archived');
      UPDATE public.rentals SET vehicle_id='${OLD}' WHERE id='${RENTAL}';
    `);
    const linked = JSON.parse(psql(linkSql(RENTAL, PRE)).trim());
    assert.equal(linked.vehicleId, NEW);
    assert.equal(linked.recovered, false);
    psql(`
      DO $$ BEGIN
        IF (SELECT vehicle_id FROM public.rentals WHERE id='${RENTAL}') <> '${OLD}' THEN
          RAISE EXCEPTION 'rental pointer moved';
        END IF;
        IF (SELECT vehicle_id FROM private.agreement_evidence WHERE agreement_id='${PRE}') <> '${NEW}' THEN
          RAISE EXCEPTION 'evidence did not name the agreement vehicle';
        END IF;
        IF (SELECT sha256 FROM public.agreements WHERE id='${PRE}') <> '${HASH}'
         OR (SELECT archive_status FROM public.agreements WHERE id='${PRE}') <> 'archived'
        THEN RAISE EXCEPTION 'archive changed'; END IF;
      END $$;
      UPDATE public.rentals SET vehicle_id='${NEW}' WHERE id='${RENTAL}';
    `);
  });
  test("the same agreement cannot be linked to a different rental", () => {
    psql(`
      DO $$ BEGIN
        PERFORM set_config('request.jwt.claim.sub', '${ACTOR}', true);
        PERFORM public.link_replacement_agreement_v1('${RENTAL2}', '${AGREEMENT}');
        RAISE EXCEPTION 'conflict was accepted';
      EXCEPTION WHEN OTHERS THEN
        IF SQLERRM NOT LIKE '%evidence_conflict%' THEN RAISE; END IF;
      END $$;
      DO $$ BEGIN
        IF (SELECT count(*) FROM private.agreement_evidence WHERE agreement_id='${AGREEMENT}') <> 1 THEN
          RAISE EXCEPTION 'conflict wrote another row';
        END IF;
        IF (SELECT rental_id FROM private.agreement_evidence WHERE agreement_id='${AGREEMENT}') <> '${RENTAL}' THEN
          RAISE EXCEPTION 'rental binding changed';
        END IF;
      END $$;
    `);
  });
}

function loadAgreementsModule() {
  const cache = new Map();
  const crypto = require("crypto");
  function resolve(fromDir, name) {
    if (name.startsWith("@/")) return path.join(root, "src", name.slice(2));
    if (name.startsWith(".")) return path.resolve(fromDir, name);
    return null;
  }
  function load(abs) {
    const file = fs.existsSync(abs + ".ts") ? abs + ".ts" : abs;
    if (cache.has(file)) return cache.get(file);
    const built = ts.transpileModule(fs.readFileSync(file, "utf8"), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
    });
    const module = { exports: {} };
    const sandbox = {
      module,
      exports: module.exports,
      require: makeRequire(path.dirname(file)),
      console,
      process,
      Buffer,
      TextEncoder,
      crypto,
      URL,
    };
    vm.runInNewContext(built.outputText, sandbox, { filename: file });
    cache.set(file, module.exports);
    return module.exports;
  }
  function makeRequire(fromDir) {
    return (name) => {
      if (name === "zod") return z;
      if (name === "@tanstack/react-start" || name === "@tanstack/react-start/server") {
        return { createServerFn() { return { middleware() { return this; }, inputValidator() { return this; }, handler() { return this; } }; }, getRequest() { return null; } };
      }
      if (name === "@/integrations/supabase/auth-middleware") return { requireSupabaseAuth: {} };
      if (name === "@/integrations/supabase/client.server") return { supabaseAdmin: {} };
      if (name === "@/lib/esign.server") {
        return {
          getCompanySigner: async () => ({ name: "Real Rentals", title: "Owner" }),
          deliverSigningLink: async () => ({ email: "queued", sms: "skipped", delivered: true }),
        };
      }
      if (name === "@/lib/esign-pdf.server") {
        return { sha256Hex: async (value) => crypto.createHash("sha256").update(String(value)).digest("hex"), renderPreviewPdf: async () => new Uint8Array() };
      }
      if (name === "@/lib/company-identity.server") {
        return { getCompanyIdentity: async () => ({ merge: {}, missing: [], fromSettings: {} }) };
      }
      if (name === "@/lib/vin") return { checkVin: () => ({ formatValid: true }) };
      if (name === "@/lib/audit.server") return { logAudit: async () => {} };
      if (name === "@/lib/roles.server") return { getActor: async () => ({ tier: "manager", userId: ACTOR }), requireTier: async () => ({ tier: "manager" }) };
      if (name === "@/lib/email.server") return {};
      if (name === "@/lib/driver-preview.server") return {};
      if (name === "@/lib/agreement-templates.functions") return { loadLibraryDraft: async () => null };
      const abs = resolve(fromDir, name);
      if (!abs) throw new Error("Unexpected dependency: " + name);
      return load(abs);
    };
  }
  return load(path.join(root, "src/lib/agreements.functions"));
}

function agreementAdmin(rentalVehicleId) {
  const inserts = [];
  const oldVehicle = {
    id: OLD, year: 2020, make: "Kia", model: "Soul", trim: null, color: "White",
    vin: "OLDV1N00000000001", unit_number: "12", weekly_rate: 300, deposit: 0,
    license_plate: "OLD123", plate_state: "FL",
  };
  const newVehicle = { ...oldVehicle, id: NEW, make: "Toyota", model: "Camry", vin: "NEWV1N00000000001", license_plate: "NEW123" };
  const app = {
    id: APP, full_name: "Driver Example", email: "driver@example.test", phone: "8135550100",
    address: "1 Main St", city: "Tampa", state: "FL", zip: "33602",
    license_number: "D1234567", license_state: "FL", license_expiration: "2028-01-01",
    vehicle_id: OLD, weekly_rent: 350, deposit_amount: 0, contract_start_date: "2026-10-01",
    contract_end_date: "2026-11-01", market_id: null, dob: "1990-01-01", card_brand: null, card_last4: null,
    insurance_carrier: null, insurance_policy_number: null,
  };
  const admin = {
    from(table) {
      const state = { cols: "", eqs: [] };
      const run = async () => {
        if (table === "applications") return { data: app, error: null };
        if (table === "rentals") {
          if (String(state.cols).includes("vehicle_id")) return { data: { vehicle_id: rentalVehicleId }, error: null };
          return { data: { start_date: "2026-10-01", end_date: "2026-11-01", status: "active" }, error: null };
        }
        if (table === "vehicles") {
          const id = state.eqs.find((entry) => entry[0] === "id")?.[1];
          return { data: id === NEW ? newVehicle : oldVehicle, error: null };
        }
        if (table === "agreement_templates" || table === "markets" || table === "app_settings") return { data: table === "agreement_templates" ? [] : null, error: null };
        if (table === "agreements") return { data: { id: AGREEMENT }, error: null };
        return { data: null, error: null };
      };
      const chain = {
        select(cols) { state.cols = cols; return chain; },
        eq(col, val) { state.eqs.push([col, val]); return chain; },
        order() { return chain; },
        limit() {
          const promise = run();
          promise.maybeSingle = () => promise;
          return promise;
        },
        maybeSingle() { return run(); },
        insert(payload) { inserts.push({ table, payload }); return chain; },
        single() { return run(); },
      };
      return chain;
    },
  };
  return { admin, inserts, oldVehicle, newVehicle };
}

(async () => {
  const off = loadServer(false);
  const sendData = { rentalId: RENTAL, fingerprint: HASH };
  await assert.rejects(
    off.api.sendReplacementAgreement({ data: sendData, context: off.context }),
    /disabled pending installation/,
  );
  await assert.rejects(
    off.api.linkReplacementAgreement({ data: { rentalId: RENTAL, agreementId: AGREEMENT }, context: off.context }),
    /disabled pending installation/,
  );
  await assert.rejects(
    off.api.loadReplacementAgreement({ data: { rentalId: RENTAL }, context: off.context }),
    /disabled pending installation/,
  );
  assert.equal(off.calls.length, 0);
  assert.equal(off.required.length, 0);
  assert.equal(off.issueCalls.length, 0);
  results.push("flag off throws before reads and the send");
  console.log("PASS flag off throws before reads and the send");

  const mismatch = loadServer(true);
  mismatch.setRows({
    rentals: { id: RENTAL, status: "active", application_id: APP, vehicle_id: NEW },
    applications: { id: APP, vehicle_id: OLD, deleted_at: null },
  });
  const sentMismatch = await mismatch.api.sendReplacementAgreement({ data: sendData, context: mismatch.context });
  assert.equal(sentMismatch.id, AGREEMENT);
  assert.equal(mismatch.issueCalls.length, 1);
  assert.equal(mismatch.issueCalls[0].applicationId, APP);
  assert.equal(mismatch.issueCalls[0].vehicleId, NEW);
  assert.equal(mismatch.calls.some((c) => c[0] === "rpc"), false);
  const readiness = await mismatch.api.loadReplacementAgreement({ data: { rentalId: RENTAL }, context: mismatch.context });
  assert.equal(readiness.vehiclesMatch, false);
  assert.equal(readiness.rentalVehicleId, NEW);
  assert.equal(readiness.refusal, null);
  results.push("a different application vehicle still sends the rental's current vehicle");
  console.log("PASS a different application vehicle still sends the rental's current vehicle");

  const match = loadServer(true);
  match.setRows({
    rentals: { id: RENTAL, status: "active", application_id: APP, vehicle_id: NEW },
    applications: { id: APP, vehicle_id: NEW, deleted_at: null },
  });
  const sent = await match.api.sendReplacementAgreement({
    data: { rentalId: RENTAL, fingerprint: HASH, companyAck: true },
    context: match.context,
  });
  assert.equal(sent.id, AGREEMENT);
  assert.equal(match.issueCalls.length, 1);
  assert.equal(match.issueCalls[0].applicationId, APP);
  assert.equal(match.issueCalls[0].fingerprint, HASH);
  assert.equal(match.issueCalls[0].createdBy, ACTOR);
  assert.equal(match.issueCalls[0].vehicleId, NEW);
  const evidence = {
    contract: "agreement-evidence-v1",
    evidenceId: id(7),
    rentalId: RENTAL,
    agreementId: AGREEMENT,
    applicationId: APP,
    vehicleId: NEW,
    documentId: DOC,
    sha256: HASH,
    signedAt: "2026-10-19T12:00:00.000Z",
    signerUserId: DRIVER,
    recovered: false,
  };
  match.setResponse({ data: evidence, error: null });
  const linked = await match.api.linkReplacementAgreement({
    data: { rentalId: RENTAL, agreementId: AGREEMENT },
    context: match.context,
  });
  assert.equal(linked.evidenceId, evidence.evidenceId);
  assert.equal(linked.recovered, false);
  const rpc = match.calls.filter((c) => c[0] === "rpc");
  assert.equal(rpc.length, 1);
  assert.equal(rpc[0][1], "link_replacement_agreement_v1");
  assert.equal(rpc[0][2]._rental_id, RENTAL);
  assert.equal(rpc[0][2]._agreement_id, AGREEMENT);
  assert.equal("_sha256" in rpc[0][2], false);
  results.push("matching vehicles use the existing send and the evidence rpc");
  console.log("PASS matching vehicles use the existing send and the evidence rpc");

  const agreements = loadAgreementsModule();
  const wrong = agreementAdmin(NEW);
  await assert.rejects(
    agreements.issueAgreement(wrong.admin, APP, { fingerprint: HASH, createdBy: ACTOR, vehicleId: OLD }),
    /must be the rental's current vehicle/,
  );
  assert.equal(wrong.inserts.length, 0);
  const named = agreementAdmin(NEW);
  const issued = await agreements.issueAgreement(named.admin, APP, { fingerprint: undefined, createdBy: ACTOR, vehicleId: NEW });
  assert.equal(issued.id, AGREEMENT);
  assert.equal(named.inserts[0].payload.vehicle_id, NEW);
  assert.match(named.inserts[0].payload.body, /NEWV1N00000000001/);
  assert.doesNotMatch(named.inserts[0].payload.body, /OLDV1N00000000001/);
  const plain = agreementAdmin(NEW);
  await agreements.issueAgreement(plain.admin, APP, { createdBy: ACTOR });
  assert.equal(plain.inserts[0].payload.vehicle_id, OLD);
  assert.match(plain.inserts[0].payload.body, /OLDV1N00000000001/);
  results.push("override names the rental vehicle and the default path names the application vehicle");
  console.log("PASS override names the rental vehicle and the default path names the application vehicle");

  startDatabase();
  try {
    transactionTests();
  } finally {
    stopDatabase();
  }
  console.log(JSON.stringify({ pass: results.length, fail: 0 }));
})().catch((error) => {
  console.error(error);
  try { stopDatabase(); } catch { /* already stopped */ }
  process.exit(1);
});
