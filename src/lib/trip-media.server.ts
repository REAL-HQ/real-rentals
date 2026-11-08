/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase service-role rows, as elsewhere in src/lib */
/**
 * Writes one condition_media row for an uploaded original. Shared by the
 * renter upload (inspections.functions) and the staff trip upload
 * (trip-media.functions). Server only — uses the service-role client.
 */
import { parseConditionExif } from "@/lib/condition-exif";
import { CONDITION_BUCKET_NAME } from "@/lib/trip-media-bucket";
import { makeShareCopy, shareCopyPath, TRIP_MEDIA_TYPES } from "@/lib/trip-media";

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
  const kind = TRIP_MEDIA_TYPES[a.mimeType];
  if (!kind) throw new Error("This file type isn't supported");

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

  if (kind === "photo") {
    const { data: blob, error } = await admin.storage.from(CONDITION_BUCKET_NAME).download(a.path);
    if (error || !blob) throw new Error("The upload didn't arrive. Nothing was saved.");
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const exif = await parseConditionExif(bytes, new Date());
    if (exif.takenAtSource === "exif" && exif.takenAt) {
      takenAt = exif.takenAt.toISOString();
      source = "exif";
    }
    gpsLat = exif.gpsLat;
    gpsLng = exif.gpsLng;
    const copy = makeShareCopy(a.mimeType, bytes);
    if (copy) {
      const sp = shareCopyPath(a.path);
      const up = await admin.storage
        .from(CONDITION_BUCKET_NAME)
        .upload(sp, copy, { contentType: a.mimeType, upsert: false });
      if (!up.error) sharePath = sp;
    }
  } else {
    // Video: no metadata parser here, so no capture time is claimed and no
    // renter copy is made. Confirm the object exists before writing a row.
    const folder = a.path.slice(0, a.path.lastIndexOf("/"));
    const name = a.path.slice(a.path.lastIndexOf("/") + 1);
    const { data: found, error } = await admin.storage
      .from(CONDITION_BUCKET_NAME)
      .list(folder, { search: name, limit: 2 });
    if (error || !(found ?? []).some((o: any) => o.name === name)) {
      throw new Error("The upload didn't arrive. Nothing was saved.");
    }
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
      mime_type: a.mimeType,
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
