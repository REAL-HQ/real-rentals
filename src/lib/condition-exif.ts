/**
 * Server-side EXIF read for condition photos.
 *
 * Always run on the original uploaded bytes BEFORE any canvas/re-encode step.
 * Missing EXIF is normal (iOS strips, gallery re-saves, screenshots, video).
 */
import exifr from "exifr";

export type TakenAtSource = "exif" | "upload" | "client";

export type ConditionExif = {
  takenAt: Date | null;
  takenAtSource: TakenAtSource;
  gpsLat: number | null;
  gpsLng: number | null;
  /** True when no camera datetime was found in the file. */
  missingExifTime: boolean;
};

function isFiniteCoord(n: unknown): n is number {
  return typeof n === "number" && Number.isFinite(n);
}

/**
 * Parse capture time + GPS from image bytes. Videos and non-image buffers
 * return upload fallbacks with missingExifTime=true.
 */
export async function parseConditionExif(
  bytes: ArrayBuffer | Uint8Array,
  fallback: Date = new Date(),
): Promise<ConditionExif> {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (input.byteLength < 12) {
    return {
      takenAt: fallback,
      takenAtSource: "upload",
      gpsLat: null,
      gpsLng: null,
      missingExifTime: true,
    };
  }

  try {
    const parsed = await exifr.parse(input, {
      pick: [
        "DateTimeOriginal",
        "CreateDate",
        "ModifyDate",
        "DateTime",
        "GPSLatitude",
        "GPSLongitude",
        "latitude",
        "longitude",
      ],
      translateKeys: false,
      reviveValues: true,
      gps: true,
    });

    const rawTime =
      parsed?.DateTimeOriginal ?? parsed?.CreateDate ?? parsed?.ModifyDate ?? parsed?.DateTime ?? null;
    let takenAt: Date | null = null;
    if (rawTime instanceof Date && !Number.isNaN(rawTime.getTime())) takenAt = rawTime;
    else if (typeof rawTime === "string" || typeof rawTime === "number") {
      const d = new Date(rawTime);
      if (!Number.isNaN(d.getTime())) takenAt = d;
    }

    const lat = isFiniteCoord(parsed?.latitude)
      ? parsed.latitude
      : isFiniteCoord(parsed?.GPSLatitude)
        ? parsed.GPSLatitude
        : null;
    const lng = isFiniteCoord(parsed?.longitude)
      ? parsed.longitude
      : isFiniteCoord(parsed?.GPSLongitude)
        ? parsed.GPSLongitude
        : null;

    if (takenAt) {
      return {
        takenAt,
        takenAtSource: "exif",
        gpsLat: lat,
        gpsLng: lng,
        missingExifTime: false,
      };
    }

    return {
      takenAt: fallback,
      takenAtSource: "upload",
      gpsLat: lat,
      gpsLng: lng,
      missingExifTime: true,
    };
  } catch {
    return {
      takenAt: fallback,
      takenAtSource: "upload",
      gpsLat: null,
      gpsLng: null,
      missingExifTime: true,
    };
  }
}
