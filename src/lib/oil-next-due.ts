/**
 * Read-time oil change next due and mileage-photo reminder.
 *
 * Nothing here writes a schedule, a notification, or a text. A saved
 * next_due_miles (staff entry or a sticker extract) always wins. When that
 * column is empty, the next due mileage is computed for display only.
 */
import { normalizeCategory } from "@/lib/maintenance-rules";

/** Rideshare oil interval when Settings has no Oil Change miles interval. */
export const DEFAULT_OIL_CHANGE_INTERVAL_MILES = 5000;

/** Miles remaining at or under this count raise a mileage-photo reminder. */
export const OIL_CHANGE_REMINDER_WINDOW_MILES = 500;

/** A reading older than this many days is too old to trust for the window. */
export const OIL_CHANGE_STALE_READING_DAYS = 14;

const MILEAGE_MAX = 1_999_999;

export type OilNextDueSource = "explicit" | "auto" | "unset";
export type OilNextDueBase = "service" | "odometer";

export type EffectiveOilNextDue = {
  miles: number | null;
  source: OilNextDueSource;
  baseMiles: number | null;
  baseKind: OilNextDueBase | null;
  intervalMiles: number;
};

export type OilServiceRecord = {
  status?: string | null;
  item?: string | null;
  category?: string | null;
  performed_on?: string | null;
  odometer?: unknown;
  items?: Array<{ category?: string | null; description?: string | null }> | null;
};

export type SettingsIntervalRow = {
  item?: string | null;
  category?: string | null;
  interval_miles?: unknown;
  is_active?: boolean | null;
};

export function parseIsoDate(value: unknown): string | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (typeof value !== "string") return null;
  const match = /^(\d{4}-\d{2}-\d{2})(?:$|T)/.exec(value.trim());
  if (!match) return null;
  const [year, month, day] = match[1].split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return match[1];
}

/** Whole miles from 0 through 1,999,999. Fractions and blanks are not a value. */
export function parseOilMiles(value: unknown): number | null {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= MILEAGE_MAX) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const n = Number(value.trim());
    if (Number.isInteger(n) && n >= 0 && n <= MILEAGE_MAX) return n;
  }
  return null;
}

