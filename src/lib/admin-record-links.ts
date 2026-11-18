/**
 * Back-office deep links used by staff emails. Client-safe, no imports.
 *
 * The admin route reads `tab` and `id` (src/routes/admin.tsx validateSearch).
 * Two staff emails (Signed Agreement, New Driver Lead) used
 * `/admin?driver=<id>`, which the route never read, so "Open Driver Record"
 * opened the dashboard (Dolmar, t445u). Always build the link here.
 */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `/admin?tab=drivers&id=<application id>`: opens that driver's record. */
export function driverRecordPath(applicationId: string): string {
  return `/admin?tab=drivers&id=${encodeURIComponent(applicationId)}`;
}

/** The application id from an old `?driver=<id>` link, or null. Only a UUID is accepted. */
export function legacyDriverRecordId(raw: Record<string, unknown>): string | null {
  const v = raw?.driver;
  return typeof v === "string" && UUID.test(v.trim()) ? v.trim() : null;
}
