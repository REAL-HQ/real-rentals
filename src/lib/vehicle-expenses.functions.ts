import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { VEHICLE_EXPENSES_ENABLED } from "./vehicle-expenses-flag";
import type { VehicleExpensesResponse } from "./vehicle-expenses.server";

export const EXPENSE_ENTRY_NOT_APPLIED = "Expense entry is proposed and not applied";

/**
 * Dark until VEHICLE_EXPENSES_ENABLED is changed and the app is rebuilt.
 * Both handlers return before the role check. Entry does not write: the
 * table is only in proposed/vehicle-expense-entries-v1.sql.
 */
export const getVehicleExpenses = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<VehicleExpensesResponse> => {
    if (!VEHICLE_EXPENSES_ENABLED) return { status: "disabled", report: null };
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { runVehicleExpenses, vehicleExpenseScans, loadVehicleExpenseRecords } = await import("./vehicle-expenses.server");
    return runVehicleExpenses({
      enabled: true,
      userId: actor.userId,
      tier: actor.tier,
      load: () => loadVehicleExpenseRecords(vehicleExpenseScans(supabaseAdmin)),
    });
  });

export const saveVehicleExpense = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<{ status: "disabled" } | { status: "unavailable"; reason: string }> => {
    if (!VEHICLE_EXPENSES_ENABLED) return { status: "disabled" };
    const { requireManager } = await import("@/lib/roles.server");
    await requireManager(context.userId);
    return { status: "unavailable", reason: EXPENSE_ENTRY_NOT_APPLIED };
  });
