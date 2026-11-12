// v1.14 (Insurance Included) rental terms entered in Prepare Agreement.
// Client-safe. Kept apart from agreement-prep.ts so that module's exports stay
// those every earlier release bundles against (scripts/contract-date-format.test.mjs).
import { z } from "zod";
import { fmtContractDate, parseDateOnly } from "@/lib/agreement-dates";

type PrepBlocker = { field: string; label: string; why: string };
const name = z.string().trim().max(120);
const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * v1.14 (Insurance Included) rental terms that no record holds: staff state
 * them for this rental, and a missing one blocks sending. Only that family
 * prints them; other families ignore this object.
 */
export const RentalTermsSchema = z.object({
  startTime: z.string().trim().max(5), // HH:MM, 24-hour, business (Eastern) time
  schedule: z.enum(["weekly", "every_4_weeks"]).nullable(),
  paymentMethod: z.enum(["card_autopay", "zelle", "cash_app", "venmo", "other"]).nullable(),
  paymentMethodOther: z.string().trim().max(60),
  platforms: z.object({ rideshare: z.boolean(), delivery: z.boolean() }),
  damageWaiver: z.enum(["accepted", "declined"]).nullable(),
  vehicleOwner: z.string().trim().max(120),
  licenseInspectedBy: name,
  licenseInspectedOn: z.string().trim().max(10), // YYYY-MM-DD
  // Known only once the policy is bound after signing (Section 5.1); blank prints that.
  policyCompany: z.string().trim().max(80),
  policyNumber: z.string().trim().max(40),
  policyEffective: z.string().trim().max(10), // YYYY-MM-DD
  policyClaimsPhone: z.string().trim().max(20),
});
export type RentalTerms = z.infer<typeof RentalTermsSchema>;

export const EMPTY_RENTAL_TERMS: RentalTerms = {
  startTime: "", schedule: null, paymentMethod: null, paymentMethodOther: "",
  platforms: { rideshare: false, delivery: false }, damageWaiver: null, vehicleOwner: "",
  licenseInspectedBy: "", licenseInspectedOn: "",
  policyCompany: "", policyNumber: "", policyEffective: "", policyClaimsPhone: "",
};

export const DAMAGE_WAIVER_WEEKLY = 35;
export const POLICY_PENDING = "To Be Issued After Signing (Section 5.1)";

const PAYMENT_METHOD_LABEL: Record<string, string> = {
  card_autopay: "Card Autopay", zelle: "Zelle", cash_app: "Cash App", venmo: "Venmo",
};
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** "14:30" → "2:30 PM"; anything else → "". */
export function fmtClock(hhmm: string): string {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(hhmm.trim());
  if (!m) return "";
  const h = Number(m[1]);
  return `${h % 12 || 12}:${m[2]} ${h < 12 ? "AM" : "PM"}`;
}

/**
 * Pure: v1.14 merge values and blockers from the staff entries. weeklyRate is
 * the rate on record (null when unknown); todayIso the business date.
 */
