import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { AR_AGING_ENABLED, AR_AGING_OFF } from "./ar-aging-flag";
import type { ArAgingClient, ArAgingResponse } from "./ar-aging.server";
import { etToday } from "./ar-aging";

/** Read-only. While the flag is off this throws before the manager check and before any read. */
export const getArAging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data ?? {})
  .handler(async ({ context }): Promise<ArAgingResponse> => {
    if (!AR_AGING_ENABLED) throw new Error(AR_AGING_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadArAging, runArAging } = await import("./ar-aging.server");
    const { readLiveArAgingStripe } = await import("./ar-aging-stripe.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runArAging({
      enabled: AR_AGING_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      today: etToday(),
      load: () => loadArAging(supabaseAdmin as unknown as ArAgingClient),
      stripe: (paymentIntentIds) => readLiveArAgingStripe(paymentIntentIds),
    });
  });
