/**
 * The hosted preflight refuses non-SELECT SQL before it connects, and every
 * absent object in proposed/m2-preflight.sql maps to the install step that
 * creates it.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import {
  EXTRA_SQL,
  assertNoStandardStringsOverride,
  assertPreflightTarget,
  assertSelectOnly,
  checklistStops,
  connectionHost,
  defaultConnect,
  formatChecklist,
  guardStops,
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
  "SELECT pg_advisory_xact_lock(1)",
  "SELECT pg_advisory_lock_shared(1)",
  "SELECT pg_try_advisory_lock(1)",
  "SELECT pg_terminate_backend(1)",
  "SELECT pg_cancel_backend(1)",
  "SELECT pg_notify('c', 'm')",
  "SELECT pg_reload_conf()",
  "SELECT pg_read_file('/etc/passwd')",
  "SELECT pg_read_binary_file('/etc/passwd')",
  "SELECT pg_ls_dir('/')",
  "SELECT pg_sleep(1)",
  "SELECT pg_logical_emit_message(true, 'a', 'b')",
  "SELECT pg_stat_reset()",
  "SELECT pg_switch_wal()",
  "SELECT pg_create_restore_point('x')",
  "SELECT txid_current()",
  "SELECT dblink('host=127.0.0.1 dbname=postgres', 'SELECT 1')",
  "SELECT dblink_exec('host=127.0.0.1 dbname=postgres', 'DELETE FROM public.victim')",
  "SELECT pg_catalog.set_config('a', 'b', false)",
  "SELECT \"pg_read_file\"('/etc/passwd')",
  "SELECT U&\"pg\\005fread\\005ffile\"('/etc/passwd')",
  "SELECT U&\"pg\\005freload\\005fconf\"()",
  "SELECT U&\"pg\\005fterminate\\005fbackend\"(1)",
  "SELECT U&\"pg\\005fnotify\"('c', 'm')",
  "SELECT U&'text'",
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
assertSelectOnly("SELECT count(*)");
assertSelectOnly(EXTRA_SQL);
for (const sql of [
  "postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable&standard_conforming_strings=off",
  "postgresql://postgres@127.0.0.1:55442/m2?sslmode=disable&standard_conforming_strings=on",
  "postgresql://postgres@127.0.0.1:55442/m2?options=-cstandard_conforming_strings%3Doff",
  "postgresql://postgres@127.0.0.1:55442/m2?options=-c%20standard_conforming_strings%3Don",
]) {
  let refused = false;
  try {
    assertNoStandardStringsOverride(sql);
  } catch (error) {
    refused = error instanceof Error && error.message.includes("standard_conforming_strings");
  }
  if (!refused) throw new Error(`URL was accepted: ${sql}`);
}
const superStop = guardStops({ is_super: true, standard_strings: "on", dblink: false, postgres_fdw: false });
if (!superStop.some((row) => row.actual.includes("run as least-privilege read-only role"))) {
  throw new Error("superuser stop omitted the least-privilege message");
}
const extensionStop = guardStops({ is_super: false, standard_strings: "on", dblink: true, postgres_fdw: true });
if (extensionStop.length !== 2) throw new Error("extension stops were not both reported");
if (guardStops({ is_super: false, standard_strings: "off", dblink: false, postgres_fdw: false })[0]?.check_name !== "standard_conforming_strings") {
  throw new Error("standard_conforming_strings stop was omitted");
}
if (!isLoopbackHost("postgresql://postgres@[::1]:55442/m2?sslmode=disable")) {
  throw new Error("[::1] was not treated as loopback");
}
if (connectionHost("postgresql://postgres@[::1]:55442/m2?sslmode=disable") !== "[::1]:55442") {
  throw new Error(`ipv6 host display is ${connectionHost("postgresql://postgres@[::1]:55442/m2?sslmode=disable")}`);
}

async function dropScratchDatabase(admin: postgres.Sql, name: string, marker: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || !/^m2-preflight-test:[0-9a-f-]{36}$/.test(marker)) {
    throw new Error(`Refusing to drop database ${name}: name is not a scratch identifier`);
  }
  const found = await admin`
    SELECT pg_catalog.shobj_description(d.oid, 'pg_database') AS marker
    FROM pg_catalog.pg_database d
    WHERE d.datname = ${name}
  `;
  if (found.length === 0) return;
  if (found[0].marker !== marker) {
    throw new Error(`Refusing to drop database ${name}: it was not created by this test run`);
  }
  await admin`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = ${name} AND pid <> pg_backend_pid()
  `;
  await admin.unsafe(`DROP DATABASE ${name}`);
}

const local = "postgresql://postgres@127.0.0.1:55442/postgres?sslmode=disable";
const scratchName = `m2pf${randomBytes(8).toString("hex")}`;
const marker = `m2-preflight-test:${randomUUID()}`;
const scratchUrl = `postgresql://postgres@127.0.0.1:55442/${scratchName}?sslmode=disable`;
const role = `m2pfr${randomBytes(6).toString("hex")}`;
const readerUrl = `postgresql://${role}:readerpass@127.0.0.1:55442/${scratchName}?sslmode=disable`;
const admin = postgres(local, { max: 1 });
let scratchCreated = false;
let roleCreated = false;
try {
  let kept = false;
  try {
    await dropScratchDatabase(admin, "m2", "m2-preflight-test:00000000-0000-0000-0000-000000000000");
  } catch (error) {
    kept = error instanceof Error && error.message.includes("was not created by this test run");
  }
  const [still] = await admin`SELECT count(*)::int AS n FROM pg_catalog.pg_database WHERE datname = 'm2'`;
  if (!kept || still.n !== 1) throw new Error("the drop guard was willing to remove m2");

  await admin.unsafe(`CREATE DATABASE ${scratchName}`);
  scratchCreated = true;
  await admin.unsafe(`COMMENT ON DATABASE ${scratchName} IS '${marker}'`);
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
      CREATE ROLE ${role} LOGIN PASSWORD 'readerpass' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT;
      GRANT CONNECT ON DATABASE ${scratchName} TO ${role};
      GRANT USAGE ON SCHEMA public, storage TO ${role};
      GRANT SELECT ON ALL TABLES IN SCHEMA public TO ${role};
      GRANT SELECT ON ALL TABLES IN SCHEMA storage TO ${role};
    `);
    roleCreated = true;
  } finally {
    await scratch.end();
  }

  const blocked = await runChecklist({
    url: scratchUrl,
    hosted: false,
    statements: ["SELECT count(*) FROM public.missing_table"],
    mapped: new Map(),
  });
  if (!blocked.includes("run as least-privilege read-only role")) {
    throw new Error(`superuser connection was not stopped: ${blocked}`);
  }
  if (blocked.includes("missing_table")) throw new Error("superuser stop still ran the checklist SQL");

  for (const sql of attacks.slice(0, 4)) {
    let failed = false;
    try {
      await defaultConnect(readerUrl, [sql]);
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
      url: readerUrl,
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

    await check.unsafe(`ALTER DATABASE ${scratchName} SET standard_conforming_strings = off`);
    const stringsOff = await runChecklist({
      url: readerUrl,
      hosted: false,
      statements: ["SELECT count(*) FROM public.missing_table"],
      mapped: new Map(),
    });
    if (!stringsOff.includes("STOP step 0 standard_conforming_strings expected=on")) {
      throw new Error(`standard_conforming_strings=off was accepted: ${stringsOff}`);
    }
    if (stringsOff.includes("missing_table")) throw new Error("string-setting stop still ran the checklist SQL");
    await check.unsafe(`ALTER DATABASE ${scratchName} RESET standard_conforming_strings`);

    for (const extension of ["dblink", "postgres_fdw"]) {
      await check.unsafe(`CREATE EXTENSION ${extension}`);
      const stopped = await runChecklist({
        url: readerUrl,
        hosted: false,
        statements: ["SELECT count(*)"],
        mapped: new Map(),
      });
      if (!stopped.includes(`STOP step 0 extension ${extension} expected=not installed`)) {
        throw new Error(`${extension} did not stop the checklist: ${stopped}`);
      }
      await check.unsafe(`DROP EXTENSION ${extension}`);
    }
  } finally {
    await check.end();
  }
} finally {
  if (scratchCreated) await dropScratchDatabase(admin, scratchName, marker);
  if (roleCreated) await admin.unsafe(`DROP ROLE ${role}`);
  await admin.end();
}

console.log("hosted preflight guard pass");
