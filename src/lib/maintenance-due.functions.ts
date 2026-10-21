// Read-only Maintenance Due list. Owners and managers only.
// No insert, update, or delete. The proposed table is optional: a missing
// relation leaves those facts Unknown and the vehicle dates still show.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import {
  MAINTENANCE_DUE_ENABLED,
  buildMaintenanceDue,
  businessToday,
  type ExpenseDueSource,
  type StoredDueSource,
  type VehicleDueRow,
  type VehicleDueSource,
} from "@/lib/maintenance-due";

const DISABLED = "Maintenance Due is disabled pending installation and acceptance";
const PAGE = 1000;

async function eachPage(load: (from: number, to: number) => PromiseLike<{ data: any[] | null; error: { message: string } | null }>) {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await load(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export const listMaintenanceDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ today: string; rows: VehicleDueRow[] }> => {
    if (!MAINTENANCE_DUE_ENABLED) throw new Error(DISABLED);
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const sb = supabaseAdmin;
    const [vehicles, expenses] = await Promise.all([
      eachPage((from, to) =>
        sb
          .from("vehicles")
          .select("id,unit_number,year,make,model,license_plate,status,body_type,partner_id,current_odometer,registration_expires_on,insurance_expires_on")
          .is("archived_at", null)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      eachPage((from, to) =>
        sb
          .from("vehicle_expenses")
          .select("vehicle_id,category,incurred_on")
          .in("category", ["tires", "registration", "insurance"])
          .order("id", { ascending: true })
          .range(from, to),
      ),
    ]);
    const stored = await loadStored(sb);
    const today = businessToday();
    return {
      today,
      rows: buildMaintenanceDue({
        today,
        vehicles: vehicles.map(mapVehicle),
        expenses: expenses.map(mapExpense),
        stored,
      }),
    };
  });

async function loadStored(sb: any): Promise<StoredDueSource[]> {
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("maintenance_due_v1")
      .select("vehicle_id,oil_last_on,oil_last_miles,oil_due_on,oil_due_miles,tires_last_miles,tires_due_on,tires_due_miles,inspection_due_on")
      .order("vehicle_id", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return [];
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return rows.map((row) => ({
    vehicleId: String(row.vehicle_id),
    oilLastOn: row.oil_last_on,
    oilLastMiles: row.oil_last_miles,
    oilDueOn: row.oil_due_on,
    oilDueMiles: row.oil_due_miles,
    tiresLastMiles: row.tires_last_miles,
    tiresDueOn: row.tires_due_on,
    tiresDueMiles: row.tires_due_miles,
    inspectionDueOn: row.inspection_due_on,
  }));
}

function mapVehicle(row: any): VehicleDueSource {
  return {
    id: String(row.id),
    unitNumber: row.unit_number ?? null,
    year: typeof row.year === "number" ? row.year : null,
    make: row.make ?? null,
    model: row.model ?? null,
    plate: row.license_plate ?? null,
    status: row.status ?? null,
    bodyType: row.body_type ?? null,
    partnerId: row.partner_id ?? null,
    currentMiles: row.current_odometer,
    registrationExpiresOn: row.registration_expires_on,
    insuranceExpiresOn: row.insurance_expires_on,
  };
}

function mapExpense(row: any): ExpenseDueSource {
  return { vehicleId: String(row.vehicle_id), category: String(row.category ?? ""), incurredOn: row.incurred_on };
}
