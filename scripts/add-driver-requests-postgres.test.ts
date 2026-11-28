/**
 * 20261128170000_add_driver_requests.sql against a throwaway Postgres. Never reads production env.
 * Run: bun test scripts/add-driver-requests-postgres.test.ts
 * Uses PG_BIN, else pg_config --bindir, else /usr/lib/postgresql/<v>/bin. Skips when no initdb.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.PG_BIN) out.push(process.env.PG_BIN);
  const r = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) out.push(r.stdout.trim());
  if (existsSync("/usr/lib/postgresql")) for (const v of readdirSync("/usr/lib/postgresql")) out.push(`/usr/lib/postgresql/${v}/bin`);
  out.push("/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin");
  return out;
}
const BIN = candidates().find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
const DIR = mkdtempSync(join(tmpdir(), "rr-add-driver-pg-"));
const PORT = String(52000 + Math.floor(Math.random() * 4000));
const PSQL = BIN && existsSync(join(BIN, "psql")) ? join(BIN, "psql") : "psql";

function run(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed\n${r.stdout}\n${r.stderr}`);
}
function psql(sql: string) {
  const r = spawnSync(PSQL, ["-h", DIR, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], { input: sql, encoding: "utf8" });
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}
function must(sql: string) {
  const r = psql(sql);
  if (!r.ok) throw new Error(r.err);
  return r.out;
}
/** A browser session: role authenticated as one user, manager or not. */
function asUser(uid: string, manager: boolean, sql: string) {
  return psql(`SET test.uid = '${uid}'; SET test.manager = '${manager ? "on" : "off"}'; SET ROLE authenticated; ${sql}`);
}
function asService(sql: string) {
  return psql(`SET ROLE service_role; ${sql}`);
}

