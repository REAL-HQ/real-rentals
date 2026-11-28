import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

/**
 * Driver Revenue for the Drivers list (see driver-revenue.ts for the exact
 * definition). Money is manager-only: a Coordinator gets canSee false and no
 * numbers, so the column never renders for them. The read runs as the caller,
 * so the payments policy ("Managers manage payments") decides again; nothing
 * is written and nothing is sent to a renter.
 */
export type DriverRevenueResponse =
  | { canSee: false }
  | { canSee: true; ok: true; totals: Record<string, number> }
  | { canSee: true; ok: false };

export const getDriverRevenue = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator(() => ({}))
  .handler(async ({ context }): Promise<DriverRevenueResponse> => {
    const { getActor } = await import("@/lib/roles.server");
    const { tierAllows } = await import("@/lib/roles");
    const actor = await getActor(context.userId);
    if (!actor) throw new Error("Forbidden");
    if (!tierAllows(actor.tier, "manager")) return { canSee: false };
    const { loadDriverRevenue } = await import("@/lib/driver-revenue.server");
    const result = await loadDriverRevenue(context.supabase as any);
    return result.ok ? { canSee: true, ok: true, totals: result.totals } : { canSee: true, ok: false };
  });
