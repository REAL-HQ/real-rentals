/**
 * Shared helpers for extra phones and emails on a driver profile.
 * applications.phone / applications.email remain the primary.
 *
 * No real renter numbers or emails live in this file.
 */
import { usPhoneE164 } from "@/lib/us-phone";

export const DRIVER_CONTACT_KINDS = ["phone", "email"] as const;
export type DriverContactKind = (typeof DRIVER_CONTACT_KINDS)[number];

export type DriverContact = {
  id: string;
  application_id: string;
  kind: DriverContactKind;
  value: string;
  label: string | null;
  is_primary: boolean;
  receives_messages: boolean;
  consented_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export function normalizeDriverEmail(raw: string | null | undefined): string | null {
  const v = String(raw ?? "").trim().toLowerCase();
  if (!v || v.length > 254) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return null;
  return v;
}

export function normalizeDriverPhone(raw: string | null | undefined): string | null {
  return usPhoneE164(raw);
}

export function normalizeDriverContact(kind: DriverContactKind, raw: string | null | undefined): string | null {
  return kind === "phone" ? normalizeDriverPhone(raw) : normalizeDriverEmail(raw);
}

export function last10Digits(raw: string | null | undefined): string | null {
  const d = String(raw ?? "").replace(/\D/g, "");
  if (d.length < 10) return null;
  return d.slice(-10);
}

/** Display a US number as 555-010-0000. Non-US values are returned trimmed. */
export function formatDriverPhone(raw: string | null | undefined): string {
  if (!raw) return "—";
  const n = last10Digits(raw);
  if (n && n.length === 10) return `${n.slice(0, 3)}-${n.slice(3, 6)}-${n.slice(6)}`;
  return String(raw).trim() || "—";
}

export function samePhone(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = last10Digits(a);
  const right = last10Digits(b);
  if (left && right) return left === right;
  const na = normalizeDriverPhone(a);
  const nb = normalizeDriverPhone(b);
  if (na && nb) return na === nb;
  return String(a ?? "").trim() === String(b ?? "").trim() && String(a ?? "").trim() !== "";
}

export function sameEmail(a: string | null | undefined, b: string | null | undefined): boolean {
  const left = normalizeDriverEmail(a);
  const right = normalizeDriverEmail(b);
  return !!left && left === right;
}

export type ContactSmsDecision =
  | { canText: true }
  | { canText: false; reason: "invalid_phone" | "opted_out" | "no_consent" | "no_consent_for_number" | "not_enabled" };

/**
 * Consent coverage for one number.
 *
 * Primary: existing application-level rules (sms_consent, no sms_opt_out_at)
 * plus the per-number opt-out list.
 *
 * Extra numbers: application-level consent does NOT extend to a number the
 * renter never provided. An extra is texted only when staff turned
 * receives_messages on AND we have evidence this exact number consented
 * (contact.consented_at, or applications.sms_consent_phone matches) AND
 * the number is not on sms_opt_outs. STOP on the primary still blocks the
 * primary (sms_opt_out_at); it does not by itself block an extra that has
 * its own consent.
 */
export function contactSmsDecision(input: {
  e164: string | null;
  isPrimary: boolean;
  receivesMessages: boolean;
  optedOut: boolean;
  app: {
    phone?: string | null;
    sms_consent?: boolean | null;
    sms_opt_out_at?: string | null;
    sms_consent_phone?: string | null;
  };
  consentedAt?: string | null;
}): ContactSmsDecision {
  if (!input.e164) return { canText: false, reason: "invalid_phone" };
  if (input.optedOut) return { canText: false, reason: "opted_out" };

  const numberHasOwnConsent =
    !!input.consentedAt ||
    (input.app.sms_consent === true && samePhone(input.app.sms_consent_phone, input.e164));

  if (input.isPrimary) {
    if (input.app.sms_opt_out_at) return { canText: false, reason: "opted_out" };
    if (input.app.sms_consent !== true) return { canText: false, reason: "no_consent" };
    return { canText: true };
  }

  if (!input.receivesMessages) return { canText: false, reason: "not_enabled" };
  if (!numberHasOwnConsent) return { canText: false, reason: "no_consent_for_number" };
  return { canText: true };
}

export type FleetContactPhone = {
  value: string;
  label: string | null;
  is_primary: boolean;
  receives_messages: boolean;
  sms_ok: boolean;
  sms_reason: string | null;
};

export type FleetContactEmail = {
  value: string;
  label: string | null;
  is_primary: boolean;
  receives_messages: boolean;
};

export type FleetContacts = {
  phones: FleetContactPhone[];
  emails: FleetContactEmail[];
};

/** Shape returned on FLEET lead status, review packets, lookup, and webhooks. */
export function fleetContactsPayload(
  contacts: DriverContact[],
  app: {
    phone?: string | null;
    email?: string | null;
    sms_consent?: boolean | null;
    sms_opt_out_at?: string | null;
    sms_consent_phone?: string | null;
  },
  optedOut: Set<string> = new Set(),
): FleetContacts {
  const phones: FleetContactPhone[] = [];
  const emails: FleetContactEmail[] = [];
  const seenPhone = new Set<string>();
  const seenEmail = new Set<string>();

  for (const c of contacts) {
    if (c.kind === "phone") {
      const e164 = normalizeDriverPhone(c.value) ?? c.value;
      if (seenPhone.has(e164)) continue;
      seenPhone.add(e164);
      const decision = contactSmsDecision({
        e164,
        isPrimary: c.is_primary,
        receivesMessages: c.is_primary || c.receives_messages,
        optedOut: optedOut.has(e164),
        app,
        consentedAt: c.consented_at,
      });
      phones.push({
        value: e164,
        label: c.label,
        is_primary: c.is_primary,
        receives_messages: c.is_primary || c.receives_messages,
        sms_ok: decision.canText,
        sms_reason: decision.canText ? null : decision.reason,
      });
    } else {
      const value = normalizeDriverEmail(c.value) ?? c.value;
      if (seenEmail.has(value)) continue;
      seenEmail.add(value);
      emails.push({
        value,
        label: c.label,
        is_primary: c.is_primary,
        receives_messages: c.is_primary || c.receives_messages,
      });
    }
  }

  // Before the migration is applied, or if a row was never backfilled,
  // still surface the application columns as the primary contacts.
  const primaryPhone = normalizeDriverPhone(app.phone);
  if (primaryPhone && !seenPhone.has(primaryPhone) && ![...seenPhone].some((v) => samePhone(v, primaryPhone))) {
    const decision = contactSmsDecision({
      e164: primaryPhone,
      isPrimary: true,
      receivesMessages: true,
      optedOut: optedOut.has(primaryPhone),
      app,
    });
    phones.unshift({
      value: primaryPhone,
      label: null,
      is_primary: true,
      receives_messages: true,
      sms_ok: decision.canText,
      sms_reason: decision.canText ? null : decision.reason,
    });
  }
  const primaryEmail = normalizeDriverEmail(app.email);
  if (primaryEmail && !seenEmail.has(primaryEmail)) {
    emails.unshift({
      value: primaryEmail,
      label: null,
      is_primary: true,
      receives_messages: true,
    });
  }

  phones.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  emails.sort((a, b) => Number(b.is_primary) - Number(a.is_primary));
  return { phones, emails };
}

export function isDriverContactsTableMissing(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === "42P01" || /relation .*driver_contacts.* does not exist/i.test(String(err.message ?? ""));
}
