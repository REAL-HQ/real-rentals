/**
 * Reference and emergency contact on an application (all optional).
 *
 * Added Nov 20 2026 at Dolmar's request so linked-person blacklist matching
 * can see who an applicant lists: a reference or emergency contact who is a
 * blacklisted person (by name or phone) is a blacklist match
 * (20261120130000_application_references.sql). Client-safe.
 */
import { z } from "zod";
import { normalizePhone } from "@/lib/blacklist";

export const CONTACT_PEOPLE_FIELDS = [
  "reference_name",
  "reference_phone",
  "reference_relationship",
  "emergency_contact_name",
  "emergency_contact_phone",
  "emergency_contact_relationship",
] as const;
export type ContactPeopleField = (typeof CONTACT_PEOPLE_FIELDS)[number];
export type ContactPeople = Record<ContactPeopleField, string | null>;

export const CONTACT_PEOPLE_LABELS: Record<ContactPeopleField, string> = {
  reference_name: "Reference Name",
  reference_phone: "Reference Phone",
  reference_relationship: "Reference Relationship",
  emergency_contact_name: "Emergency Contact Name",
  emergency_contact_phone: "Emergency Contact Phone",
  emergency_contact_relationship: "Emergency Contact Relationship",
};

/** Empty string -> null; otherwise trimmed. */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const personName = z.preprocess(blankToNull, z.string().trim().min(2, "Enter Their Full Name.").max(120).nullable().optional());
const relationship = z.preprocess(blankToNull, z.string().trim().max(60).nullable().optional());
const personPhone = z.preprocess(
  blankToNull,
  z
    .string()
    .trim()
    .max(40)
    .refine((v) => normalizePhone(v) !== null, "Enter A 10-Digit Phone Number.")
    .nullable()
    .optional(),
);

/** zod shape for the six optional fields (wizard step save and staff edits). */
export const contactPeopleShape = {
  reference_name: personName,
  reference_phone: personPhone,
  reference_relationship: relationship,
  emergency_contact_name: personName,
  emergency_contact_phone: personPhone,
  emergency_contact_relationship: relationship,
};

export const contactPeopleSchema = z.object(contactPeopleShape);

export function emptyContactPeople(): ContactPeople {
  return Object.fromEntries(CONTACT_PEOPLE_FIELDS.map((k) => [k, null])) as ContactPeople;
}

export function contactPeopleFromRow(row: Record<string, unknown> | null | undefined): ContactPeople {
  const out = emptyContactPeople();
  for (const k of CONTACT_PEOPLE_FIELDS) {
    const v = row?.[k];
    out[k] = typeof v === "string" && v.trim() ? v.trim() : null;
  }
  return out;
}

export function hasAnyContactPeople(p: Partial<ContactPeople>): boolean {
  return CONTACT_PEOPLE_FIELDS.some((k) => Boolean(p[k]));
}
