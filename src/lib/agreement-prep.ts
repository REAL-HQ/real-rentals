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
  // "not_applicable": an updated agreement for a renter whose rental is already
  // running (no Reservation Fee is taken; v1.14 prints "Not Applicable").
  reservation: z.object({ mode: z.enum(["not_required", "required", "not_applicable"]), amount: z.number().nonnegative().max(10000).nullable() }),
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

/**
 * v1.14 choices for a send nobody prepared by hand (FLEET, approval
 * auto-send): Damage Waiver declined (the quoted weekly rate has no waiver),
 * paid weekly by card autopay (the card is saved on file with the Reservation
 * Fee). Anything a caller already chose is kept. The renter initials the
 * Damage Waiver choice when signing.
 */
export function withAutoSendDefaults(prep: AgreementPrep): AgreementPrep {
  return {
    ...prep,
    damageWaiver: prep.damageWaiver ?? "declined",
    payment: { schedule: prep.payment?.schedule ?? "weekly", method: prep.payment?.method ?? "Card Autopay" },
  };
}

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

/** Finite dollars from a number or a printed amount. Null when it is not money. */
export function moneyNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return Math.round(value * 100) / 100;
  if (typeof value === "string" && value.trim()) return parseUsd(value);
  return null;
}

const cents = (n: number) => Math.round(n * 100);

/** Authorized drivers named on this prepare. A blank row is not a driver. */
export function authorizedDriverCount(prep: AgreementPrep): number {
  if (prep.drivers.mode !== "listed") return 0;
  return prep.drivers.list.filter((d) => d.name.trim().length > 0).length;
}

/**
 * What billing should charge each week, recorded on a new agreement snapshot.
 *
 * weeklyAmount is rent + included Additional Driver fees + the Damage Waiver
 * when accepted. It is the per-week figure (an Every 4 Weeks payment is four
 * times this). The separate Stripe "Add $100/Week" line must not be added
 * for a driver already counted here: autopay charges rentals.weekly_rate,
 * and that rate is copied from weeklyAmount.
 *
 * source "added" means this prepare added the fees on top of the typed rent.
 * source "already_in_rate" means the typed Weekly Rate already contained them
 * (staff typed vehicle rate + fees) and they were not added a second time.
 * source "none" means no authorized driver is on this agreement.
 */
export type AgreementBillingSnapshot = {
  weeklyAmount: number;
  driverFeeEach: number;
  driverCount: number;
  driverFeesIncluded: number;
  source: "added" | "already_in_rate" | "none";
};

/** Merge key for the snapshot. Not a printed template field. */
export const BILLING_MERGE_KEY = "_billing";

export function billingSnapshotFromMerge(merge: Record<string, unknown> | null | undefined): AgreementBillingSnapshot | null {
  const raw = merge?.[BILLING_MERGE_KEY];
  if (raw == null || raw === "") return null;
  try {
    const v = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, unknown>;
    const weeklyAmount = moneyNumber(v?.weeklyAmount);
    if (weeklyAmount == null || !(weeklyAmount > 0)) return null;
    const source = v?.source === "added" || v?.source === "already_in_rate" || v?.source === "none" ? v.source : "none";
    return {
      weeklyAmount,
      driverFeeEach: Math.max(0, moneyNumber(v?.driverFeeEach) ?? 0),
      driverCount: Math.max(0, Math.floor(Number(v?.driverCount) || 0)),
      driverFeesIncluded: Math.max(0, moneyNumber(v?.driverFeesIncluded) ?? 0),
      source,
    };
  } catch {
    return null;
  }
}

/**
 * The weekly amount already stored on an agreement. Never recomputes driver
 * fees, so a sent agreement whose Amount Due Each Payment is $450 stays $450.
 * Prefers the billing snapshot. Otherwise the printed payment (divided by 4
 * when it says every 4 weeks), then the printed weekly rate.
 */
