/**
 * Storage identity for a Fleet Inbox original shown beside a suggested field.
 *
 * Only a path inside the private vehicle-docs bucket is returned. The browser
 * signs that path with the signed-in staff session. Photographs stay on
 * photoPath and are loaded with loadStaffPhoto. Nothing here is a URL.
 */

export function isStaffVehicleDocPath(path: string | null | undefined): path is string {
  if (!path || path.length > 500) return false;
  if (path.startsWith("/") || path.includes("\\") || path.includes("..")) return false;
  if (/^https?:/i.test(path)) return false;
  return true;
}

export function vehicleDocSource(doc: {
  storage_bucket?: string | null;
  storage_path?: string | null;
  mime_type?: string | null;
} | null | undefined): { storageBucket: string | null; storagePath: string | null; mimeType: string | null } {
  const mimeType = typeof doc?.mime_type === "string" && doc.mime_type ? doc.mime_type : null;
  const path = typeof doc?.storage_path === "string" ? doc.storage_path : null;
  if (doc?.storage_bucket !== "vehicle-docs" || !isStaffVehicleDocPath(path)) {
    return { storageBucket: null, storagePath: null, mimeType };
  }
  return { storageBucket: "vehicle-docs", storagePath: path, mimeType };
}

/** 1-based page the extraction named, or the first page when it named none. */
export function sourcePageNumber(page: number | null | undefined): number {
  const n = Number(page);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(500, Math.floor(n));
}
