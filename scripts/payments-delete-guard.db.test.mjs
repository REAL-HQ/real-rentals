// Local-only verification of proposed/payments-delete-guard on a private, disposable Postgres:
// 127.0.0.1:55482, database pdg_test cloned from the production-order baseline template rr_tpl
// (built as described in proposed/activation-insurance-setting/README.md, "Local test database").
// Never touches a hosted backend. Run: node scripts/payments-delete-guard.db.test.mjs
//
// The package is exercised as it would be submitted: the real guarded request files plus the Management
// API trailer (they must pass the guard and then refuse this foreign target), and local copies whose only
// change is the target profile (database + system identifier), as the insurance packages' tests do.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ADMIN = "postgresql://postgres@127.0.0.1:55482/postgres?sslmode=disable";
const DBNAME = "pdg_test";
const DB = `postgresql://postgres@127.0.0.1:55482/${DBNAME}?sslmode=disable`;
for (const u of [ADMIN, DB]) if (!/^postgresql:\/\/postgres@127\.0\.0\.1:55482\//.test(u)) throw new Error(`refusing non-local target ${u}`);

const DIR = "proposed/payments-delete-guard";
const read = (f) => readFileSync(`${DIR}/${f}`, "utf8");
const PKG = read("payments_delete_guard_v1.sql");
const REQ = read("request-payments-delete-guard.sql");
const RB = read("rollback.sql");
const RB_REQ = read("request-rollback-payments-delete-guard.sql");
const PREFLIGHT = read("preflight-readonly.sql");
const VERIFY = read("verify-after-readonly.sql");
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: pat:disposable\n-- date: 2026-10-27T00:00:00.000Z";
const FAILPOINT = "-- TEST_FAILURE_POINT (only disposable test copies may inject failure here)";
const PROD_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
const sha = (b) => createHash("sha256").update(b).digest("hex");

const psql = (url, sql) => execFileSync("psql", [url, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();
const fails = (sql) => {
  try {
    psql(DB, sql);
    return null;
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
const rowsOf = (sql) => psql(DB, `SELECT check_name || '|' || ok FROM (${sql.replace(/;\s*$/, "")}) r`).split("\n");
const notOk = (sql) => rowsOf(sql).filter((l) => l.endsWith("|false")).map((l) => l.split("|")[0]);
let passed = 0;
const failures = [];
function test(name, fn) {
  try {
    fn();
    passed++;
    console.log("PASS", name);
  } catch (e) {
    failures.push(name);
    console.log("FAIL", name);
    console.log(e);
  }
}

const MANAGER = "33333333-3333-4333-8333-333333333333";
const APP = "11111111-1111-4111-8111-111111111111";
const asRole = (role, sql, sub) =>
  `BEGIN; SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? null, role })}', true), set_config('request.jwt.claim.sub', '${sub ?? ""}', true); SET LOCAL ROLE ${role}; ${sql}; COMMIT;`;

psql(ADMIN, `DROP DATABASE IF EXISTS ${DBNAME}`);
psql(ADMIN, `CREATE DATABASE ${DBNAME} TEMPLATE rr_tpl`);
try {
  const sid = psql(DB, "SELECT system_identifier::text FROM pg_control_system()");
  const localCopy = (text) => {
    assert.equal(text.split(PROD_PROFILE).length, 2, "profile anchor");
    return text.replace(PROD_PROFILE, `"database": "${DBNAME}", "system_identifier": "${sid}"`);
  };
  psql(DB, `SET session_replication_role = replica;
    INSERT INTO public.user_roles (user_id, role) VALUES ('${MANAGER}', 'team');
    INSERT INTO public.applications (id, full_name, email, phone, status) VALUES ('${APP}', 'Syn Driver', 'syn@example.test', '0000000', 'approved');
    INSERT INTO public.payments (id, driver_id, amount, balance_due, type, status, due_date)
      VALUES ('a0000000-0000-4000-8000-000000000001', '${APP}', 325, 325, 'rent', 'failed', '2026-10-27'),
             ('a0000000-0000-4000-8000-000000000002', '${APP}', 325, 0, 'rent', 'paid', '2026-10-20'),
             ('a0000000-0000-4000-8000-000000000003', NULL, 10, 10, 'other', 'pending', '2026-10-27');`);
  const count = () => Number(psql(DB, "SELECT count(*) FROM public.payments"));
  const guardPresent = () => psql(DB, "SELECT (to_regprocedure('private.payments_delete_guard()') IS NOT NULL)::text || '|' || (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_payments_delete_guard')");

  test("artifacts match SHA256SUMS and the build reproduces them byte for byte", () => {
    const sums = read("SHA256SUMS").trim().split("\n").map((l) => l.split(/\s+/));
    for (const [h, f] of sums) assert.equal(sha(readFileSync(`${DIR}/${f}`)), h, f);
    assert.match(execFileSync("python3", ["-I", `${DIR}/src/build.py`, "--check"], { encoding: "utf8" }), /reproduce byte for byte/);
    for (const [f, t] of [["request", REQ], ["rollback request", RB_REQ]]) assert.ok(/^[\x00-\x7f]*\n$/.test(t), `${f} ASCII + final newline`);
    assert.ok(REQ.endsWith(PKG) && RB_REQ.endsWith(RB), "requests = guard + exact package bytes");
  });

  test("before the guard, a Manager can delete a payment row (today's exposure)", () => {
    assert.equal(fails(asRole("authenticated", "DELETE FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000003'", MANAGER)), null);
    assert.equal(count(), 2);
    psql(DB, "SET session_replication_role = replica; INSERT INTO public.payments (id, amount, balance_due, type, status, due_date) VALUES ('a0000000-0000-4000-8000-000000000003', 10, 10, 'other', 'pending', '2026-10-27')");
  });

  test("preflight: every gate ok except the two local target rows", () => {
    assert.deepEqual(notOk(PREFLIGHT), ["target.database", "target.system_identifier"]);
  });

  test("real guarded request + trailer: guard passes, package refuses the foreign target, nothing persists", () => {
    const err = fails(REQ + TRAILER) ?? "";
    assert.match(err, /TARGET_MISMATCH/);
    assert.doesNotMatch(err, /RRGUARD_/);
    assert.equal(guardPresent(), "false|0");
  });

  test("tampered request is refused by the guard", () => {
    const i = REQ.indexOf("PDG_PARTIAL_INSTALL");
    assert.ok(i > 0);
    assert.match(fails(REQ.slice(0, i) + "X" + REQ.slice(i + 1) + TRAILER) ?? "", /RRGUARD_BYTES_MISMATCH/);
    assert.match(fails(REQ + TRAILER + "\nDELETE FROM public.payments;") ?? "", /RRGUARD_TRAILING_TEXT/);
    assert.equal(count(), 3);
  });

  test("a failure after the DDL rolls back everything (no function, trigger or evidence row)", () => {
    assert.equal(PKG.split(FAILPOINT).length, 2);
    assert.match(fails(localCopy(PKG).replace(FAILPOINT, "RAISE EXCEPTION 'INJECTED_FAILURE';")) ?? "", /INJECTED_FAILURE/);
    assert.equal(guardPresent(), "false|0");
    assert.equal(psql(DB, "SELECT count(*) FROM public.audit_log WHERE entity_id LIKE 'payments_delete_guard_v1%'"), "0");
  });

  test("local copy installs: one BEFORE DELETE row trigger and a SECURITY INVOKER function no API role can execute", () => {
    psql(DB, localCopy(PKG));
    assert.equal(psql(DB, "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND tgname = 'zz_payments_delete_guard' AND tgtype = 11 AND tgenabled = 'O'"), "1");
    assert.equal(psql(DB, "SELECT prosecdef FROM pg_proc WHERE oid = 'private.payments_delete_guard()'::regprocedure"), "f");
    for (const r of ["authenticated", "anon", "service_role"]) assert.equal(psql(DB, `SELECT has_function_privilege('${r}', 'private.payments_delete_guard()', 'EXECUTE')`), "f");
    assert.equal(count(), 3);
  });

  test("verify-after: every row ok", () => {
    assert.deepEqual(notOk(VERIFY), []);
  });

  test("re-run refused (PDG_EVIDENCE_REPLAY)", () => {
    assert.match(fails(localCopy(PKG)) ?? "", /PDG_EVIDENCE_REPLAY/);
  });

  test("a Manager (authenticated) cannot delete a payment row", () => {
    const err = fails(asRole("authenticated", "DELETE FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000001'", MANAGER));
    assert.match(err ?? "", /payments_are_financial_history_void_instead/);
    assert.equal(count(), 3);
  });

  test("server code (service_role) cannot delete a payment row, paid or not", () => {
    for (const id of ["a0000000-0000-4000-8000-000000000001", "a0000000-0000-4000-8000-000000000002"]) {
      assert.match(fails(asRole("service_role", `DELETE FROM public.payments WHERE id = '${id}'`)) ?? "", /payments_are_financial_history_void_instead/);
    }
    assert.equal(count(), 3);
  });

  test("anon cannot delete either (no DELETE grant; the trigger is a further layer)", () => {
    assert.match(fails(asRole("anon", "DELETE FROM public.payments")) ?? "", /permission denied for table payments/);
    assert.equal(count(), 3);
  });

  test("a Manager can still void a charge entered in error (status void + reason in notes); amount and balance kept", () => {
    assert.equal(fails(asRole("authenticated", "UPDATE public.payments SET status = 'void', notes = 'Voided: entered twice' WHERE id = 'a0000000-0000-4000-8000-000000000001'", MANAGER)), null);
    assert.equal(psql(DB, "SELECT status || '|' || notes || '|' || amount || '|' || balance_due FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000001'"), "void|Voided: entered twice|325.00|325.00");
  });

  test("deleting a parent row still works: the payment is kept and its link set to null", () => {
    assert.equal(fails(`DELETE FROM public.applications WHERE id = '${APP}'`), null);
    assert.equal(count(), 3);
    assert.equal(psql(DB, "SELECT count(*) FROM public.payments WHERE driver_id IS NULL"), "3");
  });

  test("the database owner (migrations / approved SQL) can still delete", () => {
    assert.equal(fails("DELETE FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000003'"), null);
    assert.equal(count(), 2);
  });

  test("real rollback request + trailer: guard passes, refuses the foreign target, guard stays", () => {
    const err = fails(RB_REQ + TRAILER) ?? "";
    assert.match(err, /TARGET_MISMATCH/);
    assert.doesNotMatch(err, /RRGUARD_/);
    assert.equal(guardPresent(), "true|1");
  });

  test("rollback removes exactly the trigger and function, keeps every row and the install evidence; replay refused", () => {
    psql(DB, localCopy(RB));
    assert.equal(guardPresent(), "false|0");
    assert.equal(count(), 2);
    assert.equal(psql(DB, "SELECT string_agg(entity_id, ',' ORDER BY entity_id) FROM public.audit_log WHERE entity_id LIKE 'payments_delete_guard_v1%'"), "payments_delete_guard_v1,payments_delete_guard_v1_rollback");
    assert.equal(psql(DB, "SELECT string_agg(tgname, ',') FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND NOT tgisinternal"), "payments_updated_at");
    assert.match(fails(localCopy(RB)) ?? "", /PDG_ROLLBACK_REPLAY/);
    assert.equal(fails(asRole("service_role", "DELETE FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000002'")), null);
  });
} finally {
  psql(ADMIN, `DROP DATABASE IF EXISTS ${DBNAME}`);
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
