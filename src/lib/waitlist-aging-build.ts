import { leadToday } from "./lead-priorities";
import {
  NOTIFIED_WINDOW_DAYS,
  WAITLIST_AGING_CAP,
  type WaitlistAgingGroup,
  type WaitlistAgingResult,
} from "./waitlist-aging";

export type AgingEntry = {
  id: string;
  city: string | null;
  status: string | null;
  created_at: string | null;
  notified_at: string | null;
  promoted_application_id: string | null;
};

export type AgingApplication = {
  id: string;
  created_at: string | null;
};

export function easternCalendarDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const day = leadToday(date);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

/** Whole Eastern calendar days since 1970-01-01. Date-only, so DST cannot skip a day. */
export function easternDayIndex(iso: string | null | undefined): number | null {
  const day = easternCalendarDay(iso);
  if (!day) return null;
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) return null;
  return Date.UTC(year, month - 1, date) / 86_400_000;
}

/** Even counts average the two middle values. 1 and 2 is 1.5, not 2. */
export function exactMedian(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** Grouping key. The label keeps the first casing staff already typed. */
export function cityGroup(city: string | null): { key: string; label: string | null } {
  if (typeof city !== "string") return { key: "\0", label: null };
  const label = city.trim().replace(/\s+/g, " ");
  if (label.length === 0) return { key: "\0", label: null };
  return { key: label.toLocaleLowerCase("en-US"), label };
}

/** Last instant of the Eastern day that is already NOTIFIED_WINDOW_DAYS old. */
export function notifiedThroughIso(today: Date): string {
  const index = easternDayIndex(today.toISOString());
  if (index == null) return today.toISOString();
  const next = new Date((index - NOTIFIED_WINDOW_DAYS + 1) * 86_400_000);
  const day = next.toISOString().slice(0, 10);
  const [year, month, date] = day.split("-").map(Number);
  for (const hour of [4, 5, 6]) {
    const instant = new Date(Date.UTC(year!, month! - 1, date!, hour, 0, 0, 0));
    const before = new Date(instant.getTime() - 1);
    if (leadToday(instant) === day && leadToday(before) !== day) {
      return before.toISOString();
    }
  }
  return today.toISOString();
}

function waitedAtLeast(later: number, earlier: number): boolean {
  return later - earlier >= NOTIFIED_WINDOW_DAYS;
}

/**
 * Waiting age counts status "waiting" only. A future signup still counts as
 * waiting and stays out of the day list, the same way an unreadable date does.
 * Notified, Not Applied counts status "notified" only. The same 7-day boundary
 * applies when an application is readable and when it is not: day 7 counts,
 * day 6 does not. A future application date is not an apply time. promoted_at
 * is staff link time and is not the apply time.
 */
export function buildWaitlistAging(input: {
  entries: AgingEntry[];
  applications: AgingApplication[];
  today?: Date;
  truncated?: boolean;
}): WaitlistAgingResult {
  const today = input.today ?? new Date();
  const todayIndex = easternDayIndex(today.toISOString());
  const appliedAt = new Map(input.applications.map((row) => [row.id, row.created_at]));
  const groups = new Map<
    string,
    {
      city: string | null;
      days: number[];
      waiting: number;
      notifiedNotApplied: number;
    }
  >();

  for (const entry of input.entries) {
    const city = cityGroup(entry.city);
    let group = groups.get(city.key);
    if (!group) {
      group = {
        city: city.label,
        days: [],
        waiting: 0,
        notifiedNotApplied: 0,
      };
      groups.set(city.key, group);
    }

    if (entry.status === "waiting") {
      if (todayIndex != null) group.waiting += 1;
      const created = easternDayIndex(entry.created_at);
      if (created != null && todayIndex != null && created <= todayIndex) {
        group.days.push(todayIndex - created);
      }
      continue;
    }

    if (entry.status !== "notified" || todayIndex == null) continue;
    const notified = easternDayIndex(entry.notified_at);
    if (notified == null || notified > todayIndex) continue;
    const applicationId = entry.promoted_application_id;
    const applicationCreated =
      typeof applicationId === "string" ? appliedAt.get(applicationId) : undefined;
    const applied = applicationCreated ? easternDayIndex(applicationCreated) : null;
    if (applied != null && applied <= todayIndex) {
      if (waitedAtLeast(applied, notified)) group.notifiedNotApplied += 1;
    } else if (waitedAtLeast(todayIndex, notified)) {
      group.notifiedNotApplied += 1;
    }
  }

  const built: WaitlistAgingGroup[] = [];
  for (const group of groups.values()) {
    if (group.waiting === 0 && group.notifiedNotApplied === 0) continue;
    built.push({
      city: group.city,
      waiting: group.waiting,
      medianDays: exactMedian(group.days),
      oldestDays: group.days.length === 0 ? null : Math.max(...group.days),
      notifiedNotApplied: group.notifiedNotApplied,
    });
  }
  built.sort((a, b) => {
    if (a.city == null && b.city == null) return 0;
    if (a.city == null) return 1;
    if (b.city == null) return -1;
    return a.city.localeCompare(b.city);
  });
  return {
    failed: false,
    truncated: input.truncated === true,
    cap: WAITLIST_AGING_CAP,
    groups: built,
  };
}
