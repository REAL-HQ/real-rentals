/**
 * Insurance quotes over the included amount (Dolmar, t299s1618): "Automatically
 * offer a higher weekly rate to cover it." Client-safe, no I/O.
 *
 * The weekly rate includes insurance up to INSURANCE_INCLUDED_MONTHLY a month.
 * Above that, the extra is spread over the year's weeks and rounded UP to the
 * next $5, so the rate always covers the quote:
 *
 *   surcharge/week = ceil5( (monthly quote - 350) x 12 / 52 )
 *   offered weekly = listed weekly rate + surcharge/week
 *
 * Example: $450/month quote on a $325/week car -> (450 - 350) x 12 / 52 =
 * $23.08 -> $25/week -> $350/week.
 *
 * Nothing here names an insurance company or marks anyone insured.
 */

export const INSURANCE_INCLUDED_MONTHLY = 350;
export const INSURANCE_RATE_STEP = 5;
/** Quotes above this go to staff even with the switch on (sanity ceiling, $/month). */
export const INSURANCE_QUOTE_MAX_AUTO = 1000;
export const INSURANCE_RATE_SETTINGS_KEY = "insurance_rate_adjust";

export type InsuranceRateSettings = { enabled: boolean; includedMonthly: number; maxAutoMonthly: number };
export const INSURANCE_RATE_DEFAULTS: InsuranceRateSettings = {
  enabled: false,
  includedMonthly: INSURANCE_INCLUDED_MONTHLY,
  maxAutoMonthly: INSURANCE_QUOTE_MAX_AUTO,
};

export function readInsuranceRateSettings(value: unknown): InsuranceRateSettings {
  const v = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<string, unknown>;
  const num = (x: unknown, d: number) => (Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : d);
  return {
    enabled: v.enabled === true,
    includedMonthly: num(v.included_monthly, INSURANCE_INCLUDED_MONTHLY),
    maxAutoMonthly: num(v.max_auto_monthly, INSURANCE_QUOTE_MAX_AUTO),
  };
}

/** Weekly surcharge in whole dollars (a multiple of $5); 0 at or under the included amount. */
export function insuranceSurchargeWeekly(monthlyQuote: number, includedMonthly = INSURANCE_INCLUDED_MONTHLY): number {
  if (!Number.isFinite(monthlyQuote) || monthlyQuote <= includedMonthly) return 0;
  const cents = Math.round((monthlyQuote - includedMonthly) * 100);
  const weeklyCents = Math.ceil((cents * 12) / 52);
  const step = INSURANCE_RATE_STEP * 100;
  return (Math.ceil(weeklyCents / step) * step) / 100;
}

export function insuranceAdjustedRate(listedWeekly: number, monthlyQuote: number | null, includedMonthly = INSURANCE_INCLUDED_MONTHLY) {
  const surcharge = monthlyQuote == null ? 0 : insuranceSurchargeWeekly(monthlyQuote, includedMonthly);
  return { listed: listedWeekly, surcharge, weekly: Math.round((listedWeekly + surcharge) * 100) / 100 };
}

function money(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** "Wed, Nov 18" */
export function quoteDay(date: string): string {
  const d = new Date(`${date}T12:00:00Z`);
  const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getUTCDay()];
  const mo = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][d.getUTCMonth()];
  return `${wd}, ${mo} ${d.getUTCDate()}`;
}

/**
 * FLEET's quote text (a YES reply confirms the terms, t298s1611). With an
 * insurance surcharge the text says the rate includes it; the weekly amount is
 * the one the agreement prints. Wording needs Dolmar's OK before first use.
 */
export function fleetQuoteText(q: {
  vehicle: string;
  weekly: number;
  surcharge: number;
  deposit: number;
  startDate: string;
  location: string;
  /** The Reservation Fee collected by card after signing, when that switch is on (t299s1618, t309u). Not a deposit. */
  reservationFee?: number;
}): string {
  // The per-car security deposit (refundable, used for fees during the rental).
  // Never the Reservation Fee, which is applied to rent (Dolmar, t309u).
  const deposit = q.deposit > 0 ? `$${money(q.deposit)} security deposit` : "no security deposit";
  const rate = q.surcharge > 0
    ? `$${money(q.weekly)}/week (includes $${money(q.surcharge)}/week for your insurance quote)`
    : `$${money(q.weekly)}/week`;
  return `Real Rentals: Your quote is ready: ${q.vehicle} at ${rate}, ${deposit}, starting ${quoteDay(q.startDate)} with pickup at ${q.location}. Rent is paid weekly.${q.reservationFee && q.reservationFee > 0 ? ` After you sign, you'll pay a $${money(q.reservationFee)} Reservation Fee by card to hold the car. It is applied to your first week, and that card is saved on file for your rental balance.` : ""} Reply YES to accept and we'll send your rental agreement to sign. Reply STOP to opt out.`;
}
