/**
 * Pickup schedule (client-safe, pure). Stored in app_settings under
 * PICKUP_SCHEDULE_SETTINGS_KEY. Defaults: Monday to Friday, 9:30, 10:30 and
 * 11:30 AM Eastern, one hour each, one booking per slot, earliest first.
 *
 * Closed dates: US federal holidays (and the weekday they are observed on when
 * they fall on a weekend), Christmas Eve and New Year's Eve are always
 * blocked, plus any date in blockedDates. The Friday after Thanksgiving is open.
 *
 * A booked slot is a rentals row with status "reserved" whose start_date and
 * reservation_note pickup_time match the slot (see reservations.ts).
 */

export const PICKUP_SCHEDULE_SETTINGS_KEY = "pickup_schedule";
export const PICKUP_TIMEZONE = "America/New_York";
export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

export type PickupNotifySettings = {
  /** Master switch for the staff SMS and email on a fully confirmed reservation. Off by default. */
  enabled: boolean;
  /** E.164 numbers texted from the main business line. */
  sms: string[];
  emails: string[];
  /** When true (default), a reservation is only "fully confirmed" once the rental agreement is signed. */
  requireSignedAgreement: boolean;
};

export type PickupScheduleSettings = {
  /** 0 = Sunday ... 6 = Saturday. */
  days: number[];
  /** 24-hour HH:mm Eastern start times, earliest first. */
  startTimes: string[];
  slotMinutes: number;
  /** Slots that start sooner than this are not offered. */
  minNoticeMinutes: number;
  /** How many days ahead FLEET and staff are offered. */
  horizonDays: number;
  timezone: typeof PICKUP_TIMEZONE;
  /** Prefilled pickup location; FLEET uses it when it does not send one. */
  defaultLocation: string | null;
  fieldRep: { name: string };
  notify: PickupNotifySettings;
  /** Extra closed dates (YYYY-MM-DD, Eastern), on top of the built-in holidays. */
  blockedDates: string[];
};

export const DEFAULT_PICKUP_SCHEDULE: PickupScheduleSettings = {
  days: [1, 2, 3, 4, 5],
  startTimes: ["09:30", "10:30", "11:30"],
  slotMinutes: 60,
  minNoticeMinutes: 120,
  horizonDays: 14,
  timezone: PICKUP_TIMEZONE,
  defaultLocation: "3500 E Hillsborough Ave, Tampa, FL 33610",
  fieldRep: { name: "Dolmar Cross" },
  notify: {
    enabled: false,
    sms: ["+18134768508"],
    emails: ["DolmarCross@gmail.com", "Team@DriveReal.com"],
    requireSignedAgreement: true,
  },
  blockedDates: [],
};

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const E164 = /^\+1[2-9]\d{9}$/;
const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}
export function fromMinutes(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}

