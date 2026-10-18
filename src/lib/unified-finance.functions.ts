import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { unifiedFinanceRequestSchema, type UnifiedFinanceRequest, type UnifiedFinanceResponse } from "./unified-finance-contract";

export const getUnifiedFinanceReport = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: UnifiedFinanceRequest) => unifiedFinanceRequestSchema.parse(data))
  .handler(async ({ context }): Promise<UnifiedFinanceResponse> => {
    if (!context.userId) throw new Error("Forbidden");
    // The only database read is current role evidence, scoped to authenticated caller/RLS.
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    const { disabledUnifiedFinanceResponse } = await import("./unified-finance-report.server");
    return disabledUnifiedFinanceResponse(context.userId, roles.map(row => row.role));
  });