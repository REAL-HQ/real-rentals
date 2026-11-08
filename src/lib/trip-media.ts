/**
 * Trip media (Pickup / Return / Issues, each Ours / Yours). Pure — no I/O.
 *
 * Originals are stored byte-for-byte and only ever signed for staff. A renter
 * is shown a "share copy": the same image with its metadata segments removed
 * (no re-encode, so the pixels are untouched). Formats we cannot strip
 * honestly (HEIC, WebP, video) get no share copy — the renter sees the entry
 * and its time, and the team plays the original.
 */

export const TRIP_PHASES = ["checkout", "checkin", "damage", "other"] as const;
export type TripPhase = (typeof TRIP_PHASES)[number];

/** What the condition-media bucket accepts (see fleet_ops_foundation). */
export const TRIP_MEDIA_TYPES: Record<string, "photo" | "video"> = {
  "image/jpeg": "photo",
  "image/png": "photo",
  "image/webp": "photo",
  "image/heic": "photo",
  "video/mp4": "video",
  "video/quicktime": "video",
};
export const TRIP_MEDIA_EXT: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  mp4: "video/mp4",
  mov: "video/quicktime",
};
export const TRIP_MEDIA_MAX_BYTES = 50 * 1024 * 1024;
export const TRIP_MEDIA_ACCEPT =
  "image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime,.jpg,.jpeg,.png,.webp,.heic,.mp4,.mov";

/** Resolve a declared type, falling back to the extension (iOS often sends "" for HEIC). */
export function tripMediaType(
  fileName: string,
  mimeType: string | null | undefined,
): string | null {
  const m = String(mimeType ?? "").toLowerCase();
  if (TRIP_MEDIA_TYPES[m]) return m;
  if (m && m !== "application/octet-stream") return null;
  const ext = (fileName.split(".").pop() ?? "").toLowerCase();
  return TRIP_MEDIA_EXT[ext] ?? null;
}

/** Storage path for a trip upload. The binding is in the path and re-checked at confirm. */
export function tripMediaPrefix(
  vehicleId: string,
  applicationId: string,
  rentalId: string | null,
): string {
  return `${vehicleId}/trip/${applicationId}/${rentalId ?? "pre"}/`;
}

export type BindingApp = { id: string; user_id: string | null; vehicle_id: string | null };
export type BindingRental = {
  id: string;
  driver_id: string;
  vehicle_id: string;
  application_id: string | null;
};

/**
 * Where a staff upload may go. A rental must belong to this applicant (by
 * application link or by the applicant's login); "pre" is only the vehicle the
 * application itself names. No guessing: no vehicle, no upload.
 */
export function resolveBinding(
  app: BindingApp,
  rental: BindingRental | null,
): { vehicleId: string; rentalId: string | null } {
  if (rental) {
    const mine =
      rental.application_id === app.id || (!!app.user_id && rental.driver_id === app.user_id);
    if (!mine) throw new Error("That trip belongs to someone else");
    return { vehicleId: rental.vehicle_id, rentalId: rental.id };
  }
  if (!app.vehicle_id) throw new Error("No vehicle on this application yet — pick a trip");
  return { vehicleId: app.vehicle_id, rentalId: null };
}

// ------------------------------------------------------------- share copies

const JPEG_STRIP = new Set([
  0xe1, 0xe2, 0xe3, 0xe4, 0xe5, 0xe6, 0xe7, 0xe8, 0xe9, 0xea, 0xeb, 0xec, 0xed, 0xef, 0xfe,
]);

/**
 * Remove every APPn segment except APP0 (JFIF) and APP14 (Adobe colour), and
 * comments. That takes EXIF (incl. GPS), XMP, IPTC, ICC and MPF out. Scan data
 * is copied untouched. Returns null if the file is not a well-formed JPEG.
 */
export function stripJpegMetadata(input: Uint8Array): Uint8Array | null {
  if (input.length < 4 || input[0] !== 0xff || input[1] !== 0xd8) return null;
  const parts: Uint8Array[] = [input.subarray(0, 2)];
  let i = 2;
  while (i + 4 <= input.length) {
    if (input[i] !== 0xff) return null;
    const marker = input[i + 1];
    if (marker === 0xda) {
      parts.push(input.subarray(i));
      return concat(parts);
    }
    const len = (input[i + 2] << 8) | input[i + 3];
    if (len < 2 || i + 2 + len > input.length) return null;
    if (!JPEG_STRIP.has(marker)) parts.push(input.subarray(i, i + 2 + len));
    i += 2 + len;
  }
  return null;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_STRIP = new Set(["eXIf", "tEXt", "iTXt", "zTXt", "tIME"]);

/** Drop eXIf and text chunks. Returns null if not a well-formed PNG. */
export function stripPngMetadata(input: Uint8Array): Uint8Array | null {
  if (input.length < 8 || PNG_SIG.some((b, k) => input[k] !== b)) return null;
  const parts: Uint8Array[] = [input.subarray(0, 8)];
  let i = 8;
  while (i + 12 <= input.length) {
    const len =
      ((input[i] << 24) | (input[i + 1] << 16) | (input[i + 2] << 8) | input[i + 3]) >>> 0;
    const type = String.fromCharCode(input[i + 4], input[i + 5], input[i + 6], input[i + 7]);
    const end = i + 12 + len;
    if (end > input.length) return null;
    if (!PNG_STRIP.has(type)) parts.push(input.subarray(i, end));
    i = end;
    if (type === "IEND") return concat(parts);
  }
  return null;
}

/** A metadata-free copy for renters, or null when the format can't be stripped safely. */
export function makeShareCopy(mime: string, bytes: Uint8Array): Uint8Array | null {
  if (mime === "image/jpeg") return stripJpegMetadata(bytes);
  if (mime === "image/png") return stripPngMetadata(bytes);
  return null;
}

export function shareCopyPath(path: string): string {
  return `${path}.share`;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}
