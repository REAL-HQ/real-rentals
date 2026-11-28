/**
 * Which of a driver's own documents the driver portal shows (Dolmar,
 * 11/27 3:07 PM and 3:08 PM ET: "Drivers should be able to see all info
 * available in their driver portals", insurance cards in both the back office
 * and the portal).
 *
 * A document on the driver's own application shows when either
 *   - staff or FLEET shared it (visibility includes "driver"), or
 *   - its category is one of the driver's own records below, even when staff
 *     or FLEET filed it team only (their licence, insurance card, gig profile,
 *     income proof, trip history, application and agreement),
 * and its category is never one of DRIVER_PORTAL_INTERNAL_CATEGORIES, which
 * stay team only whatever the row's visibility says.
 *
 * The same rule is in Postgres (private.driver_portal_document_visible in
 * supabase/migrations/20261127203000_driver_portal_documents.sql) for the
 * documents RLS policy and the storage read policy. Keep the two lists equal;
 * scripts/driver-portal-visibility.test.ts checks they match.
 */

/** The driver's own records: shown in the portal even when filed team only. */
export const DRIVER_PORTAL_CATEGORIES: readonly string[] = [
  "rental_application",
  "agreement",
  "license_front",
  "license_back",
  "insurance",
  "gig_profile",
  "income",
  "trip_history",
];

/**
 * Never shown to a driver, whatever the row's visibility says: screening and
 * background reports, broker or insurer quotes (they name the broker and
 * insurer), insurance verification call recordings, vehicle titles (ownership
 * and finance) and repair or service invoices (internal costs).
 */
export const DRIVER_PORTAL_INTERNAL_CATEGORIES: readonly string[] = [
  "screening",
  "insurance_quote",
  "verification_recording",
  "title",
  "repair_invoice",
  "service_receipt",
];

export function driverPortalShows(row: { category?: string | null; kind?: string | null; visibility?: string[] | null }): boolean {
  const category = row.category ?? "other";
  if (DRIVER_PORTAL_INTERNAL_CATEGORIES.includes(category)) return false;
  if (row.kind && DRIVER_PORTAL_INTERNAL_CATEGORIES.includes(row.kind)) return false;
  if ((row.visibility ?? []).includes("driver")) return true;
  return DRIVER_PORTAL_CATEGORIES.includes(category);
}
