import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { unifiedFinanceRequestSchema, type UnifiedFinanceRequest, type UnifiedFinanceResponse } from "./unified-finance-contract";
import { UNIFIED_FINANCE_ENDPOINT_ENABLED } from "./unified-finance-flag";

export const getUnifiedFinanceReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UnifiedFinanceRequest) => unifiedFinanceRequestSchema.parse(data))
  .handler(async ({ data, context }): Promise<UnifiedFinanceResponse> => {
    if (!context.userId) throw new Error("Forbidden");
    // The only database read in this file is current role evidence, scoped to the caller.
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    const roleNames = roles.map(row => row.role);
    if (!UNIFIED_FINANCE_ENDPOINT_ENABLED) {
      const { disabledUnifiedFinanceResponse } = await import("./unified-finance-report.server");
      return disabledUnifiedFinanceResponse(context.userId, roleNames);
    }
    const { loadUnifiedFinanceReport } = await import("./unified-finance-live.server");
    return loadUnifiedFinanceReport({ request: data, userId: context.userId, roles: roleNames, supabase: context.supabase });
  });