// Driver Agreement Preparation: the per-rental choices staff make before
// sending (authorized drivers, reservation fee, deposit). Client-safe.
//
// These are structured choices, never contract text. The server validates
// them, renders the agreement from the Owner's template, and includes them in
// the preview fingerprint, so Send refuses if anything changed after review.
import { z } from "zod";
import { fmtContractDate } from "@/lib/agreement-dates";

const name = z.string().trim().max(120);
export const AdditionalDriverSchema = z.object({
  name,
  licenseNumber: z.string().trim().max(40),
  licenseState: z.string().trim().max(2),
  licenseExpiration: z.string().trim().max(10), // YYYY-MM-DD
  verified: z.boolean(),
});
const detail = (max: number) => z.string().trim().max(max);
export const AgreementDetailsSchema = z.object({
  driverName: detail(120),
  driverEmail: detail(160),
  driverPhone: detail(40),
  address: detail(160),
  city: detail(80),
  state: detail(40),
  zip: detail(20),
  dob: detail(10),
  licenseNumber: detail(40),
  licenseState: detail(2),
  licenseExpiration: detail(10),
  vehicleDescription: detail(160),
  vehicleColor: detail(50),
  vehicleVin: detail(17),
  licensePlate: detail(30),
  startDate: detail(10),
  endDate: detail(10),
  weeklyRate: detail(20),
  cardOnFile: detail(100),
  insuranceCarrier: detail(120),
  insurancePolicy: detail(120),
});
export type AgreementDetails = z.infer<typeof AgreementDetailsSchema>;

/** Autofill may complete blanks, never replace a saved or staff-entered value. */
export function fillBlankAgreementDetails(base: AgreementDetails, proposed: Partial<AgreementDetails>): AgreementDetails {
  const next = { ...base };
  for (const key of Object.keys(base) as Array<keyof AgreementDetails>) {
    const value = proposed[key];
    if (value && !base[key].trim()) next[key] = value;
  }
  return next;
}

export const PAYMENT_SCHEDULES = [
  { value: "weekly", label: "Weekly" },
  { value: "every_4_weeks", label: "Every 4 Weeks" },
] as const;
export const PAYMENT_METHODS = ["Card Autopay", "Zelle", "Cash App", "Venmo", "Other"] as const;

export const PrepSchema = z.object({
  details: AgreementDetailsSchema.optional(),
  drivers: z.object({ mode: z.enum(["none", "listed"]), list: z.array(AdditionalDriverSchema).max(4) }),
  reservation: z.object({ mode: z.enum(["not_required", "required"]), amount: z.number().nonnegative().max(10000).nullable() }),
  deposit: z.object({
    mode: z.enum(["none", "required", "waived"]),
    amount: z.number().nonnegative().max(25000).nullable(),
    reason: z.string().trim().max(300),
  }),
  // v1.14 (Insurance Included). Optional so earlier templates and saved
  // previews are unaffected; a template that prints one blocks while unset.
  damageWaiver: z.enum(["accepted", "declined"]).nullable().optional(),
  payment: z.object({
    schedule: z.enum(["weekly", "every_4_weeks"]).nullable(),
    method: z.enum(PAYMENT_METHODS).nullable(),
  }).optional(),
  vehicleOwner: z.string().trim().max(160).optional(),
});
export type AgreementPrep = z.infer<typeof PrepSchema>;
export type AdditionalDriver = z.infer<typeof AdditionalDriverSchema>;

export const EMPTY_PREP: AgreementPrep = {
  drivers: { mode: "none", list: [] },
  reservation: { mode: "not_required", amount: null },
  deposit: { mode: "none", amount: null, reason: "" },
};

export type PrepBlocker = { field: string; label: string; why: string };

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Pure: turns staff choices into merge values / term overrides and blockers.
 * startIso is the contract start date (YYYY-MM-DD) or null.
 */
