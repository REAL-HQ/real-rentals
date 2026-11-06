import { readCounted, readInIdBatches } from "./count-paged-read";
import {
  APPLICATION_DOC_GAPS_ROW_CAP,
  OPEN_APPLICATION_STATUSES,
  type ApplicationDocGapsResult,
} from "./application-doc-gaps";
import { buildApplicationDocGaps, type GapApplication, type GapDocument } from "./application-doc-gaps-build";

const APPLICATION_COLUMNS = "id,full_name,status,deleted_at,created_at";
const DOCUMENT_COLUMNS = "id,driver_id,category,is_current,review_status,created_at";

const failed = (): ApplicationDocGapsResult => ({
  failed: true,
  truncated: false,
  cap: APPLICATION_DOC_GAPS_ROW_CAP,
  applications: [],
});

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
            // No category list here. An exact category match cannot see a
            // value that canonicalRequiredDoc only accepts after trim, so the
            // builder is the only gate. Each driver_id list stays at or under
            // COUNTED_ID_BATCH.
            .select(DOCUMENT_COLUMNS, { count: "exact" })
            .in("driver_id", chunk)
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
