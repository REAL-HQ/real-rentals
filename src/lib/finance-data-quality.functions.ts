import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FINANCE_DATA_QUALITY_ENABLED, FINANCE_DATA_QUALITY_OFF } from "./finance-data-quality-flag";
import type { FinanceDataQualityClient, FinanceDataQualityResponse } from "./finance-data-quality.server";

/** Read-only. The flag throws before the role check and before any table read. */
export const getFinanceDataQuality = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ context }): Promise<FinanceDataQualityResponse> => {
    if (!FINANCE_DATA_QUALITY_ENABLED) throw new Error(FINANCE_DATA_QUALITY_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadFinanceDataQualityDirectory, runFinanceDataQuality } = await import("./finance-data-quality.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runFinanceDataQuality({
      enabled: FINANCE_DATA_QUALITY_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      load: () => loadFinanceDataQualityDirectory(supabaseAdmin as unknown as FinanceDataQualityClient),
    });
  });
