import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { etToday } from "./revenue-forecast";
import type { ProjectedRevenueClient, ProjectedRevenueResponse } from "./projected-revenue.server";

/** Read-only. Managers and owners who can see collections. */
export const getProjectedRevenueSummary = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ProjectedRevenueResponse> => {
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadProjectedRevenue, runProjectedRevenueSummary } = await import("./projected-revenue.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const today = etToday();
    return runProjectedRevenueSummary({
      userId: actor.userId,
      tier: actor.tier,
      today,
      load: () => loadProjectedRevenue(supabaseAdmin as unknown as ProjectedRevenueClient, today),
    });
  });
