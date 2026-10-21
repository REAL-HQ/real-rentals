const fs = require("fs");
const path = require("path");
const vm = require("vm");
const assert = require("assert/strict");
const { execFileSync } = require("child_process");
const net = require("net");
const { createRequire } = require("module");

const { pgProgram, makeDataDir } = require("./pg-local.cjs");

const root = path.resolve(__dirname, "..");
const PACKET = "04a761ef0395a87ef8e9da45f2300d3479829ca0";
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
const backfill = fs.readFileSync(path.join(root, "proposed/backfill-assignment-intervals.sql"), "utf8");
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
  assert.match(ui, /previewReplacementAgreement/);
  assert.doesNotMatch(ui, /from "@\/lib\/agreements\.functions"/);
  assert.match(ui, /previewed\.vehicleId === readiness\.rentalVehicleId/);
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
  assert.ok(loadHandler.indexOf("if (!SWAP_ENABLED)") < loadHandler.indexOf("requireManager"));
  assert.ok(loadHandler.indexOf("requireManager") < loadHandler.indexOf("currentVehicles("));
  assert.ok(sendHandler.indexOf("if (!SWAP_ENABLED)") < sendHandler.indexOf("currentVehicles("));
  assert.ok(sendHandler.indexOf("currentVehicles(") < sendHandler.indexOf('import("@/lib/agreements.functions")'));
  assert.match(sendHandler, /vehicleId: vehicles\.rentalVehicleId/);
  assert.ok(sendHandler.indexOf('import("@/lib/agreements.functions")') < sendHandler.indexOf('import("@/integrations/supabase/client.server")'));
  assert.ok(linkHandler.indexOf("if (!SWAP_ENABLED)") < linkHandler.indexOf("requireManager"));
  assert.ok(linkHandler.indexOf("requireManager") < linkHandler.indexOf("context.supabase"));
  assert.match(linkHandler, /\.rpc\("link_replacement_agreement_checked"/);
  assert.match(linkHandler, /_rental_id: data\.rentalId/);
  assert.match(linkHandler, /_agreement_id: data\.agreementId/);
  assert.equal(linkHandler.includes("_actor"), false);
  assert.equal(linkHandler.includes("supabaseAdmin"), false);
  assert.equal(linkHandler.includes("link_replacement_agreement_v1"), false);
  assert.match(server, /proposed\/m2-packet\/19b\.sql/);
  assert.match(server, /requireManager/);
  assert.doesNotMatch(server, /from ["']@\/lib\/esign\.server["']/);
  assert.doesNotMatch(server, /import\(["']@\/lib\/esign\.server["']\)/);
  assert.doesNotMatch(server, /stripe/i);
  assert.equal(server.includes("_sha256"), false);
});

test("this branch does not carry a copy of M2 step 19b", () => {
  assert.equal(fs.existsSync(path.join(root, "proposed/agreement-evidence-v1.sql")), false);
  assert.equal(fs.existsSync(path.join(root, "supabase/migrations/agreement-evidence-v1.sql")), false);
  assert.equal(
    fs.readdirSync(path.join(root, "supabase/migrations")).some((name) => name.includes("agreement-evidence")),
    false,
  );
  assert.equal(
    fs.readdirSync(path.join(root, "proposed")).some((name) => name.includes("agreement-evidence")),
    false,
  );
});

test("backfill proposes no rows and refuses until live records are read", () => {
  assert.match(backfill, /LIVE DATA/);
  assert.match(backfill, /NOT EXECUTED/);
  assert.match(backfill, /OWNER APPROVAL/);
  assert.match(backfill, /backfill_refused_live_records_unread/);
  assert.match(backfill, /Wait for proposed\/m2-packet\/20\.sql \(HOSTED-INSTALL step 26\)/);
  assert.doesNotMatch(backfill, /vehicle-swap-v1\.sql/);
  assert.doesNotMatch(backfill, /INSERT\s+INTO/i);
  assert.doesNotMatch(backfill, /UPDATE\s+public\./i);
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
        return {
          supabaseAdmin: {
            tag: "admin",
            rpc: async (...args) => {
              calls.push(["admin-rpc", ...args]);
              return response;
            },
          },
        };
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
          calls.push(["user-rpc", ...args]);
          return response;
        },
      },
    },
  };
}

function loadAgreementsModule(swapEnabled) {
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
      if (name === "@/lib/record-numbers") {
        const abs = path.join(root, "src/lib/record-numbers.ts");
        if (!cache.has(abs)) {
          const builtNumbers = ts.transpileModule(fs.readFileSync(abs, "utf8"), {
            compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
          });
          const numbersModule = { exports: {} };
          vm.runInNewContext(builtNumbers.outputText, {
            module: numbersModule,
            exports: numbersModule.exports,
            require(dep) { throw new Error("Unexpected dependency: " + dep); },
            console,
          }, { filename: abs });
          cache.set(abs, numbersModule.exports);
        }
        return { ...cache.get(abs), SWAP_ENABLED: swapEnabled };
      }
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

function packetSql(name) {
  try {
    execFileSync("git", ["cat-file", "-e", `${PACKET}^{commit}`], { cwd: root, stdio: "ignore" });
  } catch {
    execFileSync("git", ["fetch", "origin", "cursor/m2-packet-grants-ba3d"], { cwd: root, stdio: "inherit" });
  }
  return execFileSync("git", ["show", `${PACKET}:proposed/m2-packet/${name}`], { cwd: root, encoding: "utf8" });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });
}

