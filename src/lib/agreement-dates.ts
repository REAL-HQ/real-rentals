// Contract date arithmetic, on dates.
//
// This module exists because of a bug worth never repeating. buildMergeData
// renders the contract's start date for the human, and two places then read
// that RENDERED STRING back with
//
//     String(data.start_date).match(/^(\d{2})-(\d{2})-(\d{4})$/)
//
// to recover the date and add the template's minimum term to it. That worked
// only for as long as fmtDate happened to print MM-DD-YYYY. When the app-wide
// date format became "Oct 11, 2026" the regex stopped matching, and two things
// broke silently:
//
//   min_term_end was never computed, so the "Minimum-term end date" blocker
//   fired and the agreement could not be SENT at all on any template printing
//   it; and
//
//   startIso went null, so applyPrep stopped checking that an additional
//   driver's licence is still valid on the rental's start date — a safety
//   check that failed open.
//
// A calculation must never read a display string. The real date is threaded
// through to here instead, so how a date is SHOWN and what it COMPUTES can
// never be coupled again.
//
// Everything here is calendar arithmetic in UTC on a date-only value: a
// contract start date is the 11th of October wherever the reader is sitting,
// and must not shift by a timezone. Date.UTC normalises overflow for us, so
// day 31 + 7 becomes the 7th of the next month, leap years included, without a
// month table to get wrong.

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A date-only ISO string, or null if it is not one. */
export function parseDateOnly(v: unknown): { y: number; m: number; d: number } | null {
  if (typeof v !== "string") return null;
  const m = DATE_ONLY.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject a day that does not exist in that month (2026-02-30), rather than
  // letting Date.UTC roll it quietly into March.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}

/** The ISO date-only string a Date represents, read in UTC. */
function isoOf(dt: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}

/**
 * The minimum-term end date: the start date plus `weeks` whole weeks.
 *
 * Returns null when there is nothing to compute — no start date, no term, or a
 * start date that is not a real calendar date. Null is the honest answer and
 * the caller leaves the field blank, which is what makes the existing
 * "Minimum-term end date" blocker fire instead of a contract printing a
 * guessed date.
 */
export function minTermEndIso(startIso: unknown, weeks: number): string | null {
  const p = parseDateOnly(startIso);
  if (!p) return null;
  if (!Number.isFinite(weeks) || weeks <= 0) return null;
  return isoOf(new Date(Date.UTC(p.y, p.m - 1, p.d + Math.floor(weeks) * 7)));
}

/**
 * The weeks a template's minimum term states, or 0 when it states none.
 *
 * The term is author-entered text ("4 weeks", "4"), so the digits are taken
 * out of it rather than trusting a shape.
 */
export function minTermWeeks(raw: unknown): number {
  const n = Number(String(raw ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * The business timezone contract dates are read in. REAL RENTALS operates in
 * Eastern Time (the same zone every other business-day calculation in src/lib
 * uses), and the server runs in UTC.
 */
export const CONTRACT_TIME_ZONE = "America/New_York";

const CONTRACT_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: CONTRACT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** English month abbreviations, the same ones Release A's contracts print. */
const CONTRACT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/**
 * A date as it is PRINTED INSIDE A RENTAL AGREEMENT: "Oct 11, 2026".
 *
 * The Owner chose the human-readable form, which is exactly what Release A's
 * contracts already print, so live wording does not change. What changes is
 * WHERE it is formatted. Contract fields used to call `fmtDate` from
 * @/lib/date-format, the application-wide display helper, so any dashboard
 * format decision would have changed the wording of an agreement (and its
 * preview fingerprint) with no template edit, no new version and no Owner
 * approval. Contract text formats dates HERE, and nothing in here imports the
 * UI formatter. (Structure ported from e208920d; output format per the Owner.)
 *
 * Canonical values stay ISO: merge-data inputs and database columns are
 * YYYY-MM-DD, and calculations (minTermEndIso) read those, never this string.
 *
 * A date-only value (a start date, a licence expiry) is printed from its own
 * three fields and never goes near a timezone: the 11th of October is the
 * 11th wherever the reader is sitting.
 *
 * An INSTANT (the execution date, `{{today}}`, is `new Date()`) is printed as
 * its calendar day in America/New_York, NOT the server's zone. The server runs
 * in UTC, so reading the instant there printed tomorrow's date on any evening
 * after 8pm EDT / 7pm EST, and because `today` is part of the preview
 * fingerprint, a preview reviewed at 7:59pm EDT refused to Send at 8:01pm.
 *
 * An unparseable or impossible value (2026-02-30) returns "" rather than a
 * guess. A blank field makes the existing readiness blockers fire, which is
 * the honest outcome; an invented date would print into a signed contract.
 */
export function fmtContractDate(v: unknown): string {
  const out = (y: number, m: number, d: number) => `${CONTRACT_MONTHS[m - 1]} ${d}, ${y}`;
  const p = parseDateOnly(v);
  if (p) return out(p.y, p.m, p.d);
  // Date-shaped but not a real day (2026-02-30): refuse, rather than let
  // new Date() roll it into March.
  if (typeof v === "string" && DATE_ONLY.test(v.trim())) return "";
  // Realm-safe Date check: `instanceof Date` is false for a Date built in
  // another JS realm (a vm sandbox, a worker), which would blank the field.
  const isDate = Object.prototype.toString.call(v) === "[object Date]";
  const d = isDate ? new Date((v as Date).getTime()) : typeof v === "string" && v.trim() ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(CONTRACT_DAY.formatToParts(d).map((x) => [x.type, x.value]));
  return out(Number(parts.year), Number(parts.month), Number(parts.day));
}

/**
 * A DATE-ONLY contract field (a licence expiry): "Jun 1, 2029", or "".
 *
 * Strictly a YYYY-MM-DD calendar day, printed from its own three fields by
 * fmtContractDate, so it can never shift a day across timezones. Anything else
 * — an instant, "06/01/2029", "2029-02-30", text — returns "" rather than
 * reaching fmtContractDate's instant branch, which would read a local-midnight
 * string in America/New_York and print the day before on a server east of
 * Eastern. The caller turns "" into a readiness blocker; a contract never
 * prints a date nobody recorded.
 */
export function fmtContractDateOnly(v: unknown): string {
  return parseDateOnly(v) ? fmtContractDate(v) : "";
}
