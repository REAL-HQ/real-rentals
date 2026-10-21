/**
 * Hash current license_front and license_back objects from their bytes.
 *
 * Dry-run is the default. It does not download and does not call
 * record_uploaded_content_sha. --write downloads each unhashed object and
 * calls writeUploadedContentSha, which records both sides from those bytes
 * and overwrites a client-set user_metadata.sha256. A row that already has a
 * 64-hex content_sha256 is skipped, so a second run resumes. A stored hash
 * that does not match the bytes is mismatched and is not replaced.
 *
 * This does not turn DOCUMENT_CONTENT_SHA256_ENABLED on. The SQL report in
 * proposed/backfill-document-content-sha.sql is the check that missing and
 * mismatched are both 0. It does not write.
 *
 *   bun scripts/backfill-document-content-sha.ts
 *   bun scripts/backfill-document-content-sha.ts --write
 */
import { writeUploadedContentSha } from "../src/lib/document-content-sha";

export type ContentShaBackfillCounts = {
  hashed: number;
  skipped: number;
  missing: number;
  mismatched: number;
  pending: number;
};

type LicenseRow = {
  id: string;
  storage_bucket: string | null;
  storage_path: string | null;
  content_sha256: string | null;
};

function isRecordedHash(value: string | null | undefined): boolean {
  return typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
}

export async function backfillLicenseContentSha(
  admin: any,
  options: { write: boolean },
): Promise<ContentShaBackfillCounts> {
  const counts: ContentShaBackfillCounts = {
    hashed: 0,
    skipped: 0,
    missing: 0,
    mismatched: 0,
    pending: 0,
  };
  const { data, error } = await admin
    .from("documents")
    .select("id,storage_bucket,storage_path,content_sha256")
    .eq("is_current", true)
    .in("category", ["license_front", "license_back"]);
  if (error) throw new Error(error.message || "Could not list license documents");
  for (const row of (data ?? []) as LicenseRow[]) {
    const bucket = row.storage_bucket?.trim() ?? "";
    const path = row.storage_path?.trim() ?? "";
    if (!bucket || !path) {
      counts.skipped += 1;
      continue;
    }
    if (isRecordedHash(row.content_sha256)) {
      counts.skipped += 1;
      continue;
    }
    const info = await admin.storage.from(bucket).info(path);
    if (info?.error || !info?.data?.id) {
      counts.missing += 1;
      continue;
    }
    if (!options.write) {
      counts.pending += 1;
      continue;
    }
    try {
      await writeUploadedContentSha(admin, bucket, path);
      counts.hashed += 1;
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : String(caught);
      if (message === "Uploaded object missing" || message === "Uploaded bytes missing") {
        counts.missing += 1;
      } else if (message.includes("content_sha256_mismatch") || message === "Uploaded object changed") {
        counts.mismatched += 1;
      } else {
        throw caught;
      }
    }
  }
  return counts;
}

export function formatContentShaBackfill(mode: "dry-run" | "write", counts: ContentShaBackfillCounts): string {
  return `mode=${mode} hashed=${counts.hashed} skipped=${counts.skipped} missing=${counts.missing} mismatched=${counts.mismatched} pending=${counts.pending}`;
}

if (import.meta.main) {
  const write = process.argv.includes("--write");
  const { supabaseAdmin } = await import("../src/integrations/supabase/client.server");
  const counts = await backfillLicenseContentSha(supabaseAdmin, { write });
  console.log(formatContentShaBackfill(write ? "write" : "dry-run", counts));
}