function evidencePsql(dir, port, sqlText) {
  return execFileSync(
    pgProgram("psql"),
    ["-h", dir, "-p", String(port), "-d", "evidence", "-v", "ON_ERROR_STOP=1", "-X", "-q", "-tA"],
    { input: sqlText, encoding: "utf8" },
  );
}

function expectSqlError(dir, port, sqlText, pattern) {
  try {
    evidencePsql(dir, port, sqlText);
  } catch (error) {
    const text = `${error.stderr || ""}\n${error.stdout || ""}\n${error.message || ""}`;
    assert.match(text, pattern);
    return;
  }
  throw new Error(`expected SQL error matching ${pattern}`);
}

async function checkedEvidenceDatabase() {
  const sql19b = packetSql("19b.sql");
  assert.match(sql19b, /CREATE FUNCTION public\.link_replacement_agreement_checked\(_rental_id uuid, _agreement_id uuid\)/);
  assert.match(sql19b, /GRANT EXECUTE ON FUNCTION public\.link_replacement_agreement_checked\(uuid,uuid\) TO authenticated;/);
  assert.match(sql19b, /GRANT EXECUTE ON FUNCTION public\.link_replacement_agreement_v1\(uuid,uuid\) TO rr_record_executor;/);
  assert.doesNotMatch(sql19b, /_actor uuid/);
  const port = await reservePort();
  const dir = makeDataDir("agreement-evidence-pg-");
  try {
    execFileSync(pgProgram("initdb"), ["-D", dir, "--username", process.env.USER || "ubuntu", "--auth=trust", "--no-sync"], { stdio: "ignore" });
    execFileSync(pgProgram("pg_ctl"), ["-D", dir, "-l", path.join(dir, "log"), "-o", `-p ${port} -k ${dir} -c listen_addresses=`, "start"], { stdio: "ignore" });
    execFileSync(pgProgram("createdb"), ["-h", dir, "-p", String(port), "evidence"], { stdio: "ignore" });
    evidencePsql(dir, port, `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE SCHEMA IF NOT EXISTS private;
      CREATE ROLE rr_record_executor NOLOGIN NOSUPERUSER NOBYPASSRLS;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE FUNCTION private.record_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
      BEGIN RAISE EXCEPTION 'record_history_immutable' USING ERRCODE='42501'; END $$;
      CREATE FUNCTION private.approval_actor() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '${ACTOR}'::uuid $$;
      CREATE FUNCTION private.approval_lock() RETURNS void LANGUAGE plpgsql SET search_path='' AS $$ BEGIN PERFORM 1; END $$;
      REVOKE ALL ON FUNCTION private.approval_actor(),private.approval_lock() FROM PUBLIC,anon,authenticated,service_role;
      CREATE TABLE public.applications (id uuid PRIMARY KEY, user_id uuid, deleted_at timestamptz);
      CREATE TABLE public.vehicles (id uuid PRIMARY KEY);
      CREATE TABLE public.rentals (
        id uuid PRIMARY KEY, application_id uuid REFERENCES public.applications(id),
        vehicle_id uuid REFERENCES public.vehicles(id), status text);
      CREATE TABLE public.documents (id uuid PRIMARY KEY);
      CREATE TABLE public.agreements (
        id uuid PRIMARY KEY, application_id uuid, vehicle_id uuid, status text, sha256 text,
        document_id uuid, completed_document_id uuid, signed_at timestamptz, archive_status text);
      CREATE TABLE public.user_roles (user_id uuid, role text);
      CREATE TABLE public.application_identity_reviews (id uuid PRIMARY KEY DEFAULT gen_random_uuid(), application_id uuid);
      CREATE TABLE public.audit_log (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(), actor_user_id uuid, actor_role text, action text,
        entity_type text, entity_id text, summary text, metadata jsonb);
      INSERT INTO public.applications VALUES ('${APP}', '${DRIVER}', NULL);
      INSERT INTO public.vehicles VALUES ('${OLD}'), ('${NEW}');
      INSERT INTO public.rentals VALUES ('${RENTAL}', '${APP}', '${OLD}', 'active');
      INSERT INTO public.documents VALUES ('${DOC}');
      INSERT INTO public.agreements VALUES
        ('${AGREEMENT}', '${APP}', '${NEW}', 'signed', '${HASH}', '${DOC}', '${DOC}', '2026-10-19 12:00:00+00', 'archived');
      INSERT INTO public.user_roles VALUES ('${ACTOR}', 'admin'), ('${COORD}', 'coordinator');
    `);
    evidencePsql(dir, port, sql19b);
    const grants = evidencePsql(dir, port, `
      SELECT has_function_privilege('authenticated', 'public.link_replacement_agreement_checked(uuid,uuid)', 'EXECUTE')
        || ' ' || has_function_privilege('anon', 'public.link_replacement_agreement_checked(uuid,uuid)', 'EXECUTE')
        || ' ' || has_function_privilege('service_role', 'public.link_replacement_agreement_checked(uuid,uuid)', 'EXECUTE')
        || ' ' || has_function_privilege('public', 'public.link_replacement_agreement_checked(uuid,uuid)', 'EXECUTE')
        || ' ' || has_function_privilege('authenticated', 'public.link_replacement_agreement_v1(uuid,uuid)', 'EXECUTE')
        || ' ' || has_function_privilege('rr_record_executor', 'public.link_replacement_agreement_v1(uuid,uuid)', 'EXECUTE')
    `).trim();
    assert.equal(grants, "true false false false false true");
    const def = evidencePsql(dir, port, `SELECT pg_get_functiondef('public.link_replacement_agreement_checked(uuid,uuid)'::regprocedure)`);
    const signature = def.slice(0, def.indexOf("AS $function$"));
    assert.match(signature, /_rental_id uuid, _agreement_id uuid/);
    assert.doesNotMatch(signature, /_actor/);
    assert.match(def, /private\.approval_actor\(\)/);
    assert.match(def, /link_replacement_agreement_v1/);
    expectSqlError(
      dir,
      port,
      `BEGIN; SET LOCAL ROLE anon; SELECT public.link_replacement_agreement_checked('${RENTAL}', '${AGREEMENT}'); COMMIT;`,
      /permission denied/i,
    );
    expectSqlError(
      dir,
      port,
      `BEGIN; SET LOCAL ROLE service_role; SELECT public.link_replacement_agreement_checked('${RENTAL}', '${AGREEMENT}'); COMMIT;`,
      /permission denied/i,
    );
    expectSqlError(
      dir,
      port,
      `BEGIN; SET LOCAL ROLE authenticated; SELECT public.link_replacement_agreement_v1('${RENTAL}', '${AGREEMENT}'); COMMIT;`,
      /permission denied/i,
    );
    evidencePsql(dir, port, `CREATE OR REPLACE FUNCTION private.approval_actor() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '${COORD}'::uuid $$;`);
    expectSqlError(
      dir,
      port,
      `BEGIN; SET LOCAL ROLE authenticated; SELECT public.link_replacement_agreement_checked('${RENTAL}', '${AGREEMENT}'); COMMIT;`,
      /manager_required/,
    );
    evidencePsql(dir, port, `CREATE OR REPLACE FUNCTION private.approval_actor() RETURNS uuid LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$ SELECT '${ACTOR}'::uuid $$;`);
    const linked = JSON.parse(evidencePsql(dir, port, `
      BEGIN;
      SET LOCAL ROLE authenticated;
      SELECT public.link_replacement_agreement_checked('${RENTAL}', '${AGREEMENT}')::text;
      COMMIT;
    `).trim());
    assert.equal(linked.contract, "agreement-evidence-v1");
    assert.equal(linked.rentalId, RENTAL);
    assert.equal(linked.agreementId, AGREEMENT);
    assert.equal(linked.vehicleId, NEW);
    assert.equal(linked.recovered, false);
    assert.equal(linked.signerUserId, DRIVER);
    const recovered = JSON.parse(evidencePsql(dir, port, `
      BEGIN;
      SET LOCAL ROLE authenticated;
      SELECT public.link_replacement_agreement_checked('${RENTAL}', '${AGREEMENT}')::text;
      COMMIT;
    `).trim());
    assert.equal(recovered.recovered, true);
    assert.equal(recovered.evidenceId, linked.evidenceId);
    const audits = evidencePsql(dir, port, `SELECT count(*) FROM public.audit_log WHERE action='rental.agreement_evidence_linked'`).trim();
    assert.equal(audits, "1");
    results.push("real 19b checked function links as the authenticated manager");
    console.log("PASS real 19b checked function links as the authenticated manager");
  } finally {
    try {
      execFileSync(pgProgram("pg_ctl"), ["-D", dir, "-m", "immediate", "stop"], { stdio: "ignore" });
    } catch { /* already stopped */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
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
  await assert.rejects(
    off.api.previewReplacementAgreement({ data: { rentalId: RENTAL }, context: off.context }),
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
  const rpc = match.calls.filter((c) => c[0] === "user-rpc");
  assert.equal(rpc.length, 1);
  assert.equal(match.calls.some((c) => c[0] === "admin-rpc"), false);
  assert.equal(rpc[0][1], "link_replacement_agreement_checked");
  assert.equal(rpc[0][2]._rental_id, RENTAL);
  assert.equal(rpc[0][2]._agreement_id, AGREEMENT);
  assert.equal("_actor" in rpc[0][2], false);
  assert.equal("_sha256" in rpc[0][2], false);
  results.push("matching vehicles use the existing send and the evidence rpc");
  console.log("PASS matching vehicles use the existing send and the evidence rpc");

  const ignored = agreementAdmin(NEW);
  const offAgreements = loadAgreementsModule(false);
  await offAgreements.issueAgreement(ignored.admin, APP, { createdBy: ACTOR, vehicleId: NEW });
  assert.equal(ignored.inserts[0].payload.vehicle_id, OLD);
  assert.match(ignored.inserts[0].payload.body, /OLDV1N00000000001/);
  const agreements = loadAgreementsModule(true);
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

  await checkedEvidenceDatabase();
  console.log(JSON.stringify({ pass: results.length, fail: 0 }));
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
