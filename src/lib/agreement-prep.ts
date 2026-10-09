// Driver Agreement Preparation: the per-rental choices staff make before
// sending (authorized drivers, reservation fee, deposit). Client-safe.
//
// These are structured choices, never contract text. The server validates
// them, renders the agreement from the Owner's template, and includes them in
// the preview fingerprint, so Send refuses if anything changed after review.
import { z } from "zod";
import { fmtDate } from "@/lib/date-format";

const name = z.string().trim().max(120);
export const AdditionalDriverSchema = z.object({
  name,
  licenseNumber: z.string().trim().max(40),
  licenseState: z.string().trim().max(2),
  licenseExpiration: z.string().trim().max(10), // YYYY-MM-DD
  verified: z.boolean(),
});
export const PrepSchema = z.object({
  drivers: z.object({ mode: z.enum(["none", "listed"]), list: z.array(AdditionalDriverSchema).max(4) }),
  reservation: z.object({ mode: z.enum(["not_required", "required"]), amount: z.number().nonnegative().max(10000).nullable() }),
  deposit: z.object({
    mode: z.enum(["none", "required", "waived"]),
    amount: z.number().nonnegative().max(25000).nullable(),
    reason: z.string().trim().max(300),
  }),
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
        blockers.push({ field: "additional_drivers", label: `${n}: a license valid on the start date`, why: `The license expires ${fmtDate(d.licenseExpiration)}, before the rental starts.` });
      if (!d.verified)
        blockers.push({ field: "additional_drivers", label: `${n}: license verification`, why: "Staff must confirm they checked this driver's license before the driver is added to a signed agreement." });
      parts.push(`${d.name} (${d.licenseState.toUpperCase()} DL ${d.licenseNumber.toUpperCase()}, exp. ${fmtDate(d.licenseExpiration)})`);
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

  // Recorded with the agreement (merge_data) and covered by the fingerprint;
  // no template prints it.
  merge._prep = JSON.stringify(prep);
  return { merge, reservationLine, blockers };
}
