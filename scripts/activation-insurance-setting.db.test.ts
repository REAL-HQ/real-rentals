// Local-only verification of proposed/activation-insurance-setting on a private, disposable
// Postgres (127.0.0.1:55482, database ais_test cloned from the production-order baseline
// template rr_tpl) and a local PostgREST (127.0.0.1:55483). Never touches a hosted backend:
// every URL is asserted to be 127.0.0.1 on those two ports.
//
// Build the baseline first (see proposed/activation-insurance-setting/README.md, "Local test
// database"): stubs.sql, rr-apply.mjs 143, security-0031-policies.sql into database rr, then
// CREATE DATABASE rr_tpl TEMPLATE rr.
//
// Run: bun scripts/activation-insurance-setting.db.test.ts
// Writes proposed/activation-insurance-setting/test-results.json. Exit 1 on any failure.
import postgres from "postgres";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { createHash, createHmac, randomUUID } from "node:crypto";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PKG_DIR = join(ROOT, "proposed/activation-insurance-setting");
const ADMIN_URL = "postgresql://postgres@127.0.0.1:55482/postgres?sslmode=disable";
const DB = "ais_test";
const DB_URL = `postgresql://postgres@127.0.0.1:55482/${DB}?sslmode=disable`;
const REST = "http://127.0.0.1:55483";
const SECRET = "activation-insurance-setting-local-jwt-secret-not-real-0000";
const PGRST_BIN = process.env.PGRST_BIN ?? "/tmp/pgrst/postgrest";
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: pat:disposable\n-- date: 2026-10-25T00:00:00.000Z";
for (const u of [ADMIN_URL, DB_URL, REST]) if (!/\/\/(postgres@)?127\.0\.0\.1:5548[23]\//.test(u + "/")) throw new Error(`refusing non-local target ${u}`);

const sha = (b: string | Buffer) => createHash("sha256").update(b).digest("hex");
const read = (f: string) => readFileSync(join(PKG_DIR, f), "utf8");
const PKG = read("activation_insurance_setting_v1.sql");
const REQ = read("request-activation-insurance-setting.sql");
const RB = read("rollback.sql");
const RB_REQ = read("request-rollback-activation-insurance-setting.sql");
const PREFLIGHT = read("preflight-readonly.sql");
const VERIFY = read("verify-after-readonly.sql");
const IVA_DIR = join(ROOT, "proposed/insurance-verification-authority");
const readIva = (f: string) => readFileSync(join(IVA_DIR, f), "utf8");
const IVA_PKG = readIva("insurance_verification_authority_v1.sql");
const IVA_REQ = readIva("request-insurance-verification-authority.sql");
const IVA_RB = readIva("rollback.sql");
const IVA_RB_REQ = readIva("request-rollback-insurance-verification-authority.sql");
const IVA_PREFLIGHT = readIva("preflight-readonly.sql");
const IVA_VERIFY = readIva("verify-after-readonly.sql");
const FAILPOINT = "-- TEST_FAILURE_POINT (only disposable test copies may inject failure here)";
const PROD_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';

// ---------------------------------------------------------------- results
type R = { id: string; name: string; actual: string; pass: boolean };
const results: R[] = [];
const evidence: Record<string, unknown> = {};
function record(id: string, name: string, pass: boolean, actual: string) {
  results.push({ id, name, actual, pass });
  console.log(`${pass ? "PASS" : "FAIL"} ${id} ${name} :: ${actual}`);
}
async function check(id: string, name: string, fn: () => Promise<string>) {
  try {
    record(id, name, true, await fn());
  } catch (e: any) {
    record(id, name, false, String(e?.message ?? e).slice(0, 400));
  }
}
function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}
async function refused(p: Promise<unknown>, re: RegExp): Promise<string> {
  try {
    await p;
  } catch (e: any) {
    const m = `${e?.code ?? ""} ${e?.message ?? e}`;
    if (re.test(m)) return m.trim();
    throw new Error(`refused with the wrong error: ${m}`);
  }
  throw new Error(`expected refusal matching ${re}`);
}

