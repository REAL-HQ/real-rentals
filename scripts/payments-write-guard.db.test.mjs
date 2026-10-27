// Local-only verification of proposed/payments-write-guard on a private, disposable Postgres:
// 127.0.0.1:55482, databases pwg_test / pwg_both cloned from the production-order baseline
// template rr_tpl. Never touches a hosted backend. Run: node scripts/payments-write-guard.db.test.mjs
//
// The package is exercised as it would be submitted (the real guarded request files plus the
// Management API trailer must pass the guard and then refuse this foreign target), and through
// local copies whose only change is the target profile. Each role is exercised the way PostgREST
// runs a request: SET LOCAL ROLE plus the JWT claims, so RLS and auth.uid() behave as in production.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const ADMIN = "postgresql://postgres@127.0.0.1:55482/postgres?sslmode=disable";
const url = (db) => `postgresql://postgres@127.0.0.1:55482/${db}?sslmode=disable`;
for (const u of [ADMIN, url("pwg_test")]) if (!/^postgresql:\/\/postgres@127\.0\.0\.1:55482\//.test(u)) throw new Error(`refusing non-local target ${u}`);

const DIR = "proposed/payments-write-guard";
const read = (f) => readFileSync(`${DIR}/${f}`, "utf8");
const PKG = read("payments_write_guard_v1.sql");
const REQ = read("request-payments-write-guard.sql");
const RB = read("rollback.sql");
const RB_REQ = read("request-rollback-payments-write-guard.sql");
const PREFLIGHT = read("preflight-readonly.sql");
const VERIFY = read("verify-after-readonly.sql");
const PDG = readFileSync("proposed/payments-delete-guard/payments_delete_guard_v1.sql", "utf8");
const PDG_RB = readFileSync("proposed/payments-delete-guard/rollback.sql", "utf8");
const TRAILER = "\n\n-- source: POST /v1/projects/:ref/database/query\n-- user: pat:disposable\n-- date: 2026-10-27T00:00:00.000Z";
const FAILPOINT = "-- TEST_FAILURE_POINT (only disposable test copies may inject failure here)";
const PROD_PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
const sha = (b) => createHash("sha256").update(b).digest("hex");

let DB = url("pwg_test");
let DBNAME = "pwg_test";
const psql = (u, sql) => execFileSync("psql", [u, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();
const q = (sql) => psql(DB, sql);
const fails = (sql) => {
  try {
    psql(DB, sql);
    return null;
  } catch (e) {
    return String(e.stderr || e.message);
  }
};
const notOk = (sql) => q(`SELECT check_name || '|' || ok FROM (${sql.replace(/;\s*$/, "")}) r`).split("\n").filter((l) => l.endsWith("|false")).map((l) => l.split("|")[0]);
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

const OWNER = "55555555-5555-4555-8555-555555555555";
const MANAGER = "33333333-3333-4333-8333-333333333333";
const COORD = "44444444-4444-4444-8444-444444444444";
const DRIVER = "66666666-6666-4666-8666-666666666666";
const APP = "11111111-1111-4111-8111-111111111111";
const P1 = "a0000000-0000-4000-8000-000000000001"; // failed rent, owed
const P2 = "a0000000-0000-4000-8000-000000000002"; // paid
const as = (role, sub, sql) =>
  `BEGIN; SELECT set_config('request.jwt.claims', '${JSON.stringify({ sub: sub ?? null, role })}', true), set_config('request.jwt.claim.sub', '${sub ?? ""}', true); SET LOCAL ROLE ${role}; ${sql}; COMMIT;`;
const asUser = (sub, sql) => as("authenticated", sub, sql);
const row = (id) => q(`SELECT status || '|' || amount || '|' || balance_due || '|' || coalesce(paid_date::text, '-') || '|' || coalesce(notes, '-') FROM public.payments WHERE id = '${id}'`);
const MONEY = /payments_change_only_through_audited_server/;

function freshDb(name) {
  DBNAME = name;
  DB = url(name);
  psql(ADMIN, `DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  psql(ADMIN, `CREATE DATABASE ${name} TEMPLATE rr_tpl`);
  q(`SET session_replication_role = replica;
    INSERT INTO auth.users (id, email) VALUES ('${OWNER}', 'o@t'), ('${MANAGER}', 'm@t'), ('${COORD}', 'c@t'), ('${DRIVER}', 'd@t');
    INSERT INTO public.user_roles (user_id, role) VALUES ('${OWNER}', 'admin'), ('${MANAGER}', 'team'), ('${COORD}', 'coordinator');
    INSERT INTO public.applications (id, full_name, email, phone, status, user_id) VALUES ('${APP}', 'Syn Driver', 'd@t', '0000000', 'approved', '${DRIVER}');
    INSERT INTO public.payments (id, driver_id, amount, balance_due, type, status, due_date, attempt_count)
      VALUES ('${P1}', '${APP}', 325, 325, 'rent', 'failed', '2026-10-27', 1);
    INSERT INTO public.payments (id, driver_id, amount, balance_due, type, status, due_date, paid_date, stripe_payment_intent_id)
      VALUES ('${P2}', '${APP}', 325, 0, 'rent', 'paid', '2026-10-20', '2026-10-20', 'pi_paid');`);
  const sid = q("SELECT system_identifier::text FROM pg_control_system()");
  return (text) => {
    assert.equal(text.split(PROD_PROFILE).length, 2, "profile anchor");
    return text.replace(PROD_PROFILE, `"database": "${name}", "system_identifier": "${sid}"`);
  };
}

try {
  let local = freshDb("pwg_test");

  test("artifacts match SHA256SUMS and the build reproduces them byte for byte", () => {
    const sums = read("SHA256SUMS").trim().split("\n").map((l) => l.split(/\s+/));
    for (const [h, f] of sums) assert.equal(sha(readFileSync(`${DIR}/${f}`)), h, f);
    assert.match(execFileSync("python3", ["-I", `${DIR}/src/build.py`, "--check"], { encoding: "utf8" }), /reproduce byte for byte/);
    assert.ok(REQ.endsWith(PKG) && RB_REQ.endsWith(RB), "requests = guard + exact package bytes");
    for (const t of [REQ, RB_REQ]) assert.ok(/^[\x00-\x7f]*\n$/.test(t), "ASCII + final newline");
  });

  test("before the guard: a Manager or the Owner can mark a charge paid, rewrite its amount, or un-pay a paid one directly (today's exposure)", () => {
    assert.equal(fails(asUser(MANAGER, `UPDATE public.payments SET status = 'paid', paid_date = current_date, balance_due = 0 WHERE id = '${P1}'`)), null);
    assert.equal(fails(asUser(OWNER, `UPDATE public.payments SET status = 'current', paid_date = NULL WHERE id = '${P2}'`)), null);
    q(`SET session_replication_role = replica; UPDATE public.payments SET status = 'failed', paid_date = NULL, balance_due = 325 WHERE id = '${P1}'; UPDATE public.payments SET status = 'paid', paid_date = '2026-10-20' WHERE id = '${P2}'`);
  });

  test("preflight: every gate ok except the two local target rows (no invoker function writes payments)", () => {
    assert.deepEqual(notOk(PREFLIGHT), ["target.database", "target.system_identifier"]);
    assert.equal(q(`SELECT actual FROM (${PREFLIGHT.replace(/;\s*$/, "")}) r WHERE check_name = 'payments.invoker_functions_writing_payments'`), "none");
  });

  test("real guarded request + trailer: guard passes, package refuses the foreign target; tampering refused", () => {
    const err = fails(REQ + TRAILER) ?? "";
    assert.match(err, /TARGET_MISMATCH/);
    assert.doesNotMatch(err, /RRGUARD_/);
    const i = REQ.indexOf("PWG_PARTIAL_INSTALL");
    assert.match(fails(REQ.slice(0, i) + "X" + REQ.slice(i + 1) + TRAILER) ?? "", /RRGUARD_BYTES_MISMATCH/);
    assert.match(fails(REQ + TRAILER + "\nUPDATE public.payments SET status = 'paid';") ?? "", /RRGUARD_TRAILING_TEXT/);
    assert.equal(q("SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_payments_write_guard'"), "0");
  });

  test("a failure after the DDL rolls back everything", () => {
    assert.equal(PKG.split(FAILPOINT).length, 2);
    assert.match(fails(local(PKG).replace(FAILPOINT, "RAISE EXCEPTION 'INJECTED_FAILURE';")) ?? "", /INJECTED_FAILURE/);
    assert.equal(q("SELECT (to_regprocedure('private.payments_write_guard()') IS NULL)::text || (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_payments_write_guard')"), "true0");
  });

  test("local copy installs; verify-after all ok; a re-run is refused", () => {
    psql(DB, local(PKG));
    assert.equal(q("SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND tgname = 'zz_payments_write_guard' AND tgtype = 23 AND tgenabled = 'O'"), "1");
    for (const r of ["authenticated", "anon", "service_role"]) assert.equal(q(`SELECT has_function_privilege('${r}', 'private.payments_write_guard()', 'EXECUTE')`), "f");
    assert.deepEqual(notOk(VERIFY), []);
    assert.match(fails(local(PKG)) ?? "", /PWG_EVIDENCE_REPLAY/);
  });

  const MONEY_EDITS = [
    `status = 'paid', paid_date = current_date, balance_due = 0`,
    `status = 'waived'`,
    `status = 'void'`,
    `amount = 1`,
    `balance_due = 0`,
    `late_fees = 50`,
    `paid_date = current_date`,
    `refunded_amount = 10`,
    `stripe_payment_intent_id = 'pi_forged'`,
    `attempt_count = 9`,
    `failure_reason = 'forged'`,
    `notified_status = 'paid'`,
    // links, type and due date decide whose rental collects it, which vehicle/partner earns it, and late fees
    `rental_id = gen_random_uuid()`,
    `vehicle_id = gen_random_uuid()`,
    `driver_id = NULL`,
    `type = 'deposit'`,
    `due_date = '2026-01-01'`,
    `id = gen_random_uuid()`,
    `created_at = now() - interval '1 year'`,
  ];
  for (const [who, sub] of [["Manager", MANAGER], ["Owner", OWNER]]) {
    test(`${who} (own session): every direct change is refused except notes, and payment method while still owed (allowlist)`, () => {
      for (const set of MONEY_EDITS) assert.match(fails(asUser(sub, `UPDATE public.payments SET ${set} WHERE id = '${P1}'`)) ?? "", MONEY, set);
      assert.match(fails(asUser(sub, `UPDATE public.payments SET status = 'current', paid_date = NULL WHERE id = '${P2}'`)) ?? "", MONEY, "un-pay");
      assert.match(fails(asUser(sub, `UPDATE public.payments SET payment_method = 'Cash' WHERE id = '${P2}'`)) ?? "", MONEY, "relabel a Stripe-paid row");
      assert.equal(fails(asUser(sub, `UPDATE public.payments SET notes = 'receipt sent' WHERE id = '${P2}'`)), null, "notes stay editable on a settled row");
      assert.equal(row(P1), "failed|325.00|325.00|-|-");
      assert.equal(fails(asUser(sub, `UPDATE public.payments SET notes = 'called driver', payment_method = 'Card' WHERE id = '${P1}'`)), null);
      assert.equal(fails(asUser(sub, `UPDATE public.payments SET status = 'failed' WHERE id = '${P1}'`)), null, "an unchanged value is not a change");
      q(`UPDATE public.payments SET notes = NULL, payment_method = NULL WHERE id = '${P1}'`);
    });
  }

  test("Manager can still add a charge that starts owed; a charge that starts paid, refunded, waived, in flight or Stripe-linked is refused", () => {
    const ins = (cols, vals) => asUser(MANAGER, `INSERT INTO public.payments (driver_id, type, due_date, ${cols}) VALUES ('${APP}', 'rent', current_date, ${vals})`);
    assert.equal(fails(ins("amount, status", "100, 'current'")), null);
    assert.equal(fails(ins("amount, balance_due, status", "100, 100, 'upcoming'")), null);
    for (const [cols, vals] of [
      ["amount, status, paid_date", "100, 'paid', current_date"],
      ["amount, status", "100, 'paid'"],
      ["amount, status", "100, 'waived'"],
      ["amount, status", "100, 'refunded'"],
      ["amount, status", "100, 'pending'"],
      ["amount, status", "100, 'void'"],
      ["amount, balance_due, status", "100, 500, 'current'"],
      ["amount, status, stripe_payment_intent_id", "100, 'current', 'pi_forged'"],
      ["amount, status, refunded_amount", "100, 'current', 5"],
    ]) assert.match(fails(ins(cols, vals)) ?? "", /payments_new_charge_must_start_owed/, vals);
  });

  test("allowlist covers columns added later: a new column is frozen on update and must be empty on insert", () => {
    q("ALTER TABLE public.payments ADD COLUMN zz_future_amount numeric");
    try {
      assert.match(fails(asUser(MANAGER, `UPDATE public.payments SET zz_future_amount = 5 WHERE id = '${P1}'`)) ?? "", MONEY);
      assert.match(fails(asUser(MANAGER, `INSERT INTO public.payments (driver_id, type, due_date, amount, status, zz_future_amount) VALUES ('${APP}', 'rent', current_date, 1, 'current', 5)`)) ?? "", /payments_new_charge_must_start_owed/);
      assert.equal(fails(asUser(MANAGER, `INSERT INTO public.payments (driver_id, type, due_date, amount, status) VALUES ('${APP}', 'rent', current_date, 1, 'current')`)), null);
    } finally {
      q("ALTER TABLE public.payments DROP COLUMN zz_future_amount");
    }
  });

  test("Coordinator and driver: RLS already gives no write; nothing changes, and inserts are refused", () => {
    for (const sub of [COORD, DRIVER]) {
      assert.equal(fails(asUser(sub, `UPDATE public.payments SET status = 'paid' WHERE id = '${P1}'`)), null, "RLS filters the row out");
      assert.match(fails(asUser(sub, `INSERT INTO public.payments (driver_id, type, due_date, amount, status) VALUES ('${APP}', 'rent', current_date, 1, 'current')`)) ?? "", /row-level security|payments_new_charge/);
    }
    assert.equal(row(P1), "failed|325.00|325.00|-|-");
  });

  test("anon: no grant at all", () => {
    assert.match(fails(as("anon", null, `UPDATE public.payments SET status = 'paid' WHERE id = '${P1}'`)) ?? "", /permission denied for table payments/);
  });

  test("server code (service_role) keeps working: collection claim, Charge Card insert, webhook paid/failed, staff status actions", () => {
    const sr = (sql) => fails(as("service_role", null, sql));
    assert.equal(sr(`UPDATE public.payments SET status = 'pending', attempt_count = 2, last_attempt_at = now() WHERE id = '${P1}' AND status = 'failed' AND attempt_count < 2`), null);
    assert.equal(sr(`UPDATE public.payments SET status = 'paid', paid_date = current_date, balance_due = 0, failure_reason = NULL, stripe_payment_intent_id = 'pi_new' WHERE id = '${P1}'`), null);
    assert.equal(sr(`UPDATE public.payments SET notified_status = 'paid' WHERE id = '${P1}'`), null);
    assert.equal(sr(`INSERT INTO public.payments (driver_id, amount, balance_due, type, status, due_date) VALUES ('${APP}', 50, 50, 'toll', 'current', current_date)`), null);
    assert.equal(sr(`UPDATE public.payments SET status = 'waived', notes = 'Waived: hardship' WHERE type = 'toll' AND amount = 50`), null);
    assert.equal(q(`SELECT status FROM public.payments WHERE id = '${P1}'`), "paid");
  });

  test("refunds through apply_payment_refund (SECURITY DEFINER, called by service_role) still work", () => {
    assert.equal(fails(as("service_role", null, `SELECT public.apply_payment_refund(ARRAY['${P2}']::uuid[], 25, '[]'::jsonb, 'ch_1', 'pi_paid')`)), null);
    assert.equal(Number(q(`SELECT refunded_amount FROM public.payments WHERE id = '${P2}'`)), 25);
  });

  test("deleting a parent row still sets the payment's link to null (FK action runs as the table owner)", () => {
    assert.equal(fails(`DELETE FROM public.applications WHERE id = '${APP}'`), null);
    assert.equal(q(`SELECT count(*) FROM public.payments WHERE driver_id IS NULL AND id IN ('${P1}', '${P2}')`), "2");
  });

  test("real rollback request + trailer refuses the foreign target; local rollback removes exactly the trigger and function, keeps evidence; replay refused", () => {
    const err = fails(RB_REQ + TRAILER) ?? "";
    assert.match(err, /TARGET_MISMATCH/);
    assert.doesNotMatch(err, /RRGUARD_/);
    psql(DB, local(RB));
    assert.equal(q("SELECT (to_regprocedure('private.payments_write_guard()') IS NULL)::text || (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_payments_write_guard')"), "true0");
    assert.equal(q("SELECT string_agg(entity_id, ',' ORDER BY entity_id) FROM public.audit_log WHERE entity_id LIKE 'payments_write_guard_v1%'"), "payments_write_guard_v1,payments_write_guard_v1_rollback");
    assert.match(fails(local(RB)) ?? "", /PWG_ROLLBACK_REPLAY/);
    assert.equal(fails(asUser(MANAGER, `UPDATE public.payments SET notes = 'x', status = 'current' WHERE id = '${P1}'`)), null, "exposure is back after rollback");
  });

  test("coexists with the payments delete guard in either install order; each rolls back without touching the other", () => {
    for (const order of [["pdg", "pwg"], ["pwg", "pdg"]]) {
      local = freshDb("pwg_both");
      for (const step of order) {
        if (step === "pdg") {
          // The delete-guard package itself installs either way; only its reviewed preflight row
          // 'payments.triggers' expects payments_updated_at alone, so the recommended order is pdg first.
          psql(DB, local(PDG));
        } else {
          assert.deepEqual(notOk(PREFLIGHT), ["target.database", "target.system_identifier"], `preflight (${order})`);
          psql(DB, local(PKG));
          // Verify-after belongs right after its own install: it fingerprints payments as installed.
          assert.deepEqual(notOk(VERIFY), [], `write-guard verify-after (${order})`);
        }
      }
      assert.match(fails(asUser(MANAGER, `DELETE FROM public.payments WHERE id = '${P1}'`)) ?? "", /payments_are_financial_history_void_instead/);
      assert.match(fails(asUser(MANAGER, `UPDATE public.payments SET status = 'paid' WHERE id = '${P1}'`)) ?? "", MONEY);
      psql(DB, local(RB));
      assert.match(fails(asUser(MANAGER, `DELETE FROM public.payments WHERE id = '${P1}'`)) ?? "", /payments_are_financial_history_void_instead/, "delete guard intact");
      psql(DB, local(PDG_RB));
      assert.equal(q("SELECT count(*) FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND NOT tgisinternal"), "1");
    }
  });
} finally {
  for (const d of ["pwg_test", "pwg_both"]) {
    try { psql(ADMIN, `DROP DATABASE IF EXISTS ${d} WITH (FORCE)`); } catch {}
  }
}

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exit(1);
