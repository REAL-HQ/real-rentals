// Maintenance + mileage — pure, client-safe rules (no I/O) shared by server
// functions, UI and tests. The database enforces the same odometer rules
// (odometer_readings_guard / vehicle_sync_current_odometer); this mirrors
// them for display and pre-checks.

export const SERVICE_CATEGORIES = [
  "oil_change", "tire_replacement", "tire_rotation", "brakes", "battery", "engine", "transmission",
  "cooling", "electrical", "alignment", "suspension", "air_conditioning", "scheduled_maintenance",
  "inspection", "recall", "body", "glass", "detailing", "towing", "diagnostic", "other",
] as const;

const CATEGORY_LABELS: Record<string, string> = {
  oil_change: "Oil Change", tire_replacement: "Tire Replacement", tire_rotation: "Tire Rotation",
  brakes: "Brake Service", battery: "Battery", engine: "Engine Repair", transmission: "Transmission Repair",
  cooling: "Cooling System", electrical: "Electrical", alignment: "Alignment", suspension: "Suspension",
  air_conditioning: "Air Conditioning", scheduled_maintenance: "Scheduled Maintenance", inspection: "Inspection",
  recall: "Recall", body: "Body Repair", glass: "Glass", detailing: "Detailing", towing: "Towing",
  diagnostic: "Diagnostic", other: "Other",
};
export function categoryLabel(c: string | null | undefined): string {
  if (!c) return "Other";
  return CATEGORY_LABELS[c] ?? c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}
/** Free-text category → normalized value. Unknown text stays "other"; never forced. */
export function normalizeCategory(s: string | null | undefined): string {
  const t = String(s ?? "").toLowerCase();
  if ((SERVICE_CATEGORIES as readonly string[]).includes(t)) return t;
  const rules: [RegExp, string][] = [
    [/oil|lube/, "oil_change"], [/rotat/, "tire_rotation"], [/tire|tyre/, "tire_replacement"],
    [/brake|rotor|pad/, "brakes"], [/batter/, "battery"], [/align/, "alignment"], [/transmission|trans fluid/, "transmission"],
    [/coolant|radiator|thermostat|water pump/, "cooling"], [/a\/c|air cond|freon/, "air_conditioning"],
    [/strut|shock|suspension|control arm/, "suspension"], [/alternator|starter|electr|fuse/, "electrical"],
    [/windshield|glass/, "glass"], [/tow/, "towing"], [/diagnos|scan/, "diagnostic"], [/inspect|emission/, "inspection"],
    [/recall/, "recall"], [/body|bumper|paint|dent/, "body"], [/detail|wash/, "detailing"], [/engine|spark|ignition/, "engine"],
    [/service|maintenance|filter/, "scheduled_maintenance"],
  ];
  for (const [re, c] of rules) if (re.test(t)) return c;
  return "other";
}

export const PAYMENT_METHODS = ["card", "cash", "cash_app", "venmo", "zelle", "ach", "check", "other"] as const;
export const PAYMENT_METHOD_LABELS: Record<string, string> = {
  card: "Card", cash: "Cash", cash_app: "Cash App", venmo: "Venmo", zelle: "Zelle", ach: "ACH", check: "Check", other: "Other",
};

