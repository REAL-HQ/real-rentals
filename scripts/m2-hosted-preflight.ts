/**
 * Read-only checklist before HOSTED-INSTALL.
 *
 * Loads proposed/m2-preflight.sql. A tokenizer accepts exactly one SELECT
 * or WITH. Comments, standard strings, E'' strings, dollar quotes, and
 * quoted identifiers cannot hide a second command. The statement is sent
 * with the extended protocol. The connection sets
 * default_transaction_read_only=on, and the transaction ends with ROLLBACK.
 *
 * Run it as a least-privilege read-only role. The script stops when the
 * current role is a superuser. The message is: run as least-privilege
 * read-only role. This file does not create that role.
 *
 * Function calls are an allowlist of the functions the shipped checklist
 * uses: exists, to_regprocedure, to_regclass, coalesce, string_agg,
 * pg_catalog.aclexplode, pg_catalog.acldefault, count, current_setting,
 * and to_jsonb. Comments and newlines between a name and '(' still count
 * as a call, including a quoted or parenthesized name. current_setting
 * may read only server_version, transaction_read_only,
 * default_transaction_read_only, and standard_conforming_strings.
 * to_jsonb may read only the public.documents alias d. Any other call
 * is refused before connect. A U& identifier or string is refused. The
 * URL is refused when it sets standard_conforming_strings, including
 * through options. After connect the script stops when that setting is
 * not on, and when dblink or postgres_fdw is installed, because those
 * extensions can write from a read-only transaction.
 *
 * PGUSER, PGPASSWORD, PGHOST, PGPORT, and PGDATABASE fill in parts the URL
 * leaves out. The script prints the host and port only. It does not read
 * SUPABASE_URL. There is no default connection. A host other than loopback
 * (127.0.0.1, localhost, ::1) also needs --hosted.
 *
 *   bun scripts/m2-hosted-preflight.ts --url postgresql://read_only_role@127.0.0.1:55442/m2?sslmode=disable
 *   bun scripts/m2-hosted-preflight.ts --url '<hosted connection>' --hosted
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { ALLOWED_CALLS, assertSelectOnly as guardSelect, PREFLIGHT_POLICY } from "./select-only.mjs";

export { ALLOWED_CALLS };

export function assertSelectOnly(sql: string): void {
  guardSelect(sql, PREFLIGHT_POLICY);
}

class ReadOnlyDone extends Error {}

const ROOT = new URL("..", import.meta.url);

export type ChecklistRow = {
  step: number;
  check_name: string;
  expected: string;
  actual: string;
  ok: boolean;
};

type InstallStep = { step: number; file: string };

export const EXTRA_SQL = `
SELECT 0 AS step, 'server_version' AS check_name, 'report' AS expected, current_setting('server_version') AS actual, true AS ok
UNION ALL
SELECT 0, 'role anon', 'present',
  CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon') THEN 'present' ELSE 'absent' END,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'anon')
UNION ALL
SELECT 0, 'role authenticated', 'present',
  CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated') THEN 'present' ELSE 'absent' END,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'authenticated')
UNION ALL
SELECT 0, 'role service_role', 'present',
  CASE WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role') THEN 'present' ELSE 'absent' END,
  EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'service_role')
UNION ALL
SELECT 0, 'count storage.objects', 'report',
  (SELECT count(*)::text FROM storage.objects),
  true
UNION ALL
SELECT 0, 'supabase/migrations prerequisite public.documents.content_sha256', 'present',
  CASE WHEN EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'content_sha256'
  ) THEN 'present' ELSE 'absent' END,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'documents' AND column_name = 'content_sha256'
  )
UNION ALL
SELECT 2, 'count current license documents', 'report',
  (SELECT count(*)::text FROM public.documents AS d WHERE d.is_current AND d.category IN ('license_front', 'license_back')),
  true
UNION ALL
SELECT 2, 'count current license documents without content_sha256', 'report',
  (SELECT count(*)::text FROM public.documents AS d
    WHERE d.is_current AND d.category IN ('license_front', 'license_back')
      AND (to_jsonb(d)->>'content_sha256') IS NULL),
  true
UNION ALL
SELECT 2, 'count current license documents with content_sha256', 'report',
  (SELECT count(*)::text FROM public.documents AS d
    WHERE d.is_current AND d.category IN ('license_front', 'license_back')
      AND (to_jsonb(d)->>'content_sha256') IS NOT NULL),
  true
UNION ALL
SELECT 3, 'count applications', 'report',
  (SELECT count(*)::text FROM public.applications),
  true
UNION ALL
SELECT 3, 'count applications active', 'report',
  (SELECT count(*)::text FROM public.applications WHERE status = 'active'),
  true
UNION ALL
SELECT 3, 'count applications suspended', 'report',
  (SELECT count(*)::text FROM public.applications WHERE status = 'suspended'),
  true
`;

export function hostedInstallSteps(markdown: string): InstallStep[] {
  const rows: InstallStep[] = [];
  for (const line of markdown.split("\n")) {
    const match = line.match(/^\| (\d+) \| `([^`]+)` \|/);
    if (match) rows.push({ step: Number(match[1]), file: match[2] });
  }
  if (rows.length !== 29) throw new Error(`HOSTED-INSTALL table has ${rows.length} rows`);
  rows.forEach((row, index) => {
    if (row.step !== index + 1) throw new Error(`HOSTED-INSTALL step ${row.step} is out of order`);
  });
  return rows;
}

function dollarBodies(sql: string): string[] {
  const bodies: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const start = sql.indexOf("$", i);
    if (start < 0) break;
    const match = /^\$([A-Za-z0-9_]*)\$/.exec(sql.slice(start));
    if (!match) {
      i = start + 1;
      continue;
    }
    const tag = match[0];
    const end = sql.indexOf(tag, start + tag.length);
    if (end < 0) break;
    bodies.push(sql.slice(start + tag.length, end));
    i = end + tag.length;
  }
  return bodies;
}

function stripNoise(sql: string): string {
  const noComments = sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
  let out = "";
  let i = 0;
  while (i < noComments.length) {
    const match = /^\$([A-Za-z0-9_]*)\$/.exec(noComments.slice(i));
    if (match) {
      const tag = match[0];
      const end = noComments.indexOf(tag, i + tag.length);
      if (end < 0) break;
      out += " ";
      i = end + tag.length;
      continue;
    }
    out += noComments[i];
    i += 1;
  }
  return out.replace(/'(?:''|[^'])*'/g, " ");
}

type Created = {
  functions: Set<string>;
  relations: Set<string>;
  roles: Set<string>;
  policies: string[];
  triggers: string[];
  columns: Set<string>;
  indexes: Set<string>;
};

function createdIn(sql: string): Created {
  const text = stripNoise(sql);
  const grab = (re: RegExp) => [...text.matchAll(re)].map((match) => match[1].toLowerCase());
  const triggers = [...text.matchAll(/\bcreate\s+trigger\s+([a-zA-Z_][\w]*)\b[^;]*?\bon\s+([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/gi)]
    .map((match) => `${match[2].toLowerCase()}\t${match[1].toLowerCase()}`);
  for (const body of dollarBodies(sql.replace(/--[^\n]*/g, " "))) {
    const dynamic = /create\s+trigger\s+([a-zA-Z_][\w]*)[\s\S]*?\bon\s+%/i.exec(body);
    if (!dynamic) continue;
    const name = dynamic[1].toLowerCase();
    for (const table of body.match(/'([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)'/g) ?? []) {
      triggers.push(`${table.slice(1, -1).toLowerCase()}\t${name}`);
    }
  }
  return {
    functions: new Set(grab(/\bcreate\s+(?:or\s+replace\s+)?function\s+([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/gi)),
    relations: new Set([
      ...grab(/\bcreate\s+table\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/gi),
      ...grab(/\bcreate\s+(?:or\s+replace\s+)?view\s+([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/gi),
      ...grab(/\bcreate\s+sequence\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/gi),
    ]),
    roles: new Set(grab(/\bcreate\s+role\s+([a-zA-Z_][\w]*)/gi)),
    policies: [...text.matchAll(/\bcreate\s+policy\s+("(?:[^"]|"")*"|[a-zA-Z_][\w]*)\s+on\s+([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)/gi)]
      .map((match) => `${match[2].toLowerCase()}\t${match[1].replace(/^"|"$/g, "").replace(/""/g, '"')}`),
    triggers,
    columns: new Set([...text.matchAll(/\balter\s+table\s+(?:only\s+)?([a-zA-Z_][\w]*\.[a-zA-Z_][\w]*)\s+add\s+column\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w]*)/gi)]
      .map((match) => `${match[1].toLowerCase()}.${match[2].toLowerCase()}`)),
    indexes: new Set([...text.matchAll(/\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-zA-Z_][\w]*)\s+on\s+([a-zA-Z_][\w]*)\./gi)]
      .map((match) => `index ${match[2].toLowerCase()}.${match[1].toLowerCase()}`)),
  };
}