export function storedWeeklyAmount(merge: Record<string, unknown> | null | undefined): number | null {
  const snap = billingSnapshotFromMerge(merge);
  if (snap && snap.weeklyAmount > 0) return snap.weeklyAmount;
  const payment = String(merge?.payment_amount ?? "");
  const paymentAmount = parseUsd(payment);
  if (paymentAmount != null && paymentAmount > 0) {
    if (/every 4 weeks/i.test(payment)) return Math.round((paymentAmount / 4) * 100) / 100;
    return paymentAmount;
  }
  const weekly = parseUsd(String(merge?.weekly_rate ?? ""));
  return weekly != null && weekly > 0 ? weekly : null;
}

/** Agreement weekly amount when one was stored, otherwise the vehicle rate. */
export function weeklyRateFromAgreementOrVehicle(agreementWeekly: number | null, vehicleWeekly: number | null): number | null {
  if (agreementWeekly != null && agreementWeekly > 0) return agreementWeekly;
  if (vehicleWeekly != null && vehicleWeekly > 0) return vehicleWeekly;
  return null;
}

function exactIncludedCount(amount: number | null, vehicle: number | null, feeEach: number, approvedCount: number): number {
  if (amount == null || vehicle == null || !(feeEach > 0) || approvedCount < 1) return 0;
  const diff = cents(amount) - cents(vehicle);
  const fee = cents(feeEach);
  if (diff <= 0 || fee <= 0 || diff % fee !== 0) return 0;
  const count = diff / fee;
  if (count > approvedCount) return 0;
  return count;
}

/**
 * How many approved drivers are already priced into the weekly amount, so a
 * separate Stripe line would charge them twice.
 *
 * A new snapshot is explicit. An older agreement is not rewritten: the count
 * is inferred only when the stored weekly amount or the rental weekly rate is
 * exactly the vehicle rate plus one or more driver fees (the $450 workaround
 * is vehicle $350 + one $100 driver).
 */
export function includedDriverCount(input: {
  merge: Record<string, unknown> | null | undefined;
  rentalWeekly: number | null;
  vehicleWeekly: number | null;
  approvedCount: number;
  feeEach: number;
}): number {
  const snap = billingSnapshotFromMerge(input.merge ?? null);
  if (snap) {
    if (snap.source === "none") return 0;
    return Math.min(snap.driverCount, Math.max(0, input.approvedCount));
  }
  const fromAgreement = exactIncludedCount(storedWeeklyAmount(input.merge ?? null), input.vehicleWeekly, input.feeEach, input.approvedCount);
  const fromRental = exactIncludedCount(input.rentalWeekly, input.vehicleWeekly, input.feeEach, input.approvedCount);
  return Math.max(fromAgreement, fromRental);
}

export type PaymentRowsResult = {
  payment_amount: string;
  balance_due: string;
  blockers: PrepBlocker[];
  billing: AgreementBillingSnapshot | null;
  /** Staff-only note. Not a template field, so it is not printed on the agreement. */
  driverFeeNote: string;
};

/**
 * Pure: the v1.14 money rows, from the agreed weekly rate and staff choices.
 *
 *   Amount Due Each Payment = (weekly rate + each authorized Additional Driver fee
 *                              + Damage Waiver, if accepted) x 1 or 4 weeks
 *   Balance Due At Pickup   = first payment - Reservation Fee
 *
 * Billing source of truth for a new prepare: those driver fees are inside
 * billing.weeklyAmount, which is copied to rentals.weekly_rate. They are not
 * also a Stripe subscription item. This runs only when a new agreement is
 * prepared. Sent and signed rows keep the amounts they stored.
 *
 * Returns blanks (never a guess) while an input is missing, so the
 * template-field gate reports exactly what staff still need to choose.
 *
 * additionalDriverWeeklyFee omitted: older callers, no driver fees added.
 * Passed as null while drivers are named: the template has no fee, so the
 * totals stay blank instead of dropping the fee.
 */
