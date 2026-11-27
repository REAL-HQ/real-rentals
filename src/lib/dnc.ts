// Internal DNC (Do Not Contact) List: browser-safe shapes, normalizers and matching.
//
// One record per "Move To DNC" (public.dnc_list, 20261127170000_internal_dnc_list.sql).
// Staff still CAN contact someone on the list (after a confirmation popup); automated
// texts/emails skip them server-side (sms.server.ts / email.server.ts via dnc.server.ts).
// Not the STOP opt-out list (sms_opt_outs) and not the Renter Blacklist.
// Normalizers must stay identical to private.dnc_norm_phone / dnc_norm_email in SQL
// (scripts/dnc-list-postgres.test.ts).

export const DNC_LABEL = "DNC";
export const DNC_SECTION_LABEL = "DNC";
export const DNC_LIST_TITLE = "DNC List";
export const MOVE_TO_DNC_LABEL = "Move To DNC";
export const REMOVE_FROM_DNC_LABEL = "Remove From DNC";
export const DNC_WARNING_TITLE = "On DNC List";
export const CONTACT_ANYWAY_LABEL = "Contact Anyway";
export const DNC_REASON_MIN = 3;
export const DNC_REASON_MAX = 1000;
/** Same pastel red family as the Blacklisted / Unqualified pills, outlined so the two never look alike. */
export const DNC_BADGE_CLASS = "border border-[#D03020]/40 bg-white text-[#B52818]";
/** Logged on outbound_messages / returned by sendEmail when an automated send is skipped. */
export const DNC_SUPPRESSED_ERROR = "on DNC list: automated messages suppressed";
/** sendStaffMessage refuses this when the popup was not confirmed. */
export const DNC_UNCONFIRMED_ERROR =
  "This Person Is On The DNC List. Confirm Contact Anyway First.";
export const DNC_NOT_INSTALLED =
  "The DNC List Is Not Enabled On This Database Yet. Apply The internal_dnc_list Migration, Then Try Again.";

export type DncPersonType = "lead" | "applicant" | "driver" | "renter";
export const DNC_PERSON_TYPE_LABELS: Record<DncPersonType, string> = {
  lead: "Lead",
  applicant: "Applicant",
  driver: "Driver",
  renter: "Renter",
};

/** Digits only, US leading 1 dropped; fewer than 10 digits: null. Mirrors private.dnc_norm_phone. */
export function normalizeDncPhone(raw: unknown): string | null {
  let d = String(raw ?? "").replace(/\D/g, "");
  if (d.length === 11 && d.startsWith("1")) d = d.slice(1);
  return d.length >= 10 ? d : null;
}

/** Trimmed lowercase; must look like an email. Mirrors private.dnc_norm_email. */
export function normalizeDncEmail(raw: unknown): string | null {
  const e = String(raw ?? "")
    .trim()
    .toLowerCase();
  return /^[^\s@]+@[^\s@]+$/.test(e) ? e : null;
}

export function uniqueNormalized(values: unknown[], norm: (v: unknown) => string | null): string[] {
  const out: string[] = [];
  for (const v of values) {
    const n = norm(v);
    if (n && !out.includes(n)) out.push(n);
  }
  return out;
}

/**
 * The person type shown on the list, from the record staff moved:
 * a waitlist row is a Lead; an application is a Renter while it has an open rental
 * (or status active), a Driver once approved, otherwise an Applicant.
 */
export function dncPersonType(input: {
  source: "application" | "waitlist";
  status?: string | null;
  hasOpenRental?: boolean;
}): DncPersonType {
  if (input.source === "waitlist") return "lead";
  const s = String(input.status ?? "").toLowerCase();
  if (input.hasOpenRental || s === "active") return "renter";
  if (s === "approved") return "driver";
  return "applicant";
}

export function dncReasonBlockers(reason: string): string[] {
  const r = reason.trim();
  if (r.length < DNC_REASON_MIN) return ["Enter A Reason."];
  if (r.length > DNC_REASON_MAX) return [`Keep The Reason Under ${DNC_REASON_MAX} Characters.`];
  return [];
}

