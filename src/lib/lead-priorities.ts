import { addCalendarDays, contactStatusLabel, contactToday, nextBusinessDay } from "./contact-status";

export const LEAD_TIME_ZONE = "America/New_York";
export const LEAD_PREVIEW_LIMIT = 6;
export const LEAD_BUCKETS = [
  "overdue",
  "new",
  "interested",
  "today",
  "information",
  "future",
  "incomplete",
] as const;
export type LeadBucket = (typeof LEAD_BUCKETS)[number];

/**
 * Overview filters. "All" keeps every open bucket. "Follow-up Due" is overdue
 * plus due today. "Interested" is contact_status=interested even when the
 * follow-up is overdue — so recent interest is not buried behind October
 * overdue rows in the All queue.
 */
export const LEAD_FILTERS = ["all", "new", "incomplete", "follow_up_due", "interested"] as const;
export type LeadFilter = (typeof LEAD_FILTERS)[number];
export const LEAD_FILTER_LABELS: Record<LeadFilter, string> = {
  all: "All",
  new: "New",
  incomplete: "Incomplete",
  follow_up_due: "Follow-Up Due",
  interested: "Interested",
};

/**
 * Page order for the All filter. New and Interested surface before the overdue
 * backlog so a fresh interested lead is not stuck behind months-old due dates.
 * Urgent overdue work remains one tap away on Follow-up Due.
 */
export const LEAD_ALL_PAGE_ORDER: LeadBucket[] = [
  "new",
  "incomplete",
  "interested",
  "overdue",
  "today",
  "information",
  "future",
];

export const ACTIVE_LEAD_STATUSES = ["new", "reviewing", "approved"];
export const LEAD_SELECT =
  "id,full_name,phone,email,status,created_at,contact_status,contact_status_note,contact_follow_up_on,contact_status_at,contact_status_by,contacted_at";
export type LeadRow = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email?: string | null;
  status: string;
  created_at: string | null;
  contact_status: string;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
  contact_status_at: string | null;
  contact_status_by: string | null;
  /** Staff "Mark Contacted", or a two-way exchange. Optional on older rows. */
  contacted_at?: string | null;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Eastern calendar day for a date-only value or a timestamp. */
export function contactCalendarDay(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  if (DATE_ONLY.test(trimmed)) return trimmed;
  const parsed = new Date(trimmed);
  if (Number.isNaN(parsed.getTime())) return null;
  return contactToday(parsed);
}

/** Later of contacted_at and the contact-status timestamp, as a calendar day. */
export function lastContactDay(row: {
  contacted_at?: string | null;
  contact_status_at?: string | null;
}): string | null {
  const days = [contactCalendarDay(row.contacted_at), contactCalendarDay(row.contact_status_at)].filter(
    (day): day is string => !!day,
  );
  if (!days.length) return null;
  return days.sort()[days.length - 1];
}

/**
 * Date used for the queue and the "Nd overdue" count.
 * A follow-up earlier than the last contact is stale: the clock starts again
 * the next business day after that contact. A follow-up on or after the last
 * contact stays as stored, including when that day is already past.
 */
export function effectiveFollowUpOn(row: {
  contact_follow_up_on?: string | null;
  contacted_at?: string | null;
  contact_status_at?: string | null;
}): string | null {
  const due = contactCalendarDay(row.contact_follow_up_on);
  if (!due) return null;
  const contact = lastContactDay(row);
  if (contact && due < contact) return nextBusinessDay(contact);
  return due;
}
export function leadToday(now = new Date()): string {
  return contactToday(now);
}
/** Follow-ups due on this day are one day past and still inside the grace window. */
export function overdueCutoff(today: string): string {
  return addCalendarDays(today, -1);
}
/** Calendar-day age; inputs are date-only values in the dashboard's Eastern calendar. */
export function overdueAge(due: string, today: string): string | null {
  const days = (Date.parse(today + "T00:00:00Z") - Date.parse(due + "T00:00:00Z")) / 86400000;
  return Number.isInteger(days) && days > 0
    ? `${days} ${days === 1 ? "day" : "days"} overdue`
    : null;
}
export function leadBucket(row: LeadRow, today: string): LeadBucket | null {
  if (row.contact_status === "unqualified" || row.contact_status === "declined") return null;
  if (row.status === "partial") return "incomplete";
  if (!ACTIVE_LEAD_STATUSES.includes(row.status)) return null;
  const due = effectiveFollowUpOn(row);
  const grace = overdueCutoff(today);
  if (due && due < grace) return "overdue";
  if (row.contact_status === "new") return "new";
  if (row.contact_status === "interested") return "interested";
  if (due === today || due === grace) return "today";
  if (row.contact_status === "documents") return "information";
  if (due && due > today) return "future";
  return null;
}

/** Buckets included for a filter. Interested is handled as a status query. */
export function leadFilterBuckets(filter: LeadFilter): LeadBucket[] {
  if (filter === "all") return [...LEAD_ALL_PAGE_ORDER];
  if (filter === "new") return ["new"];
  if (filter === "incomplete") return ["incomplete"];
  if (filter === "follow_up_due") return ["overdue", "today"];
  return ["interested"];
}

/** Newest-first for pipeline buckets. Overdue is newest due date first so recent work leads. */
export function leadBucketSort(bucket: LeadBucket): {
  primary: "contact_follow_up_on" | "created_at" | "contact_status_at";
  ascending: boolean;
} {
  if (bucket === "overdue") return { primary: "contact_follow_up_on", ascending: false };
  if (bucket === "today" || bucket === "future") {
    return { primary: "contact_follow_up_on", ascending: true };
  }
  if (bucket === "interested") {
    return { primary: "contact_status_at", ascending: false };
  }
  return { primary: "created_at", ascending: false };
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
  incomplete: [
    "High",
    "Application is incomplete",
    "Ask them to finish the application.",
  ],
} as const;
export function projectLead(raw: LeadRow, bucket: LeadBucket) {
  // Explicit response projection even if the query adapter returns extra columns.
  const [priority, reason, action] = EXPLANATIONS[bucket];
  return {
    id: raw.id,
    full_name: raw.full_name,
    phone: raw.phone,
    email: raw.email ?? null,
    created_at: raw.created_at,
    contact_status: raw.contact_status,
    contact_status_note: raw.contact_status_note,
    contact_follow_up_on: raw.contact_follow_up_on,
    contacted_at: raw.contacted_at ?? null,
    /** Follow-up the queue and the overdue count use. The stored date stays above. */
    effective_follow_up_on: effectiveFollowUpOn(raw),
    contact_status_at: raw.contact_status_at,
    contact_status_by: raw.contact_status_by,
    bucket,
    priority,
    reason,
    action,
    contactLabel: contactStatusLabel(raw.contact_status),
    /** Past bounce/complaint, typo or test domain (email-suppression.ts). Set by the server function. */
    email_bad: false as boolean,
  };
}
export type PriorityLead = ReturnType<typeof projectLead>;
export type LeadPrioritiesResult = {
  rows: PriorityLead[];
  total: number;
  counts: { new: number; overdue: number; hot: number; incomplete: number };
  today: string;
  offset: number;
  nextOffset: number | null;
  filter: LeadFilter;
};
