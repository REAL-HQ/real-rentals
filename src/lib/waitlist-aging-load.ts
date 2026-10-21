import { WAITLIST_AGING_CAP, type WaitlistAgingResult } from "./waitlist-aging";
import { buildWaitlistAging, type AgingApplication, type AgingEntry } from "./waitlist-aging-build";

// Same shape as waitlist-reads.server.ts, but a bad page is a failed result.
// The live helper throws; this screen must show an error instead of a cap.
const PAGE = 200;
const MAX_ROWS = 100_000;
const ID_BATCH = 50;

type Page = { data: Array<{ id?: unknown }> | null; error: unknown; count: number | null };
type ReadOk = { ok: true; rows: Array<{ id: string }>; truncated: boolean };
type ReadFail = { ok: false };

function failed(): WaitlistAgingResult {
  return { failed: true, truncated: false, cap: WAITLIST_AGING_CAP, groups: [] };
}

async function readCounted(
  query: (from: number, to: number) => PromiseLike<Page>,
  cap: number,
): Promise<ReadOk | ReadFail> {
  const rows: Array<{ id: string }> = [];
  const seen = new Set<string>();
  let total: number | undefined;
  do {
    const page = await query(rows.length, rows.length + PAGE - 1);
    if (
      page.error ||
      !Array.isArray(page.data) ||
      !Number.isSafeInteger(page.count) ||
      (page.count as number) < 0 ||
      (page.count as number) > MAX_ROWS
    ) {
      return { ok: false };
    }
    if (total !== undefined && total !== page.count) return { ok: false };
    total = page.count as number;
    if (page.data.length === 0 && rows.length < total && rows.length < cap) return { ok: false };
    for (const row of page.data) {
      if (typeof row?.id !== "string" || seen.has(row.id)) return { ok: false };
      seen.add(row.id);
      rows.push(row as { id: string });
      if (rows.length >= cap) return { ok: true, rows, truncated: total > cap };
    }
    if (rows.length > total) return { ok: false };
  } while (rows.length < total && rows.length < cap);
  return { ok: true, rows, truncated: false };
}

async function readApplications(
  db: { from: (table: string) => any },
  ids: string[],
): Promise<{ ok: true; rows: AgingApplication[] } | ReadFail> {
  const rows: AgingApplication[] = [];
  for (let i = 0; i < ids.length; i += ID_BATCH) {
    const batch = ids.slice(i, i + ID_BATCH);
    const read = await readCounted(
      (from, to) =>
        db
          .from("applications")
          .select("id,created_at", { count: "exact" })
          .in("id", batch)
          .order("id", { ascending: true })
          .range(from, to),
      MAX_ROWS,
    );
    if (!read.ok || read.truncated) return { ok: false };
    rows.push(...(read.rows as AgingApplication[]));
  }
  return { ok: true, rows };
}

export async function loadWaitlistAging(
  db: { from: (table: string) => any },
  today = new Date(),
): Promise<WaitlistAgingResult> {
  const read = await readCounted(
    (from, to) =>
      db
        .from("waitlist")
        .select("id,city,status,created_at,notified_at,promoted_application_id", { count: "exact" })
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    WAITLIST_AGING_CAP,
  );
  if (!read.ok) return failed();
  const ids = [
    ...new Set(
      read.rows
        .map((row) => (row as AgingEntry).promoted_application_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const applications =
    ids.length === 0 ? { ok: true as const, rows: [] } : await readApplications(db, ids);
  if (!applications.ok) return failed();
  return buildWaitlistAging({
    entries: read.rows as AgingEntry[],
    applications: applications.rows,
    today,
    truncated: read.truncated,
  });
}
