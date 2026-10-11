// src/lib/contact-status.ts
var CONTACT_STATUSES = [
  { key: "new", label: "New" },
  { key: "attempted", label: "Attempted" },
  { key: "voicemail", label: "Voicemail" },
  { key: "contacted", label: "Contacted" },
  { key: "interested", label: "Interested" },
  { key: "follow_up", label: "Follow-Up" },
  { key: "documents", label: "Documents" },
  { key: "unqualified", label: "Unqualified" },
  { key: "unresponsive", label: "Unresponsive" }
];
var CONTACT_STATUS_KEYS = CONTACT_STATUSES.map((s) => s.key);
var DEFAULT_CONTACT_STATUS = "new";
var LABELS = Object.fromEntries(
  CONTACT_STATUSES.map((s) => [s.key, s.label])
);
function contactStatusLabel(raw) {
  const k = String(raw ?? "").trim();
  if (!k) return LABELS[DEFAULT_CONTACT_STATUS];
  return LABELS[k] ?? k;
}
function normalizeContactStatus(raw) {
  const k = String(raw ?? "").trim().toLowerCase();
  return CONTACT_STATUS_KEYS.includes(k) ? k : null;
}
var CONTACT_STATUS_TONE = {
  new: "bg-[#F4F4F6] text-[#5B5B66]",
  attempted: "bg-sky-100 text-sky-800",
  voicemail: "bg-sky-100 text-sky-800",
  contacted: "bg-blue-100 text-blue-800",
  interested: "bg-emerald-100 text-emerald-800",
  follow_up: "bg-amber-100 text-amber-800",
  documents: "bg-violet-100 text-violet-800",
  unqualified: "bg-rose-100 text-rose-800",
  unresponsive: "bg-gray-200 text-gray-700"
};
function contactStatusForm(status) {
  switch (status) {
    case "new":
      return {
        note: "optional",
        followUp: "off",
        noteLabel: "Note",
        hint: "Nobody has worked this lead yet."
      };
    case "attempted":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What happened",
        hint: "Called or texted, no answer."
      };
    case "voicemail":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What you left",
        hint: "Message left, waiting on a call back."
      };
    case "contacted":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What was said",
        hint: "You spoke to them."
      };
    case "interested":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What they want",
        hint: "They want a car \u2014 note the vehicle or timing."
      };
    case "follow_up":
      return {
        note: "optional",
        followUp: "required",
        noteLabel: "Note",
        hint: "Pick the day to call them back."
      };
    case "documents":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "What is outstanding",
        hint: "Waiting on paperwork from them."
      };
    case "unqualified":
      return {
        note: "required",
        followUp: "off",
        noteLabel: "Reason",
        hint: "Not a fit right now. This changes no application status."
      };
    case "unresponsive":
      return {
        note: "optional",
        followUp: "optional",
        noteLabel: "Note",
        hint: "Several attempts, nothing back."
      };
  }
}
var DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;
function contactStatusBlockers(draft) {
  const out = [];
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
      why: `${form.noteLabel} is needed for ${contactStatusLabel(status)}.`
    });
  if (form.note === "off" && note)
    out.push({ field: "note", why: `${contactStatusLabel(status)} takes no note.` });
  if (note.length > 1e3) out.push({ field: "note", why: "Keep the note under 1000 characters." });
  if (form.followUp === "required" && !followUp)
    out.push({
      field: "followUpOn",
      why: `A follow-up date is needed for ${contactStatusLabel(status)}.`
    });
  if (form.followUp === "off" && followUp)
    out.push({
      field: "followUpOn",
      why: `${contactStatusLabel(status)} takes no follow-up date.`
    });
  if (followUp && !DATE_ONLY.test(followUp))
    out.push({ field: "followUpOn", why: "Enter the follow-up date as a date." });
  return out;
}
function contactStatusPatch(draft) {
  const form = contactStatusForm(draft.status);
  const note = String(draft.note ?? "").trim();
  const followUp = String(draft.followUpOn ?? "").trim();
  return {
    contact_status: draft.status,
    contact_status_note: form.note === "off" || !note ? null : note,
    contact_follow_up_on: form.followUp === "off" || !followUp ? null : followUp
  };
}
function readContactStatus(row) {
  const r = row ?? {};
  const supported = Object.prototype.hasOwnProperty.call(r, "contact_status");
  return {
    supported,
    state: {
      status: normalizeContactStatus(r.contact_status) ?? DEFAULT_CONTACT_STATUS,
      note: typeof r.contact_status_note === "string" ? r.contact_status_note : null,
      followUpOn: typeof r.contact_follow_up_on === "string" ? r.contact_follow_up_on : null,
      changedAt: typeof r.contact_status_at === "string" ? r.contact_status_at : null,
      changedBy: typeof r.contact_status_by === "string" ? r.contact_status_by : null
    }
  };
}
export {
  CONTACT_STATUSES,
  CONTACT_STATUS_KEYS,
  CONTACT_STATUS_TONE,
  DEFAULT_CONTACT_STATUS,
  contactStatusBlockers,
  contactStatusForm,
  contactStatusLabel,
  contactStatusPatch,
  normalizeContactStatus,
  readContactStatus
};
