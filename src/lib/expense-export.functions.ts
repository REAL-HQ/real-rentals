import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { EXPENSE_EXPORT_ENABLED } from "./expense-export-flag";
import type { ExpenseExportResponse } from "./expense-export";

const DISABLED: ExpenseExportResponse = { status: "disabled", csv: null, truncated: false, month: null };

/** Read-only. While the flag is off this returns before the manager check and before any read. */
export const getExpenseExport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<ExpenseExportResponse> => {
    if (!EXPENSE_EXPORT_ENABLED) return DISABLED;
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { runExpenseExport } = await import("./expense-export.server");
    const { loadVehiclePnl } = await import("./vehicle-pnl.server");
    const { readVehiclePnlStripe } = await import("./vehicle-pnl-stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const month = monthFrom(data);
    return runExpenseExport({
      enabled: EXPENSE_EXPORT_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      month,
      load: () => loadVehiclePnl(supabaseAdmin as unknown as Parameters<typeof loadVehiclePnl>[0], readVehiclePnlStripe, month),
    });
  });

function monthFrom(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  const month = (data as { month?: unknown }).month;
  return typeof month === "string" ? month : "";
}