export function stepForCheck(name: string, created: { step: number; objects: Created }[]): number {
  const hits: number[] = [];
  for (const item of created) {
    const objects = item.objects;
    if (name.startsWith("role ") && objects.roles.has(name.slice(5))) hits.push(item.step);
    if (name.startsWith("policy ")) {
      for (const key of objects.policies) {
        const [table, policy] = key.split("\t");
        if (name === `policy ${table}.${policy}`) hits.push(item.step);
      }
    }
    if (name.startsWith("trigger ")) {
      for (const key of objects.triggers) {
        const [table, trigger] = key.split("\t");
        if (name === `trigger ${table}.${trigger}`) hits.push(item.step);
      }
    }
    if (name.startsWith("index ") && objects.indexes.has(name)) hits.push(item.step);
    if (name.includes("(") && objects.functions.has(name.slice(0, name.indexOf("(")).toLowerCase())) hits.push(item.step);
    if (objects.relations.has(name.toLowerCase())) hits.push(item.step);
    if (objects.columns.has(name.toLowerCase())) hits.push(item.step);
  }
  return hits.length ? Math.min(...hits) : 0;
}

export function preflightCheckNames(sql: string): { name: string; expected: string }[] {
  return [...sql.matchAll(/SELECT '([^']+)' AS check_name, '([^']+)' AS expected/g)].map((match) => ({
    name: match[1],
    expected: match[2],
  }));
}

