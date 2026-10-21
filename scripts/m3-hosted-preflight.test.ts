/**
 * The M3 checklist refuses a second command before it connects.
 * The scratch database is local and is dropped at the end.
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { assertSelectOnly } from "./select-only.mjs";
import {
  ABSENT_STEP,
  assertPreflightTarget,
  checklistStops,
  connectionHost,
  defaultConnect,
  formatChecklist,
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
      connect,
    });
  } catch (error) {
    refused = error instanceof Error && error.message.startsWith("Refusing to run:");
  }
  if (!refused || connected) throw new Error(`attack was not refused before connect: ${sql}`);
}

assertSelectOnly("SELECT 'set_config'");
assertSelectOnly("SELECT 'public CREATE holders'");
assertSelectOnly(loadPreflight());
assertSelectOnly(read("proposed/m3-verify/01-tnc-approval-expiry.sql"));
assertSelectOnly(read("proposed/m3-verify/02-waitlist-coming-soon-rate.sql"));

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

const local = "postgresql://postgres@127.0.0.1:55442/postgres?sslmode=disable";
const scratchName = "m3_preflight_scratch";
const scratchUrl = `postgresql://postgres@127.0.0.1:55442/${scratchName}?sslmode=disable`;
const admin = postgres(local, { max: 1 });
try {
  await admin.unsafe(`DROP DATABASE IF EXISTS ${scratchName}`);
  await admin.unsafe(`CREATE DATABASE ${scratchName}`);
  const scratch = postgres(scratchUrl, { max: 1 });
  try {
    await scratch.unsafe(`
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

console.log("m3 hosted preflight guard pass");