/** Normalize a US phone to E.164 (+1XXXXXXXXXX) or null. */
export function normalizeUsPhone(raw: unknown): string | null {
  const digits = String(raw ?? "").replace(/\D/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  const e = `+1${ten}`;
  return ten.length === 10 && E164.test(e) ? e : null;
}

function uniq<T>(xs: T[]): T[] {
  return [...new Set(xs)];
}

/** Validate a candidate; returns the clean settings or a list of problems. */
export function validatePickupSchedule(input: unknown): { ok: true; value: PickupScheduleSettings } | { ok: false; errors: string[] } {
  const v = (input && typeof input === "object" && !Array.isArray(input) ? input : {}) as Record<string, any>;
  const errors: string[] = [];
  const days = uniq((Array.isArray(v.days) ? v.days : []).map(Number)).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort();
  if (!days.length) errors.push("Pick at least one pickup day.");
  const rawTimes = Array.isArray(v.startTimes) ? v.startTimes.map((t: unknown) => String(t).trim()) : [];
  if (rawTimes.some((t: string) => !HHMM.test(t))) errors.push("Start times must be HH:mm (24-hour).");
  const startTimes = uniq(rawTimes.filter((t: string) => HHMM.test(t))).sort((a, b) => toMinutes(a) - toMinutes(b));
  if (!startTimes.length) errors.push("Add at least one start time.");
  if (startTimes.length > 12) errors.push("At most 12 start times a day.");
  const slotMinutes = Number(v.slotMinutes);
  if (!Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 240) errors.push("Slot length must be 15 to 240 minutes.");
  else {
    for (let i = 1; i < startTimes.length; i++) {
      if (toMinutes(startTimes[i]) - toMinutes(startTimes[i - 1]) < slotMinutes) {
        errors.push(`Start times ${startTimes[i - 1]} and ${startTimes[i]} are closer than the ${slotMinutes}-minute slot length.`);
      }
    }
    const last = startTimes[startTimes.length - 1];
    if (last && toMinutes(last) + slotMinutes > 24 * 60) errors.push("The last slot must end the same day.");
  }
  const minNoticeMinutes = Number(v.minNoticeMinutes ?? DEFAULT_PICKUP_SCHEDULE.minNoticeMinutes);
  if (!Number.isInteger(minNoticeMinutes) || minNoticeMinutes < 0 || minNoticeMinutes > 7 * 24 * 60) errors.push("Minimum notice must be 0 to 10080 minutes.");
  const horizonDays = Number(v.horizonDays ?? DEFAULT_PICKUP_SCHEDULE.horizonDays);
  if (!Number.isInteger(horizonDays) || horizonDays < 1 || horizonDays > 60) errors.push("Booking window must be 1 to 60 days.");
  const loc = v.defaultLocation == null ? "" : String(v.defaultLocation).trim();
  if (loc && (loc.length < 3 || loc.length > 180)) errors.push("Default pickup location must be 3 to 180 characters.");
  const repName = String(v.fieldRep?.name ?? "").trim();
  if (repName.length < 2 || repName.length > 80) errors.push("Field rep name must be 2 to 80 characters.");
  const n = (v.notify && typeof v.notify === "object" ? v.notify : {}) as Record<string, any>;
  const rawSms = Array.isArray(n.sms) ? n.sms : [];
  const sms = uniq(rawSms.map(normalizeUsPhone).filter(Boolean) as string[]);
  if (sms.length !== rawSms.length && rawSms.some((p: unknown) => !normalizeUsPhone(p))) errors.push("Every text recipient must be a US mobile number.");
  if (sms.length > 5) errors.push("At most 5 text recipients.");
  const rawEmails = Array.isArray(n.emails) ? n.emails.map((e: unknown) => String(e).trim()) : [];
  if (rawEmails.some((e: string) => !EMAIL.test(e))) errors.push("Every email recipient must be a valid address.");
  const emails = uniq(rawEmails.filter((e: string) => EMAIL.test(e)));
  if (emails.length > 10) errors.push("At most 10 email recipients.");
  const rawBlocked = v.blockedDates == null ? [] : Array.isArray(v.blockedDates) ? v.blockedDates.map((d: unknown) => String(d).trim()) : null;
  if (rawBlocked === null) errors.push("Blocked dates must be a list of YYYY-MM-DD dates.");
  else if (rawBlocked.some((d: string) => !isCalendarDate(d))) errors.push("Blocked dates must be YYYY-MM-DD dates.");
  const blockedDates = uniq((rawBlocked ?? []).filter(isCalendarDate)).sort();
  if (blockedDates.length > 200) errors.push("At most 200 blocked dates.");
  const enabled = n.enabled === true;
  if (enabled && !sms.length && !emails.length) errors.push("Turn on notifications only with at least one recipient.");
  if (errors.length) return { ok: false, errors };
  return {
    ok: true,
    value: {
      days, startTimes, slotMinutes, minNoticeMinutes, horizonDays, timezone: PICKUP_TIMEZONE,
      defaultLocation: loc || null,
      fieldRep: { name: repName },
      notify: { enabled, sms, emails, requireSignedAgreement: n.requireSignedAgreement !== false },
      blockedDates,
    },
  };
}

/** Stored value -> settings. Missing or invalid falls back to the defaults (notifications Off). */
export function readPickupSchedule(value: unknown): PickupScheduleSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return structuredClone(DEFAULT_PICKUP_SCHEDULE);
  const v = value as Record<string, any>;
  const merged = {
    ...DEFAULT_PICKUP_SCHEDULE,
    ...v,
    fieldRep: { ...DEFAULT_PICKUP_SCHEDULE.fieldRep, ...(v.fieldRep ?? {}) },
    notify: { ...DEFAULT_PICKUP_SCHEDULE.notify, ...(v.notify ?? {}) },
  };
  const r = validatePickupSchedule(merged);
  return r.ok ? r.value : structuredClone(DEFAULT_PICKUP_SCHEDULE);
}

// -------------------------------------------------------------- holidays

