/**
 * Staff edit of the name and contact shown on a driver profile.
 *
 * The profile is an applications row. full_name is one column (there is no
 * first_name / last_name, and no drivers or profiles table). Phone, email,
 * city and state are the same columns the header reads. Rentals do not store
 * a renter name; they join applications.full_name.
 *
 * applications.email and applications.phone are not unique indexes. A second
 * in-progress or active application with the same email is refused because
 * the apply flow already treats that email as the same person. Closed,
 * declined and merged (status duplicate) rows may keep a shared email, which
 * is how a returning applicant gets a new application. Phone is not unique:
 * a shared number is an identity review, not a block.
 *
 * driver_contacts is unique per profile (application_id, kind, value). The
 * primary row is updated or promoted; a second copy of the same value is not
 * inserted. waitlist_one_active_per_email is a real unique index and is
 * checked before any write.
 */
import { normalizeDriverEmail, sameEmail, samePhone } from "@/lib/driver-contacts";
import { isUsStateCode, US_STATES } from "@/lib/us-states";
import { usPhoneE164 } from "@/lib/us-phone";

export const PROFILE_UPDATE_ACTION = "application.profile_updated";

/** Historical rows that may share an email with the application being edited. */
export const EMAIL_SHARE_OK_STATUSES = ["duplicate", "closed", "declined"] as const;

const STATE_BY_NAME = new Map(US_STATES.map((s) => [s.name.toLowerCase(), s.code]));

export type ProfileField = "firstName" | "lastName" | "phone" | "email" | "city" | "state" | "form";

export type DriverProfileDraft = {
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  city: string;
  state: string;
};

export type NormalizedDriverProfile = {
  fullName: string;
  firstName: string;
  lastName: string;
  phone: string;
  email: string;
  city: string | null;
  state: string | null;
};

export type ProfileEditResult =
  | { ok: true; value: NormalizedDriverProfile }
  | { ok: false; field: ProfileField; error: string };

