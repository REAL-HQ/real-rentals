import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RETURNS_DUE_ENABLED } from "@/lib/returns-due-flag";
import {
  RETURNS_DUE_LIMIT,
  buildReturnsDue,
  easternCalendarDate,
  returnsHorizon,
  vehicleDueLabel,
  type ReturnsDueBoard,
  type ReturnsDueInput,
} from "@/lib/returns-due";

const RENTAL_COLUMNS = "id,status,end_date,applications(full_name),vehicles(unit_number,year,make,model)";

/** Manager-only. Throws before the role check and before any read while the flag is off. */
export const listReturnsDue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ReturnsDueBoard> => {
    if (!RETURNS_DUE_ENABLED) throw new Error("Returns Due is off");
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = easternCalendarDate();
    const through = returnsHorizon(today);
    const { data, error, count } = await supabaseAdmin
      .from("rentals")
      .select(RENTAL_COLUMNS, { count: "exact" })
      .eq("status", "active")
      .not("end_date", "is", null)
      .lte("end_date", through)
      .order("end_date", { ascending: true })
      .limit(RETURNS_DUE_LIMIT);
    if (error) throw new Error(error.message);
    const rows: ReturnsDueInput[] = (data ?? []).map((row) => {
      const application = Array.isArray(row.applications) ? row.applications[0] : row.applications;
      const vehicle = Array.isArray(row.vehicles) ? row.vehicles[0] : row.vehicles;
      return {
        id: row.id,
        status: row.status,
        endDate: row.end_date,
        driverName: application?.full_name ?? null,
        vehicleLabel: vehicleDueLabel(vehicle),
      };
    });
    return buildReturnsDue(rows, today, (count ?? rows.length) > RETURNS_DUE_LIMIT);
  });
