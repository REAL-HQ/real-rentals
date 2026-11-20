/**
 * E-signed vehicle swap for an ACTIVE rental (Dolmar, t532u, Nov 20 2026:
 * "switch a booking/rental to a different car when the reserved car has an
 * issue"). Client-safe rules and wording. Server: vehicle-swap.server.ts.
 * Database: supabase/migrations/20261120171500_rental_vehicle_swaps.sql.
 * Docs (how to turn it on): docs/vehicle-swap-esign.md.
 *
 * Flow:
 *   1. Staff pick the replacement car on the rental (Bookings → rental →
 *      Vehicle → Swap Vehicle). Only Available, Rental Ready cars that are on
 *      no other open rental can be picked.
 *   2. A swap agreement is generated from the current default template
 *      (v1.15) through the normal agreement step (prepareAgreement /
 *      issueAgreement): it names the NEW car (full VIN, plate, colour), keeps
 *      the rental's weekly rate and payment choices, carries no Reservation
 *      Fee and no new deposit, and prints a Vehicle Swap notice at the top.
 *      It goes out through the existing e-sign flow (email/SMS link).
 *   3. On signing (esign.server.ts completeSigning → onSwapSigned) the swap is
 *      marked signed and the signed PDF is filed as
 *      "Rental Agreement — Swap (follows <original>)".
 *   4. At the handover staff record the return odometer/fuel of the old car,
 *      the pickup odometer/fuel of the new car, and where the old car goes
 *      (Maintenance or Available). complete_rental_vehicle_swap_tx moves the
 *      rental to the new car in one transaction. Billing is never touched.
 *
 * Off until the migration is installed AND app_settings.vehicle_swap.enabled
 * is true. Either missing: every server call refuses before it writes.
 */
import { fmtContractDate } from "@/lib/agreement-dates";
import { agreementLabel } from "@/lib/inbox-agreement-filing";
import { FUEL_LEVELS } from "@/lib/pickup-handover";

export const VEHICLE_SWAP_SETTINGS_KEY = "vehicle_swap";
export const VEHICLE_SWAPS_TABLE = "rental_vehicle_swaps";
export const VEHICLE_SWAP_FN = "complete_rental_vehicle_swap_tx";
export const VEHICLE_SWAP_MIGRATION = "20261120171500_rental_vehicle_swaps.sql";
export const VEHICLE_SWAP_TITLE = "Vehicle Swap Addendum To Rental Agreement";
/** The terms every swap moves the renter onto (Dolmar t542u: "Upgrade to new terms"). Fixed, not a choice. */
export const SWAP_TERMS_VERSION = "v1.15";

export const SWAP_REASON_CODES = ["upgrade", "downgrade", "maintenance", "damage", "replacement", "other"] as const;
export type SwapReasonCode = (typeof SWAP_REASON_CODES)[number];
export const SWAP_REASON_LABELS: Record<SwapReasonCode, string> = {
  upgrade: "Upgrade",
  downgrade: "Downgrade",
  maintenance: "Maintenance",
  damage: "Damage",
  replacement: "Replacement",
  other: "Other",
};

export const SWAP_FUEL_LEVELS = FUEL_LEVELS;
export const OUTGOING_STATUSES = ["maintenance", "available"] as const;
export type OutgoingStatus = (typeof OUTGOING_STATUSES)[number];
export const OUTGOING_STATUS_LABELS: Record<OutgoingStatus, string> = { maintenance: "Maintenance", available: "Available" };

export const SWAP_DOCS_TABLE = "rental_vehicle_swap_documents";
/** New Vehicle Insurance documents a swap can carry. Staff only; never marks anything insured. */
export const SWAP_INSURANCE_DOC_KINDS = ["insurance_card", "insurance_declarations", "insurance_endorsement"] as const;
export type SwapInsuranceDocKind = (typeof SWAP_INSURANCE_DOC_KINDS)[number];
export const SWAP_INSURANCE_DOC_LABELS: Record<SwapInsuranceDocKind, string> = {
  insurance_card: "Insurance ID Card",
  insurance_declarations: "Insurance Declarations Page",
  insurance_endorsement: "Insurance Endorsement",
};
export const SWAP_INSURANCE_CHECK_LABEL = "New Vehicle Insurance Uploaded";
export const SWAP_INSURANCE_NOTE =
  "Uploading a document does not mark the vehicle insured. Confirm coverage with the insurer before the handover.";
export const SWAP_INSURANCE_MIN_OVERRIDE = 10;

export const SWAP_STATUSES = ["pending_signature", "signed", "completed", "voided", "send_failed"] as const;
export type SwapStatus = (typeof SWAP_STATUSES)[number];
export const SWAP_STATUS_LABELS: Record<SwapStatus, string> = {
  pending_signature: "Waiting For Signature",
  signed: "Signed — Ready For Handover",
  completed: "Completed",
  voided: "Voided",
  send_failed: "Send Failed",
};
export const OPEN_SWAP_STATUSES: readonly SwapStatus[] = ["pending_signature", "signed"];

export type SwapGate = {
  /** Table and function from the migration are on the database. */
  installed: boolean;
  /** app_settings.vehicle_swap.enabled is exactly true. */
  switchedOn: boolean;
  enabled: boolean;
  reason: string | null;
};

export const SWAP_OFF_MESSAGE = "Vehicle Swap is off. It turns on after the database update is installed and the Owner switches it on.";