/** Vendor matching key: "PEP BOYS" = "Pep Boys" = "PepBoys". Mirrors vendors.name_key. */
export function vendorKey(name: string | null | undefined): string {
  return String(name ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

export const SOURCE_LABELS: Record<string, string> = {
  service: "Service", inspection: "Inspection", rental_checkout: "Rental Pickup", rental_return: "Rental Return",
  manual: "Manual", fleet_inbox: "Fleet Inbox", title: "Title", registration: "Registration",
  odometer_photo: "Odometer Photo", incident: "Incident", other: "Other",
};

export type Reading = { id?: string; mileage: number; observed_on: string; observed_at?: string | null; status: string };

/** Material drop that makes a newer-dated reading suspicious (matches DB trigger). */
export const ODOMETER_TOLERANCE = 500;

/** Would a new reading conflict with history? Older-dated lower readings are fine. */
export function isOdometerConflict(history: Reading[], next: { mileage: number; observed_on: string }): boolean {
  return history.some((r) => r.status === "valid" && r.observed_on <= next.observed_on && r.mileage > next.mileage + ODOMETER_TOLERANCE);
}

/** Persisted selection requires stable UUIDs; conflict prechecks may use unsaved Reading inputs. */
export type PersistedReading = Reading & { id: string };
const readingUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const observationZone = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" });
function validObservationDate(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("invalid_observation_date");
  const [y, m, d] = value.split("-").map(Number);
  const ms = Date.UTC(y, m - 1, d);
  if (y < 1000 || y > 9999 || new Date(ms).toISOString().slice(0, 10) !== value) throw new RangeError("invalid_observation_date");
  return ms;
}
/** Exact microseconds for the supported PostgREST ISO timestamp format, never rounded to milliseconds. */
export function observationMicros(value: string): bigint {
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!m) throw new RangeError("invalid_observation_timestamp");
  const base = validObservationDate(m[1]);
  const hour = Number(m[2]), minute = Number(m[3]), second = Number(m[4]);
  const oh = m[6] === "Z" ? 0 : Number(m[6].slice(1, 3));
  const om = m[6] === "Z" ? 0 : Number(m[6].slice(4, 6));
  if (hour > 23 || minute > 59 || second > 59 || oh > 15 || om > 59) throw new RangeError("invalid_observation_timestamp");
  const offset = (oh * 60 + om) * (m[6][0] === "-" ? -1 : 1);
  return BigInt(base + ((hour * 60 + minute - offset) * 60 + second) * 1000) * 1000n + BigInt((m[5] ?? "").padEnd(6, "0"));
}
/**
 * Observation date, exact instant (unknown time last), then canonical UUID descending.
 * UUID order resolves ambiguity deterministically; it is not a claim of temporal recency.
 * Timestamp and observed_on must describe the same America/New_York calendar date.
 */
export function currentMileage(history: readonly PersistedReading[]): PersistedReading | null {
  const ids = new Set<string>();
  const valid = history.filter((r) => r.status === "valid").map((r) => {
    if (typeof r.id !== "string" || !readingUuid.test(r.id)) throw new RangeError("stable_reading_id_required");
    const id = r.id.toLowerCase();
    if (ids.has(id)) throw new RangeError("duplicate_reading_id");
    ids.add(id);
    validObservationDate(r.observed_on);
    const micros = r.observed_at == null ? null : observationMicros(r.observed_at);
    if (micros !== null) {
      // Floor before epoch as well: millisecond conversion is used ONLY for calendar-date validation.
      const millis = micros >= 0n ? micros / 1000n : (micros - 999n) / 1000n;
      const parts = observationZone.formatToParts(new Date(Number(millis)));
      const part = (type: string) => parts.find((p) => p.type === type)!.value;
      if (`${part("year")}-${part("month")}-${part("day")}` !== r.observed_on) throw new RangeError("observation_date_time_conflict");
    }
    return { r, id, micros };
  });
  valid.sort((a, b) => {
    if (a.r.observed_on !== b.r.observed_on) return a.r.observed_on < b.r.observed_on ? 1 : -1;
    if (a.micros !== b.micros) {
      if (a.micros === null) return 1;
      if (b.micros === null) return -1;
      return a.micros < b.micros ? 1 : -1;
    }
    return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
  });
  return valid[0]?.r ?? null;
}

export type DueState = "overdue" | "due" | "due_soon" | "ok" | "unknown";
export type ScheduleLike = {
  item: string; interval_miles: number | null; interval_days: number | null;
  last_done_on: string | null; last_done_miles: number | null;
};
export type DueResult = { state: DueState; reason: string; dueMiles: number | null; dueOn: string | null };

const DUE_SOON_MILES = 500;
const DUE_SOON_DAYS = 14;

function addDays(iso: string, days: number) {
  const d = new Date(iso + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10);
}
function daysBetween(a: string, b: string) {
  return Math.round((Date.parse(b + "T00:00:00Z") - Date.parse(a + "T00:00:00Z")) / 86400000);
}
const fmt = (n: number) => n.toLocaleString("en-US");

/** Whichever of miles/time comes first decides. Unknown last-service stays Unknown — never invented. */
export function dueStatus(s: ScheduleLike, currentMiles: number | null, today: string): DueResult {
  const dueMiles = s.interval_miles && s.last_done_miles != null ? s.last_done_miles + s.interval_miles : null;
  const dueOn = s.interval_days && s.last_done_on ? addDays(s.last_done_on, s.interval_days) : null;
  if (dueMiles == null && dueOn == null) return { state: "unknown", reason: "No Service On Record", dueMiles, dueOn };
  const milesLeft = dueMiles != null && currentMiles != null ? dueMiles - currentMiles : null;
  const daysLeft = dueOn ? daysBetween(today, dueOn) : null;
  const rank = (st: DueState) => ({ overdue: 3, due: 2, due_soon: 1, ok: 0, unknown: -1 }[st]);
  const byMiles: DueState | null = milesLeft == null ? null : milesLeft < 0 ? "overdue" : milesLeft === 0 ? "due" : milesLeft <= DUE_SOON_MILES ? "due_soon" : "ok";
  const byDays: DueState | null = daysLeft == null ? null : daysLeft < 0 ? "overdue" : daysLeft === 0 ? "due" : daysLeft <= DUE_SOON_DAYS ? "due_soon" : "ok";
  const pickMiles = byMiles != null && (byDays == null || rank(byMiles) >= rank(byDays));
  const state = (pickMiles ? byMiles : byDays) ?? "unknown";
  let reason = "";
  if (pickMiles && milesLeft != null) reason = milesLeft < 0 ? `Overdue By ${fmt(-milesLeft)} Miles` : milesLeft === 0 ? "Due Now" : `Due In ${fmt(milesLeft)} Miles`;
  else if (daysLeft != null) reason = daysLeft < 0 ? `Overdue By ${fmt(-daysLeft)} Days` : daysLeft === 0 ? "Due Today" : `Due In ${fmt(daysLeft)} Days`;
  return { state, reason, dueMiles, dueOn };
}

export function dueLabel(st: DueState) {
  return { overdue: "Overdue", due: "Due", due_soon: "Due Soon", ok: "All Clear", unknown: "Unknown" }[st];
}

/** Total of known parts; null when nothing is known (never 0 by default). */
export function sumKnown(...vals: (number | null | undefined)[]): number | null {
  const known = vals.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
  return known.length ? Math.round(known.reduce((a, b) => a + b, 0) * 100) / 100 : null;
}

export type TimelineKind = "vehicle" | "document" | "mileage" | "service" | "inspection" | "rental" | "incident" | "status" | "photo";
export type TimelineEvent = {
  id: string; kind: TimelineKind; at: string; title: string; detail?: string | null;
  ref: { table: string; id: string }; evidenceDocumentId?: string | null;
};
export const TIMELINE_FILTERS: { key: string; label: string; kinds: TimelineKind[] }[] = [
  { key: "all", label: "All", kinds: [] },
  { key: "rental", label: "Rental", kinds: ["rental"] },
  { key: "service", label: "Service", kinds: ["service", "mileage"] },
  { key: "inspection", label: "Inspection", kinds: ["inspection"] },
  { key: "incident", label: "Incident", kinds: ["incident"] },
  { key: "documents", label: "Documents", kinds: ["document", "photo"] },
];
export function sortTimeline(ev: TimelineEvent[]): TimelineEvent[] {
  return [...ev].sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** Business cost of a service = invoice total − warranty coverage − vendor credits/refunds (never below 0). Null when total unknown. */
export function netServiceCost(total: number | null | undefined, warranty?: number | null, credits?: number | null): number | null {
  if (total == null || !Number.isFinite(total)) return null;
  return Math.max(0, Math.round((total - (warranty ?? 0) - (credits ?? 0)) * 100) / 100);
}

/** Miles Driven is derived from the rental's pickup and return observations — never stored or hand-edited. */
export function milesDriven(pickup: number | null | undefined, ret: number | null | undefined): number | null {
  if (pickup == null || ret == null || ret < pickup) return null;
  return ret - pickup;
}
