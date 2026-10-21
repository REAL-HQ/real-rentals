// Read-only maintenance log. Owners and managers only.
// The flag is checked before the role lookup and before any read.
// No insert, update, or delete. Inspection expiry is optional: a missing
// proposed table leaves that fact unknown and the other dates still show.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { MAINTENANCE_LOG_ENABLED } from "@/lib/maintenance-log-flag";
import {
  buildMaintenanceLog,
  businessToday,
  type InspectionDueSource,
  type InspectionHistorySource,
  type MaintenanceLogResult,
  type ServiceHistorySource,
  type VehicleLogSource,
} from "@/lib/maintenance-log";

const PAGE = 1000;
const VEHICLE_COLUMNS =
  "id,unit_number,year,make,model,current_odometer,last_oil_change_miles,oil_interval_miles,last_tire_date,last_brake_inspection_date,registration_expires_on,insurance_expires_on";
const SERVICE_COLUMNS = "id,vehicle_id,item,category,performed_on,odometer,status";
const INSPECTION_COLUMNS = "id,vehicle_id,inspection_type,status,completed_at,created_at,odometer";

async function eachPage(
  load: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>,
): Promise<unknown[]> {
  const rows: unknown[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await load(from, toEnd(from));
    if (error) {
      console.error("[maintenance-log] read failed", error.message);
      throw new Error("Could not load the maintenance log.");
    }
    const page = data ?? [];
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows;
}

function toEnd(from: number): number {
  return from + PAGE - 1;
}

export const listMaintenanceLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: unknown) => z.object({ vehicleId: z.string().uuid().optional() }).parse(d ?? {}))
  .handler(async ({ data, context }): Promise<MaintenanceLogResult> => {
    if (!MAINTENANCE_LOG_ENABLED) throw new Error("Maintenance Log is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin;
    const vehicleId = data.vehicleId;

    const vehicles = (await eachPage((from, to) => {
      let query = sb
        .from("vehicles")
        .select(VEHICLE_COLUMNS)
        .is("archived_at", null)
        .order("id", { ascending: true })
        .range(from, to);
      if (vehicleId) query = query.eq("id", vehicleId);
      return query;
    })) as VehicleLogSource[];

    const services = (await eachPage((from, to) => {
      let query = sb
        .from("maintenance_records")
        .select(SERVICE_COLUMNS)
        .order("id", { ascending: true })
        .range(from, to);
      if (vehicleId) query = query.eq("vehicle_id", vehicleId);
      return query;
    })) as ServiceHistorySource[];

    const inspections = (await eachPage((from, to) => {
      let query = sb
        .from("inspections")
        .select(INSPECTION_COLUMNS)
        .order("id", { ascending: true })
        .range(from, to);
      if (vehicleId) query = query.eq("vehicle_id", vehicleId);
      return query;
    })) as InspectionHistorySource[];

    let inspectionExpiryInstalled = true;
    let inspectionDue: InspectionDueSource[] = [];
    const dueRows: unknown[] = [];
    for (let from = 0; ; from += PAGE) {
      let query = (sb as any)
        .from("maintenance_log_v1")
        .select("vehicle_id,inspection_due_on")
        .order("vehicle_id", { ascending: true })
        .range(from, toEnd(from));
      if (vehicleId) query = query.eq("vehicle_id", vehicleId);
      const { data, error } = await query;
      if (error) {
        if (!error.message.includes("relation does not exist")) {
          console.error("[maintenance-log] read failed", error.message);
          throw new Error("Could not load the maintenance log.");
        }
        inspectionExpiryInstalled = false;
        console.error("[maintenance-log] maintenance_log_v1 is not installed; inspection expiry stays unknown.");
        break;
      }
      const page = data ?? [];
      dueRows.push(...page);
      if (page.length < PAGE) break;
    }
    if (inspectionExpiryInstalled) inspectionDue = dueRows as InspectionDueSource[];

    return buildMaintenanceLog({
      today: businessToday(),
      vehicles,
      services,
      inspections,
      inspectionDue,
      inspectionExpiryInstalled,
    });
  });
