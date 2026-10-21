import { CONTACT_STATUS_KEYS } from "./contact-status";
import { ACTIVE_LEAD_STATUSES, leadToday } from "./lead-priorities";

/** Hard off. Declared once. Not an environment variable. */
export const LEAD_RESPONSE_REPORT_ENABLED: boolean = false;

export const LEAD_RESPONSE_READ_LIMIT = 200;

export const LEAD_RESPONSE_COLUMNS =
  "source,created_at,contacted_at,contact_follow_up_on";

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function assertLeadResponseReportEnabled(): void {
  if (LEAD_RESPONSE_REPORT_ENABLED !== true) {
    throw new Error("Lead response report is not enabled");
  }
}

export type LeadResponseSource = {
  source: string;
  medianHours: number | null;
  uncontactedOver24h: number;
  followUpsDue: number;
};

export type LeadResponseReport = {
  sources: LeadResponseSource[];
  truncated: boolean;
  readLimit: number;
};

type ResponseAdmin = {
  from: (table: string) => { select: (columns: string) => any };
};

type RawLead = {
  source?: unknown;
  created_at?: unknown;
  contacted_at?: unknown;
  contact_follow_up_on?: unknown;
};

function stamp(value: unknown): number | null {
  if (typeof value !== "string" || value.length === 0) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

function calendarDay(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (
    utc.getUTCFullYear() !== year ||
    utc.getUTCMonth() !== month - 1 ||
    utc.getUTCDate() !== day
  ) {
    return null;
  }
  return value;
}

function sourceLabel(value: unknown): string {
  if (typeof value !== "string") return "Unknown";
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : "Unknown";
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value = sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  return Math.round(value * 10) / 10;
}

/** Hours from created to contacted_at. contacted_at is written once, on first contact. */
export function hoursToFirstContact(createdAt: unknown, contactedAt: unknown): number | null {
  const created = stamp(createdAt);
  const contacted = stamp(contactedAt);
  if (created == null || contacted == null || contacted < created) return null;
  return (contacted - created) / HOUR_MS;
}

export function formatResponseHours(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours)) return "—";
  if (hours < 1 / 60) return "Under 1 Minute";
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return minutes === 1 ? "1 Minute" : `${minutes} Minutes`;
  }
  const rounded = Math.round(hours * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return text === "1" ? "1 Hour" : `${text} Hours`;
}

export function buildLeadResponseReport(
  rows: readonly RawLead[],
  now = new Date(),
  truncated = false,
): LeadResponseReport {
  const today = leadToday(now);
  const nowMs = now.getTime();
  const grouped = new Map<
    string,
    { hours: number[]; uncontactedOver24h: number; followUpsDue: number }
  >();
  for (const row of rows) {
    const source = sourceLabel(row?.source);
    const bucket = grouped.get(source) ?? { hours: [], uncontactedOver24h: 0, followUpsDue: 0 };
    const created = stamp(row?.created_at);
    const hours = hoursToFirstContact(row?.created_at, row?.contacted_at);
    if (hours != null) bucket.hours.push(hours);
    if (created != null && stamp(row?.contacted_at) == null && nowMs - created > DAY_MS) {
      bucket.uncontactedOver24h += 1;
    }
    const due = calendarDay(row?.contact_follow_up_on);
    if (due != null && due <= today) bucket.followUpsDue += 1;
    grouped.set(source, bucket);
  }
  const sources = [...grouped.entries()]
    .map(([source, bucket]) => ({
      source,
      medianHours: median(bucket.hours),
      uncontactedOver24h: bucket.uncontactedOver24h,
      followUpsDue: bucket.followUpsDue,
    }))
    .sort(
      (a, b) =>
        b.uncontactedOver24h - a.uncontactedOver24h ||
        b.followUpsDue - a.followUpsDue ||
        a.source.localeCompare(b.source),
    );
  return { sources, truncated, readLimit: LEAD_RESPONSE_READ_LIMIT };
}

/**
 * Read-only. The flag is checked before any query. The read asks for one
 * extra row so a full page is not presented as the whole book.
 */
export async function loadLeadResponseReport(
  admin: ResponseAdmin,
  now = new Date(),
): Promise<{ ok: false; skipped: "flag" } | { ok: true; report: LeadResponseReport }> {
  if (LEAD_RESPONSE_REPORT_ENABLED !== true) {
    return { ok: false, skipped: "flag" };
  }
  const result = await admin
    .from("applications")
    .select(LEAD_RESPONSE_COLUMNS)
    .is("deleted_at", null)
    .in("status", [...ACTIVE_LEAD_STATUSES])
    .in(
      "contact_status",
      CONTACT_STATUS_KEYS.filter((status) => status !== "unqualified"),
    )
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LEAD_RESPONSE_READ_LIMIT + 1);
  if (result.error) throw new Error("Lead response report could not be loaded");
  const rows = Array.isArray(result.data) ? (result.data as RawLead[]) : [];
  const truncated = rows.length > LEAD_RESPONSE_READ_LIMIT;
  return {
    ok: true,
    report: buildLeadResponseReport(
      truncated ? rows.slice(0, LEAD_RESPONSE_READ_LIMIT) : rows,
      now,
      truncated,
    ),
  };
}
