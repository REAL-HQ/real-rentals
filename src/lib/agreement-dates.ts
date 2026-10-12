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
 * A date as it is PRINTED INSIDE A RENTAL AGREEMENT: MM-DD-YYYY.
 *
 * This exists because of the other half of the bug this module's header
 * describes. The calculation half was fixed by threading the real date
 * through instead of parsing a rendered string. The printing half was not:
 * `buildMergeData` and `applyPrep` still formatted contract fields with
 * `fmtDate` from @/lib/date-format — the APPLICATION-WIDE display helper.
 *
 * When that helper changed from MM-DD-YYYY to "Oct 11, 2026", the wording of
 * the agreement changed with it. Six contract fields moved — the start and
 * return dates, the renter's date of birth, the execution date, the
 * minimum-term end and an additional driver's licence expiry — with no
 * template edit, no new version and no Owner approval. The rendered body
 * feeds the preview SHA-256, so the fingerprint moved too.
 *
 * Contract wording changes only through an Owner-approved template version.
 * A CSS-adjacent decision about how the dashboard shows a date must never be
 * able to do it. So contract text formats dates HERE, and nothing in here
 * imports the UI formatter.
 *
 * A date-only value (a start date, a licence expiry) is printed from its own
 * three fields and never goes near a timezone: the 11th of October is the
 * 11th wherever the reader is sitting. An INSTANT — the execution date is
 * `new Date()` — is printed from its local calendar day, because the day a
 * contract was executed is the day it was where it was signed, and because
 * reading it in UTC would print tomorrow's date on a Tampa evening.
 *
 * An unparseable value returns "" rather than a guess. A blank field makes
 * the existing readiness blockers fire, which is the honest outcome; an
 * invented date would print into a signed contract.
 */
export function fmtContractDate(v: unknown): string {
  const p2 = (n: number) => String(n).padStart(2, "0");
  const p = parseDateOnly(v);
  if (p) return `${p2(p.m)}-${p2(p.d)}-${p.y}`;
  const d = v instanceof Date ? v : typeof v === "string" ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${d.getFullYear()}`;
}
