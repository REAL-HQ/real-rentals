/**
 * What a Coordinator may see of an applications row in the Drivers list.
 *
 * The list has always read `applications` straight from the browser with
 * select("*") under RLS. Security migration 0031 removes a Coordinator's
 * direct read of that table — correctly: the row carries the licence number
 * and expiry, the date of birth, the home address, the card digits and the
 * insurance policy, and a list query handed all of it to anybody with a
 * back-office session.
 *
 * So the read moves to the server, and what comes back is decided THERE by
 * tier. This file is the field policy, kept pure and client-safe so the panel
 * and the server function cannot disagree about it.
 *
 * It is a field policy, not a second driver record: the row is the same
 * applications row, read once, with the fields a Coordinator has no business
 * seeing ABSENT from the answer — not blanked, not hidden in CSS.
 */

/**
 * Everything a Coordinator needs to work a lead and set a Contact Status,
 * and nothing else.
 *
 * Adding a field here is a security decision. The test asserts the sensitive
 * list stays out, so a careless addition fails rather than ships.
 */
export const COORDINATOR_LIST_FIELDS = [
  "id",
  // Who to call, and how.
  "full_name",
  "phone",
  "email",
  "city",
  "state",
  // Where the paperwork stands — the label the list already shows. A
  // lifecycle status is not identity data.
  "status",
  // When it arrived, and whether anybody has reached them yet.
  "created_at",
  "contacted_at",
  // Grouping: the duplicate badge and the collapsed history rows.
  "primary_application_id",
  "resubmission_count",
  "deleted_at",
  // Which car they are being considered for. An id, not a document.
  "vehicle_id",
  // The marketing source chip.
  "gclid",
  "utm_campaign",
  // Contact Status itself, which is the whole point of the screen.
  "contact_status",
  "contact_status_note",
  "contact_follow_up_on",
  "contact_status_at",
  "contact_status_by",
] as const;

export type CoordinatorListField = (typeof COORDINATOR_LIST_FIELDS)[number];

/**
 * Fields that must NEVER reach a Coordinator through this list.
 *
 * Not the inverse of the allow-list — the allow-list already decides that.
 * This is the named set the tests assert on, so that "we removed a field from
 * the allow-list" and "this specific identity field is gone" are two
 * different, independently checked statements.
 */
export const SENSITIVE_LIST_FIELDS = [
  "license_number",
  "license_state",
  "license_expiration",
  "license_photo_url",
  "license_valid",
  "dob",
  "address",
  "zip",
  "insurance_carrier",
  "insurance_policy_number",
  "insurance_doc_url",
  "profile_screenshot_url",
  "trip_screenshots",
  "card_brand",
  "card_last4",
  "card_exp_month",
  "card_exp_year",
  "stripe_customer_id",
  "stripe_payment_method_id",
  "deposit_amount",
  "deposit_paid",
  "weekly_rent",
  "notes",
  "ai_summary",
  "ai_flags",
  "ai_score",
  "score",
  "user_id",
  "requested_docs",
  "resubmission_history",
] as const;

/**
 * A row as it leaves the server: the whole thing, or the operational slice.
 *
 * Typed as JSON rather than `unknown` because it crosses the server-function
 * boundary, and the framework refuses to serialise a value it cannot see the
 * shape of. applications carries jsonb and text[] columns, so the type is
 * recursive rather than a flat scalar map.
 */
export type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
export type DriverListRow = Record<string, Json>;

/**
 * Cut a row down to the operational fields.
 *
 * Absent keys, not nulls: a null says "we have no licence number on file",
 * which is a different and wrong statement. A missing key says nothing at
 * all, which is the truth about what this caller was told.
 */
export function projectDriverRow(row: DriverListRow, canSeeSensitive: boolean): DriverListRow {
  if (canSeeSensitive) return row;
  const out: DriverListRow = {};
  for (const f of COORDINATOR_LIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
  }
  return out;
}

/** True when a row carries nothing from the sensitive set. Used by the tests. */
export function isOperationalOnly(row: DriverListRow): boolean {
  return !SENSITIVE_LIST_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(row, f as string));
}
