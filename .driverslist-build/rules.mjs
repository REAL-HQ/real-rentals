// src/lib/drivers-list.ts
var COORDINATOR_LIST_FIELDS = [
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
  "contact_status_by"
];
var SENSITIVE_LIST_FIELDS = [
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
  "resubmission_history"
];
function projectDriverRow(row, canSeeSensitive) {
  if (canSeeSensitive) return row;
  const out = {};
  for (const f of COORDINATOR_LIST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, f)) out[f] = row[f];
  }
  return out;
}
function isOperationalOnly(row) {
  return !SENSITIVE_LIST_FIELDS.some((f) => Object.prototype.hasOwnProperty.call(row, f));
}
export {
  COORDINATOR_LIST_FIELDS,
  SENSITIVE_LIST_FIELDS,
  isOperationalOnly,
  projectDriverRow
};
