// Read-only next-service schedule. Managers and team.
// The flag is the one MAINTENANCE_DUE_ENABLED constant. It is checked before
// the role lookup and before any read. No insert, update, delete, or new table.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAINTENANCE_DUE_ENABLED } from "@/lib/maintenance-due";
import { businessToday } from "@/lib/maintenance-log";
import { buildMaintenanceDueSchedule, type NextServiceRow } from "@/lib/maintenance-due-schedule";

const DISABLED = "Maintenance Due is off";
const LIMIT = 200;

export type MaintenanceDueScheduleResult = {
  today: string;
  rows: NextServiceRow[];
  truncated: boolean;
};

export const listMaintenanceDueSchedule = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({ vehicleId: z.string().uuid() }).strict().parse(input))
  .handler(async ({ data, context }): Promise<MaintenanceDueScheduleResult> => {
    if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const recordsQ = await supabaseAdmin
      .from("maintenance_records")
      .select("id,item,performed_on,odometer,schedule_id")
      .eq("vehicle_id", data.vehicleId)
      .order("performed_on", { ascending: false })
      .limit(LIMIT + 1);
    if (recordsQ.error) throw new Error(recordsQ.error.message);
    const recordPage = recordsQ.data ?? [];
    const recordsTruncated = recordPage.length > LIMIT;

    const schedulesQ = await supabaseAdmin
      .from("maintenance_schedules")
      .select("id,item,interval_days,interval_miles,is_active")
      .eq("vehicle_id", data.vehicleId)
      .limit(LIMIT + 1);
    if (schedulesQ.error) throw new Error(schedulesQ.error.message);
    const schedulePage = schedulesQ.data ?? [];
    const schedulesTruncated = schedulePage.length > LIMIT;

    const vehicleQ = await supabaseAdmin
      .from("vehicles")
      .select("id,current_odometer")
      .eq("id", data.vehicleId)
      .limit(LIMIT + 1);
    if (vehicleQ.error) throw new Error(vehicleQ.error.message);
    const vehiclePage = vehicleQ.data ?? [];
    const vehicleTruncated = vehiclePage.length > LIMIT;
    const today = businessToday();

    return {
      today,
      rows: buildMaintenanceDueSchedule({
        today,
        currentMiles: vehiclePage[0]?.current_odometer ?? null,
        services: recordPage.slice(0, LIMIT).map((row) => ({
          id: row.id,
          item: row.item,
          performedOn: row.performed_on,
          odometer: row.odometer,
          scheduleId: row.schedule_id,
        })),
        intervals: schedulePage.slice(0, LIMIT).map((row) => ({
          id: row.id,
          item: row.item,
          intervalDays: row.interval_days,
          intervalMiles: row.interval_miles,
          active: row.is_active,
        })),
      }),
      truncated: recordsTruncated || schedulesTruncated || vehicleTruncated,
    };
  });