/** A real YYYY-MM-DD calendar date. */
export function isCalendarDate(raw: unknown): raw is string {
  const s = String(raw ?? "");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function ymd(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The nth (1-based) weekday of a month; n = -1 is the last one. */
function nthWeekday(year: number, month: number, weekday: number, n: number): string {
  if (n > 0) {
    const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
    return ymd(year, month, 1 + ((weekday - first + 7) % 7) + (n - 1) * 7);
  }
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const last = new Date(Date.UTC(year, month - 1, lastDay)).getUTCDay();
  return ymd(year, month, lastDay - ((last - weekday + 7) % 7));
}

/**
 * Built-in closed dates for a year: the 11 US federal holidays, the weekday a
 * weekend federal holiday is observed on (Saturday -> Friday, Sunday ->
 * Monday), Christmas Eve and New Year's Eve. Not the Friday after Thanksgiving.
 */
export function builtInHolidays(year: number): Map<string, string> {
  const out = new Map<string, string>();
  const fixed: [number, number, string][] = [
    [1, 1, "New Year's Day"],
    [6, 19, "Juneteenth"],
    [7, 4, "Independence Day"],
    [11, 11, "Veterans Day"],
    [12, 25, "Christmas Day"],
  ];
  for (const [m, d, name] of fixed) {
    const date = ymd(year, m, d);
    out.set(date, name);
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (wd === 6 || wd === 0) {
      const obs = addDays(date, wd === 6 ? -1 : 1);
      if (!out.has(obs)) out.set(obs, `${name} (Observed)`);
    }
  }
  out.set(nthWeekday(year, 1, 1, 3), "Martin Luther King Jr. Day");
  out.set(nthWeekday(year, 2, 1, 3), "Presidents Day");
  out.set(nthWeekday(year, 5, 1, -1), "Memorial Day");
  out.set(nthWeekday(year, 9, 1, 1), "Labor Day");
  out.set(nthWeekday(year, 10, 1, 2), "Columbus Day / Indigenous Peoples' Day");
  out.set(nthWeekday(year, 11, 4, 4), "Thanksgiving");
  for (const [m, d, name] of [[12, 24, "Christmas Eve"], [12, 31, "New Year's Eve"]] as [number, number, string][]) {
    const date = ymd(year, m, d);
    if (!out.has(date)) out.set(date, name);
  }
  // New Year's Day on a Saturday is observed the Friday before (Dec 31, already closed).
  return out;
}

/** Why a date is closed for pickups ("Thanksgiving", "Blocked"), or null when it is open. */
export function blockedDateReason(s: Pick<PickupScheduleSettings, "blockedDates">, date: string): string | null {
  if (!isCalendarDate(date)) return null;
  const holiday = builtInHolidays(Number(date.slice(0, 4))).get(date);
  if (holiday) return holiday;
  if ((s.blockedDates ?? []).includes(date)) return "Blocked";
  return null;
}

export function isBlockedDate(s: Pick<PickupScheduleSettings, "blockedDates">, date: string): boolean {
  return blockedDateReason(s, date) != null;
}

/** Closed dates from `from` through `days` days ahead, for display. */
export function upcomingBlockedDates(s: Pick<PickupScheduleSettings, "blockedDates">, from: string, days: number): { date: string; reason: string }[] {
  const out: { date: string; reason: string }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(from, i);
    const reason = blockedDateReason(s, date);
    if (reason) out.push({ date, reason });
  }
  return out;
}

// ------------------------------------------------------------------ time

/** Offset like "-05:00" for a wall-clock date+time in the zone. */
export function zoneOffset(date: string, time: string, timeZone = PICKUP_TIMEZONE): string {
  const guess = new Date(`${date}T${time}:00Z`);
  const name = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(guess).find((p) => p.type === "timeZoneName")?.value ?? "GMT-05:00";
  let off = name.replace("GMT", "") || "+00:00";
  // Re-check at the corrected instant (DST edges).
  const corrected = new Date(`${date}T${time}:00${off}`);
  const name2 = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(corrected).find((p) => p.type === "timeZoneName")?.value;
  if (name2) off = name2.replace("GMT", "") || "+00:00";
  return off;
}

export function slotIso(date: string, time: string, timeZone = PICKUP_TIMEZONE): string {
  return `${date}T${time}:00${zoneOffset(date, time, timeZone)}`;
}

/** Calendar date (YYYY-MM-DD) and weekday in the zone. */
export function zoneDate(at: Date, timeZone = PICKUP_TIMEZONE): { date: string; weekday: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const date = `${get("year")}-${get("month")}-${get("day")}`;
  return { date, weekday: WEEKDAY_LABELS.indexOf(get("weekday") as any) };
}

function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function slotKey(date: string, time: string): string {
  return `${date} ${time}`;
}

export type PickupSlot = { date: string; time: string; start_at: string; end_at: string; label: string };

export function slotLabel(date: string, time: string): string {
  const [h, m] = time.split(":").map(Number);
  const wd = WEEKDAY_LABELS[new Date(`${date}T12:00:00Z`).getUTCDay()];
  const [, mo, d] = date.split("-").map(Number);
  return `${wd} ${mo}/${d} ${h % 12 || 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"} ET`;
}

/**
 * Open slots, earliest first. `booked` holds slotKey(date, time) of reserved
 * rentals. Slots starting within minNoticeMinutes of `now` are skipped, and
 * so are holidays and blocked dates.
 */
export function openPickupSlots(s: PickupScheduleSettings, now: Date, booked: ReadonlySet<string>, opts: { days?: number; limit?: number } = {}): PickupSlot[] {
  const horizon = Math.min(Math.max(1, opts.days ?? s.horizonDays), 60);
  const limit = Math.max(1, Math.min(opts.limit ?? 50, 200));
  const earliest = now.getTime() + s.minNoticeMinutes * 60_000;
  const today = zoneDate(now, s.timezone).date;
  const out: PickupSlot[] = [];
  for (let i = 0; i < horizon && out.length < limit; i++) {
    const date = addDays(today, i);
    const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!s.days.includes(weekday)) continue;
    if (isBlockedDate(s, date)) continue;
    for (const time of s.startTimes) {
      if (out.length >= limit) break;
      if (booked.has(slotKey(date, time))) continue;
      const start_at = slotIso(date, time, s.timezone);
      if (new Date(start_at).getTime() < earliest) continue;
      out.push({ date, time, start_at, end_at: slotIso(date, fromMinutes(toMinutes(time) + s.slotMinutes), s.timezone), label: slotLabel(date, time) });
    }
  }
  return out;
}

