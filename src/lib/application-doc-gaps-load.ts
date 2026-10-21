import { REQUIRED_DOC_TYPES } from "@/components/admin/types";
import {
  APPLICATION_DOC_GAPS_ROW_CAP,
  OPEN_APPLICATION_STATUSES,
  type ApplicationDocGapsResult,
} from "./application-doc-gaps";
import { buildApplicationDocGaps, type GapApplication, type GapDocument } from "./application-doc-gaps-build";
import { VAULT_TO_REQUIRED } from "./required-docs";

const PAGE = 200;
const MAX_ROWS = 100_000;
const ID_BATCH = 100;

const APPLICATION_COLUMNS = "id,full_name,status,deleted_at,created_at";
const DOCUMENT_COLUMNS = "id,driver_id,category,is_current,review_status,created_at";

const DOCUMENT_CATEGORIES = [
  ...new Set<string>([...REQUIRED_DOC_TYPES, ...Object.keys(VAULT_TO_REQUIRED)]),
];

type Page = { data: unknown[] | null; error: unknown; count: number | null };

const failed = (): ApplicationDocGapsResult => ({
  failed: true,
  truncated: false,
  cap: APPLICATION_DOC_GAPS_ROW_CAP,
  applications: [],
});

function badCount(count: number | null | undefined): boolean {
  return !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > MAX_ROWS;
}

/**
 * Count-checked pages. A bare limit is not an overflow signal: hosted
 * PostgREST can clamp a response and a short page then looks complete.
 */
async function readCounted(
  query: (from: number, to: number) => PromiseLike<Page>,
  cap = MAX_ROWS,
): Promise<{ ok: true; rows: Record<string, unknown>[]; total: number; truncated: boolean } | { ok: false }> {
  const rows: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let total: number | undefined;
  const stop = Math.min(cap, MAX_ROWS);
  do {
    const room = stop - rows.length;
    if (room <= 0) break;
    const size = Math.min(PAGE, room);
    const from = rows.length;
    const to = from + size - 1;
    let page: Page;
    try {
      page = await query(from, to);
    } catch {
      return { ok: false };
    }
    if (page.error || !Array.isArray(page.data) || badCount(page.count)) return { ok: false };
    if (total !== undefined && total !== page.count) return { ok: false };
    total = page.count as number;
    const expect = Math.min(total, stop);
    if (page.data.length === 0 && rows.length < expect) return { ok: false };
    for (const row of page.data) {
      const id = (row as { id?: unknown }).id;
      if (typeof id !== "string" || seen.has(id)) return { ok: false };
      seen.add(id);
      rows.push(row as Record<string, unknown>);
    }
    if (rows.length > total) return { ok: false };
  } while (total !== undefined && rows.length < total && rows.length < stop);
  if (total === undefined) return { ok: false };
  return { ok: true, rows, total, truncated: total > stop };
}

async function readInIdBatches(
  ids: readonly string[],
  query: (ids: string[], from: number, to: number) => PromiseLike<Page>,
): Promise<{ ok: true; rows: Record<string, unknown>[] } | { ok: false }> {
  const rows: Record<string, unknown>[] = [];
  for (let index = 0; index < ids.length; index += ID_BATCH) {
    const chunk = ids.slice(index, index + ID_BATCH);
    if (chunk.length === 0) continue;
    const read = await readCounted((from, to) => query(chunk, from, to));
    if (!read.ok || read.truncated) return { ok: false };
    rows.push(...read.rows);
  }
  return { ok: true, rows };
}

/**
 * Open applications and the vault rows that the shared required-document
 * rule can count. Callers have already passed the flag and the role check.
 * An error is `failed`, not a cap. A count above the cap still returns the
 * applications that were read.
 */
export async function loadApplicationDocGaps(admin: {
  from: (table: string) => any;
}): Promise<ApplicationDocGapsResult> {
  const applications = await readCounted(
    (from, to) =>
      admin
        .from("applications")
        .select(APPLICATION_COLUMNS, { count: "exact" })
        .is("deleted_at", null)
        .in("status", [...OPEN_APPLICATION_STATUSES])
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .range(from, to),
    APPLICATION_DOC_GAPS_ROW_CAP,
  );
  if (!applications.ok) return failed();
  const ids = applications.rows.map((row) => String(row.id));
  const documents =
    ids.length === 0
      ? { ok: true as const, rows: [] as Record<string, unknown>[] }
      : await readInIdBatches(ids, (chunk, from, to) =>
          admin
            .from("documents")
            .select(DOCUMENT_COLUMNS, { count: "exact" })
            .in("driver_id", chunk)
            .in("category", DOCUMENT_CATEGORIES)
            .order("id", { ascending: true })
            .range(from, to),
        );
  if (!documents.ok) return failed();
  return buildApplicationDocGaps({
    applications: applications.rows as unknown as GapApplication[],
    documents: documents.rows as unknown as GapDocument[],
    truncated: applications.truncated,
  });
}
