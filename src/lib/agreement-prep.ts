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
/**
 * The minimum rental term, in whole weeks, chosen per agreement.
 *
 * v1.13 prints the term in six places — the Key Rental Terms band, the
 * Rental & Vehicle Information row, Section 1, the Early Return rule, the Fee
 * Schedule and an acknowledgment — and computes the minimum-term end date
 * from it. All six read the SAME template term, so this is one value, not six
 * strings to keep in step.
 *
 * 1 to 52: a term of zero weeks is not a minimum term, and a year is past
 * the point where "weeks" is the right unit for the contract to be using.
 */
export const MIN_TERM_WEEKS_DEFAULT = 4;
export const MinTermSchema = z.object({ weeks: z.number().int().min(1).max(52) });

export const PrepSchema = z.object({
  drivers: z.object({ mode: z.enum(["none", "listed"]), list: z.array(AdditionalDriverSchema).max(4) }),
  minTerm: MinTermSchema.optional(),
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
  minTerm: { weeks: MIN_TERM_WEEKS_DEFAULT },
  reservation: { mode: "not_required", amount: null },
  deposit: { mode: "none", amount: null, reason: "" },
};

export type PrepBlocker = { field: string; label: string; why: string };

const usd = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten",
  "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty"];

/**
 * The minimum term as the contract says it: "four (4)", "six (6)",
 * "twenty-six (26)".
 *
 * Section 1 reads "a minimum term of [[min_term_words]] consecutive weeks",
 * so the words and the digits must agree — a contract that says "four (6)"
 * is ambiguous on its single most important number, and a signer could
 * reasonably read either. Derived from the one chosen integer rather than
 * typed, so they cannot disagree.
 */
export function minTermWords(weeks: number): string {
  const n = Math.floor(weeks);
  if (!Number.isFinite(n) || n < 1 || n > 52) return "";
  const w = n < 20 ? ONES[n] : `${TENS[Math.floor(n / 10)]}${n % 10 ? `-${ONES[n % 10]}` : ""}`;
  return `${w} (${n})`;
}

/**
 * Pure: turns staff choices into merge values / term overrides and blockers.
 * startIso is the contract start date (YYYY-MM-DD) or null.
 */
export function applyPrep(
  prep: AgreementPrep,
  ctx: { startIso: string | null; depositClause: string },
): { merge: Record<string, string>; reservationLine: string; termOverrides: Record<string, string>; blockers: PrepBlocker[] } {
  const blockers: PrepBlocker[] = [];
  const merge: Record<string, string> = {};
  // Template values this rental overrides. Written into the body's
  // %%BUILDER_TERMS%% line by the caller, so they are inside the rendered
  // text AND inside the preview fingerprint — change the term, change the
  // fingerprint, and a Send that was approved against the old one is refused.
  const termOverrides: Record<string, string> = {};

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

  // Minimum term. Absent means the template's own value stands, which is how
  // a template that does not print a term keeps working untouched.
  if (prep.minTerm) {
    const w = prep.minTerm.weeks;
    if (!Number.isInteger(w) || w < 1 || w > 52) {
      blockers.push({ field: "min_term_weeks", label: "Minimum term between 1 and 52 weeks", why: `${w} is not a usable minimum term.` });
    } else {
      termOverrides.min_term_weeks = String(w);
      termOverrides.min_term_words = minTermWords(w);
    }
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
  return { merge, reservationLine, termOverrides, blockers };
}