export function paymentRows(
  prep: AgreementPrep,
  ctx: {
    weeklyRate: number | null;
    waiverFee: number | null;
    additionalDriverWeeklyFee?: number | null;
    /** The vehicle's listed weekly rate, before staff typed a rate on this prepare. */
    catalogWeeklyRate?: number | null;
  },
): PaymentRowsResult {
  const blockers: PrepBlocker[] = [];
  const out: PaymentRowsResult = { payment_amount: "", balance_due: "", blockers, billing: null, driverFeeNote: "" };
  const weekly = ctx.weeklyRate;
  if (!(weekly != null && weekly > 0) || !prep.damageWaiver || !prep.payment?.schedule) return out;
  if (prep.damageWaiver === "accepted" && !(ctx.waiverFee != null && ctx.waiverFee > 0)) {
    blockers.push({ field: "damage_waiver", label: "Damage Waiver Weekly Fee", why: "The Damage Waiver was accepted, but the template has no weekly Damage Waiver fee. The Owner sets it in the Agreement Builder." });
    return out;
  }
  const count = authorizedDriverCount(prep);
  const feeArg = ctx.additionalDriverWeeklyFee;
  if (feeArg !== undefined && count > 0 && !(feeArg != null && feeArg > 0)) {
    blockers.push({ field: "payment_amount", label: "Additional Driver Weekly Fee", why: "Approved drivers are listed, but the template has no weekly Additional Driver fee. The Owner sets it in the Agreement Builder." });
    return out;
  }
  const feeEach = feeArg != null && feeArg > 0 ? feeArg : 0;
  const driverWeekly = Math.round(count * feeEach * 100) / 100;
  const catalog = ctx.catalogWeeklyRate;
  const already = driverWeekly > 0 && catalog != null && catalog > 0 && cents(weekly) === cents(catalog) + cents(driverWeekly);
  const waiver = prep.damageWaiver === "accepted" ? (ctx.waiverFee as number) : 0;
  const rentWeekly = already ? (catalog as number) : weekly;
  const chargeWeekly = already ? weekly : Math.round((weekly + driverWeekly) * 100) / 100;
  const weeks = prep.payment.schedule === "every_4_weeks" ? 4 : 1;
  const each = Math.round((chargeWeekly + waiver) * weeks * 100) / 100;
  const fee = prep.reservation.mode === "required" ? (prep.reservation.amount ?? 0) : 0;
  if (fee > each) {
    blockers.push({ field: "reservation_fee", label: "A Reservation Fee no larger than the first payment", why: `The Reservation Fee (${usd(fee)}) is applied to the first payment (${usd(each)}) and cannot exceed it.` });
    return out;
  }
  const bits: string[] = [];
  if (driverWeekly > 0 || waiver > 0) {
    bits.push(`${usd(rentWeekly * weeks)} rent`);
    if (driverWeekly > 0) bits.push(`${usd(driverWeekly * weeks)} ${count === 1 ? "Additional Driver" : "Additional Drivers"}`);
    if (waiver > 0) bits.push(`${usd(waiver * weeks)} Damage Waiver`);
  }
  const parts = bits.length ? ` (${bits.join(" + ")})` : "";
  out.payment_amount = `${usd(each)} ${weeks === 4 ? "every 4 weeks" : "weekly"}${parts}`;
  out.balance_due = usd(Math.round((each - fee) * 100) / 100);
  const source: AgreementBillingSnapshot["source"] = driverWeekly <= 0 ? "none" : already ? "already_in_rate" : "added";
  out.billing = {
    weeklyAmount: Math.round((chargeWeekly + waiver) * 100) / 100,
    driverFeeEach: feeEach,
    driverCount: driverWeekly > 0 ? count : 0,
    driverFeesIncluded: driverWeekly > 0 ? driverWeekly : 0,
    source,
  };
  if (already) {
    out.driverFeeNote = "The Weekly Rate already includes the Additional Driver fee, so it was not added again. Amount Due Each Payment stays at this Weekly Rate.";
  }
  return out;
}
