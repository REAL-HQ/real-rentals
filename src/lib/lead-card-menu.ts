/**
 * Lead card ⋮ menu: which options a Lead Priorities card offers, and the exact
 * Contact Status writes behind the quick actions.
 *
 * Client-safe and pure. Every write still goes through an existing server
 * function that re-checks the caller:
 *   - Not Interested / Not A Fit / Follow-Up dates -> setContactStatus (staff;
 *     re-runs contactStatusBlockers, audits before/after). Contact Status is a
 *     dialling log: none of these change applications.status or decline anyone.
 *   - Delete Lead -> deleteDriver (Owner; soft_delete_application, recoverable
 *     from Recently Deleted, Undo calls restore_application). Nothing is
 *     hard-deleted, so documents, messages, waitlist, screenings, FLEET and
 *     RentID records all stay attached to the row.
 *
 * Deliberately NOT offered (no clean backing data/action today):
 *   - Change Priority: priority is derived from the bucket, not stored.
 *   - Assign To: applications has no assignee column.
 *   - Mark As Duplicate: duplicates are linked only by the bulk phone/email
 *     merge on the Drivers list; there is no one-row "duplicate of" action.
 *   - Change Status: already one click away on the card's status badge.
 *   - Status quick actions on a New lead: any Contact Status other than New
 *     counts as first contact in the driver lifecycle (driver-lifecycle.ts),
 *     so a one-click Follow-Up / Not Interested / Not A Fit on someone nobody
 *     has reached would put a false Contacted checkmark on them. New leads get
 *     the contact and delete options; the first real status goes through the
 *     status badge after the call or text.
 */
import {
  contactStatusBlockers,
  contactStatusForm,
  normalizeContactStatus,
  type ContactStatusDraft,
  type ContactStatusKey,
} from "./contact-status";
import type { StaffTier } from "./roles";

export type LeadMenuLead = {
  id: string;
  full_name: string | null;
  phone: string | null;
  email?: string | null;
  contact_status: string;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
};

export type LeadMenuAction =
  | "open"
  | "copy_phone"
  | "copy_email"
  | "follow_up"
  | "not_interested"
  | "not_a_fit"
  | "delete";

export const LEAD_MENU_LABELS: Record<LeadMenuAction, string> = {
  open: "Open Applicant",
  copy_phone: "Copy Phone",
  copy_email: "Copy Email",
  follow_up: "Set Follow-Up",
  not_interested: "Mark Not Interested",
  not_a_fit: "Mark Not A Fit…",
  delete: "Delete Lead…",
};

/** Quick follow-up presets, in calendar days from today (Eastern). */
export const LEAD_FOLLOW_UP_PRESETS = [
  { days: 1, label: "Tomorrow" },
  { days: 3, label: "In 3 Days" },
  { days: 7, label: "In 1 Week" },
  { days: 14, label: "In 2 Weeks" },
] as const;

/**
 * Menu groups, top to bottom. Delete is always last, alone after a divider,
 * and only for the Owner — the deletion database functions refuse anyone else.
 */
export function leadMenuGroups(
  lead: Pick<LeadMenuLead, "phone" | "email" | "contact_status">,
  tier: StaffTier | null,
): LeadMenuAction[][] {
  if (!tier) return [];
  const contact: LeadMenuAction[] = ["open"];
  if (lead.phone && lead.phone.trim()) contact.push("copy_phone");
  if (lead.email && lead.email.trim()) contact.push("copy_email");
  const groups: LeadMenuAction[][] = [contact];
  const status = normalizeContactStatus(lead.contact_status) ?? "new";
  if (status !== "new") groups.push(["follow_up", "not_interested", "not_a_fit"]);
  if (tier === "owner") groups.push(["delete"]);
  return groups;
}

/** YYYY-MM-DD plus n calendar days, date-only (no time zone drift). */
export function addDaysIso(today: string, days: number): string {
  const d = new Date(`${today}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function currentStatus(lead: LeadMenuLead): ContactStatusKey {
  return normalizeContactStatus(lead.contact_status) ?? "new";
}

/**
 * Follow-up date. Keeps the current status when that status carries a date
 * (Contacted, Interested, Documents…) so the conversation log is not
 * rewritten; a status with no date field (New) becomes Follow-Up. The stored
 * note is always sent back so a quick action never clears it.
 */
export function followUpDraft(lead: LeadMenuLead, today: string, days: number): ContactStatusDraft {
  const status = currentStatus(lead);
  const keep = contactStatusForm(status).followUp !== "off";
  return {
    status: keep ? status : "follow_up",
    note: lead.contact_status_note ?? "",
    followUpOn: addDaysIso(today, days),
  };
}

/** Declined ("They declined"), keeping the note. Drops off Lead Priorities. */
export function notInterestedDraft(lead: LeadMenuLead): ContactStatusDraft {
  return { status: "declined", note: lead.contact_status_note ?? "", followUpOn: "" };
}

/** Unqualified needs a written reason (same rule the status popover enforces). */
export function notAFitDraft(reason: string): ContactStatusDraft {
  return { status: "unqualified", note: reason.trim(), followUpOn: "" };
}

/** The values to put back on Undo: exactly what the card showed before. */
export function undoDraft(lead: LeadMenuLead): ContactStatusDraft {
  return {
    status: currentStatus(lead),
    note: lead.contact_status_note ?? "",
    followUpOn: lead.contact_follow_up_on ?? "",
  };
}

/** Same validation the server re-runs; empty means the draft can be saved. */
export function leadDraftProblems(draft: ContactStatusDraft, today?: string): string[] {
  return contactStatusBlockers(draft, { today }).map((b) => b.why);
}

export function leadDisplayName(name: string | null | undefined): string {
  const n = String(name ?? "").trim();
  return n || "Unnamed Applicant";
}