export function mapPreflightSteps(preflightSql: string, steps: InstallStep[], read: (file: string) => string): Map<string, number> {
  const created = steps.map((step) => ({ step: step.step, objects: createdIn(read(step.file)) }));
  const mapped = new Map<string, number>();
  const unmapped: string[] = [];
  for (const check of preflightCheckNames(preflightSql)) {
    const step = stepForCheck(check.name, created);
    mapped.set(check.name, step);
    if (check.expected === "absent" && step === 0) unmapped.push(check.name);
  }
  if (unmapped.length) {
    throw new Error(`preflight checks are not mapped to an install step: ${unmapped.join(", ")}`);
  }
  return mapped;
}

export function formatChecklist(rows: ChecklistRow[]): string {
  const byStep = new Map<number, ChecklistRow[]>();
  for (const row of rows) {
    const list = byStep.get(row.step) ?? [];
    list.push(row);
    byStep.set(row.step, list);
  }
  const lines: string[] = [];
  let stops = 0;
  let checks = 0;
  for (let step = 0; step <= 29; step += 1) {
    const group = (byStep.get(step) ?? []).slice().sort((a, b) => a.check_name.localeCompare(b.check_name));
    if (group.length === 0) {
      lines.push(`PASS step ${step} no separate object expected=covered by an earlier object actual=covered`);
      checks += 1;
      continue;
    }
    for (const row of group) {
      if (!row.ok) stops += 1;
      checks += 1;
      lines.push(`${row.ok ? "PASS" : "STOP"} step ${row.step} ${row.check_name} expected=${row.expected} actual=${row.actual}`);
    }
  }
  const extra = [...byStep.keys()].filter((step) => step < 0 || step > 29);
  if (extra.length) throw new Error(`checklist step is outside 0..29: ${extra.join(",")}`);
  lines.push(`checklist stops=${stops} checks=${checks}`);
  return lines.join("\n");
}