/** Only an explicit `{ "enabled": true }` turns it on. Anything else is off. */
export function readSwapSetting(v: unknown): { enabled: boolean } {
  const o = v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  return { enabled: o.enabled === true };
}

export function swapGate(installed: boolean, settingValue: unknown): SwapGate {
  const switchedOn = readSwapSetting(settingValue).enabled;
  const enabled = installed && switchedOn;
  const reason = enabled
    ? null
    : !installed
      ? `The vehicle swap database update (${VEHICLE_SWAP_MIGRATION}) is not installed.`
      : "The Owner has not switched Vehicle Swap on (app_settings vehicle_swap).";
  return { installed, switchedOn, enabled, reason };
}

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** "2019 Toyota Camry, plate ABC1234" — never the unit number. */
export function swapVehicleText(v: { year?: number | string | null; make?: string | null; model?: string | null; license_plate?: string | null } | null): string {
  if (!v) return "your current vehicle";
  const ymm = [v.year, v.make, v.model].map((x) => String(x ?? "").trim()).filter(Boolean).join(" ");
  const plate = String(v.license_plate ?? "").trim().toUpperCase();
  return [ymm || "your current vehicle", plate ? `plate ${plate}` : ""].filter(Boolean).join(", ");
}

/**
 * The notice printed at the top of a swap agreement (rental-amendment.ts
 * insertAmendmentNotice puts it in the "!+ " highlight box). Wording for
 * Dolmar's review: it changes the car only; rent and the payment schedule
 * stay as they are and nothing is billed again.
 */
export function swapNoticeText(a: {
  weeklyRate: number;
  previousSignedAt: string | null;
  previousNumber: string | null;
  previousIsPaper: boolean;
  outgoing: Parameters<typeof swapVehicleText>[0];
}): string {
  const when = a.previousSignedAt ? fmtContractDate(a.previousSignedAt) : "";
  const prior = a.previousIsPaper
    ? "your Rental Agreement on file"
    : `the Rental Agreement${when ? ` signed ${when}` : ""}${a.previousNumber ? ` (${a.previousNumber})` : ""}`;
  return `This Vehicle Swap Addendum changes the Vehicle on ${prior}. You return the ${swapVehicleText(a.outgoing)} and receive the Vehicle described below. By signing, you accept the current Rental Agreement terms (Version 1.15), printed in full below, which replace the terms of your earlier agreement from the date you sign. Your original start date, your weekly rental rate of ${usd(a.weeklyRate)} and your payment schedule stay the same, and rent you already paid is not billed again. There is no Reservation Fee and no new deposit. Until you sign and receive the new Vehicle, your current agreement stays in effect.`;
}

/** Label of the signed swap PDF on the renter's Documents (same as Agreement Filing's Swap role). */
export function swapDocumentLabel(previousDocumentId: string | null): string {
  return agreementLabel("swap", previousDocumentId);
}

/** Line in the renter's "agreement signed" email. */
export const SWAP_SIGNED_EMAIL_LINE = "Your vehicle swap agreement is signed. We will hand over your new vehicle at the time we arranged. Your weekly rate and payment schedule stay the same.";

export type SwapHandoverInput = {
  fromVehicleStatus: OutgoingStatus;
  returnMiles: number;
  pickupMiles: number;
  returnFuel: (typeof FUEL_LEVELS)[number];
  pickupFuel: (typeof FUEL_LEVELS)[number];
};

/** Staff-readable text for the database errors complete_rental_vehicle_swap_tx raises. */
export function swapErrorText(raw: string): string {
  const m = String(raw ?? "");
  const n = (re: RegExp) => m.match(re)?.[1] ?? "";
  if (/swap_contention/.test(m)) return "Someone else is changing this rental or car right now. Try again in a moment.";
  if (/swap_insurance_missing/.test(m)) return `${SWAP_INSURANCE_CHECK_LABEL}: upload the new vehicle's insurance document, or have the Owner override with a reason.`;
  if (/swap_not_signed/.test(m)) return "The renter has not signed the swap agreement yet.";
  if (/swap_agreement_not_signed/.test(m)) return "The signed swap agreement could not be confirmed for this rental and car.";
  if (/rental_not_active/.test(m)) return "This rental is no longer active.";
  if (/rental_vehicle_changed/.test(m)) return "The rental's vehicle changed since the swap was sent. Void this swap and start again.";
  if (/replacement_on_other_rental/.test(m)) return "The replacement car is now on another booking.";
  if (/replacement_not_rental_ready:/.test(m)) return `The replacement car is not Rental Ready (missing: ${n(/replacement_not_rental_ready:([a-z_,]+)/)}).`;
  if (/replacement_unavailable/.test(m)) return "The replacement car is no longer Available.";
  if (/return_below_pickup:/.test(m)) return `The return odometer is below the pickup reading (${n(/return_below_pickup:(\d+)/)} miles).`;
  if (/return_below_history:/.test(m)) return `The return odometer is far below this car's history (${n(/return_below_history:(\d+)/)} miles).`;
  if (/pickup_below_history:/.test(m)) return `The pickup odometer is far below the new car's history (${n(/pickup_below_history:(\d+)/)} miles).`;
  if (/invalid_mileage/.test(m)) return "Enter odometer readings as whole miles.";
  if (/invalid_vehicle_status/.test(m)) return "Choose Maintenance or Available for the returned car.";
  if (/swap_not_found/.test(m)) return "Swap not found.";
  return "The swap could not be completed. Nothing was changed.";
}
