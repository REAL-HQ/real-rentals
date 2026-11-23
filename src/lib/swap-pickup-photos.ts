/**
 * Pickup photos on a vehicle swap. Pure rules — no I/O.
 *
 * Files are still images in the existing private condition-media bucket
 * (same types and 50 MB object cap as trip / inspection photos). They are
 * not condition_media rows: those are readable by the renter on the rental.
 * A swap photo never changes the swap row.
 */
import { formatVehicleIdentityLine, type VehicleLabelSource } from "@/lib/vehicle-label";
import { TRIP_MEDIA_TYPES, tripMediaType } from "@/lib/trip-media";

/** Same ceiling as the condition-media bucket (fleet_ops_foundation). */
export const SWAP_PICKUP_PHOTO_MAX_BYTES = 50 * 1024 * 1024;
/** First real batch is 42 photos. 80 leaves room for a few retakes, not an open-ended dump. */
export const SWAP_PICKUP_PHOTO_MAX_COUNT = 80;
export const SWAP_PICKUP_PHOTO_BUCKET = "condition-media";
export const SWAP_PICKUP_PHOTOS_TABLE = "rental_vehicle_swap_photos";
export const SWAP_PICKUP_PHOTO_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,.jpg,.jpeg,.png,.webp,.heic";

const PHOTO_EXT: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/heic": "heic",
};

const REST_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(jpg|jpeg|png|webp|heic)$/i;

/** Still images only. Videos stay on trip media; a bare image/jpg claim counts as JPEG. */
export function swapPickupPhotoMime(
  fileName: string,
  mimeType: string | null | undefined,
): string | null {
  const raw = String(mimeType ?? "").toLowerCase();
  const hinted = raw === "image/jpg" || raw === "image/pjpeg" ? "image/jpeg" : raw;
  const mime = tripMediaType(fileName, hinted);
  if (!mime || TRIP_MEDIA_TYPES[mime] !== "photo") return null;
  return mime;
}

export function swapPickupPhotoExt(mime: string): string {
  return PHOTO_EXT[mime] ?? "jpg";
}

export function swapPickupPhotoPrefix(vehicleId: string, swapId: string): string {
  return `${vehicleId}/swap/${swapId}/`;
}

/** True when the object name is exactly one file under this swap's folder. */
export function swapPickupPhotoPathOk(path: string, vehicleId: string, swapId: string): boolean {
  const prefix = swapPickupPhotoPrefix(vehicleId, swapId);
  if (!path.startsWith(prefix)) return false;
  const rest = path.slice(prefix.length);
  if (rest.includes("/") || rest.includes("\\") || rest.includes("..")) return false;
  return REST_RE.test(rest);
}

export function swapPickupFileName(name: string): string {
  let clean = "";
  for (const ch of name) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 32 && code !== 127) clean += ch;
  }
  clean = clean.trim().slice(0, 200);
  return clean || "photo";
}

/**
 * Why this one file cannot be added, or null when it can.
 * Status is intentionally not an input: Completed swaps accept photos.
 */
export function swapPickupAdditionError(input: {
  existingCount: number;
  sizeBytes: number;
  fileName: string;
  mimeType: string | null | undefined;
}): string | null {
  if (!swapPickupPhotoMime(input.fileName, input.mimeType)) {
    return "Use a JPEG, PNG, WebP or HEIC photo.";
  }
  if (!Number.isFinite(input.sizeBytes) || input.sizeBytes <= 0) return "The file is empty.";
  if (input.sizeBytes > SWAP_PICKUP_PHOTO_MAX_BYTES) return "Larger than 50 MB.";
  if (input.existingCount >= SWAP_PICKUP_PHOTO_MAX_COUNT) {
    return `This swap already has ${SWAP_PICKUP_PHOTO_MAX_COUNT} pickup photos.`;
  }
  return null;
}

/**
 * A whole selection (the first real one is 42 files around 2–4 MB).
 * Rejects the selection when the count would pass the cap; does not drop extras quietly.
 */
export function swapPickupBatchError(
  existingCount: number,
  files: Array<{ sizeBytes: number; fileName: string; mimeType: string | null | undefined }>,
): string | null {
  if (files.length < 1) return "Choose at least one photo.";
  if (existingCount + files.length > SWAP_PICKUP_PHOTO_MAX_COUNT) {
    const room = Math.max(0, SWAP_PICKUP_PHOTO_MAX_COUNT - existingCount);
    return room === 0
      ? `This swap already has ${SWAP_PICKUP_PHOTO_MAX_COUNT} pickup photos.`
      : `Up to ${room} more pickup photo${room === 1 ? "" : "s"} can be added. No files were saved.`;
  }
  for (const file of files) {
    const err = swapPickupAdditionError({ existingCount, ...file });
    if (err && !err.startsWith("This swap already")) return err;
  }
  return null;
}

/** Plate and VIN last 6. Unit number is never part of the line. */
export function swapPickupVehicleLine(v: VehicleLabelSource): string {
  return formatVehicleIdentityLine({
    license_plate: v.license_plate,
    vin: v.vin,
  });
}
