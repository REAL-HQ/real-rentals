import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { REVENUE_FORECAST_ENABLED } from "./revenue-forecast-flag";
import { etToday } from "./revenue-forecast";
import type { ForecastDirectoryClient, RevenueForecastResponse } from "./revenue-forecast.server";

/** Read-only. Disabled returns before the owner check and before any read. */
export const getRevenueForecast = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<RevenueForecastResponse> => {
    if (!REVENUE_FORECAST_ENABLED) return { status: "disabled", report: null };
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { loadRevenueForecast, runRevenueForecast } = await import("./revenue-forecast.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runRevenueForecast({
      enabled: REVENUE_FORECAST_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      today: etToday(),
      load: () => loadRevenueForecast(supabaseAdmin as unknown as ForecastDirectoryClient),
    });
  });
