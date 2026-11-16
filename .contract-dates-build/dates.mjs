// src/lib/agreement-dates.ts
var DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
var MINIMUM_RENTAL_WEEKS = 4;
function contractTodayIso(now = /* @__PURE__ */ new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: CONTRACT_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}
function parseDateOnly(v) {
  if (typeof v !== "string") return null;
  const m = DATE_ONLY.exec(v.trim());
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 1 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) {
    return null;
  }
  return { y, m: mo, d };
}
function isoOf(dt) {
  const p = (n) => String(n).padStart(2, "0");
  return `${dt.getUTCFullYear()}-${p(dt.getUTCMonth() + 1)}-${p(dt.getUTCDate())}`;
}
function minTermEndIso(startIso, weeks) {
  const p = parseDateOnly(startIso);
  if (!p) return null;
  if (!Number.isFinite(weeks) || weeks <= 0) return null;
  return isoOf(new Date(Date.UTC(p.y, p.m - 1, p.d + Math.floor(weeks) * 7)));
}
function defaultRentalEndIso(startIso) {
  return minTermEndIso(startIso, MINIMUM_RENTAL_WEEKS);
}
function rentalEndBeforeMinimum(startIso, endIso) {
  if (typeof endIso !== "string" || !parseDateOnly(endIso)) return false;
  const minimum = defaultRentalEndIso(startIso);
  return Boolean(minimum && endIso < minimum);
}
function minTermWeeks(raw) {
  const n = Number(String(raw ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(n) && n > 0 ? n : 0;
}
var CONTRACT_TIME_ZONE = "America/New_York";
var CONTRACT_DAY = new Intl.DateTimeFormat("en-US", {
  timeZone: CONTRACT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});
var CONTRACT_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function fmtContractDate(v) {
  const out = (y, m, d2) => `${CONTRACT_MONTHS[m - 1]} ${d2}, ${y}`;
  const p = parseDateOnly(v);
  if (p) return out(p.y, p.m, p.d);
  if (typeof v === "string" && DATE_ONLY.test(v.trim())) return "";
  const isDate = Object.prototype.toString.call(v) === "[object Date]";
  const d = isDate ? new Date(v.getTime()) : typeof v === "string" && v.trim() ? new Date(v) : null;
  if (!d || Number.isNaN(d.getTime())) return "";
  const parts = Object.fromEntries(CONTRACT_DAY.formatToParts(d).map((x) => [x.type, x.value]));
  return out(Number(parts.year), Number(parts.month), Number(parts.day));
}
function fmtContractDateOnly(v) {
  return parseDateOnly(v) ? fmtContractDate(v) : "";
}
export {
  CONTRACT_TIME_ZONE,
  MINIMUM_RENTAL_WEEKS,
  contractTodayIso,
  defaultRentalEndIso,
  fmtContractDate,
  fmtContractDateOnly,
  minTermEndIso,
  minTermWeeks,
  parseDateOnly,
  rentalEndBeforeMinimum
};
