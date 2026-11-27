/**
 * 20261127170000_internal_dnc_list.sql against a throwaway Postgres. Never reads production env.
 * Run: bun test scripts/dnc-list-postgres.test.ts
 * Uses PG_BIN, else pg_config --bindir, else /usr/lib/postgresql/<v>/bin. Skips when no initdb.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { normalizeDncEmail, normalizeDncPhone } from "../src/lib/dnc";

function candidates(): string[] {
  const out: string[] = [];
  if (process.env.PG_BIN) out.push(process.env.PG_BIN);
  const r = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) out.push(r.stdout.trim());
  if (existsSync("/usr/lib/postgresql"))
    for (const v of readdirSync("/usr/lib/postgresql")) out.push(`/usr/lib/postgresql/${v}/bin`);
  out.push("/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin");
  return out;
}
const BIN = candidates().find(
  (d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")),
);
const DIR = mkdtempSync(join(tmpdir(), "rr-dnc-pg-"));
const PORT = String(52000 + Math.floor(Math.random() * 4000));
const PSQL = BIN && existsSync(join(BIN, "psql")) ? join(BIN, "psql") : "psql";

function run(bin: string, args: string[]) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed\n${r.stdout}\n${r.stderr}`);
}
function psql(sql: string) {
  const r = spawnSync(
    PSQL,
    [
      "-h",
      DIR,
      "-p",
      PORT,
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-v",
      "ON_ERROR_STOP=1",
      "-At",
      "-q",
    ],
    { input: sql, encoding: "utf8" },
  );
  return { ok: r.status === 0, out: (r.stdout ?? "").trim(), err: r.stderr ?? "" };
}
function must(sql: string) {
  const r = psql(sql);
  if (!r.ok) throw new Error(r.err);
  return r.out;
}
/** Run as a browser session: role authenticated, staff or not. */
function asUser(staff: boolean, sql: string) {
  return psql(`SET test.staff = '${staff ? "on" : "off"}'; SET ROLE authenticated; ${sql}`);
}
const lit = (v: string | null) => (v == null ? "NULL" : `'${v.replace(/'/g, "''")}'`);

const APP = "11111111-1111-4111-8111-111111111111";
const APP2 = "22222222-2222-4222-8222-222222222222";
const WL = "33333333-3333-4333-8333-333333333333";
const STAFF = "44444444-4444-4444-8444-444444444444";

