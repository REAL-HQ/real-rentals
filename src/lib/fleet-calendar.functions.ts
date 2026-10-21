import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { FLEET_CALENDAR_ENABLED } from "./fleet-calendar-flag";
import {
  FLEET_ROW_LIMIT,
  OPEN_MAINTENANCE_STATUSES,
  PICKUP_STATUSES,
  addCalendarDays,
  buildFleetCalendar,
  easternCalendarDate,
  mondayOf,
  vehicleCalendarLabel,
  type FleetCalendarBoard,
  type FleetPickup,
  type FleetRental,
  type FleetService,
  type FleetVehicle,
} from "./fleet-calendar";

const weekInput = z.object({
  weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});

export const getFleetCalendar = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => weekInput.parse(data ?? {}))
  .handler(async ({ data, context }): Promise<FleetCalendarBoard> => {
    if (!FLEET_CALENDAR_ENABLED) throw new Error("Fleet Calendar is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const weekStart = mondayOf(data.weekStart ?? easternCalendarDate());
    const weekEnd = addCalendarDays(weekStart, 6);

    const [vehiclesQ, rentalsQ, pickupsQ, servicesQ] = await Promise.all([
      supabaseAdmin
        .from("vehicles")
        .select("id,year,make,model,license_plate,unit_number,status,archived_at", { count: "exact" })
        .is("archived_at", null)
        .order("unit_number", { ascending: true })
        .limit(FLEET_ROW_LIMIT),
      supabaseAdmin
        .from("rentals")
        .select("id,vehicle_id,driver_id,status,start_date,end_date")
        .eq("status", "active")
        .lte("start_date", weekEnd)
        .or(`end_date.is.null,end_date.gte.${weekStart}`)
        .limit(FLEET_ROW_LIMIT),
      supabaseAdmin
        .from("applications")
        .select("id,vehicle_id,full_name,status,pickup_date,deleted_at")
        .is("deleted_at", null)
        .not("vehicle_id", "is", null)
        .gte("pickup_date", weekStart)
        .lte("pickup_date", weekEnd)
        .in("status", [...PICKUP_STATUSES])
        .limit(FLEET_ROW_LIMIT),
      supabaseAdmin
        .from("maintenance_records")
        .select("id,vehicle_id,status,item,performed_on,due_date")
        .in("status", [...OPEN_MAINTENANCE_STATUSES])
        .or(
          `and(performed_on.gte.${weekStart},performed_on.lte.${weekEnd}),and(due_date.gte.${weekStart},due_date.lte.${weekEnd})`,
        )
        .limit(FLEET_ROW_LIMIT),
    ]);
    for (const result of [vehiclesQ, rentalsQ, pickupsQ, servicesQ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const driverIds = [...new Set((rentalsQ.data ?? []).map((row) => row.driver_id).filter(Boolean))];
    const driversQ = driverIds.length
      ? await supabaseAdmin
          .from("applications")
          .select("user_id,full_name,deleted_at,created_at")
          .in("user_id", driverIds)
          .order("created_at", { ascending: false })
          .limit(1000)
      : { data: [], error: null };
    if (driversQ.error) throw new Error(driversQ.error.message);
    const driverNames = new Map<string, string>();
    for (const row of driversQ.data ?? []) {
      if (!row.user_id || row.deleted_at || driverNames.has(row.user_id)) continue;
      driverNames.set(row.user_id, row.full_name);
    }

    const vehicles: FleetVehicle[] = (vehiclesQ.data ?? []).map((row) => ({
      id: row.id,
      label: vehicleCalendarLabel(row),
      status: row.status,
      archived_at: row.archived_at,
    }));
    const rentals: FleetRental[] = (rentalsQ.data ?? []).map((row) => ({
      id: row.id,
      vehicle_id: row.vehicle_id,
      status: row.status,
      start_date: row.start_date,
      end_date: row.end_date,
      driver_name: driverNames.get(row.driver_id) ?? null,
    }));
    const pickups: FleetPickup[] = pickupsQ.data ?? [];
    const services: FleetService[] = servicesQ.data ?? [];

    return buildFleetCalendar({
      weekStart,
      vehicles,
      rentals,
      pickups,
      services,
      vehiclesTruncated: (vehiclesQ.count ?? vehicles.length) > FLEET_ROW_LIMIT,
    });
  });
