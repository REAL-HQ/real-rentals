/**
 * The M3 checklist refuses a second command before it connects.
 * The scratch database is local and is dropped at the end.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { assertReadQuery } from "./select-only.mjs";
import {
  ABSENT_STEP,
  assertNoStandardStringsOverride,
  assertPreflightTarget,
  assertSelectOnly,
  checklistStops,
  connectionHost,
  defaultConnect,
  formatChecklist,
  guardStops,
  isLoopbackHost,
  loadPreflight,
  runChecklist,
  stepForCheck,
} from "./m3-hosted-preflight.ts";

const root = new URL("..", import.meta.url);
const read = (file: string) => readFileSync(new URL(file, root), "utf8");

let connected = false;
const connect = async () => {
  connected = true;
  return [];
};

const bypasses = [
  "SELECT 1 AS a$$, pg_sleep(2) AS b$$",
  "SELECT 1 AS a$$, current_setting('app.jwt_secret') AS b$$",
  "SELECT 1 AS a$t$, pg_sleep(2) AS b$t$",
  "SELECT 1 AS a$t$, current_setting('app.jwt_secret') AS b$t$",
  "SELECT to_jsonb(d) FROM public.app_secrets \"d\" WHERE EXISTS (SELECT 1 FROM public.documents d)",
  "SELECT to_jsonb(d) FROM public.app_secrets AS \"d\" WHERE EXISTS (SELECT 1 FROM public.documents d)",
  "SELECT setconfig FROM pg_catalog.pg_db_role_setting",
  "SELECT * FROM pg_catalog.pg_settings",
  "SELECT query FROM pg_catalog.pg_stat_activity",
  "SELECT rolpassword FROM pg_catalog.pg_authid",
  "SELECT rolpassword FROM pg_catalog.pg_roles",
  "SELECT * FROM pg_catalog.pg_roles",
];
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
  "SELECT pg_sleep/**/(1)",
  "SELECT pg_catalog.pg_sleep/**/(1)",
  "SELECT pg_advisory_lock/**/(99)",
  "SELECT set_config/**/('x','y',false)",
  "SELECT dblink_exec/**/('x','y')",
  "SELECT pg_sleep--\n(1)",
  "SELECT pg_sleep\n/**/(1)",
  "SELECT pg_sleep\n--x\n(1)",
  "SELECT pg_sleep/* outer /* inner */ still */(1)",
  "SELECT \"pg_sleep\"/**/(1)",
  "SELECT \"pg_catalog\".\"pg_sleep\"/**/(1)",
  "SELECT (pg_sleep)(1)",
  "SELECT (pg_sleep/**/)(1)",
  "SELECT pg_catalog/**/.pg_sleep/**/(1)",
  "SELECT current_setting/**/('data_directory')",
  "SELECT current_setting('server_version'/**/'x')",
  "SELECT current_setting($$server_version$$)",
  "SELECT to_jsonb(d) FROM public.documents AS d",
  ...bypasses,
];

