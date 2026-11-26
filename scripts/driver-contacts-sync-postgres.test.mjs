/**
 * applications_sync_primary_contacts against a throwaway Postgres.
 *
 * Regression for Nov 17 2026: the 20261116160000 trigger declared a PL/pgSQL
 * variable named "kind" (same as driver_contacts.kind), so every applications
 * INSERT and every phone/email UPDATE failed with 42702 "column reference
 * \"kind\" is ambiguous". That broke the website application form and
 * waitlist "Promote To Applicant". Never reads production env.
 *
 * Run: node scripts/driver-contacts-sync-postgres.test.mjs
 * Uses PG_BIN, else pg_config --bindir, else the embedded binaries in
 * /workspace/pg17. Skips (exit 0) only when no initdb is available.
 */
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function candidates() {
  const out = [];
  if (process.env.PG_BIN) out.push(process.env.PG_BIN);
  const r = spawnSync("pg_config", ["--bindir"], { encoding: "utf8" });
  if (r.status === 0 && r.stdout.trim()) out.push(r.stdout.trim());
  out.push("/workspace/pg17/node_modules/@embedded-postgres/linux-x64/native/bin");
  return out;
}
const BIN = candidates().find((d) => existsSync(join(d, "initdb")) && existsSync(join(d, "pg_ctl")));
if (!BIN) {
  console.log("SKIP driver-contacts-sync-postgres: no initdb/pg_ctl found");
  process.exit(0);
}
const PSQL = existsSync(join(BIN, "psql")) ? join(BIN, "psql") : "psql";

const DIR = mkdtempSync(join(tmpdir(), "rr-contacts-sync-pg-"));
const SOCKET = DIR;
const PORT = String(55000 + Math.floor(Math.random() * 5000));

function run(bin, args) {
  const r = spawnSync(bin, args, { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`${bin} ${args.join(" ")} failed\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}
function psql(sql, { allowError = false } = {}) {
  const r = spawnSync(PSQL, ["-h", SOCKET, "-p", PORT, "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-At", "-q"], {
    input: sql,
    encoding: "utf8",
  });
  if (r.status !== 0 && !allowError) throw new Error(`psql failed\n${r.stdout}\n${r.stderr}`);
  return { ok: r.status === 0, out: r.stdout.trim(), err: r.stderr };
}

const ORIGINAL = readFileSync(new URL("../supabase/migrations/20261116160000_driver_contacts.sql", import.meta.url), "utf8");
const FIX = readFileSync(new URL("../supabase/migrations/20261117173000_fix_driver_contacts_sync_ambiguous_kind.sql", import.meta.url), "utf8");

const STUBS = `
CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
CREATE SCHEMA auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);
CREATE SCHEMA extensions;
CREATE FUNCTION extensions.gen_random_uuid() RETURNS uuid LANGUAGE sql AS 'select pg_catalog.gen_random_uuid()';
CREATE SCHEMA private;
CREATE FUNCTION private.is_staff() RETURNS boolean LANGUAGE sql AS 'select true';
CREATE TABLE public.applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name text, email text, phone text, address text, city text, state text, zip text,
  status text NOT NULL DEFAULT 'new',
  sms_consent boolean, sms_consent_at timestamptz, sms_consent_phone text, sms_opt_out_at timestamptz,
  deleted_at timestamptz, updated_at timestamptz DEFAULT now()
);
`;

let failed = null;
try {
  run(join(BIN, "initdb"), ["-D", join(DIR, "data"), "-U", "postgres", "-A", "trust"]);
  run(join(BIN, "pg_ctl"), ["-D", join(DIR, "data"), "-l", join(DIR, "pg.log"), "-o", `-k ${SOCKET} -p ${PORT} -c listen_addresses=''`, "-w", "start"]);
  psql(STUBS);
  psql(ORIGINAL);

  // Reproduce the production failure with the original trigger.
  const before = psql(
    "INSERT INTO public.applications (full_name, email, phone, city, state) VALUES ('Victoria R', 'v@example.com', '+18135550100', 'Tampa', 'FL');",
    { allowError: true },
  );
  assert.equal(before.ok, false, "original trigger should fail");
  assert.match(before.err, /column reference "kind" is ambiguous/);
  console.log("PASS reproduces 42702 \"kind\" is ambiguous with the 20261116160000 trigger");

  psql(FIX);

  // New application (website form / waitlist promotion path).
  const id = psql(
    "INSERT INTO public.applications (full_name, email, phone, city, state) VALUES ('Victoria R', 'V@Example.com', '(813) 555-0100', 'Tampa', 'FL') RETURNING id;",
  ).out.split("\n")[0];
  assert.match(id, /^[0-9a-f-]{36}$/);
  const contacts = psql(`SELECT kind || '=' || value || ':' || is_primary::int FROM public.driver_contacts WHERE application_id = '${id}' ORDER BY kind;`).out;
  assert.equal(contacts, "email=v@example.com:1\nphone=+18135550100:1");
  console.log("PASS insert creates one primary phone and one primary email");

  // Staff phone edit replaces the primary value in place.
  psql(`UPDATE public.applications SET phone = '813-555-0199' WHERE id = '${id}';`);
  const afterEdit = psql(`SELECT value || ':' || is_primary::int FROM public.driver_contacts WHERE application_id = '${id}' AND kind = 'phone' ORDER BY value;`).out;
  assert.equal(afterEdit, "+18135550199:1");
  console.log("PASS phone edit updates the primary contact");

  // Switching applications.phone to an existing extra promotes it and keeps the old number.
  psql(`INSERT INTO public.driver_contacts (application_id, kind, value) VALUES ('${id}', 'phone', '8135550142');`);
  psql(`UPDATE public.applications SET phone = '+18135550142' WHERE id = '${id}';`);
  const flip = psql(`SELECT (SELECT phone FROM public.applications WHERE id = '${id}') || '|' || string_agg(value || ':' || is_primary::int, ',' ORDER BY value) FROM public.driver_contacts WHERE application_id = '${id}' AND kind = 'phone';`).out;
  assert.equal(flip, "+18135550142|+18135550142:1,+18135550199:0");
  console.log("PASS switching to an existing extra phone promotes it and demotes the old one");

  // Applications without phone/email still insert.
  psql("INSERT INTO public.applications (full_name) VALUES ('No contact');");
  console.log("PASS insert with no phone/email");
} catch (e) {
  failed = e;
} finally {
  spawnSync(join(BIN, "pg_ctl"), ["-D", join(DIR, "data"), "-m", "immediate", "-w", "stop"], { encoding: "utf8" });
  rmSync(DIR, { recursive: true, force: true });
}
if (failed) throw failed;