/** A list row as staff see it (no phone numbers / emails). */
export type DncEntry = {
  id: string;
  applicationId: string | null;
  waitlistId: string | null;
  personType: DncPersonType;
  personTypeLabel: string;
  fullName: string | null;
  reason: string;
  addedBy: string;
  createdAt: string | null;
  removedAt: string | null;
  removedBy: string | null;
  removalReason: string | null;
};

/** What the browser keeps to recognise a person anywhere in the app. */
export type DncIndexEntry = DncEntry & { phones: string[]; emails: string[] };

export type DncPerson = {
  applicationId?: string | null;
  /** Rental-only screens: the provider resolves the renter's application first. */
  rentalId?: string | null;
  waitlistId?: string | null;
  phone?: string | null;
  email?: string | null;
  /** Extra numbers / emails on the record (driver_contacts). */
  phones?: (string | null | undefined)[];
  emails?: (string | null | undefined)[];
};

export type DncIndex = {
  byApplication: Map<string, DncIndexEntry>;
  byWaitlist: Map<string, DncIndexEntry>;
  byPhone: Map<string, DncIndexEntry>;
  byEmail: Map<string, DncIndexEntry>;
};

export function buildDncIndex(entries: DncIndexEntry[]): DncIndex {
  const idx: DncIndex = {
    byApplication: new Map(),
    byWaitlist: new Map(),
    byPhone: new Map(),
    byEmail: new Map(),
  };
  for (const e of entries) {
    if (e.removedAt) continue;
    if (e.applicationId) idx.byApplication.set(e.applicationId, e);
    if (e.waitlistId) idx.byWaitlist.set(e.waitlistId, e);
    for (const p of e.phones) if (!idx.byPhone.has(p)) idx.byPhone.set(p, e);
    for (const m of e.emails) if (!idx.byEmail.has(m)) idx.byEmail.set(m, e);
  }
  return idx;
}

/** The active DNC entry for this person: by record id first, then any normalized phone / email. */
export function findDnc(
  index: DncIndex | null | undefined,
  who: DncPerson | null | undefined,
): DncIndexEntry | null {
  if (!index || !who) return null;
  if (who.applicationId) {
    const hit = index.byApplication.get(who.applicationId);
    if (hit) return hit;
  }
  if (who.waitlistId) {
    const hit = index.byWaitlist.get(who.waitlistId);
    if (hit) return hit;
  }
  for (const p of [who.phone, ...(who.phones ?? [])]) {
    const n = normalizeDncPhone(p);
    const hit = n ? index.byPhone.get(n) : undefined;
    if (hit) return hit;
  }
  for (const m of [who.email, ...(who.emails ?? [])]) {
    const n = normalizeDncEmail(m);
    const hit = n ? index.byEmail.get(n) : undefined;
    if (hit) return hit;
  }
  return null;
}

/** The person a tel: / sms: / mailto: link points at, or null for any other link. */
export function personFromContactHref(href: string | null | undefined): DncPerson | null {
  const h = String(href ?? "").trim();
  const m = /^(tel|sms|mailto):([^?#]*)/i.exec(h);
  if (!m) return null;
  let target = m[2];
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep raw */
  }
  const scheme = m[1].toLowerCase();
  if (scheme === "mailto") {
    const emails = target
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    return { emails };
  }
  return { phone: target };
}

/** Free-text search across what the list shows. */
export function dncMatchesSearch(e: DncEntry, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return [e.fullName, e.reason, e.personTypeLabel, e.addedBy, e.removedBy, e.removalReason].some(
    (v) =>
      String(v ?? "")
        .toLowerCase()
        .includes(s),
  );
}

/** Staff tiers: any staff member may move someone to DNC; Manager / Owner may remove. */
export const DNC_ADD_MIN_TIER = "coordinator" as const;
export const DNC_REMOVE_MIN_TIER = "manager" as const;