// ---------------------------------------------------------------- db helpers
const admin = postgres(ADMIN_URL, { max: 1, onnotice: () => {} });
let db: ReturnType<typeof postgres>;
function psql(text: string): { ok: boolean; out: string } {
  try {
    return { ok: true, out: execFileSync("psql", [DB_URL, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", text], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }) };
  } catch (e: any) {
    return { ok: false, out: String(e.stderr || e.stdout || e.message) };
  }
}
function localCopy(text: string, sid: string) {
  if (text.split(PROD_PROFILE).length !== 2) throw new Error("profile anchor missing");
  return text.replace(PROD_PROFILE, `"database": "${DB}", "system_identifier": "${sid}"`);
}

const OWNER = randomUUID(), MANAGER = randomUUID(), COORD = randomUUID();
function jwt(sub: string | null, role: string) {
  const b = (o: object) => Buffer.from(JSON.stringify(o)).toString("base64url");
  const claims: any = { role, aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 };
  if (sub) claims.sub = sub;
  const body = `${b({ alg: "HS256", typ: "JWT" })}.${b(claims)}`;
  return `${body}.${createHmac("sha256", SECRET).update(body).digest("base64url")}`;
}
const TOK = { owner: jwt(OWNER, "authenticated"), mgr: jwt(MANAGER, "authenticated"), coord: jwt(COORD, "authenticated"), anon: jwt(null, "anon"), service: jwt(null, "service_role") };
async function rest(method: string, path: string, token: string, body?: unknown) {
  const r = await fetch(`${REST}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", Prefer: "return=representation" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  return { status: r.status, text };
}

/** SQL exactly as PostgREST runs it: session authorization authenticator, role authenticated, JWT claims. */
async function asUser(sub: string, stmt: string) {
  return db.begin(async (tx: any) => {
    await tx.unsafe("SET LOCAL SESSION AUTHORIZATION authenticator");
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx`select set_config('request.jwt.claims', ${JSON.stringify({ sub, role: "authenticated" })}, true)`;
    return tx.unsafe(stmt);
  });
}
async function asService(stmt: string, params: any[] = []) {
  return db.begin(async (tx: any) => {
    await tx.unsafe("SET LOCAL ROLE service_role");
    return tx.unsafe(stmt, params);
  });
}

// One applicant, driver, vehicle and paperwork per scenario, so activations never collide.
type Fx = { app: string; driver: string; vehicle: string; actor: string };
async function fixture(o: { verified?: boolean; insuranceDoc?: boolean; appExpires?: string | null; docExpires?: string | null; agreement?: "esign" | "paper" | "paper_unaudited" | "none"; licence?: boolean; status?: string; interview?: boolean; inspection?: boolean } = {}): Promise<Fx> {
  const f = { app: randomUUID(), driver: randomUUID(), vehicle: randomUUID(), actor: MANAGER };
  const vin = ("1HGCM8263" + Math.random().toString(36).slice(2, 10).toUpperCase().replace(/[IOQ]/g, "A")).padEnd(17, "7").slice(0, 17);
  await db.begin(async (tx: any) => {
    // Seeding only: with M2 installed an application cannot be inserted as approved (that is the
    // point of M2). The activation calls below run with every trigger enabled.
    await tx`set local session_replication_role = replica`;
    await tx`insert into auth.users(id,email) values (${f.driver}, ${f.driver + "@test"})`;
    await tx`insert into public.applications(id, full_name, email, phone, status, user_id, insurance_expires_on) values (${f.app}, 'Test Driver', ${f.driver + "@test"}, '+15555550100', ${o.status ?? "approved"}, ${f.driver}, ${o.appExpires ?? null})`;
    await tx`insert into public.vehicles(id, year, make, model, vin, weekly_rate, status) values (${f.vehicle}, 2022, 'Toyota', 'Camry', ${vin}, 325, 'available')`;
    if (o.licence !== false) {
      await tx`insert into public.documents(driver_id, kind, category, storage_bucket, storage_path, is_current, review_status) values (${f.app}, 'document', 'license_front', 'driver-docs', ${f.app + "/lf.jpg"}, true, 'uploaded'), (${f.app}, 'document', 'license_back', 'driver-docs', ${f.app + "/lb.jpg"}, true, 'uploaded')`;
    }
    if (o.insuranceDoc !== false) {
      await tx`insert into public.documents(driver_id, kind, category, storage_bucket, storage_path, is_current, review_status, expires_at) values (${f.app}, 'document', 'insurance', 'driver-docs', ${f.app + "/in.jpg"}, true, 'uploaded', ${o.docExpires ?? null})`;
    }
    const ag = o.agreement ?? "esign";
    if (ag === "esign") await tx`insert into public.agreements(application_id, source, status, signed_at, body) values (${f.app}, 'rental', 'signed', now(), 'body')`;
    if (ag === "paper" || ag === "paper_unaudited") {
      const docId = randomUUID();
      const reviewedAt = "2026-10-20T15:00:00.123Z";
      await tx`insert into public.documents(id, driver_id, kind, category, storage_bucket, storage_path, is_current, review_status, reviewed_at) values (${docId}, ${f.app}, 'document', 'agreement', 'driver-docs', ${f.app + "/paper.pdf"}, true, 'verified', ${reviewedAt})`;
      if (ag === "paper") {
        await tx`insert into public.audit_log(actor_user_id, actor_role, action, entity_type, entity_id, summary, metadata) values (${MANAGER}, 'team', 'document.verified', 'application', ${f.app}, 'Verified signed agreement', ${tx.json({ documentId: docId, paper_agreement: true, storage_path: f.app + "/paper.pdf", reviewed_at: reviewedAt, reviewed_at_ms: Date.parse(reviewedAt), verifier_user_id: MANAGER, storage_bucket: "driver-docs", content_sha256: null, agreement_version: null })})`;
      }
    }
    await tx`insert into public.driver_screenings(lead_id, insurance_verified, interview_completed_at, insurance_carrier, insurance_policy_number) values (${f.app}, ${o.verified ?? true}, ${o.interview === false ? null : new Date().toISOString()}, 'Acme Mutual', 'POL 12 3456')`;
    if (o.inspection !== false) await tx`insert into public.inspections(vehicle_id, inspection_type, status, completed_at) values (${f.vehicle}, 'pre_delivery', 'passed', now())`;
  });
  return f;
}
const auditJson = (overrides: unknown = null) =>
  JSON.stringify({ actor_email: "manager@test", actor_role: "team", summary: "Activated 2022 Toyota Camry for Test Driver", account_created: false, overrides, ip: "203.0.113.7", user_agent: "db-test" }).replace(/'/g, "''");
const callSql = (f: Fx, ack: boolean, overrides: unknown = null) =>
  `select public.activate_rental_checked_tx('${f.app}','${f.vehicle}','${f.driver}',325,0,false,current_date,null,null,'${f.actor}',${ack},'${auditJson(overrides)}'::jsonb) as r`;
const activate = async (f: Fx, ack: boolean, overrides: unknown = null) => (await asService(callSql(f, ack, overrides)))[0].r;
async function setSettingRaw(allow: boolean | null) {
  // Test-only direct write as the superuser, through the same guard the setter uses.
  await db.begin(async (tx: any) => {
    await tx`select set_config('app.rental_activation_setting_write', 'on', true)`;
    if (allow === null) await tx`delete from public.app_settings where key = 'rental_activation'`;
    else await tx`insert into public.app_settings(key, value) values ('rental_activation', ${tx.json({ allow_activation_without_insurance_verification: allow })}) on conflict (key) do update set value = excluded.value`;
  });
}
const rentalCount = async (f: Fx) => Number((await db`select count(*)::int n from public.rentals where application_id = ${f.app}`)[0].n);
const checkedAudits = async (f: Fx) => db`select actor_user_id, actor_email, actor_role, entity_id, summary, ip, user_agent, metadata from public.audit_log where action = 'rental.activated' and metadata->>'application_id' = ${f.app}`;
const insuranceVerified = async (f: Fx) => (await db`select insurance_verified from public.driver_screenings where lead_id = ${f.app}`)[0].insurance_verified;

let pgrst: ChildProcess | null = null;
async function startRest() {
  if (!existsSync(PGRST_BIN)) return false;
  const conf = join(PKG_DIR, ".pgrst-local.conf");
  writeFileSync(conf, `db-uri = "postgresql://authenticator:harness-authenticator@127.0.0.1:55482/${DB}?sslmode=disable"\ndb-schemas = "public"\ndb-anon-role = "anon"\njwt-secret = "${SECRET}"\nserver-host = "127.0.0.1"\nserver-port = 55483\ndb-pool = 4\n`);
  pgrst = spawn(PGRST_BIN, [conf], { stdio: "ignore" });
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`${REST}/`);
      if (r.status < 500) return true;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}
async function reloadRest() {
  await db`select pg_notify('pgrst', 'reload schema')`;
  await new Promise((r) => setTimeout(r, 1500));
}

// ================================================================ main
try {
  const tpl = await admin`select 1 from pg_database where datname = 'rr_tpl'`;
  if (!tpl.length) throw new Error("template rr_tpl missing: build the production-order baseline first (README)");
  await admin.unsafe(`drop database if exists ${DB} with (force)`);
  await admin.unsafe(`create database ${DB} template rr_tpl`);
  db = postgres(DB_URL, { max: 6, onnotice: () => {} });
  const sid = String((await db`select system_identifier::text s from pg_control_system()`)[0].s);
  evidence.system_identifier_local = sid;
  evidence.server_version = (await db`select version() v`)[0].v;
  evidence.collation = (await db`select datcollate from pg_database where datname = current_database()`)[0].datcollate;

  // ---------------------------------------------------------- package
  await check("P0", "artifacts match SHA256SUMS", async () => {
    const sums = read("SHA256SUMS").trim().split("\n").map((l) => l.split(/\s+/));
    for (const [h, f] of sums) if (f !== "test-results.json") ok(sha(readFileSync(join(PKG_DIR, f))) === h, `checksum ${f}`);
    return `${sums.length} files`;
  });
  await check("P1", "preflight: every gate ok except the two local target rows", async () => {
    const rows = await db.unsafe(PREFLIGHT);
    const bad = rows.filter((r: any) => !r.ok).map((r: any) => r.check_name);
    ok(JSON.stringify(bad) === JSON.stringify(["target.database", "target.system_identifier"]), `bad rows ${bad}`);
    return `${rows.length} rows, only target rows differ`;
  });
  await check("P2", "real guarded request + trailer: guard passes, package refuses the foreign target, nothing persists", async () => {
    const r = psql(REQ + TRAILER);
    ok(!r.ok && /TARGET_MISMATCH/.test(r.out) && !/RRGUARD_/.test(r.out), r.out);
    ok((await db`select to_regprocedure('public.set_rental_activation_insurance_exception(boolean)') p`)[0].p === null, "setter persisted");
    return "TARGET_MISMATCH";
  });
  await check("P3", "tampered request (one package byte) refused by the guard before anything runs", async () => {
    const i = REQ.indexOf("ACTIVATE_RENTAL_TX_MISSING");
    ok(i > 0, "anchor");
    const r = psql(REQ.slice(0, i) + "X" + REQ.slice(i + 1) + TRAILER);
    ok(!r.ok && /RRGUARD_BYTES_MISMATCH/.test(r.out), r.out);
    return "RRGUARD_BYTES_MISMATCH";
  });
  await check("P4", "failure after the DDL rolls back everything (local copy, injected failure)", async () => {
    ok(PKG.split(FAILPOINT).length === 2, "failpoint anchor");
    const r = psql(localCopy(PKG, sid).replace(FAILPOINT, "RAISE EXCEPTION 'INJECTED_FAILURE';"));
    ok(!r.ok && /INJECTED_FAILURE/.test(r.out), r.out);
    const [s] = await db`select to_regprocedure('public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean,jsonb)') w, (select count(*)::int from public.app_settings where key = 'rental_activation') k, (select count(*)::int from pg_policy where polname like 'rental_activation_setting_%') p`;
    ok(s.w === null && s.k === 0 && s.p === 0, JSON.stringify(s));
    return "nothing persisted";
  });
  await check("P5", "local copy (target profile substituted only) installs; postconditions pass", async () => {
    const r = psql(localCopy(PKG, sid));
    ok(r.ok, r.out);
    return "installed";
  });
  await check("P6", "verify-after-readonly: every row ok", async () => {
    const rows = await db.unsafe(VERIFY);
    const bad = rows.filter((r: any) => !r.ok).map((r: any) => r.check_name);
    ok(bad.length === 0, `bad rows ${bad}`);
    evidence.verify_after = rows.map((r: any) => `${r.check_name}=${r.actual}`);
    return `${rows.length} rows ok`;
  });
  await check("P7", "re-run refused (AIS_EVIDENCE_REPLAY)", async () => {
    const r = psql(localCopy(PKG, sid));
    ok(!r.ok && /AIS_EVIDENCE_REPLAY/.test(r.out), r.out);
    return "AIS_EVIDENCE_REPLAY";
  });

  // ---------------------------------------------------------- insurance verification authority package
  await check("VP0", "IVA artifacts match SHA256SUMS", async () => {
    const sums = readIva("SHA256SUMS").trim().split("\n").map((l) => l.split(/\s+/));
    for (const [h, f] of sums) if (f !== "test-results.json") ok(sha(readFileSync(join(IVA_DIR, f))) === h, `checksum ${f}`);
    return `${sums.length} files`;
  });
  await check("VP1", "IVA preflight: every gate ok except the two local target rows", async () => {
    const rows = await db.unsafe(IVA_PREFLIGHT);
    const bad = rows.filter((r: any) => !r.ok).map((r: any) => r.check_name);
    ok(JSON.stringify(bad) === JSON.stringify(["target.database", "target.system_identifier"]), `bad rows ${bad}`);
    return `${rows.length} rows`;
  });
  await check("VP2", "IVA real guarded request + trailer: guard passes, package refuses the foreign target", async () => {
    const r = psql(IVA_REQ + TRAILER);
    ok(!r.ok && /TARGET_MISMATCH/.test(r.out) && !/RRGUARD_/.test(r.out), r.out);
    return "TARGET_MISMATCH";
  });
  await check("VP3", "IVA tampered request refused by the guard", async () => {
    const i = IVA_REQ.indexOf("IVA_PARTIAL_INSTALL");
    ok(i > 0, "anchor");
    const r = psql(IVA_REQ.slice(0, i) + "X" + IVA_REQ.slice(i + 1) + TRAILER);
    ok(!r.ok && /RRGUARD_BYTES_MISMATCH/.test(r.out), r.out);
    return "RRGUARD_BYTES_MISMATCH";
  });
  await check("VP4", "IVA failure after the DDL rolls back everything", async () => {
    ok(IVA_PKG.split(FAILPOINT).length === 2, "failpoint anchor");
    const r = psql(localCopy(IVA_PKG, sid).replace(FAILPOINT, "RAISE EXCEPTION 'INJECTED_FAILURE';"));
    ok(!r.ok && /INJECTED_FAILURE/.test(r.out), r.out);
    const [x] = await db`select to_regprocedure('public.set_insurance_verification(uuid,boolean,text)') f, (select count(*)::int from pg_trigger where tgname = 'zz_insurance_decision_guard') t`;
    ok(x.f === null && x.t === 0, JSON.stringify(x));
    return "nothing persisted";
  });
  await check("VP5", "IVA local copy installs; public.applications fingerprint unchanged (checked by the package)", async () => {
    const r = psql(localCopy(IVA_PKG, sid));
    ok(r.ok, r.out);
    return "installed";
  });
  await check("VP6", "IVA verify-after-readonly: every row ok", async () => {
    const rows = await db.unsafe(IVA_VERIFY);
    const bad = rows.filter((r: any) => !r.ok).map((r: any) => r.check_name);
    ok(bad.length === 0, `bad rows ${bad}`);
    return `${rows.length} rows ok`;
  });
  await check("VP7", "IVA re-run refused (IVA_EVIDENCE_REPLAY)", async () => {
    const r = psql(localCopy(IVA_PKG, sid));
    ok(!r.ok && /IVA_EVIDENCE_REPLAY/.test(r.out), r.out);
    return "IVA_EVIDENCE_REPLAY";
  });

  // ---------------------------------------------------------- transaction boundary (inspection)
  await check("B1", "wrapper and activate_rental_tx: plpgsql, SECURITY DEFINER, SET clauses, no autonomous work; wrapper has no exception handler", async () => {
    const rows = await db`select p.proname, l.lanname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) def from pg_proc p join pg_language l on l.oid = p.prolang where p.oid in ('public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean,jsonb)'::regprocedure, 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::regprocedure)`;
    const out: Record<string, unknown> = {};
    for (const r of rows as any[]) {
      out[r.proname] = { lang: r.lanname, security_definer: r.prosecdef, config: r.proconfig, exception_block: /\bEXCEPTION\s+WHEN\b/i.test(r.def), autonomous: /dblink|pg_background|\bCOMMIT\b|\bROLLBACK\b/i.test(r.def) };
      ok(r.lanname === "plpgsql" && r.prosecdef === true, `${r.proname} shape`);
      ok(!/dblink|pg_background|\bCOMMIT\b|\bROLLBACK\b/i.test(r.def), `${r.proname} autonomous`);
    }
    ok((out as any).activate_rental_checked_tx.exception_block === false, "wrapper must not catch");
    evidence.function_shapes = out;
    const ext = await db`select extname from pg_extension where extname in ('dblink','pg_background')`;
    ok(ext.length === 0, "dblink/pg_background installed");
    return JSON.stringify(out);
  });

  // ---------------------------------------------------------- roles fixtures
  await db.begin(async (tx: any) => {
    await tx`insert into auth.users(id,email) values (${OWNER}, 'owner@test'), (${MANAGER}, 'manager@test'), (${COORD}, 'coord@test')`;
    await tx`insert into public.user_roles(user_id, role) values (${OWNER}, 'admin'), (${MANAGER}, 'team'), (${COORD}, 'coordinator')`;
  });
  const restUp = await startRest();
  record("R0", "local PostgREST 12 on 127.0.0.1:55483", restUp, restUp ? "up" : `not available at ${PGRST_BIN}; REST rows skipped`);

  // ---------------------------------------------------------- 1-3 activation rules
  await check("T1", "setting OFF + insurance unverified: refused even with the acknowledgement (no override path in the transaction)", async () => {
    await setSettingRaw(false);
    const f = await fixture({ verified: false });
    const m = await refused(activate(f, true), /insurance_not_verified:unverified/);
    ok((await rentalCount(f)) === 0 && (await checkedAudits(f)).length === 0, "partial write");
    return m;
  });
  await check("T1b", "setting OFF + verified-but-expired (application date, then document date): refused", async () => {
    const a = await fixture({ appExpires: "2020-01-01" });
    const b = await fixture({ docExpires: "2020-01-01" });
    return [await refused(activate(a, true), /insurance_not_verified:expired/), await refused(activate(b, true), /insurance_not_verified:expired/)].join(" | ");
  });
  await check("T2", "setting ON + unverified: refused without the acknowledgement; permitted with it; insurance never marked verified", async () => {
    await setSettingRaw(true);
    const f = await fixture({ verified: false });
    const m = await refused(activate(f, false), /insurance_ack_required:unverified/);
    const r = await activate(f, true);
    ok(r.exception_used === true && r.insurance_status === "unverified" && r.setting_allow === true && r.acknowledged === true, JSON.stringify(r));
    const [a] = await checkedAudits(f);
    const ins = a?.metadata.insurance;
    ok(ins?.exception_used === true && ins.acknowledged === true && ins.setting_allow_without_verification === true && ins.acting_user_id === MANAGER && ins.status === "unverified" && ins.at && a.metadata.transaction_id && a.actor_user_id === MANAGER && a.actor_role === "team" && a.entity_id === r.rental_id && a.ip === "203.0.113.7", JSON.stringify(a));
    ok((await insuranceVerified(f)) === false, "insurance flipped to verified");
    evidence.exception_audit = a;
    return `${m} → then ok with ack`;
  });
  await check("T2b", "setting ON + missing / expired: permitted only with the acknowledgement", async () => {
    const miss = await fixture({ verified: false, insuranceDoc: false });
    const exp = await fixture({ appExpires: "2020-01-01" });
    await refused(activate(miss, false), /insurance_ack_required:missing/);
    await refused(activate(exp, false), /insurance_ack_required:expired/);
    const a = await activate(miss, true), b = await activate(exp, true);
    ok(a.insurance_status === "missing" && b.insurance_status === "expired" && a.exception_used && b.exception_used, "statuses");
    return "missing, expired";
  });
  await check("T2c", "setting ON never bypasses other requirements: agreement, licence, approval, vehicle readiness", async () => {
    const noAg = await fixture({ verified: false, agreement: "none" });
    const noLic = await fixture({ verified: false, licence: false });
    const notApproved = await fixture({ verified: false, status: "reviewing" });
    const badVeh = await fixture({ verified: false });
    await db`update public.vehicles set vin = 'BAD' where id = ${badVeh.vehicle}`;
    const out = [
      await refused(activate(noAg, true), /no_signed_agreement/),
      await refused(activate(noLic, true), /missing_documents/),
      await refused(activate(notApproved, true), /not_approved/),
      await refused(activate(badVeh, true), /vehicle_not_rental_ready/),
    ];
    for (const f of [noAg, noLic, notApproved, badVeh]) ok((await rentalCount(f)) === 0, "rental written");
    return out.map((s) => s.split(" ").pop()).join(", ");
  });
  await check("T3", "setting ON + verified: normal activation, exception not used", async () => {
    const f = await fixture();
    const r = await activate(f, false);
    ok(r.exception_used === false && r.insurance_status === "verified", JSON.stringify(r));
    return "ok";
  });
  await check("T3b", "paper agreement: counts only with its audited Manager/Owner verification", async () => {
    await setSettingRaw(false);
    const good = await fixture({ agreement: "paper" });
    const bare = await fixture({ agreement: "paper_unaudited" });
    const r = await activate(good, false);
    ok(r.signed_agreement === "paper", JSON.stringify(r));
    return `audited paper ok; ${await refused(activate(bare, true), /no_signed_agreement/)}`;
  });

  // ---------------------------------------------------------- overrides and audit, in the transaction
  await check("A1", "soft blockers re-checked in the transaction: interview / inspection unmet without an override refuse", async () => {
    await setSettingRaw(false);
    const noInt = await fixture({ interview: false });
    const noInsp = await fixture({ inspection: false });
    return [await refused(activate(noInt, false), /override_required:no_interview/), await refused(activate(noInsp, false), /override_required:no_passed_inspection/)].join(" | ");
  });
  await check("A2", "overrides: only no_interview / no_passed_inspection, with a reason of 5+ characters; recorded in rental.activated", async () => {
    const f = await fixture({ inspection: false, verified: false, agreement: "none" });
    const out = [
      await refused(activate(f, true, { blockers: [{ code: "no_signed_agreement" }], reason: "owner said so" }), /override_not_allowed:no_signed_agreement|no_signed_agreement/),
    ];
    const g = await fixture({ inspection: false, verified: false });
    out.push(await refused(activate(g, true, { blockers: [{ code: "insurance_not_verified" }, { code: "no_passed_inspection" }], reason: "owner said so" }), /insurance_not_verified:unverified/));
    const h = await fixture({ inspection: false });
    out.push(await refused(activate(h, false, { blockers: [{ code: "no_passed_inspection" }], reason: "ok " }), /override_reason_required/));
    out.push(await refused(activate(h, false, { blockers: [{ code: "no_passed_inspection" }, { code: "vehicle_busy" }], reason: "Checked at the lot" }), /override_not_allowed:vehicle_busy/));
    const r = await activate(h, false, { blockers: [{ code: "no_passed_inspection", message: "No passed pre-delivery inspection" }], reason: "Checked at the lot by the owner" });
    const [a] = await checkedAudits(h);
    ok(a.metadata.overrides.reason === "Checked at the lot by the owner" && a.metadata.overrides.blockers[0].code === "no_passed_inspection" && a.metadata.overrides.by === MANAGER && a.metadata.overrides.at && a.metadata.checks.inspection_passed === false && a.entity_id === r.rental_id, JSON.stringify(a));
    evidence.override_audit = a;
    return out.map((x) => x.split(" ").pop()).join(", ") + " | override with reason ok, audited with blockers/actor/driver/vehicle/time";
  });
  await check("A3", "activation and its rental.activated row commit together: an injected audit failure leaves no rental", async () => {
    const f = await fixture();
    await db.unsafe(`create function public.ais_test_fail_audit() returns trigger language plpgsql as $$ begin if NEW.action = 'rental.activated' then raise exception 'INJECTED_AUDIT_FAILURE'; end if; return NEW; end $$;
      create trigger ais_test_fail_audit before insert on public.audit_log for each row execute function public.ais_test_fail_audit()`);
    let m = "";
    try {
      m = await refused(activate(f, false), /INJECTED_AUDIT_FAILURE/);
    } finally {
      await db.unsafe("drop trigger ais_test_fail_audit on public.audit_log; drop function public.ais_test_fail_audit()");
    }
    ok((await rentalCount(f)) === 0 && (await checkedAudits(f)).length === 0, "rental without audit");
    const [st] = await db`select status from public.applications where id = ${f.app}`;
    const [v] = await db`select status from public.vehicles where id = ${f.vehicle}`;
    ok(st.status === "approved" && v.status === "available", "application/vehicle changed");
    const r = await activate(f, false);
    const [a] = await checkedAudits(f);
    ok(a && a.entity_id === r.rental_id && (await rentalCount(f)) === 1, "both present on success");
    return `${m}; nothing written; then both present`;
  });
  await check("A4", "the acting user must be a Manager or Owner in the database too (Coordinator or unknown actor refused)", async () => {
    const f = await fixture();
    const out = [await refused(activate({ ...f, actor: COORD }, false), /actor_not_manager/), await refused(activate({ ...f, actor: randomUUID() }, false), /actor_not_manager/)];
    ok((await rentalCount(f)) === 0, "rental written");
    return out.join(" | ");
  });

  // ---------------------------------------------------------- 4-7 permissions
  const settingNow = async () => (await db`select value from public.app_settings where key = 'rental_activation'`)[0]?.value;
  for (const [id, who, sub, tok] of [["T4", "Manager", MANAGER, TOK.mgr], ["T5", "Coordinator", COORD, TOK.coord]] as const) {
    await check(id, `${who} cannot change the setting: setter RPC, direct UPDATE/INSERT/DELETE (SQL as authenticated) and PostgREST`, async () => {
      await setSettingRaw(false);
      const out: string[] = [];
      out.push(await refused(asUser(sub, "select public.set_rental_activation_insurance_exception(true)"), /owner_required/));
      const upd = await asUser(sub, `update public.app_settings set value = '{"allow_activation_without_insurance_verification": true}' where key = 'rental_activation' returning key`);
      ok(upd.length === 0, "update matched a row");
      out.push("UPDATE 0 rows");
      out.push(await refused(asUser(sub, `insert into public.app_settings(key, value) values ('rental_activation', '{"allow_activation_without_insurance_verification": true}') on conflict (key) do update set value = excluded.value`), /row-level security|rental_activation_setting_owner_rpc_only|42501/));
      const del = await asUser(sub, `delete from public.app_settings where key = 'rental_activation' returning key`);
      ok(del.length === 0, "delete matched a row");
      if (restUp) {
        const a = await rest("POST", "/rpc/set_rental_activation_insurance_exception", tok, { _allow: true });
        ok(a.status >= 400 && /owner_required/.test(a.text), `rpc ${a.status} ${a.text}`);
        const b = await rest("PATCH", "/app_settings?key=eq.rental_activation", tok, { value: { allow_activation_without_insurance_verification: true } });
        ok(b.status === 200 && b.text === "[]", `patch ${b.status} ${b.text}`);
        out.push(`REST rpc ${a.status}, PATCH ${b.status} []`);
      }
      ok((await settingNow())?.allow_activation_without_insurance_verification === false, "setting changed");
      ok((await db`select count(*)::int n from public.audit_log where action = 'settings.rental_activation_updated' and actor_user_id = ${sub}`)[0].n === 0, "audit row for a refused change");
      return out.join(" | ");
    });
  }
  await check("T6", "Owner changes it through the setter: saved and audited (actor, old -> new, time) in the same transaction", async () => {
    await setSettingRaw(false);
    let r: any;
    if (restUp) {
      const a = await rest("POST", "/rpc/set_rental_activation_insurance_exception", TOK.owner, { _allow: true });
      ok(a.status === 200, `${a.status} ${a.text}`);
      r = JSON.parse(a.text);
    } else r = (await asUser(OWNER, "select public.set_rental_activation_insurance_exception(true) r"))[0].r;
    ok(r.from === false && r.to === true && r.audit_id, JSON.stringify(r));
    ok((await settingNow())?.allow_activation_without_insurance_verification === true, "not saved");
    const [a] = await db`select actor_user_id, actor_role, metadata, created_at from public.audit_log where id = ${r.audit_id}`;
    ok(a.actor_user_id === OWNER && a.metadata.from === false && a.metadata.to === true && a.metadata.changed_at && a.created_at, JSON.stringify(a));
    evidence.owner_change_audit = a;
    return `${restUp ? "via PostgREST" : "via SQL"}: off -> on, audit ${r.audit_id}`;
  });
  await check("T6b", "even the Owner cannot write the key directly (only the audited setter); service_role cannot either", async () => {
    const out: string[] = [];
    const upd = await asUser(OWNER, `update public.app_settings set value = '{"allow_activation_without_insurance_verification": false}' where key = 'rental_activation' returning key`);
    ok(upd.length === 0, "owner direct update matched");
    out.push("owner UPDATE 0 rows (restrictive policy)");
    out.push(await refused(asService(`update public.app_settings set value = '{"allow_activation_without_insurance_verification": false}' where key = 'rental_activation'`), /rental_activation_setting_owner_rpc_only/));
    out.push(await refused(asService(`select set_config('app.rental_activation_setting_write','on',true); update public.app_settings set value = '{}' where key = 'rental_activation'`), /rental_activation_setting_owner_rpc_only/));
    out.push(await refused(asService("select public.set_rental_activation_insurance_exception(false)"), /permission denied/));
    ok((await settingNow())?.allow_activation_without_insurance_verification === true, "setting changed");
    const other = await asUser(OWNER, `insert into public.app_settings(key, value) values ('ais_probe', '{}') on conflict (key) do update set value = excluded.value returning key`);
    ok(other.length === 1, "other keys must stay Owner-writable");
    out.push("other keys still Owner-writable (1 row)");
    return out.join(" | ");
  });
  await check("T7", "direct API bypass: the wrapper and activate_rental_tx are not executable by authenticated or anon", async () => {
    const f = await fixture({ verified: false });
    const out: string[] = [];
    for (const sub of [OWNER, MANAGER]) {
      out.push(await refused(asUser(sub, callSql(f, true)), /permission denied for function activate_rental_checked_tx/));
      out.push(await refused(asUser(sub, `select public.activate_rental_tx('${f.app}','${f.vehicle}','${f.driver}',325,0,false,current_date,null,null,'${sub}')`), /permission denied for function activate_rental_tx/));
    }
    if (restUp) {
      const body = { _application_id: f.app, _vehicle_id: f.vehicle, _driver_id: f.driver, _weekly_rate: 325, _deposit: 0, _deposit_held: false, _start: "2026-10-25", _end: null, _pickup_miles: null, _actor: OWNER, _insurance_exception_ack: true, _audit: { summary: "x" } };
      for (const [t, name] of [[TOK.owner, "owner"], [TOK.mgr, "manager"], [TOK.anon, "anon"]] as const) {
        const a = await rest("POST", "/rpc/activate_rental_checked_tx", t, body);
        ok(a.status === 401 || a.status === 403, `${name} wrapper ${a.status} ${a.text}`);
        const { _insurance_exception_ack, _audit, ...legacy } = body;
        const b = await rest("POST", "/rpc/activate_rental_tx", t, legacy);
        ok(b.status === 401 || b.status === 403, `${name} activate ${b.status} ${b.text}`);
        out.push(`REST ${name}: ${a.status}/${b.status}`);
      }
    }
    ok((await rentalCount(f)) === 0, "rental written");
    return out.map((s) => s.slice(0, 60)).join(" | ");
  });
  await check("T8", "missing setting row reads OFF; the Owner setter recreates it (audited, from_row_present=false)", async () => {
    await setSettingRaw(null);
    const f = await fixture({ verified: false });
    const m = await refused(activate(f, true), /insurance_not_verified:unverified/);
    const r = (await asUser(OWNER, "select public.set_rental_activation_insurance_exception(true) r"))[0].r;
    const [a] = await db`select metadata from public.audit_log where id = ${r.audit_id}`;
    ok(r.from === false && a.metadata.from_row_present === false, JSON.stringify(a));
    await setSettingRaw(null);
    await db.begin(async (tx: any) => {
      await tx`select set_config('app.rental_activation_setting_write', 'on', true)`;
      await tx`insert into public.app_settings(key, value) values ('rental_activation', ${tx.json({ allow_activation_without_insurance_verification: "true" })})`;
    });
    const m2 = await refused(activate(f, true), /insurance_not_verified/);
    return `${m} | non-boolean "true" also OFF: ${m2.split(" ").pop()}`;
  });

  // ---------------------------------------------------------- insurance verification authority
  const screening = async (f: Fx) => (await db`select insurance_verified, insurance_verified_at, insurance_verified_by, insurance_carrier, insurance_policy_number from public.driver_screenings where lead_id = ${f.app}`)[0];
  const decisions = async (f: Fx) => db`select action, actor_user_id, actor_role, created_at, metadata from public.audit_log where action in ('insurance.verified','insurance.verification_revoked') and entity_id = ${f.app} order by created_at`;
  await check("V1", "Coordinator cannot verify or revoke: setter (SQL as authenticated and PostgREST)", async () => {
    const f = await fixture({ verified: false });
    const out = [await refused(asUser(COORD, `select public.set_insurance_verification('${f.app}', true, null)`), /manager_required/)];
    if (restUp) {
      const a = await rest("POST", "/rpc/set_insurance_verification", TOK.coord, { _application_id: f.app, _verified: true, _note: null });
      ok(a.status === 403 && /manager_required/.test(a.text), `${a.status} ${a.text}`);
      out.push(`REST ${a.status}`);
    }
    ok((await screening(f)).insurance_verified === false && (await decisions(f)).length === 0, "decision written");
    return out.join(" | ");
  });
  await check("V2", "Coordinator (and Manager, Owner, service_role) cannot write the decision columns directly; INSERT as verified refused", async () => {
    const f = await fixture({ verified: false });
    const out: string[] = [];
    for (const sub of [COORD, MANAGER, OWNER]) {
      out.push(await refused(asUser(sub, `update public.driver_screenings set insurance_verified = true where lead_id = '${f.app}'`), /insurance_decision_manager_rpc_only/));
    }
    out.push(await refused(asUser(COORD, `update public.driver_screenings set insurance_verified_at = now() where lead_id = '${f.app}'`), /insurance_decision_manager_rpc_only/));
    out.push(await refused(asUser(COORD, `update public.driver_screenings set insurance_verified_by = 'me' where lead_id = '${f.app}'`), /insurance_decision_manager_rpc_only/));
    out.push(await refused(asService(`update public.driver_screenings set insurance_verified = true where lead_id = '${f.app}'`), /insurance_decision_manager_rpc_only/));
    const g = await fixture({ verified: false });
    await db`delete from public.driver_screenings where lead_id = ${g.app}`;
    out.push(await refused(asUser(COORD, `insert into public.driver_screenings(lead_id, insurance_verified) values ('${g.app}', true)`), /insurance_decision_manager_rpc_only/));
    if (restUp) {
      const a = await rest("PATCH", `/driver_screenings?lead_id=eq.${f.app}`, TOK.coord, { insurance_verified: true });
      ok(a.status === 403 && /insurance_decision_manager_rpc_only/.test(a.text), `${a.status} ${a.text}`);
      out.push(`REST PATCH ${a.status}`);
    }
    ok((await screening(f)).insurance_verified === false, "decision changed");
    return out.map((x) => x.slice(0, 45)).join(" | ");
  });
  await check("V3", "Coordinator may still enter/update insurance information and other screening fields (SQL and PostgREST)", async () => {
    const f = await fixture({ verified: false });
    const r1 = await asUser(COORD, `update public.driver_screenings set insurance_carrier = 'Beta Insurance', insurance_policy_number = 'NEW-99', insurance_carrier_phone = '555', policy_active = true, insurance_name_matches_license = true where lead_id = '${f.app}' returning id`);
    ok(r1.length === 1, "update rows");
    // A full-row upsert that carries the decision columns unchanged (what an older client sends) is allowed.
    await asUser(COORD, `insert into public.driver_screenings(lead_id, insurance_verified, interview_notes) values ('${f.app}', false, 'note') on conflict (lead_id) do update set interview_notes = excluded.interview_notes, insurance_verified = excluded.insurance_verified`);
    if (restUp) {
      const a = await rest("PATCH", `/driver_screenings?lead_id=eq.${f.app}`, TOK.coord, { insurance_carrier: "Gamma" });
      ok(a.status === 200, `${a.status} ${a.text}`);
    }
    const s2 = await screening(f);
    ok(s2.insurance_carrier === (restUp ? "Gamma" : "Beta Insurance") && s2.insurance_verified === false, JSON.stringify(s2));
    return "information fields written; decision unchanged";
  });
  for (const [id, who, sub, tok] of [["V4", "Manager", MANAGER, TOK.mgr], ["V5", "Owner", OWNER, TOK.owner]] as const) {
    await check(id, `${who} verifies and revokes through the setter; each decision audited with actor, time, document id/SHA, insurer, policy reference`, async () => {
      const f = await fixture({ verified: false });
      await db`update public.documents set content_sha256 = ${"ef".repeat(32)} where driver_id = ${f.app} and category = 'insurance'`;
      let v: any;
      if (restUp) {
        const a = await rest("POST", "/rpc/set_insurance_verification", tok, { _application_id: f.app, _verified: true, _note: "Called Acme" });
        ok(a.status === 200, `${a.status} ${a.text}`);
        v = JSON.parse(a.text);
      } else v = (await asUser(sub, `select public.set_insurance_verification('${f.app}', true, 'Called Acme') r`))[0].r;
      const s1 = await screening(f);
      ok(s1.insurance_verified === true && s1.insurance_verified_at && s1.insurance_verified_by === (who === "Manager" ? "manager@test" : "owner@test"), JSON.stringify(s1));
      await asUser(sub, `select public.set_insurance_verification('${f.app}', false, 'Policy cancelled')`);
      const s2 = await screening(f);
      ok(s2.insurance_verified === false && s2.insurance_verified_at === null && s2.insurance_verified_by === null, JSON.stringify(s2));
      const d = await decisions(f);
      ok(d.length === 2 && d[0].action === "insurance.verified" && d[1].action === "insurance.verification_revoked", JSON.stringify(d.map((x: any) => x.action)));
      const m = d[0].metadata;
      ok(d[0].actor_user_id === sub && d[0].actor_role === (who === "Manager" ? "team" : "admin") && m.decided_at && m.document?.content_sha256 === "ef".repeat(32) && m.document.id && m.insurer === "Acme Mutual" && m.policy_number_last4 === "3456" && /^[0-9a-f]{64}$/.test(m.policy_number_sha256) && !JSON.stringify(m).includes("POL123456"), JSON.stringify(m));
      ok(d[1].metadata.from === true && d[1].metadata.to === false && d[1].metadata.note === "Policy cancelled", "revocation audit");
      if (who === "Manager") evidence.verification_audit = d[0];
      return `${restUp ? "PostgREST" : "SQL"} verify, then revoke; 2 audit rows (audit ${v.audit_id})`;
    });
  }
  await check("V6", "an audit write failure refuses the verification decision (nothing changed)", async () => {
    const f = await fixture({ verified: false });
    await db.unsafe(`create function public.iva_test_fail_audit() returns trigger language plpgsql as $$ begin if NEW.action like 'insurance.%' then raise exception 'INJECTED_AUDIT_FAILURE'; end if; return NEW; end $$;
      create trigger iva_test_fail_audit before insert on public.audit_log for each row execute function public.iva_test_fail_audit()`);
    let m = "";
    try {
      m = await refused(asUser(MANAGER, `select public.set_insurance_verification('${f.app}', true, null)`), /INJECTED_AUDIT_FAILURE/);
    } finally {
      await db.unsafe("drop trigger iva_test_fail_audit on public.audit_log; drop function public.iva_test_fail_audit()");
    }
    ok((await screening(f)).insurance_verified === false, "decision applied without audit");
    return m;
  });
  await check("I1", "independence: the Owner setting ON grants no verification rights (Coordinator still refused)", async () => {
    await setSettingRaw(true);
    const f = await fixture({ verified: false });
    const m = await refused(asUser(COORD, `select public.set_insurance_verification('${f.app}', true, null)`), /manager_required/);
    const m2 = await refused(asUser(COORD, `update public.driver_screenings set insurance_verified = true where lead_id = '${f.app}'`), /insurance_decision_manager_rpc_only/);
    return `${m} | ${m2}`;
  });
  await check("I2", "independence: verification rights do not imply exception use; setting OFF: nobody (Owner included) activates with unverified insurance", async () => {
    await setSettingRaw(false);
    const out: string[] = [];
    for (const actor of [MANAGER, OWNER]) {
      const f = { ...(await fixture({ verified: false })), actor };
      out.push(await refused(activate(f, true, { blockers: [{ code: "no_interview" }], reason: "owner says go" }), /insurance_not_verified/));
    }
    return out.join(" | ");
  });
  await check("I3", "independence: setting ON — a Manager and an Owner each use the exception with the acknowledgement; insurance stays unverified", async () => {
    await setSettingRaw(true);
    const out: string[] = [];
    for (const actor of [MANAGER, OWNER]) {
      const f = { ...(await fixture({ verified: false })), actor };
      await refused(activate(f, false), /insurance_ack_required/);
      const r = await activate(f, true);
      const [a] = await checkedAudits(f);
      ok(r.exception_used === true && a.actor_user_id === actor && a.metadata.insurance.exception_used === true, "exception audit");
      ok((await screening(f)).insurance_verified === false && (await decisions(f)).length === 0, "the exception marked insurance verified");
      out.push(`${actor === MANAGER ? "Manager" : "Owner"} ok`);
    }
    return out.join(", ");
  });
  await check("I4", "independence: a Coordinator cannot activate even with the setting ON (database actor check)", async () => {
    await setSettingRaw(true);
    const f = { ...(await fixture({ verified: false })), actor: COORD };
    return await refused(activate(f, true), /actor_not_manager/);
  });
  await check("V7", "revocation racing an activation: the setter waits for the activation's FOR SHARE, or the activation waits and sees the revocation", async () => {
    await setSettingRaw(false);
    const f = await fixture();
    const A = await db.reserve();
    const B = await db.reserve();
    try {
      await B.unsafe("BEGIN");
      await B.unsafe("SET LOCAL SESSION AUTHORIZATION authenticator");
      await B.unsafe("SET LOCAL ROLE authenticated");
      await B.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: MANAGER, role: "authenticated" })}', true)`);
      await B.unsafe(`select public.set_insurance_verification('${f.app}', false, 'cancelled')`);
      await A.unsafe("BEGIN");
      await A.unsafe("SET LOCAL ROLE service_role");
      let aErr: any = null;
      const p = A.unsafe(callSql(f, false)).catch((e: any) => (aErr = e));
      await new Promise((res) => setTimeout(res, 500));
      await B.unsafe("COMMIT");
      await p;
      await A.unsafe("ROLLBACK");
      ok(aErr && /insurance_not_verified:unverified/.test(aErr.message), String(aErr?.message));
      return `activation waited for the revocation's commit, then ${aErr.message}`;
    } finally {
      for (const c of [A, B]) { try { await c.unsafe("ROLLBACK"); } catch {} c.release(); }
    }
  });

  // ---------------------------------------------------------- 9 concurrency and the transaction boundary
  await check("T9a", "activation holds the setting row FOR SHARE until commit: Owner NOWAIT fails, Owner update blocks, then applies after", async () => {
    await setSettingRaw(true);
    const f = await fixture({ verified: false });
    const A = await db.reserve();
    const B = await db.reserve();
    const C = await db.reserve();
    try {
      await A.unsafe("BEGIN");
      await A.unsafe("SET LOCAL ROLE service_role");
      const r = (await A.unsafe(callSql(f, true)))[0].r;
      ok(r.exception_used === true, "activation inside open transaction");
      const aPid = (await A.unsafe("select pg_backend_pid() p"))[0].p;
      const nowait = await refused(C.unsafe("select 1 from public.app_settings where key = 'rental_activation' for update nowait"), /55P03|could not obtain lock/);
      await B.unsafe("BEGIN");
      await B.unsafe("SET LOCAL SESSION AUTHORIZATION authenticator");
      await B.unsafe("SET LOCAL ROLE authenticated");
      await B.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: OWNER, role: "authenticated" })}', true)`);
      const bPid = (await B.unsafe("select pg_backend_pid() p"))[0].p;
      let bDone = false;
      const bPromise = B.unsafe("select public.set_rental_activation_insurance_exception(false) r").then((x: any) => ((bDone = true), x));
      await new Promise((res) => setTimeout(res, 700));
      const [w] = await C.unsafe(`select wait_event_type, wait_event, pg_blocking_pids(pid) blockers from pg_stat_activity where pid = ${bPid}`);
      ok(!bDone && w.wait_event_type === "Lock" && w.blockers.includes(aPid), `B not blocked by A: ${JSON.stringify(w)}`);
      await A.unsafe("COMMIT");
      const br = (await bPromise)[0].r;
      await B.unsafe("COMMIT");
      ok(br.from === true && br.to === false, JSON.stringify(br));
      const [order] = await db`select (select created_at from public.audit_log where action = 'rental.activated' and metadata->>'application_id' = ${f.app}) < (select created_at from public.audit_log where id = ${br.audit_id}) ordered`;
      ok(order.ordered === true, "activation must precede the Owner change");
      evidence.concurrency_a = { blocked_wait_event: `${w.wait_event_type}/${w.wait_event}`, blocking_pids: w.blockers, nowait_error: nowait, owner_change_after_commit: br };
      return `NOWAIT: ${nowait.slice(0, 40)}; blocked on ${w.wait_event_type}/${w.wait_event} by A; after A commit Owner change on -> off`;
    } finally {
      for (const c of [A, B, C]) { try { await c.unsafe("ROLLBACK"); } catch {} c.release(); }
    }
  });
  await check("T9b", "Owner switches OFF while an activation waits: the activation's own locked read sees OFF and refuses", async () => {
    await setSettingRaw(true);
    const f = await fixture({ verified: false });
    const A = await db.reserve();
    const B = await db.reserve();
    try {
      await B.unsafe("BEGIN");
      await B.unsafe("SET LOCAL SESSION AUTHORIZATION authenticator");
      await B.unsafe("SET LOCAL ROLE authenticated");
      await B.unsafe(`select set_config('request.jwt.claims', '${JSON.stringify({ sub: OWNER, role: "authenticated" })}', true)`);
      await B.unsafe("select public.set_rental_activation_insurance_exception(false)");
      await A.unsafe("BEGIN");
      await A.unsafe("SET LOCAL ROLE service_role");
      let aErr: any = null;
      const aPromise = A.unsafe(callSql(f, true)).catch((e: any) => (aErr = e));
      await new Promise((res) => setTimeout(res, 500));
      await B.unsafe("COMMIT");
      await aPromise;
      await A.unsafe("ROLLBACK");
      ok(aErr && /insurance_not_verified:unverified/.test(aErr.message), `activation result ${aErr?.message}`);
      ok((await rentalCount(f)) === 0, "rental written");
      return `waited for the Owner's commit, then ${aErr.message}`;
    } finally {
      for (const c of [A, B]) { try { await c.unsafe("ROLLBACK"); } catch {} c.release(); }
    }
  });
  await check("T9c", "setting committed OFF between readiness and the transaction: the transaction uses its own read", async () => {
    await setSettingRaw(true);
    const f = await fixture({ verified: false });
    const readinessSaw = (await db`select value from public.app_settings where key = 'rental_activation'`)[0].value.allow_activation_without_insurance_verification;
    await asUser(OWNER, "select public.set_rental_activation_insurance_exception(false)");
    const m = await refused(activate(f, true), /insurance_not_verified/);
    return `readiness saw ${readinessSaw}; transaction: ${m}`;
  });
  await check("T9d", "insurance unverified (or licence rejected) after readiness: re-checked in the transaction; a concurrent change waits for the lock", async () => {
    await setSettingRaw(false);
    const f = await fixture();
    await db`update public.driver_screenings set insurance_verified = false where lead_id = ${f.app}`;
    const m1 = await refused(activate(f, false), /insurance_not_verified:unverified/);
    const g = await fixture();
    await db`update public.documents set review_status = 'rejected' where driver_id = ${g.app} and category = 'license_back'`;
    const m2 = await refused(activate(g, false), /missing_documents/);
    const h = await fixture();
    const A = await db.reserve();
    const C = await db.reserve();
    try {
      await A.unsafe("BEGIN");
      await A.unsafe("SET LOCAL ROLE service_role");
      await A.unsafe(callSql(h, false));
      await C.unsafe("SET lock_timeout = '400ms'");
      const m3 = await refused(C.unsafe(`update public.driver_screenings set insurance_verified = false where lead_id = '${h.app}'`), /lock timeout|55P03/);
      const m4 = await refused(C.unsafe(`update public.documents set review_status = 'rejected' where driver_id = '${h.app}' and category = 'license_front'`), /lock timeout|55P03/);
      await A.unsafe("COMMIT");
      return [m1, m2, `screening update waits: ${m3.slice(0, 30)}`, `licence update waits: ${m4.slice(0, 30)}`].join(" | ");
    } finally {
      try { await C.unsafe("RESET lock_timeout"); } catch {}
      for (const c of [A, C]) { try { await c.unsafe("ROLLBACK"); } catch {} c.release(); }
    }
  });
  await check("T9e", "a failure inside activate_rental_tx rolls back the wrapper's reads, locks and audit row", async () => {
    await setSettingRaw(true);
    const f = await fixture({ verified: false });
    const other = await fixture();
    await activate({ ...other, vehicle: other.vehicle }, false);
    // Same vehicle as the running rental: activate_rental_tx raises vehicle_busy after the wrapper passed its checks.
    const busy = { ...f, vehicle: other.vehicle };
    const before = Number((await db`select count(*)::int n from public.audit_log where action = 'rental.activated'`)[0].n);
    const m = await refused(activate(busy, true), /vehicle_busy/);
    const after = Number((await db`select count(*)::int n from public.audit_log where action = 'rental.activated'`)[0].n);
    ok(after === before && (await rentalCount(f)) === 0, "wrapper audit or rental survived");
    const [s] = await db`select status from public.applications where id = ${f.app}`;
    ok(s.status === "approved", "application changed");
    await db`select 1 from public.app_settings where key = 'rental_activation' for update nowait`;
    return `${m}; no audit row, no rental, application unchanged, setting lock free`;
  });
  await check("T9f", "via PostgREST (one transaction per request): failure leaves nothing; success writes rental + in-transaction audit", async () => {
    if (!restUp) return "skipped (no PostgREST)";
    await setSettingRaw(true);
    const run = await fixture();
    await activate(run, false);
    const f = await fixture({ verified: false });
    const body = (veh: string) => ({ _application_id: f.app, _vehicle_id: veh, _driver_id: f.driver, _weekly_rate: 325, _deposit: 0, _deposit_held: false, _start: "2026-10-25", _end: null, _pickup_miles: null, _actor: MANAGER, _insurance_exception_ack: true, _audit: { actor_role: "team", summary: "via PostgREST" } });
    const bad = await rest("POST", "/rpc/activate_rental_checked_tx", TOK.service, body(run.vehicle));
    ok(bad.status >= 400 && /vehicle_busy/.test(bad.text), `${bad.status} ${bad.text}`);
    ok((await checkedAudits(f)).length === 0 && (await rentalCount(f)) === 0, "partial write via REST");
    const good = await rest("POST", "/rpc/activate_rental_checked_tx", TOK.service, body(f.vehicle));
    ok(good.status === 200, `${good.status} ${good.text}`);
    const r = JSON.parse(good.text);
    const [a] = await checkedAudits(f);
    ok(a && a.metadata.transaction_id && (await rentalCount(f)) === 1 && r.exception_used === true, "success write");
    return `failure ${bad.status} (nothing written); success 200 (rental + audit, txid ${a.metadata.transaction_id})`;
  });

  // ---------------------------------------------------------- rollback and fail-closed app path
  await check("RB1", "real rollback request + trailer: guard passes, refuses the foreign target", async () => {
    const r = psql(RB_REQ + TRAILER);
    ok(!r.ok && /TARGET_MISMATCH/.test(r.out) && !/RRGUARD_/.test(r.out), r.out);
    return "TARGET_MISMATCH";
  });
  await check("RB2", "rollback (local copy) removes exactly v1; activate_rental_tx, 0031 and the ledger unchanged; history kept", async () => {
    const auditsBefore = Number((await db`select count(*)::int n from public.audit_log where action in ('settings.rental_activation_updated','rental.activated')`)[0].n);
    const r = psql(localCopy(RB, sid));
    ok(r.ok, r.out);
    const [s] = await db`select to_regprocedure('public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean,jsonb)') w, to_regprocedure('public.set_rental_activation_insurance_exception(boolean)') st, (select count(*)::int from public.app_settings where key = 'rental_activation') k, md5(pg_get_functiondef('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::regprocedure)) d`;
    ok(s.w === null && s.st === null && s.k === 0 && s.d === "dfadcc73dfa027a4e4c3364249776b3f", JSON.stringify(s));
    const auditsAfter = Number((await db`select count(*)::int n from public.audit_log where action in ('settings.rental_activation_updated','rental.activated')`)[0].n);
    ok(auditsAfter === auditsBefore, "history removed");
    const again = psql(localCopy(RB, sid));
    ok(!again.ok && /AIS_ROLLBACK_REPLAY/.test(again.out), again.out);
    return `removed; ${auditsAfter} audit rows kept; re-run AIS_ROLLBACK_REPLAY`;
  });
  await check("T10", "wrapper absent: PostgREST answers PGRST202 (the code the app fails closed on)", async () => {
    if (!restUp) return "skipped (no PostgREST)";
    await reloadRest();
    const a = await rest("POST", "/rpc/activate_rental_checked_tx", TOK.service, { _application_id: randomUUID(), _vehicle_id: randomUUID(), _driver_id: randomUUID(), _weekly_rate: 1, _deposit: 0, _deposit_held: false, _start: "2026-10-25", _end: null, _pickup_miles: null, _actor: MANAGER, _insurance_exception_ack: true, _audit: {} });
    ok(a.status === 404 && /PGRST202/.test(a.text), `${a.status} ${a.text}`);
    return `${a.status} PGRST202`;
  });

  await check("IVRB1", "IVA real rollback request + trailer: guard passes, refuses the foreign target", async () => {
    const r = psql(IVA_RB_REQ + TRAILER);
    ok(!r.ok && /TARGET_MISMATCH/.test(r.out) && !/RRGUARD_/.test(r.out), r.out);
    return "TARGET_MISMATCH";
  });
  await check("IVRB2", "IVA rollback removes exactly its objects; decisions and audit history kept; replay refused", async () => {
    const before = Number((await db`select count(*)::int n from public.audit_log where action like 'insurance.%'`)[0].n);
    const r = psql(localCopy(IVA_RB, sid));
    ok(r.ok, r.out);
    const [x] = await db`select to_regprocedure('public.set_insurance_verification(uuid,boolean,text)') f, (select count(*)::int from pg_trigger where tgname = 'zz_insurance_decision_guard') t, (select count(*)::int from public.audit_log where action like 'insurance.%') n`;
    ok(x.f === null && x.t === 0 && Number(x.n) === before, JSON.stringify(x));
    const again = psql(localCopy(IVA_RB, sid));
    ok(!again.ok && /IVA_ROLLBACK_REPLAY/.test(again.out), again.out);
    return `removed; ${before} decision audit rows kept; replay refused`;
  });

  // ---------------------------------------------------------- compatibility with Security 0031, S1 and M2
  // Each order runs on its own clone of rr_tpl (production-order baseline + 0031). M2 is the reviewed
  // packet ref applied by its own runner (Window 1 = ords 144-148, Window 2 = 149-206) and rolled back
  // with the packet's own rollback files (ords 208-239, strip_txn). S1 is the prepared S1 package with
  // its own verify-after and rollback. None of those artifacts is modified; only the target profile of
  // local copies is substituted, as their own test suites do.
  const M2_DIR = process.env.M2_PACKET_DIR ?? "/tmp/wt-pr2-packet";
  const S1_DIR = process.env.S1_DIR ?? "/home/user/wt-s1/proposed/security-s1";
  const S1_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
  const haveM2 = existsSync(join(M2_DIR, "rr-apply.mjs"));
  const haveS1 = existsSync(join(S1_DIR, "s1_application_write_guard.sql"));
  const sh = (cmd: string, args: string[], opts: any = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, ...opts });
  const runSql = (url: string, text: string) => {
    try {
      sh("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", text]);
      return "ok";
    } catch (e: any) {
      throw new Error(String(e.message).split("\n").find((l: string) => /ERROR/.test(l)) ?? String(e.message).slice(0, 300));
    }
  };
  const forDb = (text: string, name: string, profile = PROD_PROFILE) => {
    ok(text.split(profile).length === 2, "profile anchor");
    return text.replace(profile, `"database": "${name}", "system_identifier": "${sid}"`);
  };
  async function clone(name: string) {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name} template rr_tpl`);
    const url = `postgresql://postgres@127.0.0.1:55482/${name}?sslmode=disable`;
    // S1's verify reads the Supabase ledger; production has 105 receipts, the harness none (as S1's own suite does).
    runSql(url, "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY); INSERT INTO supabase_migrations.schema_migrations SELECT lpad(g::text, 14, '0') FROM generate_series(1, 105) g ON CONFLICT DO NOTHING");
    return url;
  }
  const ORDER_DBS = ["ais_c1", "ais_c2", "ais_c3", "ais_c4"];
  const resetM2 = async () => {
    for (const d of [...ORDER_DBS, "ais_o1", "ais_o2", "ais_o3", "ais_o4"]) await admin.unsafe(`drop database if exists ${d} with (force)`);
    for (const r of ["rr_approval_executor", "rr_evidence_issuer", "rr_record_executor"]) await admin.unsafe(`drop role if exists ${r}`);
  };
  const m2 = (url: string, last: number, first: number) => sh("node", ["rr-apply.mjs", String(last), String(first)], { cwd: M2_DIR, env: { ...process.env, RR_HARNESS_DB_URL: url } }).trim();
  async function m2Rollback(url: string) {
    const { stripTxn } = await import(join(M2_DIR, "scripts/m2-rehearsal-manifest.mjs"));
    const manifest = JSON.parse(readFileSync(join(M2_DIR, "proposed/rehearsal/manifest.json"), "utf8"));
    let n = 0;
    for (const e of manifest) {
      // The approved rollbacks, strict reverse order. m2-hosted-amendments/rollback/* are hosted
      // (non-superuser) variants of steps 1, 5 and 7, not additional steps; this cluster runs the approved ones.
      if (e.kind !== "rollback" || e.path.startsWith("proposed/m2-hosted-amendments/")) continue;
      const body = e.transform === "strip_txn" ? stripTxn(readFileSync(join(M2_DIR, e.path), "utf8"), e.path) : readFileSync(join(M2_DIR, e.path), "utf8");
      try {
        sh("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "--single-transaction", "-f", "-"], { input: body, stdio: ["pipe", "pipe", "pipe"] });
      } catch (err: any) {
        throw new Error(`M2 rollback ${e.path}: ${String(err.stderr ?? err.message).split("\n").find((l: string) => /ERROR/.test(l))}`);
      }
      n++;
    }
    return `M2 rollback ${n} files`;
  }
  const verifyRows = async (url: string, text: string) => {
    const c = postgres(url, { max: 1, onnotice: () => {} });
    try { return (await c.unsafe(text)).filter((r: any) => !r.ok).map((r: any) => r.check_name); } finally { await c.end({ timeout: 2 }); }
  };
  const s1Verify = async (url: string) => {
    const c = postgres(url, { max: 1, onnotice: () => {} });
    try {
      const [r] = await c.unsafe(readFileSync(join(S1_DIR, "verify-after-readonly.sql"), "utf8"));
      const v = r.s1_verify;
      return { all: v.all_gates === true, failed: Object.entries(v.gates).filter(([, x]) => x !== true).map(([k]) => k) };
    } finally { await c.end({ timeout: 2 }); }
  };
  const drop0031 = `DROP POLICY IF EXISTS coordinator_application_containment ON public.applications;
DROP POLICY IF EXISTS coordinator_review_containment ON public.application_identity_reviews;
DROP POLICY IF EXISTS coordinator_document_containment ON public.documents;
DROP POLICY IF EXISTS coordinator_agreement_containment ON public.agreements;
DROP POLICY IF EXISTS coordinator_identity_storage_containment ON storage.objects;`;
  async function scenario(url: string, opts: { m2w2?: boolean } = {}) {
    const c = postgres(url, { max: 3, onnotice: () => {} });
    const prev = db;
    db = c as any;
    try {
      await db.begin(async (tx: any) => {
        await tx`insert into auth.users(id,email) values (${OWNER}, 'owner@test'), (${MANAGER}, 'manager@test'), (${COORD}, 'coord@test') on conflict do nothing`;
        await tx`insert into public.user_roles(user_id, role) values (${OWNER}, 'admin'), (${MANAGER}, 'team'), (${COORD}, 'coordinator') on conflict do nothing`;
      });
      await setSettingRaw(false);
      const off = await fixture({ verified: false });
      await refused(activate(off, true), /insurance_not_verified/);
      await refused(asUser(COORD, `select public.set_insurance_verification('${off.app}', true, null)`), /manager_required/);
      await refused(asUser(COORD, `update public.driver_screenings set insurance_verified = true where lead_id = '${off.app}'`), /insurance_decision_manager_rpc_only/);
      await asUser(MANAGER, `select public.set_insurance_verification('${off.app}', true, null)`);
      const r0 = await activate(off, false);
      await asUser(OWNER, "select public.set_rental_activation_insurance_exception(true)");
      const on = await fixture({ verified: false });
      await refused(activate(on, false), /insurance_ack_required/);
      const r1 = await activate(on, true);
      ok(r0.rental_id && r1.exception_used === true, "activation outcomes");
      let busy = "";
      if (opts.m2w2) {
        const f = await fixture();
        const L = await c.reserve();
        try {
          await L.unsafe("BEGIN");
          await L.unsafe("select pg_advisory_xact_lock(82116,42001)");
          busy = await refused(activate(f, false), /approval_write_busy_retry|40001/);
          await L.unsafe("ROLLBACK");
        } finally { L.release(); }
        ok((await rentalCount(f)) === 0 && (await checkedAudits(f)).length === 0, "partial write under 40001");
        await activate(f, false);
      }
      return `rules hold (OFF refused, Coordinator refused, Manager verify, ON needs ack)${busy ? `; W2 lock: ${busy.split(" ")[0]} nothing written, retry ok` : ""}`;
    } finally {
      db = prev;
      await c.end({ timeout: 2 });
    }
  }
  const step = (log: string[], label: string, fn: () => string) => { log.push(`${label}: ${fn()}`); };

  await check("C1", "S1 -> AIS -> IVA -> S1 verify -> Window 1 -> Window 2 -> rules; then M2 rollback -> S1 rollback -> 0031 rollback -> IVA rollback -> AIS rollback", async () => {
    if (!haveM2 || !haveS1) return `skipped (M2 ${haveM2}, S1 ${haveS1})`;
    await resetM2();
    const url = await clone("ais_c1");
    const log: string[] = [];
    step(log, "S1", () => runSql(url, forDb(readFileSync(join(S1_DIR, "s1_application_write_guard.sql"), "utf8"), "ais_c1", S1_PROFILE)));
    step(log, "AIS", () => runSql(url, forDb(PKG, "ais_c1")));
    step(log, "IVA", () => runSql(url, forDb(IVA_PKG, "ais_c1")));
    const v = await s1Verify(url);
    ok(v.all, `S1 verify-after gates failed after AIS+IVA: ${v.failed}`);
    log.push("S1 verify-after: all_gates true");
    step(log, "W1", () => m2(url, 148, 144));
    step(log, "W2", () => m2(url, 206, 149));
    log.push(await scenario(url, { m2w2: true }));
    const aisAfter = await verifyRows(url, VERIFY);
    ok(JSON.stringify(aisAfter) === JSON.stringify(["activate_rental_tx.unchanged_since_install"]), `AIS verify ${aisAfter}`);
    log.push("AIS verify: only activate_rental_tx.unchanged_since_install differs (W2 replaced it, by design)");
    log.push(await m2Rollback(url));
    const aisBack = await verifyRows(url, VERIFY);
    ok(aisBack.length === 0, `AIS verify after M2 rollback ${aisBack}`);
    log.push("AIS verify after M2 rollback: all ok");
    step(log, "S1 rollback", () => runSql(url, forDb(readFileSync(join(S1_DIR, "rollback.sql"), "utf8"), "ais_c1", S1_PROFILE)));
    step(log, "0031 rollback", () => runSql(url, drop0031));
    step(log, "IVA rollback", () => runSql(url, forDb(IVA_RB, "ais_c1")));
    step(log, "AIS rollback", () => runSql(url, forDb(RB, "ais_c1")));
    evidence.c1 = log;
    return log.join(" | ");
  });
  await check("C2", "AIS -> IVA -> S1 -> S1 verify -> W1 -> W2 -> rules; then IVA rollback -> AIS rollback -> M2 rollback -> S1 rollback (our rollbacks before the others)", async () => {
    if (!haveM2 || !haveS1) return `skipped (M2 ${haveM2}, S1 ${haveS1})`;
    await resetM2();
    const url = await clone("ais_c2");
    const log: string[] = [];
    step(log, "AIS", () => runSql(url, forDb(PKG, "ais_c2")));
    step(log, "IVA", () => runSql(url, forDb(IVA_PKG, "ais_c2")));
    step(log, "S1", () => runSql(url, forDb(readFileSync(join(S1_DIR, "s1_application_write_guard.sql"), "utf8"), "ais_c2", S1_PROFILE)));
    const v = await s1Verify(url);
    ok(v.all, `S1 verify ${v.failed}`);
    log.push("S1 verify-after: all_gates true");
    step(log, "W1 (preflight clean)", () => m2(url, 148, 144));
    step(log, "W2", () => m2(url, 206, 149));
    log.push(await scenario(url, { m2w2: true }));
    step(log, "IVA rollback", () => runSql(url, forDb(IVA_RB, "ais_c2")));
    step(log, "AIS rollback", () => runSql(url, forDb(RB, "ais_c2")));
    log.push(await m2Rollback(url));
    step(log, "S1 rollback", () => runSql(url, forDb(readFileSync(join(S1_DIR, "rollback.sql"), "utf8"), "ais_c2", S1_PROFILE)));
    evidence.c2 = log;
    return log.join(" | ");
  });
  await check("C3", "W1 -> AIS -> IVA -> W2 (packages between the windows) -> rules; then AIS and IVA rollback with W2 still installed", async () => {
    if (!haveM2) return "skipped (no M2)";
    await resetM2();
    const url = await clone("ais_c3");
    const log: string[] = [];
    step(log, "W1", () => m2(url, 148, 144));
    step(log, "AIS", () => runSql(url, forDb(PKG, "ais_c3")));
    step(log, "IVA", () => runSql(url, forDb(IVA_PKG, "ais_c3")));
    step(log, "W2", () => m2(url, 206, 149));
    log.push(await scenario(url, { m2w2: true }));
    step(log, "AIS rollback", () => runSql(url, forDb(RB, "ais_c3")));
    step(log, "IVA rollback", () => runSql(url, forDb(IVA_RB, "ais_c3")));
    log.push(await m2Rollback(url));
    evidence.c3 = log;
    return log.join(" | ");
  });
  await check("C4", "W1 -> W2 -> IVA -> AIS (packages after both windows; preflights clean) -> rules", async () => {
    if (!haveM2) return "skipped (no M2)";
    await resetM2();
    const url = await clone("ais_c4");
    const log: string[] = [];
    step(log, "W1", () => m2(url, 148, 144));
    step(log, "W2", () => m2(url, 206, 149));
    const pre1 = await verifyRows(url, IVA_PREFLIGHT);
    const pre2 = await verifyRows(url, PREFLIGHT);
    ok(JSON.stringify(pre1) === JSON.stringify(["target.database", "target.system_identifier"]) && JSON.stringify(pre2) === JSON.stringify(["target.database", "target.system_identifier"]), `preflights ${pre1} / ${pre2}`);
    log.push("both preflights clean (target rows only)");
    step(log, "IVA", () => runSql(url, forDb(IVA_PKG, "ais_c4")));
    step(log, "AIS", () => runSql(url, forDb(PKG, "ais_c4")));
    log.push(await scenario(url, { m2w2: true }));
    evidence.c4 = log;
    await resetM2();
    return log.join(" | ");
  });
} catch (e: any) {
  record("FATAL", "harness", false, String(e?.stack ?? e));
} finally {
  if (pgrst) pgrst.kill("SIGTERM");
  try { (await import("node:fs")).rmSync(join(PKG_DIR, ".pgrst-local.conf"), { force: true }); } catch {}
  try { await db?.end({ timeout: 2 }); } catch {}
  try { await admin.end({ timeout: 2 }); } catch {}
}
const failed = results.filter((r) => !r.pass);
writeFileSync(join(PKG_DIR, "test-results.json"), JSON.stringify({ generated_at: "local run", passed: results.length - failed.length, failed: failed.length, results, evidence }, null, 2) + "\n");
console.log(`\n${results.length - failed.length} passed, ${failed.length} failed`);
process.exit(failed.length ? 1 : 0);
