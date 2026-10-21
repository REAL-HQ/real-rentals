import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { OVERVIEW_TODAY_ENABLED, disabledOverviewToday, overviewToday, recordedAmount } from "@/lib/overview-today-flag";
import type {
  OverviewTodayResult,
  TodayLead,
  TodayName,
  TodayPayment,
  TodayRental,
  TodayVehicle,
} from "@/lib/overview-today";

const RENTAL_SELECT = "id,status,start_date,end_date,application_id,vehicle_id";
const PAYMENT_SELECT = "id,status,type,amount,balance_due,due_date,driver_id";
const LEAD_SELECT = "id,full_name,phone,status,created_at,contact_status,contact_follow_up_on";
const NAME_SELECT = "id,full_name";
const VEHICLE_SELECT = "id,year,make,model,unit_number";

type Counted<T> = { rows: T[]; total: number };
type QueryResult = { data: unknown[] | null; error: { message: string } | null; count: number | null };

const UNAVAILABLE = "Today could not be loaded.";

async function counted<T>(run: (head: boolean) => PromiseLike<QueryResult>, map: (row: Record<string, unknown>) => T): Promise<Counted<T>> {
  const count = await run(true);
  if (count.error || !Number.isSafeInteger(count.count) || (count.count ?? -1) < 0) throw new Error(UNAVAILABLE);
  const total = count.count!;
  if (total === 0) return { rows: [], total: 0 };
  const page = await run(false);
  if (page.error || !Array.isArray(page.data)) throw new Error(UNAVAILABLE);
  return { rows: page.data.map((row) => map(row as Record<string, unknown>)), total };
}

function text(row: Record<string, unknown>, key: string): string | null {
  const value = row[key];
  return typeof value === "string" ? value : value == null ? null : null;
}

/**
 * Read-only. Managers and owners only. With the flag off this returns before
 * any role lookup or table read. The flag-on path selects existing columns
 * and never inserts, updates, or deletes.
 */
