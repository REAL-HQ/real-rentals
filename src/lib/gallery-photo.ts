/**
 * When a public vehicle has no published listing photo, the fleet card and
 * the vehicle page ask this route for one gallery original. The route chooses
 * the file. Callers never send a storage path.
 */
const PUBLIC_VEHICLE_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPublicVehicleId(value: string): boolean {
  return PUBLIC_VEHICLE_ID.test(value);
}

export function galleryFallbackUrl(vehicleId: string): string {
  return `/api/public/vehicle-gallery/${vehicleId}`;
}

const IMAGE_EXT = new Set(["jpg", "jpeg", "png", "webp", "gif", "avif"]);

export type GalleryCandidate = {
  kind?: string | null;
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
  is_primary?: boolean | null;
  sort_order?: number | null;
  created_at?: string | null;
};

export function listingHasPublishedPhoto(photos: unknown): boolean {
  return (
    Array.isArray(photos) &&
    photos.some((item) => typeof item === "string" && item.trim().length > 0)
  );
}

function imageExtension(path: string): string {
  return path.split(".").pop()?.toLowerCase() ?? "";
}

/** A path the gallery route is willing to read out of the private bucket. */
export function isGalleryImagePath(path: string): boolean {
  return (
    path.length > 0 &&
    path.length <= 400 &&
    !path.includes("..") &&
    !path.startsWith("/") &&
    IMAGE_EXT.has(imageExtension(path))
  );
}

/**
 * One vehicle-gallery original. Lead photo first, then the order the admin
 * gallery already uses. Retouches, other buckets, and unsafe paths are ignored.
 * `rows` must already be the originals for a single vehicle.
 */
export function pickGalleryFallback(rows: readonly GalleryCandidate[]): GalleryCandidate | null {
  const usable = rows.filter((row) => {
    if (row.kind !== "original") return false;
    if (row.storage_bucket !== "vehicle-photos") return false;
    return typeof row.storage_path === "string" && isGalleryImagePath(row.storage_path);
  });
  usable.sort((a, b) => {
    const primary = Number(b.is_primary === true) - Number(a.is_primary === true);
    if (primary !== 0) return primary;
    const order = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (order !== 0) return order;
    return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
  });
  return usable[0] ?? null;
}

export function galleryContentType(path: string, mime: string | null | undefined): string {
  const allowed: Record<string, string> = {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    avif: "image/avif",
  };
  const fromPath = allowed[imageExtension(path)];
  if (mime && Object.values(allowed).includes(mime)) return mime;
  return fromPath ?? "application/octet-stream";
}
