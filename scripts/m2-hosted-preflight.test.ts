/**
 * The hosted preflight refuses non-SELECT SQL before it connects, and every
 * absent object in proposed/m2-preflight.sql maps to the install step that
 * creates it.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
  EXTRA_SQL,
  assertPreflightTarget,
  assertSelectOnly,
  checklistStops,
  connectionHost,
  defaultConnect,
  formatChecklist,
  hostedInstallSteps,
  isLoopbackHost,
  loadChecklistInputs,
  mapPreflightSteps,
  runChecklist,
  stepForCheck,
} from "./m2-hosted-preflight";

const root = new URL("..", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

for (const sql of [
  "INSERT INTO public.applications DEFAULT VALUES",
  "UPDATE public.applications SET status = 'approved'",
  "DELETE FROM public.applications",
  "DROP TABLE public.applications",
  "CREATE TABLE public.kept (id int)",
  "SELECT 1; DROP TABLE public.applications",
  "WITH w AS (INSERT INTO public.applications DEFAULT VALUES RETURNING id) SELECT id FROM w",
]) {
  let refused = false;
  try {
    assertSelectOnly(sql);
  } catch (error) {
    refused = error instanceof Error && error.message.startsWith("Refusing to run:");
  }
  if (!refused) throw new Error(`non-SELECT was accepted: ${sql}`);
}

const loaded = loadChecklistInputs(read);
if (!loaded.mapped.get("public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)")) {
  throw new Error("content-sha function was not mapped");
}
const expectStep = (name: string, step: number) => {
  const actual = loaded.mapped.get(name);
  if (actual !== step) throw new Error(`${name} mapped to ${actual}, expected step ${step}`);
};
expectStep("public.record_uploaded_content_sha(text,text,text,uuid,text,timestamptz)", 2);
expectStep("private.approval_validate(uuid)", 3);
expectStep("role rr_record_executor", 5);
expectStep("private.record_customer_number_seq", 5);
expectStep("trigger private.record_customers.record_immutable", 5);
expectStep("public.documents.integrity_v1", 8);
expectStep("private.storage_integrity_v1()", 21);
expectStep("private.swap_number_seq", 26);
expectStep("public.extend_rental_tx(uuid, uuid, date, date, text, uuid)", 27);
expectStep("public.return_checklists", 28);
expectStep("public.link_replacement_agreement_checked(uuid, uuid)", 24);

const steps = hostedInstallSteps(read("proposed/HOSTED-INSTALL.md"));
const created = steps.map((step) => ({ step: step.step, objects: { functions: new Set<string>(), relations: new Set<string>(), roles: new Set<string>(), policies: [], triggers: [], columns: new Set<string>(), indexes: new Set<string>() } }));
if (stepForCheck("storage.objects", created) !== 0) throw new Error("a prerequisite was given an install step");
mapPreflightSteps(read("proposed/m2-preflight.sql"), steps, read);

let connected = false;
const connect = async () => {
  connected = true;
  return [];
};
let dropRefused = false;
try {
  await runChecklist({
    url: "postgresql://postgres@127.0.0.1:1/nope?sslmode=disable",
    hosted: false,
    statements: ["DROP TABLE public.applications"],
    mapped: new Map(),
    connect,
  });
} catch (error) {
  dropRefused = error instanceof Error && error.message.startsWith("Refusing to run:");
}
if (!dropRefused || connected) throw new Error("DROP opened a connection or was not refused");

let hostedRefused = false;
try {
  assertPreflightTarget("postgresql://postgres@db.example:5432/postgres", false);
} catch (error) {
  hostedRefused = error instanceof Error && error.message.includes("--hosted");
}
if (!hostedRefused) throw new Error("a non-loopback host was accepted without --hosted");
assertPreflightTarget("postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable", false);

const text = formatChecklist([
  { step: 0, check_name: "supabase/migrations prerequisite public.documents.content_sha256", expected: "present", actual: "absent", ok: false },
  { step: 0, check_name: "server_version", expected: "report", actual: "16", ok: true },
]);
if (checklistStops(text) !== 1 || !text.includes("STOP step 0 supabase/migrations prerequisite public.documents.content_sha256")) {
  throw new Error(`checklist did not stop: ${text}`);
}
if (!text.includes("PASS step 9 no separate object")) throw new Error("a replace-only step was omitted");

const attacks = [
  "SELECT '--'; COMMIT; DELETE FROM public.victim; SELECT 1",
  "SELECT $a$'$a$; COMMIT; DELETE FROM public.victim; SELECT 'x'",
  "SELECT E'\\'''; COMMIT; DELETE FROM public.victim; SELECT ''",
  "SELECT '/*'; COMMIT; CREATE TABLE public.pwned(); SELECT '*/'",
  "SELECT set_config('work_mem', '1MB', false)",
  "SELECT pg_advisory_lock(1)",
  "SELECT pg_terminate_backend(1)",
  "SELECT pg_notify('c', 'm')",
  "SELECT pg_reload_conf()",
  "SELECT pg_read_file('/etc/passwd')",
  "SELECT pg_catalog.set_config('a', 'b', false)",
  "SELECT \"pg_read_file\"('/etc/passwd')",
];
for (const sql of attacks) {
  let refused = false;
  connected = false;
  try {
    await runChecklist({
      url: "postgresql://postgres@127.0.0.1:1/nope?sslmode=disable",
      hosted: false,
      statements: [sql],
      mapped: new Map(),
      connect,
    });
  } catch (error) {
    refused = error instanceof Error && error.message.startsWith("Refusing to run:");
  }
  if (!refused || connected) throw new Error(`attack was not refused before connect: ${sql}`);
}
assertSelectOnly("SELECT 'set_config'");
assertSelectOnly("SELECT 'public CREATE holders'");
if (!isLoopbackHost("postgresql://postgres@[::1]:55442/m2?sslmode=disable")) {
  throw new Error("[::1] was not treated as loopback");
}
if (connectionHost("postgresql://postgres@[::1]:55442/m2?sslmode=disable") !== "[::1]:55442") {
  throw new Error(`ipv6 host display is ${connectionHost("postgresql://postgres@[::1]:55442/m2?sslmode=disable")}`);
}