export function checklistStops(text: string): number {
  const match = text.match(/checklist stops=(\d+)/);
  if (!match) throw new Error("checklist summary is missing");
  return Number(match[1]);
}

export function connectionTarget(url: string): { hostname: string; port: string; display: string } {
  const parsed = new URL(url);
  const fromUrl = parsed.hostname.replace(/^\[|\]$/g, "");
  const hostname = fromUrl || process.env.PGHOST || "";
  const port = parsed.port || (!fromUrl ? process.env.PGPORT || "" : "");
  if (!hostname) throw new Error("connection URL has no host");
  const display = hostname.includes(":") ? `[${hostname}]` : hostname;
  return { hostname, port, display: port ? `${display}:${port}` : display };
}

export function connectionHost(url: string): string {
  return connectionTarget(url).display;
}

export function isLoopbackHost(url: string): boolean {
  const host = connectionTarget(url).hostname.toLowerCase();
  return host === "127.0.0.1" || host === "localhost" || host === "::1" || host === "0:0:0:0:0:0:0:1";
}

export function assertNoStandardStringsOverride(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error("Refusing to run: connection URL is invalid.");
  }
  for (const [key, value] of parsed.searchParams) {
    const name = key.toLowerCase();
    if (name === "standard_conforming_strings" || (name === "options" && /standard_conforming_strings/i.test(value))) {
      throw new Error("Refusing to run: URL sets standard_conforming_strings.");
    }
  }
}

export function assertPreflightTarget(url: string, hosted: boolean): void {
  if (!url || url.startsWith("--")) throw new Error("Pass the database URL after --url. There is no default connection.");
  assertNoStandardStringsOverride(url);
  if (!isLoopbackHost(url) && !hosted) {
    throw new Error("Refusing to run: host is not loopback. Pass --hosted to run the read-only checklist against that host.");
  }
}

const SESSION_PROBE = `
SELECT current_setting('transaction_read_only') AS read_only,
       current_setting('default_transaction_read_only') AS default_read_only,
       current_setting('standard_conforming_strings') AS standard_strings,
       r.rolsuper AS is_super,
       EXISTS (SELECT 1 FROM pg_catalog.pg_extension e WHERE e.extname = 'dblink') AS dblink,
       EXISTS (SELECT 1 FROM pg_catalog.pg_extension e WHERE e.extname = 'postgres_fdw') AS postgres_fdw
FROM pg_catalog.pg_roles r
WHERE r.rolname = current_user
`;

export function guardStops(flag: Record<string, unknown>): ChecklistRow[] {
  const stops: ChecklistRow[] = [];
  if (String(flag.standard_strings) !== "on") {
    stops.push({
      step: 0,
      check_name: "standard_conforming_strings",
      expected: "on",
      actual: String(flag.standard_strings),
      ok: false,
    });
  }
  if (flag.is_super === true || flag.is_super === "t" || flag.is_super === "true") {
    stops.push({
      step: 0,
      check_name: "current role",
      expected: "not superuser",
      actual: "superuser; run as least-privilege read-only role",
      ok: false,
    });
  }
  if (flag.dblink === true || flag.dblink === "t" || flag.dblink === "true") {
    stops.push({
      step: 0,
      check_name: "extension dblink",
      expected: "not installed",
      actual: "installed; dblink can write from a read-only transaction",
      ok: false,
    });
  }
  if (flag.postgres_fdw === true || flag.postgres_fdw === "t" || flag.postgres_fdw === "true") {
    stops.push({
      step: 0,
      check_name: "extension postgres_fdw",
      expected: "not installed",
      actual: "installed; postgres_fdw can write from a read-only transaction",
      ok: false,
    });
  }
  return stops;
}

export function formatGuardFailure(rows: ChecklistRow[]): string {
  const lines = rows.map((row) => `${row.ok ? "PASS" : "STOP"} step ${row.step} ${row.check_name} expected=${row.expected} actual=${row.actual}`);
  const stops = rows.filter((row) => !row.ok).length;
  lines.push(`checklist stops=${stops} checks=${rows.length}`);
  return lines.join("\n");
}

function asBool(value: unknown): boolean {
  return value === true || value === "t" || value === "true";
}

