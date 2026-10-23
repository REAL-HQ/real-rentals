import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { COLLECTIONS_WATCH_STATUSES } from "./collections-watch";
import { TODAYS_OPS_ENABLED } from "./todays-ops-flag";
import {
  OPS_ROW_LIMIT,
  PICKUP_STATUSES,
  addCalendarDays,
  buildTodaysOps,
  easternCalendarDate,
  vehicleOpsLabel,
  type OpsApplication,
  type OpsDocument,
  type OpsIncident,
  type OpsIssue,
  type OpsPayment,
  type OpsRental,
  type OpsVehicle,
  type TodaysOpsBoard,
} from "./todays-ops";

export const getTodaysOps = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => z.object({}).parse(data ?? {}))
  .handler(async ({ context }): Promise<TodaysOpsBoard> => {
    if (!TODAYS_OPS_ENABLED) throw new Error("Today's Ops is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { loadExpiringItems } = await import("./vehicle-docs.functions");

    const today = easternCalendarDate();
    const tomorrow = addCalendarDays(today, 1);

    const [
      pickupsQ,
      approvedQ,
      returnsQ,
      dueQ,
      overdueQ,
      incidentsQ,
      roadsideQ,
      maintenanceQ,
      expiring,
    ] = await Promise.all([
      supabaseAdmin
        .from("applications")
        .select("id,full_name,status,pickup_date,deleted_at", { count: "exact" })
        .is("deleted_at", null)
        .eq("pickup_date", today)
        .in("status", [...PICKUP_STATUSES])
        .order("full_name", { ascending: true })
        .limit(OPS_ROW_LIMIT),
      supabaseAdmin
        .from("applications")
        .select("id,full_name,status,pickup_date,deleted_at", { count: "exact" })
        .is("deleted_at", null)
        .eq("status", "approved")
        .order("full_name", { ascending: true })
        .limit(OPS_ROW_LIMIT),
      supabaseAdmin
        .from("rentals")
        .select("id,status,end_date,next_payment_due,driver_id,vehicle_id", { count: "exact" })
        .eq("status", "active")
        .in("end_date", [today, tomorrow])
        .order("end_date", { ascending: true })
        .limit(OPS_ROW_LIMIT),
      supabaseAdmin
        .from("rentals")
        .select("id,status,end_date,next_payment_due,driver_id,vehicle_id", { count: "exact" })
        .eq("status", "active")
        .eq("next_payment_due", today)
        .order("id", { ascending: true })
        .limit(OPS_ROW_LIMIT),
      supabaseAdmin
        .from("payments")
        .select("id,status,amount,driver_id", { count: "exact" })
        .in("status", [...COLLECTIONS_WATCH_STATUSES])
        .order("due_date", { ascending: true })
        .limit(OPS_ROW_LIMIT),
      supabaseAdmin
        .from("incidents")
        .select("id,status,incident_type,vehicle_id", { count: "exact" })
        .not("status", "in", "(closed,written_off)")
        .order("occurred_at", { ascending: false })
        .limit(OPS_ROW_LIMIT),
      supabaseAdmin
        .from("issues")
        .select("id,kind,status,title", { count: "exact" })
        .in("kind", ["breakdown", "tow"])
        .not("status", "in", "(resolved,closed)")
        .order("created_at", { ascending: false })
        .limit(OPS_ROW_LIMIT),
      supabaseAdmin
        .from("vehicles")
        .select("id,status,archived_at,year,make,model,license_plate,unit_number", { count: "exact" })
        .eq("status", "maintenance")
        .is("archived_at", null)
        .order("unit_number", { ascending: true })
        .limit(OPS_ROW_LIMIT),
      loadExpiringItems(supabaseAdmin, 7),
    ]);

    for (const result of [pickupsQ, approvedQ, returnsQ, dueQ, overdueQ, incidentsQ, roadsideQ, maintenanceQ]) {
      if (result.error) throw new Error(result.error.message);
    }

    const rentalRows = [...(returnsQ.data ?? []), ...(dueQ.data ?? [])];
    const driverIds = [
      ...new Set(
        [...rentalRows.map((row) => row.driver_id), ...(overdueQ.data ?? []).map((row) => row.driver_id)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];
    const vehicleIds = [
      ...new Set(
        [...rentalRows.map((row) => row.vehicle_id), ...(incidentsQ.data ?? []).map((row) => row.vehicle_id)].filter(
          (id): id is string => Boolean(id),
        ),
      ),
    ];

    const [driversQ, vehiclesQ] = await Promise.all([
      driverIds.length
        ? supabaseAdmin
            .from("applications")
            .select("user_id,full_name,deleted_at,created_at")
            .in("user_id", driverIds)
            .order("created_at", { ascending: false })
            .limit(1000)
        : Promise.resolve({ data: [], error: null }),
      vehicleIds.length
        ? supabaseAdmin
            .from("vehicles")
            .select("id,year,make,model,license_plate,unit_number")
            .in("id", vehicleIds)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (driversQ.error) throw new Error(driversQ.error.message);
    if (vehiclesQ.error) throw new Error(vehiclesQ.error.message);

    const driverNames = new Map<string, string>();
    for (const row of driversQ.data ?? []) {
      if (!row.user_id || row.deleted_at || driverNames.has(row.user_id)) continue;
      driverNames.set(row.user_id, row.full_name);
    }
    const vehicleLabels = new Map<string, string>();
    for (const row of vehiclesQ.data ?? []) {
      vehicleLabels.set(row.id, vehicleOpsLabel(row));
    }

    const applications: OpsApplication[] = [...(pickupsQ.data ?? []), ...(approvedQ.data ?? [])];
    const rentals: OpsRental[] = rentalRows.map((row) => ({
      id: row.id,
      status: row.status,
      end_date: row.end_date,
      next_payment_due: row.next_payment_due,
      driver_name: driverNames.get(row.driver_id) ?? null,
      vehicle_label: vehicleLabels.get(row.vehicle_id) ?? null,
    }));
    const payments: OpsPayment[] = (overdueQ.data ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      amount: row.amount,
      driver_name: row.driver_id ? driverNames.get(row.driver_id) ?? null : null,
    }));
    const documents: OpsDocument[] = (expiring as OpsDocument[]).slice(0, OPS_ROW_LIMIT);
    const incidents: OpsIncident[] = (incidentsQ.data ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      incident_type: row.incident_type,
      vehicle_label: vehicleLabels.get(row.vehicle_id) ?? null,
    }));
    const issues: OpsIssue[] = roadsideQ.data ?? [];
    const vehicles: OpsVehicle[] = (maintenanceQ.data ?? []).map((row) => ({
      id: row.id,
      status: row.status,
      archived_at: row.archived_at,
      label: vehicleOpsLabel(row),
    }));

    const over = (count: number | null, shown: number) => (count ?? shown) > OPS_ROW_LIMIT;

    return buildTodaysOps({
      today,
      tomorrow,
      applications,
      rentals,
      payments,
      documents,
      incidents,
      issues,
      vehicles,
      truncated: {
        pickups: over(pickupsQ.count, pickupsQ.data?.length ?? 0),
        approved_ready: over(approvedQ.count, approvedQ.data?.length ?? 0),
        returns: over(returnsQ.count, returnsQ.data?.length ?? 0),
        payments_due: over(dueQ.count, dueQ.data?.length ?? 0),
        overdue: over(overdueQ.count, overdueQ.data?.length ?? 0),
        documents: expiring.length > OPS_ROW_LIMIT,
        incidents: over(incidentsQ.count, incidentsQ.data?.length ?? 0),
        roadside: over(roadsideQ.count, roadsideQ.data?.length ?? 0),
        maintenance: over(maintenanceQ.count, maintenanceQ.data?.length ?? 0),
      },
    });
  });
