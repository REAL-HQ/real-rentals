/** Explicit presentation vocabulary for owned enums only. Unknown values and
 * customer-authored content are returned verbatim; this never changes storage. */
export const UI_ENUM_LABELS: Readonly<Record<string, string>> = {
  payment: "Payment", pass: "Pass", fail: "Fail", not_applicable: "Not Applicable", full: "Full", empty: "Empty", three_quarters: "Three Quarters", half: "Half", quarter: "Quarter",
  all: "All", active: "Active", inactive: "Inactive", archived: "Archived", available: "Available",
  onboarding: "Needs Setup", pending: "Pending", approved: "Approved", rejected: "Rejected",
  new: "New", draft: "Draft", open: "Open", closed: "Closed", cancelled: "Cancelled", canceled: "Canceled",
  prospect: "Prospect", paused: "Paused", completed: "Completed", retired: "Retired", sold: "Sold",
  in_claim: "In Claim", repairing: "Repairing", written_off: "Written Off", in_progress: "In Progress",
  accident: "Accident", damage: "Damage", theft: "Theft", vandalism: "Vandalism", breakdown: "Breakdown", tow: "Tow",
  minor: "Minor", moderate: "Moderate", major: "Major", total_loss: "Total Loss",
  unknown: "Unknown", driver: "Driver", third_party: "Third Party", none: "None", other: "Other",
  vehicle_owner: "Vehicle Owner", capital_partner: "Capital Partner", private_lender: "Private Lender", jv_partner: "JV Partner",
  rent: "Rent", deposit: "Deposit", late_fee: "Late Fee", toll: "Toll", fee: "Fee", charge: "Charge", refund: "Refund",
  paid: "Paid", unpaid: "Unpaid", not_paid: "Not Paid", partially_paid: "Partially Paid", refunded: "Refunded",
  current: "Current", late: "Late", past_due: "Past Due", collections: "Collections", processing: "Processing",
  scheduled: "Scheduled", failed: "Failed", passed: "Passed", due: "Due", overdue: "Overdue", waived: "Waived",
  routine: "Routine", safety: "Safety", compliance: "Compliance", repair: "Repair", recall: "Recall",
  pickup: "Pickup", return: "Return", pre_rental: "Pre-Rental", post_rental: "Post-Rental",
  insurance: "Insurance", registration: "Registration", title: "Title", license: "License", receipt: "Receipt", invoice: "Invoice",
  sms: "SMS", email: "Email", phone: "Phone", website: "Website", logo_url: "Logo URL",
  daily: "Daily", weekly: "Weekly", monthly: "Monthly", yearly: "Yearly", year: "Year", month: "Month", week: "Week",
  unassigned: "Unassigned", assigned: "Assigned", verified: "Verified", needs_review: "Needs Review", replacement_requested: "Replacement Requested",
  not_started: "Not Started", in_review: "In Review", documents_requested: "Documents Requested", ready: "Ready",
  yes: "Yes", no: "No", cash: "Cash", card: "Card", ach: "ACH", bank_transfer: "Bank Transfer",
};
export function enumDisplayLabel(value: string | null | undefined): string {
  return value == null ? "—" : Object.prototype.hasOwnProperty.call(UI_ENUM_LABELS, value) ? UI_ENUM_LABELS[value] : value;
}
