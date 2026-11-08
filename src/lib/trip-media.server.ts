/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase service-role rows, as elsewhere in src/lib */
/**
 * Writes one condition_media row for an uploaded original. Shared by the
 * renter upload (inspections.functions) and the staff trip upload
 * (trip-media.functions). Server only — uses the service-role client.
 */
import { parseConditionExif } from "@/lib/condition-exif";
import { CONDITION_BUCKET_NAME } from "@/lib/trip-media-bucket";
import exifr from "exifr";
import { buildShareCopy, shareCopyPath, verifyMagic, TRIP_MEDIA_TYPES } from "@/lib/trip-media";

export const DUPLICATE_MEDIA = "This upload was already saved. Nothing was added.";

export type StoreArgs = {
  vehicleId: string;
  rentalId: string | null;
  applicationId: string | null;
  inspectionId: string | null;
  phase: string;
  angle: string | null;
  path: string;
  fileName: string | null;
  mimeType: string;
  sizeBytes: number | null;
  caption: string | null;
  capturedBy: string;
  capturedByRole: "staff" | "driver";
};

export async function storeConditionMedia(
  admin: any,
  a: StoreArgs,
): Promise<{ id: string; missingExifTime: boolean; sharePreview: boolean }> {
  if (!TRIP_MEDIA_TYPES[a.mimeType]) throw new Error("This file type isn't supported");

  // One reservation, one row.
  const { data: existing, error: dupErr } = await admin
    .from("condition_media")
    .select("id")
    .eq("storage_bucket", CONDITION_BUCKET_NAME)
    .eq("storage_path", a.path)
    .limit(1);
  if (dupErr) throw new Error("Could not check for an existing copy. Nothing was saved.");
  if ((existing ?? []).length) throw new Error(DUPLICATE_MEDIA);

  let takenAt: string | null = null;
  let source: "exif" | "upload" = "upload";
  let gpsLat: number | null = null;
  let gpsLng: number | null = null;
  let sharePath: string | null = null;

  // Read the stored original back. This is the trusted copy: the type is
  // judged from its bytes, metadata is read from it, and the renter copy is
  // made from it here on the server — nothing the caller sends is trusted.
  const { data: blob, error: dlErr } = await admin.storage
    .from(CONDITION_BUCKET_NAME)
    .download(a.path);
  if (dlErr || !blob) throw new Error("The upload didn't arrive. Nothing was saved.");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let mime: string;
  try {
    mime = verifyMagic(a.mimeType, bytes);
  } catch (e) {
    // Not what it claimed to be: remove the object rather than keep it.
    await admin.storage.from(CONDITION_BUCKET_NAME).remove([a.path]);
    throw e;
  }
  const kind = TRIP_MEDIA_TYPES[mime];

  if (kind === "photo") {
    const exif = await parseConditionExif(bytes, new Date());
    if (exif.takenAtSource === "exif" && exif.takenAt) {
      takenAt = exif.takenAt.toISOString();
      source = "exif";
    }
    gpsLat = exif.gpsLat;
    gpsLng = exif.gpsLng;
  }

  // Build the renter copy last: for HEIC and video it rewrites `bytes` in place.
  try {
    const copy = buildShareCopy(mime, bytes);
    if (copy && (await shareCopyIsClean(mime, copy))) {
      const sp = shareCopyPath(a.path);
      const up = await admin.storage
        .from(CONDITION_BUCKET_NAME)
        .upload(sp, copy, { contentType: mime, upsert: false });
      if (!up.error) sharePath = sp;
    }
  } catch {
    sharePath = null; // No safe copy: the renter sees the entry, not the file.
  }

  const { data: row, error } = await admin
    .from("condition_media")
    .insert({
      vehicle_id: a.vehicleId,
      rental_id: a.rentalId,
      application_id: a.applicationId,
      inspection_id: a.inspectionId,
      phase: a.phase,
      angle: a.angle,
      media_type: kind,
      storage_bucket: CONDITION_BUCKET_NAME,
      storage_path: a.path,
      share_path: sharePath,
      file_name: a.fileName,
      mime_type: mime,
      size_bytes: a.sizeBytes,
      captured_by: a.capturedBy,
      captured_by_role: a.capturedByRole,
      caption: a.caption,
      // Never the upload time dressed up as a capture time: created_at is the
      // upload time, taken_at is the camera's, or null.
      taken_at: takenAt,
      taken_at_source: source,
      gps_lat: gpsLat,
      gps_lng: gpsLng,
    })
    .select("id")
    .single();
  if (error) {
    if (sharePath) await admin.storage.from(CONDITION_BUCKET_NAME).remove([sharePath]);
    throw new Error(error.message);
  }
  return { id: row.id as string, missingExifTime: source !== "exif", sharePreview: !!sharePath };
}

/** Independent check on the finished copy: no GPS or EXIF left for exifr to find. */
async function shareCopyIsClean(mime: string, copy: Uint8Array): Promise<boolean> {
  if (TRIP_MEDIA_TYPES[mime] === "video") return true; // checked structurally in buildShareCopy
  try {
    const left = await exifr.parse(copy, { gps: true, xmp: true, iptc: true });
    return !left || Object.keys(left).length === 0;
  } catch {
    return true; // nothing parseable left
  }
}

/** One legacy row: make and record its share copy if the original allows. */
export async function backfillOne(
  admin: any,
  r: { id: string; storage_bucket: string; storage_path: string },
): Promise<boolean> {
  const { data: blob, error } = await admin.storage.from(r.storage_bucket).download(r.storage_path);
  if (error || !blob) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const { sniffMediaType } = await import("@/lib/trip-media");
  const mime = sniffMediaType(bytes);
  if (!mime) return false;
  const copy = buildShareCopy(mime, bytes);
  if (!copy || !(await shareCopyIsClean(mime, copy))) return false;
  const sp = shareCopyPath(r.storage_path);
  const up = await admin.storage
    .from(r.storage_bucket)
    .upload(sp, copy, { contentType: mime, upsert: false });
  if (up.error) return false;
  const { error: uErr } = await admin
    .from("condition_media")
    .update({ share_path: sp })
    .eq("id", r.id)
    .is("share_path", null);
  return !uErr;
}