function labelKey(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

/** Settings row titled Oil Change, not a looser "oil filter" match. */
export function isExactOilChangeLabel(value: unknown): boolean {
  const key = labelKey(value);
  return key === "oil change" || key === "oil changes";
}

/** Oil change schedule or service line. "Oil Filter" alone does not match. */
export function isOilChangeItem(value: unknown): boolean {
  if (isExactOilChangeLabel(value)) return true;
  const raw = String(value ?? "").trim();
  if (!raw) return false;
  if (labelKey(raw) === "oil_change" || labelKey(raw) === "oil change") return true;
  if (/\boil filter\b/i.test(raw) && !/\boil change\b/i.test(raw)) return false;
  return normalizeCategory(raw) === "oil_change" && /\boil\b/i.test(raw);
}

export function companyOilChangeIntervalMiles(rows: SettingsIntervalRow[] | null | undefined): number | null {
  const active = (rows ?? []).filter((row) => row.is_active !== false);
  const exactItem = active.find((row) => isExactOilChangeLabel(row.item));
  const exactCategory = active.find(
    (row) => isExactOilChangeLabel(row.category) || labelKey(row.category) === "oil change",
  );
  const miles = parseOilMiles((exactItem ?? exactCategory)?.interval_miles);
  return miles != null && miles > 0 ? miles : null;
}

function recordIsOilChange(record: OilServiceRecord): boolean {
  if (isExactOilChangeLabel(record.item) || isExactOilChangeLabel(record.category)) return true;
  if (labelKey(record.category) === "oil change") return true;
  const blob = [record.item, record.category, ...(record.items ?? []).flatMap((item) => [item.category, item.description])]
    .filter(Boolean)
    .join(" ");
  if (/\boil filter\b/i.test(blob) && !/\boil change\b/i.test(blob)) return false;
  return /\boil change\b/i.test(blob);
}

function isCompleted(status: string | null | undefined): boolean {
  const key = String(status ?? "").trim().toLowerCase();
  if (!key) return true;
  return key === "completed";
}

/** Newest completed oil change that recorded a mileage. Open work does not count. */
export function lastCompletedOilServiceMiles(records: OilServiceRecord[] | null | undefined): number | null {
  const hits = (records ?? []).filter((record) => isCompleted(record.status) && recordIsOilChange(record) && parseOilMiles(record.odometer) != null);
  hits.sort((a, b) => {
    const aOn = parseIsoDate(a.performed_on) ?? "";
    const bOn = parseIsoDate(b.performed_on) ?? "";
    if (aOn !== bOn) return aOn < bOn ? 1 : -1;
    return (parseOilMiles(b.odometer) ?? 0) - (parseOilMiles(a.odometer) ?? 0);
  });
  return hits[0] ? parseOilMiles(hits[0].odometer) : null;
}

/**
 * Explicit saved miles win. Otherwise last oil-change service mileage plus the
 * interval, otherwise the latest odometer plus the interval. No date is invented.
 * Settings supplies the interval when an Oil Change row has miles; otherwise 5,000.
 */
export function effectiveOilNextDue(input: {
  explicitNextDueMiles: unknown;
  lastOilServiceMiles: unknown;
  latestOdometerMiles: unknown;
  settingsIntervalMiles: unknown;
}): EffectiveOilNextDue {
  const settingsInterval = parseOilMiles(input.settingsIntervalMiles);
  const intervalMiles = settingsInterval != null && settingsInterval > 0 ? settingsInterval : DEFAULT_OIL_CHANGE_INTERVAL_MILES;
  const explicit = parseOilMiles(input.explicitNextDueMiles);
  if (explicit != null) {
    return { miles: explicit, source: "explicit", baseMiles: null, baseKind: null, intervalMiles };
  }
  const service = parseOilMiles(input.lastOilServiceMiles);
  const odometer = parseOilMiles(input.latestOdometerMiles);
  const baseMiles = service != null ? service : odometer;
  const baseKind: OilNextDueBase | null = service != null ? "service" : odometer != null ? "odometer" : null;
  if (baseMiles == null || baseKind == null) {
    return { miles: null, source: "unset", baseMiles: null, baseKind: null, intervalMiles };
  }
  const sum = baseMiles + intervalMiles;
  if (!Number.isSafeInteger(sum) || sum > MILEAGE_MAX) {
    return { miles: null, source: "unset", baseMiles: null, baseKind: null, intervalMiles };
  }
  return { miles: sum, source: "auto", baseMiles, baseKind, intervalMiles };
}

/** Miles an oil-change due/overdue check should compare. Other items stay as stored. */
export function oilDueMilesForAlert(
  item: string,
  storedNextDueMiles: unknown,
  inputs: {
    lastOilServiceMiles: unknown;
    latestOdometerMiles: unknown;
    settingsIntervalMiles: unknown;
  },
): number | null {
  if (!isOilChangeItem(item)) return parseOilMiles(storedNextDueMiles);
  return effectiveOilNextDue({
    explicitNextDueMiles: storedNextDueMiles,
    lastOilServiceMiles: inputs.lastOilServiceMiles,
    latestOdometerMiles: inputs.latestOdometerMiles,
    settingsIntervalMiles: inputs.settingsIntervalMiles,
  }).miles;
}

export function autoNextDueTooltip(baseMiles: number, intervalMiles: number): string {
  const fmt = (n: number) => n.toLocaleString("en-US");
  return `Based On ${fmt(baseMiles)} Mi + ${fmt(intervalMiles)} Mi. Edit To Override.`;
}

export function calendarDaysBetween(earlier: string, later: string): number | null {
  const start = parseIsoDate(earlier);
  const end = parseIsoDate(later);
  if (!start || !end) return null;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

export function latestReadingDate(
  readings: Array<{ observed_on?: unknown; status?: string | null }> | null | undefined,
  fallback?: unknown,
): string | null {
  const dates = (readings ?? [])
    .filter((row) => (row.status ?? "valid") === "valid")
    .map((row) => parseIsoDate(row.observed_on))
    .filter((day): day is string => day != null)
    .sort();
  if (dates.length) return dates[dates.length - 1];
  return parseIsoDate(fallback);
}

export function oilReminderCycleKey(vehicleId: string, dueMiles: number | null): string {
  return `oil:${vehicleId}:${dueMiles ?? "unset"}`;
}

export type OilReminderReason = "within_window" | "overdue" | "stale_reading";
export type OilReminderSkip = "no_renter" | "already_pending" | "not_due";

export type OilReminderDecision =
  | { eligible: false; reason: OilReminderSkip; cycleKey: string }
  | {
      eligible: true;
      reason: OilReminderReason;
      reasonLabel: string;
      cycleKey: string;
      milesRemaining: number | null;
      draft: string;
    };

export function oilChangeReminderText(input: {
  fullName?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}): string {
  const first = String(input.fullName ?? "").trim().split(/\s+/)[0] || "there";
  const vehicle = [input.year, input.make, input.model].map((part) => String(part ?? "").trim()).filter(Boolean).join(" ") || "vehicle";
  return `Hi ${first}, it's Rosa with REAL RENTALS. Your ${vehicle} is coming up on an oil change. Please reply with a clear photo of your dashboard showing the current miles so we can schedule it. Don't worry, we pay for the oil change!`;
}

export function oilReminderReasonLabel(reason: OilReminderReason, readingOn: string | null): string {
  if (reason === "overdue") return "Oil Change Overdue";
  if (reason === "within_window") return `Oil Change Due Within ${OIL_CHANGE_REMINDER_WINDOW_MILES.toLocaleString("en-US")} Miles`;
  if (!readingOn) return "No Mileage Reading On File";
  return `Mileage Reading Older Than ${OIL_CHANGE_STALE_READING_DAYS} Days`;
}

/**
 * One decision per vehicle. No renter and an existing pending draft for this
 * due cycle both refuse. Overdue uses the effective mileage even when the
 * reading is old (miles only climb). A stale reading with miles still left
 * asks for a photo because the window cannot be trusted.
 */
export function oilChangeReminderEligibility(input: {
  vehicleId: string;
  hasCurrentRenter: boolean;
  effectiveDueMiles: unknown;
  latestOdometerMiles: unknown;
  latestReadingOn: string | null;
  today: string;
  pendingCycleKey: string | null;
  fullName?: string | null;
  year?: number | null;
  make?: string | null;
  model?: string | null;
}): OilReminderDecision {
  const due = parseOilMiles(input.effectiveDueMiles);
  const odometer = parseOilMiles(input.latestOdometerMiles);
  const cycleKey = oilReminderCycleKey(input.vehicleId, due);
  if (!input.hasCurrentRenter) return { eligible: false, reason: "no_renter", cycleKey };
  if (input.pendingCycleKey && input.pendingCycleKey === cycleKey) {
    return { eligible: false, reason: "already_pending", cycleKey };
  }
  const remaining = due != null && odometer != null ? due - odometer : null;
  const age = input.latestReadingOn ? calendarDaysBetween(input.latestReadingOn, input.today) : null;
  const stale = !input.latestReadingOn || age == null || age > OIL_CHANGE_STALE_READING_DAYS;
  let reason: OilReminderReason | null = null;
  if (remaining != null && remaining <= 0) reason = "overdue";
  else if (stale) reason = "stale_reading";
  else if (remaining != null && remaining <= OIL_CHANGE_REMINDER_WINDOW_MILES) reason = "within_window";
  if (!reason) return { eligible: false, reason: "not_due", cycleKey };
  return {
    eligible: true,
    reason,
    reasonLabel: oilReminderReasonLabel(reason, input.latestReadingOn),
    cycleKey,
    milesRemaining: remaining,
    draft: oilChangeReminderText(input),
  };
}
