import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  OVERVIEW_TODAY_ENABLED,
  OVERVIEW_TODAY_LIMIT,
  OVERVIEW_TODAY_OVERDUE_STATUSES,
  PICKUP_STATUSES,
  RETURN_STATUSES,
  assembleOverviewToday,
  disabledOverviewToday,
  overviewToday,
  recordedAmount,
  type OverviewTodayResult,
  type TodayLead,
  type TodayName,
  type TodayPayment,
  type TodayRental,
  type TodayVehicle,
} from "@/lib/overview-today";
import { requireStaff } from "@/lib/roles.server";

const RENTAL_SELECT = "id,status,start_date,end_date,application_id,vehicle_id";
const PAYMENT_SELECT = "id,status,type,amount,due_date,driver_id";
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
 * Read-only. Staff only. With the flag off this returns before any table read.
 * The flag-on path selects existing columns and never inserts, updates, or deletes.
 */
export async function loadOverviewToday(
  admin: { from: (table: string) => any },
  today = overviewToday(),
  enabled = OVERVIEW_TODAY_ENABLED,
): Promise<OverviewTodayResult> {
  if (!enabled) return disabledOverviewToday(today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) throw new Error(UNAVAILABLE);

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
          .in("status", [...OVERVIEW_TODAY_OVERDUE_STATUSES]);
        if (!head) query = query.order("due_date", { ascending: true }).order("id", { ascending: true }).limit(OVERVIEW_TODAY_LIMIT);
        return query;
      },
      (row) => ({
        id: String(row.id ?? ""),
        status: text(row, "status"),
        type: text(row, "type"),
        amount: recordedAmount(row.amount),
        due_date: text(row, "due_date"),
        application_id: text(row, "driver_id"),
      }),
    ),
    counted<TodayLead>(
      (head) => {
        let query = admin
          .from("applications")
          .select(head ? "id" : LEAD_SELECT, head ? { count: "exact", head: true } : undefined)
          .is("deleted_at", null)
          .in("status", ["new", "reviewing", "approved"])
          .eq("contact_status", "new")
          .or(`contact_follow_up_on.is.null,contact_follow_up_on.gte.${today}`);
        if (!head) query = query.order("created_at", { ascending: true }).order("id", { ascending: true }).limit(OVERVIEW_TODAY_LIMIT);
        return query;
      },
      (row) => ({
        id: String(row.id ?? ""),
        full_name: text(row, "full_name"),
        phone: text(row, "phone"),
        status: text(row, "status") ?? "",
        created_at: text(row, "created_at"),
        contact_status: text(row, "contact_status") ?? "",
        contact_follow_up_on: text(row, "contact_follow_up_on"),
      }),
    ),
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

export const getOverviewToday = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OverviewTodayResult> => {
    await requireStaff(context.userId);
    const today = overviewToday();
    if (!OVERVIEW_TODAY_ENABLED) return disabledOverviewToday(today);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return loadOverviewToday(supabaseAdmin, today);
  });
