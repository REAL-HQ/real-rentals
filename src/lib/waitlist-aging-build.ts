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
  /**
   * Accepted only so a caller cannot smuggle a preference in. The waitlist
   * table has no vehicle_type column, and this view does not invent one.
   */
  vehicle_type?: string | null;
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

export function waitlistVehicleType(_entry: { vehicle_type?: string | null }): null {
  return null;
}

function cityKey(city: string | null): string | null {
  if (typeof city !== "string") return null;
  const trimmed = city.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * Waiting age counts status "waiting" only.
 * Notified-but-not-applied counts a row with notified_at when the linked
 * application's Eastern day is more than 7 days after notification, or when
 * no application is readable and today is at least 7 Eastern days later.
 * promoted_at is staff link time and is not the apply time.
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
      vehicleType: null;
      days: number[];
      waiting: number;
      notifiedNotApplied: number;
    }
  >();

  for (const entry of input.entries) {
    const city = cityKey(entry.city);
    const key = city ?? "\0";
    let group = groups.get(key);
    if (!group) {
      group = {
        city,
        vehicleType: waitlistVehicleType(entry),
        days: [],
        waiting: 0,
        notifiedNotApplied: 0,
      };
      groups.set(key, group);
    }

    if (entry.status === "waiting") {
      if (todayIndex != null) group.waiting += 1;
      const created = easternDayIndex(entry.created_at);
      if (created != null && todayIndex != null) {
        const days = todayIndex - created;
        if (days >= 0) group.days.push(days);
      }
      continue;
    }

    const notified = easternDayIndex(entry.notified_at);
    if (notified == null || todayIndex == null) continue;
    const applicationId = entry.promoted_application_id;
    const applicationCreated =
      typeof applicationId === "string" ? appliedAt.get(applicationId) : undefined;
    if (applicationCreated) {
      const applied = easternDayIndex(applicationCreated);
      if (applied != null && applied - notified > NOTIFIED_WINDOW_DAYS) {
        group.notifiedNotApplied += 1;
      }
    } else if (todayIndex - notified >= NOTIFIED_WINDOW_DAYS) {
      group.notifiedNotApplied += 1;
    }
  }

  const built: WaitlistAgingGroup[] = [];
  for (const group of groups.values()) {
    if (group.waiting === 0 && group.notifiedNotApplied === 0) continue;
    built.push({
      city: group.city,
      vehicleType: group.vehicleType,
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