const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN BYPASSRLS;
CREATE SCHEMA private;
GRANT USAGE ON SCHEMA public, private TO anon, authenticated, service_role;
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql STABLE AS $$ select coalesce(current_setting('test.staff', true), 'off') = 'on' $$;
GRANT EXECUTE ON FUNCTION private.is_staff() TO anon, authenticated;
CREATE TABLE public.applications (id uuid PRIMARY KEY, full_name text, phone text, email text, status text);
CREATE TABLE public.waitlist (id uuid PRIMARY KEY, full_name text, phone text, email text);
`;

const skip = !BIN;
beforeAll(() => {
  if (skip) return;
  run(join(BIN!, "initdb"), ["-D", join(DIR, "data"), "-U", "postgres", "-A", "trust"]);
  run(join(BIN!, "pg_ctl"), [
    "-D",
    join(DIR, "data"),
    "-l",
    join(DIR, "pg.log"),
    "-o",
    `-k ${DIR} -p ${PORT} -c listen_addresses=''`,
    "-w",
    "start",
  ]);
  must(STUBS);
  const migration = readFileSync(
    new URL("../supabase/migrations/20261127170000_internal_dnc_list.sql", import.meta.url),
    "utf8",
  );
  must(migration);
  must(migration); // re-runnable
  must(`INSERT INTO public.applications VALUES ('${APP}', 'Pat Sample', '(555) 010-0199', 'Pat@Example.com', 'approved'),
                                            ('${APP2}', 'Lee Other', '555-010-0177', 'lee@example.com', 'new');
        INSERT INTO public.waitlist VALUES ('${WL}', 'Wai Lister', '+1 555 010 0155', 'wl@example.com');`);
});
afterAll(() => {
  if (skip) return;
  spawnSync(join(BIN!, "pg_ctl"), ["-D", join(DIR, "data"), "-m", "immediate", "stop"]);
  rmSync(DIR, { recursive: true, force: true });
});

function addRow() {
  return must(`INSERT INTO public.dnc_list (application_id, person_type, full_name, phones, emails, reason, added_by, added_by_label)
    VALUES ('${APP}', 'driver', 'Pat Sample', ARRAY['5550100199'], ARRAY['pat@example.com'], 'Asked not to be contacted', '${STAFF}', 'staff@example.com (Manager)')
    RETURNING id`);
}

describe.skipIf(skip)("internal DNC list in Postgres", () => {
  test("SQL normalizers match src/lib/dnc.ts", () => {
    for (const p of [
      "(555) 010-0199",
      "+1 555 010 0199",
      "15550100199",
      "555-0199",
      "",
      null,
      "25550100199",
    ])
      expect(must(`SELECT coalesce(private.dnc_norm_phone(${lit(p)}), '<null>')`)).toBe(
        normalizeDncPhone(p) ?? "<null>",
      );
    for (const e of ["  Pat@Example.COM ", "n/a", "x@y", "", null, "a b@c.d"])
      expect(must(`SELECT coalesce(private.dnc_norm_email(${lit(e)}), '<null>')`)).toBe(
        normalizeDncEmail(e) ?? "<null>",
      );
  });

  test("RLS is enabled and forced; anon has no privilege at all", () => {
    expect(
      must(
        `SELECT relrowsecurity || ',' || relforcerowsecurity FROM pg_class WHERE oid = 'public.dnc_list'::regclass`,
      ),
    ).toBe("true,true");
    expect(
      must(
        `SELECT has_table_privilege('anon', 'public.dnc_list', 'SELECT') OR has_any_column_privilege('anon', 'public.dnc_list', 'SELECT')`,
      ),
    ).toBe("f");
    for (const priv of ["INSERT", "UPDATE", "DELETE", "TRUNCATE"])
      expect(
        must(`SELECT has_table_privilege('authenticated', 'public.dnc_list', '${priv}')`),
      ).toBe("f");
    expect(must(`SELECT has_table_privilege('authenticated', 'public.dnc_list', 'SELECT')`)).toBe(
      "f",
    );
    expect(
      must(`SELECT has_column_privilege('authenticated', 'public.dnc_list', 'reason', 'SELECT')`),
    ).toBe("t");
    expect(
      must(`SELECT has_column_privilege('authenticated', 'public.dnc_list', 'phones', 'SELECT')`),
    ).toBe("f");
    expect(
      must(`SELECT has_column_privilege('authenticated', 'public.dnc_list', 'emails', 'SELECT')`),
    ).toBe("f");
    expect(
      must(
        `SELECT has_function_privilege('authenticated', 'public.dnc_suppressed(uuid,text,text)', 'EXECUTE')`,
      ),
    ).toBe("f");
    expect(
      must(
        `SELECT has_function_privilege('anon', 'public.dnc_suppressed(uuid,text,text)', 'EXECUTE')`,
      ),
    ).toBe("f");
    expect(
      must(
        `SELECT has_function_privilege('service_role', 'public.dnc_suppressed(uuid,text,text)', 'EXECUTE')`,
      ),
    ).toBe("t");
    const anon = psql(`SET ROLE anon; SELECT id FROM public.dnc_list;`);
    expect(anon.ok).toBe(false);
  });

  test("staff read display columns only; non-staff see nothing; browsers cannot write", () => {
    const id = addRow();
    expect(
      asUser(true, `SELECT full_name || '|' || reason FROM public.dnc_list WHERE id = '${id}'`).out,
    ).toBe("Pat Sample|Asked not to be contacted");
    expect(asUser(false, `SELECT count(*) FROM public.dnc_list`).out).toBe("0");
    const phones = asUser(true, `SELECT phones FROM public.dnc_list`);
    expect(phones.ok).toBe(false);
    expect(phones.err).toMatch(/permission denied/);
    expect(asUser(true, `SELECT * FROM public.dnc_list`).ok).toBe(false);
    expect(
      asUser(
        true,
        `INSERT INTO public.dnc_list (person_type, phones, reason, added_by_label) VALUES ('lead', ARRAY['5550000000'], 'nope', 'x')`,
      ).ok,
    ).toBe(false);
    expect(asUser(true, `UPDATE public.dnc_list SET reason = 'changed'`).ok).toBe(false);
    expect(asUser(true, `DELETE FROM public.dnc_list`).ok).toBe(false);
    // service_role (the server) can read everything.
    expect(
      psql(`SET ROLE service_role; SELECT phones[1] FROM public.dnc_list WHERE id = '${id}'`).out,
    ).toBe("5550100199");
    must(
      `UPDATE public.dnc_list SET removed_at = now(), removed_by_label = 'x (Owner)', removal_reason = 'reset' WHERE id = '${id}'`,
    );
  });

  test("one active entry per application; history is kept; rows are never deleted", () => {
    const id = addRow();
    const dup = psql(
      `INSERT INTO public.dnc_list (application_id, person_type, reason, added_by_label) VALUES ('${APP}', 'driver', 'again', 'x')`,
    );
    expect(dup.ok).toBe(false);
    expect(dup.err).toMatch(/dnc_list_one_active_per_application/);
    expect(psql(`DELETE FROM public.dnc_list WHERE id = '${id}'`).err).toMatch(/never deleted/);
    expect(psql(`UPDATE public.dnc_list SET reason = 'edited' WHERE id = '${id}'`).err).toMatch(
      /Only the removal fields/,
    );
    expect(
      psql(`UPDATE public.dnc_list SET application_id = '${APP2}' WHERE id = '${id}'`).err,
    ).toMatch(/Only the removal fields/);
    // A removal needs who and why.
    expect(psql(`UPDATE public.dnc_list SET removed_at = now() WHERE id = '${id}'`).err).toMatch(
      /dnc_list_removal_complete/,
    );
    must(
      `UPDATE public.dnc_list SET removed_at = now(), removed_by = '${STAFF}', removed_by_label = 'boss@example.com (Owner)', removal_reason = 'Asked to hear from us again' WHERE id = '${id}'`,
    );
    expect(
      psql(`UPDATE public.dnc_list SET removal_reason = 'rewrite' WHERE id = '${id}'`).err,
    ).toMatch(/already removed/);
    // Moving them back is a new row.
    addRow();
    expect(
      Number(must(`SELECT count(*) FROM public.dnc_list WHERE application_id = '${APP}'`)),
    ).toBeGreaterThanOrEqual(2);
    expect(
      must(
        `SELECT count(*) FROM public.dnc_list WHERE application_id = '${APP}' AND removed_at IS NULL`,
      ),
    ).toBe("1");
  });

  test("a reason and a person are required", () => {
    expect(
      psql(
        `INSERT INTO public.dnc_list (person_type, reason, added_by_label) VALUES ('lead', 'no person', 'x')`,
      ).err,
    ).toMatch(/dnc_list_has_person/);
    expect(
      psql(
        `INSERT INTO public.dnc_list (waitlist_id, person_type, reason, added_by_label) VALUES ('${WL}', 'lead', '  ', 'x')`,
      ).err,
    ).toMatch(/check/i);
    expect(
      psql(
        `INSERT INTO public.dnc_list (waitlist_id, person_type, reason, added_by_label) VALUES ('${WL}', 'other', 'reason', 'x')`,
      ).err,
    ).toMatch(/person_type/);
  });

  test("dnc_suppressed matches by application, normalized phone and normalized email", () => {
    const q = (app: string | null, phone: string | null, email: string | null) =>
      must(
        `SELECT public.dnc_suppressed(${app ? `'${app}'` : "NULL"}, ${lit(phone)}, ${lit(email)})`,
      );
    expect(q(APP, null, null)).toBe("t");
    expect(q(null, "+1 (555) 010-0199", null)).toBe("t");
    expect(q(null, null, "  PAT@example.com")).toBe("t");
    expect(q(APP2, "555-010-0177", "lee@example.com")).toBe("f");
    expect(q(null, null, null)).toBe("f");
    expect(q(null, "0199", "not-an-email")).toBe("f");
    // A waitlist lead entered only by its own row.
    must(`INSERT INTO public.dnc_list (waitlist_id, person_type, full_name, phones, emails, reason, added_by_label)
          VALUES ('${WL}', 'lead', 'Wai Lister', ARRAY['5550100155'], ARRAY['wl@example.com'], 'Wrong number, asked to stop', 'x (Coordinator)')`);
    expect(q(null, "15550100155", null)).toBe("t");
    // Removed entries stop suppressing.
    must(
      `UPDATE public.dnc_list SET removed_at = now(), removed_by_label = 'x (Owner)', removal_reason = 'ok again' WHERE waitlist_id = '${WL}' AND removed_at IS NULL`,
    );
    expect(q(null, "15550100155", "wl@example.com")).toBe("f");
  });

  test("deleting the person keeps the history row (links set to NULL), even for removed rows", () => {
    must(`DELETE FROM public.applications WHERE id = '${APP}'`);
    expect(
      must(
        `SELECT count(*) FROM public.dnc_list WHERE application_id IS NULL AND full_name = 'Pat Sample'`,
      ),
    ).not.toBe("0");
    // The active row still suppresses by phone after the application is gone.
    expect(must(`SELECT public.dnc_suppressed(NULL, '5550100199', NULL)`)).toBe("t");
    must(`DELETE FROM public.waitlist WHERE id = '${WL}'`);
    expect(
      must(
        `SELECT count(*) FROM public.dnc_list WHERE full_name = 'Wai Lister' AND waitlist_id IS NULL`,
      ),
    ).toBe("1");
  });
});
