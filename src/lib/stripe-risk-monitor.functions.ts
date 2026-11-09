import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { STRIPE_RISK_MONITOR_ENABLED, STRIPE_RISK_MONITOR_OFF } from "./stripe-risk-monitor-flag";
import type { RiskDirectoryClient, RiskResponse } from "./stripe-risk-monitor.server";

/** Read-only. While the flag is off this throws before the manager check and before any driver or Stripe read. */
export const getStripeRiskMonitor = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ context }): Promise<RiskResponse> => {
    if (!STRIPE_RISK_MONITOR_ENABLED) throw new Error(STRIPE_RISK_MONITOR_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadRiskDirectory, runStripeRiskMonitor } = await import("./stripe-risk-monitor.server");
    const { readLiveStripeRisk } = await import("./stripe-risk-monitor-read.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runStripeRiskMonitor({
      enabled: STRIPE_RISK_MONITOR_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      now: new Date(),
      load: () => loadRiskDirectory(supabaseAdmin as unknown as RiskDirectoryClient),
      readStripe: (window) => readLiveStripeRisk(window),
    });
  });
