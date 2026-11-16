// src/lib/admin-overview.ts
var APPLICANT_WINDOW = 500;
var OVERVIEW_APPLICANT_FIELDS = [
  "id",
  "full_name",
  "status",
  "current_step",
  "created_at",
  "reviewed_at"
];
var NOTIFICATION_FIELDS = [
  "id",
  "full_name",
  "email",
  "phone",
  "created_at",
  "status"
];
var OVERVIEW_WITHHELD_FIELDS = [
  "license_photo_url",
  "insurance_doc_url",
  "profile_screenshot_url",
  "trip_screenshots",
  "license_number",
  "license_state",
  "license_expiration",
  "license_valid",
  "dob",
  "address",
  "zip",
  "city",
  "insurance_carrier",
  "insurance_policy_number",
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
  "platforms",
  "trips_completed",
  "rating",
  "years_licensed",
  "gig_status",
  "insurance_answer",
  "full_coverage_insurance",
  "insurance_rideshare_endorsement",
  "pickup_date",
  "start_timing",
  "drive_type"
];
var OVERVIEW_APPLICANT_SELECT = OVERVIEW_APPLICANT_FIELDS.join(",");
var NOTIFICATION_SELECT = NOTIFICATION_FIELDS.join(",");
var str = (v) => typeof v === "string" ? v : null;
function projectOverviewApplicant(row) {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    full_name: str(row.full_name),
    status: str(row.status),
    current_step: str(row.current_step),
    created_at: str(row.created_at),
    reviewed_at: str(row.reviewed_at)
  };
}
function projectNotification(row) {
  const id = str(row.id);
  if (!id) return null;
  return {
    id,
    full_name: str(row.full_name),
    email: str(row.email),
    phone: str(row.phone),
    created_at: str(row.created_at),
    status: str(row.status),
    type: "application"
  };
}
var PAYMENT_ALERT_TITLES = ["Payment Failed", "Weekly Rent Failed", "Payment Past Due", "Collections Plan"];
function projectPaymentAlert(row) {
  const id = str(row.id);
  const title = str(row.title);
  if (!id || !title || !PAYMENT_ALERT_TITLES.includes(title)) return null;
  return {
    id: `pay:${id}`,
    type: "payment",
    title,
    body: str(row.body),
    full_name: null,
    email: null,
    phone: null,
    created_at: str(row.created_at),
    status: null
  };
}
function mergeAdminNotifications(a, b, limit = 20) {
  return [...a, ...b].sort((x, y) => (y.created_at ?? "").localeCompare(x.created_at ?? "")).slice(0, limit);
}
function isOverviewSafe(row) {
  return !OVERVIEW_WITHHELD_FIELDS.some(
    (f) => Object.prototype.hasOwnProperty.call(row, f)
  );
}
export {
  APPLICANT_WINDOW,
  NOTIFICATION_FIELDS,
  NOTIFICATION_SELECT,
  OVERVIEW_APPLICANT_FIELDS,
  OVERVIEW_APPLICANT_SELECT,
  OVERVIEW_WITHHELD_FIELDS,
  PAYMENT_ALERT_TITLES,
  isOverviewSafe,
  mergeAdminNotifications,
  projectNotification,
  projectOverviewApplicant,
  projectPaymentAlert
};
