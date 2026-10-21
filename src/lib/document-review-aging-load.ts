import { leadToday } from "./lead-priorities";
import { DOCUMENT_REVIEW_AGING_ROW_CAP, type DocumentReviewAgingResult } from "./document-review-aging";
import {
  buildDocumentReviewAging,
  type ReviewApplication,
  type ReviewDocument,
} from "./document-review-aging-build";

const PAGE = 200;
const MAX_ROWS = 100_000;
const ID_BATCH = 100;

const DOCUMENT_COLUMNS = "id,driver_id,category,is_current,review_status,created_at";
const APPLICATION_COLUMNS = "id,full_name";

type Page = { data: unknown[] | null; error: unknown; count: number | null };

const failed = (): DocumentReviewAgingResult => ({
  failed: true,
  truncated: false,
  cap: DOCUMENT_REVIEW_AGING_ROW_CAP,
  categories: [],
});

function badCount(count: number | null | undefined): boolean {
  return !Number.isSafeInteger(count) || (count as number) < 0 || (count as number) > MAX_ROWS;
}

/**
 * Count-checked pages, in the shape of waitlist-reads.server.ts. A bare
 * limit is not an overflow signal. A changing count or an empty page while
 * rows remain is a failure, not a cap. This returns that failure instead of
 * throwing so the screen can say so apart from the cap.
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
 * Current uploads still marked uploaded, oldest first. Callers have already
 * passed the flag and the role check. There is no category list: an exact
 * match cannot see a value canonicalRequiredDoc only accepts after trim.
 * Names are a second read, in id lists of ID_BATCH. An error is `failed`,
 * not a cap.
 */
export async function loadDocumentReviewAging(
  admin: { from: (table: string) => any },
  today = leadToday(new Date()),
): Promise<DocumentReviewAgingResult> {
  const documents = await readCounted(
    (from, to) =>
      admin
        .from("documents")
        .select(DOCUMENT_COLUMNS, { count: "exact" })
        .eq("is_current", true)
        .eq("review_status", "uploaded")
        .not("driver_id", "is", null)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    DOCUMENT_REVIEW_AGING_ROW_CAP,
  );
  if (!documents.ok) return failed();
  const driverIds = [
    ...new Set(
      documents.rows
        .map((row) => (row as { driver_id?: unknown }).driver_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const applications =
    driverIds.length === 0
      ? { ok: true as const, rows: [] as Record<string, unknown>[] }
      : await readInIdBatches(driverIds, (chunk, from, to) =>
          admin
            .from("applications")
            .select(APPLICATION_COLUMNS, { count: "exact" })
            .in("id", chunk)
            .order("id", { ascending: true })
            .range(from, to),
        );
  if (!applications.ok) return failed();
  return buildDocumentReviewAging({
    documents: documents.rows as unknown as ReviewDocument[],
    applications: applications.rows as unknown as ReviewApplication[],
    truncated: documents.truncated,
    today,
  });
}