export async function loadOverviewToday(
  admin: { from: (table: string) => any },
  today = overviewToday(),
  enabled = OVERVIEW_TODAY_ENABLED,
): Promise<OverviewTodayResult> {
  if (!enabled) return disabledOverviewToday(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(UNAVAILABLE);
  const { OVERVIEW_TODAY_LIMIT, PICKUP_STATUSES, RETURN_STATUSES, OUTSTANDING_STATUSES, assembleOverviewToday } =
    await import("@/lib/overview-today");

  const rentals = (column: "start_date" | "end_date", statuses: readonly string[]) =>
    counted<TodayRental>(
      (head) => {
        let query = admin
          .from("rentals")
          .select(head ? "id" : RENTAL_SELECT, head ? { count: "exact", head: true } : undefined)
          .eq(column, today)
          .in("status", [...statuses]);
        if (!head) query = query.order("id", { ascending: true }).limit(OVERVIEW_TODAY_LIMIT);
        return query;
      },
      (row) => ({
        id: String(row.id ?? ""),
        status: text(row, "status"),
        start_date: text(row, "start_date"),
        end_date: text(row, "end_date"),
        application_id: text(row, "application_id"),
        vehicle_id: text(row, "vehicle_id"),
      }),
    );

  const [pickups, returns, overduePayments, newLeads] = await Promise.all([
    rentals("start_date", PICKUP_STATUSES),
    rentals("end_date", RETURN_STATUSES),
    counted<TodayPayment>(
      (head) => {
        let query = admin
          .from("payments")
          .select(head ? "id" : PAYMENT_SELECT, head ? { count: "exact", head: true } : undefined)
          .in("status", [...OUTSTANDING_STATUSES])
          .lt("due_date", today)
          .not("type", "ilike", "deposit");
        if (!head) query = query.order("due_date", { ascending: true }).order("id", { ascending: true }).limit(OVERVIEW_TODAY_LIMIT);
        return query;
      },
      (row) => ({
        id: String(row.id ?? ""),
        status: text(row, "status"),
        type: text(row, "type"),
        amount: recordedAmount(row.amount),
        balance_due: recordedAmount(row.balance_due),
        due_date: text(row, "due_date"),
        application_id: text(row, "driver_id"),
      }),
    ),
    loadNewLeads(admin, today, LEAD_SELECT, OVERVIEW_TODAY_LIMIT),
  ]);

  const applicationIds = [
    ...new Set(
      [...pickups.rows, ...returns.rows, ...overduePayments.rows]
        .map((row) => row.application_id)
        .filter((id): id is string => !!id),
    ),
  ];
  const vehicleIds = [
    ...new Set(
      [...pickups.rows, ...returns.rows].map((row) => row.vehicle_id).filter((id): id is string => !!id),
    ),
  ];
  const readRows = async (query: PromiseLike<QueryResult>) => {
    const result = await query;
    if (result.error || !Array.isArray(result.data)) throw new Error(UNAVAILABLE);
    return result.data as Record<string, unknown>[];
  };
  const [nameRows, vehicleRows] = await Promise.all([
    applicationIds.length === 0 ? Promise.resolve([] as Record<string, unknown>[]) : readRows(admin.from("applications").select(NAME_SELECT).in("id", applicationIds)),
    vehicleIds.length === 0 ? Promise.resolve([] as Record<string, unknown>[]) : readRows(admin.from("vehicles").select(VEHICLE_SELECT).in("id", vehicleIds)),
  ]);
  const names: TodayName[] = nameRows.map((record) => ({ id: String(record.id ?? ""), full_name: text(record, "full_name") }));
  const vehicles: TodayVehicle[] = vehicleRows.map((record) => ({
    id: String(record.id ?? ""),
    year: typeof record.year === "number" ? record.year : null,
    make: text(record, "make"),
    model: text(record, "model"),
    unit_number: text(record, "unit_number"),
  }));

  return assembleOverviewToday({ today, pickups, returns, overduePayments, newLeads, names, vehicles });
}

function leadRow(row: Record<string, unknown>): TodayLead {
  return {
    id: String(row.id ?? ""),
    full_name: text(row, "full_name"),
    phone: text(row, "phone"),
    status: text(row, "status") ?? "",
    created_at: text(row, "created_at"),
    contact_status: text(row, "contact_status") ?? "",
    contact_follow_up_on: text(row, "contact_follow_up_on"),
  };
}

/** New leads with no follow-up, plus new leads whose follow-up is today or later. Two reads, no interpolated filter. */
async function loadNewLeads(
  admin: { from: (table: string) => any },
  today: string,
  select: string,
  limit: number,
): Promise<Counted<TodayLead>> {
  const query = (head: boolean) =>
    admin
      .from("applications")
      .select(head ? "id" : select, head ? { count: "exact", head: true } : undefined)
      .is("deleted_at", null)
      .in("status", ["new", "reviewing", "approved"])
      .eq("contact_status", "new");
  const [openCount, laterCount] = await Promise.all([
    query(true).is("contact_follow_up_on", null) as Promise<QueryResult>,
    query(true).gte("contact_follow_up_on", today) as Promise<QueryResult>,
  ]);
  const readable = (result: QueryResult) =>
    !result.error && Number.isSafeInteger(result.count) && (result.count ?? -1) >= 0;
  if (!readable(openCount) || !readable(laterCount)) throw new Error(UNAVAILABLE);
  const total = openCount.count! + laterCount.count!;
  if (total === 0) return { rows: [], total: 0 };
  const [openPage, laterPage] = await Promise.all([
    query(false).is("contact_follow_up_on", null).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit) as Promise<QueryResult>,
    query(false).gte("contact_follow_up_on", today).order("created_at", { ascending: true }).order("id", { ascending: true }).limit(limit) as Promise<QueryResult>,
  ]);
  if (openPage.error || laterPage.error || !Array.isArray(openPage.data) || !Array.isArray(laterPage.data)) {
    throw new Error(UNAVAILABLE);
  }
  const rows = [...openPage.data, ...laterPage.data]
    .map((row) => leadRow(row as Record<string, unknown>))
    .sort((a, b) => {
      const created = String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
      return created !== 0 ? created : a.id.localeCompare(b.id);
    })
    .slice(0, limit);
  return { rows, total };
}

export const getOverviewToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OverviewTodayResult> => {
    if (!OVERVIEW_TODAY_ENABLED) return disabledOverviewToday(overviewToday());
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadOverviewToday(supabaseAdmin, overviewToday());
  });
