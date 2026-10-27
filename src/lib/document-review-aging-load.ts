import { COUNTED_MAX, readCounted, readInIdBatches } from "./count-paged-read";
import { leadToday } from "./lead-priorities";
import { DOCUMENT_REVIEW_AGING_ROW_CAP, type DocumentReviewAgingResult } from "./document-review-aging";
import {
  buildDocumentReviewAging,
  type ReviewApplication,
  type ReviewDocument,
} from "./document-review-aging-build";

const DOCUMENT_COLUMNS = "id,driver_id,category,is_current,review_status,created_at";
const APPLICATION_COLUMNS = "id,full_name";

const failed = (): DocumentReviewAgingResult => ({
  failed: true,
  truncated: false,
  cap: DOCUMENT_REVIEW_AGING_ROW_CAP,
  categories: [],
});

/**
 * Current uploads still marked uploaded, oldest first. Callers have already
 * passed the flag and the role check. There is no category list: an exact
 * match cannot see a value canonicalRequiredDoc only accepts after trim.
 * Names are a second read, in id lists of COUNTED_ID_BATCH. An error is
 * `failed`, not a cap. Soft-deleted applicants are dropped before the
 * display cap, so their uploads cannot take a slot from a live driver.
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
    COUNTED_MAX,
  );
  if (!documents.ok || documents.truncated) return failed();
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
            .is("deleted_at", null)
            .order("id", { ascending: true })
            .range(from, to),
        );
  if (!applications.ok) return failed();
  const live = new Set(
    applications.rows
      .map((row) => row.id)
      .filter((id): id is string => typeof id === "string" && id.length > 0),
  );
  const kept = documents.rows.filter((row) => {
    const driverId = (row as { driver_id?: unknown }).driver_id;
    return typeof driverId === "string" && live.has(driverId);
  });
  return buildDocumentReviewAging({
    documents: kept.slice(0, DOCUMENT_REVIEW_AGING_ROW_CAP) as unknown as ReviewDocument[],
    applications: applications.rows as unknown as ReviewApplication[],
    truncated: kept.length > DOCUMENT_REVIEW_AGING_ROW_CAP,
    today,
  });
}
