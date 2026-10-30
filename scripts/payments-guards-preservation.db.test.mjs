// Local-only: production-like stack (rr_tpl + 0031 + S1 + AIS + IVA), then the payments DELETE guard and
// write guard in the approved order, their preflights/verify-afters, server-side payment operations,
// and both rollbacks — checking S1, AIS and IVA verify-afters at every step. 127.0.0.1:55482 only.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

// Packages live on separate branches, so point at checkouts of them (defaults: this session's worktrees):
//   R2_TREE  = release/financial-integrity-3 @ 4fdf5a78 (DELETE guard, AIS, IVA)
//   PWG_TREE = fix/payments-write-guard-sql @ ed2ed072 (write guard)
//   S1_DIR   = the S1 package directory (proposed/security-s1)
const R2 = process.env.R2_TREE ?? "/home/user/wt-r3", PWG = process.env.PWG_TREE ?? "/home/user/wt-pwg";
const S1 = process.env.S1_DIR ?? "/home/user/wt-s1/proposed/security-s1";
const ADMIN = "postgresql://postgres@127.0.0.1:55482/postgres?sslmode=disable";
const NAME = "guards_prodlike";
const DB = `postgresql://postgres@127.0.0.1:55482/${NAME}?sslmode=disable`;
const PROFILE = '"database": "postgres", "system_identifier": "7642734024280108049"';
const psql = (url, sql) => execFileSync("psql", [url, "-qAtX", "-v", "ON_ERROR_STOP=1", "-c", sql], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20 }).trim();
const read = (p) => readFileSync(p, "utf8");
let sid = "";
const local = (t) => { if (t.split(PROFILE).length !== 2) throw new Error("profile anchor"); return t.replace(PROFILE, `"database": "${NAME}", "system_identifier": "${sid}"`); };
const notOk = (sql) => psql(DB, `SELECT coalesce(string_agg(check_name, ',' ORDER BY check_name), '') FROM (${sql.replace(/;\s*$/, "")}) r WHERE NOT ok`);
const results = [];
const step = (name, fn) => { try { const v = fn(); results.push(["PASS", name, v ?? ""]); } catch (e) { results.push(["FAIL", name, String(e.stderr || e.message).split("\n").find((l) => /ERROR|Error|expected/.test(l)) ?? String(e).slice(0, 200)]); } };
const expectEq = (a, b, m) => { if (a !== b) throw new Error(`${m}: expected ${JSON.stringify(b)} got ${JSON.stringify(a)}`); return a; };

const PROT = {
  S1: `${S1}/verify-after-readonly.sql`,
  AIS: `${R2}/proposed/activation-insurance-setting/verify-after-readonly.sql`,
  IVA: `${R2}/proposed/insurance-verification-authority/verify-after-readonly.sql`,
};
const s1Failed = () => {
  const v = JSON.parse(psql(DB, read(PROT.S1).replace(/;\s*$/, "")));
  if (v.all_gates === true) return "";
  return Object.entries(v.gates).filter(([, x]) => x !== true).map(([k]) => k).join(",") || "not all gates";
};
const protections = () => Object.entries(PROT).map(([k, f]) => `${k}:${(k === "S1" ? s1Failed() : notOk(read(f))) || "ok"}`).join(" ");

