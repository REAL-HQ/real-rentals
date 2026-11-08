import { fmtDate } from "./date-format";
import { overdueAge, type LeadBucket } from "./lead-priorities";

/**
 * Compact Lead Priorities card copy. Cards stay neutral; only an overdue
 * priority uses the brand red. Meaning is always written, never color-only.
 */
export const LEAD_TONES: Record<
  LeadBucket,
  { label: string; badge: string }
> = {
  overdue: { label: "Overdue", badge: "text-brand" },
  new: { label: "New", badge: "text-muted-foreground" },
  interested: { label: "Interested", badge: "text-muted-foreground" },
  today: { label: "Due Today", badge: "text-muted-foreground" },
  information: { label: "Waiting on Info", badge: "text-muted-foreground" },
  future: { label: "Scheduled", badge: "text-muted-foreground" },
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
