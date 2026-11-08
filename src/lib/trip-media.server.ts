/* eslint-disable @typescript-eslint/no-explicit-any -- Supabase service-role rows, as elsewhere in src/lib */
/**
 * Writes one condition_media row for an uploaded original. Shared by the
 * renter upload (inspections.functions) and the staff trip upload
 * (trip-media.functions). Server only — uses the service-role client.
 */
import { parseConditionExif } from "@/lib/condition-exif";
import { CONDITION_BUCKET_NAME } from "@/lib/trip-media-bucket";
import exifr from "exifr";
import {
  buildShareCopy,
  shareCopyPath,
  sniffMediaType,
  verifyMagic,
  TRIP_MEDIA_MAX_BYTES,
  TRIP_MEDIA_TYPES,
} from "@/lib/trip-media";

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

  // Read the stored original back — the trusted copy. Only its first bytes
  // are fetched to judge the type (memory: the worker has ~128 MB and an
  // original may be 50 MB). The full file is read only for photos small
  // enough to copy safely in memory; videos are never loaded whole.
  const head = await readHead(admin, a.path);
  if (!head) throw new Error("The upload didn't arrive. Nothing was saved.");
  let mime: string;
  try {
    mime = verifyMagic(a.mimeType, head.bytes);
  } catch (e) {
    // Not what it claimed to be: remove the object rather than keep it.
    await admin.storage.from(CONDITION_BUCKET_NAME).remove([a.path]);
    throw e;
  }
  const kind = TRIP_MEDIA_TYPES[mime];
  const actualSize = head.size ?? a.sizeBytes;
  if (actualSize != null && actualSize > TRIP_MEDIA_MAX_BYTES) {
    await admin.storage.from(CONDITION_BUCKET_NAME).remove([a.path]);
    throw new Error("Larger than 50 MB");
  }

  if (kind === "photo") {
    let full: Uint8Array | null = null;
    if (actualSize != null && actualSize <= SHARE_COPY_MAX_BYTES) {
      const { data: blob, error: dlErr } = await admin.storage
        .from(CONDITION_BUCKET_NAME)
        .download(a.path);
      if (dlErr || !blob) throw new Error("The upload didn't arrive. Nothing was saved.");
      full = new Uint8Array(await blob.arrayBuffer());
    }
    const exif = await parseConditionExif(full ?? head.bytes, new Date());
    if (exif.takenAtSource === "exif" && exif.takenAt) {
      takenAt = exif.takenAt.toISOString();
      source = "exif";
    }
    gpsLat = exif.gpsLat;
    gpsLng = exif.gpsLng;

    if (full) {
      try {
        const copy = buildShareCopy(mime, full);
        full = null;
        if (copy && (await shareCopyIsClean(copy))) {
          const sp = shareCopyPath(a.path);
          const up = await admin.storage
            .from(CONDITION_BUCKET_NAME)
            .upload(sp, copy, { contentType: mime, upsert: false });
          if (!up.error) sharePath = sp;
        }
      } catch {
        sharePath = null; // No safe copy: the renter sees the entry, not the file.
      }
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
      mime_type: mime,
      size_bytes: actualSize,
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

/** Photos above this get no renter copy (original + copy must fit in worker memory). */
export const SHARE_COPY_MAX_BYTES = 20 * 1024 * 1024;
const HEAD_BYTES = 256 * 1024;

/** First bytes of a stored object plus its real size, via a short-lived signed URL + Range. */
async function readHead(
  admin: any,
  path: string,
): Promise<{ bytes: Uint8Array; size: number | null } | null> {
  const { data: signed, error } = await admin.storage
    .from(CONDITION_BUCKET_NAME)
    .createSignedUrl(path, 60);
  if (error || !signed?.signedUrl) return null;
  const res = await fetch(signed.signedUrl, { headers: { Range: `bytes=0-${HEAD_BYTES - 1}` } });
  if (!res.ok) return null;
  const range = res.headers.get("content-range");
  const total = range ? Number(range.split("/")[1]) : Number(res.headers.get("content-length"));
  // Read at most HEAD_BYTES even if the server ignored Range.
  const reader = res.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let got = 0;
  while (got < HEAD_BYTES) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    got += value.length;
  }
  await reader.cancel().catch(() => {});
  const bytes = new Uint8Array(Math.min(got, HEAD_BYTES));
  let o = 0;
  for (const c of chunks) {
    const take = Math.min(c.length, bytes.length - o);
    bytes.set(c.subarray(0, take), o);
    o += take;
    if (o >= bytes.length) break;
  }
  return { bytes, size: Number.isFinite(total) && total > 0 ? total : null };
}

/** Independent check on the finished copy: exifr must find nothing. Fails closed. */
async function shareCopyIsClean(copy: Uint8Array): Promise<boolean> {
  try {
    const left = await exifr.parse(copy, { gps: true, xmp: true, iptc: true, icc: true });
    return !left || Object.keys(left).length === 0;
  } catch {
    return false; // can't prove clean
  }
}

/** One legacy row: make and record its share copy if the original allows. */
export async function backfillOne(
  admin: any,
  r: { id: string; storage_bucket: string; storage_path: string },
): Promise<boolean> {
  if (r.storage_bucket !== CONDITION_BUCKET_NAME) return false;
  const head = await readHead(admin, r.storage_path);
  if (!head || head.size == null || head.size > SHARE_COPY_MAX_BYTES) return false;
  const pre = sniffMediaType(head.bytes);
  if (!pre || TRIP_MEDIA_TYPES[pre] !== "photo") return false;
  const { data: blob, error } = await admin.storage.from(r.storage_bucket).download(r.storage_path);
  if (error || !blob) return false;
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const mime = sniffMediaType(bytes);
  if (!mime) return false;
  const copy = buildShareCopy(mime, bytes);
  if (!copy || !(await shareCopyIsClean(copy))) return false;
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
