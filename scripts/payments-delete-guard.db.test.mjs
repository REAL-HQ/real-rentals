// Local-only verification of proposed/payments-delete-guard on a private, disposable Postgres:
// 127.0.0.1:55482, database pdg_test cloned from the production-order baseline template rr_tpl
// (built as described in proposed/activation-insurance-setting/README.md, "Local test database").
// Never touches a hosted backend. Run: node scripts/payments-delete-guard.db.test.mjs
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ADMIN = "postgresql://postgres@127.0.0.1:55482/postgres?sslmode=disable";
const DB = "postgresql://postgres@127.0.0.1:55482/pdg_test?sslmode=disable";
for (const u of [ADMIN, DB]) if (!/^postgresql:\/\/postgres@127\.0\.0\.1:55482\//.test(u)) throw new Error(`refusing non-local target ${u}`);

const psql = (url, sql) => execFileSync("psql", [url, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
const fails = (sql) => {
  try {
    psql(DB, sql);
    return null;
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
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

psql(ADMIN, "DROP DATABASE IF EXISTS pdg_test");
psql(ADMIN, "CREATE DATABASE pdg_test TEMPLATE rr_tpl");
try {
  psql(DB, `SET session_replication_role = replica;
    INSERT INTO public.user_roles (user_id, role) VALUES ('${MANAGER}', 'team');
    INSERT INTO public.applications (id, full_name, email, phone, status) VALUES ('${APP}', 'Syn Driver', 'syn@example.test', '0000000', 'approved');
    INSERT INTO public.payments (id, driver_id, amount, balance_due, type, status, due_date)
      VALUES ('a0000000-0000-4000-8000-000000000001', '${APP}', 325, 325, 'rent', 'failed', '2026-10-27'),
             ('a0000000-0000-4000-8000-000000000002', '${APP}', 325, 0, 'rent', 'paid', '2026-10-20'),
             ('a0000000-0000-4000-8000-000000000003', NULL, 10, 10, 'other', 'pending', '2026-10-27');`);
  const count = () => Number(psql(DB, "SELECT count(*) FROM public.payments"));

  test("before the guard, a Manager can delete a payment row (today's exposure)", () => {
    assert.equal(fails(asRole("authenticated", "DELETE FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000003'", MANAGER)), null);
    assert.equal(count(), 2);
    psql(DB, "SET session_replication_role = replica; INSERT INTO public.payments (id, amount, balance_due, type, status, due_date) VALUES ('a0000000-0000-4000-8000-000000000003', 10, 10, 'other', 'pending', '2026-10-27')");
  });

  psql(DB, readFileSync("proposed/payments-delete-guard/payments_delete_guard_v1.sql", "utf8"));

  test("install: one BEFORE DELETE row trigger and a SECURITY INVOKER function no API role can execute", () => {
    assert.equal(psql(DB, "SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND tgname = 'zz_payments_delete_guard' AND tgtype = 11 AND tgenabled = 'O'"), "1");
    assert.equal(psql(DB, "SELECT prosecdef FROM pg_proc WHERE oid = 'private.payments_delete_guard()'::regprocedure"), "f");
    for (const r of ["authenticated", "anon", "service_role"]) assert.equal(psql(DB, `SELECT has_function_privilege('${r}', 'private.payments_delete_guard()', 'EXECUTE')`), "f");
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

  test("a Manager can still void a charge entered in error (status void + reason in notes)", () => {
    assert.equal(fails(asRole("authenticated", "UPDATE public.payments SET status = 'void', notes = 'Voided: entered twice' WHERE id = 'a0000000-0000-4000-8000-000000000001'", MANAGER)), null);
    assert.equal(psql(DB, "SELECT status || '|' || notes FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000001'"), "void|Voided: entered twice");
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

  test("rollback removes exactly the trigger and function", () => {
    psql(DB, readFileSync("proposed/payments-delete-guard/rollback.sql", "utf8"));
    assert.equal(psql(DB, "SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_payments_delete_guard'"), "0");
    assert.equal(psql(DB, "SELECT to_regprocedure('private.payments_delete_guard()') IS NULL"), "t");
    assert.equal(fails(asRole("service_role", "DELETE FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000002'")), null);
  });
} finally {
  psql(ADMIN, "DROP DATABASE IF EXISTS pdg_test");
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
