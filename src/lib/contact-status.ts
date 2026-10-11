/**
 * Contact Status: where the conversation with a person stands.
 *
 * SEPARATE FROM APPLICATION STATUS, DELIBERATELY. applications.status is the
 * lifecycle of the paperwork — new, reviewing, approved, active, suspended,
 * declined, closed — and approval, activation and agreements all read it.
 * Contact Status is the dialling log: did we reach them, are they interested,
 * when are we calling back. Nothing in this file touches the other one, and
 * nothing downstream reads Contact Status to make a decision. A person can be
 * Unqualified to talk to today and still be an approved driver on paper, and
 * marking them Unresponsive declines nobody.
 *
 * Client-safe: vocabulary and rules only. Every write is checked again on the
 * server (contact-status.functions.ts).
 */

/** Stored value -> the label staff read. Title Case, one word where possible. */
export const CONTACT_STATUSES = [
  { key: "new", label: "New" },
  { key: "attempted", label: "Attempted" },
  { key: "voicemail", label: "Voicemail" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "follow_up", label: "Follow-Up" },
  { key: "documents", label: "Documents" },
  { key: "unqualified", label: "Unqualified" },
  { key: "unresponsive", label: "Unresponsive" },
] as const;

export type ContactStatusKey = (typeof CONTACT_STATUSES)[number]["key"];

export const CONTACT_STATUS_KEYS = CONTACT_STATUSES.map((s) => s.key) as ContactStatusKey[];

/**
 * Everyone starts here, including every applicant already on file: the column
 * defaults to 'new', so nobody has to be back-filled and no row reads blank.
 */
export const DEFAULT_CONTACT_STATUS: ContactStatusKey = "new";

const LABELS: Record<string, string> = Object.fromEntries(
  CONTACT_STATUSES.map((s) => [s.key, s.label]),
);

/** The label for a stored value. An unknown value is shown as itself, never blank. */
export function contactStatusLabel(raw: unknown): string {
  const k = String(raw ?? "").trim();
  if (!k) return LABELS[DEFAULT_CONTACT_STATUS];
  return LABELS[k] ?? k;
}

/** A stored value if we recognise it, else null. Used to refuse a forged status. */
export function normalizeContactStatus(raw: unknown): ContactStatusKey | null {
  const k = String(raw ?? "")
    .trim()
    .toLowerCase();
  return (CONTACT_STATUS_KEYS as string[]).includes(k) ? (k as ContactStatusKey) : null;
}

/**
 * Badge colours. Three bands, so a glance down the column reads as progress
 * rather than decoration: grey = not reached yet, blue/green = moving,
 * amber = waiting on us, muted red = parked.
 */
export const CONTACT_STATUS_TONE: Record<ContactStatusKey, string> = {
  new: "bg-[#F4F4F6] text-[#5B5B66]",
  attempted: "bg-sky-100 text-sky-800",
  voicemail: "bg-sky-100 text-sky-800",
  contacted: "bg-blue-100 text-blue-800",
  interested: "bg-emerald-100 text-emerald-800",
  follow_up: "bg-amber-100 text-amber-800",
  documents: "bg-violet-100 text-violet-800",
  unqualified: "bg-rose-100 text-rose-800",
  unresponsive: "bg-gray-200 text-gray-700",
};

export type FieldRule = "off" | "optional" | "required";

export type ContactStatusForm = {
  /** Free-text note, kept with the status change. */
  note: FieldRule;
  /** The day we said we would come back to them. */
  followUp: FieldRule;
  /** What the note is for, shown as the field's label. */
  noteLabel: string;
  /** One line under the title, so the popover explains itself. */
  hint: string;
};

/**
 * WHICH FIELDS THIS STATUS ACTUALLY NEEDS.
 *
 * The popover shows these and nothing else — a status that has no use for a
 * date does not ask for one. Two statuses require something, for the same
 * reason in both cases: the entry is worthless to the next person without it.
 *
 *   Follow-Up requires the date. "Follow up some time" is not a follow-up,
 *   and the whole point of the status is that Rosa can sort by it tomorrow.
 *
 *   Unqualified requires the reason. It is the one status that reads as a
 *   decision about the person, and six weeks later nobody remembers why.
 *   (It still changes no application status and declines nothing.)
 */
