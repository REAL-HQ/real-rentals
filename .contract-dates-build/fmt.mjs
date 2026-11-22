// src/lib/date-format.ts
var DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;
var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function toDate(v) {
  if (v === null || v === void 0 || v === "") return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v;
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  }
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}
var pad = (n) => String(n).padStart(2, "0");
function fmtDate(v, ..._ignored) {
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
  }
  const d = toDate(v);
  if (!d) return "";
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}
function fmtDateTime(v, ..._ignored) {
  const d = toDate(v);
  if (!d) return "";
  const t = d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  return `${fmtDate(d)}, ${t}`;
}
function formatReservationTime(raw) {
  const value = String(raw ?? "").trim();
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return "Not Set";
  const hour = Number(value.slice(0, 2));
  return `${hour % 12 || 12}:${value.slice(3)} ${hour >= 12 ? "PM" : "AM"}`;
}
function fmtDateNumeric(v) {
  if (typeof v === "string") {
    const m = DATE_ONLY.exec(v.trim());
    if (m) return `${m[2]}/${m[3]}/${m[1]}`;
  }
  const d = toDate(v);
  if (!d) return "";
  return `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
}
var ET_PARTS = new Intl.DateTimeFormat("en-US", {
  timeZone: "America/New_York",
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true
});
function fmtActivityStamp(v) {
  if (typeof v === "string" && DATE_ONLY.test(v.trim())) return fmtDate(v);
  const d = toDate(v);
  if (!d) return "";
  const p = {};
  for (const part of ET_PARTS.formatToParts(d)) p[part.type] = part.value;
  return `${p.month} ${p.day}, ${p.year} \xB7 ${p.hour}:${p.minute} ${p.dayPeriod.toUpperCase()} ET`;
}
export {
  fmtActivityStamp,
  fmtDate,
  fmtDateNumeric,
  fmtDateTime,
  formatReservationTime
};
