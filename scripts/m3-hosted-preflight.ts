/**
 * Read-only checklist before proposed/m3/HOSTED-INSTALL.md.
 *
 * Loads proposed/m3/preflight.sql. A tokenizer accepts exactly one SELECT
 * or WITH. Comments, standard strings, E'' strings, dollar quotes, and
 * quoted identifiers cannot hide a second command. The statement is sent
 * with the extended protocol. The connection sets
 * default_transaction_read_only=on, and the transaction ends with ROLLBACK.
 *
 * Run it as a role that can SELECT the checklist tables and cannot insert,
 * update, delete, or change the catalog. A superuser can ignore the
 * read-only setting. This file does not create that role.
 *
 * PGUSER, PGPASSWORD, PGHOST, PGPORT, and PGDATABASE fill in parts the URL
 * leaves out. The script prints the host and port only. It does not read
 * SUPABASE_URL. There is no default connection. A host other than loopback
 * (127.0.0.1, localhost, ::1) also needs --hosted.
 *
 *   bun scripts/m3-hosted-preflight.ts --url postgresql://postgres@127.0.0.1:55442/m3_rehearsal?sslmode=disable
 */
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { assertSelectOnly } from "./select-only.mjs";

const ROOT = new URL("..", import.meta.url);

export type ChecklistRow = {
  step: number;
  check_name: string;
  expected: string;
  actual: string;
  ok: boolean;
};

/** Absent objects this packet creates. Any other absent check is unmapped. */
export const ABSENT_STEP = new Map<string, number>([
  ["public.applications.tnc_uber_approval_expires_on", 1],
  ["public.applications.tnc_lyft_approval_expires_on", 1],
  ["public.waitlist_coming_soon_email_limit()", 2],
  ["trigger waitlist_coming_soon_email_limit", 2],
  ["index waitlist_coming_soon_email_created_idx", 2],
]);

const LAST_STEP = 2;

class ReadOnlyDone extends Error {}

export function stepForCheck(name: string, expected: string): number {
  const known = ABSENT_STEP.get(name);
  if (known != null) return known;
  if (expected === "absent") {
    throw new Error(`preflight check is not mapped to an install step: ${name}`);
  }
  return 0;
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
  for (let step = 0; step <= LAST_STEP; step += 1) {
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
  const extra = [...byStep.keys()].filter((step) => step < 0 || step > LAST_STEP);
  if (extra.length) throw new Error(`checklist step is outside 0..${LAST_STEP}: ${extra.join(",")}`);
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

export function assertPreflightTarget(url: string, hosted: boolean): void {
  if (!url || url.startsWith("--")) throw new Error("Pass the database URL after --url. There is no default connection.");
  if (!isLoopbackHost(url) && !hosted) {
    throw new Error("Refusing to run: host is not loopback. Pass --hosted to run the read-only checklist against that host.");
  }
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
      const [flag] = await tx.unsafe(
        "SELECT current_setting('transaction_read_only') AS read_only, current_setting('default_transaction_read_only') AS default_read_only",
        [],
        { prepare: true, simple: false },
      );
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

export function loadPreflight(read: (file: string) => string = (file) => readFileSync(new URL(file, ROOT), "utf8")): string {
  const preflight = read("proposed/m3/preflight.sql");
  assertSelectOnly(preflight);
  return preflight;
}

export function rowsFromQuery(queryRows: Record<string, unknown>[]): ChecklistRow[] {
  return queryRows.map((row) => {
    const expected = String(row.expected);
    const named = row.step == null ? stepForCheck(String(row.check_name), expected) : Number(row.step);
    if (Number.isNaN(named)) throw new Error(`no step for ${String(row.check_name)}`);
    return asRow(row, named);
  });
}

export async function runChecklist(options: {
  url: string;
  hosted: boolean;
  statements?: string[];
  connect?: (url: string, statements: string[]) => Promise<Record<string, unknown>[]>;
}): Promise<string> {
  assertPreflightTarget(options.url, options.hosted);
  const statements = options.statements ?? [loadPreflight()];
  const queryRows = await executeReadOnly(options.url, statements, options.connect);
  return formatChecklist(rowsFromQuery(queryRows));
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