export function contactStatusForm(status: ContactStatusKey): ContactStatusForm {
  switch (status) {
    case "new":
      return {
        note: "optional",
        followUp: "off",
        noteLabel: "Note",
        hint: "Nobody has worked this lead yet.",
      };
    case "attempted":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What happened",
        hint: "Called or texted, no answer.",
      };
    case "voicemail":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What you left",
        hint: "Message left, waiting on a call back.",
      };
    case "contacted":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What was said",
        hint: "You spoke to them.",
      };
    case "interested":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What they want",
        hint: "They want a car — note the vehicle or timing.",
      };
    case "follow_up":
      return {
        note: "optional",
        followUp: "required",
        noteLabel: "Note",
        hint: "Pick the day to call them back.",
      };
    case "documents":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What is outstanding",
        hint: "Waiting on paperwork from them.",
      };
    case "unqualified":
      return {
        note: "required",
        followUp: "off",
        noteLabel: "Reason",
        hint: "Not a fit right now. This changes no application status.",
      };
    case "unresponsive":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "Note",
        hint: "Several attempts, nothing back.",
      };
  }
}

export type ContactStatusDraft = {
  status: ContactStatusKey;
  note: string;
  /** YYYY-MM-DD, or "" for none. A date, never a formatted display string. */
  followUpOn: string;
};

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export type ContactStatusBlocker = { field: "status" | "note" | "followUpOn"; why: string };

/**
 * What stops this from being saved. The SAME function runs in the popover (to
 * disable Save and say why) and on the server (to refuse), so the browser can
 * never talk the server into storing something the rules forbid.
 */
export function contactStatusBlockers(draft: {
  status: unknown;
  note?: unknown;
  followUpOn?: unknown;
}): ContactStatusBlocker[] {
  const out: ContactStatusBlocker[] = [];
  const status = normalizeContactStatus(draft.status);
  if (!status) {
    return [{ field: "status", why: "That is not a contact status." }];
  }
  const form = contactStatusForm(status);
  const note = String(draft.note ?? "").trim();
  const followUp = String(draft.followUpOn ?? "").trim();

  if (form.note === "required" && !note)
    out.push({
      field: "note",
      why: `${form.noteLabel} is needed for ${contactStatusLabel(status)}.`,
    });
  if (form.note === "off" && note)
    out.push({ field: "note", why: `${contactStatusLabel(status)} takes no note.` });
  if (note.length > 1000) out.push({ field: "note", why: "Keep the note under 1000 characters." });

  if (form.followUp === "required" && !followUp)
    out.push({
      field: "followUpOn",
      why: `A follow-up date is needed for ${contactStatusLabel(status)}.`,
    });
  if (form.followUp === "off" && followUp)
    out.push({
      field: "followUpOn",
      why: `${contactStatusLabel(status)} takes no follow-up date.`,
    });
  if (followUp && !DATE_ONLY.test(followUp))
    out.push({ field: "followUpOn", why: "Enter the follow-up date as a date." });

  return out;
}

/**
 * The fields to store, with the shape the row expects. Values a status has no
 * use for are cleared rather than left behind: a Follow-Up date that survived
 * into Unqualified would be a call nobody is going to make.
 */
export function contactStatusPatch(draft: ContactStatusDraft): {
  contact_status: ContactStatusKey;
  contact_status_note: string | null;
  contact_follow_up_on: string | null;
} {
  const form = contactStatusForm(draft.status);
  const note = String(draft.note ?? "").trim();
  const followUp = String(draft.followUpOn ?? "").trim();
  return {
    contact_status: draft.status,
    contact_status_note: form.note === "off" || !note ? null : note,
    contact_follow_up_on: form.followUp === "off" || !followUp ? null : followUp,
  };
}

/** The contact fields as they come off an applications row. */
export type ContactStatusState = {
  status: ContactStatusKey;
  note: string | null;
  followUpOn: string | null;
  /** When it was last set, and by whom — null until somebody sets it. */
  changedAt: string | null;
  changedBy: string | null;
};

/**
 * Read the contact fields off a row.
 *
 * `supported` is false when the row has no contact_status key at all, which is
 * what a database without the migration looks like. The caller says so plainly
 * instead of showing every lead as New and silently dropping saves.
 */
export function readContactStatus(row: unknown): { supported: boolean; state: ContactStatusState } {
  const r = (row ?? {}) as Record<string, unknown>;
  const supported = Object.prototype.hasOwnProperty.call(r, "contact_status");
  return {
    supported,
    state: {
      status: normalizeContactStatus(r.contact_status) ?? DEFAULT_CONTACT_STATUS,
      note: typeof r.contact_status_note === "string" ? r.contact_status_note : null,
      followUpOn: typeof r.contact_follow_up_on === "string" ? r.contact_follow_up_on : null,
      changedAt: typeof r.contact_status_at === "string" ? r.contact_status_at : null,
      changedBy: typeof r.contact_status_by === "string" ? r.contact_status_by : null,
    },
  };
}