export function applyPrep(
  prep: AgreementPrep,
  ctx: { startIso: string | null; depositClause: string },
): { merge: Record<string, string>; reservationLine: string; blockers: PrepBlocker[] } {
  const blockers: PrepBlocker[] = [];
  const merge: Record<string, string> = {};

  // Authorized drivers
  if (prep.drivers.mode === "none") merge.additional_drivers = "None Authorized";
  else {
    if (!prep.drivers.list.length)
      blockers.push({ field: "additional_drivers", label: "At least one approved driver, or choose No Additional Drivers", why: "Add Approved Driver was selected with no driver listed." });
    const parts: string[] = [];
    prep.drivers.list.forEach((d, i) => {
      const n = `Additional driver ${i + 1}`;
      if (d.name.split(/\s+/).filter(Boolean).length < 2)
        blockers.push({ field: "additional_drivers", label: `${n}: full legal name`, why: "Enter first and last legal name as on the license." });
      if (!d.licenseNumber) blockers.push({ field: "additional_drivers", label: `${n}: license number`, why: "Identifies the authorized driver." });
      if (!/^[A-Za-z]{2}$/.test(d.licenseState)) blockers.push({ field: "additional_drivers", label: `${n}: license state`, why: "Two-letter issuing state." });
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d.licenseExpiration))
        blockers.push({ field: "additional_drivers", label: `${n}: license expiration`, why: "Needed to show the license is valid for the rental." });
      else if (ctx.startIso && d.licenseExpiration < ctx.startIso)
        blockers.push({ field: "additional_drivers", label: `${n}: a license valid on the start date`, why: `The license expires ${fmtContractDate(d.licenseExpiration)}, before the rental starts.` });
      if (!d.verified)
        blockers.push({ field: "additional_drivers", label: `${n}: license verification`, why: "Staff must confirm they checked this driver's license before the driver is added to a signed agreement." });
      parts.push(`${d.name} (${d.licenseState.toUpperCase()} DL ${d.licenseNumber.toUpperCase()}, exp. ${fmtContractDate(d.licenseExpiration)})`);
    });
    merge.additional_drivers = parts.join("; ");
  }

  // Reservation fee (never a deposit)
  let reservationLine = "[ ] Required      [X] Not required for this rental";
  if (prep.reservation.mode === "required") {
    const a = prep.reservation.amount ?? 0;
    if (!(a > 0)) blockers.push({ field: "reservation_fee", label: "Reservation Fee amount", why: "Required was selected; enter the amount." });
    reservationLine = `[X] Required: ${a > 0 ? usd(a) : "$0.00"} (due when pickup or delivery is scheduled)      [ ] Not required for this rental`;
  }

  // Security deposit
  const noDepositWording = /no security deposit/i.test(ctx.depositClause);
  if (prep.deposit.mode === "required") {
    const a = prep.deposit.amount ?? 0;
    if (!(a > 0)) blockers.push({ field: "deposit_amount", label: "Security deposit amount", why: "Deposit Required was selected; enter the amount." });
    if (noDepositWording)
      blockers.push({ field: "deposit_amount", label: "Owner-approved deposit wording", why: "This template only has the no-deposit clause. A deposit can't be required until the Owner approves a template version with deposit wording." });
    merge.deposit_amount = a > 0 ? usd(a) : "";
  } else {
    if (prep.deposit.mode === "waived" && prep.deposit.reason.length < 5)
      blockers.push({ field: "deposit_amount", label: "Reason for waiving the deposit", why: "A waived deposit needs a short internal reason (not printed on the agreement)." });
    merge.deposit_amount = "$0";
  }

  // v1.14 choices. Blank until staff choose; the template-field gate blocks a
  // template that prints them while they are blank.
  if (prep.damageWaiver) merge.damage_waiver = prep.damageWaiver === "accepted" ? "Accepted" : "Declined";
  if (prep.payment?.method) merge.payment_method = prep.payment.method;
  if (prep.vehicleOwner) merge.vehicle_owner = prep.vehicleOwner;

  // Recorded with the agreement (merge_data) and covered by the fingerprint;
  // no template prints it.
  merge._prep = JSON.stringify(prep);
  return { merge, reservationLine, blockers };
}

/** "$1,234.50" / "35" -> 1234.5 / 35; null when the text holds no amount. */
export function parseUsd(text: string | null | undefined): number | null {
  const m = String(text ?? "").replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  if (!m) return null;
  const n = Number(m[0]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Pure: the v1.14 money rows, from the agreed weekly rate and staff choices.
 *
 *   Amount Due Each Payment = (weekly rate + Damage Waiver, if accepted) x 1 or 4 weeks
 *   Balance Due             = first payment - Reservation Fee
 *
 * Returns blanks (never a guess) while an input is missing, so the
 * template-field gate reports exactly what staff still need to choose.
 */
export function paymentRows(
  prep: AgreementPrep,
  ctx: { weeklyRate: number | null; waiverFee: number | null },
): { payment_amount: string; balance_due: string; blockers: PrepBlocker[] } {
  const blockers: PrepBlocker[] = [];
  const out = { payment_amount: "", balance_due: "", blockers };
  const weekly = ctx.weeklyRate;
  if (!(weekly != null && weekly > 0) || !prep.damageWaiver || !prep.payment?.schedule) return out;
  if (prep.damageWaiver === "accepted" && !(ctx.waiverFee != null && ctx.waiverFee > 0)) {
    blockers.push({ field: "damage_waiver", label: "Damage Waiver weekly fee", why: "The Damage Waiver was accepted, but the template has no weekly Damage Waiver fee. The Owner sets it in the Agreement Builder." });
    return out;
  }
  const waiver = prep.damageWaiver === "accepted" ? (ctx.waiverFee as number) : 0;
  const weeks = prep.payment.schedule === "every_4_weeks" ? 4 : 1;
  const each = Math.round((weekly + waiver) * weeks * 100) / 100;
  const fee = prep.reservation.mode === "required" ? (prep.reservation.amount ?? 0) : 0;
  if (fee > each) {
    blockers.push({ field: "reservation_fee", label: "A Reservation Fee no larger than the first payment", why: `The Reservation Fee (${usd(fee)}) is applied to the first payment (${usd(each)}) and cannot exceed it.` });
    return out;
  }
  const parts = waiver ? ` (${usd(weekly * weeks)} rent + ${usd(waiver * weeks)} Damage Waiver)` : "";
  out.payment_amount = `${usd(each)} ${weeks === 4 ? "every 4 weeks" : "weekly"}${parts}`;
  out.balance_due = usd(Math.round((each - fee) * 100) / 100);
  return out;
}
