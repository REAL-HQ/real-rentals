import { readCounted, readInIdBatches } from "./count-paged-read";
import { WAITLIST_AGING_CAP, failedWaitlistAging, type WaitlistAgingResult } from "./waitlist-aging";
import {
  buildWaitlistAging,
  notifiedThroughIso,
  type AgingApplication,
  type AgingEntry,
} from "./waitlist-aging-build";

// Same shape as waitlist-reads.server.ts, but a bad page is a failed result.
// The live helper throws; this screen must show an error instead of a cap.
// Application id lists stay at 50. The shared reader defaults to 100.
const ID_BATCH = 50;

async function readApplications(
  db: { from: (table: string) => any },
  ids: string[],
): Promise<{ ok: true; rows: AgingApplication[] } | { ok: false }> {
  const read = await readInIdBatches(
    ids,
    (chunk, from, to) =>
      db
        .from("applications")
        .select("id,created_at", { count: "exact" })
        .in("id", chunk)
        .is("deleted_at", null)
        .order("id", { ascending: true })
        .range(from, to),
    ID_BATCH,
  );
  if (!read.ok) return { ok: false };
  return { ok: true, rows: read.rows as AgingApplication[] };
}

export async function loadWaitlistAging(
  db: { from: (table: string) => any },
  today = new Date(),
): Promise<WaitlistAgingResult> {
  const columns = "id,city,status,created_at,notified_at,promoted_application_id";
  const waiting = await readCounted(
    (from, to) =>
      db
        .from("waitlist")
        .select(columns, { count: "exact" })
        .eq("status", "waiting")
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    WAITLIST_AGING_CAP,
  );
  if (!waiting.ok) return failedWaitlistAging();
  const notified = await readCounted(
    (from, to) =>
      db
        .from("waitlist")
        .select(columns, { count: "exact" })
        .eq("status", "notified")
        .lte("notified_at", notifiedThroughIso(today))
        .order("notified_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to),
    WAITLIST_AGING_CAP,
  );
  if (!notified.ok) return failedWaitlistAging();
  const entries = [...waiting.rows, ...notified.rows] as AgingEntry[];
  const ids = [
    ...new Set(
      notified.rows
        .map((row) => (row as AgingEntry).promoted_application_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0),
    ),
  ];
  const applications = ids.length === 0 ? { ok: true as const, rows: [] } : await readApplications(db, ids);
  if (!applications.ok) return failedWaitlistAging();
  return buildWaitlistAging({
    entries,
    applications: applications.rows,
    today,
    truncated: waiting.truncated || notified.truncated,
  });
}
