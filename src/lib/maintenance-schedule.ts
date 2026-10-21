// Company defaults merged with one vehicle's overrides and extras.
// Last service counts only when status is completed and performed_on is set.
// Inactive rows are ignored. A schedule with no completed history stays on
// the list with a null last_done_on, so its due state stays Unknown.
import { dueStatus, normalizeCategory, type DueResult } from "@/lib/maintenance-rules";

export type CompanyDefault = {
  id: string;
  item: string;
  category?: string | null;
  interval_miles?: number | null;
  interval_days?: number | null;
  is_active?: boolean | null;
};

export type VehicleSchedule = {
  id: string;
  default_id?: string | null;
  item: string;
  category?: string | null;
  interval_miles?: number | null;
  interval_days?: number | null;
  is_override?: boolean | null;
  last_done_on?: string | null;
  last_done_miles?: number | null;
  is_active?: boolean | null;
};

export type ScheduleFact = {
  key: string;
  default_id: string | null;
  schedule_id: string | null;
  item: string;
  category: string | null;
  interval_miles: number | null;
  interval_days: number | null;
  company_miles: number | null;
  company_days: number | null;
  is_override: boolean;
  last_done_on: string | null;
  last_done_miles: number | null;
};

function byItemThenId(a: { item: string; id: string }, b: { item: string; id: string }) {
  return a.item.localeCompare(b.item) || a.id.localeCompare(b.id);
}

/**
 * Company defaults, then this vehicle's extra schedules. Overrides replace the company interval.
 * Ordered sorting is for the dark schedule only. The live list keeps query order.
 */
export function mergeSchedules(
  defs: CompanyDefault[] | null | undefined,
  own: VehicleSchedule[] | null | undefined,
  options?: { ordered?: boolean },
): ScheduleFact[] {
  const ordered = options?.ordered === true;
  const activeDefs = (defs ?? []).filter((d) => d.is_active !== false);
  const defsInOrder = ordered ? activeDefs.sort(byItemThenId) : activeDefs;
  const activeOwn = (own ?? []).filter((s) => s.is_active !== false);
  const byDefault = new Map(activeOwn.filter((s) => s.default_id).map((s) => [s.default_id as string, s]));
  const rows: ScheduleFact[] = [];
  for (const d of defsInOrder) {
    const s = byDefault.get(d.id);
    rows.push({
      key: `d:${d.id}`,
      default_id: d.id,
      schedule_id: s?.id ?? null,
      item: d.item,
      category: d.category ?? null,
      interval_miles: s?.is_override ? (s.interval_miles ?? null) : (d.interval_miles ?? null),
      interval_days: s?.is_override ? (s.interval_days ?? null) : (d.interval_days ?? null),
      company_miles: d.interval_miles ?? null,
      company_days: d.interval_days ?? null,
      is_override: !!s?.is_override,
      last_done_on: s?.last_done_on ?? null,
      last_done_miles: s?.last_done_miles ?? null,
    });
  }
  const extras = activeOwn.filter((s) => !s.default_id);
  const extrasInOrder = ordered ? extras.sort(byItemThenId) : extras;
  for (const s of extrasInOrder) {
    rows.push({
      key: `s:${s.id}`,
      default_id: null,
      schedule_id: s.id,
      item: s.item,
      category: s.category ?? null,
      interval_miles: s.interval_miles ?? null,
      interval_days: s.interval_days ?? null,
      company_miles: null,
      company_days: null,
      is_override: false,
      last_done_on: s.last_done_on ?? null,
      last_done_miles: s.last_done_miles ?? null,
    });
  }
  return rows;
}

type HistoryRecord = {
  id?: string | null;
  status?: string | null;
  category?: string | null;
  performed_on?: string | null;
  odometer?: number | null;
  items?: { category?: string | null }[] | null;
};

/** Last completed service per normalized category fills last_done when the schedule row has none. */
export function withHistory<T extends { item: string; last_done_on: string | null; last_done_miles: number | null }>(
  rows: T[],
  records: HistoryRecord[],
  options?: { tieBreakById?: boolean },
): T[] {
  const tieBreakById = options?.tieBreakById === true;
  return rows.map((r) => {
    if (r.last_done_on) return r;
    const cat = normalizeCategory(r.item);
    const hit = records
      .filter((m) => m.status === "completed" && m.performed_on && (normalizeCategory(m.category) === cat || (m.items ?? []).some((i) => normalizeCategory(i.category) === cat)))
      .sort((a, b) => {
        if (!tieBreakById) return (a.performed_on ?? "") < (b.performed_on ?? "") ? 1 : -1;
        const aOn = a.performed_on ?? "";
        const bOn = b.performed_on ?? "";
        if (aOn !== bOn) return aOn < bOn ? 1 : -1;
        const aId = String(a.id ?? "");
        const bId = String(b.id ?? "");
        return aId < bId ? 1 : aId > bId ? -1 : 0;
      })[0];
    return hit ? { ...r, last_done_on: hit.performed_on ?? null, last_done_miles: hit.odometer ?? null } : r;
  });
}

/** Dark schedule only. The live due list leaves this reason blank. */
export function scheduleDue(
  row: { item: string; interval_miles: number | null; interval_days: number | null; last_done_on: string | null; last_done_miles: number | null },
  currentMiles: number | null,
  today: string,
): DueResult {
  const due = dueStatus(row, currentMiles, today);
  if (due.reason === "" && due.dueMiles != null && currentMiles == null) {
    return { ...due, reason: "No Mileage On Record" };
  }
  return due;
}