export function applyRentalTerms(
  r: RentalTerms | null | undefined,
  ctx: { startIso: string | null; weeklyRate: number | null; todayIso: string },
): { merge: Record<string, string>; blockers: PrepBlocker[] } {
  const blockers: PrepBlocker[] = [];
  const merge: Record<string, string> = {};
  const need = (field: string, label: string, why: string) => blockers.push({ field, label, why });
  if (!r) {
    need("rental_terms", "Rental terms for this agreement", "The Insurance Included agreement prints the start time, payment schedule and method, platform use, Damage Waiver choice, Vehicle Owner and license inspection. Enter them under Rental Terms.");
    return { merge, blockers };
  }

  const start = parseDateOnly(ctx.startIso);
  const clock = fmtClock(r.startTime);
  if (!clock) need("start_datetime", "Rental start time", "Enter the pickup time (the date comes from the rental record).");
  merge.start_datetime = start && clock ? `${fmtContractDate(ctx.startIso)}, ${clock}` : "";

  if (!r.schedule) need("payment_schedule", "Payment schedule", "Choose Weekly or Every 4 Weeks.");
  merge.payment_schedule = r.schedule === "weekly" ? "Weekly" : r.schedule === "every_4_weeks" ? "Every 4 Weeks" : "";

  if (!r.damageWaiver) need("damage_waiver", "Damage Waiver accepted or declined", "The renter's choice prints on page 1 and is initialed when they sign.");
  merge.damage_waiver = r.damageWaiver === "accepted" ? "[X] Accepted   [ ] Declined" : r.damageWaiver === "declined" ? "[ ] Accepted   [X] Declined" : "";

  // Amount Due Each Payment: the Weekly Rate (insurance included) plus the
  // Damage Waiver if accepted, times 4 on the 4-week schedule. Due Day is the
  // weekday of the Rental Start Date (Section 3.4: same day each period).
  const rate = ctx.weeklyRate != null && ctx.weeklyRate > 0 ? ctx.weeklyRate : null;
  if (rate && r.schedule && r.damageWaiver && start) {
    const week = rate + (r.damageWaiver === "accepted" ? DAMAGE_WAIVER_WEEKLY : 0);
    const day = WEEKDAYS[new Date(Date.UTC(start.y, start.m - 1, start.d)).getUTCDay()];
    merge.amount_due = r.schedule === "weekly" ? `${usd(week)} / ${day}` : `${usd(week * 4)} / ${day}, every 4 weeks`;
  } else merge.amount_due = "";

  if (!r.paymentMethod) need("payment_method", "Payment method", "Choose Card Autopay, Zelle, Cash App, Venmo or Other.");
  else if (r.paymentMethod === "other" && r.paymentMethodOther.length < 2) need("payment_method", "Payment method (Other)", "Name the other payment method.");
  merge.payment_method = !r.paymentMethod ? "" : r.paymentMethod === "other" ? (r.paymentMethodOther.length >= 2 ? `Other: ${r.paymentMethodOther}` : "") : PAYMENT_METHOD_LABEL[r.paymentMethod];

  if (!r.platforms.rideshare && !r.platforms.delivery) need("platform_use", "Approved Platform Use", "Mark Rideshare, Delivery or both (Sections 5.4 and 10).");
  merge.platform_use = r.platforms.rideshare || r.platforms.delivery
    ? `${r.platforms.rideshare ? "[X]" : "[ ]"} Rideshare (Uber, Lyft)   ${r.platforms.delivery ? "[X]" : "[ ]"} Delivery`
    : "";

  if (r.vehicleOwner.length < 2) need("vehicle_owner", "Vehicle Owner (as shown on the registration)", "Copy the owner's name from the vehicle's registration.");
  merge.vehicle_owner = r.vehicleOwner.length >= 2 ? r.vehicleOwner : "";

  const insp = parseDateOnly(r.licenseInspectedOn);
  if (r.licenseInspectedBy.split(/\s+/).filter(Boolean).length < 2) need("license_inspected", "License inspected by (staff full name)", "Section 19: we inspect the license before the rental begins. Enter who inspected it.");
  if (!insp) need("license_inspected", "License inspection date", "Enter the date the license was inspected.");
  else if (r.licenseInspectedOn > ctx.todayIso) need("license_inspected", "A license inspection date that is not in the future", `${fmtContractDate(r.licenseInspectedOn)} has not happened yet.`);
  merge.license_inspected = insp && r.licenseInspectedBy && r.licenseInspectedOn <= ctx.todayIso ? `${r.licenseInspectedBy} / ${fmtContractDate(r.licenseInspectedOn)}` : "";

  // Renter Policy rows: all blank prints that it is issued after signing;
  // a partly entered pair is refused rather than printed half-empty.
  const pol = [r.policyCompany, r.policyNumber];
  if (pol.every((v) => !v)) merge.renter_policy = POLICY_PENDING;
  else if (pol.some((v) => !v)) { need("renter_policy", "Renter Policy company and policy number", "Enter both, or leave both blank if the policy is issued after signing."); merge.renter_policy = ""; }
  else merge.renter_policy = `${r.policyCompany} / ${r.policyNumber}`;
  const eff = [r.policyEffective, r.policyClaimsPhone];
  if (eff.every((v) => !v)) merge.renter_policy_dates = POLICY_PENDING;
  else if (eff.some((v) => !v) || !parseDateOnly(r.policyEffective)) { need("renter_policy_dates", "Renter Policy effective date and claims phone", "Enter both, or leave both blank if the policy is issued after signing."); merge.renter_policy_dates = ""; }
  else merge.renter_policy_dates = `${fmtContractDate(r.policyEffective)} / ${r.policyClaimsPhone}`;

  return { merge, blockers };
}