psql(ADMIN, `DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
psql(ADMIN, `CREATE DATABASE ${NAME} TEMPLATE rr_tpl`);
try {
  sid = psql(DB, "SELECT system_identifier::text FROM pg_control_system()");
  psql(DB, "CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY); INSERT INTO supabase_migrations.schema_migrations SELECT lpad(g::text, 14, '0') FROM generate_series(1, 105) g ON CONFLICT DO NOTHING");
  step("production-like base: S1, AIS, IVA installed (as in production)", () => {
    psql(DB, local(read(`${S1}/s1_application_write_guard.sql`)));
    psql(DB, local(read(`${R2}/proposed/activation-insurance-setting/activation_insurance_setting_v1.sql`)));
    psql(DB, local(read(`${R2}/proposed/insurance-verification-authority/insurance_verification_authority_v1.sql`)));
    return expectEq(protections(), "S1:ok AIS:ok IVA:ok", "protections");
  });
  const p0031 = () => psql(DB, "SELECT md5(string_agg(concat_ws('|', schemaname, tablename, policyname, permissive, roles::text, cmd, qual, with_check), E'\\n' ORDER BY policyname)) FROM pg_policies WHERE policyname IN ('coordinator_agreement_containment','coordinator_application_containment','coordinator_document_containment','coordinator_identity_storage_containment','coordinator_review_containment')");
  const base0031 = p0031();
  step("0031 policies md5 = production", () => expectEq(base0031, "d33877618a9f40924d14e49b6653d7fa", "0031"));

  const PDG = `${R2}/proposed/payments-delete-guard`, PWGD = `${PWG}/proposed/payments-write-guard`;
  step("1a DELETE guard preflight: only the two local target rows differ", () => expectEq(notOk(read(`${PDG}/preflight-readonly.sql`)), "target.database,target.system_identifier", "pdg preflight"));
  step("1b DELETE guard installs (local copy of the reviewed package)", () => { psql(DB, local(read(`${PDG}/payments_delete_guard_v1.sql`))); });
  step("1c DELETE guard verify-after all ok", () => expectEq(notOk(read(`${PDG}/verify-after-readonly.sql`)), "", "pdg verify"));
  step("1d S1, AIS, IVA, 0031 unchanged after DELETE guard", () => { expectEq(p0031(), base0031, "0031"); return expectEq(protections(), "S1:ok AIS:ok IVA:ok", "protections"); });
  step("2a write guard preflight (DELETE guard present): only target rows differ", () => expectEq(notOk(read(`${PWGD}/preflight-readonly.sql`)), "target.database,target.system_identifier", "pwg preflight"));
  step("2b write guard installs", () => { psql(DB, local(read(`${PWGD}/payments_write_guard_v1.sql`))); });
  step("2c write guard verify-after all ok", () => expectEq(notOk(read(`${PWGD}/verify-after-readonly.sql`)), "", "pwg verify"));
  step("2d S1, AIS, IVA, 0031 unchanged after write guard", () => { expectEq(p0031(), base0031, "0031"); return expectEq(protections(), "S1:ok AIS:ok IVA:ok", "protections"); });

  const sr = (sql) => psql(DB, `BEGIN; SET LOCAL ROLE service_role; ${sql}; COMMIT;`);
  step("3 server-side payments unaffected (service_role): charge insert, claim, paid, notice claim, failed, waive/void, refund", () => {
    psql(DB, "SET session_replication_role = replica; INSERT INTO public.applications (id, full_name, email, phone, status) VALUES ('11111111-1111-4111-8111-111111111111', 'Syn', 's@t', '0', 'approved')");
    sr("INSERT INTO public.payments (id, driver_id, amount, balance_due, type, status, due_date) VALUES ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111', 325, 325, 'rent', 'current', current_date), ('a0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111', 50, 50, 'toll', 'current', current_date), ('a0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111', 20, 20, 'other', 'current', current_date)");
    sr("UPDATE public.payments SET status = 'pending', attempt_count = 1, last_attempt_at = now() WHERE id = 'a0000000-0000-4000-8000-000000000001' AND status = 'current'");
    sr("UPDATE public.payments SET status = 'paid', paid_date = current_date, balance_due = 0, failure_reason = NULL, stripe_payment_intent_id = 'pi_1' WHERE id = 'a0000000-0000-4000-8000-000000000001'");
    sr("UPDATE public.payments SET notified_status = 'paid' WHERE id = 'a0000000-0000-4000-8000-000000000001' AND (notified_status IS NULL OR notified_status <> 'paid')");
    sr("UPDATE public.payments SET status = 'failed', failure_reason = 'declined' WHERE id = 'a0000000-0000-4000-8000-000000000002'");
    sr("UPDATE public.payments SET status = 'waived', notes = 'Waived: x' WHERE id = 'a0000000-0000-4000-8000-000000000002'");
    sr("UPDATE public.payments SET status = 'void', notes = 'Voided: x' WHERE id = 'a0000000-0000-4000-8000-000000000003'");
    sr("SELECT public.apply_payment_refund(ARRAY['a0000000-0000-4000-8000-000000000001']::uuid[], 25, '[]'::jsonb, 'ch_1', 'pi_1')");
    return psql(DB, "SELECT string_agg(status || ':' || coalesce(refunded_amount::text, '0'), ',' ORDER BY id) FROM public.payments");
  });
  step("3b a user session still can't delete or change money fields", () => {
    const M = "33333333-3333-4333-8333-333333333333";
    psql(DB, `SET session_replication_role = replica; INSERT INTO auth.users (id, email) VALUES ('${M}', 'm@t') ON CONFLICT DO NOTHING; INSERT INTO public.user_roles (user_id, role) VALUES ('${M}', 'team') ON CONFLICT DO NOTHING`);
    const tryAs = (sql) => { try { psql(DB, `BEGIN; SELECT set_config('request.jwt.claims', '{"role":"authenticated","sub":"${M}"}', true), set_config('request.jwt.claim.sub', '${M}', true); SET LOCAL ROLE authenticated; ${sql}; COMMIT;`); return "allowed"; } catch (e) { return /void_instead|audited_server/.test(String(e.stderr)) ? "refused" : "error:" + String(e.stderr).split("\n")[0]; } };
    return expectEq(`delete:${tryAs("DELETE FROM public.payments WHERE id = 'a0000000-0000-4000-8000-000000000002'")} update:${tryAs("UPDATE public.payments SET status = 'current' WHERE id = 'a0000000-0000-4000-8000-000000000001'")}`, "delete:refused update:refused", "manager direct");
  });

  step("4a rollback write guard first: objects gone, evidence kept; DELETE guard intact", () => {
    psql(DB, local(read(`${PWGD}/rollback.sql`)));
    expectEq(psql(DB, "SELECT (to_regprocedure('private.payments_write_guard()') IS NULL)::text || (SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_payments_write_guard')"), "true0", "pwg gone");
    return expectEq(psql(DB, "SELECT count(*) FROM pg_trigger WHERE tgname = 'zz_payments_delete_guard'"), "1", "pdg intact");
  });
  step("4b rollback DELETE guard: objects gone; triggers back to payments_updated_at", () => {
    psql(DB, local(read(`${PDG}/rollback.sql`)));
    return expectEq(psql(DB, "SELECT string_agg(tgname, ',') FROM pg_trigger WHERE tgrelid = 'public.payments'::regclass AND NOT tgisinternal"), "payments_updated_at", "triggers");
  });
  step("4c after both rollbacks: S1, AIS, IVA, 0031 unchanged; 4 evidence rows kept", () => {
    expectEq(p0031(), base0031, "0031");
    expectEq(psql(DB, "SELECT count(*) FROM public.audit_log WHERE entity_type = 'database_migration' AND entity_id LIKE 'payments_%guard_v1%'"), "4", "evidence");
    return expectEq(protections(), "S1:ok AIS:ok IVA:ok", "protections");
  });
} finally {
  psql(ADMIN, `DROP DATABASE IF EXISTS ${NAME} WITH (FORCE)`);
}
for (const r of results) console.log(r.join(" | "));
const f = results.filter((r) => r[0] === "FAIL").length;
console.log(`\n${results.length - f} passed, ${f} failed`);
process.exit(f ? 1 : 0);
