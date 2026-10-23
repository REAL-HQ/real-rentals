import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VEHICLE_TURNAROUND_ENABLED } from "./vehicle-turnaround-flag";
import {
  ENDED_RENTAL_STATUSES,
  OPEN_SERVICE_STATUSES,
  PICKUP_STATUSES,
  TURNAROUND_FETCH_LIMIT,
  buildVehicleTurnaround,
  easternCalendarDate,
  type TurnaroundPickup,
  type TurnaroundRental,
  type TurnaroundService,
  type TurnaroundVehicle,
  type VehicleTurnaroundBoard,
} from "./vehicle-turnaround";

export const getVehicleTurnaround = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VehicleTurnaroundBoard> => {
    if (!VEHICLE_TURNAROUND_ENABLED) throw new Error("Vehicle Turnaround is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const today = easternCalendarDate();
    const vehiclesQ = await supabaseAdmin
      .from("vehicles")
      .select(
        "id,year,make,model,license_plate,unit_number,status,archived_at,registration_expires_on,insurance_expires_on",
        { count: "exact" },
      )
      .is("archived_at", null)
      .order("unit_number", { ascending: true })
      .limit(TURNAROUND_FETCH_LIMIT);
    if (vehiclesQ.error) throw new Error(vehiclesQ.error.message);

    const vehicles: TurnaroundVehicle[] = vehiclesQ.data ?? [];
    const ids = vehicles.map((row) => row.id);
    if (ids.length === 0) {
      return buildVehicleTurnaround({
        today,
        vehicles,
        rentals: [],
        pickups: [],
        services: [],
        vehiclesTruncated: (vehiclesQ.count ?? 0) > TURNAROUND_FETCH_LIMIT,
      });
    }

    const [activeQ, endedQ, pickupsQ, servicesQ] = await Promise.all([
      supabaseAdmin
        .from("rentals")
        .select("id,vehicle_id,status,end_date", { count: "exact" })
        .eq("status", "active")
        .in("vehicle_id", ids)
        .limit(TURNAROUND_FETCH_LIMIT),
      supabaseAdmin
        .from("rentals")
        .select("id,vehicle_id,status,end_date", { count: "exact" })
        .in("status", [...ENDED_RENTAL_STATUSES])
        .in("vehicle_id", ids)
        .order("end_date", { ascending: false })
        .limit(TURNAROUND_FETCH_LIMIT),
      supabaseAdmin
        .from("applications")
        .select("id,vehicle_id,full_name,status,pickup_date,deleted_at", { count: "exact" })
        .is("deleted_at", null)
        .in("vehicle_id", ids)
        .gte("pickup_date", today)
        .in("status", [...PICKUP_STATUSES])
        .order("pickup_date", { ascending: true })
        .limit(TURNAROUND_FETCH_LIMIT),
      supabaseAdmin
        .from("maintenance_records")
        .select("id,vehicle_id,status,item,performed_on,due_date", { count: "exact" })
        .in("vehicle_id", ids)
        .in("status", [...OPEN_SERVICE_STATUSES])
        .limit(TURNAROUND_FETCH_LIMIT),
    ]);
    for (const result of [activeQ, endedQ, pickupsQ, servicesQ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const rentals: TurnaroundRental[] = [...(activeQ.data ?? []), ...(endedQ.data ?? [])];
    const pickups: TurnaroundPickup[] = pickupsQ.data ?? [];
    const services: TurnaroundService[] = servicesQ.data ?? [];
    const over = (count: number | null, rows: number) => (count ?? rows) > TURNAROUND_FETCH_LIMIT;

    return buildVehicleTurnaround({
      today,
      vehicles,
      rentals,
      pickups,
      services,
      vehiclesTruncated: over(vehiclesQ.count, vehicles.length),
      activeRentalsTruncated: over(activeQ.count, activeQ.data?.length ?? 0),
      endedRentalsTruncated: over(endedQ.count, endedQ.data?.length ?? 0),
      pickupsTruncated: over(pickupsQ.count, pickups.length),
      servicesTruncated: over(servicesQ.count, services.length),
    });
  });
