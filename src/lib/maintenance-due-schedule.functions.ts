// Maintenance due for one vehicle, using the vehicle-service schedule
// computation: company defaults, vehicle overrides, and last_done_on.
// Last service is a completed record with performed_on. A schedule with no
// history stays on the list as Unknown. The flag is refused before
// authentication and before any read. No insert, update, delete, or new table.
import { createMiddleware, createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAINTENANCE_DUE_ENABLED, businessToday } from "@/lib/maintenance-due";
import { mergeSchedules, scheduleDue, withHistory, type ScheduleFact } from "@/lib/maintenance-schedule";
import type { DueResult } from "@/lib/maintenance-rules";

const DISABLED = "Maintenance Due is off";
const LIMIT = 200;

const refuseMaintenanceDueSchedule = createMiddleware({ type: "function" }).server(async ({ next }) => {
  if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED);
  return next();
});

export type MaintenanceDueSchedule = ScheduleFact & { due: DueResult };

export type MaintenanceDueScheduleResult = {
  today: string;
  schedules: MaintenanceDueSchedule[];
  truncated: boolean;
};

function capped<T>(rows: T[] | null): { rows: T[]; truncated: boolean } {
  const page = rows ?? [];
  return { rows: page.slice(0, LIMIT), truncated: page.length > LIMIT };
}

export const listMaintenanceDueSchedule = createServerFn({ method: "POST" })
  .middleware([refuseMaintenanceDueSchedule, requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ vehicleId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<MaintenanceDueScheduleResult> => {
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const [defaultsQ, schedulesQ, recordsQ, vehicleQ] = await Promise.all([
      supabaseAdmin
        .from("maintenance_defaults")
        .select("id,item,category,interval_miles,interval_days,is_active")
        .eq("is_active", true)
        .order("item")
        .order("id")
        .limit(LIMIT + 1),
      supabaseAdmin
        .from("maintenance_schedules")
        .select("id,default_id,item,category,interval_miles,interval_days,is_override,last_done_on,last_done_miles,is_active")
        .eq("vehicle_id", data.vehicleId)
        .eq("is_active", true)
        .order("item")
        .order("id")
        .limit(LIMIT + 1),
      supabaseAdmin
        .from("maintenance_records")
        .select("id,status,item,category,performed_on,odometer,maintenance_record_items(category)")
        .eq("vehicle_id", data.vehicleId)
        .order("performed_on", { ascending: false, nullsFirst: false })
        .order("id", { ascending: false })
        .limit(LIMIT + 1),
      supabaseAdmin.from("vehicles").select("id,current_odometer").eq("id", data.vehicleId).maybeSingle(),
    ]);
    if (defaultsQ.error) throw new Error(defaultsQ.error.message);
    if (schedulesQ.error) throw new Error(schedulesQ.error.message);
    if (recordsQ.error) throw new Error(recordsQ.error.message);
    if (vehicleQ.error) throw new Error(vehicleQ.error.message);

    const defaults = capped(defaultsQ.data);
    const schedules = capped(schedulesQ.data);
    const records = capped(recordsQ.data);
    const today = businessToday();
    const currentMiles = vehicleQ.data?.current_odometer ?? null;
    const history = records.rows.map((row) => ({
      id: row.id,
      status: row.status,
      category: row.category,
      performed_on: row.performed_on,
      odometer: row.odometer,
      items: row.maintenance_record_items ?? [],
    }));

    return {
      today,
      schedules: withHistory(mergeSchedules(defaults.rows, schedules.rows, { ordered: true }), history, { tieBreakById: true }).map((row) => ({
        ...row,
        due: scheduleDue(row, currentMiles, today),
      })),
      truncated: defaults.truncated || schedules.truncated || records.truncated,
    };
  });
