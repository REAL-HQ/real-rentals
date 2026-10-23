import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { weeklyCashFlowEnabled } from "./weekly-cash-flow-flag";
import { readLiveWeeklyCashFlow } from "./weekly-cash-flow-read.server";
import { loadCashFlowExpenses, runWeeklyCashFlow, type WeeklyCashFlowResponse } from "./weekly-cash-flow.server";

/** Read-only. The flag returns before roles, expenses, and Stripe. */
export const getWeeklyCashFlow = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<WeeklyCashFlowResponse> => {
    if (!weeklyCashFlowEnabled()) return { status: "disabled", report: null };
    if (!context.userId) throw new Error("Forbidden");
    const { data: roles, error } = await context.supabase.from("user_roles").select("role").eq("user_id", context.userId);
    if (error || !roles) throw new Error("Forbidden");
    return runWeeklyCashFlow({
      enabled: weeklyCashFlowEnabled(),
      userId: context.userId,
      roles: roles.map((row) => row.role),
      load: (window) => loadCashFlowExpenses(context.supabase, window),
      readStripe: (window) => readLiveWeeklyCashFlow(window),
    });
  });