const local = "postgresql://postgres@127.0.0.1:55442/postgres?sslmode=disable";
const scratchName = "m2_preflight_scratch";
const scratchUrl = `postgresql://postgres@127.0.0.1:55442/${scratchName}?sslmode=disable`;
const admin = postgres(local, { max: 1 });
try {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${scratchName}`);
  await admin.unsafe(`CREATE DATABASE ${scratchName}`);
  const scratch = postgres(scratchUrl, { max: 1 });
  try {
    await scratch.unsafe(`
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects (id int);
      CREATE TABLE public.documents (id int, is_current boolean, category text);
      INSERT INTO public.documents VALUES (1, true, 'license_front');
      CREATE TABLE public.applications (id int, status text);
      CREATE TABLE public.victim (id int);
      INSERT INTO public.victim VALUES (1);
    `);
  } finally {
    await scratch.end();
  }

  for (const sql of attacks.slice(0, 4)) {
    let failed = false;
    try {
      await defaultConnect(scratchUrl, [sql]);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error(`multi-command was executed: ${sql}`);
  }
  const check = postgres(scratchUrl, { max: 1 });
  try {
    const [victim] = await check`SELECT count(*)::int AS n FROM public.victim`;
    const [pwned] = await check`SELECT to_regclass('public.pwned') AS name`;
    if (victim.n !== 1 || pwned.name) throw new Error(`scratch database was written: victim=${victim.n} pwned=${pwned.name}`);
    const missing = await runChecklist({
      url: scratchUrl,
      hosted: false,
      statements: [EXTRA_SQL],
      mapped: new Map(),
    });
    if (!missing.includes("STOP step 0 supabase/migrations prerequisite public.documents.content_sha256 expected=present actual=absent")) {
      throw new Error(`missing content_sha256 did not stop: ${missing}`);
    }
    if (!missing.includes("PASS step 2 count current license documents without content_sha256")) {
      throw new Error(`missing column aborted the count: ${missing}`);
    }
  } finally {
    await check.end();
  }
} finally {
  await admin.unsafe(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = '${scratchName}' AND pid <> pg_backend_pid()
  `).catch(() => undefined);
  await admin.unsafe(`DROP DATABASE IF EXISTS ${scratchName}`);
  await admin.end();
}

console.log("hosted preflight guard pass");
