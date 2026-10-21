import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { z } from "zod";
import { INCIDENT_CHARGE_PREP_ENABLED } from "@/lib/incident-charge-prep-flag";
import { buildIncidentChargePrep, type IncidentChargePrepRow } from "@/lib/incident-charge-prep";

const LIMIT = 200;

export type IncidentChargePrepResult = {
  rows: IncidentChargePrepRow[];
  truncated: boolean;
};

const rowSchema = z.object({
  incidentId: z.string().uuid(),
  vehicleId: z.string().uuid(),
  rentalId: z.string().uuid().nullable(),
  vehicleLabel: z.string(),
  incidentType: z.string(),
  occurredAt: z.string(),
  status: z.enum(["open", "in_claim", "repairing"]),
  proposedAmount: z.number().positive().nullable(),
  basis: z.enum(["driver_responsible_amount", "no_driver_amount", "no_rental", "already_deducted"]),
}).strict();

function vehicleName(row: { year?: number | null; make?: string | null; model?: string | null } | null): string {
  if (!row) return "";
  return [row.year, row.make, row.model].filter((part) => part != null && String(part).trim() !== "").join(" ");
}

/** Manager-only. Throws before the role check and before any read while the flag is off. */
export const listIncidentChargePrep = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => z.object({}).strict().parse(input ?? {}))
  .handler(async ({ context }): Promise<IncidentChargePrepResult> => {
    if (!INCIDENT_CHARGE_PREP_ENABLED) throw new Error("Incident Charge Prep is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data, error } = await supabaseAdmin
      .from("incidents")
      .select("id,status,incident_type,occurred_at,vehicle_id,rental_id,driver_responsible_amount,vehicles(unit_number,year,make,model)")
      .in("status", ["open", "in_claim", "repairing"])
      .limit(LIMIT + 1);
    if (error) throw new Error(error.message);
    const incidentPage = data ?? [];
    const incidentsTruncated = incidentPage.length > LIMIT;
    const rows = incidentPage.slice(0, LIMIT).map((row) => {
      const vehicle = Array.isArray(row.vehicles) ? row.vehicles[0] : row.vehicles;
      return {
        id: row.id as string,
        status: row.status as string,
        incidentType: row.incident_type as string,
        occurredAt: row.occurred_at as string,
        vehicleId: row.vehicle_id as string,
        rentalId: (row.rental_id as string | null) ?? null,
        driverResponsibleAmount: row.driver_responsible_amount,
        unitNumber: (vehicle?.unit_number as string | null) ?? null,
        vehicle: vehicleName(vehicle),
      };
    });
    const ids = rows.map((row) => row.id);
    let deductions: { incidentId: string | null; amount: string | number | null }[] = [];
    let deductionsTruncated = false;
    if (ids.length > 0) {
      const { data: taken, error: takenError } = await supabaseAdmin
        .from("deposit_deductions")
        .select("incident_id,amount")
        .in("incident_id", ids)
        .limit(LIMIT + 1);
      if (takenError) throw new Error(takenError.message);
      const deductionPage = taken ?? [];
      deductionsTruncated = deductionPage.length > LIMIT;
      deductions = deductionPage.slice(0, LIMIT).map((row) => ({
        incidentId: (row.incident_id as string | null) ?? null,
        amount: row.amount,
      }));
    }
    return {
      rows: z.array(rowSchema).parse(buildIncidentChargePrep(rows, deductions)),
      truncated: incidentsTruncated || deductionsTruncated,
    };
  });
