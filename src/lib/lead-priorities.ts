import { contactStatusLabel } from "./contact-status";

export const LEAD_TIME_ZONE = "America/New_York";
export const LEAD_BUCKETS = [
  "overdue",
  "new",
  "interested",
  "today",
  "information",
  "future",
] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];
export const ACTIVE_LEAD_STATUSES = ["new", "reviewing", "approved"];
export const LEAD_SELECT =
  "id,full_name,phone,status,created_at,contact_status,contact_status_note,contact_follow_up_on,contact_status_at,contact_status_by";
export type LeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  status: string;
  created_at: string | null;
  contact_status: string;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
  contact_status_at: string | null;
  contact_status_by: string | null;
};
export function leadToday(now = new Date()): string {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: LEAD_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  return ["year", "month", "day"].map((k) => p.find((v) => v.type === k)!.value).join("-");
}
export function leadBucket(row: LeadRow, today: string): LeadBucket | null {
  if (!ACTIVE_LEAD_STATUSES.includes(row.status) || row.contact_status === "unqualified")
    return null;
  const due = row.contact_follow_up_on;
  if (due && due < today) return "overdue";
  if (row.contact_status === "new") return "new";
  if (row.contact_status === "interested") return "interested";
  if (due === today) return "today";
  if (row.contact_status === "documents") return "information";
  if (due && due > today) return "future";
  return null;
}
const EXPLANATIONS = {
  overdue: [
    "Urgent",
    "Follow-up is overdue",
    "Contact the applicant and record the outcome or a new follow-up date.",
  ],
  new: ["High", "Awaiting first contact", "Make first contact and record the outcome."],
  interested: [
    "High",
    "Marked Interested",
    "Confirm interest and next steps. Interest does not establish rental readiness.",
  ],
  today: [
    "Medium",
    "Follow-up is due today",
    "Contact the applicant today and record the outcome.",
  ],
  information: [
    "Medium",
    "Waiting on additional information",
    "Review the contact note and confirm which information is still needed.",
  ],
  future: [
    "Low",
    "Follow-up is scheduled",
    "Review the contact note before the scheduled follow-up.",
  ],
} as const;
export function projectLead(raw: LeadRow, bucket: LeadBucket) {
  // Explicit response projection even if the query adapter returns extra columns.
  const [priority, reason, action] = EXPLANATIONS[bucket];
  return {
    id: raw.id,
    full_name: raw.full_name,
    phone: raw.phone,
    contact_status: raw.contact_status,
    contact_status_note: raw.contact_status_note,
    contact_follow_up_on: raw.contact_follow_up_on,
    contact_status_at: raw.contact_status_at,
    contact_status_by: raw.contact_status_by,
    bucket,
    priority,
    reason,
    action,
    contactLabel: contactStatusLabel(raw.contact_status),
  };
}
export type PriorityLead = ReturnType<typeof projectLead>;
export type LeadPrioritiesResult = {
  rows: PriorityLead[];
  total: number;
  counts: { new: number; overdue: number; hot: number };
  today: string;
  offset: number;
  nextOffset: number | null;
};
