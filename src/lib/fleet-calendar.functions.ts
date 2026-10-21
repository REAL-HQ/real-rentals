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

type QueryRows<T> = { data: T[] | null; error: { message: string } | null };

/** Union of disjoint reads. The combined list still stops at the same row cap. */
function mergeLimited<T extends { id: string }>(limit: number, ...parts: QueryRows<T>[]): QueryRows<T> {
  for (const part of parts) {
    if (part.error) return { data: [], error: part.error };
  }
  const seen = new Set<string>();
  const data: T[] = [];
  for (const part of parts) {
    for (const row of part.data ?? []) {
      if (seen.has(row.id)) continue;
      seen.add(row.id);
      data.push(row);
      if (data.length >= limit) return { data, error: null };
    }
  }
  return { data, error: null };
}

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

    // Two queries each, not one `.or()`.
    // A template literal inside `.or()` is a PostgREST filter expression, and a
    // comma in that expression starts another clause. weekStart is an Eastern
    // YYYY-MM-DD from mondayOf, but the value still belongs in `.is` / `.gte` /
    // `.lte`, where the client sends it as a parameter. The maintenance read
    // was the same shape across two lines, so the line guard did not see it.
    const [vehiclesQ, rentalsOpenQ, rentalsDatedQ, pickupsQ, servicesPerformedQ, servicesDueQ] = await Promise.all([
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
        .is("end_date", null)
        .limit(FLEET_ROW_LIMIT),
      supabaseAdmin
        .from("rentals")
        .select("id,vehicle_id,driver_id,status,start_date,end_date")
        .eq("status", "active")
        .lte("start_date", weekEnd)
        .gte("end_date", weekStart)
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
        .gte("performed_on", weekStart)
        .lte("performed_on", weekEnd)
        .limit(FLEET_ROW_LIMIT),
      supabaseAdmin
        .from("maintenance_records")
        .select("id,vehicle_id,status,item,performed_on,due_date")
        .in("status", [...OPEN_MAINTENANCE_STATUSES])
        .gte("due_date", weekStart)
        .lte("due_date", weekEnd)
        .limit(FLEET_ROW_LIMIT),
    ]);
    const rentalsQ = mergeLimited(FLEET_ROW_LIMIT, rentalsOpenQ, rentalsDatedQ);
    const servicesQ = mergeLimited(FLEET_ROW_LIMIT, servicesPerformedQ, servicesDueQ);
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
