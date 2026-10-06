import { supabase } from "@/integrations/supabase/client";

/**
 * Resolve a stored listing-photo reference into a displayable URL.
 * - http(s):// URLs and absolute paths (starting with /) are returned as-is
 * - Anything else is a path inside the PRIVATE `vehicle-photos` bucket. It is
 *   served same-origin by /api/public/vehicle-photos/*, which only returns
 *   files a vehicle_media row marks as published. Use for vehicles.photos.
 *   Unpublished media (staff gallery) must use loadStaffPhoto instead.
 */
export function resolvePhotoUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("/")) {
    return value;
  }
  return `/api/public/vehicle-photos/${value.split("/").map(encodeURIComponent).join("/")}`;
}

const staffCache = new Map<string, Promise<string | null>>();

/**
 * Staff-only: download any vehicle-photos file (published or not) as bytes.
 * Storage policies allow this only for staff; others get null.
 */
export function loadStaffPhoto(path: string): Promise<string | null> {
  if (!staffCache.has(path)) {
    staffCache.set(
      path,
      supabase.storage
        .from("vehicle-photos")
        .download(path)
        .then(({ data }) => (data ? URL.createObjectURL(data) : null))
        .catch(() => null),
    );
  }
  return staffCache.get(path)!;
}
