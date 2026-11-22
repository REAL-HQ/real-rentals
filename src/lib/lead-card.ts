import { fmtDate } from "./date-format";
import { overdueAge, LEAD_TIME_ZONE, type LeadBucket } from "./lead-priorities";
import { THRESHOLDS, type ReadinessState } from "./readiness";

/**
 * Compact Lead Priorities card copy. Applicant cards stay neutral; overdue
 * and High priorities use red. Meaning is always written, never color-only.
 */
export const LEAD_TONES: Record<LeadBucket, { label: string; badge: string }> = {
  overdue: { label: "Overdue", badge: "text-brand" },
  new: { label: "New", badge: "text-muted-foreground" },
  interested: { label: "Interested", badge: "text-muted-foreground" },
  today: { label: "Due Today", badge: "text-muted-foreground" },
  information: { label: "Waiting on Info", badge: "text-muted-foreground" },
  future: { label: "Scheduled", badge: "text-muted-foreground" },
};

/** One short, actionable next step per bucket. Title Case in the string. */
export const LEAD_NEXT_STEP: Record<LeadBucket, string> = {
  overdue: "Follow Up And Log The Outcome",
  new: "Make First Contact",
  interested: "Confirm Next Steps",
  today: "Follow Up Today",
  information: "Check What Info Is Missing",
  future: "Review Note Before Follow-Up",
};

function relDays(iso: string): string | null {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const days = Math.floor(
    (new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime() -
      new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()) /
      86_400_000,
  );
  return days <= 0 ? "Today" : days === 1 ? "Yesterday" : `${days}d ago`;
}

/**
 * Key timing only, at most two items: the due date when one exists (else when
 * they applied), then last contact (or "No contact logged" past the New stage).
 */
export function leadTiming(
  lead: {
    bucket: LeadBucket;
    created_at: string | null;
    contact_status_at: string | null;
    contact_follow_up_on: string | null;
  },
  today: string,
): string[] {
  const out: string[] = [];
  if (lead.contact_follow_up_on) {
    const age = lead.bucket === "overdue" ? overdueAge(lead.contact_follow_up_on, today) : null;
    out.push(
      age
        ? `Due ${fmtDate(lead.contact_follow_up_on)} (${age})`
        : `Due ${fmtDate(lead.contact_follow_up_on)}`,
    );
  } else {
    const applied = lead.created_at ? relDays(lead.created_at) : null;
    out.push(applied ? `Applied ${applied}` : "Applied date unknown");
  }
  const contacted = lead.contact_status_at ? relDays(lead.contact_status_at) : null;
  if (contacted) out.push(`Last contact ${contacted}`);
  else if (lead.bucket !== "new") out.push("No contact logged");
  return out;
}

/**
 * Badge text. The stage (queue bucket) and the editable Contact Status are
 * different fields; when they read the same (New / New, Interested /
 * Interested) the stage word is dropped so the card does not say it twice.
 * Where they differ (Overdue while Contacted), both stay visible.
 */
export function leadBadgeLabel(bucket: LeadBucket, contactLabel: string, priority: string): string {
  const stage = LEAD_TONES[bucket].label;
  return stage.toLowerCase() === contactLabel.trim().toLowerCase()
    ? priority
    : `${stage} · ${priority}`;
}

/**
 * Avatar color follows the existing readiness headline. No new score.
 *
 * - decision_ready and promising_more_info → Promising (pastel green). Decision Ready
 *   already cleared the promising qualification bar and the higher decision
 *   coverage bar, so it uses the same green.
 * - more_info_needed, qualification at least PROMISING_QUALIFICATION (75), and
 *   coverage under PROMISING_COVERAGE (20) → Close To Promising (pastel yellow).
 *   classify leaves this as More Info Needed because the sample is too thin
 *   to call Promising. Those two thresholds already exist.
 * - needs_attention → Bad Lead (pastel red).
 * - other more_info_needed → Needs Info (white, light gray border).
 * - no readiness result (a Coordinator is not sent one) → pastel gray.
 * Initials stay dark on every pastel so they remain readable.
 */
export type LeadAvatarQuality = "promising" | "close" | "bad" | "needs_info" | "neutral";

const LEAD_AVATAR_INK = "text-[#111114]";
export const LEAD_AVATAR_CLASS: Record<LeadAvatarQuality, string> = {
  promising: `bg-[#CDEFD6] ${LEAD_AVATAR_INK}`,
  close: `bg-[#FFF1B8] ${LEAD_AVATAR_INK}`,
  bad: `bg-[#F9D0CC] ${LEAD_AVATAR_INK}`,
  needs_info: `border border-[#D0D1D7] bg-white ${LEAD_AVATAR_INK}`,
  neutral: `bg-[#ECEDF1] ${LEAD_AVATAR_INK}`,
};

