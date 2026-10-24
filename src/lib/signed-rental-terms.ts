// Normalized rental terms for evidence. A new eSign agreement carries them in
// merge_data.record_rental_terms_v1 (behind SIGNED_RENTAL_TERMS_V1_ENABLED), so Record
// Rental can prove the signed start date, weekly rent and currency without parsing the
// formatted contract text. They are derived from the same values the contract prints,
// and refused if the two disagree. The contract signs a start DATE, not a time, so the
// block records the date in the business time zone and nothing finer.
import { z } from "zod";

export const SIGNED_TERMS_TIME_ZONE = "America/New_York" as const;
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const signedRentalTermsV1Schema = z.object({
  startDate: day,
  timeZone: z.literal(SIGNED_TERMS_TIME_ZONE),
  weeklyCents: z.number().int().positive().safe(),
  currency: z.literal("usd"),
}).strict();
export type SignedRentalTermsV1 = z.infer<typeof signedRentalTermsV1Schema>;

const printedMoney = (cents: number) =>
  `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

export function signedRentalTermsV1(startIso: string | null, weekly: unknown, printedWeekly: string): SignedRentalTermsV1 {
  const startDate = day.safeParse(startIso);
  if (!startDate.success || localDate(`${startDate.data}T12:00:00Z`, "UTC") !== startDate.data)
    throw new Error("The agreement has no exact start date to record in its signed terms.");
  const amount = Number(weekly);
  const cents = Math.round(amount * 100);
  if (!Number.isFinite(amount) || !(cents > 0) || Math.abs(amount * 100 - cents) > 1e-6)
    throw new Error("The agreement's weekly rent cannot be recorded exactly in its signed terms.");
  if (printedMoney(cents) !== printedWeekly)
    throw new Error("The agreement's printed weekly rent differs from the rent on record; regenerate the preview.");
  return { startDate: startDate.data, timeZone: SIGNED_TERMS_TIME_ZONE, weeklyCents: cents, currency: "usd" };
}

// Calendar date (YYYY-MM-DD) of an instant in a time zone.
export function localDate(instant: string, timeZone: string = SIGNED_TERMS_TIME_ZONE): string {
  const t = Date.parse(instant);
  if (!Number.isFinite(t)) throw new Error("Invalid instant");
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}

function offsetMs(t: number, timeZone: string): number {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit",
    day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - Math.floor(t / 1000) * 1000;
}

// The instant a calendar day begins in a time zone; equals Postgres
// (date::timestamp AT TIME ZONE zone). Used for a paper original's signing date.
export function zonedDayStart(date: string, timeZone: string = SIGNED_TERMS_TIME_ZONE): string {
  const d = day.parse(date).split("-").map(Number);
  const guess = Date.UTC(d[0], d[1] - 1, d[2]);
  let t = guess - offsetMs(guess, timeZone);
  t = guess - offsetMs(t, timeZone);
  const out = new Date(t).toISOString();
  if (localDate(out, timeZone) !== date) throw new Error("Invalid calendar date");
  return out;
}
