// One date format for the whole site (display only):
//   fmtDate         Oct 11, 2026
//   fmtDateTime     Oct 11, 2026, 7:30 AM ET   (America/New_York)
//   fmtDateNumeric  10/11/2026   (tight spaces, exports a person reads)
// Date-only strings ("2026-10-11") are read as calendar dates, never shifted
// by timezone. Stored values, sorting, filtering and API formats stay ISO.

type DateInput = string | number | Date | null | undefined;

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Oct 11, 2026. Returns "" for empty/invalid input. */
export function fmtDate(v: DateInput, ..._ignored: unknown[]): string {
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  }
  const d = toDate(v);
  if (!d) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

const EASTERN_TIME_ZONE = "America/New_York";

/**
 * Oct 11, 2026, 7:30 AM ET.
 * Instants render in America/New_York. A date-only string stays that
 * calendar day at 12:00 AM ET, so the device zone cannot move it.
 */
export function fmtDateTime(v: DateInput, ..._ignored: unknown[]): string {
  if (typeof v === "string" && DATE_ONLY.test(v.trim())) return `${fmtDate(v)}, 12:00 AM ET`;
  const d = toDate(v);
  if (!d) return "";
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(d);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: EASTERN_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  }).format(d).replace(/[\u202f\u00a0]/g, " ");
  return `${date}, ${time} ET`;
}

/** 10/11/2026 */
export function fmtDateNumeric(v: DateInput): string {
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  }
  const d = toDate(v);
  if (!d) return "";
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}
