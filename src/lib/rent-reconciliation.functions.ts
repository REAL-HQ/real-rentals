import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { RENT_RECONCILIATION_ENABLED, RENT_RECONCILIATION_OFF } from "./rent-reconciliation-flag";
import type { RentDirectoryClient, RentReconciliationResponse } from "./rent-reconciliation.server";

/** Read-only. While the flag is off this throws before the manager check and before any rent or Stripe read. */
export const getRentReconciliation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ data, context }): Promise<RentReconciliationResponse> => {
    if (!RENT_RECONCILIATION_ENABLED) throw new Error(RENT_RECONCILIATION_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const weekStart = weekStartOf(data);
    const { loadRentReconciliation, runRentReconciliation } = await import("./rent-reconciliation.server");
    const { readLiveRentStripe } = await import("./rent-reconciliation-stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runRentReconciliation({
      enabled: RENT_RECONCILIATION_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      now: new Date(),
      weekStart,
      load: () => loadRentReconciliation(supabaseAdmin as unknown as RentDirectoryClient),
      stripe: (request) => readLiveRentStripe(request),
    });
  });

function weekStartOf(data: unknown): string | null {
  if (!data || typeof data !== "object" || !("weekStart" in data)) return null;
  const value = (data as { weekStart?: unknown }).weekStart;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