const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA auth; CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private, auth TO anon, authenticated, service_role;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
CREATE FUNCTION private.is_manager() RETURNS boolean LANGUAGE sql STABLE AS $$ select coalesce(current_setting('test.manager', true), 'off') = 'on' $$;
GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION private.is_manager() TO anon, authenticated, service_role;
CREATE FUNCTION public.set_updated_at() RETURNS trigger LANGUAGE plpgsql AS 'begin new.updated_at = now(); return new; end';
CREATE TABLE public.applications (id uuid PRIMARY KEY, user_id uuid, full_name text);
CREATE TABLE public.rentals (id uuid PRIMARY KEY, application_id uuid);
CREATE TABLE public.payments (id uuid PRIMARY KEY, status text);
GRANT SELECT ON public.applications TO authenticated;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
`;

const U1 = "11111111-1111-4111-8111-111111111111";
const U2 = "22222222-2222-4222-8222-222222222222";
const STAFF = "33333333-3333-4333-8333-333333333333";
const A1 = "aaaaaaaa-1111-4111-8111-111111111111";
const A2 = "aaaaaaaa-2222-4222-8222-222222222222";
const R1 = "bbbbbbbb-1111-4111-8111-111111111111";
const P1 = "cccccccc-1111-4111-8111-111111111111";
const MIGRATION = readFileSync(new URL("../supabase/migrations/20261128170000_add_driver_requests.sql", import.meta.url), "utf8");

function insertSql(id: string, app: string, by: string, extra = "") {
  return `INSERT INTO public.additional_driver_requests (id, application_id, rental_id, requested_by, full_name, dob, phone, email, relationship,
    address_line1, city, state, zip, license_number, license_state, license_expiration, license_front_path, license_back_path, consent_version${extra ? ", " + extra.split("=")[0] : ""})
    VALUES ('${id}', '${app}', ${app === A1 ? `'${R1}'` : "NULL"}, '${by}', 'Sam Driver', '1990-01-01', '5555550199', 'sam@example.com', 'Spouse',
    '1 Main St', 'Tampa', 'FL', '33602', 'D1234567', 'FL', '2029-01-01', '${app}/additional-driver/f.jpg', '${app}/additional-driver/b.jpg', 'v1'${extra ? ", " + extra.split("=")[1] : ""})`;
}

const REQ1 = "dddddddd-1111-4111-8111-111111111111";
const REQ2 = "dddddddd-2222-4222-8222-222222222222";

const skip = !BIN;
beforeAll(() => {
  if (skip) return;
  run(join(BIN!, "initdb"), ["-D", join(DIR, "data"), "-U", "postgres", "-A", "trust"]);
  run(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-l", join(DIR, "pg.log"), "-o", `-k ${DIR} -p ${PORT} -c listen_addresses=''`, "-w", "start"]);
  must(STUBS);
  must(MIGRATION);
  must(MIGRATION); // re-runnable
  must(`INSERT INTO public.applications VALUES ('${A1}', '${U1}', 'Pat Renter'), ('${A2}', '${U2}', 'Other Renter');
        INSERT INTO public.rentals VALUES ('${R1}', '${A1}');
        INSERT INTO public.payments VALUES ('${P1}', 'paid');`);
  must(`SET ROLE service_role; ${insertSql(REQ1, A1, U1)}; ${insertSql(REQ2, A2, U2)};`);
});
afterAll(() => {
  if (skip) return;
  if (!process.env.KEEP_PG) spawnSync(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-m", "immediate", "stop"]);
  if (!process.env.KEEP_PG) rmSync(DIR, { recursive: true, force: true });
});

describe.skipIf(skip)("add driver requests in Postgres", () => {
  test("RLS: a renter sees only their own requests", () => {
    const mine = asUser(U1, false, "SELECT string_agg(id::text, ',') FROM public.additional_driver_requests");
    expect(mine.ok).toBe(true);
    expect(mine.out).toBe(REQ1);
    expect(asUser(U2, false, "SELECT string_agg(id::text, ',') FROM public.additional_driver_requests").out).toBe(REQ2);
    expect(asUser("44444444-4444-4444-8444-444444444444", false, "SELECT count(*) FROM public.additional_driver_requests").out).toBe("0");
  });
  test("RLS: managers see all; anon sees nothing", () => {
    expect(asUser(STAFF, true, "SELECT count(*) FROM public.additional_driver_requests").out).toBe("2");
    const anon = psql("SET ROLE anon; SELECT count(*) FROM public.additional_driver_requests");
    expect(anon.ok).toBe(false);
  });
  test("a renter cannot insert, update or delete, even their own row", () => {
    expect(asUser(U1, false, insertSql("dddddddd-3333-4333-8333-333333333333", A1, U1)).ok).toBe(false);
    expect(asUser(U1, false, `UPDATE public.additional_driver_requests SET status = 'approved' WHERE id = '${REQ1}'`).ok).toBe(false);
    expect(asUser(U1, false, `DELETE FROM public.additional_driver_requests WHERE id = '${REQ1}'`).ok).toBe(false);
    // A manager's browser session cannot write either: staff steps go through the server.
    expect(asUser(STAFF, true, `UPDATE public.additional_driver_requests SET status = 'paid' WHERE id = '${REQ1}'`).ok).toBe(false);
    expect(must(`SELECT status FROM public.additional_driver_requests WHERE id = '${REQ1}'`)).toBe("requested");
  });
  test("a new row must start Requested", () => {
    const r = asService(insertSql("dddddddd-4444-4444-8444-444444444444", A1, U1, "status='approved'"));
    expect(r.ok).toBe(false);
    expect(r.err).toContain("add_driver_request_must_start_requested");
  });
  test("steps follow the order and need their facts", () => {
    const step = (sql: string) => asService(`UPDATE public.additional_driver_requests SET ${sql} WHERE id = '${REQ1}'`);
    // Skips are refused.
    expect(step(`status = 'insurance_pending', insurance_started_at = now(), insurance_started_by = '${STAFF}'`).err).toContain("add_driver_request_bad_step");
    expect(step(`status = 'approved', decided_at = now(), decided_by = '${STAFF}', insurance_card_path = 'x'`).err).toContain("add_driver_request_bad_step");
    // Paid needs the payment.
    expect(step("status = 'paid'").err).toContain("add_driver_request_paid_needs_payment");
    expect(step(`status = 'paid', paid_at = now(), payment_id = '${P1}'`).ok).toBe(true);
    // Insurance Pending needs the staff member.
    expect(step("status = 'insurance_pending'").err).toContain("add_driver_request_needs_staff");
    expect(step(`status = 'insurance_pending', insurance_started_at = now(), insurance_started_by = '${STAFF}'`).ok).toBe(true);
    // Approved needs a staff decision and the insurance card.
    expect(step(`status = 'approved', decided_at = now(), decided_by = '${STAFF}'`).err).toContain("add_driver_request_approve_needs_card");
    expect(step(`status = 'approved', decided_at = now(), decided_by = '${STAFF}', insurance_card_path = '${A1}/additional-driver/insurance_card-1.pdf'`).ok).toBe(true);
    // Closed for good.
    expect(step(`status = 'denied', decided_at = now(), decided_by = '${STAFF}', decision_notes = 'x'`).err).toContain("add_driver_request_closed");
  });
  test("Denied needs a note; submitted details are locked", () => {
    const step = (sql: string) => asService(`UPDATE public.additional_driver_requests SET ${sql} WHERE id = '${REQ2}'`);
    expect(step(`full_name = 'Someone Else'`).err).toContain("add_driver_request_details_locked");
    expect(step(`status = 'denied', decided_at = now(), decided_by = '${STAFF}'`).err).toContain("add_driver_request_deny_needs_note");
    expect(step(`status = 'denied', decided_at = now(), decided_by = '${STAFF}', decision_notes = 'Different household'`).ok).toBe(true);
  });
});
