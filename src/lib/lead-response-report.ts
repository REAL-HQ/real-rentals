import { CONTACT_STATUS_KEYS } from "./contact-status";
import { ACTIVE_LEAD_STATUSES, leadToday } from "./lead-priorities";

/** Hard off. Declared once. Not an environment variable. */
export const LEAD_RESPONSE_REPORT_ENABLED: boolean = false;

export const LEAD_RESPONSE_READ_LIMIT = 200;

/** Page size for the follow-up count. It is not the newest-200 response sample. */
export const LEAD_RESPONSE_FOLLOW_UP_PAGE = 1000;

export const LEAD_RESPONSE_COLUMNS =
  "source,created_at,contacted_at,contact_status,contact_status_at,contact_follow_up_on";

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
  contactBeforeCreated: number;
};

export type LeadResponseReport = {
  sources: LeadResponseSource[];
  truncated: boolean;
  readLimit: number;
  followUpsTruncated: boolean;
};

type ResponseAdmin = {
  from: (table: string) => { select: (columns: string) => any };
};

type RawLead = {
  source?: unknown;
  created_at?: unknown;
  contacted_at?: unknown;
  contact_status?: unknown;
  contact_status_at?: unknown;
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

/** Exact median. Display rounding happens in formatResponseHours, not here. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * First contact matches Lead Priorities. The Contact Status cell writes
 * contact_status and contact_status_at, not contacted_at. A lead is contacted
 * when that status has left "new", or when the lifecycle stamp contacted_at
 * is set. The time is the earlier of those stamps.
 */
export function firstContact(row: RawLead): {
  contacted: boolean;
  hours: number | null;
  beforeCreated: boolean;
} {
  const status = typeof row?.contact_status === "string" ? row.contact_status : "new";
  if (status === "unqualified") return { contacted: false, hours: null, beforeCreated: false };
  const contactedAt = stamp(row?.contacted_at);
  const statusAt = status !== "new" ? stamp(row?.contact_status_at) : null;
  const contacted = status !== "new" || contactedAt != null;
  if (!contacted) return { contacted: false, hours: null, beforeCreated: false };
  const stamps = [contactedAt, statusAt].filter((value): value is number => value != null);
  const created = stamp(row?.created_at);
  if (stamps.length === 0 || created == null) return { contacted: true, hours: null, beforeCreated: false };
  const at = Math.min(...stamps);
  if (at < created) return { contacted: true, hours: null, beforeCreated: true };
  return { contacted: true, hours: (at - created) / HOUR_MS, beforeCreated: false };
}

export function formatResponseHours(hours: number | null): string {
  if (hours == null || !Number.isFinite(hours) || hours < 0) return "—";
  if (hours < 1 / 60) return "Under 1 Minute";
  if (hours < 1) {
    const minutes = Math.round(hours * 60);
    return minutes === 1 ? "1 Minute" : `${minutes} Minutes`;
  }
  const rounded = Math.round(hours * 10) / 10;
  const text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
  return text === "1" ? "1 Hour" : `${text} Hours`;
}

export function emptySource(source: string): LeadResponseSource {
  return {
    source,
    medianHours: null,
    uncontactedOver24h: 0,
    followUpsDue: 0,
    contactBeforeCreated: 0,
  };
}

export function buildLeadResponseReport(
  rows: readonly RawLead[],
  now = new Date(),
  truncated = false,
): LeadResponseReport {
  const nowMs = now.getTime();
  const grouped = new Map<string, { hours: number[]; uncontactedOver24h: number; contactBeforeCreated: number }>();
  for (const row of rows) {
    if (row?.contact_status === "unqualified") continue;
    const source = sourceLabel(row?.source);
    const bucket = grouped.get(source) ?? { hours: [], uncontactedOver24h: 0, contactBeforeCreated: 0 };
    const contact = firstContact(row);
    if (contact.hours != null) bucket.hours.push(contact.hours);
    if (contact.beforeCreated) bucket.contactBeforeCreated += 1;
    const created = stamp(row?.created_at);
    if (!contact.contacted && created != null && nowMs - created > DAY_MS) bucket.uncontactedOver24h += 1;
    grouped.set(source, bucket);
  }
  const sources = [...grouped.entries()]
    .map(([source, bucket]) => ({
      ...emptySource(source),
      medianHours: median(bucket.hours),
      uncontactedOver24h: bucket.uncontactedOver24h,
      contactBeforeCreated: bucket.contactBeforeCreated,
    }))
    .sort(
      (a, b) =>
        b.uncontactedOver24h - a.uncontactedOver24h ||
        b.followUpsDue - a.followUpsDue ||
        a.source.localeCompare(b.source),
    );
  return { sources, truncated, readLimit: LEAD_RESPONSE_READ_LIMIT, followUpsTruncated: false };
}

/** Due follow-ups from rows already limited to the due predicate. Not the response sample. */
export function addDueFollowUps(
  counts: Map<string, number>,
  rows: readonly RawLead[],
  now = new Date(),
): void {
  const today = leadToday(now);
  for (const row of rows) {
    if (row?.contact_status === "unqualified") continue;
    const due = calendarDay(row?.contact_follow_up_on);
    if (due == null || due > today) continue;
    const source = sourceLabel(row?.source);
    counts.set(source, (counts.get(source) ?? 0) + 1);
  }
}

export function applyFollowUpCounts(
  report: LeadResponseReport,
  counts: ReadonlyMap<string, number>,
  followUpsTruncated: boolean,
): LeadResponseReport {
  const bySource = new Map(report.sources.map((source) => [source.source, { ...source, followUpsDue: 0 }]));
  for (const [source, count] of counts) {
    const row = bySource.get(source) ?? emptySource(source);
    row.followUpsDue = count;
    bySource.set(source, row);
  }
  const sources = [...bySource.values()].sort(
    (a, b) =>
      b.uncontactedOver24h - a.uncontactedOver24h ||
      b.followUpsDue - a.followUpsDue ||
      a.source.localeCompare(b.source),
  );
  return { ...report, sources, followUpsTruncated };
}

function activeContactStatuses(): string[] {
  return CONTACT_STATUS_KEYS.filter((status) => status !== "unqualified");
}

/**
 * Read-only. The flag is checked before any query. Response times come from
 * a newest-page read. Follow-ups due are counted on their own, not from that page.
 */
export async function loadLeadResponseReport(
  admin: ResponseAdmin,
  now = new Date(),
): Promise<{ ok: false; skipped: "flag" } | { ok: true; report: LeadResponseReport }> {
  if (LEAD_RESPONSE_REPORT_ENABLED !== true) {
    return { ok: false, skipped: "flag" };
  }
  const today = leadToday(now);
  const statuses = activeContactStatuses();
  const sample = await admin
    .from("applications")
    .select(LEAD_RESPONSE_COLUMNS)
    .is("deleted_at", null)
    .in("status", [...ACTIVE_LEAD_STATUSES])
    .in("contact_status", statuses)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(LEAD_RESPONSE_READ_LIMIT + 1);
  if (sample.error) throw new Error("Lead response report could not be loaded");
  const sampleRows = Array.isArray(sample.data) ? (sample.data as RawLead[]) : [];
  const truncated = sampleRows.length > LEAD_RESPONSE_READ_LIMIT;
  let report = buildLeadResponseReport(
    truncated ? sampleRows.slice(0, LEAD_RESPONSE_READ_LIMIT) : sampleRows,
    now,
    truncated,
  );

  const counts = new Map<string, number>();
  let followUpsTruncated = false;
  let start = 0;
  for (let page = 0; page < 20; page += 1) {
    const due = await admin
      .from("applications")
      .select("source,contact_follow_up_on")
      .is("deleted_at", null)
      .in("status", [...ACTIVE_LEAD_STATUSES])
      .in("contact_status", statuses)
      .not("contact_follow_up_on", "is", null)
      .lte("contact_follow_up_on", today)
      .order("id", { ascending: true })
      .range(start, start + LEAD_RESPONSE_FOLLOW_UP_PAGE);
    if (due.error) throw new Error("Lead response report could not be loaded");
    const dueRows = Array.isArray(due.data) ? (due.data as RawLead[]) : [];
    const more = dueRows.length > LEAD_RESPONSE_FOLLOW_UP_PAGE;
    addDueFollowUps(counts, more ? dueRows.slice(0, LEAD_RESPONSE_FOLLOW_UP_PAGE) : dueRows, now);
    if (!more) break;
    start += LEAD_RESPONSE_FOLLOW_UP_PAGE;
    if (page === 19) followUpsTruncated = true;
  }
  report = applyFollowUpCounts(report, counts, followUpsTruncated);
  return { ok: true, report };
}
