/**
 * Dark gate for a staff-only follow-up draft on Lead Priorities.
 *
 * false: nothing is loaded and nothing is rendered.
 * true: a staff member can open a suggested wording for an overdue or
 * due-today follow-up. This module never sends email or SMS. A person
 * still sends from Messages, where consent is checked.
 *
 * No environment variable can open it. Activation is changing this
 * constant and rebuilding. Leave it false.
 *
 * Typed as boolean so the enabled branch stays visible to the type checker.
 * Declared once in this file.
 */
import { LEAD_SELECT, leadBucket, leadToday, type LeadRow } from "@/lib/lead-priorities";

export const LEAD_FOLLOWUPS_ENABLED: boolean = false;

export function assertLeadFollowupsEnabled(): void {
  if (LEAD_FOLLOWUPS_ENABLED !== true) {
    throw new Error("Lead follow-up is not enabled.");
  }
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function utcDate(iso: string): Date | null {
  const match = DATE_ONLY.exec(iso);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return date;
}

export type LeadFollowUpDraft = {
  applicationId: string;
  bucket: "overdue" | "today";
  followUpOn: string;
  label: string;
  subject: string;
  body: string;
};

export type LeadFollowUpResult =
  | { ok: true; draft: LeadFollowUpDraft }
  | { ok: false; skipped: "flag" | "missing" | "not-due" };

function greetingName(fullName: string | null): string {
  const first = (fullName ?? "").replace(/[\u0000-\u001f]+/g, " ").trim().split(/\s+/)[0] ?? "";
  if (!first || first.length > 40) return "there";
  return first;
}

/** Calendar label for a date-only follow-up. UTC keeps the Eastern calendar day. */
export function followUpDateLabel(iso: string): string {
  const date = utcDate(iso);
  if (!date) return "";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

/**
 * Suggested wording for a follow-up that is already due. New and Interested
 * leads stay on their own Lead Priorities actions. A future date, a missing
 * date, and any status leadBucket ignores return null. Staff notes are not
 * copied into the draft.
 */
export function leadFollowUpDraft(row: LeadRow, today: string): LeadFollowUpDraft | null {
  if (!utcDate(today)) return null;
  const due = row.contact_follow_up_on;
  if (!due || !utcDate(due)) return null;
  const bucket = leadBucket(row, today);
  if (bucket !== "overdue" && bucket !== "today") return null;
  const name = greetingName(row.full_name);
  const label = bucket === "overdue" ? "Overdue Follow-Up" : "Due Today";
  const subject = bucket === "overdue" ? "Following Up On Your Application" : "Checking In On Your Application";
  const body = `Hi ${name}, this is REAL RENTALS. We are checking in about your application. Reply to this message or call us when you have a minute.`;
  return { applicationId: row.id, bucket, followUpOn: due, label, subject, body };
}

/**
 * Read one application and build a draft. The flag is the constant above.
 * There is no parameter that can turn the read on. A false flag returns
 * before the query.
 */
export async function loadLeadFollowUp(
  admin: { from: (table: string) => { select: (columns: string) => any } },
  applicationId: string,
  now = new Date(),
): Promise<LeadFollowUpResult> {
  if (LEAD_FOLLOWUPS_ENABLED !== true) return { ok: false, skipped: "flag" };
  const today = leadToday(now);
  const { data, error } = await admin
    .from("applications")
    .select(LEAD_SELECT)
    .eq("id", applicationId)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return { ok: false, skipped: "missing" };
  const draft = leadFollowUpDraft(data, today);
  if (!draft) return { ok: false, skipped: "not-due" };
  return { ok: true, draft };
}
