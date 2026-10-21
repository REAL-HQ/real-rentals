// Next service from the last logged maintenance record plus that record's
// date or mileage interval. No interval is invented. No history stays Unknown.
import {
  DATE_DUE_SOON_DAYS,
  OIL_DUE_SOON_MILES,
  addCalendarDays,
  parseIsoDate,
  parseMiles,
} from "@/lib/maintenance-log";

export type ScheduleState = "overdue" | "due_soon" | "ok" | "unknown";

export const SCHEDULE_FLAG: Record<ScheduleState, string> = {
  overdue: "Overdue",
  due_soon: "Due Soon",
  ok: "All Clear",
  unknown: "Unknown",
};

export type LoggedService = {
  id: string;
  item: string | null;
  performedOn: unknown;
  odometer: unknown;
  scheduleId: string | null;
};

export type ServiceInterval = {
  id: string;
  item: string | null;
  intervalDays: unknown;
  intervalMiles: unknown;
  active: boolean;
};

export type NextServiceRow = {
  item: string;
  lastOn: string | null;
  lastMiles: number | null;
  nextOn: string | null;
  nextMiles: number | null;
  state: ScheduleState;
  flag: string;
  reason: string;
};

const RANK: Record<ScheduleState, number> = { overdue: 0, due_soon: 1, unknown: 2, ok: 3 };

function positiveInt(value: unknown): number | null {
  const n = parseMiles(value);
  return n != null && n > 0 ? n : null;
}

function daysBetween(start: string, end: string): number {
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000);
}

function itemKey(item: string | null): string {
  const text = item?.trim() ?? "";
  return text === "" ? "Service" : text;
}

function laterService(current: LoggedService, next: LoggedService): LoggedService {
  const currentOn = parseIsoDate(current.performedOn) ?? "";
  const nextOn = parseIsoDate(next.performedOn) ?? "";
  if (currentOn !== nextOn) return nextOn > currentOn ? next : current;
  return next.id > current.id ? next : current;
}

function matchingInterval(service: LoggedService, intervals: ServiceInterval[]): ServiceInterval | null {
  const linked = service.scheduleId ? intervals.find((row) => row.id === service.scheduleId) : undefined;
  if (linked) return linked;
  const key = itemKey(service.item).toLowerCase();
  return intervals.find((row) => row.active && itemKey(row.item).toLowerCase() === key) ?? null;
}

function dateState(today: string, nextOn: string | null): { state: ScheduleState; reason: string } | null {
  if (!nextOn) return null;
  const left = daysBetween(today, nextOn);
  if (left < 0) return { state: "overdue", reason: left === -1 ? "1 Day Overdue" : `${(-left).toLocaleString("en-US")} Days Overdue` };
  if (left === 0) return { state: "overdue", reason: "Due Today" };
  if (left <= DATE_DUE_SOON_DAYS) return { state: "due_soon", reason: left === 1 ? "Due In 1 Day" : `Due In ${left.toLocaleString("en-US")} Days` };
  return { state: "ok", reason: `Due In ${left.toLocaleString("en-US")} Days` };
}

function milesState(nextMiles: number | null, currentMiles: number | null): { state: ScheduleState; reason: string } | null {
  if (nextMiles == null || currentMiles == null) return null;
  const left = nextMiles - currentMiles;
  if (left < 0) return { state: "overdue", reason: `${(-left).toLocaleString("en-US")} Miles Overdue` };
  if (left === 0) return { state: "overdue", reason: "Due Now" };
  if (left <= OIL_DUE_SOON_MILES) return { state: "due_soon", reason: `Due In ${left.toLocaleString("en-US")} Miles` };
  return { state: "ok", reason: `Due In ${left.toLocaleString("en-US")} Miles` };
}

function worse(parts: Array<{ state: ScheduleState; reason: string } | null>): { state: ScheduleState; reason: string } {
  const known = parts.filter((part): part is { state: ScheduleState; reason: string } => part != null);
  if (known.length === 0) return { state: "unknown", reason: "No Interval On Record" };
  known.sort((a, b) => RANK[a.state] - RANK[b.state]);
  return known[0];
}

export function buildMaintenanceDueSchedule(input: {
  today: string;
  currentMiles: unknown;
  services: LoggedService[];
  intervals: ServiceInterval[];
}): NextServiceRow[] {
  if (input.services.length === 0) {
    return [
      {
        item: "Service",
        lastOn: null,
        lastMiles: null,
        nextOn: null,
        nextMiles: null,
        state: "unknown",
        flag: SCHEDULE_FLAG.unknown,
        reason: "No Service History",
      },
    ];
  }

  const latest = new Map<string, LoggedService>();
  for (const service of input.services) {
    const key = itemKey(service.item).toLowerCase();
    const current = latest.get(key);
    latest.set(key, current ? laterService(current, service) : service);
  }

  const currentMiles = parseMiles(input.currentMiles);
  const rows: NextServiceRow[] = [];
  for (const service of latest.values()) {
    const interval = matchingInterval(service, input.intervals);
    const lastOn = parseIsoDate(service.performedOn);
    const lastMiles = parseMiles(service.odometer);
    const dayInterval = positiveInt(interval?.intervalDays);
    const mileInterval = positiveInt(interval?.intervalMiles);
    const nextOn = lastOn && dayInterval ? addCalendarDays(lastOn, dayInterval) : null;
    const nextMiles = lastMiles != null && mileInterval ? lastMiles + mileInterval : null;
    const verdict = worse([dateState(input.today, nextOn), milesState(nextMiles, currentMiles)]);
    rows.push({
      item: itemKey(service.item),
      lastOn,
      lastMiles,
      nextOn,
      nextMiles,
      state: verdict.state,
      flag: SCHEDULE_FLAG[verdict.state],
      reason: verdict.reason,
    });
  }

  rows.sort((a, b) => RANK[a.state] - RANK[b.state] || a.item.localeCompare(b.item));
  return rows;
}
