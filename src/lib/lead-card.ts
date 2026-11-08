import { fmtDate } from "./date-format";
import { overdueAge, type LeadBucket } from "./lead-priorities";

/**
 * Compact Lead Priorities card copy and solid semantic colors (no gradients).
 * Every tone pairs color with a text label so meaning never relies on color.
 */
export const LEAD_TONES: Record<
  LeadBucket,
  { key: string; label: string; accent: string; badge: string }
> = {
  overdue: { key: "red", label: "Overdue", accent: "border-l-red-600", badge: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200" },
  new: { key: "blue", label: "New", accent: "border-l-blue-600", badge: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200" },
  interested: { key: "green", label: "Interested", accent: "border-l-emerald-600", badge: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" },
  today: { key: "amber", label: "Due Today", accent: "border-l-amber-500", badge: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  information: { key: "violet", label: "Waiting on Info", accent: "border-l-violet-600", badge: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200" },
  future: { key: "slate", label: "Scheduled", accent: "border-l-slate-400", badge: "bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-200" },
};

/** One short, actionable next step per bucket. */
export const LEAD_NEXT_STEP: Record<LeadBucket, string> = {
  overdue: "Follow up and log the outcome",
  new: "Make first contact",
  interested: "Confirm next steps",
  today: "Follow up today",
  information: "Check what info is missing",
  future: "Review note before follow-up",
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
    out.push(age ? `Due ${fmtDate(lead.contact_follow_up_on)} (${age})` : `Due ${fmtDate(lead.contact_follow_up_on)}`);
  }
  else {
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
  return stage.toLowerCase() === contactLabel.trim().toLowerCase() ? priority : `${stage} · ${priority}`;
}