for (const sql of attacks) {
  let refused = false;
  connected = false;
  try {
    await runChecklist({
      url: "postgresql://postgres@127.0.0.1:1/nope?sslmode=disable",
      hosted: false,
      statements: [sql],
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
assertSelectOnly("SELECT count/**/(*)");
assertSelectOnly("SELECT current_setting/**/('server_version')");
assertSelectOnly("SELECT current_setting(E'server_version')");
assertSelectOnly("SELECT current_setting(\n-- name\n 'standard_conforming_strings' )");
assertSelectOnly("SELECT rolname FROM pg_catalog.pg_roles WHERE rolname = 'anon'");
assertSelectOnly("SELECT pg_catalog.has_column_privilege/**/('anon', 'public.waitlist', 'email', 'INSERT')");
assertSelectOnly(loadPreflight());
assertReadQuery(read("proposed/m3-verify/01-tnc-approval-expiry.sql"));
assertReadQuery(read("proposed/m3-verify/02-waitlist-coming-soon-rate.sql"));
for (const sql of [
  "postgresql://postgres@127.0.0.1:55442/m3_rehearsal?standard_conforming_strings=off",
  "postgresql://postgres@127.0.0.1:55442/m3_rehearsal?options=-cstandard_conforming_strings%3Doff",
]) {
  let refused = false;
  try {
    assertNoStandardStringsOverride(sql);
  } catch (error) {
    refused = error instanceof Error && error.message.includes("standard_conforming_strings");
  }
  if (!refused) throw new Error(`URL was accepted: ${sql}`);
}
if (!guardStops({ is_super: true, standard_strings: "on", dblink: false, postgres_fdw: false }).some((row) => row.actual.includes("run as least-privilege read-only role"))) {
  throw new Error("superuser stop omitted the least-privilege message");
}
if (guardStops({ is_super: false, standard_strings: "on", dblink: true, postgres_fdw: true }).length !== 2) {
  throw new Error("extension stops were not both reported");
}

const preflight = loadPreflight();
const named = [...preflight.matchAll(/SELECT\s+\d+,\s+'([^']+)',\s+'([^']+)'/g)];
if (named.length !== 16) throw new Error(`preflight named ${named.length} checks`);
for (const [, name, expected] of named) stepForCheck(name, expected);
for (const name of ABSENT_STEP.keys()) {
  if (!named.some((match) => match[1] === name)) throw new Error(`absent check is not in the preflight: ${name}`);
}
let unmapped = false;
try {
  stepForCheck("public.not_in_the_packet", "absent");
} catch (error) {
  unmapped = error instanceof Error && error.message.includes("not mapped");
}
if (!unmapped) throw new Error("an absent check with no install step was accepted");

let hostedRefused = false;
try {
  assertPreflightTarget("postgresql://postgres@db.example:5432/postgres", false);
} catch (error) {
  hostedRefused = error instanceof Error && error.message.includes("--hosted");
}
if (!hostedRefused) throw new Error("a non-loopback host was accepted without --hosted");
assertPreflightTarget("postgresql://postgres@127.0.0.1:55442/m3_rehearsal?sslmode=disable", false);

const text = formatChecklist([
  { step: 0, check_name: "server_version", expected: "report", actual: "16", ok: true },
  { step: 1, check_name: "public.applications.tnc_uber_approval_expires_on", expected: "absent", actual: "date", ok: false },
]);
if (checklistStops(text) !== 1 || !text.includes("STOP step 1 public.applications.tnc_uber_approval_expires_on")) {
  throw new Error(`checklist did not stop: ${text}`);
}
if (!text.includes("PASS step 2 no separate object")) throw new Error("an empty step was omitted");

if (!isLoopbackHost("postgresql://postgres@[::1]:55442/m3_rehearsal?sslmode=disable")) {
  throw new Error("[::1] was not treated as loopback");
}
if (connectionHost("postgresql://postgres@[::1]:55442/m3_rehearsal?sslmode=disable") !== "[::1]:55442") {
  throw new Error(`ipv6 host display is ${connectionHost("postgresql://postgres@[::1]:55442/m3_rehearsal?sslmode=disable")}`);
}

async function dropScratchDatabase(admin: postgres.Sql, name: string, marker: string) {
  if (!/^[a-z][a-z0-9_]*$/.test(name) || !/^m3-preflight-test:[0-9a-f-]{36}$/.test(marker)) {
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
const scratchName = `m3pf${randomBytes(8).toString("hex")}`;
const marker = `m3-preflight-test:${randomUUID()}`;
const scratchUrl = `postgresql://postgres@127.0.0.1:55442/${scratchName}?sslmode=disable`;
const role = `m3pfr${randomBytes(6).toString("hex")}`;
const readerUrl = `postgresql://${role}:readerpass@127.0.0.1:55442/${scratchName}?sslmode=disable`;
const admin = postgres(local, { max: 1 });
let scratchCreated = false;
try {
  let kept = false;
  try {
    await dropScratchDatabase(admin, "m2", "m3-preflight-test:00000000-0000-0000-0000-000000000000");
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
      CREATE TABLE public.victim (id int);
      INSERT INTO public.victim VALUES (1);
      CREATE ROLE ${role} LOGIN PASSWORD 'readerpass' NOSUPERUSER NOCREATEDB NOCREATEROLE;
      GRANT CONNECT ON DATABASE ${scratchName} TO ${role};
      GRANT USAGE ON SCHEMA public TO ${role};
      GRANT SELECT ON public.victim TO ${role};
    `);
  } finally {
    await scratch.end();
  }

  const blocked = await runChecklist({
    url: scratchUrl,
    hosted: false,
    statements: ["SELECT count(*)"],
    mapped: new Map(),
  });
  if (!blocked.includes("run as least-privilege read-only role")) throw new Error(`superuser connection was not stopped: ${blocked}`);

  for (const sql of attacks.slice(0, 4)) {
    let failed = false;
    try {
      await defaultConnect(readerUrl, [sql]);
    } catch {
      failed = true;
    }
    if (!failed) throw new Error(`multi-command was executed: ${sql}`);
  }
  if (!attacks[31].includes("pg_sleep/**/") || !attacks[44].includes("pg_catalog/**/.pg_sleep")) {
    throw new Error("comment-call fixtures moved");
  }
  for (const sql of attacks.slice(31, 45)) {
    let refused = false;
    try {
      await defaultConnect(readerUrl, [sql]);
    } catch (error) {
      refused = error instanceof Error && error.message.startsWith("Refusing to run:");
    }
    if (!refused) throw new Error(`comment call reached the reader: ${sql}`);
  }
  for (const sql of bypasses) {
    let refused = false;
    try {
      await defaultConnect(readerUrl, [sql]);
    } catch (error) {
      refused = error instanceof Error && error.message.startsWith("Refusing to run:");
    }
    if (!refused) throw new Error(`bypass reached the reader: ${sql}`);
  }
  const allowedRead = await defaultConnect(readerUrl, ["SELECT current_setting('server_version') AS version"]);
  if (!allowedRead.some((row) => String(row.version || "").length > 0)) {
    throw new Error("allowed current_setting did not run");
  }
  const escapeRead = await defaultConnect(readerUrl, ["SELECT current_setting(E'server_version') AS version"]);
  if (!escapeRead.some((row) => String(row.version || "").length > 0)) {
    throw new Error("E'' current_setting did not run");
  }
  const check = postgres(scratchUrl, { max: 1 });
  try {
    const [victim] = await check`SELECT count(*)::int AS n FROM public.victim`;
    const [pwned] = await check`SELECT to_regclass('public.pwned') AS name`;
    if (victim.n !== 1 || pwned.name) throw new Error(`scratch database was written: victim=${victim.n} pwned=${pwned.name}`);
    await check.unsafe(`ALTER DATABASE ${scratchName} SET standard_conforming_strings = off`);
    const stringsOff = await runChecklist({
      url: readerUrl,
      hosted: false,
      statements: ["SELECT count(*)"],
      mapped: new Map(),
    });
    if (!stringsOff.includes("STOP step 0 standard_conforming_strings expected=on")) {
      throw new Error(`standard_conforming_strings=off was accepted: ${stringsOff}`);
    }
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
  if (/^m3pfr[0-9a-f]{12}$/.test(role)) await admin.unsafe(`DROP ROLE IF EXISTS ${role}`);
  await admin.end();
}

console.log("m3 hosted preflight guard pass");
