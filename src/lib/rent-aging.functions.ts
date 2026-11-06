import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { FINANCE_AR_AGING_ENABLED, RENT_AGING_OFF } from "./rent-aging-flag";
import type { RentAgingClient, RentAgingResponse } from "./rent-aging.server";

/** Read-only. The flag throws before the role check and before any table read. */
export const getRentAging = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((data: unknown) => data)
  .handler(async ({ context }): Promise<RentAgingResponse> => {
    if (!FINANCE_AR_AGING_ENABLED) throw new Error(RENT_AGING_OFF);
    const { requireManager } = await import("@/lib/roles.server");
    const actor = await requireManager(context.userId);
    const { loadRentAgingDirectory, runRentAging } = await import("./rent-aging.server");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return runRentAging({
      enabled: FINANCE_AR_AGING_ENABLED,
      userId: actor.userId,
      tier: actor.tier,
      asOf: new Date(),
      load: () => loadRentAgingDirectory(supabaseAdmin as unknown as RentAgingClient),
    });
  });