function asRow(row: Record<string, unknown>, step: number): ChecklistRow {
  return {
    step,
    check_name: String(row.check_name),
    expected: String(row.expected),
    actual: String(row.actual),
    ok: asBool(row.ok),
  };
}

export async function executeReadOnly(
  url: string,
  statements: string[],
  connect: (url: string, statements: string[]) => Promise<Record<string, unknown>[]> = defaultConnect,
): Promise<Record<string, unknown>[]> {
  for (const statement of statements) assertSelectOnly(statement);
  return connect(url, statements);
}

export async function defaultConnect(url: string, statements: string[]): Promise<Record<string, unknown>[]> {
  assertNoStandardStringsOverride(url);
  assertSelectOnly(SESSION_PROBE);
  for (const statement of statements) assertSelectOnly(statement);
  const target = connectionTarget(url);
  const sql = postgres(url, {
    max: 1,
    connect_timeout: 10,
    host: [target.hostname],
    port: [Number(target.port || process.env.PGPORT || 5432)],
    connection: { default_transaction_read_only: "on" },
  });
  const rows: Record<string, unknown>[] = [];
  try {
    await sql.begin("READ ONLY", async (tx) => {
      const [flag] = await tx.unsafe(SESSION_PROBE, [], { prepare: true, simple: false });
      if (String(flag.read_only) !== "on" || String(flag.default_read_only) !== "on") {
        throw new Error("Refusing to run: transaction_read_only is not on");
      }
      rows.push({
        step: 0,
        check_name: "transaction_read_only",
        expected: "on",
        actual: "on",
        ok: true,
      });
      const stops = guardStops(flag);
      if (stops.length) {
        for (const stop of stops) rows.push({ ...stop, blocked: true });
        throw new ReadOnlyDone();
      }
      for (const statement of statements) {
        rows.push(...await tx.unsafe(statement, [], { prepare: true, simple: false }));
      }
      throw new ReadOnlyDone();
    });
  } catch (error) {
    if (!(error instanceof ReadOnlyDone)) throw error;
  } finally {
    await sql.end();
  }
  return rows;
}

export function loadChecklistInputs(read: (file: string) => string = (file) => readFileSync(new URL(file, ROOT), "utf8")) {
  const hosted = read("proposed/HOSTED-INSTALL.md");
  const preflight = read("proposed/m2-preflight.sql");
  assertSelectOnly(preflight);
  assertSelectOnly(EXTRA_SQL);
  const steps = hostedInstallSteps(hosted);
  const mapped = mapPreflightSteps(preflight, steps, read);
  return { preflight, mapped };
}

export function rowsFromQuery(queryRows: Record<string, unknown>[], mapped: Map<string, number>): ChecklistRow[] {
  return queryRows.map((row) => {
    const named = row.step == null ? mapped.get(String(row.check_name)) : Number(row.step);
    if (named == null || Number.isNaN(named)) throw new Error(`no step for ${String(row.check_name)}`);
    return asRow(row, named);
  });
}

export async function runChecklist(options: {
  url: string;
  hosted: boolean;
  statements?: string[];
  mapped?: Map<string, number>;
  connect?: (url: string, statements: string[]) => Promise<Record<string, unknown>[]>;
}): Promise<string> {
  assertPreflightTarget(options.url, options.hosted);
  const loaded = options.statements && options.mapped ? null : loadChecklistInputs();
  const statements = options.statements ?? [loaded!.preflight, EXTRA_SQL];
  const mapped = options.mapped ?? loaded!.mapped;
  const queryRows = await executeReadOnly(options.url, statements, options.connect);
  const checklist = rowsFromQuery(queryRows, mapped);
  if (queryRows.some((row) => row.blocked === true)) return formatGuardFailure(checklist);
  return formatChecklist(checklist);
}

if (import.meta.main) {
  const hosted = process.argv.includes("--hosted");
  const flag = process.argv.indexOf("--url");
  const url = flag >= 0 ? process.argv[flag + 1] ?? "" : "";
  try {
    assertPreflightTarget(url, hosted);
    console.log(`target host=${connectionHost(url)}`);
    const text = await runChecklist({ url, hosted });
    console.log(text);
    if (checklistStops(text) !== 0) process.exit(1);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