export function leadAvatarQuality(
  readiness:
    | { state: ReadinessState; qualification: number | null; coverage: number }
    | null
    | undefined,
): LeadAvatarQuality {
  if (!readiness) return "neutral";
  if (readiness.state === "needs_attention") return "bad";
  if (readiness.state === "promising_more_info" || readiness.state === "decision_ready")
    return "promising";
  if (
    readiness.state === "more_info_needed" &&
    readiness.qualification != null &&
    readiness.qualification >= THRESHOLDS.PROMISING_QUALIFICATION &&
    readiness.coverage < THRESHOLDS.PROMISING_COVERAGE
  ) {
    return "close";
  }
  if (readiness.state === "more_info_needed") return "needs_info";
  return "neutral";
}

/**
 * Overdue and "due today" already say what to do. Repeating the stock next
 * step under the name is the line that made the card feel busy.
 */
const QUIET_NEXT = new Set<LeadBucket>(["overdue", "today"]);
export function leadVisibleNextStep(bucket: LeadBucket): string | null {
  if (QUIET_NEXT.has(bucket)) return null;
  return LEAD_NEXT_STEP[bucket];
}

function overdueDays(due: string, today: string): number | null {
  const days = (Date.parse(`${today}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`)) / 86400000;
  return Number.isInteger(days) && days > 0 ? days : null;
}

/**
 * One urgency mark. Overdue is the short "39d overdue" form; the full date
 * stays on the title so the card does not also print the red sentence.
 */
export function leadUrgency(
  lead: { bucket: LeadBucket; contact_follow_up_on: string | null },
  today: string,
): { label: string; title: string; prominent: boolean } | null {
  const due = lead.contact_follow_up_on;
  if (lead.bucket === "overdue") {
    const days = due ? overdueDays(due, today) : null;
    const age = due ? overdueAge(due, today) : null;
    return {
      label: days != null ? `${days}d overdue` : "Overdue",
      title: due && age ? `Due ${fmtDate(due)} (${age})` : "Overdue",
      prominent: true,
    };
  }
  if (!due) return null;
  if (due === today) return { label: "Due Today", title: `Due ${fmtDate(due)}`, prominent: false };
  if (due > today) {
    const full = fmtDate(due);
    return { label: `Due ${full.replace(/, \d{4}$/, "")}`, title: `Due ${full}`, prominent: false };
  }
  return null;
}

const ET_STAMP = new Intl.DateTimeFormat("en-US", {
  timeZone: LEAD_TIME_ZONE,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});
const ET_YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: LEAD_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

function etYmd(date: Date): string {
  const p: Record<string, string> = {};
  for (const part of ET_YMD.formatToParts(date)) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

/** Weekday, date and clock in America/New_York. Long: "Sun Nov 22, 10:42 AM". Short: "Sun 11/22, 10:42 AM". */
export function leadEventStamp(iso: string): { long: string; short: string; ymd: string } | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const p: Record<string, string> = {};
  for (const part of ET_STAMP.formatToParts(date))
    if (part.type !== "literal") p[part.type] = part.value;
  const ymd = etYmd(date);
  const monthNum = String(Number(ymd.slice(5, 7)));
  const dayNum = String(Number(ymd.slice(8, 10)));
  const period = /am/i.test(p.dayPeriod) ? "AM" : "PM";
  const clock = `${p.hour}:${p.minute} ${period}`;
  return {
    long: `${p.weekday} ${p.month} ${p.day}, ${clock}`,
    short: `${p.weekday} ${monthNum}/${dayNum}, ${clock}`,
    ymd,
  };
}

export type LeadActivity = {
  /** Title Case phrase. No timestamp of its own. */
  label: string;
  /** Set only when the event has a real timestamp. */
  when: { long: string; short: string } | null;
};

/**
 * The one activity line under a lead card. Last contact wins when it has a
 * timestamp; a new lead with no contact shows when they applied. No timestamp
 * at all keeps the phrase by itself.
 */
export function leadActivity(
  lead: { bucket: LeadBucket; created_at: string | null; contact_status_at: string | null },
  now = new Date(),
): LeadActivity {
  const today = etYmd(now);
  const contacted = lead.contact_status_at ? leadEventStamp(lead.contact_status_at) : null;
  if (contacted) {
    return {
      label: contacted.ymd === today ? "Last Contact Today" : "Last Contact",
      when: { long: contacted.long, short: contacted.short },
    };
  }
  if (lead.bucket === "new") {
    const applied = lead.created_at ? leadEventStamp(lead.created_at) : null;
    if (!applied) return { label: "Applied Date Unknown", when: null };
    return {
      label: applied.ymd === today ? "Applied Today" : "Applied",
      when: { long: applied.long, short: applied.short },
    };
  }
  return { label: "No Contact Logged", when: null };
}

/** Full activity line, long date. The card also keeps a shorter date for narrow widths. */
export function leadContactMeta(
  lead: { bucket: LeadBucket; created_at: string | null; contact_status_at: string | null },
  now = new Date(),
): string {
  const activity = leadActivity(lead, now);
  return activity.when ? `${activity.label} · ${activity.when.long}` : activity.label;
}
