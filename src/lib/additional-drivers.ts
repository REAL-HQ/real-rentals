import { MIN_RENTER_AGE } from "@/lib/renter-age";
import { ADDITIONAL_DRIVER_WEEKLY_CENTS } from "@/lib/additional-driver-copy";

export const ADDITIONAL_DRIVER_STATUSES = ["pending", "approved", "declined", "removed"] as const;
export type AdditionalDriverStatus = (typeof ADDITIONAL_DRIVER_STATUSES)[number];

export type AdditionalDriverInput = {
  name: string;
  email: string;
  phone: string;
  dob: string;
  licenseNumber: string;
  licenseState: string;
  licenseExpiration: string;
  licensePhotoPath: string | null;
  relationship: string;
  smsConsent: boolean;
};

export type AdditionalDriverRow = AdditionalDriverInput & {
  id: string;
  applicationId: string | null;
  rentalId: string | null;
  status: AdditionalDriverStatus;
  approvedAt: string | null;
  insuranceAddedAt: string | null;
  signedAt: string | null;
  removedAt: string | null;
  stripeSubscriptionItemId: string | null;
};

/** Whole years on a calendar date. Null when the date is not YYYY-MM-DD. */
export function ageOnDate(dob: string, today: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return null;
  const years = Number(today.slice(0, 4)) - Number(dob.slice(0, 4));
  const beforeBirthday = today.slice(5) < dob.slice(5);
  return beforeBirthday ? years - 1 : years;
}

export function additionalDriverAgeBlock(dob: string, today: string): string | null {
  const age = ageOnDate(dob, today);
  if (age == null) return "Enter a date of birth.";
  if (age < MIN_RENTER_AGE) return `Additional drivers must be at least ${MIN_RENTER_AGE}.`;
  return null;
}

/**
 * An additional driver may drive only after the same gates as the renter:
 * approved, signed, reservation fee settled, and the policy endorsement recorded.
 */
export function additionalDriverMayDrive(row: {
  status: AdditionalDriverStatus;
  signedAt: string | null;
  insuranceAddedAt: string | null;
  removedAt: string | null;
  reservationFeeSettled: boolean;
}): boolean {
  return row.status === "approved" && !row.removedAt && !!row.signedAt && !!row.insuranceAddedAt && row.reservationFeeSettled;
}

export function additionalDriverStatusLabel(status: AdditionalDriverStatus): string {
  if (status === "pending") return "Screening";
  if (status === "approved") return "Approved";
  if (status === "declined") return "Declined";
  return "Removed";
}

/** Prep rows for Authorized Drivers. License verification stays unchecked for staff. */
export function prepDriversFromApproved(rows: AdditionalDriverRow[]): { name: string; licenseNumber: string; licenseState: string; licenseExpiration: string; verified: boolean }[] {
  return rows
    .filter((r) => r.status === "approved" && !r.removedAt)
    .map((r) => ({
      name: r.name,
      licenseNumber: r.licenseNumber,
      licenseState: r.licenseState,
      licenseExpiration: r.licenseExpiration,
      verified: false,
    }));
}

export const ADDITIONAL_DRIVER_PRICE_SETTING = "additional_driver_weekly_price";

export function additionalDriverPriceProblem(value: unknown): string | null {
  const row = value && typeof value === "object" ? (value as { price_id?: unknown; amount_cents?: unknown }) : null;
  const price = typeof row?.price_id === "string" ? row.price_id.trim() : "";
  if (!price.startsWith("price_")) return "Save a Stripe price id in app_settings before billing an additional driver. Nothing was charged.";
  if (Number(row?.amount_cents) !== ADDITIONAL_DRIVER_WEEKLY_CENTS) return "The saved Stripe price must be $100 per week. Nothing was charged.";
  return null;
}

/**
 * One signer finishing does not finish the document when another signer is still open.
 * A document with no recipient rows stays a single signature, which is today's agreement.
 */
export function signingClosesDocument(signers: { id: string; status: string }[], actingId: string | null): boolean {
  if (signers.length <= 1) return true;
  return signers.every((s) => s.id === actingId || s.status === "signed");
}
