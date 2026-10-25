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
async function fixture(o: { verified?: boolean; insuranceDoc?: boolean; appExpires?: string | null; docExpires?: string | null; agreement?: "esign" | "paper" | "paper_unaudited" | "none"; licence?: boolean; status?: string } = {}): Promise<Fx> {
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
    await tx`insert into public.driver_screenings(lead_id, insurance_verified, interview_completed_at) values (${f.app}, ${o.verified ?? true}, now())`;
  });
  return f;
}
const callSql = (f: Fx, ack: boolean, extra = "") =>
  `select public.activate_rental_checked_tx('${f.app}','${f.vehicle}','${f.driver}',325,0,false,current_date${extra || ",null"},null,'${f.actor}',${ack}) as r`;
const activate = async (f: Fx, ack: boolean) => (await asService(callSql(f, ack)))[0].r;
async function setSettingRaw(allow: boolean | null) {
  // Test-only direct write as the superuser, through the same guard the setter uses.
  await db.begin(async (tx: any) => {
    await tx`select set_config('app.rental_activation_setting_write', 'on', true)`;
    if (allow === null) await tx`delete from public.app_settings where key = 'rental_activation'`;
    else await tx`insert into public.app_settings(key, value) values ('rental_activation', ${tx.json({ allow_activation_without_insurance_verification: allow })}) on conflict (key) do update set value = excluded.value`;
  });
}
const rentalCount = async (f: Fx) => Number((await db`select count(*)::int n from public.rentals where application_id = ${f.app}`)[0].n);
const checkedAudits = async (f: Fx) => db`select metadata from public.audit_log where action = 'rental.activation_checked' and metadata->>'application_id' = ${f.app}`;
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
    const [s] = await db`select to_regprocedure('public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean)') w, (select count(*)::int from public.app_settings where key = 'rental_activation') k, (select count(*)::int from pg_policy where polname like 'rental_activation_setting_%') p`;
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

  // ---------------------------------------------------------- transaction boundary (inspection)
  await check("B1", "wrapper and activate_rental_tx: plpgsql, SECURITY DEFINER, SET clauses, no autonomous work; wrapper has no exception handler", async () => {
    const rows = await db`select p.proname, l.lanname, p.prosecdef, p.proconfig, pg_get_functiondef(p.oid) def from pg_proc p join pg_language l on l.oid = p.prolang where p.oid in ('public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean)'::regprocedure, 'public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::regprocedure)`;
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
    ok(a?.metadata.exception_used === true && a.metadata.insurance_exception_acknowledged === true && a.metadata.setting_allow_without_insurance_verification === true && a.metadata.actor_user_id === MANAGER && a.metadata.transaction_id, JSON.stringify(a));
    ok((await insuranceVerified(f)) === false, "insurance flipped to verified");
    evidence.exception_audit = a.metadata;
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
      const body = { _application_id: f.app, _vehicle_id: f.vehicle, _driver_id: f.driver, _weekly_rate: 325, _deposit: 0, _deposit_held: false, _start: "2026-10-25", _end: null, _pickup_miles: null, _actor: OWNER, _insurance_exception_ack: true };
      for (const [t, name] of [[TOK.owner, "owner"], [TOK.mgr, "manager"], [TOK.anon, "anon"]] as const) {
        const a = await rest("POST", "/rpc/activate_rental_checked_tx", t, body);
        ok(a.status === 401 || a.status === 403, `${name} wrapper ${a.status} ${a.text}`);
        const { _insurance_exception_ack, ...legacy } = body;
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
      const [order] = await db`select (select created_at from public.audit_log where action = 'rental.activation_checked' and metadata->>'application_id' = ${f.app}) < (select created_at from public.audit_log where id = ${br.audit_id}) ordered`;
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
    const before = Number((await db`select count(*)::int n from public.audit_log where action = 'rental.activation_checked'`)[0].n);
    const m = await refused(activate(busy, true), /vehicle_busy/);
    const after = Number((await db`select count(*)::int n from public.audit_log where action = 'rental.activation_checked'`)[0].n);
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
    const body = (veh: string) => ({ _application_id: f.app, _vehicle_id: veh, _driver_id: f.driver, _weekly_rate: 325, _deposit: 0, _deposit_held: false, _start: "2026-10-25", _end: null, _pickup_miles: null, _actor: MANAGER, _insurance_exception_ack: true });
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
    const auditsBefore = Number((await db`select count(*)::int n from public.audit_log where action in ('settings.rental_activation_updated','rental.activation_checked')`)[0].n);
    const r = psql(localCopy(RB, sid));
    ok(r.ok, r.out);
    const [s] = await db`select to_regprocedure('public.activate_rental_checked_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid,boolean)') w, to_regprocedure('public.set_rental_activation_insurance_exception(boolean)') st, (select count(*)::int from public.app_settings where key = 'rental_activation') k, md5(pg_get_functiondef('public.activate_rental_tx(uuid,uuid,uuid,numeric,numeric,boolean,date,date,integer,uuid)'::regprocedure)) d`;
    ok(s.w === null && s.st === null && s.k === 0 && s.d === "dfadcc73dfa027a4e4c3364249776b3f", JSON.stringify(s));
    const auditsAfter = Number((await db`select count(*)::int n from public.audit_log where action in ('settings.rental_activation_updated','rental.activation_checked')`)[0].n);
    ok(auditsAfter === auditsBefore, "history removed");
    const again = psql(localCopy(RB, sid));
    ok(!again.ok && /AIS_ROLLBACK_REPLAY/.test(again.out), again.out);
    return `removed; ${auditsAfter} audit rows kept; re-run AIS_ROLLBACK_REPLAY`;
  });
  await check("T10", "wrapper absent: PostgREST answers PGRST202 (the code the app fails closed on)", async () => {
    if (!restUp) return "skipped (no PostgREST)";
    await reloadRest();
    const a = await rest("POST", "/rpc/activate_rental_checked_tx", TOK.service, { _application_id: randomUUID(), _vehicle_id: randomUUID(), _driver_id: randomUUID(), _weekly_rate: 1, _deposit: 0, _deposit_held: false, _start: "2026-10-25", _end: null, _pickup_miles: null, _actor: MANAGER, _insurance_exception_ack: true });
    ok(a.status === 404 && /PGRST202/.test(a.text), `${a.status} ${a.text}`);
    return `${a.status} PGRST202`;
  });

  // ---------------------------------------------------------- ordering vs M2 Window 1/2 and Security S1
  // Each order runs on its own clone of rr_tpl. M2 is the reviewed packet ref applied by its own
  // runner (M2_PACKET_DIR, default /tmp/wt-pr2-packet); S1 is the prepared S1 package (S1_PACKAGE).
  const M2_DIR = process.env.M2_PACKET_DIR ?? "/tmp/wt-pr2-packet";
  const S1_PKG = process.env.S1_PACKAGE ?? "/home/user/wt-s1/proposed/security-s1/s1_application_write_guard.sql";
  const S1_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
  async function clone(name: string) {
    await admin.unsafe(`drop database if exists ${name} with (force)`);
    await admin.unsafe(`create database ${name} template rr_tpl`);
    return `postgresql://postgres@127.0.0.1:55482/${name}?sslmode=disable`;
  }
  const sh = (cmd: string, args: string[], opts: any = {}) => execFileSync(cmd, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, ...opts });
  const psqlTo = (url: string, text: string) => sh("psql", [url, "-X", "-q", "-v", "ON_ERROR_STOP=1", "-c", text]);
  const aisFor = (dbname: string) => PKG.replace(PROD_PROFILE, `"database": "${dbname}", "system_identifier": "${sid}"`);
  const m2Roles = async () => Number((await admin`select count(*)::int n from pg_roles where rolname in ('rr_approval_executor','rr_evidence_issuer','rr_record_executor')`)[0].n);
  // M2 creates cluster-global roles, so each order starts from a cluster without them: the
  // previous M2 clone and its roles are dropped first, and the full runner (preflight included) runs.
  const resetM2 = async (keep: string) => {
    for (const d of ["ais_o1", "ais_o2"]) if (d !== keep) await admin.unsafe(`drop database if exists ${d} with (force)`);
    for (const r of ["rr_approval_executor", "rr_evidence_issuer", "rr_record_executor"]) await admin.unsafe(`drop role if exists ${r}`);
  };
  const applyM2 = async (url: string) => {
    ok((await m2Roles()) === 0, "M2 roles already exist in this cluster");
    const out = sh("node", ["rr-apply.mjs", "206", "144"], { cwd: M2_DIR, env: { ...process.env, RR_HARNESS_DB_URL: url } });
    return out.trim();
  };
  async function scenario(url: string, allowBad: string[] = []) {
    const c = postgres(url, { max: 2, onnotice: () => {} });
    try {
      const prev = db;
      db = c as any;
      try {
        await db.begin(async (tx: any) => {
          await tx`insert into auth.users(id,email) values (${OWNER}, 'owner@test'), (${MANAGER}, 'manager@test') on conflict do nothing`;
          await tx`insert into public.user_roles(user_id, role) values (${OWNER}, 'admin'), (${MANAGER}, 'team') on conflict do nothing`;
        });
        await setSettingRaw(false);
        const off = await fixture({ verified: false });
        const r1 = await refused(activate(off, true), /insurance_not_verified/);
        await asUser(OWNER, "select public.set_rental_activation_insurance_exception(true)");
        const on = await fixture({ verified: false });
        await refused(activate(on, false), /insurance_ack_required/);
        const r2 = await activate(on, true);
        const ok3 = await activate(await fixture(), false);
        ok(r2.exception_used === true && ok3.exception_used === false, "activation outcomes");
        const v = await c.unsafe(VERIFY);
        const bad = v.filter((x: any) => !x.ok).map((x: any) => x.check_name);
        ok(JSON.stringify(bad) === JSON.stringify(allowBad), `verify rows ${bad}`);
        return `OFF refused (${r1.split(" ").pop()}), ON needs ack, ON+ack ok, verified ok, verify-after ok${allowBad.length ? ` except ${allowBad} (expected: M2 Window 1 replaces activate_rental_tx; the wrapper calls the new one)` : ""}`;
      } finally {
        db = prev;
      }
    } finally {
      await c.end({ timeout: 2 });
    }
  }
  const haveM2 = existsSync(join(M2_DIR, "rr-apply.mjs"));
  const haveS1 = existsSync(S1_PKG);
  await check("O1", "order: this package, then M2 Window 1+2 (packet preflight clean, 31 writes, verifies true), then activation", async () => {
    if (!haveM2) return `skipped (no ${M2_DIR}/rr-apply.mjs)`;
    await resetM2("");
    const url = await clone("ais_o1");
    psqlTo(url, aisFor("ais_o1"));
    const m2 = await applyM2(url);
    return `${m2}; ${await scenario(url, ["activate_rental_tx.unchanged_since_install"])}`;
  });
  await check("O2", "order: M2 Window 1+2, then this package (preflight clean), then activation incl. 40001 under approval_serialize", async () => {
    if (!haveM2) return `skipped (no ${M2_DIR}/rr-apply.mjs)`;
    await resetM2("");
    const url = await clone("ais_o2");
    const m2 = await applyM2(url);
    const c = postgres(url, { max: 3, onnotice: () => {} });
    try {
      const pre = await c.unsafe(PREFLIGHT);
      const bad = pre.filter((r: any) => !r.ok).map((r: any) => r.check_name);
      ok(JSON.stringify(bad) === JSON.stringify(["target.database", "target.system_identifier"]), `preflight ${bad}`);
      const m2w1 = pre.find((r: any) => r.check_name.startsWith("m2_window1"))?.actual;
      psqlTo(url, aisFor("ais_o2"));
      const sc = await scenario(url);
      // approval_serialize (M2 Window 2) holds a try-lock on applications writes: activation returns 40001, wrapper rolled back.
      const prev = db;
      db = c as any;
      let busy = "";
      try {
        const f = await fixture();
        const L = await c.reserve();
        try {
          await L.unsafe("BEGIN");
          await L.unsafe("select pg_advisory_xact_lock(82116,42001)");
          busy = await refused(activate(f, false), /approval_write_busy_retry|40001/);
          await L.unsafe("ROLLBACK");
        } finally { L.release(); }
        ok((await rentalCount(f)) === 0 && (await checkedAudits(f)).length === 0, "partial write under 40001");
        const r = await activate(f, false);
        ok(r.rental_id, "retry after the lock clears");
      } finally { db = prev; }
      return `${m2}; m2_window1 activate=${m2w1}; ${sc}; ${busy.slice(0, 45)}, nothing written, retry ok`;
    } finally {
      await c.end({ timeout: 2 });
    }
  });
  for (const [id, label, first] of [["O3", "S1 then this package", "s1"], ["O4", "this package then S1", "ais"]] as const) {
    await check(id, `order: ${label}; both install, activation works (S1 does not block the SECURITY DEFINER path)`, async () => {
      if (!haveS1) return `skipped (no ${S1_PKG})`;
      const name = id === "O3" ? "ais_o3" : "ais_o4";
      const url = await clone(name);
      const s1 = readFileSync(S1_PKG, "utf8");
      ok(s1.split(S1_PROFILE).length === 2, "S1 profile anchor");
      const s1Local = s1.replace(S1_PROFILE, `"database": "${name}", "system_identifier": "${sid}"`);
      if (first === "s1") { psqlTo(url, s1Local); psqlTo(url, aisFor(name)); }
      else { psqlTo(url, aisFor(name)); psqlTo(url, s1Local); }
      return `S1 sha ${sha(s1).slice(0, 12)}; ${await scenario(url)}`;
    });
  }
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