export function collapseText(value: string | null | undefined): string {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

/** First word is the first name. Everything after it is the last name. */
export function splitDriverName(fullName: string | null | undefined): { firstName: string; lastName: string } {
  const parts = collapseText(fullName).split(" ").filter(Boolean);
  if (!parts.length) return { firstName: "", lastName: "" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

export function joinDriverName(firstName: string, lastName: string): string {
  return collapseText(`${collapseText(firstName)} ${collapseText(lastName)}`);
}

/** Two-letter code, or null when blank. Undefined when the text is not a state. */
export function normalizeProfileState(raw: string | null | undefined): string | null | undefined {
  const text = collapseText(raw);
  if (!text) return null;
  const code = text.toUpperCase();
  if (isUsStateCode(code)) return code;
  return STATE_BY_NAME.get(text.toLowerCase());
}

function hasLetter(value: string): boolean {
  return /\p{L}/u.test(value);
}

function hasControl(value: string): boolean {
  return /[\u0000-\u001f\u007f]/.test(value);
}

export function normalizeDriverProfileEdit(draft: DriverProfileDraft): ProfileEditResult {
  const firstName = collapseText(draft.firstName);
  const lastName = collapseText(draft.lastName);
  if (!firstName || !hasLetter(firstName) || hasControl(firstName)) {
    return { ok: false, field: "firstName", error: "Enter a first name." };
  }
  if (firstName.length > 60) return { ok: false, field: "firstName", error: "That first name is too long." };
  if (lastName && (!hasLetter(lastName) || hasControl(lastName))) {
    return { ok: false, field: "lastName", error: "Enter a last name." };
  }
  if (lastName.length > 80) return { ok: false, field: "lastName", error: "That last name is too long." };
  const fullName = joinDriverName(firstName, lastName);
  if (fullName.length < 2) return { ok: false, field: "firstName", error: "Enter the driver's name." };
  if (fullName.length > 120) return { ok: false, field: "form", error: "That name is too long." };

  const email = normalizeDriverEmail(draft.email);
  if (!email) return { ok: false, field: "email", error: "Enter a valid email address." };

  const phone = usPhoneE164(draft.phone);
  if (!phone) return { ok: false, field: "phone", error: "Enter a valid US phone number." };

  const cityText = collapseText(draft.city);
  if (hasControl(cityText) || cityText.length > 80) {
    return { ok: false, field: "city", error: "Enter a city." };
  }
  const state = normalizeProfileState(draft.state);
  if (state === undefined) return { ok: false, field: "state", error: "Choose a state." };

  return {
    ok: true,
    value: {
      fullName,
      firstName,
      lastName,
      phone,
      email,
      city: cityText || null,
      state,
    },
  };
}

export type ProfileIdentity = {
  fullName: string;
  email: string;
  phone: string;
  city: string | null;
  state: string | null;
};

export function profileIdentityFromRow(row: {
  full_name?: string | null;
  email?: string | null;
  phone?: string | null;
  city?: string | null;
  state?: string | null;
}): ProfileIdentity {
  const state = normalizeProfileState(row.state);
  return {
    fullName: collapseText(row.full_name),
    email: normalizeDriverEmail(row.email) ?? collapseText(row.email).toLowerCase(),
    phone: usPhoneE164(row.phone) ?? collapseText(row.phone),
    city: collapseText(row.city) || null,
    state: state === undefined ? collapseText(row.state).toUpperCase() || null : state,
  };
}

export function profileFieldsChanged(before: ProfileIdentity, after: NormalizedDriverProfile): Array<keyof ProfileIdentity> {
  const changed: Array<keyof ProfileIdentity> = [];
  if (before.fullName !== after.fullName) changed.push("fullName");
  if (!sameEmail(before.email, after.email) && before.email !== after.email) changed.push("email");
  if (!samePhone(before.phone, after.phone) && before.phone !== after.phone) changed.push("phone");
  if ((before.city ?? null) !== (after.city ?? null)) changed.push("city");
  if ((before.state ?? null) !== (after.state ?? null)) changed.push("state");
  return changed;
}

/** Last 10 digits, for "did the number itself change" (consent does not carry over). */
export function phoneIdentityChanged(before: string | null | undefined, after: string | null | undefined): boolean {
  const digits = (value: string | null | undefined) => {
    const d = String(value ?? "").replace(/\D/g, "");
    return d.length >= 10 ? d.slice(-10) : d;
  };
  return digits(before) !== digits(after);
}

export type EmailHolder = { id: string; status?: string | null; deleted_at?: string | null };

/** True when another live application already uses this email as its identity. */
export function emailBelongsToAnotherProfile(selfId: string, rows: readonly EmailHolder[]): boolean {
  return rows.some((row) => {
    if (!row.id || row.id === selfId) return false;
    if (row.deleted_at) return false;
    const status = String(row.status ?? "").toLowerCase();
    return !(EMAIL_SHARE_OK_STATUSES as readonly string[]).includes(status);
  });
}

export type WaitingEmailHolder = { id: string; email?: string | null; market_id?: string | null; status?: string | null };

/**
 * waitlist_one_active_per_email: one waiting row per lower(email) + market.
 * Null market ids are distinct in that index, so they do not collide.
 */
export function waitingEmailTaken(
  selfIds: readonly string[],
  marketId: string | null,
  email: string,
  rows: readonly WaitingEmailHolder[],
): boolean {
  if (!marketId) return false;
  const target = normalizeDriverEmail(email);
  if (!target) return false;
  const skip = new Set(selfIds);
  return rows.some((row) => {
    if (!row.id || skip.has(row.id)) return false;
    if (String(row.status ?? "") !== "waiting") return false;
    if ((row.market_id ?? null) !== marketId) return false;
    return sameEmail(row.email, target);
  });
}

export function profileUpdatedSummary(staff: string | null | undefined): string {
  const who = collapseText(staff) || "Staff";
  return `Profile updated by ${who}`;
}

/** Exact ILIKE pattern. Escapes wildcards so a typed % or _ is not a pattern. */
export function literalIlike(value: string): string {
  return value.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}