/** Whether date+time is one of the schedule's slots (any notice). */
export function isScheduledSlot(s: PickupScheduleSettings, date: string, time: string): boolean {
  const weekday = new Date(`${date}T12:00:00Z`).getUTCDay();
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && s.days.includes(weekday) && s.startTimes.includes(time);
}

/** Parse "2026-11-18T09:00:00-05:00" into the zone's date and HH:mm. */
export function parseSlotStart(raw: unknown, timeZone = PICKUP_TIMEZONE): { date: string; time: string } | null {
  const s = String(raw ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(s)) return null;
  const at = new Date(s);
  if (Number.isNaN(at.getTime())) return null;
  const { date } = zoneDate(at, timeZone);
  const hm = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at);
  return { date, time: hm };
}

// ------------------------------------------------------------ confirmation

export type ConfirmationInput = {
  rentalStatus: string | null;
  applicationStatus: string | null;
  pickupDate: string | null;
  pickupTime: string | null;
  pickupLocation: string | null;
  depositStatus: string | null;
  signedAgreement: boolean;
  requireSignedAgreement: boolean;
};

/**
 * "Fully confirmed" (the reservation_confirmed event and staff notice):
 *  1. the rental is reserved (rentals.status = reserved);
 *  2. the applicant is Approved or Active;
 *  3. a pickup date, time and location are set;
 *  4. the reservation deposit is not pending (not required, paid or waived);
 *  5. the rental agreement is signed (unless the setting turns that off).
 */
export function confirmationGaps(i: ConfirmationInput): string[] {
  const gaps: string[] = [];
  if (String(i.rentalStatus ?? "").toLowerCase() !== "reserved") gaps.push("not_reserved");
  if (!["approved", "active"].includes(String(i.applicationStatus ?? "").toLowerCase())) gaps.push("not_approved");
  if (!i.pickupDate || !i.pickupTime) gaps.push("no_pickup_time");
  if (!i.pickupLocation) gaps.push("no_pickup_location");
  const dep = String(i.depositStatus ?? "not_required");
  if (!["not_required", "paid", "waived", "applied"].includes(dep)) gaps.push("deposit_not_paid");
  if (i.requireSignedAgreement && !i.signedAgreement) gaps.push("agreement_not_signed");
  return gaps;
}
