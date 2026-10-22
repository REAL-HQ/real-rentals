import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { BILLING_HEALTH_ENABLED } from "./billing-health-flag";
import type { BillingDirectoryClient, BillingHealthResponse } from "./billing-health.server";

/** Read-only. Disabled returns before the owner check and before any Stripe or table read. */
export const getBillingHealth = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<BillingHealthResponse> => {
    if (!BILLING_HEALTH_ENABLED) return { status: "disabled", report: null };
    const { requireOwner } = await import("@/lib/roles.server");
    const actor = await requireOwner(context.userId);
    const { loadBillingDirectory, runBillingHealth } = await import("./billing-health.server");
    const { readLiveBillingHealth } = await import("./billing-health-read.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runBillingHealth({
      enabled: BILLING_HEALTH_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      load: () => loadBillingDirectory(supabaseAdmin as unknown as BillingDirectoryClient),
      readStripe: () => readLiveBillingHealth(),
    });
  });
